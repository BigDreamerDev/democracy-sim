// Keeps every open copy of the site on the latest build. The service worker already serves the newest page on each load;
// this catches a tab left open: when you come back to it, and every few minutes, it asks Pages for the page and compares
// its built script with the one running. A new build reloads at once, unless you're typing, when it asks first.
// After an update, what changed (web/src/changes.ts) is shown once.
import { useEffect, useState } from 'preact/hooks';
import { ONLINE } from './store';
import { CHANGES } from './changes';

const EVERY = 3 * 60 * 1000;
const running = (() => {
  const m = new URL(import.meta.url).pathname.match(/assets\/[^/]+\.js$/);
  return m ? m[0] : '';
})();
// the build id players can quote: the hash in the script's name
export const BUILD = running.match(/index-([^.]+)\.js$/)?.[1] || 'dev';
export const BUILT = __BUILT__;
let ready = false;
const listeners = new Set<() => void>();

function typing() {
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.isContentEditable || ((a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && (a as HTMLInputElement).value))) return true;
  return Array.from(document.querySelectorAll('textarea')).some((t) => t.value.trim());
}

// true when a newer build is out; reloads straight away unless you're typing (or `ask` says to leave it to you)
export async function checkNow(ask = false): Promise<boolean> {
  if (!running) return false;
  navigator.serviceWorker?.getRegistration().then((g) => g?.update()).catch(() => {});
  try {
    const res = await fetch('index.html?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return false;
    const m = (await res.text()).match(/assets\/index-[^"']+\.js/);
    if (!m || m[0] === running) return false;
    if (!ask && !typing()) location.reload();
    else if (!ready) (ready = true), listeners.forEach((f) => f());
    return true;
  } catch {
    return false;
  }
}
const check = () => void (document.visibilityState === 'visible' && checkNow());

export function watchForUpdates() {
  if (!ONLINE || location.protocol !== 'https:') return;
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}));
  document.addEventListener('visibilitychange', check);
  addEventListener('focus', check);
  addEventListener('online', check);
  setInterval(check, EVERY);
}

// the changes this browser hasn't been shown yet; a first visit sees none
function unseen() {
  const top = CHANGES[0]?.n || 0;
  try {
    const seen = Number(localStorage.getItem('realm-changes-seen') || 0);
    localStorage.setItem('realm-changes-seen', String(top));
    return seen ? CHANGES.filter((c) => c.n > seen).slice(0, 3) : [];
  } catch {
    return [];
  }
}

export function UpdateBar() {
  const [on, setOn] = useState(ready);
  const [news, setNews] = useState<{ n: number; text: string }[]>(() => (ONLINE ? unseen() : []));
  useEffect(() => {
    const f = () => setOn(true);
    listeners.add(f);
    return () => void listeners.delete(f);
  }, []);
  useEffect(() => {
    if (!news.length) return;
    const t = setTimeout(() => setNews([]), 15000);
    return () => clearTimeout(t);
  }, [news]);
  if (on) return (
    <div class="toast update" role="status">
      <span>A new version of the site is out.</span><button type="button" class="update-go" onClick={() => location.reload()}>Reload</button>
    </div>
  );
  if (!news.length) return null;
  return (
    <div class="toast update" role="status">
      <span><b>What’s new.</b> {news.map((c) => c.text).join(' ')}</span><button type="button" class="update-go" onClick={() => setNews([])}>OK</button>
    </div>
  );
}
