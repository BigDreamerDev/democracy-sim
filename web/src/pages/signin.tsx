// The door. Old Republic accounts sign in with the same username and password, or with a linked
// Discord, Google, Microsoft or Apple account, or a passkey added from their passport.
import { useEffect, useState } from 'preact/hooks';
import { Seal, Btn, ThemeSwitch, PasswordField, Icon } from '../ui';
import { signIn, signUp, useStore, oauthProviders, beginOAuth, passkeysWork, signInWithPasskey } from '../store';

const MARK: Record<string, string> = { discord: 'D', google: 'G', microsoft: 'M', apple: 'A' };

export function SignIn() {
  const s = useStore();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [u, setU] = useState('');
  const [n, setN] = useState('');
  const [p, setP] = useState('');
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [busy, setBusy] = useState('');
  const [provs, setProvs] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => void oauthProviders().then(setProvs), []);
  useEffect(() => void (s.oauthNote && setMsg({ text: s.oauthNote, err: !/approve/.test(s.oauthNote) })), [s.oauthNote]);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy('form');
    setMsg(null);
    try {
      if (mode === 'in') await signIn(u, p);
      else if ((await signUp(u, n, p)) === 'waiting') setMsg({ text: 'Done. The Returning Officer will approve you soon; then sign in.', err: false });
    } catch (e: any) {
      setMsg({ text: e.message, err: true });
    }
    setBusy('');
  };
  const viaProvider = async (id: string) => {
    setBusy(id);
    setMsg(null);
    try {
      await beginOAuth(id);
    } catch (e: any) {
      setMsg({ text: e.message, err: true });
      setBusy('');
    }
  };
  const viaPasskey = async () => {
    setBusy('passkey');
    setMsg(null);
    try {
      await signInWithPasskey();
    } catch (e: any) {
      setMsg({ text: e.message, err: true });
    }
    setBusy('');
  };
  const keys = mode === 'in' && passkeysWork();
  if (s.loading)
    return (
      <div class="door">
        <Seal size={72} />
        <p class="muted">Opening the realm… <span class="small">(the server can take 30 seconds to wake)</span></p>
      </div>
    );
  return (
    <div class="door">
      <form class="card door-card" onSubmit={submit} autoComplete="on">
        <div style={{ textAlign: 'center' }}>
          <Seal size={72} />
          <div class="kicker" style={{ marginTop: 10 }}>By order of the Returning Officer</div>
          <h1 class="title" style={{ margin: '4px 0 2px' }}>{mode === 'in' ? 'Enter the realm' : 'Apply for citizenship'}</h1>
          <p class="small muted" style={{ margin: 0 }}>{mode === 'in' ? 'Your old Republic login still works.' : 'One account per person. One vote each.'}</p>
        </div>
        {(provs.length > 0 || keys) && (
          <>
            <div class="sso">
              {keys && (
                <button type="button" class="sso-btn passkey" disabled={!!busy} onClick={viaPasskey}>
                  <span class="sso-mark" aria-hidden="true"><Icon name="key" /></span>
                  <span>{busy === 'passkey' ? 'Waiting for your device…' : 'Sign in with a passkey'}</span>
                </button>
              )}
              {provs.map((x) => (
                <button type="button" class={'sso-btn ' + x.id} disabled={!!busy} onClick={() => viaProvider(x.id)}>
                  <span class="sso-mark" aria-hidden="true">{MARK[x.id] || x.name[0]}</span>
                  <span>{busy === x.id ? 'Opening…' : `Continue with ${x.name}`}</span>
                </button>
              ))}
            </div>
            <div class="or" aria-hidden="true"><span>or with a password</span></div>
          </>
        )}
        <label class="f">Username<input class="input" value={u} onInput={(e: any) => setU(e.target.value)} autoComplete="username" autoCapitalize="none" spellcheck={false} maxLength={20} /></label>
        {mode === 'up' && <label class="f">Display name<input class="input" value={n} onInput={(e: any) => setN(e.target.value)} autoComplete="nickname" maxLength={24} placeholder="What the Gazette calls you" /></label>}
        <PasswordField label="Password" value={p} onInput={setP} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} hint={mode === 'up' ? 'At least 10 characters. A short sentence is easy to remember and hard to guess.' : undefined} />
        {msg && <p class={'small ' + (msg.err ? 'bad' : 'good')} role="alert">{msg.text}</p>}
        <button class="btn full" type="submit" disabled={!!busy || !u || !p}>{busy === 'form' ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Apply'}</button>
        <Btn kind="plain" full onClick={() => (setMode(mode === 'in' ? 'up' : 'in'), setMsg(null))}>{mode === 'in' ? 'New here? Apply for citizenship' : 'Have an account? Sign in'}</Btn>
        {(provs.length > 0 || keys) && mode === 'in' && <p class="small muted" style={{ margin: 0, textAlign: 'center' }}>Already have an account? Sign in with your password once, then add a passkey{provs.length > 0 ? ' or link Discord, Google, Microsoft or Apple' : ''} from your passport.</p>}
        <div style={{ display: 'flex', justifyContent: 'center' }}><ThemeSwitch /></div>
      </form>
    </div>
  );
}
