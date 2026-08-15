/* Offshore money, foreign exchange and defection.

   Three features, one ledger. The rule that governs all of them is the one the
   whole Republic is trusted on: `sum(accounts.balance) = 0`, always. Money is
   only ever MOVED between accounts. An offshore account is money that went
   somewhere, not money that went away; a conversion is two movements and a cut
   to the power, never a single-sided write; and a defection does not touch a
   balance at all — it freezes one.

   **Offshore** is opacity, not disappearance. The account is real, its balance
   is real, and it is in the same closed ledger — it is simply held at a foreign
   power under `owner_kind='offshore'`, so it is not in the citizen's public
   account and the tax payrun, which reads `owner_kind='citizen'`, cannot see
   it. What makes it a choice rather than a strictly better account is that the
   House can find it (an inquiry is a bill and produces an ordinary sealed intel
   report), take it (a seizure is a bill), a treaty can compel the haven to
   publish it — and the haven can freeze it the moment relations sour, which is
   usually the moment you wanted it.

   **Forex** moves for three published reasons and never for a fourth: the
   balance of trade with that power, conflict pressure, and what the Fed has
   issued. No randomness. war.js refuses dice on principle — a war a player
   cannot see coming teaches them nothing — and a rate that moves on a die roll
   teaches them less. Every fixing writes the inputs it used into `forex_rates`,
   so a player can do the arithmetic before the payrun runs.

   **Defection** is an explicit act with an explicit route. Article 1.2 ties
   citizenship to membership of the Group, so renouncing has to be something you
   do rather than something that happens to you. It costs the vote, the dividend
   and every office at once, and the two bars that make that true are triggers in
   schema-offshore.sql rather than checks in this file — one person one vote is
   held by the database, and a rule that lives in a permission check is a rule
   the next endpoint forgets. */

module.exports.mount = function mount(app, ctx) {
  const {
    q, tx, log, auth, wrap, num, bool, loadConfig, officesOf,
    canPropose, cycleNow, addEnactHook, slowWrites
  } = ctx;

  /* economy.js mounts first and hands its ledger primitives over on the shared
     context. Without them there is no currency, so there is nothing to send
     abroad and nothing to convert. */
  const E = () => ctx.economy;
  const money = n => Math.round(Number(n) || 0);
  const clean = (s, n = 2000) => String(s ?? '').trim().slice(0, n);
  const cycleNo = () => cycleNow()?.number || 0;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const RATE_MIN = 0.05, RATE_MAX = 20;   // a rate at zero would divide by zero on a sale

  const needEconomy = (_req, res, next) =>
    E() ? next() : res.status(503).json({ error: 'The economy is not running, so there is nowhere for money to go.' });

  const payErr = (res, err) => {
    if (err.code === 'FUNDS' || err.code === 'AMOUNT') return res.status(400).json({ error: err.message });
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  };

  /* Every module here can be removed from the build. diplomacy.js owns `powers`
     and `treaties`, war.js owns `conflict_pressure`; this asks before it reads
     rather than taking any of them down with it. Cached per process because a
     table that exists does not stop existing. */
  const known = new Map();
  async function hasTable(name) {
    if (known.get(name)) return true;
    const there = !!(await q('SELECT to_regclass($1) AS t', ['public.' + name])).rows[0].t;
    if (there) known.set(name, true);
    return there;
  }

  const enabled = async res => {
    await loadConfig();
    if (!bool('offshore_enabled')) {
      res.status(403).json({ error: 'Offshore banking and foreign exchange are switched off.' });
      return false;
    }
    if (!(await hasTable('powers'))) {
      res.status(503).json({ error: 'The Republic has no foreign relations, so there is nowhere offshore to be.' });
      return false;
    }
    return true;
  };

  const powerRow = async id =>
    (await hasTable('powers'))
      ? (await q('SELECT * FROM powers WHERE id=$1 AND revoked_at IS NULL', [Number(id) || 0])).rows[0] || null
      : null;

  const citizenAcc = userId => E().accountFor('citizen', userId);
  const powerAcc = powerId => E().accountFor('power', powerId);
  const offshoreAcc = offshoreId => E().accountFor('offshore', offshoreId);

  /* ================================================== offshore accounts */

  const offshoreRow = async (userId, powerId) =>
    (await q('SELECT * FROM offshore_accounts WHERE user_id=$1 AND power_id=$2', [userId, powerId])).rows[0] || null;

  /* A haven freezes what it holds when relations sour, and thaws it when they
     mend. This is the whole trade-off: an offshore account is out of the
     Treasury's sight and out of your own reach at exactly the moment a war you
     voted for makes you want it. Nothing here is a judgement call — the three
     conditions are the ones the rest of the Republic already publishes. */
  async function hostilePowers() {
    const why = new Map();
    if (!(await hasTable('powers'))) return why;
    for (const p of (await q("SELECT id, standing FROM powers WHERE revoked_at IS NULL")).rows) {
      if (p.standing === 'at_war') why.set(p.id, 'the Republic is at war with this power');
      else if (p.standing === 'hostile') why.set(p.id, 'relations with this power are hostile');
    }
    if (await hasTable('treaties')) {
      for (const r of (await q('SELECT DISTINCT power_id FROM treaties WHERE denounced_at IS NOT NULL')).rows)
        if (!why.has(r.power_id)) why.set(r.power_id, 'a treaty with this power has been denounced');
    }
    if (ctx.war?.blockadedPowers) {
      for (const id of await ctx.war.blockadedPowers())
        if (!why.has(id)) why.set(id, 'this power is under blockade');
    }
    return why;
  }

  /* Run on every read of the page as well as in the payrun. A freeze that only
     took effect once a cycle would mean a citizen emptying their account in the
     minutes after a declaration of war, which is precisely the move the freeze
     exists to prevent. */
  async function syncFreezes() {
    const why = await hostilePowers();
    let froze = 0, thawed = 0;
    for (const a of (await q('SELECT * FROM offshore_accounts')).rows) {
      const reason = why.get(a.power_id) || null;
      if (reason && !a.frozen_at) {
        await q('UPDATE offshore_accounts SET frozen_at=now(), frozen_reason=$2 WHERE id=$1', [a.id, reason]);
        log(null, 'offshore.frozen', `account #${a.id}: ${reason}`);
        froze++;
      } else if (!reason && a.frozen_at) {
        await q("UPDATE offshore_accounts SET frozen_at=NULL, frozen_reason='' WHERE id=$1", [a.id]);
        log(null, 'offshore.thawed', `account #${a.id}`);
        thawed++;
      }
    }
    return { froze, thawed };
  }

  /* ============================================== foreign exchange rates */

  const codeFor = async power => {
    const base = (clean(power.name, 40).replace(/[^A-Za-z]/g, '').slice(0, 3) || 'FX').toUpperCase();
    const taken = (await q('SELECT 1 FROM currencies WHERE code=$1 AND power_id<>$2', [base, power.id])).rows[0];
    return taken ? `${base}${power.id}` : base;
  };

  async function currencyFor(powerId) {
    const found = (await q('SELECT * FROM currencies WHERE power_id=$1', [powerId])).rows[0];
    if (found) return found;
    const p = await powerRow(powerId);
    if (!p) return null;
    /* A new currency opens at parity. Every move it ever makes after that is in
       forex_rates with the reasons attached, so the whole history of a rate is
       readable from a single table. */
    const { rows } = await q(
      'INSERT INTO currencies(power_id, code, name) VALUES($1,$2,$3) ON CONFLICT (power_id) DO UPDATE SET code=EXCLUDED.code RETURNING *',
      [powerId, await codeFor(p), `${clean(p.adjective || p.name, 40)} currency`]
    );
    return rows[0];
  }

  /* One fixing, for one power, for one cycle. Three inputs, three published
     weights, one bounded step. The signal is deliberately additive and linear:
     a player should be able to work out next cycle's rate on the back of an
     envelope, because a rate nobody can predict is a casino and a casino
     teaches them that nothing they do matters. */
  async function fixRate(cur, cycle) {
    if ((await q('SELECT 1 FROM forex_rates WHERE power_id=$1 AND cycle_no=$2', [cur.power_id, cycle])).rows[0])
      return null;

    let net = 0, seen = Number(cur.trade_seen_id);
    if (await hasTable('foreign_trade')) {
      /* An export is them buying from us and wanting our money; an import is us
         wanting theirs. Counted from the last fixing's high-water mark rather
         than by cycle, so a stopped clock cannot make trade invisible and a
         payrun run twice cannot count the same deal twice. */
      const r = (await q(
        `SELECT COALESCE(sum(CASE WHEN direction='export' THEN amount ELSE -amount END),0)::bigint net,
                COALESCE(max(id), $2::bigint) hi
           FROM foreign_trade WHERE power_id=$1 AND id > $2::bigint`,
        [cur.power_id, cur.trade_seen_id]
      )).rows[0];
      net = Number(r.net);
      seen = Number(r.hi);
    }

    let pressure = 0;
    if ((await hasTable('conflict_pressure')) && (await hasTable('foreign_conflicts'))) {
      const r = (await q(
        `SELECT COALESCE(max(cp.pressure), 0) p FROM conflict_pressure cp
           JOIN foreign_conflicts c ON c.id = cp.conflict_id
          WHERE c.power_id=$1 AND c.status NOT IN ('resolved','withdrawn')`,
        [cur.power_id]
      )).rows[0];
      pressure = Number(r.p);
    }

    /* What the Fed has put into circulation since this rate last moved. The
       ledger is the record of it, so this is the same number anyone can add up
       from /api/fed. */
    const issuedTotal = Number(
      (await q("SELECT COALESCE(sum(amount),0)::bigint s FROM ledger WHERE kind='issue'")).rows[0].s
    );
    const issuance = Math.max(0, issuedTotal - Number(cur.issued_seen));

    const wT = Number(num('forex_weight_trade')) || 0;
    const wP = Number(num('forex_weight_pressure')) || 0;
    const wI = Number(num('forex_weight_issuance')) || 0;
    const tradeScale = Math.max(1, Number(num('forex_trade_scale')) || 1);
    const issueScale = Math.max(1, Number(num('forex_issuance_scale')) || 1);
    const step = Math.max(0, Number(num('forex_step')) || 0);

    /* A surplus with a power makes our money worth more of theirs; losing a
       conflict with them and printing at home both make it worth less. */
    const signal = clamp(
      wT * clamp(net / tradeScale, -1, 1)
      - wP * clamp(pressure / 100, -1, 1)
      - wI * clamp(issuance / issueScale, 0, 1),
      -1, 1
    );
    const before = Number(cur.rate);
    const after = clamp(Number((before * (1 + step * signal)).toFixed(6)), RATE_MIN, RATE_MAX);

    await q(
      `INSERT INTO forex_rates(power_id,cycle_no,rate_before,rate_after,trade_balance,pressure,issuance,signal,note)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cur.power_id, cycle, before, after, net, pressure, issuance, signal,
        `trade ${net >= 0 ? '+' : ''}${net}, pressure ${Math.round(pressure)}, issuance ${issuance}`]
    );
    await q('UPDATE currencies SET rate=$2, trade_seen_id=$3, issued_seen=$4 WHERE power_id=$1',
      [cur.power_id, after, seen, issuedTotal]);
    return { power_id: cur.power_id, before, after, net, pressure, issuance, signal };
  }

  /* Called from economy.js's payrun, with the rest of the cycle's business. */
  async function runPayrun(cycle, actorId) {
    await loadConfig();
    if (!E()) return { reason: 'the economy is not running' };
    if (!bool('offshore_enabled')) return { reason: 'offshore and forex are switched off' };
    if (!(await hasTable('powers'))) return { reason: 'the Republic has no foreign relations' };
    const freezes = await syncFreezes();
    const fixed = [];
    for (const p of (await q('SELECT id FROM powers WHERE revoked_at IS NULL ORDER BY id')).rows) {
      const cur = await currencyFor(p.id);
      if (!cur) continue;
      const moved = await fixRate(cur, cycle);
      if (moved) fixed.push(moved);
    }
    if (fixed.length) log(actorId, 'forex.fixing', `cycle ${cycle}: ${fixed.length} rates fixed`);
    return { ...freezes, fixed: fixed.length, rates: fixed };
  }

  /* ============================================================ reading */

  app.get('/api/offshore', wrap(async (req, res) => {
    await loadConfig();
    if (!E()) return res.status(503).json({ error: 'The economy is not running.' });
    if (!(await hasTable('powers')))
      return res.status(503).json({ error: 'The Republic has no foreign relations, so there is nowhere offshore to be.' });
    await syncFreezes();

    const me = req.user?.id || null;
    const havens = new Map(
      (await q('SELECT * FROM offshore_havens')).rows.map(h => [h.power_id, h])
    );
    const powers = [];
    for (const p of (await q('SELECT id,name,adjective,colour,standing FROM powers WHERE revoked_at IS NULL ORDER BY name')).rows) {
      const cur = await currencyFor(p.id);
      const acct = me ? await offshoreRow(me, p.id) : null;
      const bal = acct ? Number((await offshoreAcc(acct.id)).balance) : 0;
      const fx = me
        ? Number((await q('SELECT units FROM fx_holdings WHERE user_id=$1 AND power_id=$2', [me, p.id])).rows[0]?.units || 0)
        : 0;
      powers.push({
        id: p.id, name: p.name, adjective: p.adjective, colour: p.colour, standing: p.standing,
        currency: cur ? { code: cur.code, name: cur.name, rate: Number(cur.rate) } : null,
        discloses: !!havens.get(p.id)?.discloses,
        my_account: acct
          ? { id: acct.id, balance: bal, frozen: !!acct.frozen_at, frozen_reason: acct.frozen_reason, opened_at: acct.opened_at }
          : null,
        my_units: fx
      });
    }

    /* A haven that has agreed by treaty to publish is no longer a haven, and
       what it holds is on the open record for everybody — which is the whole
       point of having negotiated the treaty. */
    const disclosed = (await q(`
      SELECT o.power_id, u.display_name, a.balance
        FROM offshore_accounts o
        JOIN offshore_havens h ON h.power_id = o.power_id AND h.discloses
        JOIN users u ON u.id = o.user_id
        LEFT JOIN accounts a ON a.owner_kind='offshore' AND a.owner_id = o.id
       WHERE COALESCE(a.balance,0) > 0 ORDER BY a.balance DESC`)).rows;

    res.json({
      enabled: bool('offshore_enabled'),
      cycle: cycleNo(),
      currency: { name: ctx.CONFIG.currency_name, symbol: ctx.CONFIG.currency_symbol },
      powers,
      disclosed,
      /* Publish the inputs. This is the difference between a rate a player can
         plan around and a rate they can only be surprised by. */
      settings: {
        offshore_fee: Number(num('offshore_fee')),
        offshore_minimum: money(num('offshore_minimum')),
        forex_spread: Number(num('forex_spread')),
        forex_step: Number(num('forex_step')),
        forex_weight_trade: Number(num('forex_weight_trade')),
        forex_weight_pressure: Number(num('forex_weight_pressure')),
        forex_weight_issuance: Number(num('forex_weight_issuance')),
        forex_trade_scale: Number(num('forex_trade_scale')),
        forex_issuance_scale: Number(num('forex_issuance_scale')),
        defection_return_share: Number(num('defection_return_share'))
      },
      fixings: (await q(`
        SELECT f.*, p.name AS power_name FROM forex_rates f
          LEFT JOIN powers p ON p.id=f.power_id ORDER BY f.id DESC LIMIT 40`)).rows,
      my_trades: me
        ? (await q('SELECT * FROM fx_trades WHERE user_id=$1 ORDER BY id DESC LIMIT 20', [me])).rows
        : [],
      /* Renouncing is a public act. Who has gone, to whom, and what they were
         holding when they went is not the sort of thing a Republic keeps quiet. */
      defections: (await q(`
        SELECT d.*, u.display_name, p.name AS power_name FROM defections d
          JOIN users u ON u.id=d.user_id
          LEFT JOIN powers p ON p.id=d.power_id ORDER BY d.id DESC`)).rows,
      my_defection: me
        ? (await q("SELECT * FROM defections WHERE user_id=$1 AND status='defected'", [me])).rows[0] || null
        : null,
      inquiries: (await q(`
        SELECT i.*, b.ref, b.title, b.status FROM offshore_inquiries i
          JOIN bills b ON b.id=i.bill_id ORDER BY i.id DESC LIMIT 20`)).rows,
      seizures: (await q(`
        SELECT s.*, b.ref, b.title, b.status, u.display_name FROM offshore_seizures s
          JOIN bills b ON b.id=s.bill_id LEFT JOIN users u ON u.id=s.user_id
         ORDER BY s.id DESC LIMIT 20`)).rows
    });
  }));

  /* ================================================ opening and funding */

  app.post('/api/offshore/open', auth, needEconomy, slowWrites, wrap(async (req, res) => {
    if (!(await enabled(res))) return;
    const p = await powerRow(req.body?.power_id);
    if (!p) return res.status(400).json({ error: 'Name a foreign power to bank with.' });
    if (await offshoreRow(req.user.id, p.id))
      return res.status(409).json({ error: `You already hold an account with ${p.name}.` });
    const { rows } = await q('INSERT INTO offshore_accounts(user_id,power_id) VALUES($1,$2) RETURNING *',
      [req.user.id, p.id]);
    await offshoreAcc(rows[0].id);          // the ledger account, at zero
    await syncFreezes();                    // opened at a power already at war? then it opens frozen
    log(req.user.id, 'offshore.open', `${p.name}`);
    res.json({ ok: true, account: rows[0] });
  }));

  /* A deposit is two movements: the haven's fee to the power, and the rest to
     the account it holds for you. Both sides of both are written, so the money
     is exactly where it was — somewhere else. */
  app.post('/api/offshore/deposit', auth, needEconomy, slowWrites, wrap(async (req, res) => {
    if (!(await enabled(res))) return;
    const p = await powerRow(req.body?.power_id);
    if (!p) return res.status(400).json({ error: 'Name a foreign power to bank with.' });
    const acct = await offshoreRow(req.user.id, p.id);
    if (!acct) return res.status(400).json({ error: `You hold no account with ${p.name}.` });
    if (acct.frozen_at)
      return res.status(409).json({ error: `${p.name} has frozen what it holds for you: ${acct.frozen_reason}.` });

    const amount = money(req.body?.amount);
    const least = money(num('offshore_minimum'));
    if (amount < Math.max(1, least))
      return res.status(400).json({ error: `${p.name} will not take less than ${least} at a time.` });

    /* The fee rounds UP, always, and it is the haven's. Rounding a foreign
       bank's charge in the customer's favour is how a conversion loop becomes a
       money printer. */
    const fee = Math.ceil(amount * (Number(num('offshore_fee')) || 0));
    const net = amount - fee;
    if (net <= 0) return res.status(400).json({ error: 'The fee would take the whole deposit.' });

    const from = await citizenAcc(req.user.id);
    const to = await offshoreAcc(acct.id);
    const pa = await powerAcc(p.id);
    try {
      await tx(async run => {
        await E().pay(from.id, to.id, net, 'offshore', `deposited with ${p.name}`, run);
        if (fee > 0) await E().pay(from.id, pa.id, fee, 'offshore_fee', `${p.name}'s charge`, run);
      });
    } catch (err) { return payErr(res, err); }
    /* The audit line says a deposit happened and where, and nothing about how
       much. The amount is the thing the House has to pass a bill to learn. */
    log(req.user.id, 'offshore.deposit', `${p.name}`);
    res.json({ ok: true, deposited: net, fee });
  }));

  app.post('/api/offshore/withdraw', auth, needEconomy, slowWrites, wrap(async (req, res) => {
    if (!(await enabled(res))) return;
    const p = await powerRow(req.body?.power_id);
    if (!p) return res.status(400).json({ error: 'Name a foreign power.' });
    const acct = await offshoreRow(req.user.id, p.id);
    if (!acct) return res.status(400).json({ error: `You hold no account with ${p.name}.` });
    await syncFreezes();
    const live = await offshoreRow(req.user.id, p.id);
    if (live.frozen_at)
      return res.status(409).json({ error: `${p.name} has frozen what it holds for you: ${live.frozen_reason}.` });
    const from = await offshoreAcc(acct.id);
    const to = await citizenAcc(req.user.id);
    try {
      await E().pay(from.id, to.id, money(req.body?.amount), 'offshore', `withdrawn from ${p.name}`);
    } catch (err) { return payErr(res, err); }
    log(req.user.id, 'offshore.withdraw', `${p.name}`);
    res.json({ ok: true });
  }));

  /* ================================================ buying and selling FX

     Every conversion is two movements and a spread to the power. The marks
     never leave the ledger: they go to the power's account, and what the
     citizen gets back is a claim in `fx_holdings`, which is deliberately NOT an
     account — it is somebody else's money, and putting it on our balance sheet
     would be minting.

     Every rounding in both directions goes the same way: the payout floors, the
     spread ceilings. A→B→A therefore always ends with less than it started,
     even with the spread set to nothing, because floor(floor(m·r)/r) ≤ m. That
     is the arbitrage loop closed by arithmetic rather than by a check somebody
     could remove. */

  app.post('/api/forex/buy', auth, needEconomy, slowWrites, wrap(async (req, res) => {
    if (!(await enabled(res))) return;
    const p = await powerRow(req.body?.power_id);
    if (!p) return res.status(400).json({ error: 'Name a foreign power to buy from.' });
    const cur = await currencyFor(p.id);
    if (!cur) return res.status(400).json({ error: 'That power has no currency.' });

    const marks = money(req.body?.amount);
    if (marks < 1) return res.status(400).json({ error: 'Say how much you want to convert.' });
    const spread = Math.max(0, Number(num('forex_spread')) || 0);
    const rate = Number(cur.rate);
    const fee = Math.ceil(marks * spread);
    const net = marks - fee;
    if (net <= 0) return res.status(400).json({ error: 'The spread would take the whole amount.' });
    const units = Math.floor(net * rate);
    if (units < 1)
      return res.status(400).json({ error: `That is too little to buy a single ${cur.code} at ${rate}.` });

    const from = await citizenAcc(req.user.id);
    const pa = await powerAcc(p.id);
    try {
      await tx(async run => {
        await E().pay(from.id, pa.id, net, 'forex', `bought ${units} ${cur.code}`, run);
        if (fee > 0) await E().pay(from.id, pa.id, fee, 'forex_spread', `${cur.code} spread`, run);
        await run(
          `INSERT INTO fx_holdings(user_id,power_id,units) VALUES($1,$2,$3::bigint)
             ON CONFLICT (user_id,power_id) DO UPDATE SET units = fx_holdings.units + $3::bigint`,
          [req.user.id, p.id, units]
        );
        await run('INSERT INTO fx_trades(user_id,power_id,side,marks,units,spread,rate) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [req.user.id, p.id, 'buy', marks, units, fee, rate]);
      });
    } catch (err) { return payErr(res, err); }
    log(req.user.id, 'forex.buy', `${marks} for ${units} ${cur.code} at ${rate}`);
    res.json({ ok: true, spent: marks, units, spread: fee, rate });
  }));

  app.post('/api/forex/sell', auth, needEconomy, slowWrites, wrap(async (req, res) => {
    if (!(await enabled(res))) return;
    const p = await powerRow(req.body?.power_id);
    if (!p) return res.status(400).json({ error: 'Name a foreign power to sell to.' });
    const cur = await currencyFor(p.id);
    if (!cur) return res.status(400).json({ error: 'That power has no currency.' });

    const units = money(req.body?.units);
    if (units < 1) return res.status(400).json({ error: 'Say how many units you want to sell.' });
    const have = Number((await q('SELECT units FROM fx_holdings WHERE user_id=$1 AND power_id=$2',
      [req.user.id, p.id])).rows[0]?.units || 0);
    if (have < units) return res.status(400).json({ error: `You hold only ${have} ${cur.code}.` });

    const rate = Number(cur.rate);
    const spread = Math.max(0, Number(num('forex_spread')) || 0);
    const gross = Math.floor(units / rate);
    const fee = Math.ceil(gross * spread);
    const nett = gross - fee;
    if (nett < 1) return res.status(400).json({ error: 'That comes to less than a mark once the spread is taken.' });

    const pa = await powerAcc(p.id);
    const to = await citizenAcc(req.user.id);
    try {
      await tx(async run => {
        /* The power pays out and is immediately paid its cut back, rather than
           quietly paying less than it owes. Two movements, both on the record,
           so the spread is a line in the ledger a citizen can point at. */
        await E().pay(pa.id, to.id, gross, 'forex', `sold ${units} ${cur.code}`, run);
        if (fee > 0) await E().pay(to.id, pa.id, fee, 'forex_spread', `${cur.code} spread`, run);
        await run('UPDATE fx_holdings SET units = units - $3::bigint WHERE user_id=$1 AND power_id=$2',
          [req.user.id, p.id, units]);
        await run('INSERT INTO fx_trades(user_id,power_id,side,marks,units,spread,rate) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [req.user.id, p.id, 'sell', nett, units, fee, rate]);
      });
    } catch (err) {
      if (err.code === 'FUNDS')
        return res.status(409).json({ error: `${p.name} cannot honour that today — it does not hold the marks.` });
      return payErr(res, err);
    }
    log(req.user.id, 'forex.sell', `${units} ${cur.code} for ${nett} at ${rate}`);
    res.json({ ok: true, units, received: nett, spread: fee, rate });
  }));

  /* ======================================== what the House can do about it */

  const nextBillRef = async () =>
    'B' + String((await q('SELECT count(*)::int n FROM bills')).rows[0].n + 1).padStart(3, '0');

  async function makeBill(userId, title, body) {
    const ref = await nextBillRef();
    /* A motion, not a law. The House is instructing somebody to do a thing
       once, and a hole in the statute book for each one would be worse than
       useless. Bills are never deleted either way — a withdrawn one keeps its
       number. */
    return (await q(
      "INSERT INTO bills(ref,title,kind,body,author_id) VALUES($1,$2,'motion',$3,$4) RETURNING *",
      [ref, clean(title, 200), body, userId]
    )).rows[0];
  }

  /* canPropose() alone is not enough here: if the House has ever opened bill
     proposal to every citizen (bill_proposers='citizens'), it checks nothing
     about defection, and a foreign subject could author a Republic bill —
     including, perversely, their own readmission. The users table does not stop
     existing when somebody renounces, only the offices and the vote do, so this
     has to be asked directly rather than inferred from what canPropose() checks
     for a different reason. */
  const mayPropose = async (req, res) => {
    if ((await q("SELECT 1 FROM defections WHERE user_id=$1 AND status='defected'", [req.user.id])).rows[0]) {
      res.status(403).json({ error: 'A subject of a foreign power cannot propose a bill in this one.' });
      return false;
    }
    if (await canPropose(req.user.id)) return true;
    res.status(403).json({ error: 'Only the House may move that. A rule bill can open it to every citizen.' });
    return false;
  };

  /* An inquiry: the House ordering the intelligence service to find out who
     holds what abroad. It reuses the machinery diplomacy.js already built and
     adds no new kind of secrecy — a sealed report, a clock nobody can stop, and
     a register of every read that is public while the report is not. */
  app.post('/api/offshore/inquiry', auth, needEconomy, wrap(async (req, res) => {
    if (!(await enabled(res))) return;
    if (!(await mayPropose(req, res))) return;
    const p = req.body?.power_id ? await powerRow(req.body.power_id) : null;
    if (req.body?.power_id && !p) return res.status(400).json({ error: 'No such foreign power.' });

    const ids = [...new Set((Array.isArray(req.body?.clear) ? req.body.clear : [])
      .map(Number).filter(n => Number.isInteger(n) && n > 0))];
    const cleared = ids.length
      ? (await q('SELECT id, display_name FROM users WHERE id = ANY($1::int[]) AND is_active AND approved', [ids])).rows
      : [];
    if (!cleared.length)
      return res.status(400).json({ error: 'Name at least one citizen the inquiry clears to read what it finds. A report nobody may read is not an inquiry.' });

    const scope = p ? `accounts held at ${p.name}` : 'accounts held at any foreign power';
    const body = clean(req.body?.body) ||
      `The intelligence service is directed to report on ${scope} by citizens of the Republic.\n\n` +
      `The report is sealed on the ordinary terms and may be read by: ${cleared.map(c => c.display_name).join(', ')}.\n` +
      `Every reading of it is written to the open register, as with any other report.`;
    const bill = await makeBill(req.user.id, clean(req.body?.title, 200) || `Inquiry into ${scope}`, body);
    await q('INSERT INTO offshore_inquiries(bill_id,power_id,clearances) VALUES($1,$2,$3)',
      [bill.id, p?.id || null, cleared.map(c => c.id).join(',')]);
    log(req.user.id, 'offshore.inquiry', `${bill.ref}: ${scope}`);
    res.json(bill);
  }));

  /* A seizure: the House taking what a citizen holds abroad. It is a bill, and
     it can come back empty-handed — a haven that has frozen the account does
     not hand it over because we voted. That is recorded as unreachable rather
     than pretended away. */
  app.post('/api/offshore/seizure', auth, needEconomy, wrap(async (req, res) => {
    if (!(await enabled(res))) return;
    if (!(await mayPropose(req, res))) return;
    const target = (await q('SELECT id, display_name FROM users WHERE id=$1', [Number(req.body?.user_id) || 0])).rows[0];
    if (!target) return res.status(400).json({ error: 'Name the citizen whose holdings are to be seized.' });
    const p = req.body?.power_id ? await powerRow(req.body.power_id) : null;
    if (req.body?.power_id && !p) return res.status(400).json({ error: 'No such foreign power.' });

    const where = p ? `at ${p.name}` : 'at any foreign power';
    const body = clean(req.body?.body) ||
      `The offshore holdings of ${target.display_name} ${where} are forfeit to the Treasury.\n\n` +
      `What a haven has frozen cannot be reached, and what cannot be reached is recorded as such.`;
    const bill = await makeBill(req.user.id,
      clean(req.body?.title, 200) || `Seizure of offshore holdings — ${target.display_name}`, body);
    await q('INSERT INTO offshore_seizures(bill_id,user_id,power_id) VALUES($1,$2,$3)',
      [bill.id, target.id, p?.id || null]);
    log(req.user.id, 'offshore.seizure', `${bill.ref}: ${target.display_name} ${where}`);
    res.json(bill);
  }));

  /* ========================================================== defection */

  app.post('/api/defection', auth, needEconomy, slowWrites, wrap(async (req, res) => {
    if (!(await enabled(res))) return;
    const p = await powerRow(req.body?.power_id);
    if (!p) return res.status(400).json({ error: 'Name the foreign power you are joining.' });
    if ((await q("SELECT 1 FROM defections WHERE user_id=$1 AND status='defected'", [req.user.id])).rows[0])
      return res.status(409).json({ error: 'You have already renounced the Republic.' });
    const reasons = clean(req.body?.reasons, 1000);
    if (reasons.length < 10)
      return res.status(400).json({ error: 'Say why, in a sentence. Leaving is a public act.' });

    /* Ask what office they hold first, and whether they are the Returning
       Officer second — they are different questions and this is a group where
       one account is routinely both. The offices go, whatever they are. The
       keys to the machinery cannot: an RO who is a foreign subject still runs
       our elections, and there is no honest version of that. */
    const held = await officesOf(req.user.id);
    const isRO = !!(await q('SELECT is_admin FROM users WHERE id=$1', [req.user.id])).rows[0]?.is_admin;
    if (isRO)
      return res.status(403).json({
        error: 'The Returning Officer runs the Republic\'s machinery and cannot renounce it while holding the keys. Hand the role over first.'
      });

    const acc = await citizenAcc(req.user.id);
    let row;
    await tx(async run => {
      /* Immediately, and in one step with the renunciation. An officer who
         defects while holding a seat is the interesting case and the one most
         likely to be exploited, so there is no window in which they are both. */
      await run("UPDATE offices SET active=FALSE, until=now() WHERE user_id=$1 AND active", [req.user.id]);
      row = (await run(
        `INSERT INTO defections(user_id,power_id,reasons,offices_lost,sequestered,renounced_cycle)
         VALUES($1,$2,$3,$4,$5::bigint,$6) RETURNING *`,
        [req.user.id, p.id, reasons, held.join(','), Number(acc.balance), cycleNo()]
      )).rows[0];
    });
    log(req.user.id, 'defection', `to ${p.name}${held.length ? `, vacating ${held.join(', ')}` : ''}`);
    res.json({
      ok: true,
      defection: row,
      offices_lost: held,
      /* Said plainly, because the balance is now unreachable and somebody will
         otherwise think the money was taken. It was not: it is exactly where
         they left it, and only the House can move it. */
      frozen: Number(acc.balance)
    });
  }));

  /* The route back. Somebody in the House has to move it — a subject of a
     foreign power cannot propose a bill in ours — and it costs a share of what
     was frozen. Permanent exile ends a player's game and this is nineteen
     friends; a free return would make renouncing a costless holiday. */
  app.post('/api/defections/:id/readmit', auth, needEconomy, wrap(async (req, res) => {
    if (!(await enabled(res))) return;
    if (!(await mayPropose(req, res))) return;
    const d = (await q(`
      SELECT d.*, u.display_name, p.name AS power_name FROM defections d
        JOIN users u ON u.id=d.user_id LEFT JOIN powers p ON p.id=d.power_id
       WHERE d.id=$1`, [Number(req.params.id) || 0])).rows[0];
    if (!d) return res.status(404).json({ error: 'No such renunciation.' });
    if (d.status !== 'defected') return res.status(409).json({ error: 'That citizen has already been readmitted.' });
    if ((await q("SELECT 1 FROM defection_returns r JOIN bills b ON b.id=r.bill_id WHERE r.defection_id=$1 AND b.status NOT IN ('failed','withdrawn','vetoed')", [d.id])).rows[0])
      return res.status(409).json({ error: 'A readmission for that citizen is already before the House.' });

    const share = Math.max(0, Number(num('defection_return_share')) || 0);
    const body = clean(req.body?.body) ||
      `${d.display_name}, having renounced the Republic for ${d.power_name || 'a foreign power'}, is readmitted to citizenship.\n\n` +
      `Their domestic holdings are unfrozen on enactment, less ${Math.round(share * 100)}% to the Treasury.\n` +
      `No office is restored. Offices are filled by election, and they left theirs.`;
    const bill = await makeBill(req.user.id, clean(req.body?.title, 200) || `Readmission of ${d.display_name}`, body);
    await q('INSERT INTO defection_returns(bill_id,defection_id) VALUES($1,$2)', [bill.id, d.id]);
    log(req.user.id, 'defection.readmit', `${bill.ref}: ${d.display_name}`);
    res.json(bill);
  }));

  /* =================================================== enactment */

  addEnactHook(async (bill, actorId) => {
    if (!E()) return;
    await loadConfig();

    /* A treaty that compels disclosure. diplomacy.js owns the treaty and the
       bill; all this does is read the terms the House assented to. */
    if (await hasTable('treaties')) {
      const t = (await q('SELECT * FROM treaties WHERE bill_id=$1', [bill.id])).rows[0];
      if (t && (t.terms?.offshore_disclosure === true || t.terms?.offshore_disclosure === 'true')) {
        await q(`INSERT INTO offshore_havens(power_id,discloses,treaty_id,bill_id) VALUES($1,TRUE,$2,$3)
                 ON CONFLICT (power_id) DO UPDATE SET discloses=TRUE, treaty_id=EXCLUDED.treaty_id, bill_id=EXCLUDED.bill_id`,
          [t.power_id, t.id, bill.id]);
        log(actorId, 'offshore.disclosure', `power #${t.power_id} by ${bill.ref}`);
      }
    }

    const inq = (await q('SELECT * FROM offshore_inquiries WHERE bill_id=$1 AND executed_at IS NULL', [bill.id])).rows[0];
    if (inq) await runInquiry(inq, bill, actorId);

    const seiz = (await q('SELECT * FROM offshore_seizures WHERE bill_id=$1 AND executed_at IS NULL', [bill.id])).rows[0];
    if (seiz) await runSeizure(seiz, bill, actorId);

    const ret = (await q('SELECT * FROM defection_returns WHERE bill_id=$1 AND executed_at IS NULL', [bill.id])).rows[0];
    if (ret) await runReturn(ret, bill, actorId);
  });

  async function runInquiry(inq, bill, actorId) {
    const svc = ctx.intel?.intelService ? await ctx.intel.intelService() : null;
    if (!svc) {
      await q("UPDATE offshore_inquiries SET executed_at=now(), note=$2 WHERE id=$1",
        [inq.id, 'The Republic has no intelligence service, so there was nobody to direct.']);
      log(actorId, 'offshore.inquiry.void', `${bill.ref}: no intelligence service`);
      return;
    }
    const holdings = (await q(`
      SELECT u.display_name, p.name AS power_name, COALESCE(a.balance,0)::bigint balance
        FROM offshore_accounts o
        JOIN users u ON u.id=o.user_id
        LEFT JOIN powers p ON p.id=o.power_id
        LEFT JOIN accounts a ON a.owner_kind='offshore' AND a.owner_id=o.id
       WHERE ($1::int IS NULL OR o.power_id=$1) AND COALESCE(a.balance,0) > 0
       ORDER BY a.balance DESC`, [inq.power_id])).rows;

    const cycle = cycleNo();
    const body = holdings.length
      ? holdings.map(h => `${h.display_name} holds ${h.balance} at ${h.power_name || 'a foreign power'}.`).join('\n')
      : 'No citizen holds a balance at any haven within the scope of this inquiry.';
    const ref = 'IR' + String((await q('SELECT count(*)::int n FROM intel_reports')).rows[0].n + 1).padStart(3, '0');
    const { rows } = await q(
      `INSERT INTO intel_reports(ref,power_id,subject,body,confidence,sourcing,filed_by,filed_cycle,declassifies_at_cycle)
       VALUES($1,$2,$3,$4,'high',$5,$6,$7,$8) RETURNING id`,
      [ref, inq.power_id, `Offshore holdings — ${bill.ref}`, body,
        `The register of foreign accounts, compelled by ${bill.ref}.`,
        bill.author_id, cycle, cycle + Number(svc.declassify_after_cycles || 0)]
    );
    /* Clearance is a row in the register and nothing else — no office confers
       it, and the House naming who may read this is the House writing the rows.
       The reads are then written to the open register like any other. */
    for (const id of String(inq.clearances || '').split(',').map(Number).filter(Boolean)) {
      await q('INSERT INTO intel_clearance(user_id,granted_by,reason) VALUES($1,$2,$3) ON CONFLICT (user_id) DO NOTHING',
        [id, bill.author_id, `Cleared by ${bill.ref} to read the offshore inquiry.`]);
    }
    await q('UPDATE offshore_inquiries SET report_id=$2, executed_at=now(), note=$3 WHERE id=$1',
      [inq.id, rows[0].id, `${holdings.length} holding(s) reported in ${ref}.`]);
    log(actorId, 'offshore.inquiry.filed', `${bill.ref}: ${ref}, ${holdings.length} holdings`);
  }

  async function runSeizure(seiz, bill, actorId) {
    const t = await E().treasury();
    let taken = 0, unreachable = 0;
    await syncFreezes();
    const accts = (await q(`
      SELECT o.*, COALESCE(a.balance,0)::bigint balance, a.id AS account_id
        FROM offshore_accounts o
        LEFT JOIN accounts a ON a.owner_kind='offshore' AND a.owner_id=o.id
       WHERE o.user_id=$1 AND ($2::int IS NULL OR o.power_id=$2)`, [seiz.user_id, seiz.power_id])).rows;
    for (const a of accts) {
      const bal = Number(a.balance);
      if (bal <= 0) continue;
      /* A haven that has frozen the account does not hand it over because we
         voted. Recording that is the honest outcome; moving the money anyway
         would make the freeze decorative and the seizure a promise the Republic
         cannot keep. */
      if (a.frozen_at) { unreachable += bal; continue; }
      /* pay() re-checks the balance under its own row lock, so a withdrawal
         landing between the SELECT above and here is not a race this can lose
         money to — worst case it takes less than `bal` and says so, rather than
         throwing and leaving the rest of the bill's seizures un-executed. */
      try {
        taken += await E().pay(a.account_id, t.id, bal, 'offshore_seizure', `${bill.ref}`);
      } catch (err) {
        if (err.code !== 'FUNDS') throw err;
        unreachable += bal;
      }
    }
    await q('UPDATE offshore_seizures SET taken=$2::bigint, unreachable=$3::bigint, executed_at=now() WHERE id=$1',
      [seiz.id, taken, unreachable]);
    log(actorId, 'offshore.seizure.done', `${bill.ref}: ${taken} taken, ${unreachable} out of reach`);
  }

  async function runReturn(ret, bill, actorId) {
    const d = (await q('SELECT * FROM defections WHERE id=$1', [ret.defection_id])).rows[0];
    if (!d || d.status !== 'defected') {
      await q('UPDATE defection_returns SET executed_at=now() WHERE id=$1', [ret.id]);
      return;
    }
    const acc = await E().accountFor('citizen', d.user_id);
    const share = clamp(Number(num('defection_return_share')) || 0, 0, 1);
    const cost = money(Number(acc.balance) * share);
    const t = await E().treasury();
    await tx(async run => {
      /* Order matters and is the reason there is no exemption anywhere in the
         freeze. The renunciation ends first; only then is the cost taken, by
         which time the payer is a citizen again and the trigger has nothing to
         say. If the payment fails the whole thing rolls back and they are still
         a foreign subject. */
      await run("UPDATE defections SET status='returned', returned_at=now(), return_bill_id=$2, returned_cost=$3::bigint WHERE id=$1",
        [d.id, bill.id, cost]);
      if (cost > 0) await E().pay(acc.id, t.id, cost, 'defection_return', `${bill.ref}`, run);
    });
    await q('UPDATE defection_returns SET executed_at=now() WHERE id=$1', [ret.id]);
    log(actorId, 'defection.returned', `${bill.ref}: ${cost} to the Treasury`);
  }

  /* What the rest of the Republic may ask this module.

     `defectors` is the one that matters elsewhere: economy.js takes it off the
     context so the dividend is not paid to somebody who has renounced and the
     tax payrun does not try to take from an account the database will not let
     it touch, and server.js takes it off the roll so a defector cannot raise
     the bar on a citizens' supermajority by being a name that can never sign. */
  ctx.offshore = {
    runPayrun,
    syncFreezes,
    async defectors() {
      if (!known.get('defections') && !(await hasTable('defections'))) return [];
      return (await q(`
        SELECT d.user_id FROM defections d JOIN users u ON u.id=d.user_id
         WHERE d.status='defected' AND u.is_active AND u.approved`)).rows.map(r => r.user_id);
    }
  };
};
