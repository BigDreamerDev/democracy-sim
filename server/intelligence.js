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
  const { q, tx, log, auth, admin, wrap, canPropose, cycleNow } = ctx;

  const cycleNo = () => cycleNow()?.number || 0;
  const clean = (s, n = 2000) => String(s ?? '').trim().slice(0, n);
  const money = n => Math.max(0, Math.round(Number(n) || 0));

  const E = () => ctx.economy;
  /* diplomacy.js sets ctx.intel at mount time and this file extends the same
     object rather than replacing it — isCleared/intelService/declassifyDue stay
     exactly as diplomacy.js and offshore.js already rely on them. */
  const I = () => ctx.intel;

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
    wrap(async (_req, res) => {
      const svc = I()?.intelService ? await I().intelService() : null;
      if (!svc) return res.json({ service: null, tier: 0, gates: TIER_GATE, ops: OPS });
      res.json({ service: svc, progress: await agencyProgress(svc), ops: OPS });
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
    if (!charter) return;
    await q(
      `INSERT INTO intel_service(id, established_bill_id, charter, declassify_after_cycles, budget_per_cycle, established_cycle)
       VALUES (1,$1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET established_bill_id=$1, charter=$2, declassify_after_cycles=$3,
         budget_per_cycle=$4, established_cycle=$5, abolished_at=NULL`,
      [bill.id, charter.charter, charter.declassify_after_cycles, charter.budget_per_cycle, cycleNo()]
    );
    log(null, 'intel.establish', bill.ref);
  });

  /* --------------------------------------------------------- clearance

     No dedicated office holds this; clearance never was an office, it is a row,
     and granting one is exactly the kind of setting the RO may edit and log —
     the same authority that already extends to the Fed's rates. */
  app.post(
    '/api/intel/clearance',
    auth,
    admin,
    wrap(async (req, res) => {
      if (!(await needIntel(res))) return;
      const target = (await q('SELECT id, display_name FROM users WHERE id=$1', [Number(req.body?.user_id) || 0])).rows[0];
      if (!target) return res.status(400).json({ error: 'No such citizen.' });
      const reason = clean(req.body?.reason, 500) || 'cleared by the Returning Officer';
      await q(
        'INSERT INTO intel_clearance(user_id,granted_by,reason,until) VALUES($1,$2,$3,$4) ' +
          'ON CONFLICT (user_id) DO UPDATE SET granted_by=$2, reason=$3, until=$4, since=now()',
        [target.id, req.user.id, reason, req.body?.until || null]
      );
      log(req.user.id, 'intel.clearance.grant', target.display_name);
      res.json({ ok: true });
    })
  );

  app.delete(
    '/api/intel/clearance/:userId',
    auth,
    admin,
    wrap(async (req, res) => {
      if (!(await needIntel(res))) return;
      await q('DELETE FROM intel_clearance WHERE user_id=$1', [Number(req.params.userId) || 0]);
      log(req.user.id, 'intel.clearance.revoke', String(req.params.userId));
      res.json({ ok: true });
    })
  );

  /* An RO-adjustable, published difficulty. Not a secret dial: everyone can read
     it on GET /api/diplomacy/powers and do the arithmetic themselves before an
     operation is even ordered. */
  app.put(
    '/api/intel/powers/:id/counter-intel',
    auth,
    admin,
    wrap(async (req, res) => {
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
    wrap(async (_req, res) => {
      if (!(await needIntel(res))) return;
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
      if (!(await requireCleared(req, res))) return;
      const a = (await q('SELECT * FROM intel_assets WHERE id=$1', [Number(req.params.id) || 0])).rows[0];
      if (!a) return res.status(404).json({ error: 'No such asset.' });
      if (a.status !== 'active') return res.status(409).json({ error: `That asset is already ${a.status}.` });
      await q("UPDATE intel_assets SET status='extracted', resolved_at=now() WHERE id=$1", [a.id]);
      log(req.user.id, 'intel.asset.extract', a.codename);
      res.json({ ok: true });
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
      if (!(await requireCleared(req, res))) return;
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
          const t = await E().treasury();
          const toAcc = power ? await powerAccount(power.id, run) : await E().accountFor('intel_ops', null);
          await E().settle(t.id, toAcc.id, budget, `intel.${kind}`, `${op0(kind)} — ${power?.name || 'domestic'}`, run);
        }
        await run('UPDATE intel_service SET committed_budget = committed_budget + $1, tradecraft = tradecraft + $2 WHERE id=1', [
          budget,
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
          `Budget committed: ${budget}. Score ${score} against a threshold of ${threshold}. Outcome: ${outcome}.`;
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
            `INSERT INTO intel_operations(kind,tier,power_id,asset_id,ordered_by,budget,cycle_no,score,threshold,outcome,report_id)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [kind, op.tier, power?.id || null, asset?.id || null, req.user.id, budget, cycleNo(), score, threshold, outcome, reportRow.id]
          )
        ).rows[0];
      });

      log(req.user.id, `intel.op.${kind}`, `${outcome} vs ${power?.name || 'domestic'} (score ${score}/${threshold})`);
      res.json({ operation: opRow, report: { ...reportRow, body: undefined, sealed: true } });
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
      if (!(await requireCleared(req, res))) return;
      const op = OPS.counter_sweep;
      const budget = money(req.body?.budget);
      if (budget <= 0) return res.status(400).json({ error: 'A sweep needs a budget above zero.' });
      const hostile = Number(
        (await q("SELECT count(*)::int n FROM powers WHERE standing='hostile' AND revoked_at IS NULL")).rows[0].n
      );
      const threshold = hostile * 10;
      const score = svc.tradecraft + Math.floor(budget / op.costUnit);
      const success = score >= threshold;

      let opRow, reportRow;
      await tx(async run => {
        /* Domestic, so there is no foreign account to pay into — but the money
           still has to land somewhere real rather than vanish, on the same rule
           tribute learned the hard way. It goes to the agency's own operating
           float, an ordinary account like the Treasury's or an escrow's. */
        if (E()) {
          const t = await E().treasury();
          const opsAcc = await E().accountFor('intel_ops', null);
          await E().settle(t.id, opsAcc.id, budget, 'intel.counter_sweep', 'domestic counter-intelligence sweep', run);
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

  ctx.intel = Object.assign(ctx.intel || {}, { agencyProgress, OPS, TIER_GATE });
};
