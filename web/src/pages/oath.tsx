// The Imperial Oath: the words, who has sworn, and the prompt every citizen sees until they swear or refuse.
// Rules in engine/oath.ts.
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, When } from '../ui';
import { allCitizens } from '../../../engine/index';
import { oathWords, owesOath, refusedOath } from '../../../engine/oath';

function Roll() {
  const { world: w } = useStore();
  const o = w.oath;
  const people = allCitizens(w).filter((c: any) => !c.bot && c.id !== w.hos?.holder);
  const sworn = people.filter((c: any) => o.sworn[c.id]);
  const refused = people.filter((c: any) => refusedOath(w, c.id));
  const waiting = people.filter((c: any) => owesOath(w, c.id) && !o.refused[c.id]);
  const list = (xs: any[]) => (xs.length ? xs.map((c: any, i: number) => <>{i ? ', ' : ''}<Who id={c.id} /></>) : <span class="muted">nobody</span>);
  return (
    <div class="stack" style={{ gap: 6 }}>
      <div class="small"><b>Sworn ({sworn.length}):</b> {list(sworn)}</div>
      {!o.settled && <div class="small"><b>Yet to swear ({waiting.length}):</b> {list(waiting)}</div>}
      <div class="small"><b>Refused ({refused.length}):</b> {list(refused)}</div>
    </div>
  );
}

export function OathPanel() {
  const { world: w, me } = useStore();
  const o = w.oath;
  if (!o) return null;
  const owes = owesOath(w, me);
  return (
    <Sec title="The Imperial Oath" sub={o.settled ? 'The time for swearing is over. Those who refused may still swear.' : <>Every citizen must swear by <When at={o.dueAt} />. Until then they cannot vote in Council or hold office.</>}>
      <Card><div class="stack">
        <blockquote class="oath-words">{oathWords(w)}</blockquote>
        {me === w.hos?.holder ? <span class="small muted">The oath is sworn to you.</span>
          : !owes ? <span class="chip teal" style={{ alignSelf: 'flex-start' }}>You swore it <When at={o.sworn[me]} /></span>
          : <div class="row" style={{ gap: 8, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
              <Btn onClick={() => act('oath.swear', {}, 'You have sworn the Imperial Oath.')}>I swear it</Btn>
              {!o.refused[me] && <Btn kind="danger ghost" onClick={() => confirm('Refuse the Imperial Oath? You lose 3 approval and every office, Council seat and governorship you hold.') && act('oath.refuse', {}, 'You refused the oath.')}>I refuse</Btn>}
            </div>}
        <Roll />
      </div></Card>
    </Sec>
  );
}

export function OathPage() {
  const { world: w } = useStore();
  return (
    <Page back={['#/house', w.privy ? 'The Privy Council' : 'The House']} kicker={w.config.realmName} title="The Imperial Oath" intro="Allegiance to the Sovereign, sworn by every citizen of the empire.">
      {w.oath ? <OathPanel /> : <Sec><Card kind="dashed">There is no oath to swear: the Imperial Prerogative Act is not law.</Card></Sec>}
    </Page>
  );
}

// the prompt: a sealed page over the site until you swear or refuse ("Not now" hides it until you next open the site)
let later = false;
export function OathPrompt() {
  const { world: w, me } = useStore();
  const [hide, setHide] = useState(later);
  if (!w?.oath || hide || !owesOath(w, me) || w.oath.refused[me] || location.hash.startsWith('#/oath')) return null;
  return (
    <div class="oath-prompt" role="dialog" aria-label="The Imperial Oath">
      <div class="oath-sheet">
        <div class="oath-crest" aria-hidden="true">✠</div>
        <div class="oath-kicker">By Imperial command</div>
        <h2 class="oath-title">The Imperial Oath</h2>
        <blockquote class="oath-words">{oathWords(w)}</blockquote>
        <p class="small oath-note">Until you swear you cannot vote in Council, lay an Order or hold office. {w.oath.settled ? '' : <>Swear by <When at={w.oath.dueAt} />, or you will be taken to have refused.</>}</p>
        <div class="oath-actions">
          <Btn onClick={() => act('oath.swear', {}, 'You have sworn the Imperial Oath.')}>I swear it</Btn>
          <Btn kind="danger ghost" onClick={() => confirm('Refuse the Imperial Oath? You lose 3 approval and every office, Council seat and governorship you hold.') && act('oath.refuse', {}, 'You refused the oath.')}>I refuse</Btn>
          <button class="linkish small" onClick={() => ((later = true), setHide(true))}>Not now</button>
        </div>
      </div>
    </div>
  );
}
