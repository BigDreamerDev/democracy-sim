/* A generated world: unclaimed ground turned into plausible neighbours.

   Three things have to hold for this to be trustworthy rather than a toy:

     - it never goes live unseen — generating only ever produces a PREVIEW,
       and nothing exists in the world until an admin commits it;
     - the flood-fill is bounded no matter how it is asked to fail — too many
       powers for the unclaimed land, or a budget no remaining ground could
       satisfy, must come back as a clean answer, never a hang;
     - a generated power arrives unrecognised, like any other first contact,
       and nothing it produces — preview or committed — carries a real place
       name or an ISO code. */

import { readFileSync } from 'node:fs';
import { B, call, ok, report, setup } from './world.mjs';

const w = await setup({ citizens: 7 });
const T = w.admin.token;
const plain = w.plainTok;

await call('/api/admin/config', { method: 'PUT', body: { diplomacy_enabled: 'true' }, token: T });

const NAMES = JSON.parse(readFileSync(new URL('../subdivisions.json', import.meta.url)));
const realNames = [];
const realIso = [];
for (const list of Object.values(NAMES)) {
  for (const s of list) {
    if (s.name && s.name.length > 4) realNames.push(s.name);
    if (/^[A-Z]{2}-/.test(s.code || '')) realIso.push(s.code);
  }
}
const leaks = text => {
  const hay = String(text);
  const name = realNames.find(n => hay.includes(n));
  if (name) return `real place name "${name}"`;
  const iso = realIso.find(c => hay.includes(c));
  if (iso) return `ISO code "${iso}"`;
  return null;
};

const generate = (body, token = T) => call('/api/world/generate', { method: 'POST', body, token });

console.log('-- who may generate a world');

for (const [who, tok] of [['a citizen', plain], ['the President', w.pres], ['the Speaker', w.spk]]) {
  ok((await generate({ powers: 3, seed: 'nope', republic_strength: 40 }, tok)).status === 403, `${who} may not generate a world`);
}
const anonGen = await generate({}, null);
ok(anonGen.status === 401 || anonGen.status === 403, `nor may a signed-out visitor (${anonGen.status})`);

console.log('\n-- fewer unclaimed pieces than powers asked for is a clean refusal, never a hang');

/* Claim the entire atlas for the Republic — every territory the build knows
   about — so the unclaimed pool is provably empty, then ask for one power.
   The whole-country route replaces the Republic's holdings wholesale, so an
   empty PUT afterwards hands every subdivision straight back for the rest of
   this suite. This is the one scenario the flood-fill's termination guard
   exists for: a request that cannot be satisfied by any remaining land at
   all, checked before a single capital is even seeded. */
const atlasIndex = JSON.parse(readFileSync(new URL('../../docs/subdiv/index.json', import.meta.url)));
const everyTerritory = Object.keys(atlasIndex.territories);
ok((await call('/api/admin/republic/territories', { method: 'PUT', body: { codes: everyTerritory }, token: T })).status === 200,
  `the Returning Officer claims all ${everyTerritory.length} territories for the Republic`);

const starved = await generate({ powers: 1, seed: 'starved', republic_strength: 40 });
ok(starved.status === 409, `nothing unclaimed remains, so even one power is refused (${starved.status})`);
ok(/unclaimed/i.test(starved.d.error || ''), 'and the refusal says why in plain terms');

ok((await call('/api/admin/republic/territories', { method: 'PUT', body: { codes: [] }, token: T })).status === 200,
  'releasing it all again hands the whole map back to the unclaimed pool');

console.log('\n-- a first preview');

const first = await generate({ powers: 5, seed: 'republic-test-1', republic_strength: 40 });
ok(first.status === 200, `generation succeeds (${first.status}: ${JSON.stringify(first.d).slice(0, 200)})`);
ok(first.d.status === 'preview', 'a fresh generation is a preview, not a live world');
ok(Array.isArray(first.d.nations) && first.d.nations.length === 5, `asked for 5 powers, got ${first.d.nations?.length}`);
ok(!!first.d.preview_svg, 'a preview SVG URL is offered before anything is committed');
ok(/bill/i.test(first.d.recognition) || /recognis/i.test(first.d.recognition),
  'the response says plainly that recognition is a bill, not a default');
for (const n of first.d.nations) {
  ok(n.capital && n.subdivisions.includes(n.capital), `${n.name}'s capital is inside its own territory`);
  ok(n.subdivisions.length === n.subdivision_count, `${n.name}'s cell count matches its cell list`);
  ok(typeof n.strength === 'number' && n.strength >= 1, `${n.name} has a positive strength (${n.strength})`);
  ok(typeof n.target_multiple === 'number' && n.target_multiple > 0, `${n.name} has a target multiple`);
}

console.log('\n-- strength is read from war.js, not invented, and stated as such');

ok(first.d.republic_strength === 40, 'the override we sent is the number the world was measured against');
ok(/given by the Returning Officer/.test(first.d.republic_strength_source),
  'and the response says where that number came from');

console.log('\n-- nothing here says a real place, in the plan or the preview image');

ok(!leaks(JSON.stringify(first.d.nations)), 'the nation list is opaque');
const previewSvg = await (await fetch(B + first.d.preview_svg, { headers: { Authorization: 'Bearer ' + T } })).text();
ok(previewSvg.startsWith('<svg'), 'the preview route answers an SVG document');
ok(!leaks(previewSvg), 'and the image itself is opaque too');
ok(!/\sid\s*=/.test(previewSvg), 'no id attribute in the preview either');
for (const n of first.d.nations) {
  ok(previewSvg.includes(n.name), `${n.name} is labelled on the preview by its invented name`);
}

console.log('\n-- determinism: the same seed regenerated (nothing committed yet) is the same world');

const repeat = await generate({ powers: 5, seed: 'republic-test-1', republic_strength: 40 });
ok(repeat.status === 200, 'regenerating succeeds');
ok(JSON.stringify(repeat.d.nations) === JSON.stringify(first.d.nations),
  'byte-identical nations from the same seed and the same unclaimed pool');
ok(repeat.d.seed === first.d.seed, 'and the seed itself is unchanged when one is supplied');

console.log('\n-- the largest request the route allows is still satisfiable on a full map, and still fast');

const tooMany = await generate({ powers: 24, seed: 'greedy', republic_strength: 40, reach: 400, fill_share: 0.95 });
ok(tooMany.status === 200, `24 powers on an almost-untouched 2,700-cell world succeeds (${tooMany.status})`);
ok(tooMany.d.nations?.length === 24, 'and every one of them was seated');

console.log('\n-- a budget the remaining land cannot possibly satisfy is reported, not looped on or crashed');

const impossible = await generate({ powers: 3, seed: 'greedy-2', republic_strength: 999999999 });
ok(impossible.status === 200, `an unsatisfiable budget still returns a plan (${impossible.status})`);
if (impossible.status === 200) {
  ok(impossible.d.warnings.length > 0, 'and says plainly which nations fell short');
  ok(impossible.d.nations.every(n => n.subdivision_count >= 1), 'every nation still holds at least its capital');
}

console.log('\n-- listing and reading back');

const list = await call('/api/world/generations', { token: T });
ok(list.status === 200 && list.d.generations.length >= 2, 'previews are listed');
ok(list.d.generations.some(g => g.id === first.d.id), 'including the first one we made');

const single = await call(`/api/world/generations/${first.d.id}`, { token: T });
ok(single.status === 200 && single.d.id === first.d.id, 'a single generation can be read back');
ok(!leaks(JSON.stringify(single.d)), 'and reading it back is still opaque');

console.log('\n-- discarding');

const discard = await call(`/api/world/generations/${repeat.d.id}/discard`, { method: 'POST', token: T });
ok(discard.status === 200, `the duplicate preview can be thrown away (${discard.status})`);
const rediscard = await call(`/api/world/generations/${repeat.d.id}/discard`, { method: 'POST', token: T });
ok(rediscard.status === 409, 'discarding it twice is refused, not silently accepted');

console.log('\n-- committing');

const preCommitMap = (await call('/api/diplomacy/map')).d;
const before = preCommitMap.powers.length;

const commit = await call(`/api/world/generations/${first.d.id}/commit`, { method: 'POST', token: T });
ok(commit.status === 200, `the preview commits (${commit.status}: ${JSON.stringify(commit.d).slice(0, 200)})`);
ok(commit.d.powers.length === 5, 'five real powers came out of it');
ok(commit.d.powers.every(p => /^fp_/.test(p.key)), 'each is handed a foreign key, shown once, like any other power');
ok(!leaks(JSON.stringify(commit.d)), 'the commit response is opaque too');

const map = (await call('/api/diplomacy/map')).d;
ok(map.powers.length === before + 5, 'the five committed powers are now on the world map');
for (const p of commit.d.powers) {
  const onMap = map.powers.find(mp => mp.id === p.id);
  ok(!!onMap, `${p.name} appears on the map`);
  ok(onMap.recognised === false, `${p.name} arrives unrecognised — the House has not voted yet`);
  ok(onMap.subdivision_count > 0, `${p.name} actually holds the ground it was drawn with`);
}

console.log('\n-- committing an already-committed generation is refused');

const recommit = await call(`/api/world/generations/${first.d.id}/commit`, { method: 'POST', token: T });
ok(recommit.status === 409, `a second commit of the same generation is refused (${recommit.status})`);

console.log('\n-- a generation whose ground has since been claimed elsewhere cannot be committed');

/* Two independent seeds drawing from the same unclaimed pool will legitimately
   want some of the same ground. Committing the first has to lock the second
   out of it rather than handing out a subdivision twice. */
const overlap = await generate({ powers: 2, seed: 'overlap-source', republic_strength: 40 });
ok(overlap.status === 200, 'a fresh preview over the same unclaimed pool');
const overlap2 = await generate({ powers: 2, seed: 'overlap-source-2', republic_strength: 40 });
const commitOverlap = await call(`/api/world/generations/${overlap.d.id}/commit`, { method: 'POST', token: T });
ok(commitOverlap.status === 200, 'the first of the pair commits normally');
const commitOverlap2 = await call(`/api/world/generations/${overlap2.d.id}/commit`, { method: 'POST', token: T });
ok(commitOverlap2.status === 200 || commitOverlap2.status === 409,
  `an independently-seeded overlapping generation either commits cleanly or is refused for the ground already gone (${commitOverlap2.status})`);
if (commitOverlap2.status === 409) ok(commitOverlap2.d.conflicts > 0, 'and says how much of it was already gone');

console.log('\n-- strength recompute is derived from the land, not the Republic');

const recompute = await call('/api/world/strength/recompute', { method: 'POST', token: T });
ok(recompute.status === 200, `recompute answers (${recompute.status})`);
ok(Array.isArray(recompute.d.powers), 'and reports every generated power it looked at');
ok(typeof recompute.d.moved === 'number', 'with a count of how many actually changed');
const forbidden = await call('/api/world/strength/recompute', { method: 'POST', token: plain });
ok(forbidden.status === 403, 'and only an admin may trigger it');

console.log('\n-- recognition is still a bill, exactly like any other first contact');

const someone = commit.d.powers[0];
const bill = await call(`/api/diplomacy/powers/${someone.id}/recognition`, {
  method: 'POST', body: { body: `That ${someone.name} be recognised.` }, token: w.T[0]
});
ok(!!bill.d.id, 'a member of the House can move to recognise a generated power exactly as any other');

report();
