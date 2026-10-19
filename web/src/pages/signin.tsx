// The door. Old accounts from the Republic sign in with the same username and password.
import { useState } from 'preact/hooks';
import { Seal, Field, Btn, ThemeSwitch } from '../ui';
import { signIn, signUp, useStore } from '../store';

export function SignIn() {
  const s = useStore();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [u, setU] = useState('');
  const [n, setN] = useState('');
  const [p, setP] = useState('');
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'in') await signIn(u, p);
      else if ((await signUp(u, n, p)) === 'waiting') setMsg({ text: 'Done. The Returning Officer will approve you soon; then sign in.', err: false });
    } catch (e: any) {
      setMsg({ text: e.message, err: true });
    }
    setBusy(false);
  };
  if (s.loading)
    return (
      <div class="door">
        <Seal size={72} />
        <p class="muted">Opening the realm… <span class="small">(the server can take 30 seconds to wake)</span></p>
      </div>
    );
  return (
    <div class="door">
      <form class="card door-card" onSubmit={submit}>
        <div style={{ textAlign: 'center' }}>
          <Seal size={72} />
          <div class="kicker" style={{ marginTop: 10 }}>By order of the Returning Officer</div>
          <h1 class="title" style={{ margin: '4px 0 2px' }}>{mode === 'in' ? 'Enter the realm' : 'Apply for citizenship'}</h1>
          <p class="small muted" style={{ margin: 0 }}>{mode === 'in' ? 'Your old Republic login still works.' : 'One account per person. One vote each.'}</p>
        </div>
        <Field label="Username" value={u} onInput={setU} />
        {mode === 'up' && <Field label="Display name" value={n} onInput={setN} placeholder="What the Gazette calls you" />}
        <Field label="Password" type="password" value={p} onInput={setP} />
        {msg && <p class={'small ' + (msg.err ? 'bad' : 'good')} role="alert">{msg.text}</p>}
        <button class="btn full" type="submit" disabled={busy || !u || !p}>{busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Apply'}</button>
        <Btn kind="plain" full onClick={() => (setMode(mode === 'in' ? 'up' : 'in'), setMsg(null))}>{mode === 'in' ? 'New here? Apply for citizenship' : 'Have an account? Sign in'}</Btn>
        <div style={{ display: 'flex', justifyContent: 'center' }}><ThemeSwitch /></div>
      </form>
    </div>
  );
}
