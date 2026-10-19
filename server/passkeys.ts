// Passkeys (WebAuthn). A player adds one from their passport while signed in, then signs in with their face,
// fingerprint or device PIN instead of a password. The site's own origin is the relying party
// (bigdreamerdev.github.io in production), so a passkey only ever works on the real site.
import type { Express } from 'express';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { Q } from './db';
import { random } from './oauth';

export const PASSKEY_SCHEMA = `
CREATE TABLE IF NOT EXISTS v2_passkeys (
  id          TEXT PRIMARY KEY,
  user_id     INT NOT NULL,
  public_key  TEXT NOT NULL,
  counter     BIGINT NOT NULL DEFAULT 0,
  transports  TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL,
  rp_id       TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  last_used   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS v2_passkeys_user ON v2_passkeys (user_id);
`;

export const MAX_PASSKEYS = 10;
const TTL = 5 * 60_000;
const TRANSPORTS = ['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'];

type Deps = {
  q: Q;
  now: () => number;
  auth: any;
  limited: (key: string, n?: number) => boolean;
  allowedOrigin: (origin: string) => boolean;
  welcome: (u: any, req: any) => Promise<any>;
  audit: (actor: string, cmd: string, ok: boolean, error?: string) => any;
  hasPassword: (userId: number) => Promise<boolean>;
  identities: (userId: number) => Promise<number>;
};
type Flow = { challenge: string; origin: string; rpID: string; userId: number | null; at: number };

export function passkeys(app: Express, d: Deps) {
  const { q, now, auth, limited, audit } = d;
  // challenges live in memory for five minutes and work once; a restart mid-ceremony just means "try again"
  const flows = new Map<string, Flow>();
  const keep = (f: Omit<Flow, 'at'>) => {
    for (const [k, v] of flows) if (now() - v.at > TTL) flows.delete(k);
    if (flows.size > 5000) flows.delete(flows.keys().next().value!);
    const id = random(18);
    flows.set(id, { ...f, at: now() });
    return id;
  };
  const take = (id: unknown) => {
    const f = flows.get(String(id || ''));
    flows.delete(String(id || ''));
    return f && now() - f.at <= TTL ? f : null;
  };
  // the relying party is whichever allowed site origin is asking; WebAuthn itself checks the browser agrees
  const site = (req: any) => {
    const origin = String(req.headers.origin || '');
    if (!origin || !d.allowedOrigin(origin)) return null;
    return { origin, rpID: new URL(origin).hostname };
  };
  const NO_SITE = 'Passkeys only work from the Realm site itself.';
  const cleanName = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Passkey';

  app.get('/api/passkeys', auth, async (req: any, res) => {
    res.json((await q('SELECT id, name, created_at, last_used FROM v2_passkeys WHERE user_id = $1 ORDER BY created_at', [req.user.id])).rows);
  });

  // add a passkey: step 1, options for navigator.credentials.create()
  app.post('/api/passkeys/register/begin', auth, async (req: any, res) => {
    if (limited('passkey:' + req.user.id, 10)) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    const s = site(req);
    if (!s) return res.status(400).json({ error: NO_SITE });
    const mine = (await q('SELECT id, transports FROM v2_passkeys WHERE user_id = $1', [req.user.id])).rows;
    if (mine.length >= MAX_PASSKEYS) return res.status(400).json({ error: `You already have ${MAX_PASSKEYS} passkeys. Remove one first.` });
    const options = await generateRegistrationOptions({
      rpName: 'The Realm',
      rpID: s.rpID,
      userID: new TextEncoder().encode('u' + req.user.id),
      userName: req.user.username,
      userDisplayName: req.user.display_name,
      attestationType: 'none',
      excludeCredentials: mine.map((k: any) => ({ id: k.id, transports: k.transports ? k.transports.split(',') : undefined })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: TTL,
    });
    res.json({ flow: keep({ challenge: options.challenge, ...s, userId: req.user.id }), options });
  });

  // add a passkey: step 2, check what the authenticator made and keep its public key
  app.post('/api/passkeys/register/finish', auth, async (req: any, res) => {
    const f = take(req.body?.flow);
    const s = site(req);
    if (!f || f.userId !== req.user.id || !s || s.origin !== f.origin) return res.status(400).json({ error: 'That passkey request expired. Try again.' });
    let info;
    try {
      const v = await verifyRegistrationResponse({ response: req.body?.response, expectedChallenge: f.challenge, expectedOrigin: f.origin, expectedRPID: f.rpID, requireUserVerification: true });
      if (!v.verified || !v.registrationInfo) throw new Error();
      info = v.registrationInfo;
    } catch {
      audit(req.cid, 'auth.passkey.add', false, 'verify failed');
      return res.status(400).json({ error: 'Your device did not make a valid passkey. Try again.' });
    }
    const c = info.credential;
    if ((await q('SELECT count(*)::int AS n FROM v2_passkeys WHERE user_id = $1', [req.user.id])).rows[0].n >= MAX_PASSKEYS) return res.status(400).json({ error: `You already have ${MAX_PASSKEYS} passkeys. Remove one first.` });
    const taken = await q('INSERT INTO v2_passkeys (id, user_id, public_key, counter, transports, name, rp_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING RETURNING id', [
      c.id, req.user.id, Buffer.from(c.publicKey).toString('base64url'), c.counter, (c.transports || []).filter((t) => TRANSPORTS.includes(t)).join(','), cleanName(req.body?.name), f.rpID,
    ]);
    if (!taken.rows.length) return res.status(409).json({ error: 'That passkey is already saved.' });
    audit(req.cid, 'auth.passkey.add', true);
    res.json({ ok: true });
  });

  // sign in: step 1, a challenge for any passkey this site made (the device offers the player's own)
  app.post('/api/passkeys/login/begin', async (req: any, res) => {
    if (limited('passkey:' + req.ip, 20)) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    const s = site(req);
    if (!s) return res.status(400).json({ error: NO_SITE });
    const options = await generateAuthenticationOptions({ rpID: s.rpID, userVerification: 'required', timeout: TTL });
    res.json({ flow: keep({ challenge: options.challenge, ...s, userId: null }), options });
  });

  // sign in: step 2, check the signature against the saved public key
  app.post('/api/passkeys/login/finish', async (req: any, res) => {
    if (limited('passkey:' + req.ip, 20)) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    const f = take(req.body?.flow);
    const s = site(req);
    if (!f || f.userId !== null || !s || s.origin !== f.origin) return res.status(400).json({ error: 'That sign-in expired. Try again.' });
    const r = req.body?.response;
    const key = (await q('SELECT * FROM v2_passkeys WHERE id = $1', [String(r?.id || '').slice(0, 1400)])).rows[0];
    if (!key || key.rp_id !== f.rpID) return res.status(401).json({ error: 'That passkey is not linked to any account here. Sign in another way, then add it from your passport.' });
    // the user handle, when the device sends it, must be the account the passkey was made for
    if (r?.response?.userHandle && Buffer.from(String(r.response.userHandle), 'base64url').toString() !== 'u' + key.user_id) return res.status(401).json({ error: 'That passkey does not match its account.' });
    let next: number;
    try {
      const v = await verifyAuthenticationResponse({
        response: r, expectedChallenge: f.challenge, expectedOrigin: f.origin, expectedRPID: f.rpID, requireUserVerification: true,
        credential: { id: key.id, publicKey: new Uint8Array(Buffer.from(key.public_key, 'base64url')), counter: Number(key.counter), transports: key.transports ? key.transports.split(',') : undefined },
      });
      if (!v.verified) throw new Error();
      next = v.authenticationInfo.newCounter;
    } catch {
      audit('u' + key.user_id, 'auth.login.passkey', false, 'verify failed');
      return res.status(401).json({ error: 'Your passkey could not be checked. Try again.' });
    }
    const u = (await q('SELECT * FROM users WHERE id = $1', [key.user_id])).rows[0];
    if (!u || !u.is_active) return res.status(403).json({ error: 'That account is not active.' });
    if (!u.approved) return res.status(403).json({ error: 'Your account is waiting for the Returning Officer to approve it.' });
    await q('UPDATE v2_passkeys SET counter = $1, last_used = now() WHERE id = $2', [next, key.id]);
    audit('u' + u.id, 'auth.login.passkey', true);
    res.json(await d.welcome(u, req));
  });

  app.post('/api/passkeys/rename', auth, async (req: any, res) => {
    const r = await q('UPDATE v2_passkeys SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING id', [cleanName(req.body?.name), String(req.body?.id || ''), req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No such passkey.' });
    res.json({ ok: true });
  });

  app.post('/api/passkeys/remove', auth, async (req: any, res) => {
    const id = String(req.body?.id || '');
    const n = (await q('SELECT count(*)::int AS n FROM v2_passkeys WHERE user_id = $1', [req.user.id])).rows[0].n;
    if (n <= 1 && !(await d.hasPassword(req.user.id)) && !(await d.identities(req.user.id))) return res.status(400).json({ error: 'That is your only way to sign in. Set a password or add another passkey first.' });
    const r = await q('DELETE FROM v2_passkeys WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No such passkey.' });
    audit(req.cid, 'auth.passkey.remove', true);
    res.json({ ok: true });
  });
}
