/* War as logistics.

   The group decided the shape of this: buy equipment, manage supply, pay
   upkeep — and no troop movements, no deployment, no battles. That is not a
   reduced war system, it is a different one, and it happens to be the one that
   fits an asynchronous republic of nineteen people. Nobody loses a war
   overnight to a die roll they were asleep for. What they lose it to is three
   cycles of the House refusing to fund the rations.

   The whole loop:

     the Quartermaster buys goods  ->  the national stockpile
     the stockpile feeds upkeep    ->  every cycle, automatically
     upkeep unpaid                 ->  readiness falls
     readiness                     ->  what the Republic can actually do

   Three rules hold it together.

   **Procurement is a purchase, not a summoning.** The state buys from the same
   listings citizens buy from, at the seller's price, and the money leaves the
   Treasury and arrives in a business account. An arms industry is therefore
   worth founding, and a war is a transfer from taxpayers to manufacturers,
   which is what a war actually is.

   **Upkeep consumes real quantities.** Formations eat food, burn energy and
   wear out arms every cycle whether or not anyone is looking. A standing army
   in peacetime is a bill that arrives forever, which is the argument this
   system exists to have.

   **Readiness is deterministic and slow.** It falls when supply is short and
   recovers when it is not, by fixed steps. No randomness anywhere: a player who
   is losing can see it coming several cycles out and sue for peace, and the
   argument afterwards is about the decision rather than about the dice. */

module.exports.mount = function mount(app, ctx) {
  const { q, tx, log, auth, wrap, num, bool, loadConfig, officesOf, holds, slowWrites, cycleNow } = ctx;

  const E = () => ctx.economy;
  const money = n => Math.round(Number(n) || 0);
  const qty = n => Math.max(0, Math.round(Number(n) || 0));
  const cycleNo = () => cycleNow()?.number || 0;

  const CATEGORIES = ['food', 'raw_materials', 'energy', 'industrial_goods', 'technology', 'arms', 'luxury', 'services'];

  /* What one unit of formation consumes per cycle. Deliberately only three
     categories: rations, fuel and equipment. A war that needed all eight would
     be an accounting exercise, and the interesting scarcity is the one players
     can actually plan around. */
  const UPKEEP_PER_SIZE = () => ({
    food: num('upkeep_food') || 2,
    energy: num('upkeep_energy') || 1,
    arms: num('upkeep_arms') || 1
  });

  const needEconomy = (_req, res, next) =>
    E() ? next() : res.status(503).json({ error: 'The economy is not running, so nothing can be bought or supplied.' });

  const treasury = () => E().treasury();

  /* The state spends into deficit, like it does for the dividend. pay() refuses
     an overdraft and the Treasury is almost always overdrawn — a republic that
     could only buy rifles while in surplus would never buy any, and the deficit
     is the thing the House is supposed to be arguing about anyway. So both
     sides are written directly and the ledger still records it: what limits
     procurement is the budget the House voted, not the bank balance. */
  async function spendFromTreasury(toAccId, amount, kind, note, run = null) {
    const t = await treasury();
    await E().settle(t.id, toAccId, amount, kind, note, run);
  }

  /* ------------------------------------------------------ the stockpile */

  async function stockpile() {
    const rows = (await q('SELECT category, quantity FROM stockpile')).rows;
    const out = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
    for (const r of rows) out[r.category] = Number(r.quantity);
    return out;
  }

  /* Every change goes through here so the stockpile stays a running total of a
     record. A movement that would take a category below zero is refused rather
     than clamped — silently supplying an army from an empty store is exactly
     the bug that would make the whole system meaningless. */
  async function move(category, quantity, kind, note, byId, run = null) {
    if (!CATEGORIES.includes(category)) throw Object.assign(new Error('Unknown category.'), { status: 400 });
    if (!run) return tx(r => move(category, quantity, kind, note, byId, r));
    await run('INSERT INTO stockpile(category,quantity) VALUES($1,0) ON CONFLICT (category) DO NOTHING', [category]);
    /* Locked, because this is a read, a comparison and a write. Two draws on the
       last of a category would otherwise both see enough and both take it, and
       the CHECK (quantity >= 0) on the table would turn the loser into a 500
       rather than the honest refusal below. */
    const have = Number((await run('SELECT quantity FROM stockpile WHERE category=$1 FOR UPDATE', [category])).rows[0].quantity);
    if (have + quantity < 0)
      throw Object.assign(new Error(`The Republic holds ${have} ${category} and cannot draw ${-quantity}.`), { status: 400 });
    await run('UPDATE stockpile SET quantity = quantity + $2::bigint, updated_at=now() WHERE category=$1', [category, quantity]);
    await run('INSERT INTO stockpile_movements(category,quantity,kind,note,cycle_no,by_id) VALUES($1,$2,$3,$4,$5,$6)',
      [category, quantity, kind, String(note).slice(0, 300), cycleNo(), byId || null]);
    return have + quantity;
  }

  /* ---------------------------------------------------- the Quartermaster */

  /* Same shape as the Treasurer and the Foreign Minister, for the same reason:
     the office is the government's, so the government appoints and dismisses,
     and it may spend only what the House has voted. */
  const qmNow = async () => (await q(`
    SELECT u.id, u.display_name, o.since FROM offices o JOIN users u ON u.id=o.user_id
     WHERE o.office='quartermaster' AND o.active LIMIT 1`)).rows[0] || null;

  const pmNow = async () => (await q(`
    SELECT u.id, u.display_name FROM offices o JOIN users u ON u.id=o.user_id
     WHERE o.office='prime_minister' AND o.active LIMIT 1`)).rows[0] || null;

  const requireQuartermaster = async (req, res) => {
    if (await holds(req.user.id, 'quartermaster')) return true;
    res.status(403).json({ error: 'Only the Quartermaster procures for the Republic. The office is appointed by the government and spends only what the House has voted.' });
    return false;
  };

  app.post('/api/war/quartermaster/appoint', auth, wrap(async (req, res) => {
    const pm = await pmNow();
    const appointer = pm ? 'prime_minister' : 'president';
    if (!(await holds(req.user.id, appointer)))
      return res.status(403).json({
        error: pm ? 'The Prime Minister appoints the Quartermaster.' : 'There is no Prime Minister, so the President appoints the Quartermaster.'
      });
    const target = (await q('SELECT id, display_name FROM users WHERE id=$1 AND is_active AND approved', [req.body?.user_id || 0])).rows[0];
    if (!target) return res.status(400).json({ error: 'Name a citizen to appoint.' });
    const held = (await officesOf(target.id)).filter(o => o !== 'quartermaster');
    if (held.length)
      return res.status(400).json({ error: `${target.display_name} holds office as ${held.join(', ')}. Article 7.1 gives each citizen one seat — they must resign it first.` });
    await q("UPDATE offices SET active=FALSE, until=now() WHERE office='quartermaster' AND active");
    await q("INSERT INTO offices(office,user_id) VALUES('quartermaster',$1)", [target.id]);
    log(req.user.id, 'war.quartermaster.appoint', `${target.display_name}, by the ${appointer.replace('_', ' ')}`);
    res.json({ ok: true, quartermaster: { id: target.id, display_name: target.display_name } });
  }));

  app.post('/api/war/quartermaster/dismiss', auth, wrap(async (req, res) => {
    const qm = await qmNow();
    if (!qm) return res.status(400).json({ error: 'There is no Quartermaster.' });
    const pm = await pmNow();
    const appointer = pm ? 'prime_minister' : 'president';
    const mine = qm.id === req.user.id;
    if (!mine && !(await holds(req.user.id, appointer)))
      return res.status(403).json({ error: `The Quartermaster may resign, or the ${appointer.replace('_', ' ')} may dismiss them. Nobody else.` });
    await q("UPDATE offices SET active=FALSE, until=now() WHERE user_id=$1 AND office='quartermaster' AND active", [qm.id]);
    log(req.user.id, mine ? 'war.quartermaster.resign' : 'war.quartermaster.dismiss', qm.display_name);
    res.json({ ok: true });
  }));

  /* ------------------------------------------------------------ the budget

     Spending is capped per cycle at a figure the House sets by rule bill. The
     Quartermaster cannot exceed it, and cannot ask the Treasury for more: a
     bigger army means going back to the House for a bigger number, in public,
     which is the entire political content of the feature. */
  async function spentThisCycle() {
    const c = cycleNo();
    const { rows } = await q(`
      SELECT COALESCE(sum(amount),0)::bigint s FROM ledger
       WHERE kind='procurement' AND note LIKE $1`, [`%[cycle ${c}]`]);
    return Number(rows[0].s);
  }

  const budgetLeft = async () => Math.max(0, money(num('military_budget_per_cycle')) - (await spentThisCycle()));

  /* --------------------------------------------------------- procurement */

  /* Buying from a domestic business. The state pays the seller's asking price
     into the seller's account — no state discount, no requisition. If the
     Republic wants cheap arms it has to have an arms industry, which is a
     reason for a player to found one. */
  app.post('/api/war/procure/listing/:id', auth, needEconomy, slowWrites, wrap(async (req, res) => {
    await loadConfig();
    if (!(await requireQuartermaster(req, res))) return;
    const units = qty(req.body?.units) || 1;
    const l = (await q(`
      SELECT l.*, b.name AS business_name, COALESCE(l.good_category, b.good_category) AS category
        FROM listings l JOIN businesses b ON b.id=l.business_id
       WHERE l.id=$1 AND NOT l.withdrawn`, [req.params.id])).rows[0];
    if (!l) return res.status(404).json({ error: 'That is no longer for sale.' });
    if (!l.category) return res.status(400).json({ error: 'That listing has no category, so the Republic cannot store it. The business must classify itself first.' });
    if (l.stock !== null && Number(l.stock) < units) return res.status(400).json({ error: `Only ${l.stock} left.` });

    const cost = money(Number(l.price) * units);
    const left = await budgetLeft();
    if (cost > left)
      return res.status(400).json({ error: `That costs ${cost} and ${left} is left of this cycle's military budget. The House sets it — ask them for more, in public.` });

    const seller = await E().accountFor('business', l.business_id);
    await spendFromTreasury(seller.id, cost, 'procurement', `${units} x ${l.title} from ${l.business_name} [cycle ${cycleNo()}]`);
    if (l.stock !== null) await q('UPDATE listings SET stock = stock - $1 WHERE id=$2', [units, l.id]);
    const held = await move(l.category, units, 'procurement', `${l.title} from ${l.business_name}`, req.user.id);
    log(req.user.id, 'war.procure', `${units} x ${l.title} (${l.category}) for ${cost}`);
    res.json({ ok: true, category: l.category, units, cost, held, budget_left: await budgetLeft() });
  }));

  /* Buying abroad. Foreign offers are priced in the seller's local currency.
     The Republic spends any reserve of that currency first; uncovered value is
     settled in marks into the foreign power's Republic-currency reserve. The
     import tax still counts against the military budget exactly as it does for
     a citizen. */
  app.post('/api/war/procure/foreign/:id', auth, needEconomy, slowWrites, wrap(async (req, res) => {
    await loadConfig();
    if (!(await requireQuartermaster(req, res))) return;
    if (!ctx.diplomacy || !ctx.offshore?.foreignCurrencyState || !ctx.offshore?.settleRepublicImport)
      return res.status(503).json({ error: 'Foreign-currency settlement is not running, so there is nothing to buy abroad.' });
    const units = qty(req.body?.units) || 1;
    const o = (await q(`
      SELECT o.*, p.name AS power_name, p.recognised FROM foreign_offers o
        JOIN powers p ON p.id=o.power_id
       WHERE o.id=$1 AND p.revoked_at IS NULL`, [req.params.id])).rows[0];
    if (!o) return res.status(404).json({ error: 'No such foreign offer.' });
    if (!o.good_category) return res.status(400).json({ error: 'That offer has no category, so the Republic cannot store it.' });
    if (o.stock !== null && Number(o.stock) < units) return res.status(400).json({ error: `Only ${o.stock} left.` });

    const currency = await ctx.offshore.foreignCurrencyState(o.power_id);
    if (!currency) return res.status(409).json({ error: 'That power has no currency.' });
    const localGross = money(Number(o.price) * units);
    const gross = localGross > 0 ? Math.ceil(localGross / Number(currency.rate)) : 0;
    const tax = money(gross * (num('foreign_trade_tax') || 0));
    const cost = gross + tax;
    const left = await budgetLeft();
    if (cost > left)
      return res.status(400).json({ error: `That costs ${cost} with duty and ${left} is left of this cycle's military budget.` });

    const t = await treasury();
    let settlement = null;
    const held = await tx(async run => {
      if (o.stock !== null) {
        const left = Number((await run('SELECT stock FROM foreign_offers WHERE id=$1 FOR UPDATE', [o.id])).rows[0].stock);
        if (left < units) throw Object.assign(new Error(`Only ${left} left.`), { status: 400 });
        await run('UPDATE foreign_offers SET stock = stock - $1 WHERE id=$2', [units, o.id]);
      }
      const inStore = await move(o.good_category, units, 'procurement', `${o.title} from ${o.power_name}`, req.user.id, run);
      settlement = await ctx.offshore.settleRepublicImport(
        o.power_id,
        localGross,
        t.id,
        `${units} x ${o.title} from ${o.power_name} [cycle ${cycleNo()}]`,
        run,
        true
      );
      /* The duty is the Republic charging itself, so it moves no money. It is
         recorded so that the cost against the budget is the true one. */
      if (tax > 0) {
        await run('INSERT INTO ledger(from_id,to_id,amount,kind,note) VALUES($1,$2,$3,$4,$5)',
          [t.id, t.id, tax, 'duty', `duty on ${o.title} [cycle ${cycleNo()}]`]);
      }
      await run(
        `INSERT INTO foreign_trade(power_id,direction,amount,tax,offer_id,cycle_no,foreign_units,fx_rate)
         VALUES($1,'import',$2,$3,$4,$5,$6,$7)`,
        [o.power_id, settlement.marks, tax, o.id, cycleNo(), localGross, settlement.rate]
      );
      return inStore;
    });
    log(req.user.id, 'war.procure.foreign', `${units} x ${o.title} from ${o.power_name} for ${localGross} ${currency.code} / ${cost} marks with duty`);
    res.json({
      ok: true,
      category: o.good_category,
      units,
      cost,
      duty: tax,
      local_cost: localGross,
      currency_code: currency.code,
      rate: settlement.rate,
      reserve_spent: settlement.reserve_spent,
      held,
      budget_left: await budgetLeft()
    });
  }));

  /* ----------------------------------------------------------- formations */

  const liveFormations = async () =>
    (await q('SELECT * FROM formations WHERE disbanded_at IS NULL ORDER BY id')).rows;

  app.post('/api/war/formations', auth, needEconomy, wrap(async (req, res) => {
    await loadConfig();
    if (!(await requireQuartermaster(req, res))) return;
    const name = String(req.body?.name || '').trim().slice(0, 60);
    const arm = ['army', 'navy', 'air'].includes(req.body?.arm) ? req.body.arm : 'army';
    const size = Math.max(1, Math.min(50, parseInt(req.body?.size, 10) || 1));
    if (name.length < 2) return res.status(400).json({ error: 'A formation needs a name.' });

    /* Raising costs equipment up front, out of the stockpile. You cannot raise
       an army you have not equipped — that is the whole point of the system. */
    const cost = size * (num('raise_cost_arms') || 5);
    try {
      await move('arms', -cost, 'upkeep', `raising ${name}`, req.user.id);
    } catch (err) {
      return res.status(err.status || 400).json({ error: `Raising ${name} needs ${cost} arms in the stockpile. ${err.message}` });
    }
    const { rows } = await q('INSERT INTO formations(name,arm,size,raised_by) VALUES($1,$2,$3,$4) RETURNING *',
      [name, arm, size, req.user.id]);
    log(req.user.id, 'war.raise', `${name}: ${arm}, size ${size}, ${cost} arms`);
    res.json(rows[0]);
  }));

  app.post('/api/war/formations/:id/disband', auth, wrap(async (req, res) => {
    if (!(await requireQuartermaster(req, res))) return;
    const f = (await q('SELECT * FROM formations WHERE id=$1 AND disbanded_at IS NULL', [req.params.id])).rows[0];
    if (!f) return res.status(404).json({ error: 'No such standing formation.' });
    await q('UPDATE formations SET disbanded_at=now() WHERE id=$1', [f.id]);
    log(req.user.id, 'war.disband', f.name);
    res.json({ ok: true });
  }));

  /* -------------------------------------------------------------- upkeep

     Runs with the payrun. Every formation eats, burns and wears out, and the
     Treasury pays the wages. Where the stockpile cannot cover a category, the
     forces go short and readiness falls by a fixed step; where everything is
     covered, readiness recovers by a smaller one. Falling faster than it
     recovers is deliberate — letting an army run down is quick and rebuilding
     it is slow, which is what makes the funding argument matter. */
  async function runUpkeep(cycleNo_, actorId) {
    await loadConfig();
    if ((await q('SELECT 1 FROM upkeep_runs WHERE cycle_no=$1', [cycleNo_])).rows[0])
      return { reason: 'already run for this cycle' };

    const forces = await liveFormations();
    if (!forces.length) {
      await q('INSERT INTO upkeep_runs(cycle_no,detail) VALUES($1,$2)', [cycleNo_, 'no standing forces']);
      return { paid: 0, shortfall: [], forces: 0 };
    }

    const totalSize = forces.reduce((n, f) => n + f.size, 0);
    const per = UPKEEP_PER_SIZE();
    const shortfall = [];
    const drawn = {};

    for (const [category, rate] of Object.entries(per)) {
      const need = Math.round(totalSize * rate);
      if (need <= 0) continue;
      const have = (await stockpile())[category] || 0;
      const take = Math.min(have, need);
      if (take > 0) await move(category, -take, 'upkeep', `upkeep for ${totalSize} of formation`, actorId);
      drawn[category] = take;
      if (take < need) shortfall.push(`${category} short by ${need - take}`);
    }

    /* Wages. The Treasury is allowed to go into deficit for this, as it is for
       the dividend — an army that stops being paid the moment the books turn
       red would make the deficit invisible, and the deficit is the point. */
    /* Wages go back to the citizenry, split evenly — soldiers are citizens, and
       paying an army is a transfer, not a cost to the world. Whatever rounding
       leaves over stays in the Treasury rather than vanishing: nothing here may
       break sum(balance) = 0. */
    let wages = 0;
    const perHead = Math.floor(money(totalSize * (num('upkeep_pay') || 10)) / Math.max(1, (await q("SELECT count(*)::int n FROM accounts WHERE owner_kind='citizen'")).rows[0].n));
    if (perHead > 0) {
      for (const c of (await q("SELECT id FROM accounts WHERE owner_kind='citizen' ORDER BY id")).rows) {
        await spendFromTreasury(c.id, perHead, 'wages', `service pay, cycle ${cycleNo_}`);
        wages += perHead;
      }
    }

    const fall = num('readiness_fall') || 15;
    const rise = num('readiness_rise') || 5;
    for (const f of forces) {
      const next = shortfall.length
        ? Math.max(0, Number(f.readiness) - fall)
        : Math.min(100, Number(f.readiness) + rise);
      await q('UPDATE formations SET readiness=$1 WHERE id=$2', [next, f.id]);
    }

    const detail = `${forces.length} formation(s), ${totalSize} of size, ${wages} in pay` +
      (shortfall.length ? `; short: ${shortfall.join(', ')}` : '; fully supplied');
    await q('INSERT INTO upkeep_runs(cycle_no,paid,shortfall,detail) VALUES($1,$2,$3,$4)',
      [cycleNo_, wages, shortfall.join(', '), detail]);
    log(actorId, 'war.upkeep', `cycle ${cycleNo_}: ${detail}`);
    return { paid: wages, shortfall, drawn, forces: forces.length, size: totalSize };
  }

  /* ==================================================== CONFLICT PRESSURE

     A conflict is a countdown, not a battle. Every cycle it moves by a fixed
     amount decided by whose forces are better supplied, and crossing a
     threshold escalates a stage:

       grievance  ->  ultimatum  ->  blockade  ->  open war

     Two things it deliberately does NOT do.

     It does not resolve anything. No territory changes hands here, no treaty is
     signed, nobody surrenders. Pressure is the clock that makes the House argue;
     the argument still ends in a bill, as everything else does.

     It does not roll. Effective strength is readiness times size, and the step
     is proportional to the difference — so a Republic that is losing can watch
     it coming for several cycles and sue for peace, and the argument afterwards
     is about the decision rather than about the dice. */

  const STAGES = ['grievance', 'ultimatum', 'blockade', 'open_war'];
  const STAGE_AT = { grievance: 0, ultimatum: 25, blockade: 55, open_war: 85 };

  const stageFor = pressure => {
    let out = 'grievance';
    for (const st of STAGES) if (pressure >= STAGE_AT[st]) out = st;
    return out;
  };

  /* What the Republic can actually bring to bear. Size is what you paid for;
     readiness is whether you kept paying. An unsupplied army of twenty counts
     for less than a supplied one of six, which is the entire argument this
     system exists to have. */
  async function effectiveStrength() {
    const forces = await liveFormations();
    return Math.round(forces.reduce((n, f) => n + f.size * (Number(f.readiness) / 100), 0) * (num('strength_per_size') || 4));
  }

  async function pressureRow(conflictId) {
    await q('INSERT INTO conflict_pressure(conflict_id) VALUES($1) ON CONFLICT (conflict_id) DO NOTHING', [conflictId]);
    return (await q('SELECT * FROM conflict_pressure WHERE conflict_id=$1', [conflictId])).rows[0];
  }

  /* Runs with the payrun, after upkeep — so this cycle's readiness is the
     readiness that counts, not last cycle's. */
  async function runConflicts(cycleNo_, actorId) {
    await loadConfig();
    if (!ctx.diplomacy) return { reason: 'diplomacy is not running' };
    const live = (await q(`
      SELECT c.id, c.kind, c.grievance, c.status, p.id AS power_id, p.name AS power_name, p.strength
        FROM foreign_conflicts c JOIN powers p ON p.id = c.power_id
       WHERE c.status NOT IN ('resolved', 'withdrawn') AND p.revoked_at IS NULL`)).rows;
    if (!live.length) return { conflicts: 0 };

    const ours = await effectiveStrength();
    const step = num('conflict_step') || 10;
    const out = [];

    for (const c of live) {
      const row = await pressureRow(c.id);
      if (row.last_cycle === cycleNo_) continue;          // never twice in a cycle
      const theirs = Number(c.strength) || 0;
      /* Proportional to the gap, capped at one step either way, so nothing ever
         swings from calm to open war in a single cycle. */
      const gap = theirs - ours;
      const move = Math.max(-step, Math.min(step, Math.round((gap / Math.max(1, theirs + ours)) * step * 2)));
      const next = Math.max(-100, Math.min(100, Number(row.pressure) + move));
      const stage = stageFor(next);
      const escalated = stage !== row.stage;

      await q('UPDATE conflict_pressure SET pressure=$2, stage=$3, last_cycle=$4, updated_at=now() WHERE conflict_id=$1',
        [c.id, next, stage, cycleNo_]);
      await q('INSERT INTO conflict_log(conflict_id,cycle_no,pressure,stage,note) VALUES($1,$2,$3,$4,$5)',
        [c.id, cycleNo_, next, stage,
         `${c.power_name}: ours ${ours} against theirs ${theirs}, pressure ${move >= 0 ? '+' : ''}${move}`]);
      if (escalated) log(actorId, 'war.escalate', `${c.power_name}: ${row.stage} → ${stage}`);
      out.push({ conflict_id: c.id, power: c.power_name, pressure: next, stage, moved: move, escalated });
    }
    return { conflicts: out.length, ours, detail: out };
  }

  /* A blockade is the point at which a war stops being a page nobody reads.
     While one is in force that power's offers leave the foreign market, so a
     citizen who has never opened the diplomacy page finds their supplier gone.
     diplomacy.js asks this before listing offers. */
  async function blockadedPowers() {
    const { rows } = await q(`
      SELECT DISTINCT c.power_id FROM conflict_pressure cp
        JOIN foreign_conflicts c ON c.id = cp.conflict_id
       WHERE cp.stage IN ('blockade', 'open_war') AND c.status NOT IN ('resolved', 'withdrawn')`);
    return rows.map(r => r.power_id);
  }

  app.get('/api/war/conflicts', wrap(async (_req, res) => {
    await loadConfig();
    if (!ctx.diplomacy) return res.json({ conflicts: [], ours: await effectiveStrength() });
    const rows = (await q(`
      SELECT c.id, c.kind, c.grievance, c.status, c.created_at,
             p.name AS power_name, p.colour, p.strength,
             COALESCE(cp.pressure, 0) AS pressure, COALESCE(cp.stage, 'grievance') AS stage
        FROM foreign_conflicts c
        JOIN powers p ON p.id = c.power_id
        LEFT JOIN conflict_pressure cp ON cp.conflict_id = c.id
       WHERE c.status NOT IN ('resolved', 'withdrawn') AND p.revoked_at IS NULL
       ORDER BY cp.pressure DESC NULLS LAST`)).rows;
    const ours = await effectiveStrength();
    res.json({
      ours,
      /* How many cycles until the next stage at the current rate. This is the
         number that makes the House act, so it is computed here rather than
         left for a player to work out. */
      conflicts: rows.map(r => {
        const theirs = Number(r.strength) || 0;
        const gap = theirs - ours;
        const step = num('conflict_step') || 10;
        const move = Math.max(-step, Math.min(step, Math.round((gap / Math.max(1, theirs + ours)) * step * 2)));
        const nextStage = STAGES[STAGES.indexOf(r.stage) + 1];
        return {
          ...r,
          pressure: Number(r.pressure),
          moving: move,
          next_stage: nextStage || null,
          cycles_to_next: nextStage && move > 0 ? Math.ceil((STAGE_AT[nextStage] - Number(r.pressure)) / move) : null
        };
      }),
      blockaded: await blockadedPowers(),
      stage_at: STAGE_AT
    });
  }));

  /* ------------------------------------------------------------- reading */

  app.get('/api/war', wrap(async (req, res) => {
    await loadConfig();
    const forces = await liveFormations();
    const totalSize = forces.reduce((n, f) => n + f.size, 0);
    const per = UPKEEP_PER_SIZE();
    const store = await stockpile();

    /* What the next cycle will cost, and how many cycles the store covers at
       the current establishment. "Two cycles of food left" is the number a
       Quartermaster actually needs, so it is the number the page leads with. */
    const forecast = Object.entries(per).map(([category, rate]) => {
      const need = Math.round(totalSize * rate);
      return {
        category,
        per_cycle: need,
        held: store[category] || 0,
        cycles_covered: need > 0 ? Math.floor((store[category] || 0) / need) : null
      };
    });

    res.json({
      quartermaster: await qmNow(),
      appointer: (await pmNow()) ? 'prime_minister' : 'president',
      i_am_quartermaster: !!(req.user && (await holds(req.user.id, 'quartermaster'))),
      formations: forces,
      size: totalSize,
      readiness: forces.length ? Math.round(forces.reduce((n, f) => n + Number(f.readiness), 0) / forces.length) : null,
      stockpile: store,
      forecast,
      wages_per_cycle: money(totalSize * (num('upkeep_pay') || 10)),
      budget: money(num('military_budget_per_cycle')),
      budget_left: await budgetLeft(),
      raise_cost_arms: num('raise_cost_arms') || 5,
      runs: (await q('SELECT * FROM upkeep_runs ORDER BY cycle_no DESC LIMIT 12')).rows,
      movements: (await q(`
        SELECT m.*, u.display_name AS by_name FROM stockpile_movements m
          LEFT JOIN users u ON u.id=m.by_id ORDER BY m.id DESC LIMIT 30`)).rows
    });
  }));

  ctx.war = { runUpkeep, runConflicts, stockpile, move, effectiveStrength, blockadedPowers };
};
