// The store. Online (API_BASE set in docs/config.js): the server holds the world and sends this player their view of it.
// Demo (no API_BASE): the world lives in this browser and one person can play every role.
import { useEffect, useState } from 'preact/hooks';
import { createWorld, run, skip, nextDeadline, GameError, HOUR, DAY } from '../../engine/index';
import { botsAct } from '../../engine/bots';

const KEY = 'realm-demo-v2';
const API: string = ((window as any).API_BASE || '').replace(/\/$/, '');
export const ONLINE = !!API;
const TOKEN = 'realm-token';

type State = { world: any; me: string; autoBots: boolean; history: any[]; toast: { text: string; err: boolean } | null; tick: number; signedIn?: boolean; loading?: boolean; offline?: boolean };

function load(): State {
  if (ONLINE) return { world: null, me: '', autoBots: false, history: [], toast: null, tick: 0, signedIn: !!getToken(), loading: !!getToken() };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.world?.v === 2) return { world: s.world, me: s.me, autoBots: s.autoBots ?? true, history: [], toast: null, tick: 0 };
    }
  } catch {}
  return { world: createWorld('running'), me: 'uzair', autoBots: true, history: [], toast: null, tick: 0 };
}

let state: State = load();
const subs = new Set<() => void>();
let toastTimer: any;

function save() {
  if (ONLINE) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ world: state.world, me: state.me, autoBots: state.autoBots }));
  } catch {}
}
function set(patch: Partial<State>) {
  state = { ...state, ...patch, tick: state.tick + 1 };
  save();
  subs.forEach((f) => f());
}
function pushHistory() {
  state.history = [state.world, ...state.history].slice(0, 20);
}

export function toast(text: string, err = false) {
  clearTimeout(toastTimer);
  set({ toast: { text, err } });
  toastTimer = setTimeout(() => set({ toast: null }), err ? 4200 : 2200);
}

export function useStore() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return state;
}

// every player action goes through here
export function act(cmd: string, args: any = {}, done?: string): boolean {
  if (ONLINE) return actOnline(cmd, args, done);
  try {
    const w = run(state.world, state.me, cmd, args);
    pushHistory();
    set({ world: w });
    if (done) toast(done);
    return true;
  } catch (e: any) {
    if (e instanceof GameError) toast(e.message, true);
    else {
      console.error(e);
      toast('Something went wrong: ' + e.message, true);
    }
    return false;
  }
}

export function setMe(id: string) {
  set({ me: id });
}
export function setAutoBots(v: boolean) {
  set({ autoBots: v });
}

export function othersAct() {
  pushHistory();
  set({ world: botsAct(state.world, state.me) });
  toast('Everyone else has taken a turn.');
}

export function skipTime(ms: number) {
  pushHistory();
  let w = state.world;
  const topId = w.gazette[0]?.id;
  const step = 6 * HOUR;
  let left = ms;
  while (left > 0) {
    const d = Math.min(step, left);
    if (state.autoBots) w = botsAct(w, state.me, d / step);
    w = skip(w, d);
    left -= d;
  }
  set({ world: w });
  const fresh = [];
  for (const g of w.gazette) {
    if (g.id === topId) break;
    fresh.push(g);
  }
  if (fresh.length) toast(fresh.length === 1 ? fresh[0].text : `${fresh.length} things happened. Latest: ${fresh[0].text}`);
}

export function skipTo(at: number) {
  skipTime(Math.max(60_000, at - state.world.now + 60_000));
}
export function skipToNext() {
  const t = nextDeadline(state.world);
  if (!t) return toast('Nothing is scheduled.', true);
  skipTime(Math.max(60_000, t - state.world.now + 60_000));
}

export function reset(scenario: 'convention' | 'running') {
  pushHistory();
  set({ world: createWorld(scenario), me: 'uzair' });
  toast(scenario === 'convention' ? 'New realm: the Founding Convention is open.' : 'Loaded a realm 12 days into its first Parliament.');
}

export function undo() {
  const [prev, ...rest] = state.history;
  if (!prev) return toast('Nothing to undo.', true);
  state.history = rest;
  set({ world: prev });
  toast('Undone.');
}

export function unlockIntrigue() {
  const w = structuredClone(state.world);
  w.flags.intrigueNow = !w.flags.intrigueNow;
  set({ world: w });
  toast(w.flags.intrigueNow ? 'Intrigue unlocked for testing.' : 'Intrigue back on its normal schedule.');
}

export function exportWorld() {
  const blob = new Blob([JSON.stringify(state.world, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'realm-world.json';
  a.click();
}

export { HOUR, DAY };
export const getState = () => state;

// ---------------- online ----------------
function getToken() {
  try {
    return localStorage.getItem(TOKEN) || '';
  } catch {
    return '';
  }
}
function setToken(t: string) {
  try {
    t ? localStorage.setItem(TOKEN, t) : localStorage.removeItem(TOKEN);
  } catch {}
}
let skew = 0; // server clock minus this device's clock
async function api(path: string, body?: any) {
  let r: Response;
  try {
    r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    set({ offline: true });
    throw new Error('Cannot reach the server. It may be waking up; try again in a moment.');
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) {
    setToken('');
    set({ signedIn: false, world: null, loading: false });
  }
  if (!r.ok) throw new Error(data.error || 'The server said no (' + r.status + ').');
  if (state.offline) set({ offline: false });
  return data;
}
function receive(d: any) {
  if (d.serverNow) skew = d.serverNow - Date.now();
  if (d.world) set({ world: d.world, me: d.me, loading: false, signedIn: true });
}
export async function refresh() {
  if (!getToken()) return;
  try {
    receive(await api('/api/state'));
  } catch (e: any) {
    if (!state.world) set({ loading: false });
  }
}
let pending = 0;
function actOnline(cmd: string, args: any, done?: string): boolean {
  // show the result at once where this device can work it out, then take the server's word for it
  let ok = false;
  try {
    set({ world: run(state.world, state.me, cmd, args) });
    ok = true;
  } catch (e: any) {
    if (!(e instanceof GameError)) console.error(e);
  }
  pending++;
  api('/api/act', { cmd, args })
    .then((d) => {
      receive(d);
      if (done) toast(done);
    })
    .catch((e) => {
      toast(e.message, true);
      refresh();
    })
    .finally(() => pending--);
  return ok;
}
export async function signIn(username: string, password: string) {
  const d = await api('/api/login', { username, password });
  setToken(d.token);
  set({ signedIn: true, loading: true });
  await refresh();
}
export async function signUp(username: string, display_name: string, password: string) {
  const d = await api('/api/signup', { username, display_name, password });
  if (d.waiting) return 'waiting';
  setToken(d.token);
  set({ signedIn: true, loading: true });
  await refresh();
  return 'in';
}
export function signOut() {
  setToken('');
  set({ signedIn: false, world: null, me: '' });
}
export async function changePassword(current: string, next: string) {
  const d = await api('/api/password', { current, next });
  setToken(d.token);
}
export async function resetRealm(confirm: string) {
  receive(await api('/api/admin/reset', { confirm }));
}
export async function resetPassword(citizen: string): Promise<string> {
  const d = await api('/api/admin/password', { citizen });
  refresh();
  return d.temp;
}
export const API_URL = API;
export const listKeys = () => api('/api/keys');
export const createKey = (name: string, scope: 'read' | 'act') => api('/api/keys', { name, scope });
export const revokeKey = (id: number) => api('/api/keys/revoke', { id });
export const myApps = () => api('/api/apps');
export const makeApp = (a: any) => api('/api/apps', a);
export const updateApp = (a: any) => api('/api/apps/update', a);
export const deleteApp = (id: number) => api('/api/apps/delete', { id });
export const appInfo = (id: string) => api('/api/apps/info?app=' + encodeURIComponent(id));
export const authorizeApp = (b: any) => api('/api/authorize', b);
export const appDirectory = () => api('/api/v1/apps');
export const listHooks = () => api('/api/hooks');
export const addHook = (url: string, kind: 'gazette' | 'personal' = 'gazette') => api('/api/hooks', { url, kind });
export const appDetails = (id: string) => api('/api/v1/apps/' + encodeURIComponent(id));
export const reviewApp = (app: string, stars: number, text: string) => api('/api/apps/review', { app, stars, text });
export const unreviewApp = (app: string) => api('/api/apps/unreview', { app });
export const adminApps = () => api('/api/admin/apps');
export const removeApp = (app: string, reason: string) => api('/api/admin/apps/remove', { app, reason });
export const restoreApp = (app: string) => api('/api/admin/apps/restore', { app });
export const deleteHook = (id: number) => api('/api/hooks/delete', { id });
export const testHook = (id: number) => api('/api/hooks/test', { id });
export async function downloadExport() {
  const w = await api('/api/admin/export');
  const blob = new Blob([JSON.stringify(w, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'realm-full-export.json';
  a.click();
}
if (ONLINE) {
  refresh();
  // poll while the page is open; the local clock ticks between polls so countdowns move
  setInterval(() => !document.hidden && !pending && refresh(), 15_000);
  setInterval(() => state.world && !document.hidden && set({ world: { ...state.world, now: Math.max(state.world.now, Date.now() + skew) } }), 30_000);
  document.addEventListener('visibilitychange', () => !document.hidden && refresh());
}
