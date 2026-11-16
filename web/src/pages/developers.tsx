// Players' apps: API keys, registering an app, webhooks, the app directory and the "Sign in with the Realm" consent screen.
// The full docs are API.md in the repo.
import { useEffect, useState } from 'preact/hooks';
import { useStore, ONLINE, API_URL, listKeys, createKey, revokeKey, myApps, makeApp, updateApp, deleteApp, appInfo, authorizeApp, appDirectory, listHooks, addHook, deleteHook, testHook, appDetails, reviewApp, unreviewApp, toast } from '../store';
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
  const [app, setApp] = useState({ name: '', description: '', homepage: '', redirect: '', scope: 'read' });
  const [hookUrl, setHookUrl] = useState('');
  const [hookKind, setHookKind] = useState<'gazette' | 'personal'>('gazette');
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
              <div class="row"><b>{a.name}</b><span class="small muted">{a.users} {a.users === 1 ? 'user' : 'users'} · asks to {a.scope === 'act' ? 'act' : 'read'}</span></div>
              {a.removed && <span class="small err-line"><b>Removed by the Returning Officer:</b> {a.removed}</span>}
              {a.description && <span class="small">{a.description}</span>}
              <div class="small muted">Client id <code>{a.client_id}</code></div>
              <div class="small muted">Redirect {a.redirect ? <code>{a.redirect}</code> : <i>none: sign-in is off</i>}</div>
              <div class="small muted">Sign-in link <code style={{ wordBreak: 'break-all' }}>{SITE()}#/authorize?app={a.client_id}&amp;scope={a.scope}&amp;state=…</code></div>
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
            <div class="small muted">It asks players for</div>
            <Seg value={app.scope} onChange={(v) => setApp({ ...app, scope: v })} options={[['read', 'Read only'], ['act', 'Read and act']]} />
            <Btn full disabled={app.name.trim().length < 2} onClick={() => makeApp(app).then(() => (toast('Registered.'), setApp({ name: '', description: '', homepage: '', redirect: '', scope: 'read' }), load())).catch(err)}>Register app</Btn>
          </div></Card>
        </Sec>
      )}

      {ONLINE && (
        <Sec title="Webhooks" sub="Gazette hooks get every new public entry. Personal hooks get your own alerts: a vote to cast, a deal offered, a demand made of you. Both are signed with your secret.">
          {secret && <Secret label="Your signing secret. It won't be shown again." value={secret} onDone={() => setSecret('')} />}
          {(hooks || []).length ? (
            <ul class="list">{hooks!.map((h) => (
              <li class="row">
                <span style={{ minWidth: 0 }}><span class="via" style={{ marginLeft: 0, marginRight: 6 }}>{h.kind === 'personal' ? 'personal' : 'gazette'}</span><code style={{ wordBreak: 'break-all' }}>{h.url}</code>
                  <div class="small muted">{h.disabled ? <b class="err-line">Switched off after 20 failures. Test it to switch it back on.</b> : h.last_at ? <>Last delivery <When at={t(h.last_at)} />: {h.last_status}</> : 'No deliveries yet'}</div></span>
                <span class="row" style={{ gap: 6 }}>
                  <Btn small kind="ghost" onClick={() => testHook(h.id).then((r) => (toast(r.ok ? 'Delivered.' : 'Failed: ' + r.status, !r.ok), load())).catch(err)}>Test</Btn>
                  <Btn small kind="danger ghost" onClick={() => deleteHook(h.id).then(load).catch(err)}>Delete</Btn>
                </span>
              </li>
            ))}</ul>
          ) : <Empty>No webhooks.</Empty>}
          <Card style={{ marginTop: 10 }}><div class="stack">
            <Seg value={hookKind} onChange={setHookKind} options={[['gazette', 'Gazette (public)'], ['personal', 'My alerts (private)']]} />
            {hookKind === 'personal' && <p class="small muted" style={{ margin: 0 }}>Only send these somewhere you control. They can mention your deals, demands and plot invitations.</p>}
            <Field label="https:// address" value={hookUrl} onInput={setHookUrl} placeholder="https://your-bot/realm" />
            <Btn full disabled={!hookUrl.startsWith('https://')} onClick={() => addHook(hookUrl, hookKind).then((h) => (setSecret(h.secret), setHookUrl(''), load())).catch(err)}>Add webhook</Btn>
          </div></Card>
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
          <li><code>GET /apps</code>, <code>/apps/:client_id</code> the directory and reviews (no key needed)</li>
          <li><code>GET /alerts</code> what needs you right now</li>
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
            <a href={'#/app/' + a.client_id} style={{ minWidth: 0, color: 'inherit', textDecoration: 'none' }}><b>{a.name}</b> <span class="small muted">by {a.by} · {a.users} {a.users === 1 ? 'user' : 'users'}{a.reviews ? <> · <Stars n={a.rating} /> ({a.reviews})</> : ''}</span>
              {a.description && <div class="small">{a.description}</div>}</a>
            <InstallBtn a={a} />
          </li>
        ))}</ul>
      ) : <Empty>No apps yet. Be the first.</Empty>}
      <Sec><Btn href="#/developers" kind="ghost" small>Build your own app</Btn></Sec>
    </Page>
  );
}

function Stars({ n }: { n: number }) {
  const r = Math.round(n || 0);
  return <span aria-label={`${n} out of 5`} class="stars">{'★'.repeat(r)}{'☆'.repeat(5 - r)}</span>;
}
function InstallBtn({ a }: { a: any }) {
  if (a.can_sign_in) return <Btn small href={`#/authorize?app=${encodeURIComponent(a.client_id)}&scope=${a.scope}`}>Use it</Btn>;
  if (a.homepage) return <Btn small kind="ghost" href={a.homepage}>Open</Btn>;
  return null;
}

export function AppPage({ id }: { id: string }) {
  useStore();
  const [a, setA] = useState<any>(null);
  const [missing, setMissing] = useState('');
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const load = () => appDetails(id).then(setA).catch((e) => setMissing(e.message));
  useEffect(() => void (ONLINE ? load() : setMissing('The directory exists only on the live realm.')), [id]);
  if (!a) return <Page back={['#/apps', 'Directory']} title={missing ? 'Not found' : '…'} intro={missing} />;
  return (
    <Page back={['#/apps', 'Directory']} kicker={`By ${a.by}`} title={a.name} intro={a.description} right={<InstallBtn a={a} />}>
      <Sec><p class="small muted" style={{ margin: 0 }}>{a.users} {a.users === 1 ? 'user' : 'users'} · asks to {a.scope === 'act' ? 'see and act as you' : 'see the realm as you'}{a.homepage && <> · <a href={a.homepage} target="_blank" rel="noopener">website</a></>}</p></Sec>
      <Sec title={a.reviews ? <>Reviews <Stars n={a.rating} /> <span class="small muted">{a.rating} from {a.reviews}</span></> : 'Reviews'}>
        {a.reviewList.length ? <ul class="list">{a.reviewList.map((r: any) => <li><Stars n={r.stars} /> <b>{r.by}</b>{r.text && <div class="small">{r.text}</div>}<div class="small muted"><When at={t(r.created_at)} /></div></li>)}</ul> : <Empty>No reviews yet.</Empty>}
        <Card style={{ marginTop: 12 }}><div class="stack">
          <b>Your review</b>
          <div class="seg" role="group">{[1, 2, 3, 4, 5].map((n) => <button type="button" class={stars >= n ? 'on' : ''} aria-label={`${n} stars`} onClick={() => setStars(n)}>★</button>)}</div>
          <Field label="What's it like? (optional)" value={text} onInput={setText} area />
          <div class="row" style={{ justifyContent: 'flex-start', gap: 8 }}>
            <Btn disabled={!stars} onClick={() => reviewApp(a.client_id, stars, text).then(() => (toast('Thanks. Posting again replaces your review.'), load())).catch(err)}>Post review</Btn>
            <Btn kind="plain" small onClick={() => unreviewApp(a.client_id).then(() => (toast('Removed your review.'), load())).catch(err)}>Remove mine</Btn>
          </div>
        </div></Card>
      </Sec>
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
  const asked = query.get('scope');
  const framed = window.top !== window.self; // never inside someone else's page: they could hide what you're agreeing to
  useEffect(() => void (framed ? setProblem('Open this page in its own tab to sign in.') : ONLINE ? appInfo(id).then(setApp).catch((e) => setProblem(e.message)) : setProblem('Sign-in works only on the live realm.')), [id]);
  const scope = (asked || app?.scope) === 'act' ? 'act' : 'read';
  const act = scope === 'act';
  const myName = w.citizens[me].name;
  // an app that can act as you is the same as handing someone your vote, so saying yes takes some doing:
  // every box ticked, your own name typed out, and a short wait before the button works
  const TICKS = act
    ? [`I am letting ${app?.by} read everything I can see and do anything I can do.`, `I know ${app?.by} could cast or change my secret ballots, and nobody would see it.`, 'I know this lasts until I revoke it. Changing my password does not stop it.']
    : [`I am letting ${app?.by} read everything I can see, secrets included.`];
  const [ticks, setTicks] = useState<boolean[]>([]);
  const [typed, setTyped] = useState('');
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (!app) return;
    setTicks([]);
    setTyped('');
    setWait(act ? 10 : 4);
    const iv = setInterval(() => setWait((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(iv);
  }, [app, act]);
  const same = (x: string, y: string) => x.replace(/\s+/g, ' ').trim().toLowerCase() === y.replace(/\s+/g, ' ').trim().toLowerCase();
  const ready = !!app?.redirect && TICKS.every((_, i) => ticks[i]) && (!act || same(typed, myName)) && wait === 0;
  const go = () => {
    if (!ready) return;
    setBusy(true);
    authorizeApp({ app: id, scope: scope, state: query.get('state') || '', redirect: query.get('redirect') || undefined })
      .then((r) => location.assign(r.redirect))
      .catch((e) => (setBusy(false), setProblem(e.message)));
  };
  return (
    <div class="door" style={{ minHeight: '70dvh' }}>
      <div class="card door-card">
        <div style={{ textAlign: 'center' }}>
          <Seal size={60} />
          <div class="kicker" style={{ marginTop: 8 }}>{app ? (act ? 'Hand over your account' : 'Share what you can see') : `Sign in with ${w.config.realmName}`}</div>
          <h1 class="title" style={{ margin: '4px 0 0' }}>{app ? (act ? `Let ${app.by} act as you?` : `Let ${app.by} see the realm as you?`) : problem ? 'Can’t sign in' : '…'}</h1>
          {app && <p class="small muted" style={{ margin: '2px 0 0' }}>through the app “{app.name}”, made by {app.by}</p>}
        </div>
        {problem && <p class="small bad">{problem}</p>}
        {app && (
          <>
            <Card kind={act ? 'warn' : 'tint'}>
              {act ? (
                <>
                  <b>This gives {app.by} a key to your account, {myName}. It is not limited to what the app says it does.</b>
                  <ul class="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                    <li><b>Your vote.</b> Cast or change your ballot in any election, and vote on every bill. Ballots are secret, so nobody sees an app did it.</li>
                    <li><b>Your money.</b> Send your crowns to anyone, bet them, spend them.</li>
                    <li><b>Your voice.</b> Speak, table bills, join or leave a party, resign your offices.</li>
                    <li><b>Your secrets.</b> Read your wallet, cards, deals and plots, and join or betray a plot as you.</li>
                  </ul>
                  <p class="small" style={{ margin: '8px 0 0' }}>It can’t see or change your password. It works until you revoke it under You → Build your own app.</p>
                </>
              ) : (
                <>
                  <b>This lets {app.by} read the realm exactly as you see it, {myName}.</b>
                  <ul class="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                    <li><b>It reads your secrets:</b> your wallet, cards, deals, plots and your own ballots.</li>
                    <li><b>It can’t do anything as you:</b> no voting, no spending, no speaking.</li>
                  </ul>
                  <p class="small" style={{ margin: '8px 0 0' }}>It can’t see your password. It works until you revoke it under You → Build your own app.</p>
                </>
              )}
            </Card>
            {app.description && <p class="small muted" style={{ margin: 0 }}>What {app.by} says about it: “{app.description}” The realm hasn’t checked this.</p>}
            {act && app.scope !== 'act' && <p class="small err-line" style={{ margin: 0 }}>This app is registered as read-only, but this link asks to act as you.</p>}
            <p class="small muted" style={{ margin: 0 }}>The key goes to <code style={{ wordBreak: 'break-all' }}>{app.redirect ? new URL(app.redirect).host : 'nowhere'}</code>, a site the realm doesn’t run.</p>
            <Btn full href="#/">No, take me back</Btn>
            <div class="consent">
              <b class="small">{act ? 'Still want to? Tick each line, then type your name.' : 'Still want to? Tick the line.'}</b>
              {TICKS.map((text, i) => (
                <label class="tick small"><input type="checkbox" checked={!!ticks[i]} onChange={(e: any) => setTicks(TICKS.map((_, j) => (j === i ? !!e.target.checked : !!ticks[j])))} /><span>{text}</span></label>
              ))}
              {act && <Field label={<span>Type your name, <b>{myName}</b>, to agree</span>} value={typed} onInput={setTyped} placeholder={myName} />}
              <Btn full kind={act ? 'danger' : 'ghost'} disabled={busy || !ready} onClick={go}>{busy ? 'One moment…' : wait > 0 ? `Read the above (${wait})` : act ? `Let ${app.by} act as me` : `Let ${app.by} see as me`}</Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
