/* The Treasury and the Fed.

   Part 6 and Part 7 of the Creation of an Economy Act, and Article 21 of the
   Electoral Reform Act. Two offices with very different relationships to power:

   The **Treasurer** is the government's. Appointed by the Prime Minister — or by
   the President while there is no Prime Minister — and dismissable by whoever
   appointed them. They hold the public accounts, name the currency, and set the
   ownership cap the Act gives them (Part 5.18). They may not create money
   (Part 6.22) and they may not set a rate of tax: taxation is the House's.

   The **head of the Fed** is nobody's. Nominated by the President and confirmed
   by the House at a simple majority (21.8), for three cycles rather than one so
   that the office routinely outlasts the President who filled it (21.9), and
   removable only by impeachment (21.11). There is deliberately no dismissal
   endpoint in this file. An appointee who can be dismissed is an employee, and
   the rate of interest becomes whatever the President wants it to be in an
   election week.

   Everything the Fed does carries published reasons (21.12): `reasons` is NOT
   NULL in the schema and empty strings are refused here, so a rate change with
   no explanation cannot be recorded at all.

   Money supply. The Fed creates money by paying the Treasury from its own
   account, which goes negative — that negative balance IS the money supply, and
   it is exactly what a central bank's balance sheet looks like. Nothing is
   inserted onto a balance out of nowhere, so `sum(accounts.balance)` stays 0
   and the invariant the foreign-trade suite guards is untouched. */

module.exports.mount = function mount(app, ctx) {
  const {
    q, log, auth, admin, wrap, num, bool, loadConfig, officesOf, holds,
    wrap: _w, slowWrites, cycleNow
  } = ctx;

  /* economy.js mounts first and hands its money primitives over on the shared
     context. Without them there is no currency, so there is nothing for a
     Treasury or a Fed to do and the module simply does not answer. */
  const E = () => ctx.economy;
  const money = n => Math.round(Number(n) || 0);
  const clean = s => String(s || '').trim();

  const needEconomy = (_req, res, next) =>
    E() ? next() : res.status(503).json({ error: 'The economy is not running, so there is no Treasury and no Fed yet.' });

  const acc = (kind, id) => E().accountFor(kind, id);
  const treasury = () => E().treasury();
  const fedAcc = () => acc('fed', null);
  const bankAcc = id => acc('bank', id);

  const payErr = (res, err) => {
    if (err.code === 'FUNDS' || err.code === 'AMOUNT') return res.status(400).json({ error: err.message });
    throw err;
  };

  /* Money enters and leaves circulation here and nowhere else. The Fed's own
     account is allowed to go below zero — that is the issuance — so this cannot
     go through pay(), which refuses an overdraft by design. Both sides are
     still written, and the ledger still records it, so the books balance. */
  async function issue(toAccId, amount, note) {
    const f = await fedAcc();
    await q('UPDATE accounts SET balance = balance - $1::bigint WHERE id=$2', [amount, f.id]);
    await q('UPDATE accounts SET balance = balance + $1::bigint WHERE id=$2', [amount, toAccId]);
    await q('INSERT INTO ledger(from_id,to_id,amount,kind,note) VALUES($1,$2,$3,$4,$5)',
      [f.id, toAccId, amount, 'issue', String(note).slice(0, 300)]);
  }

  const nextRef = async (table, prefix) => {
    const n = (await q(`SELECT count(*)::int n FROM ${table}`)).rows[0].n + 1;
    return prefix + String(n).padStart(3, '0');
  };

  /* --------------------------------------------------------- eligibility */

  /* Part 8.28 and the notes on Article 21: someone who sets the rate of
     interest must not be able to profit by it. The head of the Fed holds no
     business interest at all — not a membership, not a share, not an open
     order. This is checked on confirmation, and again whenever the sitting
     chair tries to acquire one. */
  async function businessInterest(userId) {
    const m = (await q('SELECT count(*)::int n FROM business_members WHERE user_id=$1', [userId])).rows[0].n;
    const h = (await q('SELECT count(*)::int n FROM holdings WHERE holder_id=$1 AND qty > 0', [userId])).rows[0].n;
    const o = (await q("SELECT count(*)::int n FROM share_orders WHERE user_id=$1 AND status='open'", [userId])).rows[0].n;
    return m + h + o;
  }

  const chairNow = async () => (await q(`
    SELECT u.id, u.display_name, o.since FROM offices o JOIN users u ON u.id=o.user_id
     WHERE o.office='fed_chair' AND o.active LIMIT 1`)).rows[0] || null;

  const treasurerNow = async () => (await q(`
    SELECT u.id, u.display_name, o.since FROM offices o JOIN users u ON u.id=o.user_id
     WHERE o.office='treasurer' AND o.active LIMIT 1`)).rows[0] || null;

  const pmNow = async () => (await q(`
    SELECT u.id, u.display_name FROM offices o JOIN users u ON u.id=o.user_id
     WHERE o.office='prime_minister' AND o.active LIMIT 1`)).rows[0] || null;

  const houseSize = async () =>
    (await q("SELECT count(*)::int n FROM offices WHERE active AND office='mp'")).rows[0].n;

  const requireChair = async (req, res) => {
    if (await holds(req.user.id, 'fed_chair')) return true;
    res.status(403).json({ error: 'Only the head of the Fed may do that. No officer may instruct the Fed, and none may act for it.' });
    return false;
  };
  const requireTreasurer = async (req, res) => {
    if (await holds(req.user.id, 'treasurer')) return true;
    res.status(403).json({ error: 'Only the Treasurer may do that.' });
    return false;
  };

  const setConfig = async (key, value) =>
    q('INSERT INTO config(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [key, String(value)]);

  async function decide(userId, kind, detail, reasons) {
    const ref = await nextRef('fed_decisions', 'F');
    await q('INSERT INTO fed_decisions(ref,kind,detail,reasons,by_id) VALUES($1,$2,$3,$4,$5)',
      [ref, kind, detail, reasons, userId]);
    log(userId, 'fed.' + kind, `${ref}: ${detail}`);
    return ref;
  }

  /* ======================================================== THE TREASURY */

  app.get('/api/treasury', needEconomy, wrap(async (req, res) => {
    await loadConfig();
    const t = await treasury();
    const f = await fedAcc();
    /* The supply is what is in citizens' and businesses' hands, not the sum of
       every account — that sum is always zero, because the Treasury and the Fed
       hold the other side of every mark ever issued. */
    const circulating = (await q(`
      SELECT COALESCE(sum(balance),0)::bigint s FROM accounts
       WHERE owner_kind NOT IN ('treasury','fed','power')`)).rows[0].s;
    const flows = (await q(`
      SELECT kind, COALESCE(sum(amount),0)::bigint total, count(*)::int n
        FROM ledger WHERE from_id=$1 OR to_id=$1 GROUP BY kind ORDER BY total DESC`, [t.id])).rows;
    const statements = (await q(`
      SELECT s.*, u.display_name AS by_name FROM treasury_statements s
        LEFT JOIN users u ON u.id=s.by_id ORDER BY s.at DESC LIMIT 20`)).rows;
    res.json({
      treasurer: await treasurerNow(),
      appointer: (await pmNow()) ? 'prime_minister' : 'president',
      balance: Number(t.balance),
      escrow: Number((await acc('escrow', null)).balance),
      fed_balance: Number(f.balance),
      circulating: Number(circulating),
      flows,
      statements,
      currency: { name: ctx.CONFIG.currency_name, symbol: ctx.CONFIG.currency_symbol },
      ownership_cap: num('ownership_cap'),
      i_am_treasurer: !!(req.user && await holds(req.user.id, 'treasurer'))
    });
  }));

  /* The Treasury is the government's department, so the government fills it.
     Where there is no Prime Minister the President appoints, or a fallen
     government would take the public accounts down with it. */
  app.post('/api/treasury/appoint', auth, needEconomy, wrap(async (req, res) => {
    const pm = await pmNow();
    const appointer = pm ? 'prime_minister' : 'president';
    if (!(await holds(req.user.id, appointer)))
      return res.status(403).json({
        error: pm
          ? 'The Prime Minister appoints the Treasurer.'
          : 'There is no Prime Minister, so the President appoints the Treasurer.'
      });
    const target = (await q('SELECT id, display_name FROM users WHERE id=$1 AND is_active AND approved',
      [req.body?.user_id || 0])).rows[0];
    if (!target) return res.status(400).json({ error: 'Name a citizen to appoint.' });

    // Article 7.1: one seat each. The Treasury is a seat like any other.
    const held = (await officesOf(target.id)).filter(o => o !== 'treasurer');
    if (held.length)
      return res.status(400).json({ error: `${target.display_name} holds office as ${held.join(', ')}. Article 7.1 gives each citizen one seat — they must resign it first.` });

    await q("UPDATE offices SET active=FALSE, until=now() WHERE office='treasurer' AND active");
    await q("INSERT INTO offices(office,user_id) VALUES('treasurer',$1)", [target.id]);
    log(req.user.id, 'treasury.appoint', `${target.display_name}, by the ${appointer.replace('_', ' ')}`);
    res.json({ ok: true, treasurer: { id: target.id, display_name: target.display_name } });
  }));

  app.post('/api/treasury/dismiss', auth, needEconomy, wrap(async (req, res) => {
    const t = await treasurerNow();
    if (!t) return res.status(400).json({ error: 'There is no Treasurer.' });
    const pm = await pmNow();
    const appointer = pm ? 'prime_minister' : 'president';
    const mine = t.id === req.user.id;
    if (!mine && !(await holds(req.user.id, appointer)))
      return res.status(403).json({ error: `The Treasurer may resign, or the ${appointer.replace('_', ' ')} may dismiss them. Nobody else.` });
    await q("UPDATE offices SET active=FALSE, until=now() WHERE user_id=$1 AND office='treasurer' AND active", [t.id]);
    log(req.user.id, mine ? 'treasury.resign' : 'treasury.dismiss', t.display_name);
    res.json({ ok: true });
  }));

  /* Naming the money is the Treasurer's, and it is the one thing in this file
     that is purely presentational — which is why it is a good first act for a
     new Treasurer and why it is logged like everything else. */
  app.post('/api/treasury/currency', auth, needEconomy, wrap(async (req, res) => {
    if (!(await requireTreasurer(req, res))) return;
    const name = clean(req.body?.currency_name).slice(0, 40);
    const symbol = clean(req.body?.currency_symbol).slice(0, 4);
    if (!name || !symbol) return res.status(400).json({ error: 'A currency needs a name and a symbol.' });
    await setConfig('currency_name', name);
    await setConfig('currency_symbol', symbol);
    await loadConfig();
    log(req.user.id, 'treasury.currency', `${name} (${symbol})`);
    res.json({ ok: true, currency: { name, symbol } });
  }));

  /* Part 5.18: the share of any one business a single citizen may hold is
     "fixed by the Treasury". It is theirs, not the House's. */
  app.post('/api/treasury/ownership-cap', auth, needEconomy, wrap(async (req, res) => {
    if (!(await requireTreasurer(req, res))) return;
    const cap = Number(req.body?.ownership_cap);
    if (!(cap > 0) || cap > 1) return res.status(400).json({ error: 'The cap is a share between 0 and 1.' });
    await setConfig('ownership_cap', cap);
    await loadConfig();
    log(req.user.id, 'treasury.ownership_cap', String(cap));
    res.json({ ok: true, ownership_cap: cap });
  }));

  /* Part 6.20: the Treasury publishes what it has taken and what it has spent.
     The numbers are already public in the ledger; this is the Treasurer saying
     what they mean, which is the part a ledger cannot do. */
  app.post('/api/treasury/statement', auth, needEconomy, slowWrites, wrap(async (req, res) => {
    if (!(await requireTreasurer(req, res))) return;
    const body = clean(req.body?.body);
    if (body.length < 10) return res.status(400).json({ error: 'A statement to the House needs more than that.' });
    const ref = await nextRef('treasury_statements', 'T');
    const cyc = cycleNow();
    const { rows } = await q(
      'INSERT INTO treasury_statements(ref,cycle_no,body,by_id) VALUES($1,$2,$3,$4) RETURNING *',
      [ref, Number(req.body?.cycle_no) || cyc?.number || null, body.slice(0, 8000), req.user.id]);
    log(req.user.id, 'treasury.statement', ref);
    res.json(rows[0]);
  }));

  /* ============================================================= THE FED */

  app.get('/api/fed', needEconomy, wrap(async (req, res) => {
    await loadConfig();
    const chair = await chairNow();
    const nom = (await q(`
      SELECT n.*, u.display_name, p.display_name AS nominated_by_name,
             (SELECT count(*)::int FROM fed_confirmations c WHERE c.nomination_id=n.id) AS confirmations
        FROM fed_nominations n
        LEFT JOIN users u ON u.id=n.user_id
        LEFT JOIN users p ON p.id=n.nominated_by
       WHERE n.status='open' ORDER BY n.id DESC LIMIT 1`)).rows[0] || null;
    const house = await houseSize();
    const term = chair ? (await q(
      "SELECT term_ends FROM fed_nominations WHERE user_id=$1 AND status='confirmed' ORDER BY id DESC LIMIT 1",
      [chair.id])).rows[0]?.term_ends || null : null;
    const decisions = (await q(`
      SELECT d.*, u.display_name AS by_name FROM fed_decisions d
        LEFT JOIN users u ON u.id=d.by_id ORDER BY d.at DESC LIMIT 40`)).rows;
    const f = await fedAcc();
    const circulating = (await q(`
      SELECT COALESCE(sum(balance),0)::bigint s FROM accounts
       WHERE owner_kind NOT IN ('treasury','fed','power')`)).rows[0].s;
    let iConfirmed = false;
    if (req.user && nom)
      iConfirmed = !!(await q('SELECT 1 FROM fed_confirmations WHERE nomination_id=$1 AND user_id=$2',
        [nom.id, req.user.id])).rows[0];
    res.json({
      chair, term_ends: term, nomination: nom,
      house, needed: Math.max(1, Math.floor(house / 2) + 1),
      i_confirmed: iConfirmed,
      i_am_chair: !!(req.user && chair && chair.id === req.user.id),
      issued: -Number(f.balance),
      circulating: Number(circulating),
      rates: {
        deposit_rate: num('deposit_rate'),
        loan_rate: num('loan_rate'),
        loan_ceiling: num('loan_ceiling'),
        reserve_ratio: num('reserve_ratio')
      },
      terms: num('fed_terms'),
      decisions
    });
  }));

  app.post('/api/fed/nominate', auth, needEconomy, wrap(async (req, res) => {
    if (!(await holds(req.user.id, 'president')))
      return res.status(403).json({ error: 'The President nominates the head of the Fed.' });
    if (await chairNow())
      return res.status(400).json({ error: 'The Fed has a head. The President may not dismiss them, and only impeachment removes them.' });
    const target = (await q('SELECT id, display_name FROM users WHERE id=$1 AND is_active AND approved',
      [req.body?.user_id || 0])).rows[0];
    if (!target) return res.status(400).json({ error: 'Name a citizen to nominate.' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'The President may not nominate themselves.' });
    await q("UPDATE fed_nominations SET status='withdrawn', settled_at=now() WHERE status='open'");
    const { rows } = await q('INSERT INTO fed_nominations(user_id,nominated_by) VALUES($1,$2) RETURNING *',
      [target.id, req.user.id]);
    log(req.user.id, 'fed.nominate', target.display_name);
    res.json(rows[0]);
  }));

  /* Article 21.8: an appointment without confirmation is of no effect. The
     office row is written here, on the majority, and not a moment earlier. */
  app.post('/api/fed/confirm', auth, needEconomy, wrap(async (req, res) => {
    await loadConfig();
    const nom = (await q("SELECT * FROM fed_nominations WHERE status='open' ORDER BY id DESC LIMIT 1")).rows[0];
    if (!nom) return res.status(400).json({ error: 'No nomination is before the House.' });
    if (!(await officesOf(req.user.id)).includes('mp'))
      return res.status(403).json({ error: 'The House confirms the head of the Fed.' });

    if (req.body?.support === false) {
      await q('DELETE FROM fed_confirmations WHERE nomination_id=$1 AND user_id=$2', [nom.id, req.user.id]);
      return res.json({ confirmed: false, withdrew: true });
    }
    await q('INSERT INTO fed_confirmations(nomination_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [nom.id, req.user.id]);
    const votes = (await q('SELECT count(*)::int n FROM fed_confirmations WHERE nomination_id=$1', [nom.id])).rows[0].n;
    const house = await houseSize();
    const needed = Math.max(1, Math.floor(house / 2) + 1);
    if (votes < needed) return res.json({ confirmed: false, votes, needed, house });

    const held = (await officesOf(nom.user_id)).filter(o => o !== 'fed_chair');
    if (held.length)
      return res.status(400).json({ error: `They hold office as ${held.join(', ')}. The head of the Fed holds no other office and must resign it first.` });
    if (await businessInterest(nom.user_id))
      return res.status(400).json({ error: 'They hold a business interest. Whoever sets the rate of interest must not be able to profit by it — they must close it out first.' });

    // 21.9: three cycles, deliberately longer than the office that appointed it.
    const terms = Math.max(1, num('fed_terms') || 3);
    const ends = new Date(Date.now() + terms * (num('cycle_days') || 7) * 86400000);
    await q("INSERT INTO offices(office,user_id) VALUES('fed_chair',$1)", [nom.user_id]);
    await q("UPDATE fed_nominations SET status='confirmed', settled_at=now(), term_ends=$2 WHERE id=$1", [nom.id, ends]);
    const who = (await q('SELECT display_name FROM users WHERE id=$1', [nom.user_id])).rows[0];
    log(req.user.id, 'fed.confirm', `${who?.display_name} confirmed, ${votes} of ${house}, until ${ends.toISOString().slice(0, 10)}`);
    res.json({ confirmed: true, votes, needed, house, term_ends: ends });
  }));

  app.post('/api/fed/refuse', auth, needEconomy, wrap(async (req, res) => {
    const nom = (await q("SELECT * FROM fed_nominations WHERE status='open' ORDER BY id DESC LIMIT 1")).rows[0];
    if (!nom) return res.status(400).json({ error: 'No nomination is before the House.' });
    if (!(await officesOf(req.user.id)).includes('speaker'))
      return res.status(403).json({ error: 'The Speaker declares the House\'s refusal.' });
    await q("UPDATE fed_nominations SET status='refused', settled_at=now() WHERE id=$1", [nom.id]);
    log(req.user.id, 'fed.refuse', `nomination ${nom.id} refused`);
    res.json({ ok: true });
  }));

  /* There is no dismissal endpoint, and that is the whole point of the office.
     A chair may lay it down themselves; the House may impeach at two thirds
     like any other officer. Nothing else reaches them. */
  app.post('/api/fed/resign', auth, needEconomy, wrap(async (req, res) => {
    const chair = await chairNow();
    if (!chair) return res.status(400).json({ error: 'The Fed has no head.' });
    if (chair.id !== req.user.id)
      return res.status(403).json({ error: 'Only the head of the Fed may lay the office down. The President may not dismiss them, and neither may the House except by impeachment.' });
    await q("UPDATE offices SET active=FALSE, until=now() WHERE user_id=$1 AND office='fed_chair' AND active", [chair.id]);
    log(req.user.id, 'fed.resign', chair.display_name);
    res.json({ ok: true });
  }));

  /* -------------------------------------------------------- Fed powers */

  const RATES = {
    deposit_rate: 'the rate paid on deposits at the public bank',
    loan_rate: 'the rate charged on loans by the public bank',
    loan_ceiling: 'the most one citizen may owe the public bank',
    reserve_ratio: 'the reserve a licensed bank must hold against its deposits'
  };

  app.post('/api/fed/rates', auth, needEconomy, wrap(async (req, res) => {
    if (!(await requireChair(req, res))) return;
    const reasons = clean(req.body?.reasons);
    if (reasons.length < 10)
      return res.status(400).json({ error: 'Article 21.12: the Fed publishes its reasons for every decision. Say why.' });
    const changed = [];
    for (const key of Object.keys(RATES)) {
      if (req.body?.[key] === undefined || req.body[key] === '') continue;
      const v = Number(req.body[key]);
      if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: `${key} must be a number that is not negative.` });
      if ((key === 'deposit_rate' || key === 'loan_rate' || key === 'reserve_ratio') && v > 1)
        return res.status(400).json({ error: `${key} is a share between 0 and 1.` });
      if (String(num(key)) === String(v)) continue;
      changed.push(`${key} ${num(key)} → ${v}`);
      await setConfig(key, v);
    }
    if (!changed.length) return res.status(400).json({ error: 'Nothing was changed.' });
    await loadConfig();
    const ref = await decide(req.user.id, 'rate', changed.join('; '), reasons.slice(0, 4000));
    res.json({ ok: true, ref, changed });
  }));

  app.post('/api/fed/issue', auth, needEconomy, wrap(async (req, res) => {
    if (!(await requireChair(req, res))) return;
    const amount = money(req.body?.amount);
    const reasons = clean(req.body?.reasons);
    if (amount <= 0) return res.status(400).json({ error: 'Issue something.' });
    if (reasons.length < 10) return res.status(400).json({ error: 'Say why. The Fed publishes its reasons for every decision.' });
    const t = await treasury();
    await issue(t.id, amount, 'issued to the Treasury');
    const ref = await decide(req.user.id, 'issue', `${amount} issued to the Treasury`, reasons.slice(0, 4000));
    res.json({ ok: true, ref, amount });
  }));

  app.post('/api/fed/retire', auth, needEconomy, wrap(async (req, res) => {
    if (!(await requireChair(req, res))) return;
    const amount = money(req.body?.amount);
    const reasons = clean(req.body?.reasons);
    if (amount <= 0) return res.status(400).json({ error: 'Retire something.' });
    if (reasons.length < 10) return res.status(400).json({ error: 'Say why. The Fed publishes its reasons for every decision.' });
    const t = await treasury();
    if (Number(t.balance) < amount)
      return res.status(400).json({
        error: `The Treasury holds ${t.balance}. Money is taken out of circulation from what the Treasury has, and it cannot hand back what it never had.`
      });
    try {
      await E().pay(t.id, (await fedAcc()).id, amount, 'retire', 'withdrawn from circulation');
    } catch (err) { return payErr(res, err); }
    const ref = await decide(req.user.id, 'retire', `${amount} taken out of circulation`, reasons.slice(0, 4000));
    res.json({ ok: true, ref, amount });
  }));

  /* ===================================================== PRIVATE BANKS */

  const bankView = async (b, userId) => {
    const a = await bankAcc(b.id);
    const dep = (await q('SELECT COALESCE(sum(amount),0)::bigint s FROM bank_deposits WHERE bank_id=$1', [b.id])).rows[0].s;
    const lent = (await q("SELECT COALESCE(sum(outstanding),0)::bigint s FROM bank_loans WHERE bank_id=$1 AND status<>'repaid'", [b.id])).rows[0].s;
    const mine = userId
      ? (await q('SELECT amount FROM bank_deposits WHERE bank_id=$1 AND user_id=$2', [b.id, userId])).rows[0]?.amount || 0
      : 0;
    const myLoans = userId
      ? (await q('SELECT * FROM bank_loans WHERE bank_id=$1 AND user_id=$2 ORDER BY taken_at DESC', [b.id, userId])).rows
      : [];
    return {
      ...b,
      reserves: Number(a.balance),
      deposits: Number(dep),
      lent: Number(lent),
      required_reserve: Math.round(Number(dep) * Number(b.reserve_ratio)),
      my_deposit: Number(mine),
      my_loans: myLoans,
      is_founder: userId === b.founder_id
    };
  };

  app.get('/api/banks', needEconomy, wrap(async (req, res) => {
    await loadConfig();
    const rows = (await q(`
      SELECT b.*, u.display_name AS founder_name FROM banks b
        LEFT JOIN users u ON u.id=b.founder_id ORDER BY b.created_at DESC`)).rows;
    const out = [];
    for (const b of rows) out.push(await bankView(b, req.user?.id || null));
    res.json({
      banks: out,
      charter_fee: num('bank_charter_fee'),
      reserve_ratio: num('reserve_ratio'),
      guarantee: num('deposit_guarantee'),
      i_am_chair: !!(req.user && await holds(req.user.id, 'fed_chair'))
    });
  }));

  /* Part 4.12: any citizen may apply. The Fed decides, on conditions it sets —
     but a refusal, like everything else the Fed does, comes with reasons. */
  app.post('/api/banks', auth, needEconomy, slowWrites, wrap(async (req, res) => {
    await loadConfig();
    const name = clean(req.body?.name).slice(0, 60);
    if (name.length < 3) return res.status(400).json({ error: 'A bank needs a name.' });
    if (await holds(req.user.id, 'fed_chair'))
      return res.status(403).json({ error: 'The head of the Fed licenses banks and may not own one.' });
    const capital = money(req.body?.capital);
    const fee = money(num('bank_charter_fee'));
    if (capital < fee) return res.status(400).json({ error: `A bank opens with at least ${fee} in capital.` });

    let bank;
    try {
      bank = (await q('INSERT INTO banks(name,founder_id,prospectus,reserve_ratio) VALUES($1,$2,$3,$4) RETURNING *',
        [name, req.user.id, clean(req.body?.prospectus).slice(0, 4000), num('reserve_ratio')])).rows[0];
    } catch (err) {
      if (err.code === '23505') return res.status(400).json({ error: 'A bank of that name already exists.' });
      throw err;
    }
    const from = await acc('citizen', req.user.id);
    try {
      await E().pay(from.id, (await bankAcc(bank.id)).id, capital, 'capital', `capital of ${name}`);
    } catch (err) {
      await q('DELETE FROM banks WHERE id=$1', [bank.id]);
      return payErr(res, err);
    }
    log(req.user.id, 'bank.apply', `${name}, capital ${capital}`);
    res.json(await bankView(bank, req.user.id));
  }));

  app.post('/api/banks/:id/licence', auth, needEconomy, wrap(async (req, res) => {
    if (!(await requireChair(req, res))) return;
    const b = (await q('SELECT * FROM banks WHERE id=$1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'No such bank.' });
    if (b.status === 'closed') return res.status(400).json({ error: 'That bank is closed.' });
    const reasons = clean(req.body?.reasons);
    if (reasons.length < 10) return res.status(400).json({ error: 'Say why. The Fed publishes its reasons for every decision.' });
    const ratio = req.body?.reserve_ratio === undefined ? Number(b.reserve_ratio) : Number(req.body.reserve_ratio);
    if (!(ratio >= 0) || ratio > 1) return res.status(400).json({ error: 'A reserve ratio is a share between 0 and 1.' });
    await q("UPDATE banks SET status='licensed', reserve_ratio=$2, licensed_by=$3, licensed_at=now(), reasons=$4 WHERE id=$1",
      [b.id, ratio, req.user.id, reasons.slice(0, 4000)]);
    const ref = await decide(req.user.id, 'licence', `${b.name} licensed at a reserve of ${ratio}`, reasons.slice(0, 4000));
    res.json({ ok: true, ref });
  }));

  app.post('/api/banks/:id/refuse', auth, needEconomy, wrap(async (req, res) => {
    if (!(await requireChair(req, res))) return;
    const b = (await q('SELECT * FROM banks WHERE id=$1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'No such bank.' });
    if (b.status === 'licensed') return res.status(400).json({ error: 'That bank is already licensed. Close it instead, and say why.' });
    const reasons = clean(req.body?.reasons);
    if (reasons.length < 10) return res.status(400).json({ error: 'Say why. A refusal without reasons is not a decision, it is a whim.' });
    await q("UPDATE banks SET status='refused', reasons=$2 WHERE id=$1", [b.id, reasons.slice(0, 4000)]);
    const ref = await decide(req.user.id, 'refusal', `${b.name} refused a licence`, reasons.slice(0, 4000));
    // The capital goes back where it came from. A refusal is not a fine.
    const held = Number((await bankAcc(b.id)).balance);
    if (held > 0 && b.founder_id)
      await E().pay((await bankAcc(b.id)).id, (await acc('citizen', b.founder_id)).id, held, 'refund', 'capital returned');
    res.json({ ok: true, ref, returned: held });
  }));

  /* Closure. Depositors are paid what the bank has, pro rata, and the Treasury
     tops each of them up to the guarantee — which is the whole reason a state
     guarantee exists. What the founder put in is gone: a bank that can fail
     without its owner losing anything is not a bank, it is a subsidy. */
  app.post('/api/banks/:id/close', auth, needEconomy, wrap(async (req, res) => {
    await loadConfig();
    if (!(await requireChair(req, res))) return;
    const b = (await q('SELECT * FROM banks WHERE id=$1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'No such bank.' });
    if (b.status === 'closed') return res.status(400).json({ error: 'That bank is already closed.' });
    const reasons = clean(req.body?.reasons);
    if (reasons.length < 10) return res.status(400).json({ error: 'Say why. Closing a bank is the gravest thing the Fed does.' });

    const ba = await bankAcc(b.id);
    const t = await treasury();
    const cap = money(num('deposit_guarantee'));
    const deps = (await q('SELECT * FROM bank_deposits WHERE bank_id=$1 AND amount > 0', [b.id])).rows;
    const total = deps.reduce((n, d) => n + Number(d.amount), 0);
    let held = Number(ba.balance);
    let paid = 0, guaranteed = 0;

    for (const d of deps) {
      const owed = Number(d.amount);
      const share = total > 0 ? Math.min(owed, Math.floor((held * owed) / total)) : 0;
      const to = (await acc('citizen', d.user_id)).id;
      if (share > 0) { await E().pay(ba.id, to, share, 'resolution', `${b.name} wound up`); paid += share; }
      const top = Math.min(cap, owed) - share;
      if (top > 0) {
        /* The guarantee is the Treasury's, and the Treasury is allowed to run a
           deficit — a guarantee contingent on the state being in surplus is not
           a guarantee. Balances are moved directly for that reason. */
        await q('UPDATE accounts SET balance = balance - $1::bigint WHERE id=$2', [top, t.id]);
        await q('UPDATE accounts SET balance = balance + $1::bigint WHERE id=$2', [top, to]);
        await q('INSERT INTO ledger(from_id,to_id,amount,kind,note) VALUES($1,$2,$3,$4,$5)',
          [t.id, to, top, 'guarantee', `${b.name} wound up`]);
        guaranteed += top;
      }
    }
    await q('UPDATE bank_deposits SET amount=0 WHERE bank_id=$1', [b.id]);
    // Anything left over goes to the Treasury, which has just paid the guarantee.
    const rest = Number((await bankAcc(b.id)).balance);
    if (rest > 0) await E().pay(ba.id, t.id, rest, 'resolution', `${b.name} residue`);
    // Debts survive the lender. They are owed to the Treasury now.
    await q("UPDATE bank_loans SET status='default' WHERE bank_id=$1 AND status='open'", [b.id]);
    await q("UPDATE banks SET status='closed', closed_at=now(), reasons=$2 WHERE id=$1", [b.id, reasons.slice(0, 4000)]);
    const ref = await decide(req.user.id, 'closure',
      `${b.name} closed — ${paid} paid from its reserves, ${guaranteed} under the guarantee`, reasons.slice(0, 4000));
    res.json({ ok: true, ref, paid, guaranteed });
  }));

  /* A licensed bank sets its own rates. That is what licensing them is for. */
  app.post('/api/banks/:id/rates', auth, needEconomy, wrap(async (req, res) => {
    const b = (await q('SELECT * FROM banks WHERE id=$1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'No such bank.' });
    if (b.founder_id !== req.user.id) return res.status(403).json({ error: 'Only the bank that holds the licence sets its rates.' });
    if (b.status !== 'licensed') return res.status(400).json({ error: 'That bank is not licensed.' });
    const d = Number(req.body?.deposit_rate), l = Number(req.body?.loan_rate);
    if (!(d >= 0 && d <= 1) || !(l >= 0 && l <= 1)) return res.status(400).json({ error: 'Rates are shares between 0 and 1.' });
    await q('UPDATE banks SET deposit_rate=$2, loan_rate=$3 WHERE id=$1', [b.id, d, l]);
    log(req.user.id, 'bank.rates', `${b.name}: deposits ${d}, loans ${l}`);
    res.json({ ok: true });
  }));

  const openBank = async id => {
    const b = (await q('SELECT * FROM banks WHERE id=$1', [id])).rows[0];
    if (!b) return { error: 'No such bank.', status: 404 };
    if (b.status !== 'licensed') return { error: 'That bank is not licensed. Only a licensed bank may take deposits or lend.', status: 400 };
    return { bank: b };
  };

  app.post('/api/banks/:id/deposit', auth, needEconomy, wrap(async (req, res) => {
    const { bank, error, status } = await openBank(req.params.id);
    if (error) return res.status(status).json({ error });
    const from = await acc('citizen', req.user.id);
    const amt = money(req.body?.amount);
    try {
      await E().pay(from.id, (await bankAcc(bank.id)).id, amt, 'deposit', `to ${bank.name}`);
    } catch (err) { return payErr(res, err); }
    await q(`INSERT INTO bank_deposits(bank_id,user_id,amount) VALUES($1,$2,$3)
               ON CONFLICT (bank_id,user_id) DO UPDATE SET amount = bank_deposits.amount + $3`,
      [bank.id, req.user.id, amt]);
    log(req.user.id, 'bank.deposit', `${amt} at ${bank.name}`);
    res.json({ ok: true });
  }));

  app.post('/api/banks/:id/withdraw', auth, needEconomy, wrap(async (req, res) => {
    const b = (await q('SELECT * FROM banks WHERE id=$1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'No such bank.' });
    const amt = money(req.body?.amount);
    const d = (await q('SELECT amount FROM bank_deposits WHERE bank_id=$1 AND user_id=$2', [b.id, req.user.id])).rows[0];
    if (!d || Number(d.amount) < amt) return res.status(400).json({ error: 'You do not have that much on deposit there.' });
    const ba = await bankAcc(b.id);
    if (Number(ba.balance) < amt)
      return res.status(400).json({ error: `${b.name} cannot meet that withdrawal. This is what a run looks like — tell the Fed.` });
    await E().pay(ba.id, (await acc('citizen', req.user.id)).id, amt, 'withdrawal', `from ${b.name}`);
    await q('UPDATE bank_deposits SET amount = amount - $1::bigint WHERE bank_id=$2 AND user_id=$3', [amt, b.id, req.user.id]);
    log(req.user.id, 'bank.withdraw', `${amt} from ${b.name}`);
    res.json({ ok: true });
  }));

  /* Part 4.14: no bank may lend more than the Fed permits against its deposits.
     The reserve is checked against what the bank would hold AFTER the loan, or
     the ratio would be advisory. */
  app.post('/api/banks/:id/borrow', auth, needEconomy, wrap(async (req, res) => {
    await loadConfig();
    const { bank, error, status } = await openBank(req.params.id);
    if (error) return res.status(status).json({ error });
    const amt = money(req.body?.amount);
    if (amt <= 0) return res.status(400).json({ error: 'Borrow something.' });
    const ba = await bankAcc(bank.id);
    const deposits = Number((await q('SELECT COALESCE(sum(amount),0)::bigint s FROM bank_deposits WHERE bank_id=$1', [bank.id])).rows[0].s);
    const after = Number(ba.balance) - amt;
    const required = Math.round(deposits * Number(bank.reserve_ratio));
    if (after < required)
      return res.status(400).json({ error: `${bank.name} must keep ${required} in reserve against its deposits and would be left with ${after}. The Fed sets that ratio.` });
    if (after < 0) return res.status(400).json({ error: `${bank.name} does not hold that much.` });

    await E().pay(ba.id, (await acc('citizen', req.user.id)).id, amt, 'loan', `from ${bank.name}`);
    const cycles = Math.max(1, Math.min(12, parseInt(req.body?.cycles, 10) || 4));
    const { rows } = await q(
      'INSERT INTO bank_loans(bank_id,user_id,principal,outstanding,rate,due_cycle) VALUES($1,$2,$3,$3,$4,$5) RETURNING *',
      [bank.id, req.user.id, amt, Number(bank.loan_rate), (Number(req.body?.cycle_no) || cycleNow()?.number || 0) + cycles]);
    log(req.user.id, 'bank.borrow', `${amt} from ${bank.name}`);
    res.json(rows[0]);
  }));

  app.post('/api/banks/:id/repay', auth, needEconomy, wrap(async (req, res) => {
    const b = (await q('SELECT * FROM banks WHERE id=$1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'No such bank.' });
    const loan = (await q("SELECT * FROM bank_loans WHERE id=$1 AND bank_id=$2 AND user_id=$3 AND status<>'repaid'",
      [req.body?.loan_id || 0, b.id, req.user.id])).rows[0];
    if (!loan) return res.status(404).json({ error: 'No such loan of yours at that bank.' });
    const amt = Math.min(money(req.body?.amount), Number(loan.outstanding));
    if (amt <= 0) return res.status(400).json({ error: 'Repay something.' });
    /* A debt outlives the lender. Where the bank has been wound up the money is
       owed to the Treasury, which paid the guarantee out of its own pocket. */
    const to = b.status === 'closed' ? (await treasury()).id : (await bankAcc(b.id)).id;
    try {
      await E().pay((await acc('citizen', req.user.id)).id, to, amt, 'repayment', `loan ${loan.id}`);
    } catch (err) { return payErr(res, err); }
    const left = Number(loan.outstanding) - amt;
    await q('UPDATE bank_loans SET outstanding=$1::bigint, status=$2, settled_at=$3 WHERE id=$4',
      [left, left <= 0 ? 'repaid' : loan.status, left <= 0 ? new Date() : null, loan.id]);
    log(req.user.id, 'bank.repay', `${amt} against loan ${loan.id} at ${b.name}`);
    res.json({ ok: true, outstanding: left });
  }));

  /* Interest at the private banks, run with the rest of the payrun. A bank pays
     its depositors out of its own reserves and is charged nothing it does not
     have — a bank that cannot pay its interest is exactly the bank the Fed
     ought to be closing, and the shortfall is left visible rather than
     conjured. */
  async function runPayrun(cycleNo, actorId) {
    await loadConfig();
    const already = (await q('SELECT 1 FROM payruns WHERE kind=$1 AND cycle_no=$2', ['banks', cycleNo])).rows[0];
    if (already) return { reason: 'already run for this cycle' };
    let credited = 0, charged = 0, defaults = 0, short = 0;

    for (const b of (await q("SELECT * FROM banks WHERE status='licensed'")).rows) {
      const ba = await bankAcc(b.id);
      for (const d of (await q('SELECT * FROM bank_deposits WHERE bank_id=$1 AND amount > 0', [b.id])).rows) {
        const interest = money(Number(d.amount) * Number(b.deposit_rate));
        if (interest <= 0) continue;
        const have = Number((await bankAcc(b.id)).balance);
        if (have < interest) { short++; continue; }
        // The reserves fall and the depositor's claim rises: the bank pays it.
        await q('UPDATE bank_deposits SET amount = amount + $1::bigint WHERE bank_id=$2 AND user_id=$3',
          [interest, b.id, d.user_id]);
        await q('INSERT INTO ledger(from_id,to_id,amount,kind,note) VALUES($1,$2,$3,$4,$5)',
          [ba.id, ba.id, interest, 'interest', `${b.name}, cycle ${cycleNo}`]);
        credited += interest;
      }
      for (const l of (await q("SELECT * FROM bank_loans WHERE bank_id=$1 AND status='open'", [b.id])).rows) {
        const interest = money(Number(l.outstanding) * Number(l.rate));
        if (interest > 0) {
          await q('UPDATE bank_loans SET outstanding = outstanding + $1::bigint WHERE id=$2', [interest, l.id]);
          charged += interest;
        }
        if (l.due_cycle && cycleNo > l.due_cycle) {
          await q("UPDATE bank_loans SET status='default' WHERE id=$1 AND status='open'", [l.id]);
          defaults++;
        }
      }
    }
    await q('INSERT INTO payruns(kind,cycle_no,detail) VALUES($1,$2,$3)',
      ['banks', cycleNo, `${credited} credited, ${charged} charged, ${defaults} in default, ${short} unpaid`]);
    log(actorId, 'banks.interest', `cycle ${cycleNo}: ${credited} credited, ${charged} charged, ${defaults} defaulted, ${short} unpaid`);
    return { credited, charged, defaults, short };
  }

  /* What the rest of the Republic may ask this module. economy.js calls
     runPayrun from the payrun, and checks fedChairBarred before letting anyone
     acquire a business interest. */
  ctx.money = {
    runPayrun,
    businessInterest,
    /* Part 8 and Article 21: the one person who may not own a piece of the
       economy is the one who sets the price of money in it. */
    fedChairBarred: async userId =>
      (await holds(userId, 'fed_chair'))
        ? 'The head of the Fed may hold no business interest at all. Whoever sets the rate of interest must not be able to profit by it.'
        : null
  };
};
