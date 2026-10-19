// Players' apps: API keys, registering an app, webhooks, the app directory and the "Sign in with the Realm" consent screen.
// The full docs are API.md in the repo.
import { useEffect, useState } from 'preact/hooks';
import { useStore, ONLINE, API_URL, listKeys, createKey, revokeKey, myApps, makeApp, updateApp, deleteApp, appInfo, authorizeApp, appDirectory, listHooks, addHook, deleteHook, testHook, toast } from '../store';
import { Page, Sec, Card, Btn, Field, Seg, Empty, When, Seal } from '../ui';

const DOCS = 'https://github.com/BigDreamerDev/democracy-sim/blob/main/API.md';
const SITE = () => location.origin + location.pathname;
const err = (e: any) => toast(e.message, true);
const t = (s: any) => (s ? new Date(s).getTime() : 0);

function Secret({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  return (
    <Card kind="green" style={{ marginBottom: 12 }}><div class="stack">
      <b>{label}</b>
      <code class="key" style={{ userSelect: 'all' }}>{value}</code>
      <div class="row" style={{ justifyContent: 'flex-start', gap: 8 }}>
        <Btn small kind="ghost" onClick={() => navigator.clipboard?.writeText(value).then(() => toast('Copied.'))}>Copy</Btn>
        <Btn small kind="plain" onClick={onDone}>I've saved it</Btn>
      </div>
    </div></Card>
  );
}

export function Developers() {
  useStore();
  const [keys, setKeys] = useState<any[] | null>(null);
  const [apps, setApps] = useState<any[] | null>(null);
  const [hooks, setHooks] = useState<any[] | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'act'>('read');
  const [fresh, setFresh] = useState('');
  const [secret, setSecret] = useState('');
  const [app, setApp] = useState({ name: '', description: '', homepage: '', redirect: '' });
  const [hookUrl, setHookUrl] = useState('');
  const load = () => {
    listKeys().then(setKeys).catch(err);
    myApps().then(setApps).catch(err);
    listHooks().then(setHooks).catch(err);
  };
  useEffect(() => void (ONLINE && load()), []);
  const base = API_URL || 'https://your-realm.onrender.com';
  const example = `const KEY = 'rlm_…';
const realm = (path, body) => fetch('${base}/api/v1' + path, {
  method: body ? 'POST' : 'GET',
  headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: body && JSON.stringify(body)
}).then((r) => r.json());

const { world } = await realm('/state');
console.log(world.gazette[0].text);
await realm('/act', { cmd: 'q.back', args: { id: world.questions[0].id } });`;
  const own = (keys || []).filter((k) => !k.app_id);
  const granted = (keys || []).filter((k) => k.app_id);
  return (
    <Page back={['#/you', 'Passport']} kicker="For tinkerers" title="Build your own app" intro="Make a bot, a dashboard or a whole new frontend. Your app sees exactly what you see and can do exactly what you can do: nothing more.">
      {!ONLINE && <Card kind="warn">Keys, apps and webhooks exist only on the live realm, not in the demo.</Card>}
      <Sec><div class="row" style={{ justifyContent: 'flex-start', gap: 8 }}><Btn href="#/apps" kind="ghost" small>Browse the app directory</Btn><Btn href={DOCS} kind="ghost" small>Full API docs</Btn></div></Sec>

      {ONLINE && (
        <Sec title="Apps you've let in" sub="Apps you signed into with your Realm account. Revoke one and it loses access at once.">
          {granted.length ? (
            <ul class="list">{granted.map((k) => (
              <li class="row">
                <span><b>{k.name}</b> <span class="small muted">{k.scope === 'act' ? 'can act as you' : 'can read'}</span>
                  <div class="small muted">{k.last_used ? <>Last used <When at={t(k.last_used)} /></> : 'Not used yet'}{k.homepage && <> · <a href={k.homepage} target="_blank" rel="noopener">site</a></>}</div></span>
                <Btn small kind="danger ghost" onClick={() => revokeKey(k.id).then(() => (toast('Access removed.'), load())).catch(err)}>Revoke</Btn>
              </li>
            ))}</ul>
          ) : <Empty>None.</Empty>}
        </Sec>
      )}

      {ONLINE && (
        <Sec title="Your API keys" sub="For your own scripts. Treat a key like a password: anyone holding an act key can play as you.">
          {fresh && <Secret label="Copy your key now. It won't be shown again." value={fresh} onDone={() => setFresh('')} />}
          {keys === null ? <Empty>Loading…</Empty> : own.length ? (
            <ul class="list">{own.map((k) => (
              <li class="row">
                <span><b>{k.name}</b> <span class="small muted tnum">{k.prefix}… · {k.scope === 'act' ? 'read and act' : 'read only'}</span>
                  <div class="small muted">{k.last_used ? <>Last used <When at={t(k.last_used)} /></> : 'Never used'}</div></span>
                <Btn small kind="danger ghost" onClick={() => revokeKey(k.id).then(() => (toast('Revoked.'), load())).catch(err)}>Revoke</Btn>
              </li>
            ))}</ul>
          ) : <Empty>No keys yet.</Empty>}
          <Card style={{ marginTop: 12 }}><div class="stack">
            <Field label="What's it for?" value={name} onInput={setName} placeholder="e.g. my voting script" />
            <Seg value={scope} onChange={setScope} options={[['read', 'Read only'], ['act', 'Read and act']]} />
            <Btn full disabled={name.trim().length < 2} onClick={() => createKey(name, scope).then((k) => (setFresh(k.key), setName(''), load())).catch(err)}>Make a key</Btn>
          </div></Card>
        </Sec>
      )}

      {ONLINE && (
        <Sec title="Apps you've made" sub="Register an app so other players can sign in to it with one tap, and list it in the directory.">
          {(apps || []).map((a) => (
            <Card style={{ marginBottom: 10 }}><div class="stack">
              <div class="row"><b>{a.name}</b><span class="small muted">{a.users} {a.users === 1 ? 'user' : 'users'}</span></div>
              {a.description && <span class="small">{a.description}</span>}
              <div class="small muted">Client id <code>{a.client_id}</code></div>
              <div class="small muted">Redirect {a.redirect ? <code>{a.redirect}</code> : <i>none: sign-in is off</i>}</div>
              <div class="small muted">Sign-in link <code style={{ wordBreak: 'break-all' }}>{SITE()}#/authorize?app={a.client_id}&amp;scope=act&amp;state=…</code></div>
              <div class="row" style={{ justifyContent: 'flex-start', gap: 8 }}>
                <Btn small kind="ghost" onClick={() => updateApp({ id: a.id, listed: !a.listed }).then(load).catch(err)}>{a.listed ? 'Unlist' : 'List in directory'}</Btn>
                <Btn small kind="danger ghost" onClick={() => deleteApp(a.id).then(() => (toast('Deleted. Everyone signed in to it lost access.'), load())).catch(err)}>Delete</Btn>
              </div>
            </div></Card>
          ))}
          <Card><div class="stack">
            <Field label="App name" value={app.name} onInput={(v) => setApp({ ...app, name: v })} />
            <Field label="What does it do?" value={app.description} onInput={(v) => setApp({ ...app, description: v })} placeholder="One line for the directory" />
            <Field label="Website (optional)" value={app.homepage} onInput={(v) => setApp({ ...app, homepage: v })} placeholder="https://…" />
            <Field label="Redirect address for sign-in (optional)" value={app.redirect} onInput={(v) => setApp({ ...app, redirect: v })} placeholder="https://your-app/callback or http://localhost:3000/" />
            <Btn full disabled={app.name.trim().length < 2} onClick={() => makeApp(app).then(() => (toast('Registered.'), setApp({ name: '', description: '', homepage: '', redirect: '' }), load())).catch(err)}>Register app</Btn>
          </div></Card>
        </Sec>
      )}

      {ONLINE && (
        <Sec title="Webhooks" sub="We POST every new Gazette entry to your address, signed with your secret. Great for chat bots.">
          {secret && <Secret label="Your signing secret. It won't be shown again." value={secret} onDone={() => setSecret('')} />}
          {(hooks || []).length ? (
            <ul class="list">{hooks!.map((h) => (
              <li class="row">
                <span style={{ minWidth: 0 }}><code style={{ wordBreak: 'break-all' }}>{h.url}</code>
                  <div class="small muted">{h.disabled ? <b class="err-line">Switched off after 20 failures. Test it to switch it back on.</b> : h.last_at ? <>Last delivery <When at={t(h.last_at)} />: {h.last_status}</> : 'No deliveries yet'}</div></span>
                <span class="row" style={{ gap: 6 }}>
                  <Btn small kind="ghost" onClick={() => testHook(h.id).then((r) => (toast(r.ok ? 'Delivered.' : 'Failed: ' + r.status, !r.ok), load())).catch(err)}>Test</Btn>
                  <Btn small kind="danger ghost" onClick={() => deleteHook(h.id).then(load).catch(err)}>Delete</Btn>
                </span>
              </li>
            ))}</ul>
          ) : <Empty>No webhooks.</Empty>}
          <div class="grid2" style={{ marginTop: 10 }}>
            <Field label="https:// address" value={hookUrl} onInput={setHookUrl} placeholder="https://your-bot/realm" />
            <Btn style={{ alignSelf: 'end' }} disabled={!hookUrl.startsWith('https://')} onClick={() => addHook(hookUrl).then((h) => (setSecret(h.secret), setHookUrl(''), load())).catch(err)}>Add webhook</Btn>
          </div>
        </Sec>
      )}

      <Sec title="Quick start" sub={<>Base URL <code>{base}/api/v1</code>. Any website may call it.</>}>
        <pre class="code"><code>{example}</code></pre>
      </Sec>
      <Sec title="Endpoints">
        <ul class="list small">
          <li><code>GET /me</code> you, your crowns and Influence</li>
          <li><code>GET /state</code> the world as you see it. Add <code>?since=VERSION&amp;wait=25</code> to wait for the next change.</li>
          <li><code>GET /gazette?since=ID</code> the public record, newest first</li>
          <li><code>GET /commands</code> every action and its arguments (no key needed)</li>
          <li><code>GET /apps</code> the app directory (no key needed)</li>
          <li><code>POST /act</code> <code>{'{ cmd, args }'}</code> do something, with an act key</li>
          <li><code>GET|POST /hooks</code>, <code>/hooks/delete</code>, <code>/hooks/test</code> webhooks from your app</li>
        </ul>
        <p class="small muted">120 requests a minute per key. Errors come back as <code>{'{ error }'}</code> with a sentence you can show your users. Admin actions can't be done with a key. Anything your app puts in the Gazette is marked "via" its name.</p>
      </Sec>
      <Sec title="House rules">
        <ul class="list small">
          <li>Never ask other players for their password. Use "Sign in with the Realm" or ask them to make a key.</li>
          <li>Bots play by the same rules as people. Automating your own votes is fine; flooding isn't.</li>
          <li>The engine is open source: copy <code>engine/</code> from the repo to format times, names and money exactly like the official site.</li>
        </ul>
      </Sec>
    </Page>
  );
}

export function Apps() {
  useStore();
  const [list, setList] = useState<any[] | null>(null);
  useEffect(() => void (ONLINE ? appDirectory().then(setList).catch(err) : setList([])), []);
  return (
    <Page back={['#/realm', 'The realm']} kicker="Made by players" title="App directory" intro="Bots, dashboards and other frontends built by citizens. They can only see and do what you let them.">
      {list === null ? <Empty>Loading…</Empty> : list.length ? (
        <ul class="list">{list.map((a) => (
          <li class="row">
            <span style={{ minWidth: 0 }}><b>{a.name}</b> <span class="small muted">by {a.by} · {a.users} {a.users === 1 ? 'user' : 'users'}</span>
              {a.description && <div class="small">{a.description}</div>}</span>
            {a.homepage && <Btn small kind="ghost" href={a.homepage}>Open</Btn>}
          </li>
        ))}</ul>
      ) : <Empty>No apps yet. Be the first.</Empty>}
      <Sec><Btn href="#/developers" kind="ghost" small>Build your own app</Btn></Sec>
    </Page>
  );
}

// "Sign in with the Realm": <site>#/authorize?app=<client_id>&scope=read|act&state=<anything>
export function Authorize({ query }: { query: URLSearchParams }) {
  const { world: w, me } = useStore();
  const [app, setApp] = useState<any>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const id = query.get('app') || '';
  const scope = query.get('scope') === 'act' ? 'act' : 'read';
  const framed = window.top !== window.self; // never inside someone else's page: they could hide what you're agreeing to
  useEffect(() => void (framed ? setProblem('Open this page in its own tab to sign in.') : ONLINE ? appInfo(id).then(setApp).catch((e) => setProblem(e.message)) : setProblem('Sign-in works only on the live realm.')), [id]);
  const go = () => {
    setBusy(true);
    authorizeApp({ app: id, scope, state: query.get('state') || '', redirect: query.get('redirect') || undefined })
      .then((r) => location.assign(r.redirect))
      .catch((e) => (setBusy(false), setProblem(e.message)));
  };
  return (
    <div class="door" style={{ minHeight: '70dvh' }}>
      <div class="card door-card">
        <div style={{ textAlign: 'center' }}>
          <Seal size={60} />
          <div class="kicker" style={{ marginTop: 8 }}>Sign in with {w.config.realmName}</div>
          <h1 class="title" style={{ margin: '4px 0 0' }}>{app ? app.name : problem ? 'Can’t sign in' : '…'}</h1>
          {app && <p class="small muted" style={{ margin: '2px 0 0' }}>made by {app.by}</p>}
        </div>
        {problem && <p class="small bad">{problem}</p>}
        {app && (
          <>
            {app.description && <p style={{ margin: 0 }}>{app.description}</p>}
            <Card kind={scope === 'act' ? 'warn' : 'tint'}>
              <b>{app.name} wants to {scope === 'act' ? 'see and act as' : 'see the realm as'} {w.citizens[me].name}.</b>
              <ul class="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                <li>It sees what you see: your wallet, cards and deals included.</li>
                {scope === 'act' ? <li>It can vote, speak, spend and plot as you. Its actions are marked "via {app.name}".</li> : <li>It can't do anything as you.</li>}
                <li>It never sees your password. Revoke it any time under You → Build your own app.</li>
              </ul>
            </Card>
            <p class="small muted" style={{ margin: 0 }}>You'll be sent to <code style={{ wordBreak: 'break-all' }}>{app.redirect ? new URL(app.redirect).host : 'nowhere'}</code></p>
            <Btn full disabled={busy || !app.redirect} onClick={go}>{busy ? 'One moment…' : `Allow ${app.name}`}</Btn>
            <Btn full kind="plain" href="#/">Cancel</Btn>
          </>
        )}
      </div>
    </div>
  );
}
