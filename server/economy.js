/* The Creation of an Economy Act.

   Stages one to three: money, the state's take and spend, and enterprise.
   Banking and the market in shares are not built yet — Part 9 of the Act says
   each part comes into force as it is built, and that the Returning Officer says
   so publicly rather than building something different in silence. This is that.

   Everything is integer minor units. Never floats: 0.1 + 0.2 is not 0.3 and a
   currency that cannot add up is not a currency. */

module.exports.mount = function mount(app, ctx) {
  const GOOD_CATEGORIES = new Set([
    'food',
    'raw_materials',
    'energy',
    'industrial_goods',
    'technology',
    'arms',
    'luxury',
    'services'
  ]);
  const goodsMode = () => String(ctx.CONFIG.goods_economy_enabled) === 'true';
  const { q, tx, log, auth, admin, wrap, num, bool, loadConfig, officesOf, citizenCount, slowWrites,
    requireScope, attribute } = ctx;

  const money = n => Math.round(Number(n) || 0);

  /* A spending cap belongs to the key, not the citizen — the citizen's own
     balance is the real limit when they act directly. Sums what that key has
     actually moved (api_key_charges, written by chargeKey below) inside the
     trailing window, so the cap can't be bypassed by pacing requests across a
     restart the way an in-memory counter could be. Refuses BEFORE pay() runs,
     the same "check first" shape pay() itself uses for an overdraft. */
  async function checkKeyCap(req, amount) {
    const key = req.apiKey;
    if (!key || key.cap_amount == null) return;
    const { rows } = await q(
      `SELECT COALESCE(sum(amount),0)::bigint spent FROM api_key_charges
        WHERE key_id=$1 AND at > now() - ($2 || ' milliseconds')::interval`,
      [key.id, String(key.cap_window_ms)]);
    const spent = Number(rows[0].spent);
    if (spent + money(amount) > Number(key.cap_amount))
      throw Object.assign(
        new Error(`This key's spending cap is ${key.cap_amount} per ${Math.round(key.cap_window_ms / 3600000)}h; it has ${spent} spent already.`),
        { code: 'AMOUNT' });
  }
  const chargeKey = (req, amount) =>
    req.apiKey ? q('INSERT INTO api_key_charges(key_id,amount) VALUES($1,$2)', [req.apiKey.id, money(amount)]).catch(() => {}) : null;

  /* ------------------------------------------------------------- accounts */

  async function accountFor(kind, id) {
    const found = (
      await q('SELECT * FROM accounts WHERE owner_kind=$1 AND owner_id IS NOT DISTINCT FROM $2', [kind, id])
    ).rows[0];
    if (found) return found;
    const { rows } = await q('INSERT INTO accounts(owner_kind,owner_id) VALUES($1,$2) RETURNING *', [
      kind,
      id
    ]);
    return rows[0];
  }
  const treasury = () => accountFor('treasury', null);
  /* Escrow is its own account, not the Treasury's. The Treasury is allowed to run
     a deficit paying the dividend, and money held on behalf of a buyer must never
     be caught up in that — it is not the state's money. */
  const escrowAcc = () => accountFor('escrow', null);

  /* The only way money ever moves. Balances and the ledger are written together,
     and a payment that would overdraw simply does not happen.

     Both halves of that sentence need a transaction to be true. The balance is
     read, compared and written, so without a row lock two payments of the whole
     balance can both read it, both pass the check and both go through — and
     unlike the stockpile there is no CHECK constraint to catch the result,
     because the Fed and the Treasury are supposed to go negative. FOR UPDATE
     makes the second payment wait for the first to commit and then see the
     balance it actually left behind.

     `run` is an existing transaction runner, for callers that need this to be
     part of a larger atomic step. Left out, it opens its own. */
  async function pay(fromAcc, toAcc, amount, kind, note = '', run = null) {
    const amt = money(amount);
    if (amt <= 0) throw Object.assign(new Error('Amount must be positive.'), { code: 'AMOUNT' });
    if (!run) return tx(r => pay(fromAcc, toAcc, amount, kind, note, r));
    if (fromAcc) {
      const bal = (await run('SELECT balance FROM accounts WHERE id=$1 FOR UPDATE', [fromAcc])).rows[0]?.balance ?? 0;
      if (Number(bal) < amt)
        throw Object.assign(new Error('There is not enough in that account.'), { code: 'FUNDS' });
      await run('UPDATE accounts SET balance = balance - $1 WHERE id=$2', [amt, fromAcc]);
    }
    if (toAcc) await run('UPDATE accounts SET balance = balance + $1 WHERE id=$2', [amt, toAcc]);
    await run('INSERT INTO ledger(from_id,to_id,amount,kind,note) VALUES($1,$2,$3,$4,$5)', [
      fromAcc || null,
      toAcc || null,
      amt,
      kind,
      note.slice(0, 300)
    ]);
    return amt;
  }

  /* The same movement, for the payers who are allowed to go below zero: the Fed
     issuing, the Treasury paying the dividend, a guarantee, an army's wages.
     pay() refuses an overdraft by design and those callers used to write both
     balances by hand — four separate places doing it, each of them three
     unprotected statements. They all come through here now, so there is one
     place where money moves without a funds check and it is still atomic and
     still writes the ledger. */
  async function settle(fromAcc, toAcc, amount, kind, note = '', run = null) {
    const amt = money(amount);
    if (amt <= 0) throw Object.assign(new Error('Amount must be positive.'), { code: 'AMOUNT' });
    if (!run) return tx(r => settle(fromAcc, toAcc, amount, kind, note, r));
    if (fromAcc) await run('UPDATE accounts SET balance = balance - $1::bigint WHERE id=$2', [amt, fromAcc]);
    if (toAcc) await run('UPDATE accounts SET balance = balance + $1::bigint WHERE id=$2', [amt, toAcc]);
    await run('INSERT INTO ledger(from_id,to_id,amount,kind,note) VALUES($1,$2,$3,$4,$5)',
      [fromAcc || null, toAcc || null, amt, kind, String(note).slice(0, 300)]);
    return amt;
  }

  const payErr = (res, err) => {
    if (err.code === 'FUNDS' || err.code === 'AMOUNT') return res.status(400).json({ error: err.message });
    throw err;
  };

  async function addInventoryItem(ownerId, item, run = q) {
    const category = GOOD_CATEGORIES.has(item?.good_category) ? item.good_category : null;
    if (!category) return null;
    const sourceKind = ['domestic_listing', 'foreign_offer'].includes(item?.source_kind)
      ? item.source_kind
      : null;
    const sourceId = String(item?.source_id || '');
    if (!sourceKind || !/^[1-9]\d*$/.test(sourceId)) return null;
    return (
      await run(
        `INSERT INTO inventory_items(owner_id,title,description,good_category,unit,quantity,source_kind,source_id,source_name)
         VALUES($1,$2,$3,$4,$5,1,$6,$7,$8)
         ON CONFLICT (owner_id,source_kind,source_id) DO UPDATE
           SET quantity=inventory_items.quantity+1,
               title=EXCLUDED.title, description=EXCLUDED.description, good_category=EXCLUDED.good_category,
               unit=EXCLUDED.unit, source_name=EXCLUDED.source_name, updated_at=now()
         RETURNING *`,
        [
          ownerId,
          String(item.title || 'Strategic good').slice(0, 120),
          String(item.description || '').slice(0, 4000),
          category,
          String(item.unit || 'unit').slice(0, 80),
          sourceKind,
          sourceId,
          String(item.source_name || '').slice(0, 160)
        ]
      )
    ).rows[0];
  }

  app.get(
    '/api/economy/me',
    auth,
    wrap(async (req, res) => {
      await loadConfig();
      const acc = await accountFor('citizen', req.user.id);
      const recent = (
        await q(
          `
      SELECT l.*, af.owner_kind AS from_kind, af.owner_id AS from_id_owner,
             at.owner_kind AS to_kind, at.owner_id AS to_id_owner
        FROM ledger l
        LEFT JOIN accounts af ON af.id = l.from_id
        LEFT JOIN accounts at ON at.id = l.to_id
       WHERE l.from_id=$1 OR l.to_id=$1 ORDER BY l.at DESC LIMIT 30`,
          [acc.id]
        )
      ).rows;
      const mine = (
        await q(
          `
      SELECT b.* FROM businesses b JOIN business_members m ON m.business_id=b.id
       WHERE m.user_id=$1 AND b.closed_at IS NULL`,
          [req.user.id]
        )
      ).rows;
      res.json({
        account: acc,
        ledger: recent,
        businesses: mine,
        currency: ctx.CONFIG.currency_name || 'Mark'
      });
    })
  );

  app.get(
    '/api/economy/inventory',
    auth,
    wrap(async (req, res) => {
      const { rows } = await q(
        `SELECT * FROM inventory_items
          WHERE owner_id=$1 AND quantity > 0
          ORDER BY good_category, title, id`,
        [req.user.id]
      );
      res.json(rows);
    })
  );

  app.get(
    '/api/economy',
    wrap(async (_req, res) => {
      await loadConfig();
      const t = await treasury();
      const supply = (await q('SELECT COALESCE(sum(balance),0)::bigint s FROM accounts')).rows[0].s;
      const holders = (
        await q(`
      SELECT u.id, u.display_name, a.balance
        FROM accounts a JOIN users u ON u.id = a.owner_id
       WHERE a.owner_kind='citizen' AND u.is_active AND u.approved
       ORDER BY a.balance DESC`)
      ).rows;
      const biz = (
        await q(`
      SELECT b.*, u.display_name AS founder_name, a.balance,
             (SELECT count(*)::int FROM business_members m WHERE m.business_id=b.id) AS members,
             (SELECT count(*)::int FROM listings l WHERE l.business_id=b.id AND NOT l.withdrawn) AS listings
        FROM businesses b
        LEFT JOIN users u ON u.id=b.founder_id
        LEFT JOIN accounts a ON a.owner_kind='business' AND a.owner_id=b.id
       WHERE b.closed_at IS NULL ORDER BY b.created_at`)
      ).rows;
      res.json({
        currency: ctx.CONFIG.currency_name || 'Mark',
        symbol: ctx.CONFIG.currency_symbol || 'M',
        treasury: t.balance,
        supply,
        holders,
        businesses: biz,
        dividend: num('dividend'),
        tax_rate: num('tax_rate'),
        tax_free: num('tax_free_allowance')
      });
    })
  );

  // The trace this codebase's traps ask for: a key with only the implicit
  // read scope reaches requireScope('economy:pay') and is refused with a 403
  // before a single query runs — pay() below is never called for it.
  app.post(
    '/api/economy/transfer',
    requireScope('economy:pay'),
    slowWrites,
    wrap(async (req, res) => {
      const to = (
        await q('SELECT id, display_name FROM users WHERE id=$1 AND is_active AND approved', [
          req.body?.user_id || 0
        ])
      ).rows[0];
      if (!to) return res.status(400).json({ error: 'Name a citizen to pay.' });
      if (to.id === req.user.id) return res.status(400).json({ error: 'You cannot pay yourself.' });
      const from = await accountFor('citizen', req.user.id);
      const dest = await accountFor('citizen', to.id);
      try {
        await checkKeyCap(req, req.body?.amount);
        const amt = await pay(from.id, dest.id, req.body?.amount, 'transfer', String(req.body?.note || ''));
        await chargeKey(req, amt);
        log(req.user.id, 'money.transfer', attribute(`${amt} to ${to.display_name}`, req));
        res.json({ ok: true });
      } catch (err) {
        return payErr(res, err);
      }
    })
  );

  /* ---------------------------------------------------- dividend and tax */

  /* Part 2: paid to every citizen, every cycle, without condition. The payrun
     table makes a cycle's dividend unrepeatable however many times this runs. */
  async function runDividend(cycleNo, actorId) {
    await loadConfig();
    const amount = money(num('dividend'));
    if (amount <= 0) return { paid: 0, reason: 'dividend is set to nothing' };
    const already = (await q('SELECT 1 FROM payruns WHERE kind=$1 AND cycle_no=$2', ['dividend', cycleNo]))
      .rows[0];
    if (already) return { paid: 0, reason: 'already paid for this cycle' };

    const t = await treasury();
    const citizens = (await q('SELECT id FROM users WHERE is_active AND approved')).rows;
    // A citizen who has renounced draws no dividend — offshore.js clears their
    // offices the moment they defect, and the dividend goes the same way, or a
    // foreign subject would be paid by a Treasury they no longer answer to.
    const defected = new Set(ctx.offshore?.defectors ? await ctx.offshore.defectors() : []);
    let paid = 0;
    for (const c of citizens) {
      if (defected.has(c.id)) continue;
      const acc = await accountFor('citizen', c.id);
      // The Treasury may run a deficit on the dividend: the floor is not conditional
      // on the state being solvent, or it is not a floor.
      await settle(t.id, acc.id, amount, 'dividend', `cycle ${cycleNo}`);
      paid++;
    }
    await q('INSERT INTO payruns(kind,cycle_no,detail) VALUES($1,$2,$3)', [
      'dividend',
      cycleNo,
      `${paid} citizens at ${amount}`
    ]);
    log(actorId, 'economy.dividend', `cycle ${cycleNo}: ${paid} citizens paid ${amount} each`);
    return { paid, amount };
  }

  async function runSalaries(cycleNo, actorId) {
    await loadConfig();
    const rates = {
      president: money(num('salary_president')),
      speaker: money(num('salary_speaker')),
      mp: money(num('salary_mp')),
      justice: money(num('salary_justice')),
      treasurer: money(num('salary_treasurer')),
      foreign_minister: money(num('salary_foreign_minister')),
      quartermaster: money(num('salary_quartermaster')),
      fed_chair: money(num('salary_fed_chair'))
    };
    const already = (await q('SELECT 1 FROM payruns WHERE kind=$1 AND cycle_no=$2', ['salary', cycleNo]))
      .rows[0];
    if (already) return { paid: 0, reason: 'already paid for this cycle' };
    const t = await treasury();
    const held = (await q('SELECT office, user_id FROM offices WHERE active')).rows;
    let paid = 0,
      total = 0;
    for (const o of held) {
      const amount = rates[o.office] || 0;
      if (amount <= 0) continue;
      const acc = await accountFor('citizen', o.user_id);
      await settle(t.id, acc.id, amount, 'salary', `${o.office}, cycle ${cycleNo}`);
      paid++;
      total += amount;
    }
    await q('INSERT INTO payruns(kind,cycle_no,detail) VALUES($1,$2,$3)', [
      'salary',
      cycleNo,
      `${paid} officers, ${total} total`
    ]);
    log(actorId, 'economy.salaries', `cycle ${cycleNo}: ${paid} officers paid`);
    return { paid, total };
  }

  /* Part 6: taxation is progressive. Everything up to the allowance is untaxed;
     the rate applies only to the balance above it, and rises with a second band. */
  function taxOn(balance) {
    const free = money(num('tax_free_allowance'));
    const base = Number(num('tax_rate')) || 0;
    const upper = Number(num('tax_rate_upper')) || base;
    const threshold = money(num('tax_upper_threshold'));
    const b = Number(balance);
    if (b <= free) return 0;
    if (threshold > free && b > threshold) {
      return money((threshold - free) * base + (b - threshold) * upper);
    }
    return money((b - free) * base);
  }

  async function runTax(cycleNo, actorId) {
    await loadConfig();
    const already = (await q('SELECT 1 FROM payruns WHERE kind=$1 AND cycle_no=$2', ['tax', cycleNo]))
      .rows[0];
    if (already) return { taken: 0, reason: 'already collected for this cycle' };
    const t = await treasury();
    const accs = (
      await q(`
      SELECT a.id, a.balance, u.id AS user_id, u.display_name FROM accounts a
        JOIN users u ON u.id = a.owner_id
       WHERE a.owner_kind='citizen' AND u.is_active AND u.approved AND a.balance > 0`)
    ).rows;
    // A defector's domestic account is frozen at the database — the ledger trigger
    // refuses any row that pays FROM it — so trying to collect tax from one would
    // throw mid-loop and take the rest of the payrun down with it. Their holdings
    // sit exactly where they were left; the House can move them by bill.
    const defected = new Set(ctx.offshore?.defectors ? await ctx.offshore.defectors() : []);
    let taken = 0,
      from = 0;
    for (const a of accs) {
      if (defected.has(a.user_id)) continue;
      const due = Math.min(taxOn(a.balance), Number(a.balance));
      if (due <= 0) continue;
      await pay(a.id, t.id, due, 'tax', `cycle ${cycleNo}`);
      taken += due;
      from++;
    }
    await q('INSERT INTO payruns(kind,cycle_no,detail) VALUES($1,$2,$3)', [
      'tax',
      cycleNo,
      `${taken} from ${from}`
    ]);
    log(actorId, 'economy.tax', `cycle ${cycleNo}: ${taken} collected from ${from} citizens`);
    return { taken, from };
  }

  app.post(
    '/api/economy/payrun',
    admin,
    wrap(async (req, res) => {
      const cycle = Number(req.body?.cycle_no);
      if (!Number.isFinite(cycle)) return res.status(400).json({ error: 'Say which cycle this is for.' });
      const out = {};
      if (req.body?.tax !== false) out.tax = await runTax(cycle, req.user.id);
      if (req.body?.dividend !== false) out.dividend = await runDividend(cycle, req.user.id);
      if (req.body?.salaries !== false) out.salaries = await runSalaries(cycle, req.user.id);
      if (req.body?.interest !== false) out.interest = await runInterest(cycle, req.user.id);
      if (req.body?.banks !== false && ctx.money?.runPayrun)
        out.banks = await ctx.money.runPayrun(cycle, req.user.id);
      // Forces eat every cycle whether or not anyone is looking at them.
      if (req.body?.upkeep !== false && ctx.war?.runUpkeep)
        out.upkeep = await ctx.war.runUpkeep(cycle, req.user.id);
      /* After upkeep, so this cycle's readiness is the readiness that counts. */
      if (req.body?.conflicts !== false && ctx.war?.runConflicts)
        out.conflicts = await ctx.war.runConflicts(cycle, req.user.id);
      if (req.body?.diplomacy !== false && ctx.diplomacy?.runPayrun)
        out.diplomacy = await ctx.diplomacy.runPayrun(cycle, req.user.id);
      // Havens freeze or thaw, and one fixing per power for this cycle. After
      // diplomacy and war, so this cycle's trade and pressure are the numbers
      // the fixing reads.
      if (req.body?.offshore !== false && ctx.offshore?.runPayrun)
        out.offshore = await ctx.offshore.runPayrun(cycle, req.user.id);
      res.json(out);
    })
  );

  app.get(
    '/api/economy/payruns',
    wrap(async (_req, res) => {
      res.json((await q('SELECT * FROM payruns ORDER BY at DESC LIMIT 40')).rows);
    })
  );

  /* -------------------------------------------------------- enterprise */

  app.post(
    '/api/economy/businesses',
    auth,
    slowWrites,
    wrap(async (req, res) => {
      await loadConfig();
      const { name, form, description, good_category } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'A business needs a name.' });
      const barred = ctx.money && (await ctx.money.fedChairBarred(req.user.id));
      if (barred) return res.status(403).json({ error: barred });
      const f = ['sole', 'company', 'coop'].includes(form) ? form : 'sole';
      const category = GOOD_CATEGORIES.has(good_category) ? good_category : null;
      if (goodsMode() && !category)
        return res.status(400).json({ error: 'Choose what kind of good this business produces.' });
      const dupe = (await q('SELECT 1 FROM businesses WHERE lower(name)=lower($1)', [String(name).trim()]))
        .rows[0];
      if (dupe) return res.status(409).json({ error: 'A business of that name already exists.' });
      const fee = money(num('registration_fee'));
      const acc = await accountFor('citizen', req.user.id);
      if (fee > 0) {
        try {
          await pay(acc.id, (await treasury()).id, fee, 'fee', 'business registration');
        } catch (err) {
          return payErr(res, err);
        }
      }
      const { rows } = await q(
        'INSERT INTO businesses(name,form,description,good_category,founder_id) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [String(name).trim().slice(0, 80), f, String(description || '').slice(0, 2000), category, req.user.id]
      );
      await q('INSERT INTO business_members(business_id,user_id) VALUES($1,$2)', [rows[0].id, req.user.id]);
      await accountFor('business', rows[0].id);
      log(req.user.id, 'economy.found', rows[0].name);
      res.json(rows[0]);
    })
  );

  const memberOf = async (businessId, userId) =>
    !!(await q('SELECT 1 FROM business_members WHERE business_id=$1 AND user_id=$2', [businessId, userId]))
      .rows[0];

  app.get(
    '/api/economy/businesses/:id',
    wrap(async (req, res) => {
      const b = (
        await q(
          `
      SELECT b.*, u.display_name AS founder_name, a.balance
        FROM businesses b LEFT JOIN users u ON u.id=b.founder_id
        LEFT JOIN accounts a ON a.owner_kind='business' AND a.owner_id=b.id
       WHERE b.id=$1`,
          [req.params.id]
        )
      ).rows[0];
      if (!b) return res.status(404).json({ error: 'No such business.' });
      const members = (
        await q(
          `
      SELECT u.id, u.display_name FROM business_members m JOIN users u ON u.id=m.user_id
       WHERE m.business_id=$1`,
          [b.id]
        )
      ).rows;
      const listings = (
        await q('SELECT * FROM listings WHERE business_id=$1 AND NOT withdrawn ORDER BY created_at', [b.id])
      ).rows;
      const orders = (
        await q(
          `
      SELECT o.*, u.display_name AS buyer_name, l.title
        FROM orders o LEFT JOIN users u ON u.id=o.buyer_id LEFT JOIN listings l ON l.id=o.listing_id
       WHERE o.business_id=$1 ORDER BY o.created_at DESC LIMIT 40`,
          [b.id]
        )
      ).rows;
      res.json({
        ...b,
        members,
        listings,
        orders,
        mine: req.user ? await memberOf(b.id, req.user.id) : false
      });
    })
  );

  app.put(
    '/api/economy/businesses/:id/good-category',
    auth,
    wrap(async (req, res) => {
      await loadConfig();
      if (!goodsMode()) return res.status(400).json({ error: 'Strategic goods mode is not enabled.' });
      if (!(await memberOf(req.params.id, req.user.id)))
        return res.status(403).json({ error: 'Only the owners may classify a business.' });
      const category = GOOD_CATEGORIES.has(req.body?.good_category) ? req.body.good_category : null;
      if (!category) return res.status(400).json({ error: 'Choose a valid good category.' });
      const row = (
        await q('UPDATE businesses SET good_category=$1 WHERE id=$2 RETURNING *', [category, req.params.id])
      ).rows[0];
      await q('UPDATE listings SET good_category=$1 WHERE business_id=$2 AND NOT withdrawn', [
        category,
        req.params.id
      ]);
      log(req.user.id, 'economy.classify', `${row.name}: ${category}`);
      res.json(row);
    })
  );

  app.post(
    '/api/economy/businesses/:id/listings',
    auth,
    wrap(async (req, res) => {
      if (!(await memberOf(req.params.id, req.user.id)))
        return res.status(403).json({ error: 'Only the owners may list for a business.' });
      await loadConfig();
      const { title, description, price, stock, unit } = req.body || {};
      if (!title) return res.status(400).json({ error: 'A listing needs a title.' });
      const biz = (await q('SELECT good_category FROM businesses WHERE id=$1', [req.params.id])).rows[0];
      if (goodsMode() && !biz?.good_category)
        return res
          .status(400)
          .json({ error: 'Classify this business before listing goods in strategic goods mode.' });
      const listingUnit = goodsMode()
        ? String(unit || 'unit')
            .trim()
            .slice(0, 40) || 'unit'
        : 'unit';
      const p = money(price);
      if (p < 0) return res.status(400).json({ error: 'A price cannot be negative.' });
      const { rows } = await q(
        'INSERT INTO listings(business_id,title,description,good_category,unit,price,stock) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [
          req.params.id,
          String(title).slice(0, 120),
          String(description || '').slice(0, 2000),
          goodsMode() ? biz?.good_category : null,
          listingUnit,
          p,
          stock === '' || stock === null || stock === undefined ? null : Math.max(0, parseInt(stock, 10) || 0)
        ]
      );
      res.json(rows[0]);
    })
  );

  app.post(
    '/api/economy/listings/:id/withdraw',
    auth,
    wrap(async (req, res) => {
      const l = (await q('SELECT * FROM listings WHERE id=$1', [req.params.id])).rows[0];
      if (!l) return res.status(404).json({ error: 'No such listing.' });
      if (!(await memberOf(l.business_id, req.user.id)))
        return res.status(403).json({ error: 'Not yours to withdraw.' });
      await q('UPDATE listings SET withdrawn=TRUE WHERE id=$1', [l.id]);
      res.json({ ok: true });
    })
  );

  app.get(
    '/api/economy/market',
    wrap(async (_req, res) => {
      const { rows } = await q(`
      SELECT l.*, b.name AS business_name, b.form, COALESCE(l.good_category,b.good_category) AS category
        FROM listings l JOIN businesses b ON b.id=l.business_id
       WHERE NOT l.withdrawn AND b.closed_at IS NULL AND (l.stock IS NULL OR l.stock > 0)
       ORDER BY l.created_at DESC`);
      res.json(rows);
    })
  );

  /* Money is held by the state until the buyer says the thing arrived. Neither
     side has to trust the other, and a disagreement has somewhere to go. */
  app.post(
    '/api/economy/listings/:id/buy',
    auth,
    slowWrites,
    wrap(async (req, res) => {
      const l = (await q('SELECT * FROM listings WHERE id=$1 AND NOT withdrawn', [req.params.id])).rows[0];
      if (!l) return res.status(404).json({ error: 'That is no longer for sale.' });
      if (l.stock !== null && l.stock <= 0) return res.status(400).json({ error: 'Sold out.' });
      if (await memberOf(l.business_id, req.user.id))
        return res.status(400).json({ error: 'You cannot buy from your own business.' });
      const buyer = await accountFor('citizen', req.user.id);
      const escrow = await escrowAcc();
      try {
        await pay(buyer.id, escrow.id, l.price, 'escrow', `order for ${l.title}`);
      } catch (err) {
        return payErr(res, err);
      }
      if (l.stock !== null) await q('UPDATE listings SET stock = stock - 1 WHERE id=$1', [l.id]);
      const { rows } = await q(
        'INSERT INTO orders(listing_id,business_id,buyer_id,price) VALUES($1,$2,$3,$4) RETURNING *',
        [l.id, l.business_id, req.user.id, l.price]
      );
      log(req.user.id, 'economy.buy', `${l.title} for ${l.price}`);
      res.json(rows[0]);
    })
  );

  app.get(
    '/api/economy/orders',
    auth,
    wrap(async (req, res) => {
      const { rows } = await q(
        `
      SELECT o.*, l.title, b.name AS business_name, u.display_name AS buyer_name
        FROM orders o
        LEFT JOIN listings l ON l.id=o.listing_id
        LEFT JOIN businesses b ON b.id=o.business_id
        LEFT JOIN users u ON u.id=o.buyer_id
       WHERE o.buyer_id=$1 OR o.business_id IN (SELECT business_id FROM business_members WHERE user_id=$1)
       ORDER BY o.created_at DESC LIMIT 50`,
        [req.user.id]
      );
      res.json(rows);
    })
  );

  app.post(
    '/api/economy/orders/:id/confirm',
    auth,
    wrap(async (req, res) => {
      const o = (
        await q(
          `SELECT o.*, l.title, l.description, l.unit,
                  COALESCE(l.good_category,b.good_category) AS good_category, b.name AS source_name
             FROM orders o
             LEFT JOIN listings l ON l.id=o.listing_id
             LEFT JOIN businesses b ON b.id=o.business_id
            WHERE o.id=$1`,
          [req.params.id]
        )
      ).rows[0];
      if (!o) return res.status(404).json({ error: 'No such order.' });
      if (o.buyer_id !== req.user.id)
        return res.status(403).json({ error: 'Only the buyer confirms delivery.' });
      if (o.status !== 'escrow') return res.status(400).json({ error: 'That order is already settled.' });
      const held = await escrowAcc();
      const seller = await accountFor('business', o.business_id);
      let inventoryItem = null;
      try {
        await tx(async run => {
          const locked = (await run('SELECT status FROM orders WHERE id=$1 FOR UPDATE', [o.id])).rows[0];
          if (locked?.status !== 'escrow')
            throw Object.assign(new Error('That order is already settled.'), { status: 400 });
          await pay(held.id, seller.id, o.price, 'purchase', `order ${o.id} delivered`, run);
          await run("UPDATE orders SET status='delivered', settled_at=now() WHERE id=$1", [o.id]);
          if (o.good_category && o.listing_id)
            inventoryItem = await addInventoryItem(
              req.user.id,
              {
                title: o.title,
                description: o.description,
                good_category: o.good_category,
                unit: o.unit,
                source_kind: 'domestic_listing',
                source_id: o.listing_id,
                source_name: o.source_name
              },
              run
            );
        });
      } catch (err) {
        if (err.status === 400) return res.status(400).json({ error: err.message });
        throw err;
      }
      log(req.user.id, 'economy.delivered', `order ${o.id}`);
      res.json({ ok: true, inventory_item: inventoryItem });
    })
  );

  app.post(
    '/api/economy/orders/:id/refund',
    auth,
    wrap(async (req, res) => {
      const o = (await q('SELECT * FROM orders WHERE id=$1', [req.params.id])).rows[0];
      if (!o) return res.status(404).json({ error: 'No such order.' });
      if (!(await memberOf(o.business_id, req.user.id)) && !req.user.is_admin)
        return res.status(403).json({ error: 'Only the seller may refund an order.' });
      if (o.status !== 'escrow') return res.status(400).json({ error: 'That order is already settled.' });
      const held = await escrowAcc();
      const buyer = await accountFor('citizen', o.buyer_id);
      await pay(held.id, buyer.id, o.price, 'refund', `order ${o.id} refunded`);
      await q("UPDATE orders SET status='refunded', settled_at=now() WHERE id=$1", [o.id]);
      log(req.user.id, 'economy.refund', `order ${o.id}`);
      res.json({ ok: true });
    })
  );

  /* A disagreement about delivery is a contract dispute, and contract disputes
     are what a court is for. The money stays held until the Court rules. */
  app.post(
    '/api/economy/orders/:id/dispute',
    auth,
    wrap(async (req, res) => {
      const o = (await q('SELECT * FROM orders WHERE id=$1', [req.params.id])).rows[0];
      if (!o) return res.status(404).json({ error: 'No such order.' });
      if (o.buyer_id !== req.user.id)
        return res.status(403).json({ error: 'Only the buyer may dispute an order.' });
      if (o.status !== 'escrow') return res.status(400).json({ error: 'That order is already settled.' });
      const b = (await q('SELECT name FROM businesses WHERE id=$1', [o.business_id])).rows[0];
      const n = (await q('SELECT count(*)::int n FROM cases')).rows[0].n + 1;
      const c = (
        await q(
          `INSERT INTO cases(ref,title,claim,brought_by,target_kind,target_note)
       VALUES($1,$2,$3,$4,'act',$5) RETURNING *`,
          [
            `C${String(n).padStart(3, '0')}`,
            `Order ${o.id} against ${b?.name || 'a business'}`,
            String(req.body?.claim || 'The goods were not delivered.').slice(0, 4000),
            req.user.id,
            `order ${o.id}`
          ]
        )
      ).rows[0];
      await q("UPDATE orders SET status='disputed', case_id=$1 WHERE id=$2", [c.id, o.id]);
      log(req.user.id, 'economy.dispute', `order ${o.id} → ${c.ref}`);
      res.json({ case_id: c.id, ref: c.ref });
    })
  );

  /* Part 8: office is public, and so is what it owns. */
  app.post(
    '/api/economy/declare',
    auth,
    wrap(async (req, res) => {
      const body = String(req.body?.body || '').trim();
      if (!body) return res.status(400).json({ error: 'Say what you own.' });
      await q('INSERT INTO declarations(user_id,body) VALUES($1,$2)', [req.user.id, body.slice(0, 4000)]);
      log(req.user.id, 'economy.declare', '');
      res.json({ ok: true });
    })
  );

  app.get(
    '/api/economy/declarations',
    wrap(async (_req, res) => {
      const { rows } = await q(`
      SELECT DISTINCT ON (d.user_id) d.*, u.display_name,
             COALESCE((SELECT array_agg(o.office) FROM offices o WHERE o.user_id=d.user_id AND o.active), '{}') AS offices
        FROM declarations d JOIN users u ON u.id=d.user_id
       ORDER BY d.user_id, d.at DESC`);
      res.json(rows);
    })
  );

  /* ═══════════════════════════════════════════ Part 4 — the public bank

     Credit as a public utility. Deposits earn interest, loans are capped
     against what a citizen can plausibly repay, and a default is a matter for
     the Court rather than a silent write-off. */

  const bank = () => accountFor('bank', null);

  app.get(
    '/api/economy/bank',
    auth,
    wrap(async (req, res) => {
      await loadConfig();
      const d = (await q('SELECT amount FROM deposits WHERE user_id=$1', [req.user.id])).rows[0];
      const loans = (await q('SELECT * FROM loans WHERE user_id=$1 ORDER BY taken_at DESC', [req.user.id]))
        .rows;
      const owed = loans.filter(l => l.status === 'open').reduce((n, l) => n + Number(l.outstanding), 0);
      const ceiling = money(num('loan_ceiling'));
      res.json({
        deposit: Number(d?.amount || 0),
        loans,
        owed,
        deposit_rate: num('deposit_rate'),
        loan_rate: num('loan_rate'),
        can_borrow: Math.max(0, ceiling - owed),
        ceiling,
        held: Number((await bank()).balance)
      });
    })
  );

  app.post(
    '/api/economy/bank/deposit',
    auth,
    wrap(async (req, res) => {
      const acc = await accountFor('citizen', req.user.id);
      try {
        await pay(acc.id, (await bank()).id, req.body?.amount, 'deposit', 'to the public bank');
      } catch (err) {
        return payErr(res, err);
      }
      const amt = money(req.body?.amount);
      await q(
        `INSERT INTO deposits(user_id, amount) VALUES($1,$2)
             ON CONFLICT (user_id) DO UPDATE SET amount = deposits.amount + $2`,
        [req.user.id, amt]
      );
      log(req.user.id, 'bank.deposit', String(amt));
      res.json({ ok: true });
    })
  );

  app.post(
    '/api/economy/bank/withdraw',
    auth,
    wrap(async (req, res) => {
      const amt = money(req.body?.amount);
      const d = (await q('SELECT amount FROM deposits WHERE user_id=$1', [req.user.id])).rows[0];
      if (!d || Number(d.amount) < amt)
        return res.status(400).json({ error: 'You do not have that much on deposit.' });
      const acc = await accountFor('citizen', req.user.id);
      try {
        await pay((await bank()).id, acc.id, amt, 'withdrawal', 'from the public bank');
      } catch (err) {
        return payErr(res, err);
      }
      await q('UPDATE deposits SET amount = amount - $1 WHERE user_id=$2', [amt, req.user.id]);
      log(req.user.id, 'bank.withdraw', String(amt));
      res.json({ ok: true });
    })
  );

  app.post(
    '/api/economy/bank/borrow',
    auth,
    wrap(async (req, res) => {
      await loadConfig();
      const amt = money(req.body?.amount);
      if (amt <= 0) return res.status(400).json({ error: 'Borrow something.' });
      const owed = (
        await q(
          "SELECT COALESCE(sum(outstanding),0)::bigint s FROM loans WHERE user_id=$1 AND status='open'",
          [req.user.id]
        )
      ).rows[0].s;
      const ceiling = money(num('loan_ceiling'));
      if (Number(owed) + amt > ceiling)
        return res
          .status(400)
          .json({ error: `The bank will lend up to ${ceiling} in total, and you already owe ${owed}.` });

      const rate = Number(num('loan_rate'));
      const cycles = Math.max(1, Math.min(12, parseInt(req.body?.cycles, 10) || 4));
      const acc = await accountFor('citizen', req.user.id);
      // The bank may lend beyond its deposits: it is the state's bank, not a vault.
      const bankId = (await bank()).id;
      const rows = await tx(async run => {
        await settle(bankId, acc.id, amt, 'loan', `${cycles} cycles at ${Math.round(rate * 100)}%`, run);
        return (await run(
          'INSERT INTO loans(user_id,principal,outstanding,rate,due_cycle) VALUES($1,$2,$2,$3,$4) RETURNING *',
          [req.user.id, amt, rate, (Number(req.body?.cycle_no) || 0) + cycles]
        )).rows;
      });
      log(req.user.id, 'bank.borrow', `${amt} over ${cycles} cycles`);
      res.json(rows[0]);
    })
  );

  app.post(
    '/api/economy/bank/repay',
    auth,
    wrap(async (req, res) => {
      const loan = (
        await q("SELECT * FROM loans WHERE id=$1 AND user_id=$2 AND status<>'repaid'", [
          req.body?.loan_id || 0,
          req.user.id
        ])
      ).rows[0];
      if (!loan) return res.status(404).json({ error: 'No such loan of yours.' });
      const amt = Math.min(money(req.body?.amount), Number(loan.outstanding));
      if (amt <= 0) return res.status(400).json({ error: 'Repay something.' });
      const acc = await accountFor('citizen', req.user.id);
      try {
        await pay(acc.id, (await bank()).id, amt, 'repayment', `loan ${loan.id}`);
      } catch (err) {
        return payErr(res, err);
      }
      const left = Number(loan.outstanding) - amt;
      await q('UPDATE loans SET outstanding=$1, status=$2, settled_at=$3 WHERE id=$4', [
        left,
        left <= 0 ? 'repaid' : loan.status,
        left <= 0 ? new Date() : null,
        loan.id
      ]);
      log(req.user.id, 'bank.repay', `${amt} against loan ${loan.id}`);
      res.json({ ok: true, outstanding: left });
    })
  );

  /* Interest, run once a cycle with the rest of the payrun. */
  async function runInterest(cycleNo, actorId) {
    await loadConfig();
    const already = (await q('SELECT 1 FROM payruns WHERE kind=$1 AND cycle_no=$2', ['interest', cycleNo]))
      .rows[0];
    if (already) return { paid: 0, reason: 'already run for this cycle' };
    const b = await bank();
    let credited = 0,
      charged = 0,
      defaults = 0;

    const dRate = Number(num('deposit_rate'));
    for (const d of (await q('SELECT * FROM deposits WHERE amount > 0')).rows) {
      const interest = money(Number(d.amount) * dRate);
      if (interest <= 0) continue;
      await tx(async run => {
        await run('UPDATE deposits SET amount = amount + $1 WHERE user_id=$2', [interest, d.user_id]);
        // The bank pays itself: a record, not a movement. Still written both sides.
        await settle(b.id, b.id, interest, 'interest', `deposit interest, cycle ${cycleNo}`, run);
      });
      credited += interest;
    }

    for (const l of (await q("SELECT * FROM loans WHERE status='open'")).rows) {
      const interest = money(Number(l.outstanding) * Number(l.rate));
      if (interest > 0) {
        await q('UPDATE loans SET outstanding = outstanding + $1 WHERE id=$2', [interest, l.id]);
        charged += interest;
      }
      if (l.due_cycle && cycleNo > l.due_cycle) {
        await q("UPDATE loans SET status='default' WHERE id=$1 AND status='open'", [l.id]);
        defaults++;
      }
    }
    await q('INSERT INTO payruns(kind,cycle_no,detail) VALUES($1,$2,$3)', [
      'interest',
      cycleNo,
      `${credited} credited, ${charged} charged, ${defaults} in default`
    ]);
    log(
      actorId,
      'bank.interest',
      `cycle ${cycleNo}: ${credited} credited, ${charged} charged, ${defaults} defaulted`
    );
    return { credited, charged, defaults };
  }

  /* A default is a contract broken, and contracts are the Court's business. */
  app.post(
    '/api/economy/bank/sue/:loan',
    auth,
    wrap(async (req, res) => {
      const l = (await q("SELECT * FROM loans WHERE id=$1 AND status='default'", [req.params.loan])).rows[0];
      if (!l) return res.status(404).json({ error: 'That loan is not in default.' });
      if (l.case_id) return res.status(400).json({ error: 'That default is already before the Court.' });
      const who = (await q('SELECT display_name FROM users WHERE id=$1', [l.user_id])).rows[0];
      const n = (await q('SELECT count(*)::int n FROM cases')).rows[0].n + 1;
      const c = (
        await q(
          `INSERT INTO cases(ref,title,claim,brought_by,target_kind,target_note)
       VALUES($1,$2,$3,$4,'act',$5) RETURNING *`,
          [
            `C${String(n).padStart(3, '0')}`,
            `Default on loan ${l.id} by ${who?.display_name || 'a citizen'}`,
            `${l.outstanding} remains outstanding past its due cycle.`,
            req.user.id,
            `loan ${l.id}`
          ]
        )
      ).rows[0];
      await q('UPDATE loans SET case_id=$1 WHERE id=$2', [c.id, l.id]);
      log(req.user.id, 'bank.sue', `loan ${l.id} → ${c.ref}`);
      res.json({ case_id: c.id, ref: c.ref });
    })
  );

  /* ═════════════════════════════════════ Part 5 — the market in shares

     A limit order book. Money for a bid and shares for an ask are reserved when
     the order is placed, so nothing is ever sold twice. Every trade is public
     with both parties named, and no citizen may hold more of a business than
     the ownership cap allows. */

  const holdingOf = async (bizId, userId) =>
    Number(
      (await q('SELECT qty FROM holdings WHERE business_id=$1 AND holder_id=$2', [bizId, userId])).rows[0]
        ?.qty || 0
    );

  async function moveShares(bizId, fromId, toId, qty) {
    if (fromId)
      await q('UPDATE holdings SET qty = qty - $1 WHERE business_id=$2 AND holder_id=$3', [
        qty,
        bizId,
        fromId
      ]);
    if (toId)
      await q(
        `INSERT INTO holdings(business_id,holder_id,qty) VALUES($1,$2,$3)
                       ON CONFLICT (business_id,holder_id) DO UPDATE SET qty = holdings.qty + $3`,
        [bizId, toId, qty]
      );
  }

  app.post(
    '/api/economy/businesses/:id/issue',
    auth,
    wrap(async (req, res) => {
      await loadConfig();
      if (!(await memberOf(req.params.id, req.user.id)))
        return res.status(403).json({ error: 'Only the owners may issue shares.' });
      const b = (await q('SELECT * FROM businesses WHERE id=$1', [req.params.id])).rows[0];
      if (!b) return res.status(404).json({ error: 'No such business.' });
      if (Number(b.shares_issued) > 0)
        return res.status(400).json({ error: 'This business has already issued its shares.' });
      const qty = Math.max(1, Math.min(100000, parseInt(req.body?.qty, 10) || 0));
      await q('UPDATE businesses SET shares_issued=$1 WHERE id=$2', [qty, b.id]);
      await moveShares(b.id, null, req.user.id, qty);
      log(req.user.id, 'market.issue', `${qty} shares in ${b.name}`);
      res.json({ ok: true, shares_issued: qty });
    })
  );

  app.get(
    '/api/economy/businesses/:id/market',
    wrap(async (req, res) => {
      await loadConfig();
      const b = (await q('SELECT id,name,shares_issued FROM businesses WHERE id=$1', [req.params.id]))
        .rows[0];
      if (!b) return res.status(404).json({ error: 'No such business.' });
      const book = (
        await q(
          `
      SELECT o.id, o.side, o.price, o.remaining, u.display_name
        FROM share_orders o JOIN users u ON u.id=o.user_id
       WHERE o.business_id=$1 AND o.status='open'
       ORDER BY CASE WHEN o.side='bid' THEN -o.price ELSE o.price END, o.placed_at`,
          [b.id]
        )
      ).rows;
      const trades = (
        await q(
          `
      SELECT t.*, bu.display_name AS buyer_name, se.display_name AS seller_name
        FROM trades t LEFT JOIN users bu ON bu.id=t.buyer_id LEFT JOIN users se ON se.id=t.seller_id
       WHERE t.business_id=$1 ORDER BY t.at DESC LIMIT 30`,
          [b.id]
        )
      ).rows;
      const holders = (
        await q(
          `
      SELECT h.qty, u.id, u.display_name,
             COALESCE((SELECT array_agg(o.office) FROM offices o WHERE o.user_id=u.id AND o.active), '{}') AS offices
        FROM holdings h JOIN users u ON u.id=h.holder_id
       WHERE h.business_id=$1 AND h.qty > 0 ORDER BY h.qty DESC`,
          [b.id]
        )
      ).rows;
      res.json({
        business: b,
        book,
        trades,
        holders,
        last: trades[0]?.price ?? null,
        cap: Number(num('ownership_cap')),
        mine: req.user ? await holdingOf(b.id, req.user.id) : 0
      });
    })
  );

  app.post(
    '/api/economy/businesses/:id/order',
    auth,
    slowWrites,
    wrap(async (req, res) => {
      await loadConfig();
      const b = (await q('SELECT * FROM businesses WHERE id=$1', [req.params.id])).rows[0];
      if (!b || !Number(b.shares_issued))
        return res.status(400).json({ error: 'That business has no shares to trade.' });
      const barred = ctx.money && (await ctx.money.fedChairBarred(req.user.id));
      if (barred) return res.status(403).json({ error: barred });
      const side = req.body?.side === 'ask' ? 'ask' : 'bid';
      const price = money(req.body?.price),
        qty = money(req.body?.qty);
      if (price <= 0 || qty <= 0) return res.status(400).json({ error: 'Give a price and a quantity.' });

      const me = await accountFor('citizen', req.user.id);
      const esc = await escrowAcc();

      if (side === 'ask') {
        const have = await holdingOf(b.id, req.user.id);
        const reserved = Number(
          (
            await q(
              "SELECT COALESCE(sum(remaining),0)::bigint s FROM share_orders WHERE business_id=$1 AND user_id=$2 AND side='ask' AND status='open'",
              [b.id, req.user.id]
            )
          ).rows[0].s
        );
        if (have - reserved < qty)
          return res.status(400).json({ error: `You hold ${have} and have ${reserved} already on offer.` });
      } else {
        const cap = Number(num('ownership_cap'));
        const would = (await holdingOf(b.id, req.user.id)) + qty;
        if (cap > 0 && would > Number(b.shares_issued) * cap)
          return res
            .status(400)
            .json({
              error: `No citizen may hold more than ${Math.round(cap * 100)}% of a business. That bid would take you past it.`
            });
        try {
          await pay(me.id, esc.id, price * qty, 'escrow', `bid for ${b.name}`);
        } catch (err) {
          return payErr(res, err);
        }
      }

      const order = (
        await q(
          'INSERT INTO share_orders(business_id,user_id,side,price,qty,remaining) VALUES($1,$2,$3,$4,$5,$5) RETURNING *',
          [b.id, req.user.id, side, price, qty]
        )
      ).rows[0];

      // Match against the best opposing orders until the book runs out or the price no longer crosses.
      const opposite = side === 'bid' ? 'ask' : 'bid';
      const book = (
        await q(
          `
      SELECT * FROM share_orders WHERE business_id=$1 AND side=$2 AND status='open' AND user_id<>$3
       ORDER BY CASE WHEN side='ask' THEN price ELSE -price END, placed_at`,
          [b.id, opposite, req.user.id]
        )
      ).rows;

      let left = qty,
        filled = 0;
      for (const other of book) {
        if (left <= 0) break;
        const crosses = side === 'bid' ? Number(other.price) <= price : Number(other.price) >= price;
        if (!crosses) break;
        const take = Math.min(left, Number(other.remaining));
        const at = Number(other.price); // the resting order sets the price
        const buyer = side === 'bid' ? req.user.id : other.user_id;
        const seller = side === 'bid' ? other.user_id : req.user.id;
        const sellerAcc = await accountFor('citizen', seller);

        // The buyer's money is already in escrow; release it to the seller.
        await pay(esc.id, sellerAcc.id, at * take, 'trade', `${take} of ${b.name}`);
        if (side === 'bid' && at < price) {
          await pay(esc.id, me.id, (price - at) * take, 'refund', 'bid filled below its limit');
        }
        await moveShares(b.id, seller, buyer, take);
        await q('INSERT INTO trades(business_id,buyer_id,seller_id,price,qty) VALUES($1,$2,$3,$4,$5)', [
          b.id,
          buyer,
          seller,
          at,
          take
        ]);
        await q(
          `UPDATE share_orders
                  SET remaining = remaining - $1::bigint,
                      status = CASE WHEN remaining - $1::bigint <= 0 THEN $2 ELSE status END
                WHERE id = $3`,
          [take, 'filled', other.id]
        );
        left -= take;
        filled += take;
      }
      await q(
        `UPDATE share_orders
                SET remaining = $1::bigint,
                    status = CASE WHEN $1::bigint <= 0 THEN $2 ELSE status END
              WHERE id = $3`,
        [left, 'filled', order.id]
      );
      log(
        req.user.id,
        'market.order',
        `${side} ${qty} of ${b.name} at ${price}${filled ? `, ${filled} filled` : ''}`
      );
      res.json({ ok: true, filled, remaining: left });
    })
  );

  app.post(
    '/api/economy/orders/share/:id/cancel',
    auth,
    wrap(async (req, res) => {
      const o = (await q("SELECT * FROM share_orders WHERE id=$1 AND status='open'", [req.params.id]))
        .rows[0];
      if (!o) return res.status(404).json({ error: 'No such open order.' });
      if (o.user_id !== req.user.id) return res.status(403).json({ error: 'Not your order.' });
      if (o.side === 'bid') {
        const me = await accountFor('citizen', req.user.id);
        await pay(
          (await escrowAcc()).id,
          me.id,
          Number(o.price) * Number(o.remaining),
          'refund',
          'bid cancelled'
        );
      }
      await q("UPDATE share_orders SET status='cancelled', remaining=0 WHERE id=$1", [o.id]);
      res.json({ ok: true });
    })
  );

  /* A business paying out to its shareholders — the only reason to hold a share
     other than hoping someone pays more for it later. */
  app.post(
    '/api/economy/businesses/:id/dividend',
    auth,
    wrap(async (req, res) => {
      if (!(await memberOf(req.params.id, req.user.id)))
        return res.status(403).json({ error: 'Only the owners may declare a dividend.' });
      const b = (await q('SELECT * FROM businesses WHERE id=$1', [req.params.id])).rows[0];
      const per = money(req.body?.per_share);
      if (per <= 0) return res.status(400).json({ error: 'Say how much per share.' });
      const holders = (
        await q('SELECT holder_id, qty FROM holdings WHERE business_id=$1 AND qty > 0', [b.id])
      ).rows;
      const total = holders.reduce((n, h) => n + per * Number(h.qty), 0);
      const acc = await accountFor('business', b.id);
      if (Number(acc.balance) < total)
        return res
          .status(400)
          .json({ error: `That would cost ${total} and the business holds ${acc.balance}.` });
      for (const h of holders) {
        await pay(
          acc.id,
          (await accountFor('citizen', h.holder_id)).id,
          per * Number(h.qty),
          'dividend',
          `${b.name} dividend`
        );
      }
      log(req.user.id, 'market.dividend', `${b.name} paid ${per} a share, ${total} in all`);
      res.json({ ok: true, total, holders: holders.length });
    })
  );

  /* money.js mounts after this one and needs the ledger primitives. They are
     handed over on the shared context rather than exported, so a build without
     economy.js leaves ctx.economy undefined and the Treasury and the Fed simply
     do not answer — which is the honest state of affairs when there is no
     currency for them to be responsible for. */
  ctx.economy = { accountFor, pay, settle, money, treasury, bank, escrowAcc, taxOn, addInventoryItem };
};
