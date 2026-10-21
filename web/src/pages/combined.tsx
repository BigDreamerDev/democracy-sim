// Sections that used to be several thin pages, now one full page each. The old addresses still work and scroll
// to their part: #/wallet opens Money at the wallet, #/cabinet opens Government at the cabinet, and so on.
import { useStore } from '../store';
import { Combined } from '../ui';
import { Cabinet, Offices, HOS } from './gov';
import { Wallet, Economy, Banks, Ventures } from './money';
import { Bets } from './market';
import { Foreign, Security, Army, Press, Court, Crises, Season } from './world';
import { Backroom, Plots, Exile } from './backroom';
import { Fame } from './glory';

export function Government({ focus }: { focus?: string }) {
  const { world: w } = useStore();
  return <Combined kicker="Who runs the realm" title="Government" intro={w.pm ? 'The Prime Minister and cabinet, every office created by law, and the head of state.' : 'There is no government yet. The head of state invites whoever can command the House.'} focus={focus} parts={[['cabinet', 'Cabinet', () => <Cabinet />], ['offices', 'Offices', () => <Offices />], ['hos', w.config.hos === 'monarchy' ? 'The Crown' : 'The President', () => <HOS />]]} />;
}
export function Money({ focus }: { focus?: string }) {
  return <Combined kicker="Crowns" title="Money" intro="Your wallet, the Treasury and the Reserve, banks, trade ventures abroad, and the betting pools." focus={focus} parts={[['wallet', 'Your wallet', () => <Wallet />], ['economy', 'Treasury and Reserve', () => <Economy />], ['banks', 'Banks', () => <Banks />], ['ventures', 'Ventures', () => <Ventures />], ['bets', 'Bets', () => <Bets />]]} />;
}
export function World({ focus }: { focus?: string }) {
  return <Combined kicker="Abroad" title="The world" intro="Five nations, the envoys and treaties that keep them sweet, the Army, and the Security Service." focus={focus} parts={[['foreign', 'Foreign Office', () => <Foreign />], ['army', 'The Army', () => <Army />], ['security', 'Security Service', () => <Security />]]} />;
}
export function Society({ focus }: { focus?: string }) {
  return <Combined kicker="Public life" title="Society" intro="The newspapers, the Supreme Court, and the crises that land on the government." focus={focus} parts={[['crises', 'Crises', () => <Crises />], ['press', 'The press', () => <Press />], ['court', 'Supreme Court', () => <Court />]]} />;
}
export function BackroomAll({ focus }: { focus?: string }) {
  return <Combined dark kicker="Only you can see this" title="The backroom" intro="Secrets, private deals, plots against the government, and where traitors end up." focus={focus} parts={[['backroom', 'Cards and deals', () => <Backroom />], ['plots', 'Plots', () => <Plots />], ['exile', 'Exile', () => <Exile />]]} />;
}
export function Honours({ focus }: { focus?: string }) {
  return <Combined kicker="Glory" title="Honours" intro="This season's leaderboard and awards, and the Hall of Fame across every season." focus={focus} parts={[['season', 'This season', () => <Season />], ['fame', 'Hall of Fame', () => <Fame />]]} />;
}
