// "Continue with Discord / Google / Microsoft / Apple". Authorization-code flow with PKCE (except Apple, which
// uses a signed client secret), a random state and OIDC nonce per attempt, and a browser-bound one-time finish.
// A provider is switched on only when its client id and secret are set in the environment.
// Identities are linked to accounts explicitly; an email address alone never links or takes over an account.
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

export type Identity = { sub: string; email?: string | null; emailVerified?: boolean; name?: string | null };
export type Provider = {
  id: string;
  name: string;
  authUrl: string;
  tokenUrl: string;
  scope: string;
  clientId: string;
  pkce: boolean;
  formPost?: boolean;
  issuers?: string[];
  clientSecret: () => string;
  identity: (tokens: any, extra: { nonce: string; form?: any }) => Promise<Identity>;
};

export const b64url = (b: Buffer) => b.toString('base64url');
export const random = (n = 32) => b64url(randomBytes(n));
export const challenge = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

// decode an id_token we were just handed by the provider's token endpoint over TLS (OIDC Core 3.1.3.7 lets a
// confidential client skip signature checks for tokens received this way), then check what it claims
function claims(p: Provider, idToken: string, nonce: string) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('The provider sent no identity.');
  const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(p.clientId)) throw new Error('That sign-in was meant for a different app.');
  if (p.issuers && !p.issuers.some((i) => (i.endsWith('/') ? String(c.iss).startsWith(i) : c.iss === i || String(c.iss).startsWith(i)))) throw new Error('That sign-in came from the wrong place.');
  if (!(c.exp * 1000 > Date.now() - 60_000)) throw new Error('That sign-in expired. Try again.');
  if (c.nonce !== undefined && c.nonce !== nonce) throw new Error('That sign-in did not match. Try again.');
  if (!c.sub) throw new Error('The provider sent no identity.');
  return c;
}

export function providers(env: Record<string, string | undefined>): Record<string, Provider> {
  const out: Record<string, Provider> = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
    out.google = {
      id: 'google', name: 'Google', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'openid email profile', clientId: env.GOOGLE_CLIENT_ID, pkce: true, issuers: ['https://accounts.google.com', 'accounts.google.com'],
      clientSecret: () => env.GOOGLE_CLIENT_SECRET!,
      identity: async (t, x) => {
        const c = claims(out.google, t.id_token, x.nonce);
        return { sub: c.sub, email: c.email, emailVerified: !!c.email_verified, name: c.name || c.given_name };
      }
    };
  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET)
    out.microsoft = {
      id: 'microsoft', name: 'Microsoft', authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scope: 'openid email profile', clientId: env.MICROSOFT_CLIENT_ID, pkce: true, issuers: ['https://login.microsoftonline.com/'],
      clientSecret: () => env.MICROSOFT_CLIENT_SECRET!,
      identity: async (t, x) => {
        const c = claims(out.microsoft, t.id_token, x.nonce);
        // tid + oid identify a person across apps; sub is stable for this app. Use sub, scoped by tenant.
        return { sub: `${c.tid || 'common'}:${c.sub}`, email: c.email || c.preferred_username, emailVerified: false, name: c.name };
      }
    };
  if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET)
    out.discord = {
      id: 'discord', name: 'Discord', authUrl: 'https://discord.com/oauth2/authorize', tokenUrl: 'https://discord.com/api/oauth2/token',
      scope: 'identify email', clientId: env.DISCORD_CLIENT_ID, pkce: true,
      clientSecret: () => env.DISCORD_CLIENT_SECRET!,
      identity: async (t) => {
        const r = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: 'Bearer ' + t.access_token }, signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('Discord would not say who you are.');
        const u: any = await r.json();
        return { sub: String(u.id), email: u.email, emailVerified: !!u.verified, name: u.global_name || u.username };
      }
    };
  // Apple: needs a paid Apple Developer membership. The client secret is a short-lived ES256 JWT signed with your key.
  if (env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY)
    out.apple = {
      id: 'apple', name: 'Apple', authUrl: 'https://appleid.apple.com/auth/authorize', tokenUrl: 'https://appleid.apple.com/auth/token',
      scope: 'name email', clientId: env.APPLE_CLIENT_ID, pkce: false, formPost: true, issuers: ['https://appleid.apple.com'],
      clientSecret: () =>
        jwt.sign({}, env.APPLE_PRIVATE_KEY!.replace(/\\n/g, '\n'), {
          algorithm: 'ES256', keyid: env.APPLE_KEY_ID, issuer: env.APPLE_TEAM_ID, audience: 'https://appleid.apple.com', subject: env.APPLE_CLIENT_ID, expiresIn: '5m'
        }),
      identity: async (t, x) => {
        const c = claims(out.apple, t.id_token, x.nonce);
        // Apple sends the name only on the very first sign-in, as a form field next to the code
        let name: string | null = null;
        try {
          const u = x.form?.user ? JSON.parse(x.form.user) : null;
          name = [u?.name?.firstName, u?.name?.lastName].filter(Boolean).join(' ') || null;
        } catch {}
        return { sub: c.sub, email: c.email, emailVerified: c.email_verified === true || c.email_verified === 'true', name };
      }
    };
  return out;
}

export function authorizeUrl(p: Provider, redirectUri: string, state: string, nonce: string, verifier: string) {
  const u = new URL(p.authUrl);
  const q = u.searchParams;
  q.set('client_id', p.clientId);
  q.set('redirect_uri', redirectUri);
  q.set('response_type', 'code');
  q.set('scope', p.scope);
  q.set('state', state);
  if (p.id !== 'discord') q.set('nonce', nonce);
  if (p.pkce) {
    q.set('code_challenge', challenge(verifier));
    q.set('code_challenge_method', 'S256');
  }
  if (p.formPost) q.set('response_mode', 'form_post');
  if (p.id === 'google') q.set('prompt', 'select_account');
  if (p.id === 'microsoft') q.set('prompt', 'select_account');
  if (p.id === 'discord') q.set('prompt', 'none');
  return u.toString();
}

export async function exchange(p: Provider, code: string, redirectUri: string, verifier: string) {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: p.clientId, client_secret: p.clientSecret() });
  if (p.pkce) body.set('code_verifier', verifier);
  const r = await fetch(p.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(`${p.name} refused the sign-in${data.error_description ? `: ${data.error_description}` : '.'}`);
  return data;
}
