// Build your own app: personal API keys and a quick reference. The full docs are API.md in the repo.
import { useEffect, useState } from 'preact/hooks';
import { useStore, ONLINE, API_URL, listKeys, createKey, revokeKey, toast } from '../store';
import { Page, Sec, Card, Btn, Field, Seg, Empty, When } from '../ui';

const DOCS = 'https://github.com/BigDreamerDev/democracy-sim/blob/main/API.md';

export function Developers() {
  useStore();
  const [keys, setKeys] = useState<any[] | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'act'>('read');
  const [fresh, setFresh] = useState('');
  const load = () => listKeys().then(setKeys).catch((e) => toast(e.message, true));
  useEffect(() => void (ONLINE && load()), []);
  const base = API_URL || 'https://your-realm.onrender.com';
  const example = `const KEY = 'rlm_…';
const realm = (path, body) => fetch('${base}/api/v1' + path, {
  method: body ? 'POST' : 'GET',
  headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: body && JSON.stringify(body)
}).then((r) => r.json());

const { world, me } = await realm('/state');
console.log(world.gazette[0].text);
await realm('/act', { cmd: 'q.back', args: { id: world.questions[0].id } });`;
  return (
    <Page back={['#/you', 'Passport']} kicker="For tinkerers" title="Build your own app" intro="Make a bot, a dashboard or a whole new frontend. Your app sees exactly what you see and can do exactly what you can do: nothing more.">
      {!ONLINE && <Card kind="warn">API keys exist only on the live realm, not in the demo.</Card>}
      {ONLINE && (
        <Sec title="Your API keys" sub="Treat a key like a password. Anyone holding an act key can play as you.">
          {fresh && (
            <Card kind="green" style={{ marginBottom: 12 }}><div class="stack">
              <b>Copy it now. It won't be shown again.</b>
              <code class="key" style={{ userSelect: 'all' }}>{fresh}</code>
              <Btn small kind="ghost" onClick={() => navigator.clipboard?.writeText(fresh).then(() => toast('Copied.'))}>Copy</Btn>
            </div></Card>
          )}
          {keys === null ? <Empty>Loading…</Empty> : keys.length ? (
            <ul class="list">{keys.map((k) => (
              <li class="row">
                <span><b>{k.name}</b> <span class="small muted tnum">{k.prefix}… · {k.scope === 'act' ? 'read and act' : 'read only'}</span>
                  <div class="small muted">{k.last_used ? <>Last used <When at={new Date(k.last_used).getTime()} /></> : 'Never used'}</div></span>
                <Btn small kind="danger ghost" onClick={() => revokeKey(k.id).then(() => (toast('Revoked.'), load())).catch((e) => toast(e.message, true))}>Revoke</Btn>
              </li>
            ))}</ul>
          ) : <Empty>No keys yet.</Empty>}
          <Card style={{ marginTop: 12 }}><div class="stack">
            <Field label="What app is it for?" value={name} onInput={setName} placeholder="e.g. WhatsApp bot" />
            <Seg value={scope} onChange={setScope} options={[['read', 'Read only'], ['act', 'Read and act']]} />
            <Btn full disabled={name.trim().length < 2} onClick={() => createKey(name, scope).then((k) => (setFresh(k.key), setName(''), load())).catch((e) => toast(e.message, true))}>Make a key</Btn>
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
          <li><code>POST /act</code> <code>{'{ cmd, args }'}</code> do something, with an act key</li>
        </ul>
        <p class="small muted">120 requests a minute per key. Errors come back as <code>{'{ error }'}</code> with a sentence you can show your users. Admin actions can't be done with a key.</p>
        <Btn href={DOCS} kind="ghost" small>Full API docs</Btn>
      </Sec>
      <Sec title="House rules">
        <ul class="list small">
          <li>Never ask other players for their password. Ask them to make a key for your app instead.</li>
          <li>Bots play by the same rules as people. Automating your own votes is fine; flooding isn't.</li>
          <li>The engine is open source: copy <code>engine/</code> from the repo to format times, names and money exactly like the official site.</li>
        </ul>
      </Sec>
    </Page>
  );
}
