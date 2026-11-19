// The ceremonies: every scene the realm can play, to watch again, and the switch for whether they play by themselves.
import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../store';
import { Page, Sec, Card, Btn } from '../ui';
import { playCeremony, fxOff, setFxOff, scene } from '../Ceremony';

// a sample of each, filled with people from this realm
export function samples(w: any) {
  const ids = Object.keys(w.citizens).filter((id) => !w.citizens[id].bot);
  const a = w.hos?.holder || ids[0], b = ids[1] || a, c = ids[2] || a, d = ids[3] || a;
  const enemy = (Object.values(w.nations) as any[])[1]?.name || 'Kessmark';
  return [
    { k: 'empire', who: a, title: w.config.hosTitle || 'Empress', place: w.config.realmName },
    { k: 'council', who: a },
    { k: 'sworn', who: b, by: a },
    { k: 'appoint', who: c, by: a, office: 'highcommission', title: 'Imperial High Commissioner' },
    { k: 'appoint', who: d, by: a, office: 'chamberlain', title: 'Lord Chamberlain' },
    { k: 'appoint', who: b, by: a, office: 'privyseal', title: 'Lord Privy Seal' },
    { k: 'appoint', who: d, by: a, office: 'army', title: 'General' },
    { k: 'summon', by: d, title: 'The Imperial Roads Order' },
    { k: 'seal', by: b, title: 'The Imperial Roads Order' },
    { k: 'force', by: a, title: 'The War Powers Order', role: `the ${w.config.hosTitle || 'Sovereign'}` },
    { k: 'veto', by: d, title: 'The Council Stipends Order', role: 'the Lord Chamberlain' },
    { k: 'governor', who: c, by: a, place: 'The Kess Valley' },
    { k: 'gdecree', who: c, place: 'The Kess Valley', title: 'Raise a militia' },
    { k: 'levy', by: c, place: 'The Westwold' },
    { k: 'protectorate', by: c, place: 'Sundmere' },
    { k: 'invade', place: enemy },
    { k: 'invaded', place: 'Drakmoor' },
    { k: 'orders', title: 'advance', place: enemy },
    { k: 'march', place: 'The North Fells' },
    { k: 'raise', n: 2 },
    { k: 'battle', won: true, place: 'the river crossings', score: 34 },
    { k: 'battle', won: false, place: 'the northern passes', score: -12 },
    { k: 'procure', item: 'artillery', title: 'Artillery battery', by: c },
    { k: 'procure', item: 'ironclad', title: 'Ironclad', by: c },
    { k: 'procure', item: 'airship', title: 'Airship', by: c },
    { k: 'procure', item: 'fort', title: 'Fort', place: 'The Kess Valley', by: c },
    { k: 'acquire', title: 'Ironfoot Armaments', by: c },
    { k: 'production', title: 'Northgate Rail', by: c },
    { k: 'victory', place: enemy, who: d },
    { k: 'defeat', place: 'Drakmoor' },
    { k: 'memorial', place: enemy }
  ];
}

export function Ceremonies({ query }: { query: URLSearchParams }) {
  const { world: w } = useStore();
  const [off, setOff] = useState(fxOff());
  const list = samples(w);
  useEffect(() => { if (query.get('all')) list.forEach(playCeremony); }, []);
  return (
    <Page back={['#/learn', 'How to play']} kicker="The great moments" title="Ceremonies" intro="Appointments, decrees, vetoes, invasions and victories are played as short scenes, the first time you open the site after they happen. Tap a scene to go on.">
      <Sec>
        <Card><div class="row"><span><b>Play them as they happen</b><div class="small muted">On this device.</div></span><Btn small kind={off ? undefined : 'ghost'} onClick={() => (setFxOff(!off), setOff(!off))}>{off ? 'Turn on' : 'Turn off'}</Btn></div></Card>
      </Sec>
      <Sec title="Watch them again">
        <Btn full onClick={() => list.forEach(playCeremony)}>Play them all</Btn>
        <div class="cer-gallery" style={{ marginTop: 10 }}>{list.map((fx) => { const s = scene(w, fx); return <Btn small kind="plain" onClick={() => playCeremony(fx)}>{s.kicker}: {s.name}</Btn>; })}</div>
      </Sec>
    </Page>
  );
}
