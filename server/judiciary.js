/* The Judicial Enforcement Act — the Supreme Court.

   Three Justices: one appointed by the House, one by the President, one elected
   by the Citizens. They sit in the `offices` table under office = 'justice', so
   impeachment, the public record and the citizens list all work on them without
   any special casing.

   The Court decides whether a law or an act of an officer is consistent with the
   Constitution. Two Justices agreeing decide a case. A law found repugnant is
   repealed from the moment of the ruling; what was lawfully done before stands. */

module.exports.mount = function mount(app, ctx) {
  const { q, log, auth, admin, wrap, num, bool, loadConfig, officesOf, citizenCount, slowWrites } = ctx;

  const SEATS = [
    { seat: 1, appointer: 'house' },
    { seat: 2, appointer: 'president' },
    { seat: 3, appointer: 'people' }
  ];

  /* Mounting happens before the schema is built, so the seats are created on
     first use instead. It is idempotent and costs one insert. */
  let seatsReady = false;
  async function ensureSeats() {
    if (seatsReady) return;
    for (const s of SEATS) {
      await q('INSERT INTO court_seats(seat, appointer) VALUES($1,$2) ON CONFLICT (seat) DO NOTHING', [
        s.seat,
        s.appointer
      ]);
    }
    seatsReady = true;
  }

  const isJustice = async id => (await officesOf(id)).includes('justice');

  /* Who may fill each seat. The House speaks through the Speaker, the President
     through themselves, and the people through a vote — which for now the
     Returning Officer records, since there is no separate ballot for it yet. */
  async function mayAppoint(user, appointer) {
    /* The Returning Officer records the People's seat, because there is no
       separate ballot for it yet. That is the whole of their part in the Court.
       They are not the House and not the President, and an RO who could fill
       those two seats would hold a majority of the bench outright. */
    if (user.is_admin) return appointer === 'people';
    const held = await officesOf(user.id);
    if (appointer === 'house') return held.includes('speaker');
    /* The President's seat on the Court. A Vice President may fill it only while
       the presidency is genuinely unattended — never alongside a sitting
       President, or the Court would have two people appointing to one seat. */
    if (appointer === 'president') {
      if (held.includes('president')) return true;
      if (!held.includes('vice_president')) return false;
      const sitting = (await q("SELECT 1 FROM offices WHERE office='president' AND active")).rows[0];
      return !sitting;
    }
    return false; // 'people' — recorded by the Returning Officer
  }

  async function courtNow() {
    /* Impeachment and suspension work on the offices table and know nothing about
       this one, so a seat can be left pointing at someone who no longer holds the
       office. Reconcile before reporting, or the bench shows a ghost. */
    await q(`UPDATE court_seats SET user_id=NULL, appointed_at=NULL, term_ends=NULL
              WHERE user_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM offices o WHERE o.user_id = court_seats.user_id AND o.office='justice' AND o.active)`);
    const { rows } = await q(`
      SELECT s.seat, s.appointer, s.appointed_at, s.term_ends,
             u.id AS user_id, u.display_name, u.username
        FROM court_seats s LEFT JOIN users u ON u.id = s.user_id
       ORDER BY s.seat`);
    return rows;
  }

  app.get(
    '/api/court',
    wrap(async (req, res) => {
      await loadConfig();
      await ensureSeats();
      const seats = await courtNow();
      for (const s of seats) {
        s.can_appoint = !s.user_id && req.user ? await mayAppoint(req.user, s.appointer) : false;
        s.can_vacate = !!(req.user && s.user_id && (s.user_id === req.user.id || req.user.is_admin));
      }
      const cases = (
        await q(`
      SELECT c.id, c.ref, c.title, c.status, c.created_at, c.ruled_at,
             u.display_name AS brought_by_name,
             (SELECT count(*)::int FROM case_votes v WHERE v.case_id = c.id) AS opinions
        FROM cases c LEFT JOIN users u ON u.id = c.brought_by
       ORDER BY c.created_at DESC LIMIT 50`)
      ).rows;
      res.json({ seats, cases, sitting: seats.filter(s => s.user_id).length });
    })
  );

  app.post(
    '/api/court/seats/:seat',
    auth,
    wrap(async (req, res) => {
      await loadConfig();
      await ensureSeats();
      const seat = (await q('SELECT * FROM court_seats WHERE seat=$1', [req.params.seat])).rows[0];
      if (!seat) return res.status(404).json({ error: 'There is no such seat on the Court.' });
      if (!(await mayAppoint(req.user, seat.appointer))) {
        const who = {
          house: 'the Speaker, on behalf of the House',
          president: 'the President',
          people: 'the Citizens'
        }[seat.appointer];
        return res.status(403).json({ error: `Seat ${seat.seat} is filled by ${who}.` });
      }
      /* Article 17.3: a Justice serves a fixed term. If the appointer could swap
       them out at will the term would mean nothing and the Court would sit at
       the pleasure of whoever appointed it. A seat is filled only when vacant;
       a sitting Justice leaves by resigning or by impeachment. */
      if (seat.user_id) {
        const sitting = (await q('SELECT display_name FROM users WHERE id=$1', [seat.user_id])).rows[0];
        return res.status(400).json({
          error: `${sitting?.display_name || 'A Justice'} holds this seat for a fixed term. They may resign it, or the House may impeach them, but it cannot simply be taken back.`
        });
      }
      const target = (
        await q('SELECT id, display_name FROM users WHERE id=$1 AND is_active AND approved', [
          req.body?.user_id || 0
        ])
      ).rows[0];
      if (!target) return res.status(400).json({ error: 'Name a citizen to appoint.' });

      // Article 17.11: a Justice holds no other office, and resigns any on appointment.
      const held = await officesOf(target.id);
      if (held.length && !held.includes('justice')) {
        return res.status(400).json({
          error: `${target.display_name} holds office as ${held.join(', ')}. A Justice may hold no other office — they must resign it first.`
        });
      }
      const already = (
        await q('SELECT seat FROM court_seats WHERE user_id=$1 AND seat<>$2', [target.id, seat.seat])
      ).rows[0];
      if (already) return res.status(400).json({ error: 'That citizen already sits on the Court.' });

      const terms = Math.max(1, num('justice_terms') || 3);
      const ends = new Date(Date.now() + terms * num('cycle_days') * 86400000);

      await q('UPDATE court_seats SET user_id=$1, appointed_at=now(), term_ends=$2 WHERE seat=$3', [
        target.id,
        ends,
        seat.seat
      ]);
      await q('INSERT INTO offices(office,user_id,seat) VALUES($1,$2,$3)', ['justice', target.id, seat.seat]);
      log(req.user.id, 'court.appoint', `${target.display_name} to seat ${seat.seat} (${seat.appointer})`);
      res.json({ ok: true, term_ends: ends });
    })
  );

  app.post(
    '/api/court/seats/:seat/vacate',
    auth,
    wrap(async (req, res) => {
      const seat = (await q('SELECT * FROM court_seats WHERE seat=$1', [req.params.seat])).rows[0];
      if (!seat) return res.status(404).json({ error: 'No such seat.' });
      const mine = seat.user_id === req.user.id;
      if (!mine && !req.user.is_admin)
        return res
          .status(403)
          .json({ error: 'Only that Justice may resign, or the Returning Officer remove them.' });
      if (!seat.user_id) return res.json({ ok: true });
      await q(
        "UPDATE offices SET active=FALSE, until=now() WHERE user_id=$1 AND office='justice' AND active",
        [seat.user_id]
      );
      await q('UPDATE court_seats SET user_id=NULL, appointed_at=NULL, term_ends=NULL WHERE seat=$1', [
        seat.seat
      ]);
      log(req.user.id, mine ? 'court.resign' : 'court.remove', `seat ${seat.seat}`);
      res.json({ ok: true });
    })
  );

  /* Article 17.5: any Citizen may bring a matter. No leave required from anyone. */
  app.post(
    '/api/court/cases',
    auth,
    slowWrites,
    wrap(async (req, res) => {
      await loadConfig();
      const { title, claim, target_kind, target_law_id, target_bill_id, target_note } = req.body || {};
      if (!title || !claim)
        return res.status(400).json({ error: 'A case needs a title and a statement of what is wrong.' });
      const kind = ['law', 'bill', 'act'].includes(target_kind) ? target_kind : 'act';
      if (kind === 'law' && !target_law_id)
        return res.status(400).json({ error: 'Name the law complained of.' });
      if (kind === 'bill' && !target_bill_id)
        return res.status(400).json({ error: 'Name the bill complained of.' });
      if (kind === 'act' && !String(target_note || '').trim())
        return res.status(400).json({ error: 'Say which act of which officer is complained of.' });

      const n = (await q('SELECT count(*)::int n FROM cases')).rows[0].n + 1;
      const { rows } = await q(
        `INSERT INTO cases(ref,title,claim,brought_by,target_kind,target_law_id,target_bill_id,target_note)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          `C${String(n).padStart(3, '0')}`,
          String(title).trim().slice(0, 200),
          String(claim).slice(0, 8000),
          req.user.id,
          kind,
          kind === 'law' ? target_law_id : null,
          kind === 'bill' ? target_bill_id : null,
          String(target_note || '').slice(0, 400)
        ]
      );
      log(req.user.id, 'court.case', rows[0].ref);
      res.json(rows[0]);
    })
  );

  app.get(
    '/api/court/cases/:id',
    wrap(async (req, res) => {
      const c = (
        await q(
          `
      SELECT c.*, u.display_name AS brought_by_name,
             l.ref AS law_ref, l.title AS law_title, l.body AS law_body, l.repealed_at AS law_repealed,
             b.ref AS bill_ref, b.title AS bill_title
        FROM cases c
        LEFT JOIN users u ON u.id = c.brought_by
        LEFT JOIN laws  l ON l.id = c.target_law_id
        LEFT JOIN bills b ON b.id = c.target_bill_id
       WHERE c.id = $1`,
          [req.params.id]
        )
      ).rows[0];
      if (!c) return res.status(404).json({ error: 'No such case.' });
      const opinions = (
        await q(
          `
      SELECT v.vote, v.reason, v.at, u.display_name
        FROM case_votes v JOIN users u ON u.id = v.user_id
       WHERE v.case_id = $1 ORDER BY v.at`,
          [req.params.id]
        )
      ).rows;
      const seats = await courtNow();
      res.json({
        ...c,
        opinions,
        court: seats.filter(s => s.user_id).length,
        my_opinion: req.user
          ? opinions.find(o => o.display_name === req.user.display_name)?.vote || null
          : null,
        i_am_justice: req.user ? await isJustice(req.user.id) : false
      });
    })
  );

  app.post(
    '/api/court/cases/:id/withdraw',
    auth,
    wrap(async (req, res) => {
      const c = (await q('SELECT * FROM cases WHERE id=$1', [req.params.id])).rows[0];
      if (!c) return res.status(404).json({ error: 'No such case.' });
      if (c.brought_by !== req.user.id)
        return res.status(403).json({ error: 'Only whoever brought the case may withdraw it.' });
      if (c.status !== 'open') return res.status(400).json({ error: 'That case is already decided.' });
      await q("UPDATE cases SET status='withdrawn', ruled_at=now() WHERE id=$1", [c.id]);
      log(req.user.id, 'court.withdraw', c.ref);
      res.json({ ok: true });
    })
  );

  /* Article 17.7 and 17.8: every Justice gives reasons, and two agreeing decide.
     The ruling lands the moment the second Justice agrees. */
  app.post(
    '/api/court/cases/:id/opinion',
    auth,
    wrap(async (req, res) => {
      await loadConfig();
      const c = (await q('SELECT * FROM cases WHERE id=$1', [req.params.id])).rows[0];
      if (!c) return res.status(404).json({ error: 'No such case.' });
      if (c.status !== 'open') return res.status(400).json({ error: 'That case is already decided.' });
      if (!(await isJustice(req.user.id)))
        return res.status(403).json({ error: 'Only a Justice of the Supreme Court may rule.' });
      if (c.brought_by === req.user.id)
        return res.status(400).json({ error: 'A Justice may not decide a case they brought themselves.' });
      const vote = req.body?.vote;
      if (!['uphold', 'dismiss'].includes(vote))
        return res.status(400).json({ error: 'Rule to uphold the complaint or dismiss it.' });
      const reason = String(req.body?.reason || '').trim();
      if (!reason) return res.status(400).json({ error: 'The Court gives reasons. Say why.' });

      try {
        await q('INSERT INTO case_votes(case_id,user_id,vote,reason) VALUES($1,$2,$3,$4)', [
          c.id,
          req.user.id,
          vote,
          reason.slice(0, 8000)
        ]);
      } catch (err) {
        if (err.code === '23505')
          return res.status(409).json({ error: 'You have already given your opinion in this case.' });
        throw err;
      }

      const votes = (await q('SELECT vote FROM case_votes WHERE case_id=$1', [c.id])).rows;
      const uphold = votes.filter(v => v.vote === 'uphold').length;
      const dismiss = votes.filter(v => v.vote === 'dismiss').length;
      const needed = 2;
      let outcome = null;
      if (uphold >= needed) outcome = 'upheld';
      else if (dismiss >= needed) outcome = 'dismissed';
      if (!outcome) return res.json({ ok: true, uphold, dismiss, decided: false });

      const reasons = (
        await q(
          `
      SELECT u.display_name, v.vote, v.reason FROM case_votes v JOIN users u ON u.id=v.user_id
       WHERE v.case_id=$1 ORDER BY v.at`,
          [c.id]
        )
      ).rows
        .map(r => `**${r.display_name}** (${r.vote}): ${r.reason}`)
        .join('\n\n');

      await q('UPDATE cases SET status=$1, ruling=$2, ruled_at=now() WHERE id=$3', [outcome, reasons, c.id]);

      // Article 17.6: a law found repugnant ceases to have effect from today.
      let struck = null;
      if (outcome === 'upheld' && c.target_kind === 'law' && c.target_law_id) {
        const law = (
          await q(
            'UPDATE laws SET repealed_at=now() WHERE id=$1 AND repealed_at IS NULL RETURNING ref,title',
            [c.target_law_id]
          )
        ).rows[0];
        if (law) struck = law.ref;
      }
      log(req.user.id, 'court.ruling', `${c.ref} ${outcome}${struck ? ` — ${struck} struck down` : ''}`);
      res.json({ ok: true, uphold, dismiss, decided: true, outcome, struck });
    })
  );

  console.log('[republic] the Supreme Court is sitting');
};
