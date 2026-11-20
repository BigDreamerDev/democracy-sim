// The Crown at home (engine/imperium.ts) and trials (engine/trials.ts): the Sovereign's desk on the Crown page, the
// proclamation and triumph banners on every page, the list of trials and a trial's own page (#/trial/<id>).
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Left, When, Empty, Field, Pick, LinkRow } from '../ui';
import { nm, isHOS } from '../../../engine/index';
import { lim } from '../../../engine/limits';
import { PROVINCES } from '../../../engine/foreign';
import { PEERAGE, peers, absolute, triumphDue, PROGRESS_EVERY, PROGRESS_COST, TRIUMPH_COST, LESE_EVERY } from '../../../engine/imperium';
import { canGovernEmpire } from '../../../engine/empire';
import { CHARGES } from '../../../engine/trials';

// on every page: the Sovereign's proclamation of the day, and a triumph in the streets
export function CrownBanners() {
  const { world: w, me } = useStore();
  const pr = w.crown?.proclamation;
  const t = w.triumph;
  const live = t && !t.done && t.until > w.now;
  const abroad = !!w.citizens[me]?.defected;
  return (
    <>
      {pr && pr.until > w.now && w.config.hos === 'monarchy' && (
        <div class="proclamation" role="status">
          <small>By order of {pr.title} {nm(w, pr.by)}</small>
          <b class="serif">“{pr.text}”</b>
        </div>
      )}
      {w.invasion && !abroad && (
        <div class="proclamation triumph" role="status">
          <small>Invasion warning</small>
          <b class="serif">{w.invasion.name}: the exiles are preparing to invade from {w.nations[w.invasion.nation]?.name}, {w.invasion.members.length} under arms.</b>
          <a class="small" href="#/abroad">What we know</a>
        </div>
      )}
      {live && (
        <div class="proclamation triumph" role="status">
          <small>A triumph · until <When at={t.until} /></small>
          <b class="serif">The Army marches through the capital after the victory over {w.nations[t.nation]?.name}{t.hero ? `, ${nm(w, t.hero)} at its head` : ''}.</b>
          <span class="row" style={{ gap: 8, justifyContent: 'flex-start' }}>
            <span class="small">{t.crowd.length} in the crowd</span>
            {!abroad && !t.crowd.includes(me) && <Btn small onClick={() => act('triumph.cheer', {}, 'You cheer them home.')}>Line the streets</Btn>}
          </span>
        </div>
      )}
    </>
  );
}

// the Sovereign's desk, on the Crown page
export function CrownDesk() {
  const { world: w, me } = useStore();
  const [words, setWords] = useState('');
  const [peer, setPeer] = useState({ target: '', rank: 'baron' });
  const [prov, setProv] = useState('');
  const [lese, setLese] = useState({ target: '', text: '' });
  if (w.config.hos !== 'monarchy') return null;
  const mine = isHOS(w, me) && !!w.crown?.reign?.crownedAt;
  const k = w.crown || {};
  const roll = peers(w).sort((a: any, b: any) => ['duke', 'earl', 'baron'].indexOf(a.peerage.rank) - ['duke', 'earl', 'baron'].indexOf(b.peerage.rank));
  const home = (Object.values(w.citizens) as any[]).filter((c) => c.active && !c.bot && !c.defected && c.id !== me);
  const provinces = Object.keys(w.provinces || {}).filter((id) => w.provinces[id].owner === 'realm');
  const victory = triumphDue(w);
  const canTriumph = victory && (mine || canGovernEmpire(w, me));
  const progIn = k.progressAt ? Math.max(0, k.progressAt + PROGRESS_EVERY - w.now) : 0;
  const leseIn = k.leseAt ? Math.max(0, k.leseAt + LESE_EVERY - w.now) : 0;
  return (
    <>
      <Sec title="The peerage" sub={`Peers of the realm, created by the Crown: up to ${lim(w, 'peers')}. Dukes draw 5 a week, Earls 3, Barons 2, and the peers stand by the Crown on a coup night.`}>
        {roll.length ? <ul class="list">{roll.map((c: any) => <li class="row"><span><b>{PEERAGE[c.peerage.rank].title}</b> <Who id={c.id} /><div class="small muted">Since <When at={c.peerage.at} /></div></span>{mine && <Btn small kind="danger ghost" onClick={() => confirm(`Strip ${c.name} of their title?`) && act('crown.attaint', { target: c.id }, 'Attainted.')}>Strip the title</Btn>}</li>)}</ul> : <Empty>No peers yet.</Empty>}
        {mine && <Card style={{ marginTop: 10 }}><div class="grid2"><Pick value={peer.target} onChange={(v) => setPeer({ ...peer, target: v })} empty="Whom?" options={home.map((c) => [c.id, c.name])} /><Pick value={peer.rank} onChange={(v) => setPeer({ ...peer, rank: v })} options={Object.entries(PEERAGE).map(([id, p]) => [id, p.title])} /></div><Btn small style={{ marginTop: 8 }} disabled={!peer.target} onClick={() => act('crown.ennoble', peer, 'Raised to the peerage.')}>Ennoble</Btn></Card>}
      </Sec>
      {mine && (
        <Sec title="The Sovereign's desk">
          <div class="grid2">
            <Card><b>Proclaim</b><p class="small">Once a day. Your words hang over every page for 24 hours.</p><Field label="Proclamation" value={words} onInput={(v) => setWords(v.slice(0, 240))} placeholder="Let it be known…" /><Btn small disabled={words.trim().length < 8 || (k.proclamation && w.now - k.proclamation.at < 86400000)} onClick={() => act('crown.proclaim', { text: words }, 'Proclaimed.') && setWords('')}>Proclaim it</Btn></Card>
            {provinces.length > 0 && <Card><b>A royal progress</b><p class="small">Tour a province: {PROGRESS_COST} from the Treasury. No unrest there for a week, stability +1, +2 approval. Every three days.</p><Pick value={prov} onChange={setProv} empty="Which province?" options={provinces.map((id) => [id, PROVINCES[id]?.name ?? id])} />{progIn ? <span class="small muted">Next <Left at={w.now + progIn} /></span> : null}<Btn small disabled={!prov || !!progIn} onClick={() => act('crown.progress', { province: prov }, 'The court sets out.')}>Set out</Btn></Card>}
            {absolute(w) && <Card kind="warn"><b>Lèse-majesté</b><p class="small">An absolute monarch may charge a citizen with insulting the Crown. They go on trial; guilty means {CHARGES.lese.days} days in the Realm Jail. An acquittal costs you 3 approval.</p><Pick value={lese.target} onChange={(v) => setLese({ ...lese, target: v })} empty="Whom?" options={home.map((c) => [c.id, c.name])} /><Field label="The charge" value={lese.text} onInput={(v) => setLese({ ...lese, text: v.slice(0, 200) })} placeholder="Mocked the Crown in the Gazette" />{leseIn ? <span class="small muted">Next charge <Left at={w.now + leseIn} /></span> : null}<Btn small kind="danger" disabled={!lese.target || lese.text.trim().length < 8 || !!leseIn} onClick={() => confirm('Bring the charge?') && act('crown.lese', lese, 'The charge is brought.') && setLese({ target: '', text: '' })}>Bring the charge</Btn></Card>}
          </div>
        </Sec>
      )}
      {canTriumph && <Sec title="A triumph"><Card kind="tint"><div class="row"><span class="small">Celebrate the victory over {w.nations[victory.nation]?.name}: the Army marches through the capital. {TRIUMPH_COST} crowns, stability +2, and a crowd for 12 hours.</span><Btn onClick={() => act('crown.triumph', {}, 'The triumph begins.')}>Hold a triumph</Btn></div></Card></Sec>}
    </>
  );
}

// the list of trials, on the Supreme Court page
export function TrialsList() {
  const { world: w } = useStore();
  const all = (Object.values(w.trials || {}) as any[]).sort((a, b) => b.at - a.at).slice(0, 12);
  return (
    <Sec title="Trials" sub="Defectors brought home are tried for treason; an absolute monarch may charge lèse-majesté. The justices sit in judgement, or a jury drawn by lot.">
      {all.length ? <ul class="list">{all.map((t) => <LinkRow href={'#/trial/' + t.id} title={<>{CHARGES[t.charge]?.name}: <Who id={t.who} /></>} sub={t.status === 'open' ? <>Verdict by <When at={t.closesAt} /></> : t.status === 'guilty' ? 'Guilty' : 'Acquitted'} />)}</ul> : <Empty>No trials.</Empty>}
    </Sec>
  );
}
export function TrialPage({ id }: { id: string }) {
  const { world: w, me } = useStore();
  const [words, setWords] = useState('');
  const t = w.trials?.[id];
  if (!t) return <Page back={['#/court', 'Supreme Court']} title="No such trial" />;
  const ch = CHARGES[t.charge];
  const judge = t.judges.includes(me);
  return (
    <Page back={['#/court', 'Supreme Court']} kicker={`${ch.name} · ${t.jury ? 'a jury drawn by lot' : 'before the Supreme Court'}`} title={<>The Realm v <Who id={t.who} /></>} intro={`${t.how ? t.how[0].toUpperCase() + t.how.slice(1) + '. ' : ''}${t.by ? `Brought by ${nm(w, t.by)}. ` : ''}Guilty means ${ch.days} days in the Realm Jail.`}>
      <Sec title={t.status === 'open' ? <>Verdict by <When at={t.closesAt} /></> : t.status === 'guilty' ? 'Guilty' : 'Not guilty'}>
        <Card><div class="stack">
          <span class="small">{t.jury ? 'The jury' : 'The justices'}: {t.judges.map((j: string) => nm(w, j)).join(', ')}. A majority decides; at the deadline, the votes cast decide, and a tie acquits.{t.status !== 'open' ? ` ${Object.values(t.votes).filter((v) => v === 'guilty').length} found guilty, ${Object.values(t.votes).filter((v) => v === 'innocent').length} not guilty.` : ''}</span>
          {judge && t.status === 'open' && <div class="grid2"><Btn kind={t.votes[me] === 'guilty' ? 'danger' : 'danger ghost'} onClick={() => act('trial.vote', { trial: t.id, verdict: 'guilty' }, 'Your verdict is in.')}>Guilty</Btn><Btn kind={t.votes[me] === 'innocent' ? undefined : 'ghost'} onClick={() => act('trial.vote', { trial: t.id, verdict: 'innocent' }, 'Your verdict is in.')}>Not guilty</Btn></div>}
          {judge && t.status === 'open' && t.votes[me] && <span class="small muted">You found them {t.votes[me] === 'guilty' ? 'guilty' : 'not guilty'}. You can change your mind until the verdict.</span>}
        </div></Card>
      </Sec>
      <Sec title="The defence">
        {t.defence ? <blockquote class="small">{t.defence}</blockquote> : <Empty>The accused has said nothing.</Empty>}
        {t.who === me && t.status === 'open' && <Card><Field label="Speak in your defence" area value={words} onInput={(v) => setWords(v.slice(0, 1000))} /><Btn small disabled={words.trim().length < 8} onClick={() => act('trial.defend', { trial: t.id, text: words }, 'The court has heard you.')}>Say it</Btn></Card>}
      </Sec>
    </Page>
  );
}
