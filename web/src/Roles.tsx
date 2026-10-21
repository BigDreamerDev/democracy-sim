// Your jobs, shown where you'll see them: chips under your name, a desk on Today, a notice the first time you get one.
import { useState } from 'preact/hooks';
import { useStore } from './store';
import { Card, Btn } from './ui';
import { rolesOf, newRoles, noteRoles, Role } from './roles';

export function RoleChips({ id, max, citizen }: { id?: string; max?: number; citizen?: boolean }) {
  const { world: w, me } = useStore();
  const who = id || me;
  const all = rolesOf(w, who).filter((r) => !r.key.startsWith('cand:') && r.key !== 'ro');
  const list = max ? all.slice(0, max) : all;
  if (!list.length) return citizen ? <div class="chips role-chips"><span class="chip">Citizen</span></div> : null;
  return (
    <div class="chips role-chips">
      {list.map((r) => <a href={r.href} class={'chip ' + r.tone}>{r.title}</a>)}
      {all.length > list.length && <span class="chip">+{all.length - list.length}</span>}
    </div>
  );
}

// everything you hold, what each lets you do, and the button to go and do it
export function YourDesk() {
  const { world: w, me } = useStore();
  const roles = rolesOf(w, me).filter((r) => r.key !== 'ro');
  return (
    <Card style={{ marginTop: 18 }}>
      <div class="row"><h2 class="h" style={{ margin: 0, fontSize: 21 }}>Your desk</h2><a class="small" href="#/you">Passport</a></div>
      {roles.length ? (
        <ul class="desk">
          {roles.map((r) => (
            <li>
              <a href={r.href} class="desk-row">
                <span class={'chip ' + r.tone}>{r.title}</span>
                {r.can.length > 0 && <span class="small muted">{r.can.join(' · ')}</span>}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p class="small muted" style={{ margin: '6px 0 0' }}>You hold no office yet. You can still vote in every election, join a <a href="#/parties">party</a> and stand for Parliament at the next <a href="#/elections">election</a>.</p>
      )}
    </Card>
  );
}

// the first time this device sees you with a new job
export function NewJob() {
  const { world: w, me } = useStore();
  const roles = rolesOf(w, me);
  const fresh = newRoles(roles, me);
  const [, bump] = useState(0);
  if (!fresh.length) {
    noteRoles(roles, me);
    return null;
  }
  const done = () => (noteRoles(roles, me), bump((n) => n + 1));
  return (
    <Card kind="green" style={{ marginTop: 16, gridColumn: '1 / -1' }}>
      {fresh.map((r: Role) => (
        <div style={{ marginBottom: 8 }}>
          <div class="small">New for you</div><b class="serif" style={{ fontSize: 20 }}>{r.title}</b>
          {r.can.length > 0 && <ul class="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{r.can.map((x) => <li>{x}</li>)}</ul>}
        </div>
      ))}
      <div class="row" style={{ justifyContent: 'flex-start', gap: 8 }}>
        <Btn small href={fresh[0].href} onClick={done}>Go to it</Btn>
        <Btn small kind="ghost" onClick={done}>Got it</Btn>
      </div>
    </Card>
  );
}
