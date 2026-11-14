// Keeps every open copy of the site on the latest build. The service worker already serves the newest page on each load;
// this catches a tab left open: when you come back to it, and every few minutes, it asks Pages for the page and compares
// its built script with the one running. A new build reloads at once, unless you're typing, when it asks first.
import { useEffect, useState } from 'preact/hooks';
import { ONLINE } from './store';

const EVERY = 3 * 60 * 1000;
const running = (() => {
  const m = new URL(import.meta.url).pathname.match(/assets\/[^/]+\.js$/);
  return m ? m[0] : '';
})();
let ready = false;
const listeners = new Set<() => void>();

function typing() {
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.isContentEditable || ((a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && (a as HTMLInputElement).value))) return true;
  return Array.from(document.querySelectorAll("textarea")).some((t) => t.value.trim());
}

async function check() {
  if (!running || document.visibilityState !== 'visible') return;
  navigator.serviceWorker?.getRegistration().then((g) => g?.update()).catch(() => {});
  try {
    const res = await fetch('index.html?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const m = (await res.text()).match(/assets\/index-[^"']+\.js/);
    if (!m || m[0] === running) return;
    if (!typing()) return location.reload();
    if (!ready) (ready = true), listeners.forEach((f) => f());
  } catch {}
}

export function watchForUpdates() {
  if (!ONLINE || location.protocol !== 'https:') return;
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}));
  document.addEventListener('visibilitychange', check);
  addEventListener('focus', check);
  addEventListener('online', check);
  setInterval(check, EVERY);
}

export function UpdateBar() {
  const [on, setOn] = useState(ready);
  useEffect(() => {
    const f = () => setOn(true);
    listeners.add(f);
    return () => void listeners.delete(f);
  }, []);
  if (!on) return null;
  return (
    <div class="toast update" role="status">
      A new version of the site is out. <button class="update-go" onClick={() => location.reload()}>Reload</button>
    </div>
  );
}
