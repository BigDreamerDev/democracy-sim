/* The Press — front end.

   Loaded after acts.js and money.js, registered the same way: through
   window.Republic, and only where the server actually answers. A publication
   is not a business — no balance, no listings — so this page is much
   plainer than the economy's: a name, a masthead of editors, and articles
   that are permanent the moment they are published. */

(function () {
  const R = window.Republic;
  if (!R) {
    console.warn('[republic] press.js loaded without app.js');
    return;
  }
  const { api, esc, md, toast, $, when } = R;
  const ME = () => R.me();

  /* ==================================================== THE PRESS FRONT PAGE */

  async function viewPress(v) {
    const [pubs, articles] = await Promise.all([
      api('/api/press/publications'),
      api('/api/press/articles')
    ]);
    v.innerHTML = `
      <h1 class="page">The Press</h1>
      <p class="page-sub">Every publication in the Republic, and everything they have printed.</p>

      <div class="card">
        <h2>Found a publication</h2>
        <p class="small muted">No capital and no registration fee — a publication is not a business. Naming it makes you its first editor.</p>
        <form id="found-pub" class="stack">
          <label class="field"><span>Name</span><input name="name" required maxlength="80"></label>
          <label class="field"><span>What it covers</span><textarea name="description" style="min-height:70px" maxlength="2000"></textarea></label>
          <button class="btn btn-primary">Found it</button>
        </form>
      </div>

      <div class="card">
        <h2>Publications</h2>
        <div class="list">${
          pubs.length
            ? pubs
                .map(
                  p => `
          <a class="item" href="#/publication/${p.id}">
            <div class="item-top"><span class="item-title">${esc(p.name)}</span>
              <span class="result-count">${p.articles} article${p.articles === 1 ? '' : 's'}</span></div>
            <div class="item-meta">${esc(p.founder_name || '')} · ${p.editors} editor${p.editors === 1 ? '' : 's'}</div>
          </a>`
                )
                .join('')
            : '<div class="empty">No publications yet.</div>'
        }</div>
      </div>

      <div class="card">
        <h2>Latest articles</h2>
        <div class="list">${
          articles.length
            ? articles
                .map(
                  a => `
          <a class="item" href="#/article/${a.id}">
            <div class="item-top"><span class="item-title">${esc(a.headline)}</span></div>
            <div class="item-meta">${esc(a.publication_name)} · ${esc(a.author_name || 'unknown')} · ${when(a.published_at)}</div>
          </a>`
                )
                .join('')
            : '<div class="empty">Nothing has been published yet.</div>'
        }</div>
      </div>`;

    $('#found-pub').onsubmit = async ev => {
      ev.preventDefault();
      try {
        const p = await api('/api/press/publications', {
          method: 'POST',
          body: Object.fromEntries(new FormData(ev.target))
        });
        location.hash = `#/publication/${p.id}`;
      } catch (err) {
        toast(err.message, true);
      }
    };
  }

  /* ============================================ A PUBLICATION'S OWN PAGE */

  async function viewPublication(v, id) {
    const p = await api('/api/press/publications/' + id);
    v.innerHTML = `
      <h1 class="page">${esc(p.name)}</h1>
      <p class="page-sub">founded by ${esc(p.founder_name || 'unknown')} · ${p.editors.length} editor${p.editors.length === 1 ? '' : 's'}</p>
      ${p.description ? `<div class="card"><div class="prose">${md(p.description)}</div></div>` : ''}

      <div class="card"><h2>Editors</h2>
        <p>${p.editors.map(e => esc(e.display_name)).join(', ')}</p>
        ${
          p.mine
            ? `<form id="add-editor" class="row" style="margin-top:12px">
          <select name="user_id" id="editor-pick" style="flex:1"></select>
          <button class="btn btn-sm">Add editor</button>
        </form>`
            : ''
        }
      </div>

      ${
        p.mine
          ? `<div class="card"><h2>Write</h2>
        <form id="write" class="stack">
          <label class="field"><span>Headline</span><input name="headline" required maxlength="200"></label>
          <label class="field"><span>Body</span><textarea name="body" style="min-height:160px" maxlength="20000" placeholder="Markdown. Reference a bill or election informally, the same way debate does — e.g. B042."></textarea></label>
          <button class="btn btn-primary">Save as draft</button>
        </form>
      </div>`
          : ''
      }

      <div class="card"><h2>Articles</h2>
        <div class="list">${
          p.articles.length
            ? p.articles
                .map(
                  a => `
          <div class="item">
            <div class="item-top">
              <a href="#/article/${a.id}"><span class="item-title">${esc(a.headline)}</span></a>
              ${a.published ? '' : '<span class="tag on-violet">draft</span>'}
            </div>
            <div class="item-meta">${esc(a.author_name || 'unknown')} · ${a.published ? when(a.published_at) : 'not yet published'}</div>
            ${!a.published && p.mine ? `<div class="row" style="margin-top:8px"><button class="btn btn-sm btn-primary" data-publish="${a.id}">Publish</button></div>` : ''}
          </div>`
                )
                .join('')
            : '<div class="empty">Nothing written yet.</div>'
        }</div>
      </div>`;

    if (p.mine) {
      api('/api/citizens').then(cs => {
        $('#editor-pick').innerHTML = cs
          .filter(c => !p.editors.some(e => e.id === c.id))
          .map(c => `<option value="${c.id}">${esc(c.display_name)}</option>`)
          .join('');
      });
      $('#add-editor').onsubmit = async ev => {
        ev.preventDefault();
        const f = Object.fromEntries(new FormData(ev.target));
        try {
          await api(`/api/press/publications/${p.id}/editors`, {
            method: 'POST',
            body: { user_id: Number(f.user_id) }
          });
          R.reload();
        } catch (err) {
          toast(err.message, true);
        }
      };
      $('#write').onsubmit = async ev => {
        ev.preventDefault();
        try {
          await api(`/api/press/publications/${p.id}/articles`, {
            method: 'POST',
            body: Object.fromEntries(new FormData(ev.target))
          });
          toast('Saved as a draft. Publish it from the list below when it is ready.');
          R.reload();
        } catch (err) {
          toast(err.message, true);
        }
      };
      document.querySelectorAll('[data-publish]').forEach(
        b =>
          (b.onclick = async () => {
            if (!confirm('Publish this article? It becomes public and permanent immediately.')) return;
            try {
              await api(`/api/press/articles/${b.dataset.publish}/publish`, { method: 'POST' });
              toast('Published.');
              R.reload();
            } catch (err) {
              toast(err.message, true);
            }
          })
      );
    }
  }

  /* ==================================================== A SINGLE ARTICLE */

  async function viewArticle(v, id) {
    const a = await api('/api/press/articles/' + id);
    v.innerHTML = `
      <h1 class="page">${esc(a.headline)}</h1>
      <p class="page-sub">
        <a href="#/publication/${a.publication_id}">${esc(a.publication_name)}</a>
        · ${esc(a.author_name || 'unknown')}
        · ${a.published ? when(a.published_at) : 'draft — not yet published'}
      </p>
      <div class="card"><div class="prose">${md(a.body)}</div></div>`;
  }

  /* Registered only where the server actually has it, exactly as money.js does it. */
  (async () => {
    const present = async path => {
      try {
        await api(path);
        return true;
      } catch (err) {
        return !/404|no such endpoint/i.test(err.message || '');
      }
    };
    if (await present('/api/press/publications')) {
      R.addRoute('press', 'Press', viewPress);
      R.addSubRoute('publication', viewPublication);
      R.addSubRoute('article', viewArticle);
    }
    R.refreshNav();
  })();
})();
