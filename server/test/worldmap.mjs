/* The world map — real coastlines, invented countries.

   The map answers two questions and nothing else: what standing is this power
   on, and does the Republic recognise it. The assertions here are about the
   things a map can quietly get wrong:

     - two powers cannot hold the same ground;
     - only the Returning Officer draws borders, and no officer may;
     - recognition on the map is the recognition the House voted, not a flag
       somebody set by hand;
     - a revoked power's territory does not linger on the map;
     - the map is public, because a secret map is not a map. */

import { call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 8 });
const T = w.admin.token;
const map = t => call('/api/diplomacy/map', { token: t }).then(r => r.d);
const setTerritory = (id, codes, token = T) =>
  call(`/api/admin/foreign/powers/${id}/territories`, { method: 'PUT', body: { codes }, token });

await call('/api/admin/config', { method: 'PUT', body: { diplomacy_enabled: 'true' }, token: T });

const valtia = (await call('/api/admin/foreign/powers', { method: 'POST', body: { name: 'Valtia', adjective: 'Valtish', standing: 'neutral' }, token: T })).d;
const korrin = (await call('/api/admin/foreign/powers', { method: 'POST', body: { name: 'Korrin', adjective: 'Korrine', standing: 'hostile' }, token: T })).d;
const vId = valtia.id || valtia.power?.id;
const kId = korrin.id || korrin.power?.id;

console.log('-- an empty world');

let m = await map();
ok(m.powers.length === 2, 'both powers are on the map');
ok(m.claimed === 0, 'and neither holds any ground yet');
ok(m.powers.every(p => Array.isArray(p.territories)), 'territories come back as a list, not null');

console.log('\n-- claiming');

ok((await setTerritory(vId, ['124', '840'])).status === 200, 'the Returning Officer gives Valtia two territories');
m = await map();
ok(m.claimed === 2, 'the world records two claims');
ok(m.powers.find(p => p.id === vId).territories.join(',') === '124,840', 'and they belong to Valtia');

console.log('\n-- no two powers on the same ground');

const clash = await setTerritory(kId, ['840', '076']);
ok(clash.status === 409, 'a territory another power holds is refused, not silently transferred');
ok(/840/.test(clash.d.error || ''), 'and the refusal names the ground in dispute');
ok((await map()).claimed === 2, 'nothing moved');

ok((await setTerritory(vId, ['124'])).status === 200, 'Valtia releases one');
ok((await setTerritory(kId, ['840', '076'])).status === 200, 'and then Korrin may take it');
m = await map();
ok(m.claimed === 3, 'three territories are held in all');
ok(m.powers.find(p => p.id === kId).territories.includes('840'), 'the transfer took two deliberate acts');

console.log('\n-- who may draw a border');

for (const [who, tok] of [['the President', w.pres], ['the Speaker', w.spk], ['a citizen', w.plainTok]]) {
  ok((await setTerritory(kId, ['250'], tok)).status === 403, `${who} cannot hand out territory`);
}
ok((await map()).claimed === 3, 'and the world is unchanged by the attempts');

console.log('\n-- standing and recognition are what the map shows');

const v = (await map()).powers.find(p => p.id === vId);
ok(v.standing === 'neutral' && !v.recognised, 'a new power is neutral and unrecognised');
ok(!!(await map()).powers.find(p => p.id === kId).colour, 'every power carries a colour for its own card');

/* Recognition is a bill. The map must reflect the vote, not an admin toggle —
   that is the whole reason it is worth drawing. */
const bill = (await call(`/api/diplomacy/powers/${vId}/recognition`, { method: 'POST', body: { body: 'That Valtia be recognised.' }, token: w.T[0] })).d;
ok(!!bill.id, 'a citizen of the House moves recognition as a bill');
ok((await map()).powers.find(p => p.id === vId).recognised === false, 'and the map still says unrecognised while it is only a bill');

console.log('\n-- the map is public');

ok((await call('/api/diplomacy/map')).status === 200, 'a signed-out visitor can see the world');

console.log('\n-- revoking');

await call(`/api/admin/foreign/powers/${kId}/revoke`, { method: 'POST', token: T });
m = await map();
ok(!m.powers.find(p => p.id === kId), 'a revoked power leaves the map');
ok(m.claimed === 1, "and takes its territory with it — no ghost borders");

report();
