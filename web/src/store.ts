// The store. Online (API_BASE set in docs/config.js): the server holds the world and sends this player their view of it.
// Demo (no API_BASE): the world lives in this browser and one person can play every role.
import { useEffect, useState } from 'preact/hooks';
import { createWorld, run, skip, nextDeadline, GameError, HOUR, DAY } from '../../engine/index';
import { botsAct } from '../../engine/bots';

const KEY = 'realm-demo-v2';
const API: string = ((window as any).API_BASE || '').replace(/\/$/, '');
export const ONLINE = !!API;
const TOKEN = 'realm-token';

type State = { world: any; me: string; autoBots: boolean; history: any[]; toast: { text: string; err: boolean } | null; tick: number; signedIn?: boolean; loading?: boolean; offline?: boolean; oauthNote?: string };

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
// a random id for this browser, so the RO can spot two accounts made on one device. It identifies nothing else.
function deviceId() {
  try {
    let d = localStorage.getItem('realm-device');
    if (!d) localStorage.setItem('realm-device', (d = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')));
    return d;
  } catch {
    return '';
  }
}
async function api(path: string, body?: any) {
  let r: Response;
  try {
    r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Realm-Device': deviceId(), ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    set({ offline: true });
    throw new Error('Cannot reach the server. It may be waking up; try again in a moment.');
  }
  const data = await r.json().catch(() => ({}));
  // the server swaps in a fresh session token once yours is a week old
  const fresh = r.headers.get('X-Realm-Token');
  if (fresh && getToken()) setToken(fresh);
  if (r.status === 401 && getToken()) {
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
export async function signUp(username: string, display_name: string, password: string, extra: { who?: string; invite?: string } = {}) {
  const d = await api('/api/signup', { username, display_name, password, ...extra });
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
export async function resetRealm(confirm: string, clearFame = false) {
  receive(await api('/api/admin/reset', { confirm, ...(clearFame ? { fame: 'clear' } : {}) }));
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
// ---------- sign in with Discord, Google, Microsoft or Apple ----------
const OAUTH_KEY = 'realm-oauth-browser';
function browserNonce() {
  let n = '';
  try {
    n = sessionStorage.getItem(OAUTH_KEY) || '';
    if (!n) {
      const b = new Uint8Array(24);
      crypto.getRandomValues(b);
      n = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      sessionStorage.setItem(OAUTH_KEY, n);
    }
  } catch {}
  return n;
}
export const oauthProviders = (): Promise<{ id: string; name: string }[]> => (ONLINE ? api('/api/oauth/providers').catch(() => []) : Promise.resolve([]));
export async function beginOAuth(provider: string, mode: 'login' | 'link' = 'login') {
  const d = await api('/api/oauth/begin', { provider, mode, browser: browserNonce() });
  location.assign(d.url);
}
// back from the provider: #/oauth?flow=…(&error=…)
async function finishOAuth() {
  const m = location.hash.match(/^#\/oauth\?(.*)$/);
  if (!m) return false;
  const qs = new URLSearchParams(m[1]);
  history.replaceState(null, '', location.pathname + location.search + '#/');
  const err = qs.get('error');
  try {
    const d = await api('/api/oauth/finish', { flow: qs.get('flow'), browser: browserNonce() });
    if (d.token) {
      setToken(d.token);
      set({ signedIn: true, loading: true });
      await refresh();
    } else if (d.linked) {
      await refresh();
      location.hash = '#/you';
      setTimeout(() => toast(`Linked. You can now sign in with ${d.linked[0].toUpperCase() + d.linked.slice(1)}.`), 300);
    } else if (d.waiting) set({ loading: false, oauthNote: 'Your account is made. The Returning Officer will approve it soon; then sign in the same way.' });
  } catch (e: any) {
    set({ loading: false, oauthNote: err || e.message });
    if (getToken()) refresh();
  }
  return true;
}
export const securityInfo = () => api('/api/me/security');
// ---------- passkeys (WebAuthn): the server sends JSON options, the browser wants bytes ----------
const toBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const fromBytes = (b: ArrayBuffer | null) => (b ? btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : undefined);
export const passkeysWork = () => ONLINE && typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
function credentialJSON(c: any) {
  const r = c.response;
  return {
    id: c.id,
    rawId: fromBytes(c.rawId),
    type: c.type,
    authenticatorAttachment: c.authenticatorAttachment || undefined,
    clientExtensionResults: c.getClientExtensionResults?.() || {},
    response: {
      clientDataJSON: fromBytes(r.clientDataJSON),
      ...(r.attestationObject ? { attestationObject: fromBytes(r.attestationObject), transports: r.getTransports?.() || [] } : {}),
      ...(r.authenticatorData ? { authenticatorData: fromBytes(r.authenticatorData), signature: fromBytes(r.signature), userHandle: fromBytes(r.userHandle) } : {}),
    },
  };
}
// a cancelled prompt is not an error worth shouting about
const ceremony = async <T,>(p: Promise<T>) => {
  try {
    return await p;
  } catch (e: any) {
    if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') throw new Error('Passkey cancelled.');
    if (e?.name === 'InvalidStateError') throw new Error('This device already has a passkey for your account.');
    throw new Error('Your device could not use a passkey: ' + (e?.message || e));
  }
};
function deviceName() {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Passkey';
}
export async function addPasskey() {
  const { flow, options: o } = await api('/api/passkeys/register/begin', {});
  const publicKey: any = { ...o, challenge: toBytes(o.challenge), user: { ...o.user, id: toBytes(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map((c: any) => ({ ...c, id: toBytes(c.id) })) };
  const c = await ceremony(navigator.credentials.create({ publicKey }));
  await api('/api/passkeys/register/finish', { flow, response: credentialJSON(c), name: deviceName() });
}
export async function signInWithPasskey() {
  const { flow, options: o } = await api('/api/passkeys/login/begin', {});
  const publicKey: any = { ...o, challenge: toBytes(o.challenge), allowCredentials: (o.allowCredentials || []).map((c: any) => ({ ...c, id: toBytes(c.id) })) };
  const c = await ceremony(navigator.credentials.get({ publicKey }));
  const d = await api('/api/passkeys/login/finish', { flow, response: credentialJSON(c) });
  setToken(d.token);
  set({ signedIn: true, loading: true });
  await refresh();
}
export const removePasskey = (id: string) => api('/api/passkeys/remove', { id });
export const renamePasskey = (id: string, name: string) => api('/api/passkeys/rename', { id, name });
export const unlinkProvider = (provider: string) => api('/api/oauth/unlink', { provider });
export async function signOutEverywhere() {
  const d = await api('/api/logout-all', {});
  setToken(d.token);
}

if (ONLINE) {
  finishOAuth().then((handled) => !handled && refresh());
  // poll while the page is open; the local clock ticks between polls so countdowns move
  setInterval(() => !document.hidden && !pending && refresh(), 15_000);
  setInterval(() => state.world && !document.hidden && set({ world: { ...state.world, now: Math.max(state.world.now, Date.now() + skew) } }), 30_000);
  document.addEventListener('visibilitychange', () => !document.hidden && refresh());
}

// ---------- photos: shrunk to a small JPEG here (which also drops any location data), then uploaded ----------
const DEMO_PHOTOS = 'realm-demo-photos';
const demoPhotos = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(DEMO_PHOTOS) || '{}');
  } catch {
    return {};
  }
};
async function shrink(file: File): Promise<string> {
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) throw new Error('That file isn’t a photo this browser can read.');
  for (const [max, q] of [[1024, 0.78], [800, 0.7], [640, 0.62], [480, 0.55]] as const) {
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', q);
    if (url.length * 0.75 < 135_000) return url;
  }
  throw new Error('That photo is too detailed to shrink. Try another.');
}
export async function uploadPhoto(file: File): Promise<string> {
  const url = await shrink(file);
  if (ONLINE) return (await api('/api/images', { data: url })).id;
  // the demo keeps photos in this browser; only a few fit
  const all = demoPhotos();
  const keys = Object.keys(all);
  if (keys.length >= 12) delete all[keys[0]];
  const id = 'im' + Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  all[id] = url;
  try {
    localStorage.setItem(DEMO_PHOTOS, JSON.stringify(all));
  } catch {
    throw new Error('This browser is out of room for demo photos.');
  }
  return id;
}
export const photoUrl = (id: string) => (ONLINE ? `${API}/api/images/${id}` : demoPhotos()[id] || '');
export const removePhoto = (id: string, reason: string) => api('/api/admin/images/remove', { id, reason });
export const deletePhoto = (id: string) => api('/api/images/delete', { id });
export const myPhotos = () => api('/api/images');

// ---------- invitations and duplicate accounts ----------
export const checkInvite = (code: string) => api('/api/invites/check?code=' + encodeURIComponent(code));
export const adminInvites = () => api('/api/admin/invites');
export const makeInvite = (name: string) => api('/api/admin/invites', { name });
export const revokeInvite = (id: number) => api('/api/admin/invites/revoke', { id });
export const inviteLink = (code: string) => location.origin + location.pathname + '#/join/' + code;
// online it also switches the duplicate's login off, so it goes through its own route
export async function removeDuplicate(dup: string, keep: string) {
  if (!ONLINE) return act('admin.duplicate', { dup, keep }, 'Removed. It is in the Gazette.');
  receive(await api('/api/admin/duplicate', { dup, keep }));
  toast('Removed. It is in the Gazette.');
  return true;
}
export const makeInvites = (names: string[]) => api('/api/admin/invites', { names });
export const myInvites = () => api('/api/invites');
export const sendInvite = (name: string) => api('/api/invites', { name });
export const adminAllowances = () => api('/api/admin/allowances');
export const setAllowance = (citizen: string, n: number) => api('/api/admin/invites/allow', { citizen, n });
export const adminNotes = () => api('/api/admin/notes');
export const saveNote = (citizen: string, text: string) => api('/api/admin/notes', { citizen, text });
export const adminDevices = () => api('/api/admin/devices');
// development: see the realm as a monarchy (King or Queen) or a republic, to check wording that depends on it.
// It changes only this browser's copy; online, the next refresh from the server puts it back.
export function previewGovernment(kind: 'queen' | 'king' | 'president') {
  const w = structuredClone(state.world);
  w.config.hos = kind === 'president' ? 'republic' : 'monarchy';
  if (kind !== 'president') w.config.hosTitle = kind === 'king' ? 'King' : 'Queen';
  set({ world: w });
  toast(kind === 'president' ? 'Showing the realm as a republic.' : `Showing the realm with a ${w.config.hosTitle}.`);
}
