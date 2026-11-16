// The coronation film (coronation.html, a self-contained page in a frame so its styles and sound stay its own),
// shown once to each player after a monarch is crowned, and again from the Crown page.
import { useEffect, useState } from 'preact/hooks';
import film from './coronation.html?raw';
import { useStore } from './store';
import { DAY, fmtDay, inForce } from '../../engine/index';

const KEY = 'realm-coronation-seen';
export const watchCoronation = () => window.dispatchEvent(new Event('realm-coronation'));

export function Coronation() {
  const { world: w, me } = useStore();
  const r = w?.crown?.reign;
  const [open, setOpen] = useState(false);
  const stamp = r?.crownedAt ? `${me}:${r.crownedAt}` : '';
  useEffect(() => {
    if (!stamp || !r) return;
    let seen = '';
    try { seen = localStorage.getItem(KEY) || ''; } catch {}
    if (seen !== stamp && w.now - r.crownedAt < 7 * DAY) setOpen(true);
  }, [stamp]);
  useEffect(() => {
    const show = () => setOpen(true);
    const done = (e: MessageEvent) => e.data === 'coronation:done' && close();
    window.addEventListener('realm-coronation', show);
    window.addEventListener('message', done);
    return () => (window.removeEventListener('realm-coronation', show), window.removeEventListener('message', done));
  }, [stamp]);
  function close() {
    try { localStorage.setItem(KEY, stamp); } catch {}
    setOpen(false);
  }
  if (!open || !r?.crownedAt) return null;
  const realm = String(w.config.realmName || 'The Realm');
  const q = new URLSearchParams({ name: r.name, numeral: r.numeral, title: w.config.hosTitle, realm, place: realm.includes(' of ') ? realm.split(' of ').slice(1).join(' of ') : realm.replace(/^The /, 'the '), date: fmtDay(r.crownedAt), pm: inForce(w, 'crown') ? '1' : '0' });
  return (
    <div class="coro" role="dialog" aria-label="The coronation">
      <iframe title="The coronation" name={q.toString()} srcdoc={film} allow="autoplay" />
      <button class="coro-x" onClick={close}>Skip</button>
    </div>
  );
}
