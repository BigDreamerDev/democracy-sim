/* Collection and operations.

   schema-diplomacy.sql built the filing cabinet: a charter, a budget, a
   declassification clock, sealed reports, an open register of who read what.
   Nothing was in the drawers. This puts something in them, under the same rule
   that governs war and forex in this codebase: no randomness, ever. A mission's
   result is arithmetic over published numbers — the agency's tradecraft, an
   asset's own experience, the budget actually committed, the target's counter-
   intelligence rating — never a die roll a player was asleep for.

   PROGRESSION IS THE WHOLE DESIGN. A freshly chartered service can only collect:
   recruit a human source, run them, sweep for foreign agents working against the
   Republic. Nothing here writes a foreign power's state. Tier 2 (influence) opens
   once the agency has actually done that collection work — tradecraft earned,
   budget actually spent, missions actually completed, not a hidden switch. Tier 3
   (coup, removal) needs an order of magnitude more of the same, PLUS an asset
   already in place at the target: the game cannot go from zero to regime change
   in one order. All three thresholds, and the agency's progress against them, are
   in GET /api/intel/agency — public, so the gate is something the House watches
   fill in rather than a number kept behind the console.

   Every mission-kind that can touch a foreign power's state is enumerated in OPS
   below and nothing else reaches intelOperation()'s switch — the same allowlist
   discipline runGovernmentTurn holds foreign cabinets to in diplomacy.js. And
   every mission writes an intel_operations row whatever became of it: a blown
   asset and a failed sweep are on the record exactly like a clean one, because
   "nothing here happened" is not how this codebase treats consequential action. */

module.exports.mount = function mount(app, ctx) {
  const { q, tx, log, auth, admin, wrap, canPropose, cycleNow, num, loadConfig, officesOf, holds, seatClash } = ctx;

  const cycleNo = () => cycleNow()?.number || 0;
  const clean = (s, n = 2000) => String(s ?? '').trim().slice(0, n);
  const money = n => Math.max(0, Math.round(Number(n) || 0));

  const E = () => ctx.economy;
  /* diplomacy.js sets ctx.intel at mount time and this file extends the same
     object rather than replacing it — isCleared/intelService/declassifyDue stay
     exactly as diplomacy.js and offshore.js already rely on them. */
  const I = () => ctx.intel;


  /* --------------------------------------------------------- leadership

     The Director is intentionally modelled on the head of the Fed: nomination
     does nothing by itself, the House supplies the appointment, and after that
     the nominating officer has no dismissal power. Clearance remains a row in
     intel_clearance; confirmation creates an office-derived row so the Director
     can actually do the job without making the office itself a secret-access
     bypass. */
  const pmNow = async () =>
    (await q(`SELECT u.id, u.display_name FROM offices o JOIN users u ON u.id=o.user_id
               WHERE o.office='prime_minister' AND o.active LIMIT 1`)).rows[0] || null;
  const houseSize = async () =>
    Number((await q("SELECT count(*)::int n FROM offices WHERE active AND office='mp'")).rows[0].n) || 0;

  async function directorAppointer() {
    return (await pmNow()) ? 'prime_minister' : 'president';
  }

  async function directorRemoved(userId) {
    await q("DELETE FROM intel_clearance WHERE user_id=$1 AND source='director'", [userId]);
  }

  async function retireExpiredDirector() {
    const row = (await q(`
      SELECT u.id, u.display_name, o.since, n.term_ends
        FROM offices o JOIN users u ON u.id=o.user_id
        LEFT JOIN LATERAL (
          SELECT term_ends FROM intel_director_nominations
           WHERE user_id=u.id AND status='confirmed' ORDER BY id DESC LIMIT 1
        ) n ON TRUE
       WHERE o.office='intel_director' AND o.active LIMIT 1`)).rows[0] || null;

    /* Impeachment is generic in server.js. If it removed the office between
       intelligence requests, remove only the clearance that came from the
       office; a separately granted RO clearance survives. */
    if (!row) {
      await q(`DELETE FROM intel_clearance c WHERE c.source='director'
                AND NOT EXISTS (SELECT 1 FROM offices o WHERE o.user_id=c.user_id
                                AND o.office='intel_director' AND o.active)`);
      return null;
    }
    if (row.term_ends && new Date(row.term_ends).getTime() <= Date.now()) {
      await q("UPDATE offices SET active=FALSE, until=now() WHERE user_id=$1 AND office='intel_director' AND active", [row.id]);
      await directorRemoved(row.id);
      log(null, 'intel.director.term', `${row.display_name}, term served`);
      return null;
    }

    /* A Director necessarily has clearance, but it is still represented by a
       row. ON CONFLICT preserves an independently granted manual clearance. */
    await q(`INSERT INTO intel_clearance(user_id,granted_by,reason,until,source)
             VALUES($1,NULL,'Director of Intelligence — office clearance',$2,'director')
             ON CONFLICT (user_id) DO NOTHING`, [row.id, row.term_ends || null]);
    return row;
  }

  const directorNow = retireExpiredDirector;

  async function requireDirector(req, res) {
    const d = await directorNow();
    if (d && d.id === req.user.id) return true;
    res.status(403).json({
      error: 'Only the confirmed Director of Intelligence may manage the Service. No officer may instruct it as to its findings.'
    });
    return false;
  }

  /* Every table here hangs off `powers`, which only exists if diplomacy's schema
     ran. Asked at request time, not mount time, and cached: a table that exists
     does not stop existing. Same pattern offshore.js uses for the same reason. */
  const known = new Map();
  async function hasTable(name) {
    if (known.get(name)) return true;
    const there = !!(await q('SELECT to_regclass($1) AS t', ['public.' + name])).rows[0].t;
    if (there) known.set(name, true);
    return there;
  }

  /* Express middleware here is sync-only throughout this codebase (auth reads a
     flag another middleware already set); an async check that threw would be an
     unhandled rejection rather than a JSON error. So these are plain functions
     called at the top of a wrap()'d handler, the same way offshore.js's
     enabled() is — wrap() is what actually catches the rejection. */
  async function needIntel(res) {
    if (!I()?.intelService) { res.status(503).json({ error: 'The intelligence service is not running.' }); return null; }
    if (!(await hasTable('powers'))) {
      res.status(503).json({ error: 'The Republic has no foreign relations, so there is nothing to run an operation against.' });
      return null;
    }
    const svc = await I().intelService();
    if (!svc) { res.status(400).json({ error: 'The Republic has no intelligence service. The House charters one by bill.' }); return null; }
    return svc;
  }

  async function requireCleared(req, res) {
    if (!(await I().isCleared(req.user.id))) {
      res.status(403).json({ error: 'Clearance is a row in the register, not an office. You do not hold one.' });
      return false;
    }
    return true;
  }

  const powerRow = async id =>
    (await q('SELECT * FROM powers WHERE id=$1 AND revoked_at IS NULL', [Number(id) || 0])).rows[0] || null;

  async function powerAccount(powerId, run = q) {
    const found = (await run("SELECT * FROM accounts WHERE owner_kind='power' AND owner_id=$1", [powerId])).rows[0];
    if (found) return found;
    return (await run("INSERT INTO accounts(owner_kind,owner_id) VALUES('power',$1) RETURNING *", [powerId])).rows[0];
  }

  async function agencyAccount() {
    return E() ? E().accountFor('intel_ops', null) : null;
  }

  async function agencyFinance(svc) {
    if (!svc || !E()) return {
      operating_balance: 0,
      recurring_budget: Number(svc?.budget_per_cycle || 0),
      payroll_per_cycle: 0,
      active_agents: 0,
      funding_requests: []
    };
    const acc = await agencyAccount();
    const payroll = (await q(`SELECT COALESCE(sum(salary_per_cycle),0)::bigint total, count(*)::int n
                                FROM intel_service_agents WHERE active`)).rows[0];
    const requests = (await q(`
      SELECT r.*, b.ref, b.title, b.status
        FROM intel_funding_requests r JOIN bills b ON b.id=r.bill_id
       ORDER BY r.created_at DESC LIMIT 12`)).rows;
    return {
      operating_balance: Number(acc?.balance || 0),
      recurring_budget: Number(svc.budget_per_cycle || 0),
      payroll_per_cycle: Number(payroll?.total || 0),
      active_agents: Number(payroll?.n || 0),
      funding_requests: requests
    };
  }

  /* ---------------------------------------------------------- progression

     Tier 1 opens with the charter. Tier 2 needs tradecraft, spend and completed
     tier-1 missions all past their marks — any one alone is a service that talks
     a good game, spends freely, or got lucky once, and none of those are ready
     for influence work. Tier 3 repeats the same three-part test one order of
     magnitude up, against tier-2 missions rather than tier-1. Nothing here is
     random and nothing is set by hand: every number is a count or a sum over
     intel_operations, which is public. */
  const TIER_GATE = {
    1: { tradecraft: 0, budget: 0, completed: 0, name: 'Collection' },
    2: { tradecraft: 30, budget: 20000, completed: 2, name: 'Influence' },
    3: { tradecraft: 100, budget: 150000, completed: 3, name: 'Escalation' }
  };

  /* What a mission costs to attempt, what it earns the agency if it works, and
     how much harder the target's own counter-intelligence makes it than the
     published rating in powers.counter_intel. costUnit is the budget it takes to
     add one point to the mission's score — spend more, shorten the odds; there
     is no ceiling, only diminishing published headroom against the target. */
  const OPS = {
    // ---- tier 1: collection. touches no foreign power's state.
    recruit_asset: { tier: 1, reward: 5, costUnit: 200, difficulty: 0, needsPower: true },
    run_collection: { tier: 1, reward: 3, costUnit: 150, difficulty: 0, needsPower: true, needsAsset: true },
    counter_sweep: { tier: 1, reward: 2, costUnit: 100, difficulty: -10, needsPower: false },
    // ---- tier 2: influence. writes a foreign power's published state.
    disinformation: { tier: 2, reward: 8, costUnit: 300, difficulty: 20, needsPower: true },
    sabotage_trade: { tier: 2, reward: 8, costUnit: 300, difficulty: 20, needsPower: true },
    recruit_mole: { tier: 2, reward: 12, costUnit: 400, difficulty: 25, needsPower: true },
    // ---- tier 3: escalation. severe, rare, guaranteed public blowback on success.
    back_coup: { tier: 3, reward: 0, costUnit: 2000, difficulty: 60, needsPower: true, needsAsset: true },
    removal: { tier: 3, reward: 0, costUnit: 5000, difficulty: 70, needsPower: true, needsAsset: true }
  };

  async function successfulCount(tier) {
    return Number(
      (await q("SELECT count(*)::int n FROM intel_operations WHERE tier=$1 AND outcome='success'", [tier])).rows[0].n
    );
  }

  async function agencyProgress(svc) {
    const succ1 = await successfulCount(1);
    const succ2 = await successfulCount(2);
    const meets = g => svc.tradecraft >= g.tradecraft && Number(svc.committed_budget) >= g.budget;
    let tier = 1;
    if (meets(TIER_GATE[2]) && succ1 >= TIER_GATE[2].completed) {
      tier = 2;
      if (meets(TIER_GATE[3]) && succ2 >= TIER_GATE[3].completed) tier = 3;
    }
    return {
      tier,
      tradecraft: svc.tradecraft,
      committed_budget: Number(svc.committed_budget),
      successful_tier1: succ1,
      successful_tier2: succ2,
      gates: TIER_GATE
    };
  }

  app.get(
    '/api/intel/agency',
    wrap(async (req, res) => {
      const svc = I()?.intelService ? await I().intelService() : null;
      const director = await directorNow();
      const nomination = (await q(`
        SELECT n.*, u.display_name, p.display_name AS nominated_by_name,
               (SELECT count(*)::int FROM intel_director_confirmations c WHERE c.nomination_id=n.id) AS confirmations
          FROM intel_director_nominations n
          LEFT JOIN users u ON u.id=n.user_id
          LEFT JOIN users p ON p.id=n.nominated_by
         WHERE n.status='open' ORDER BY n.id DESC LIMIT 1`)).rows[0] || null;
      const house = await houseSize();
      const appointer = await directorAppointer();
      let iConfirmed = false;
      if (req.user && nomination)
        iConfirmed = !!(await q('SELECT 1 FROM intel_director_confirmations WHERE nomination_id=$1 AND user_id=$2',
          [nomination.id, req.user.id])).rows[0];
      const leadership = {
        director,
        director_term_ends: director?.term_ends || null,
        director_terms: Math.max(1, num('intel_director_terms') || 4),
        nomination,
        house,
        needed: Math.max(1, Math.floor(house / 2) + 1),
        i_confirmed: iConfirmed,
        i_am_director: !!(req.user && director && director.id === req.user.id),
        appointer,
        can_nominate: !!(req.user && await holds(req.user.id, appointer))
      };
      if (!svc) return res.json({ service: null, tier: 0, gates: TIER_GATE, ops: OPS, ...leadership });
      res.json({ service: svc, progress: await agencyProgress(svc), finance: await agencyFinance(svc), ops: OPS, ...leadership });
    })
  );

  app.post(
    '/api/intel/director/nominate',
    auth,
    wrap(async (req, res) => {
      if (!(await needIntel(res))) return;
      const appointer = await directorAppointer();
      if (!(await holds(req.user.id, appointer)))
        return res.status(403).json({
          error: appointer === 'prime_minister'
            ? 'The Prime Minister nominates the Director of Intelligence.'
            : 'There is no Prime Minister, so the President nominates the Director of Intelligence.'
        });
      if (await directorNow())
        return res.status(400).json({ error: 'The Service already has a Director. The nominating officer may not dismiss them.' });
      const target = (await q('SELECT id, display_name FROM users WHERE id=$1 AND is_active AND approved',
        [Number(req.body?.user_id) || 0])).rows[0];
      if (!target) return res.status(400).json({ error: 'Name a citizen to nominate.' });
      if (target.id === req.user.id) return res.status(400).json({ error: 'The nominating officer may not nominate themselves.' });
      await q("UPDATE intel_director_nominations SET status='withdrawn', settled_at=now() WHERE status='open'");
      const row = (await q(
        'INSERT INTO intel_director_nominations(user_id,nominated_by) VALUES($1,$2) RETURNING *',
        [target.id, req.user.id]
      )).rows[0];
      log(req.user.id, 'intel.director.nominate', target.display_name);
      res.json(row);
    })
  );

  app.post(
    '/api/intel/director/confirm',
    auth,
    wrap(async (req, res) => {
      if (!(await needIntel(res))) return;
      await loadConfig();
      const nom = (await q("SELECT * FROM intel_director_nominations WHERE status='open' ORDER BY id DESC LIMIT 1")).rows[0];
      if (!nom) return res.status(400).json({ error: 'No Director nomination is before the House.' });
      if (!(await officesOf(req.user.id)).includes('mp'))
        return res.status(403).json({ error: 'The House confirms the Director of Intelligence.' });

      if (req.body?.support === false) {
        await q('DELETE FROM intel_director_confirmations WHERE nomination_id=$1 AND user_id=$2', [nom.id, req.user.id]);
        return res.json({ confirmed: false, withdrew: true });
      }
      await q('INSERT INTO intel_director_confirmations(nomination_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [nom.id, req.user.id]);
      const votes = Number((await q('SELECT count(*)::int n FROM intel_director_confirmations WHERE nomination_id=$1', [nom.id])).rows[0].n) || 0;
      const house = await houseSize();
      const needed = Math.max(1, Math.floor(house / 2) + 1);
      if (votes < needed) return res.json({ confirmed: false, votes, needed, house });

      const held = seatClash(await officesOf(nom.user_id), 'intel_director');
      if (held.length)
        return res.status(400).json({ error: `They hold an incompatible office as ${held.join(', ')}. The Director may also hold Foreign Affairs, Defence and/or a House seat, but not an exclusive or economic portfolio.` });

      const terms = Math.max(1, num('intel_director_terms') || 4);
      const ends = new Date(Date.now() + terms * Math.max(1, num('cycle_days') || 7) * 86400000);
      await q("INSERT INTO offices(office,user_id) VALUES('intel_director',$1)", [nom.user_id]);
      await q("UPDATE intel_director_nominations SET status='confirmed', settled_at=now(), term_ends=$2 WHERE id=$1", [nom.id, ends]);
      await q(`INSERT INTO intel_clearance(user_id,granted_by,reason,until,source)
               VALUES($1,NULL,'Director of Intelligence — office clearance',$2,'director')
               ON CONFLICT (user_id) DO NOTHING`, [nom.user_id, ends]);
      const who = (await q('SELECT display_name FROM users WHERE id=$1', [nom.user_id])).rows[0];
      log(req.user.id, 'intel.director.confirm', `${who?.display_name} confirmed, ${votes} of ${house}, until ${ends.toISOString().slice(0, 10)}`);
      res.json({ confirmed: true, votes, needed, house, term_ends: ends });
    })
  );

  app.post(
    '/api/intel/director/refuse',
    auth,
    wrap(async (req, res) => {
      if (!(await needIntel(res))) return;
      const nom = (await q("SELECT * FROM intel_director_nominations WHERE status='open' ORDER BY id DESC LIMIT 1")).rows[0];
      if (!nom) return res.status(400).json({ error: 'No Director nomination is before the House.' });
      if (!(await officesOf(req.user.id)).includes('speaker'))
        return res.status(403).json({ error: "Only the Speaker may declare the House's refusal." });
      await q("UPDATE intel_director_nominations SET status='refused', settled_at=now() WHERE id=$1", [nom.id]);
      log(req.user.id, 'intel.director.refuse', `nomination ${nom.id} refused`);
      res.json({ ok: true });
    })
  );

  app.post(
    '/api/intel/director/resign',
    auth,
    wrap(async (req, res) => {
      const director = await directorNow();
      if (!director) return res.status(400).json({ error: 'The Service has no Director.' });
      if (director.id !== req.user.id)
        return res.status(403).json({ error: 'Only the Director may resign. The Prime Minister, President and Returning Officer may not dismiss them; the House may remove them only by impeachment.' });
      await q("UPDATE offices SET active=FALSE, until=now() WHERE user_id=$1 AND office='intel_director' AND active", [director.id]);
      await directorRemoved(director.id);
      log(req.user.id, 'intel.director.resign', director.display_name);
      res.json({ ok: true });
    })
  );

  /* ------------------------------------------------------------- charter

     The service does not exist until the House votes one into being — that rule
     is diplomacy.js's, and this is only where it gets a way to actually happen.
     A motion, not a law: the same shape offshore.js already uses for an inquiry
     or a seizure, because the House is instructing something into existence
     once, not writing a statute. */
  const nextBillRef = async () =>
    'B' + String((await q('SELECT count(*)::int n FROM bills')).rows[0].n + 1).padStart(3, '0');

  app.post(
    '/api/intel/establish',
    auth,
    wrap(async (req, res) => {
      if (!(await hasTable('bills'))) return res.status(503).json({ error: 'No bill system to charter through.' });
      if (!(await canPropose(req.user.id)))
        return res.status(403).json({ error: 'Only the House may charter an intelligence service.' });
      const existing = I()?.intelService ? await I().intelService() : null;
      if (existing) return res.status(409).json({ error: 'The Republic already has an intelligence service.' });
      const charter = clean(req.body?.charter, 4000);
      if (charter.length < 20) return res.status(400).json({ error: 'A charter needs an actual charter, not a title.' });
      const declassifyAfter = Math.max(1, Math.round(Number(req.body?.declassify_after_cycles) || 3));
      const budgetPerCycle = money(req.body?.budget_per_cycle);
      const ref = await nextBillRef();
      const bill = (
        await q(
          "INSERT INTO bills(ref,title,kind,body,author_id) VALUES($1,$2,'motion',$3,$4) RETURNING *",
          [ref, clean(req.body?.title, 200) || 'Establishment of an Intelligence Service', charter, req.user.id]
        )
      ).rows[0];
      await q(
        'INSERT INTO intel_charters(bill_id,charter,declassify_after_cycles,budget_per_cycle) VALUES($1,$2,$3,$4)',
        [bill.id, charter, declassifyAfter, budgetPerCycle]
      );
      log(req.user.id, 'intel.establish.propose', bill.ref);
      res.json(bill);
    })
  );

  ctx.addEnactHook(async bill => {
    const charter = (await q('SELECT * FROM intel_charters WHERE bill_id=$1', [bill.id])).rows[0];
    if (charter) {
      await q(
        `INSERT INTO intel_service(id, established_bill_id, charter, declassify_after_cycles, budget_per_cycle, established_cycle)
         VALUES (1,$1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET established_bill_id=$1, charter=$2, declassify_after_cycles=$3,
           budget_per_cycle=$4, established_cycle=$5, abolished_at=NULL`,
        [bill.id, charter.charter, charter.declassify_after_cycles, charter.budget_per_cycle, cycleNo()]
      );
      log(null, 'intel.establish', bill.ref);
    }

    const funding = (await q('SELECT * FROM intel_funding_requests WHERE bill_id=$1 AND enacted_at IS NULL', [bill.id])).rows[0];
    if (!funding) return;
    if (funding.request_kind === 'recurring') {
      await q('UPDATE intel_service SET budget_per_cycle = budget_per_cycle + $1 WHERE id=1', [funding.amount]);
      log(null, 'intel.funding.recurring', `${bill.ref}: +${funding.amount} per cycle`);
    } else if (E()) {
      const treasury = await E().treasury();
      const ops = await agencyAccount();
      await E().settle(treasury.id, ops.id, Number(funding.amount), 'intel.appropriation', `${bill.ref}: ${funding.purpose}`);
      log(null, 'intel.funding.supplemental', `${bill.ref}: ${funding.amount}`);
    }
    await q('UPDATE intel_funding_requests SET enacted_at=now() WHERE bill_id=$1', [bill.id]);
  });

  app.post(
    '/api/intel/funding-request',
    auth,
    wrap(async (req, res) => {
      if (!(await needIntel(res))) return;
      if (!(await requireDirector(req, res))) return;
      const requestKind = req.body?.request_kind === 'recurring' ? 'recurring' : 'supplemental';
      if (requestKind === 'recurring' && ctx.budget)
        return res.status(400).json({ error: 'Recurring Intelligence appropriations are set in the Presidential Budget. Ask the House for a current-cycle supplemental instead.' });
      const amount = money(req.body?.amount);
      const purpose = clean(req.body?.purpose, 1200);
      if (amount <= 0) return res.status(400).json({ error: 'Ask the House for an amount above zero.' });
      if (purpose.length < 10) return res.status(400).json({ error: 'Tell the House what the money is for.' });
      const ref = await nextBillRef();
      const title = requestKind === 'recurring'
        ? `Intelligence Service recurring budget increase — ${amount}`
        : `Intelligence Service supplemental appropriation — ${amount}`;
      const body = requestKind === 'recurring'
        ? `The Director of Intelligence requests that the Service recurring budget be increased by ${amount} per cycle.

Purpose: ${purpose}`
        : `The Director of Intelligence requests a one-off supplemental appropriation of ${amount}.

Purpose: ${purpose}`;
      const bill = (await q(
        "INSERT INTO bills(ref,title,kind,body,author_id) VALUES($1,$2,'motion',$3,$4) RETURNING *",
        [ref, title, body, req.user.id]
      )).rows[0];
      await q(`INSERT INTO intel_funding_requests(bill_id,request_kind,amount,purpose,requested_by)
               VALUES($1,$2,$3,$4,$5)`, [bill.id, requestKind, amount, purpose, req.user.id]);
      log(req.user.id, 'intel.funding.request', `${bill.ref}: ${requestKind} ${amount}`);
      res.json(bill);
    })
  );

  /* --------------------------------------------------------- clearance

     Clearance remains a row, never an office. The Director controls ordinary
     Service staffing, while the Returning Officer retains an explicit security
     override to grant or revoke access. That override does not let the RO order
     missions, assign agents, extract assets or instruct findings. */
  async function clearanceAuthority(req) {
    const director = await directorNow();
    if (director && director.id === req.user.id) return { source: 'service', director };
    if (req.user?.is_admin) return { source: 'ro', director };
    return null;
  }

  app.post(
    '/api/intel/clearance',
    auth,
    wrap(async (req, res) => {
      if (!(await needIntel(res))) return;
      const authority = await clearanceAuthority(req);
      if (!authority)
        return res.status(403).json({ error: 'Only the Director of Intelligence or the Returning Officer may grant clearance.' });
      const target = (await q('SELECT id, display_name FROM users WHERE id=$1 AND is_active AND approved', [Number(req.body?.user_id) || 0])).rows[0];
      if (!target) return res.status(400).json({ error: 'No such active citizen.' });
      if (target.id === authority.director?.id)
        return res.status(400).json({ error: 'The Director already has office-derived clearance.' });
      const by = authority.source === 'ro' ? 'Returning Officer' : 'Director of Intelligence';
      const reason = clean(req.body?.reason, 500) || `cleared by the ${by}`;
      await q(
        `INSERT INTO intel_clearance(user_id,granted_by,reason,until,source) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT (user_id) DO UPDATE SET granted_by=$2, reason=$3, until=$4, source=$5, since=now()`,
        [target.id, req.user.id, reason, req.body?.until || null, authority.source]
      );
      log(req.user.id, 'intel.clearance.grant', `${target.display_name} (${authority.source})`);
      res.json({ ok: true, source: authority.source });
    })
  );

  app.delete(
    '/api/intel/clearance/:userId',
    auth,
    wrap(async (req, res) => {
      if (!(await needIntel(res))) return;
      const authority = await clearanceAuthority(req);
      if (!authority)
        return res.status(403).json({ error: 'Only the Director of Intelligence or the Returning Officer may revoke clearance.' });
      const userId = Number(req.params.userId) || 0;
      if (userId === authority.director?.id)
        return res.status(409).json({ error: "The Director's clearance belongs to the office and ends only when the office does." });
      const gone = (await q(
        "DELETE FROM intel_clearance WHERE user_id=$1 AND source <> 'director' RETURNING user_id",
        [userId]
      )).rows[0];
      if (!gone) return res.status(404).json({ error: 'That citizen has no revocable Service clearance.' });
      await q('UPDATE intel_service_agents SET active=FALSE, retired_at=now() WHERE user_id=$1 AND active', [userId]);
      log(req.user.id, 'intel.clearance.revoke', `${userId} (${authority.source})`);
      res.json({ ok: true });
    })
  );

  /* A published defensive assessment. The Director owns the Service's ordinary
     record; the RO retains the simulation/security override that existed before
     the Director office. Everyone can read the number before an operation. */
  app.put(
    '/api/intel/powers/:id/counter-intel',
    auth,
    wrap(async (req, res) => {
      const d = await directorNow();
      if (!req.user?.is_admin && d?.id !== req.user.id)
        return res.status(403).json({ error: 'Only the Director of Intelligence or the Returning Officer may record that assessment.' });
      const p = await powerRow(req.params.id);
      if (!p) return res.status(404).json({ error: 'No such power.' });
      const v = Math.max(0, Math.min(500, Math.round(Number(req.body?.counter_intel))));
      if (!Number.isFinite(v)) return res.status(400).json({ error: 'counter_intel must be a number.' });
      await q('UPDATE powers SET counter_intel=$1 WHERE id=$2', [v, p.id]);
      log(req.user.id, 'intel.power.counter_intel', `${p.name}: ${v}`);
      res.json({ ok: true, power_id: p.id, counter_intel: v });
    })
  );

  /* ----------------------------------------------------------- assets */

  app.get(
    '/api/intel/assets',
    auth,
    wrap(async (req, res) => {
      if (!(await needIntel(res))) return;
      if (!(await requireCleared(req, res))) return;
      const rows = (
        await q(`
        SELECT a.*, p.name AS power_name FROM intel_assets a
          JOIN powers p ON p.id=a.power_id ORDER BY a.id DESC LIMIT 100`)
      ).rows;
      res.json(rows);
    })
  );

  /* Reversible, on purpose: pulling an asset out is not a mission against a
     foreign power's state, it is the Republic managing its own network, so it
     costs nothing to run through the allowlist and needs no tier. */
  app.post(
    '/api/intel/assets/:id/extract',
    auth,
    wrap(async (req, res) => {
      if (!(await needIntel(res))) return;
      if (!(await requireDirector(req, res))) return;
      const a = (await q('SELECT * FROM intel_assets WHERE id=$1', [Number(req.params.id) || 0])).rows[0];
      if (!a) return res.status(404).json({ error: 'No such asset.' });
      if (a.status !== 'active') return res.status(409).json({ error: `That asset is already ${a.status}.` });
      await q("UPDATE intel_assets SET status='extracted', resolved_at=now() WHERE id=$1", [a.id]);
      log(req.user.id, 'intel.asset.extract', a.codename);
      res.json({ ok: true });
    })
  );

  /* ----------------------------------------------------- player agents

     Clearance is necessary but not sufficient for operational work. The
     Director keeps a separate roster with a role and a default fee paid every
     time that citizen is assigned to an operation. The RO can grant clearance,
     but cannot silently enlist someone or set their pay. */
  app.get(
    '/api/intel/agents',
    auth,
    wrap(async (req, res) => {
      if (!(await needIntel(res))) return;
      if (!(await requireCleared(req, res))) return;
      const director = await directorNow();
      const all = !!(director && director.id === req.user.id);
      const rows = (await q(`
        SELECT a.*, u.display_name, c.until AS clearance_until, c.source AS clearance_source,
               (c.user_id IS NOT NULL AND (c.until IS NULL OR c.until > now())) AS cleared,
               (SELECT count(*)::int FROM intel_operation_agents ia WHERE ia.user_id=a.user_id) AS missions
          FROM intel_service_agents a
          JOIN users u ON u.id=a.user_id
          LEFT JOIN intel_clearance c ON c.user_id=a.user_id
         WHERE ($1::boolean OR a.user_id=$2)
         ORDER BY a.active DESC, u.display_name`, [all, req.user.id])).rows;
      res.json(rows);
    })
  );

  app.post(
    '/api/intel/agents',
    auth,
    wrap(async (req, res) => {
      if (!(await needIntel(res))) return;
      if (!(await requireDirector(req, res))) return;
      const userId = Number(req.body?.user_id) || 0;
      const target = (await q(`SELECT id, display_name FROM users
                               WHERE id=$1 AND is_active AND approved`, [userId])).rows[0];
      if (!target) return res.status(400).json({ error: 'No such active citizen.' });
      const director = await directorNow();
      if (userId === director?.id) return res.status(400).json({ error: 'The Director manages the Service and is not enlisted as a field agent.' });
      const role = clean(req.body?.role, 80) || 'field agent';
      const salaryPerCycle = money(req.body?.salary_per_cycle);
      const operationPay = money(req.body?.operation_pay);
      const notes = clean(req.body?.notes, 600);
      /* Enlistment itself carries the minimum clearance needed to serve. It is
         tagged separately so retirement can remove only this automatic grant and
         preserve any independent Director/RO clearance the citizen already held. */
      await q(`INSERT INTO intel_clearance(user_id,granted_by,reason,until,source)
               VALUES($1,$2,'Active Intelligence Service agent',NULL,'agent')
               ON CONFLICT (user_id) DO NOTHING`, [userId, req.user.id]);
      const row = (await q(`
        INSERT INTO intel_service_agents(user_id,enlisted_by,role,salary_per_cycle,operation_pay,notes,active,retired_at)
        VALUES($1,$2,$3,$4,$5,$6,TRUE,NULL)
        ON CONFLICT (user_id) DO UPDATE SET enlisted_by=$2, role=$3, salary_per_cycle=$4, operation_pay=$5,
          notes=$6, active=TRUE, retired_at=NULL
        RETURNING *`, [userId, req.user.id, role, salaryPerCycle, operationPay, notes])).rows[0];
      log(req.user.id, 'intel.agent.enlist', `${target.display_name}: ${role}, ${salaryPerCycle}/cycle + ${operationPay}/operation`);
      res.json(row);
    })
  );

  app.delete(
    '/api/intel/agents/:userId',
    auth,
    wrap(async (req, res) => {
      if (!(await needIntel(res))) return;
      if (!(await requireDirector(req, res))) return;
      const userId = Number(req.params.userId) || 0;
      const row = (await q(`UPDATE intel_service_agents SET active=FALSE, retired_at=now()
                             WHERE user_id=$1 AND active RETURNING user_id, role`, [userId])).rows[0];
      if (!row) return res.status(404).json({ error: 'That citizen is not an active Service agent.' });
      await q("DELETE FROM intel_clearance WHERE user_id=$1 AND source='agent'", [userId]);
      log(req.user.id, 'intel.agent.retire', `${userId}: ${row.role}`);
      res.json({ ok: true });
    })
  );

  /* Cleared citizens assigned by the Director to operations. Assignment
     identities and individual pay are not part of the public register: the
     Director sees the whole staffing record, while each agent sees their own. */
  app.get(
    '/api/intel/assignments',
    auth,
    wrap(async (req, res) => {
      if (!(await needIntel(res))) return;
      if (!(await requireCleared(req, res))) return;
      const director = await directorNow();
      const all = !!(director && director.id === req.user.id);
      const rows = (await q(`
        SELECT ia.operation_id, ia.user_id, ia.role, ia.pay, ia.assigned_at,
               u.display_name, o.kind, o.outcome, o.cycle_no, o.created_at,
               p.name AS power_name
          FROM intel_operation_agents ia
          JOIN users u ON u.id=ia.user_id
          JOIN intel_operations o ON o.id=ia.operation_id
          LEFT JOIN powers p ON p.id=o.power_id
         WHERE ($1::boolean OR ia.user_id=$2)
         ORDER BY o.id DESC, u.display_name
         LIMIT 200`, [all, req.user.id])).rows;
      res.json(rows);
    })
  );

  /* ------------------------------------------------------- operations */

  app.get(
    '/api/intel/operations',
    wrap(async (_req, res) => {
      const rows = (
        await q(`
        SELECT o.*, p.name AS power_name, u.display_name AS ordered_by_name, a.codename
          FROM intel_operations o
          LEFT JOIN powers p ON p.id=o.power_id
          LEFT JOIN users u ON u.id=o.ordered_by
          LEFT JOIN intel_assets a ON a.id=o.asset_id
         ORDER BY o.id DESC LIMIT 100`)
      ).rows;
      res.json(rows);
    })
  );

  const nextReportRef = async () =>
    'IR' + String((await q('SELECT count(*)::int n FROM intel_reports')).rows[0].n + 1).padStart(3, '0');

  /* One sealed report per operation, filed the same way diplomacy.js's own
     /api/intel/reports/:id/read expects: subject and metadata public straight
     away, body withheld until declassify_after_cycles has passed. Operations
     write into the same table their reader never had a way to write to. */
  async function fileReport(run, svc, subject, body, confidence, sourcing, actorId) {
    const cycle = cycleNo();
    const ref = await nextReportRef();
    const row = (
      await run(
        `INSERT INTO intel_reports(ref,power_id,subject,body,confidence,sourcing,filed_by,filed_cycle,declassifies_at_cycle)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [ref, subject.power_id, subject.line, body, confidence, sourcing, actorId, cycle, cycle + Number(svc.declassify_after_cycles || 0)]
      )
    ).rows[0];
    return row;
  }

  const activeEffectPenalty = async powerId => {
    const cycle = cycleNo();
    const { rows } = await q(
      "SELECT COALESCE(SUM(magnitude),0) AS n FROM intel_effects WHERE power_id=$1 AND kind='counter_intel_penalty' AND (expires_cycle IS NULL OR expires_cycle > $2)",
      [powerId, cycle]
    );
    return Number(rows[0].n) || 0;
  };

  /* THE allowlist. Every operation this file can produce passes through this one
     switch, on a kind checked against OPS before anything else runs. A mission
     kind that is not in OPS never reaches a query that could touch a foreign
     power's row — the same discipline runGovernmentTurn holds a foreign cabinet
     to in diplomacy.js, just enforced on the Republic's own side of the wire. */
  app.post(
    '/api/intel/operations',
    auth,
    wrap(async (req, res) => {
      const svc = await needIntel(res);
      if (!svc) return;
      if (!(await requireDirector(req, res))) return;
      const kind = String(req.body?.kind || '');
      const op = OPS[kind];
      if (!op) return res.status(400).json({ error: 'That is not an operation the service knows how to run.' });

      const progress = await agencyProgress(svc);
      if (op.tier > progress.tier)
        return res.status(403).json({
          error: `That is a tier ${op.tier} operation (${TIER_GATE[op.tier].name}). The agency has only reached tier ${progress.tier}.`,
          progress
        });

      let power = null;
      if (op.needsPower) {
        power = await powerRow(req.body?.power_id);
        if (!power) return res.status(400).json({ error: 'Name the foreign power this operation targets.' });
      }

      const budget = money(req.body?.budget);
      if (budget <= 0) return res.status(400).json({ error: 'An operation needs a budget above zero.' });

      const requestedAgentIds = [...new Set((Array.isArray(req.body?.agent_ids) ? req.body.agent_ids : [])
        .map(Number).filter(n => Number.isInteger(n) && n > 0))];
      let assignedAgents = [];
      if (requestedAgentIds.length) {
        assignedAgents = (await q(`
          SELECT a.user_id, a.role, a.operation_pay, u.display_name
            FROM intel_service_agents a
            JOIN intel_clearance c ON c.user_id=a.user_id
            JOIN users u ON u.id=a.user_id
           WHERE a.user_id = ANY($1::int[])
             AND a.active
             AND (c.until IS NULL OR c.until > now())
             AND u.is_active AND u.approved
           ORDER BY u.display_name`, [requestedAgentIds])).rows;
        if (assignedAgents.length !== requestedAgentIds.length)
          return res.status(409).json({ error: "Every assigned agent must be active on the Director's roster and hold current Service clearance." });
      }
      const agentPayTotal = assignedAgents.reduce((n, a) => n + money(a.operation_pay), 0);
      const agentAccounts = new Map();
      const opsAcc = E() ? await agencyAccount() : null;
      if (E()) for (const agent of assignedAgents)
        agentAccounts.set(agent.user_id, await E().accountFor('citizen', agent.user_id));
      if (opsAcc && Number(opsAcc.balance) < budget + agentPayTotal)
        return res.status(409).json({ error: `The Service needs ${budget + agentPayTotal} for this operation and holds ${Number(opsAcc.balance)}. Request more funds from the House or reduce the commitment.` });

      /* An asset in place, not conjured by the order itself. run_collection needs
         one to run; back_coup and removal need one whether or not the payload
         names it, because a coup that materialises from nothing but budget is
         exactly the arcade-game outcome the tier system exists to prevent. */
      let asset = null;
      if (op.needsAsset) {
        asset = req.body?.asset_id
          ? (await q('SELECT * FROM intel_assets WHERE id=$1 AND power_id=$2', [Number(req.body.asset_id) || 0, power.id])).rows[0]
          : (await q("SELECT * FROM intel_assets WHERE power_id=$1 AND status='active' ORDER BY id LIMIT 1", [power.id])).rows[0];
        if (!asset || asset.status !== 'active')
          return res.status(409).json({ error: 'No asset is in place at that power. Recruit one first.' });
      }

      const penalty = power ? await activeEffectPenalty(power.id) : 0;
      const threshold = op.difficulty + (power ? Number(power.counter_intel) - penalty : 0);
      const score = svc.tradecraft + (asset ? asset.experience * 2 : 0) + Math.floor(budget / op.costUnit);
      const success = score >= threshold;

      const outcome = success ? 'success' : (op.needsAsset || kind === 'run_collection') ? 'blown' : 'failed';
      let opRow, reportRow = null;

      await tx(async run => {
        /* The budget is spent whether or not the mission works — that is what
           "committed" means, and it is why committed_budget only ever rises.
           Money still has to land somewhere real: a foreign-facing mission pays
           into the target power's own account (a bribe, a network's upkeep,
           exactly how tribute and procurement already move money abroad), same
           as the old tribute bug this codebase specifically remembers fixing. */
        if (E()) {
          const toAcc = power ? await powerAccount(power.id, run) : await E().accountFor('intel_spend', null);
          await E().pay(opsAcc.id, toAcc.id, budget, `intel.${kind}`, `${op0(kind)} — ${power?.name || 'domestic'}`, run);
          for (const agent of assignedAgents) {
            const fee = money(agent.operation_pay);
            if (fee <= 0) continue;
            const acc = agentAccounts.get(agent.user_id);
            await E().pay(opsAcc.id, acc.id, fee, 'intel.agent_pay', `${agent.role} — ${op0(kind)}, cycle ${cycleNo()}`, run);
          }
        }
        await run('UPDATE intel_service SET committed_budget = committed_budget + $1, tradecraft = tradecraft + $2 WHERE id=1', [
          budget + agentPayTotal,
          success ? op.reward : 0
        ]);

        /* -------------------------------------------------- kind-specific effect

           Everything a mission can actually DO to a foreign power's published
           state lives in this switch and nowhere else. */
        if (kind === 'recruit_asset') {
          const codename = clean(req.body?.codename, 60) || `ASSET-${Date.now().toString(36).toUpperCase()}`;
          const a = (
            await run(
              `INSERT INTO intel_assets(power_id,codename,status,recruited_cycle,recruited_by) VALUES($1,$2,$3,$4,$5) RETURNING *`,
              [power.id, codename, success ? 'active' : 'blown', cycleNo(), req.user.id]
            )
          ).rows[0];
          asset = a;
        } else if (kind === 'run_collection') {
          if (success) await run('UPDATE intel_assets SET experience = experience + 1 WHERE id=$1', [asset.id]);
          else await run("UPDATE intel_assets SET status='blown', resolved_at=now() WHERE id=$1", [asset.id]);
        } else if (kind === 'disinformation' && success) {
          await run(
            "INSERT INTO intel_effects(power_id,kind,magnitude,expires_cycle) VALUES($1,'counter_intel_penalty',$2,$3)",
            [power.id, 15, cycleNo() + 3]
          );
        } else if (kind === 'sabotage_trade' && success) {
          const offer = (
            await run(
              "SELECT * FROM foreign_offers WHERE power_id=$1 AND NOT withdrawn AND stock IS NOT NULL ORDER BY stock DESC LIMIT 1 FOR UPDATE",
              [power.id]
            )
          ).rows[0];
          if (offer) {
            const cut = Math.min(offer.stock, Math.max(1, Math.floor(budget / op.costUnit)));
            await run('UPDATE foreign_offers SET stock = stock - $1 WHERE id=$2', [cut, offer.id]);
          }
        } else if (kind === 'recruit_mole') {
          const targetAgent = req.body?.target_agent_id
            ? (await run('SELECT * FROM foreign_agents WHERE id=$1 AND power_id=$2', [Number(req.body.target_agent_id) || 0, power.id])).rows[0]
            : null;
          const codename = clean(req.body?.codename, 60) || `MOLE-${Date.now().toString(36).toUpperCase()}`;
          const a = (
            await run(
              `INSERT INTO intel_assets(power_id,codename,target_agent_id,status,recruited_cycle,recruited_by)
               VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
              [power.id, codename, targetAgent?.id || null, success ? 'active' : 'blown', cycleNo(), req.user.id]
            )
          ).rows[0];
          asset = a;
        } else if (kind === 'back_coup' || kind === 'removal') {
          /* Escalation's blowback is guaranteed, not attributed by a roll: the
             House does not get to hope nobody noticed. What stays sealed is the
             report's account of how it was done, on the ordinary clock — the
             standing change is public the moment it happens, same as any other
             diplomatic fact. */
          if (success) {
            await run("UPDATE powers SET standing='hostile' WHERE id=$1", [power.id]);
            if (asset?.target_agent_id)
              await run('UPDATE foreign_agents SET active=FALSE WHERE id=$1', [asset.target_agent_id]);
            if (kind === 'removal' && asset)
              await run("UPDATE intel_assets SET status='extracted', resolved_at=now() WHERE id=$1", [asset.id]);
          } else if (asset) {
            await run("UPDATE intel_assets SET status='blown', resolved_at=now() WHERE id=$1", [asset.id]);
            await run("UPDATE powers SET standing='hostile' WHERE id=$1", [power.id]);
          }
        }

        /* Every operation files a report, whatever happened. A blown asset or a
           failed sweep is exactly the kind of thing this Republic still puts on
           the record, sealed on the same clock as a clean one. */
        const subjectLine =
          `${op0(kind)}${power ? ` — ${power.name}` : ''} (${outcome})`;
        const bodyText = clean(req.body?.notes, 1500) ||
          `${op0(kind)} ordered against ${power?.name || 'no named target'}. ` +
          `Operational budget committed: ${budget}. Agent pay: ${agentPayTotal}. ` +
          `Score ${score} against a threshold of ${threshold}. Outcome: ${outcome}.`;
        reportRow = await fileReport(
          run,
          svc,
          { power_id: power?.id || null, line: subjectLine },
          bodyText,
          success ? 'high' : 'low',
          `${kind} operation`,
          req.user.id
        );

        opRow = (
          await run(
            `INSERT INTO intel_operations(kind,tier,power_id,asset_id,ordered_by,budget,agent_pay_total,cycle_no,score,threshold,outcome,report_id)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [kind, op.tier, power?.id || null, asset?.id || null, req.user.id, budget, agentPayTotal, cycleNo(), score, threshold, outcome, reportRow.id]
          )
        ).rows[0];
        for (const agent of assignedAgents)
          await run(
            `INSERT INTO intel_operation_agents(operation_id,user_id,assigned_by,role,pay) VALUES($1,$2,$3,$4,$5)
             ON CONFLICT DO NOTHING`,
            [opRow.id, agent.user_id, req.user.id, agent.role, money(agent.operation_pay)]
          );
      });

      log(req.user.id, `intel.op.${kind}`, `${outcome} vs ${power?.name || 'domestic'} (score ${score}/${threshold})`);
      res.json({ operation: { ...opRow, assigned_agent_count: assignedAgents.length, agent_pay_total: agentPayTotal }, report: { ...reportRow, body: undefined, sealed: true } });
    })
  );

  const op0 = kind => kind.replace(/_/g, ' ');

  /* Tier 1's defensive half: not aimed at a foreign power's row at all, so it
     never touches the switch above. What it finds is a deterministic read of
     published diplomatic facts — how many powers currently stand hostile — not
     a coin flip dressed up as espionage. */
  app.post(
    '/api/intel/counter-sweep',
    auth,
    wrap(async (req, res) => {
      const svc = await needIntel(res);
      if (!svc) return;
      if (!(await requireDirector(req, res))) return;
      const op = OPS.counter_sweep;
      const budget = money(req.body?.budget);
      if (budget <= 0) return res.status(400).json({ error: 'A sweep needs a budget above zero.' });
      const hostile = Number(
        (await q("SELECT count(*)::int n FROM powers WHERE standing='hostile' AND revoked_at IS NULL")).rows[0].n
      );
      const threshold = hostile * 10;
      const score = svc.tradecraft + Math.floor(budget / op.costUnit);
      const success = score >= threshold;

      const counterOpsAcc = E() ? await agencyAccount() : null;
      if (counterOpsAcc && Number(counterOpsAcc.balance) < budget)
        return res.status(409).json({ error: `The Service needs ${budget} for this sweep and holds ${Number(counterOpsAcc.balance)}. Request more funds from the House.` });
      let opRow, reportRow;
      await tx(async run => {
        /* Domestic, so there is no foreign account to pay into — but the money
           still has to land somewhere real rather than vanish, on the same rule
           tribute learned the hard way. It goes to the agency's own operating
           float, an ordinary account like the Treasury's or an escrow's. */
        if (E()) {
          const opsAcc = await agencyAccount();
          const spendAcc = await E().accountFor('intel_spend', null);
          await E().pay(opsAcc.id, spendAcc.id, budget, 'intel.counter_sweep', 'domestic counter-intelligence sweep', run);
        }
        await run('UPDATE intel_service SET committed_budget = committed_budget + $1, tradecraft = tradecraft + $2 WHERE id=1', [
          budget,
          success ? op.reward : 0
        ]);
        reportRow = await fileReport(
          run,
          svc,
          { power_id: null, line: `Counter-intelligence sweep (${success ? 'clear' : 'penetrated'})` },
          success
            ? `No foreign activity of concern found against ${hostile} hostile power(s) currently on the record.`
            : `The sweep did not clear against ${hostile} hostile power(s) currently on the record. Assume foreign collection continues against the Republic.`,
          success ? 'moderate' : 'low',
          'counter_sweep operation',
          req.user.id
        );
        opRow = (
          await run(
            `INSERT INTO intel_operations(kind,tier,power_id,asset_id,ordered_by,budget,cycle_no,score,threshold,outcome,report_id)
             VALUES('counter_sweep',1,NULL,NULL,$1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [req.user.id, budget, cycleNo(), score, threshold, success ? 'success' : 'failed', reportRow.id]
          )
        ).rows[0];
      });
      log(req.user.id, 'intel.op.counter_sweep', `${success ? 'success' : 'failed'} (score ${score}/${threshold})`);
      res.json({ operation: opRow, report: { ...reportRow, body: undefined, sealed: true } });
    })
  );

  /* -------------------------------------------------------------- leaks

     Declassification is a clock nobody controls; a leak is a citizen jumping
     that clock deliberately, and it costs them: it is logged with their name
     attached, permanently, the same discipline that already makes reading a
     sealed report a public act via intel_reads. Clearance gates it exactly
     the way it gates /api/intel/reports/:id/read — requireCleared, nothing
     narrower and nothing wider. Leaking report A only lifts the seal on
     report A; it is not a side door into the rest of the register, and it
     never touches money or the diplomacy action allowlist. */
  app.post(
    '/api/intel/reports/:id/leak',
    auth,
    wrap(async (req, res) => {
      const svc = I()?.intelService ? await I().intelService() : null;
      if (!svc) return res.status(400).json({ error: 'The Republic has no intelligence service.' });
      const r = (await q('SELECT * FROM intel_reports WHERE id=$1', [Number(req.params.id) || 0])).rows[0];
      if (!r) return res.status(404).json({ error: 'No such report.' });
      if (r.declassified) return res.status(409).json({ error: 'That report is already public. There is nothing left to leak.' });
      if (!(await requireCleared(req, res))) return;
      await tx(async run => {
        await run('UPDATE intel_reports SET declassified=TRUE WHERE id=$1', [r.id]);
        await run('INSERT INTO intel_leaks(report_id,user_id) VALUES($1,$2) ON CONFLICT (report_id) DO NOTHING', [r.id, req.user.id]);
      });
      log(req.user.id, 'intel.leak', `${r.ref}`);
      res.json({ ok: true, report_id: r.id, ref: r.ref });
    })
  );

  /* Public and permanent, same register discipline as intel_reads: who leaked
     what, and when. No auth — attribution is the whole point, and it would be
     a strange kind of "public" if you had to be logged in to see it. */
  app.get(
    '/api/intel/leaks',
    wrap(async (_req, res) => {
      const rows = (await q(`
        SELECT l.report_id, l.at, u.display_name, r.ref, r.subject
          FROM intel_leaks l
          JOIN intel_reports r ON r.id=l.report_id
          LEFT JOIN users u ON u.id=l.user_id
         ORDER BY l.at DESC LIMIT 100`)).rows;
      res.json(rows);
    })
  );

  async function runPayrun(cycle, actorId) {
    const svc = I()?.intelService ? await I().intelService() : null;
    if (!svc || !E()) return { funded: 0, salaries_paid: 0, salaries_unpaid: 0, reason: 'no active Service economy' };
    await retireExpiredDirector();
    const already = (await q('SELECT 1 FROM payruns WHERE kind=$1 AND cycle_no=$2', ['intelligence', cycle])).rows[0];
    if (already) return { funded: 0, salaries_paid: 0, salaries_unpaid: 0, reason: 'already run for this cycle' };

    const treasury = await E().treasury();
    const ops = await agencyAccount();
    const funded = money(svc.budget_per_cycle);
    if (funded > 0)
      await E().settle(treasury.id, ops.id, funded, 'intel.appropriation', `Intelligence Service recurring appropriation, cycle ${cycle}`);

    const agents = (await q(`SELECT a.user_id, a.role, a.salary_per_cycle, u.display_name
                               FROM intel_service_agents a JOIN users u ON u.id=a.user_id
                              WHERE a.active AND u.is_active AND u.approved
                              ORDER BY a.user_id`)).rows;
    const payable = agents.map(agent => ({ ...agent, amount: money(agent.salary_per_cycle) })).filter(a => a.amount > 0);
    const salaryDue = payable.reduce((n, a) => n + a.amount, 0);
    const afterFunding = await agencyAccount();
    let salariesPaid = 0, salariesUnpaid = 0, salaryTotal = 0;
    /* Payroll is all-or-none. A short Service budget cannot silently favour the
       first agent by database id; the Director sees the full arrears and can ask
       the House for a supplemental or recurring appropriation. */
    if (salaryDue > Number(afterFunding.balance)) {
      salariesUnpaid = payable.length;
    } else {
      for (const agent of payable) {
        const citizen = await E().accountFor('citizen', agent.user_id);
        await E().pay(afterFunding.id, citizen.id, agent.amount, 'intel.salary', `${agent.role}, cycle ${cycle}`);
        salariesPaid++;
        salaryTotal += agent.amount;
      }
    }
    await q('INSERT INTO payruns(kind,cycle_no,detail) VALUES($1,$2,$3)', [
      'intelligence', cycle, `${funded} appropriated; ${salariesPaid} salaries paid (${salaryTotal}); ${salariesUnpaid} unpaid`
    ]);
    log(actorId, 'intel.payrun', `cycle ${cycle}: funded ${funded}; salaries ${salaryTotal}; unpaid ${salariesUnpaid}`);
    return { funded, salaries_paid: salariesPaid, salary_total: salaryTotal, salaries_unpaid: salariesUnpaid, operating_balance: Number((await agencyAccount()).balance) };
  }

  ctx.intel = Object.assign(ctx.intel || {}, {
    agencyProgress, agencyFinance, OPS, TIER_GATE, directorNow, retireExpiredDirector, directorRemoved, runPayrun
  });
};
