/* The Press Act.

   A citizen founds a publication under a name; that makes them its editor.
   A publication can carry more than one editor, the same ownership-list
   shape economy.js uses for a business — but a publication is not a
   business: no account, no capital, no listings. It exists to publish, not
   to trade.

   An article is drafted, then published. Publishing is public and permanent
   the instant it happens — nothing here is ever deleted, matching every
   other record in this codebase — so there is no unpublish and no delete,
   only draft -> published. An editor may reference a bill or an election by
   writing "B042" in their own prose, the same informal way debate on a bill
   already works; this module does not tie an article to any other row. */

module.exports.mount = function mount(app, ctx) {
  const { q, auth, wrap, log, slowWrites } = ctx;

  const editorOf = async (pubId, userId) =>
    !!(await q('SELECT 1 FROM publication_editors WHERE publication_id=$1 AND user_id=$2', [pubId, userId]))
      .rows[0];

  /* ------------------------------------------------------------ founding */

  app.post(
    '/api/press/publications',
    auth,
    slowWrites,
    wrap(async (req, res) => {
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'A publication needs a name.' });
      const dupe = (await q('SELECT 1 FROM publications WHERE lower(name)=lower($1)', [name])).rows[0];
      if (dupe) return res.status(409).json({ error: 'A publication of that name already exists.' });
      const { rows } = await q(
        'INSERT INTO publications(name,description,founder_id) VALUES($1,$2,$3) RETURNING *',
        [name.slice(0, 80), String(req.body?.description || '').slice(0, 2000), req.user.id]
      );
      await q('INSERT INTO publication_editors(publication_id,user_id) VALUES($1,$2)', [
        rows[0].id,
        req.user.id
      ]);
      log(req.user.id, 'press.found', rows[0].name);
      res.json(rows[0]);
    })
  );

  app.get(
    '/api/press/publications',
    wrap(async (_req, res) => {
      const { rows } = await q(`
      SELECT p.*, u.display_name AS founder_name,
             (SELECT count(*)::int FROM publication_editors e WHERE e.publication_id=p.id) AS editors,
             (SELECT count(*)::int FROM articles a WHERE a.publication_id=p.id AND a.published) AS articles
        FROM publications p
        LEFT JOIN users u ON u.id=p.founder_id
       ORDER BY p.created_at DESC`);
      res.json(rows);
    })
  );

  app.get(
    '/api/press/publications/:id',
    wrap(async (req, res) => {
      const p = (
        await q(
          `SELECT p.*, u.display_name AS founder_name FROM publications p
            LEFT JOIN users u ON u.id=p.founder_id WHERE p.id=$1`,
          [req.params.id]
        )
      ).rows[0];
      if (!p) return res.status(404).json({ error: 'No such publication.' });
      const editors = (
        await q(
          `SELECT u.id, u.display_name FROM publication_editors e JOIN users u ON u.id=e.user_id
            WHERE e.publication_id=$1 ORDER BY e.added_at`,
          [p.id]
        )
      ).rows;
      const mine = req.user ? await editorOf(p.id, req.user.id) : false;
      // An editor sees their own drafts too; the public sees only what was published.
      const articles = (
        await q(
          `SELECT a.*, u.display_name AS author_name FROM articles a
            LEFT JOIN users u ON u.id=a.author_id
           WHERE a.publication_id=$1 AND (a.published OR $2)
           ORDER BY COALESCE(a.published_at, a.created_at) DESC`,
          [p.id, mine]
        )
      ).rows;
      res.json({ ...p, editors, articles, mine });
    })
  );

  app.post(
    '/api/press/publications/:id/editors',
    auth,
    wrap(async (req, res) => {
      const p = (await q('SELECT * FROM publications WHERE id=$1', [req.params.id])).rows[0];
      if (!p) return res.status(404).json({ error: 'No such publication.' });
      if (!(await editorOf(p.id, req.user.id)))
        return res.status(403).json({ error: 'Only an editor may add another.' });
      const who = (
        await q('SELECT id, display_name FROM users WHERE id=$1 AND is_active AND approved', [
          req.body?.user_id || 0
        ])
      ).rows[0];
      if (!who) return res.status(400).json({ error: 'Name a citizen to add.' });
      await q(
        'INSERT INTO publication_editors(publication_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [p.id, who.id]
      );
      log(req.user.id, 'press.editor', `${who.display_name} added to ${p.name}`);
      res.json({ ok: true });
    })
  );

  /* ------------------------------------------------------------ articles */

  app.post(
    '/api/press/publications/:id/articles',
    auth,
    slowWrites,
    wrap(async (req, res) => {
      const p = (await q('SELECT * FROM publications WHERE id=$1', [req.params.id])).rows[0];
      if (!p) return res.status(404).json({ error: 'No such publication.' });
      if (!(await editorOf(p.id, req.user.id)))
        return res.status(403).json({ error: 'Only an editor may write for this publication.' });
      const headline = String(req.body?.headline || '').trim();
      if (!headline) return res.status(400).json({ error: 'An article needs a headline.' });
      const { rows } = await q(
        'INSERT INTO articles(publication_id,author_id,headline,body) VALUES($1,$2,$3,$4) RETURNING *',
        [p.id, req.user.id, headline.slice(0, 200), String(req.body?.body || '').slice(0, 20000)]
      );
      log(req.user.id, 'press.draft', `${p.name}: ${rows[0].headline}`);
      res.json(rows[0]);
    })
  );

  /* Published is public and permanent from this moment. Rate-limited the same
     way every other write that lands permanently on the record is — slowWrites
     is keyed per citizen, so this cannot be used to flood the front page. */
  app.post(
    '/api/press/articles/:id/publish',
    auth,
    slowWrites,
    wrap(async (req, res) => {
      const a = (await q('SELECT * FROM articles WHERE id=$1', [req.params.id])).rows[0];
      if (!a) return res.status(404).json({ error: 'No such article.' });
      if (!(await editorOf(a.publication_id, req.user.id)))
        return res.status(403).json({ error: 'Only an editor of this publication may publish it.' });
      if (a.published) return res.status(400).json({ error: 'Already published.' });
      const { rows } = await q(
        "UPDATE articles SET published=TRUE, published_at=now() WHERE id=$1 RETURNING *",
        [a.id]
      );
      log(req.user.id, 'press.publish', `article ${a.id}`);
      res.json(rows[0]);
    })
  );

  app.get(
    '/api/press/articles',
    wrap(async (_req, res) => {
      const { rows } = await q(`
      SELECT a.*, u.display_name AS author_name, p.name AS publication_name
        FROM articles a
        LEFT JOIN users u ON u.id=a.author_id
        JOIN publications p ON p.id=a.publication_id
       WHERE a.published
       ORDER BY a.published_at DESC LIMIT 200`);
      res.json(rows);
    })
  );

  app.get(
    '/api/press/articles/:id',
    wrap(async (req, res) => {
      const a = (
        await q(
          `SELECT a.*, u.display_name AS author_name, p.name AS publication_name
             FROM articles a
             LEFT JOIN users u ON u.id=a.author_id
             JOIN publications p ON p.id=a.publication_id
            WHERE a.id=$1`,
          [req.params.id]
        )
      ).rows[0];
      if (!a) return res.status(404).json({ error: 'No such article.' });
      if (!a.published && !(req.user && (await editorOf(a.publication_id, req.user.id))))
        return res.status(404).json({ error: 'No such article.' });
      res.json(a);
    })
  );
};
