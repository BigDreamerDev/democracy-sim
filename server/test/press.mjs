import { call, ok, report, setup } from './world.mjs';
const w = await setup({ citizens: 4, parliament: false });
const a = w.tok[w.users[1].user.display_name];
const b = w.tok[w.users[2].user.display_name];
const outsiderToken = null; // no token at all — the public read surface

console.log('\n-- founding a publication');
const dupeName = 'The Ledger';
const pub = (await call('/api/press/publications', { method: 'POST', body: { name: dupeName, description: 'News for the Republic.' }, token: a })).d;
ok(!!pub.id, 'a citizen founds a publication');
ok((await call('/api/press/publications', { method: 'POST', body: { name: dupeName }, token: b })).status === 409, 'the name cannot be reused');
ok((await call('/api/press/publications', { method: 'POST', body: { name: '' }, token: a })).status === 400, 'a publication needs a name');
ok((await call('/api/press/publications', { method: 'POST', body: { name: 'No Auth Times' } })).status === 401, 'founding needs to be signed in');

const listed = (await call('/api/press/publications')).d;
ok(listed.some(p => p.id === pub.id), 'it appears in the public list, no auth needed');

console.log('\n-- editors');
ok((await call(`/api/press/publications/${pub.id}/editors`, { method: 'POST', body: { user_id: w.users[2].user.id }, token: b })).status === 403, 'a non-editor cannot add an editor');
ok((await call(`/api/press/publications/${pub.id}/editors`, { method: 'POST', body: { user_id: w.users[2].user.id }, token: a })).status === 200, 'an editor adds another');
const withEditor = (await call(`/api/press/publications/${pub.id}`)).d;
ok(withEditor.editors.length === 2, 'the publication now carries two editors');

console.log('\n-- authoring and publishing an article');
ok((await call(`/api/press/publications/${pub.id}/articles`, { method: 'POST', body: { headline: 'By an outsider', body: 'x' }, token: w.tok[w.users[3].user.display_name] })).status === 403, 'a non-editor cannot write for this publication');
const draft = (await call(`/api/press/publications/${pub.id}/articles`, { method: 'POST', body: { headline: 'Cycle One in Review', body: 'The House sat. See B001 for the detail.' }, token: a })).d;
ok(!!draft.id, 'an editor drafts an article');
ok(draft.published === false, 'it starts unpublished');

ok((await call(`/api/press/articles/${draft.id}`)).status === 404, 'an unpublished article is not visible without auth');
const seenByEditor = (await call(`/api/press/articles/${draft.id}`, { token: a })).d;
ok(seenByEditor && seenByEditor.headline === draft.headline, 'but an editor of the publication can preview it');
ok((await call('/api/press/articles')).d.every(x => x.id !== draft.id), 'the public feed does not list a draft');

ok((await call(`/api/press/articles/${draft.id}/publish`, { method: 'POST', token: b })).status === 200, 'a co-editor publishes it');
ok((await call(`/api/press/articles/${draft.id}/publish`, { method: 'POST', token: a })).status === 400, 'publishing twice is refused');

console.log('\n-- the public read surface needs no auth');
const publicArticle = await call(`/api/press/articles/${draft.id}`);
ok(publicArticle.status === 200 && publicArticle.d.published, 'the article reads back published, with no token at all');
ok((await call('/api/press/articles')).d.some(x => x.id === draft.id), 'and now appears in the public feed');
const pubPage = await call(`/api/press/publications/${pub.id}`);
ok(pubPage.status === 200 && pubPage.d.articles.some(x => x.id === draft.id), 'and on the publication\'s own page, no auth needed');

console.log('\n-- publishing is rate-limited');
let limited = false;
for (let i = 0; i < 45 && !limited; i++) {
  const d = (await call(`/api/press/publications/${pub.id}/articles`, { method: 'POST', body: { headline: 'Filler ' + i, body: '' }, token: a })).d;
  const r = await call(`/api/press/articles/${d.id}/publish`, { method: 'POST', token: a });
  if (r.status === 429) limited = true;
}
ok(limited, 'slowWrites eventually refuses a citizen flooding the record');

report();
