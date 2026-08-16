/* Presidential budget.

   The President proposes the next cycle's tax policy and operating
   appropriations. The proposal is tabled immediately: the House debates it,
   the Speaker calls the division, and a carried division is the approval. It
   does not go back to the executive for assent.

   Once the Republic has approved at least one budget, the last approved plan
   carries forward if the House misses a cycle. That is deliberately visible as
   a carry-over, not a silent reset to admin configuration. */

module.exports.mount = function mount(app, ctx) {
  const { q, log, auth, wrap, num, loadConfig, holds, cycleNow, addEnactHook } = ctx;
  const money = n => Math.max(0, Math.round(Number(n) || 0));
  const rate = n => Math.max(0, Math.min(1, Number(n) || 0));
  const cycleNo = () => Math.max(1, Number(cycleNow()?.number) || 1);

  const DEPARTMENTS = {
    executive: 'Executive',
    legislature: 'House',
    judiciary: 'Judiciary',
    treasury: 'Treasury',
    foreign_affairs: 'Foreign Affairs',
    defence: 'Defence',
    intelligence: 'Intelligence Service'
  };

  /* Only these three have anything in the Republic that actually spends
     against them — classify() below is the single place that decides, and
     this set has to name exactly the keys it can return. The other four are
     the President's stated priorities with nowhere yet for that money to
     leave the Treasury by name: there is no "the House spends X" or "a
     Justice orders Judiciary spending" feature in this codebase. Showing
     "0 spent, all remaining" for those forever would read as an enforced
     ceiling that silently isn't one — the public summary says so instead of
     implying it. */
  const ENFORCED_DEPARTMENTS = new Set(['defence', 'foreign_affairs', 'intelligence']);

  const cleanDepartments = value => {
    const src = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(Object.keys(DEPARTMENTS).map(k => [k, money(src[k])]));
  };

  async function approvedFor(cycle, run = q, lock = false) {
    const suffix = lock ? ' FOR UPDATE' : '';
    const exact = (await run(
      `SELECT * FROM fiscal_budgets WHERE status='approved' AND cycle_no=$1 ORDER BY id DESC LIMIT 1${suffix}`,
      [cycle]
    )).rows[0];
    if (exact) return { row: exact, carryover: false };
    const prior = (await run(
      `SELECT * FROM fiscal_budgets WHERE status='approved' AND cycle_no < $1 ORDER BY cycle_no DESC,id DESC LIMIT 1${suffix}`,
      [cycle]
    )).rows[0];
    return prior ? { row: prior, carryover: true } : { row: null, carryover: false };
  }

  async function defaultDepartments() {
    const out = cleanDepartments({});
    out.defence = money(num('military_budget_per_cycle'));
    try {
      const svc = (await q('SELECT budget_per_cycle FROM intel_service ORDER BY id LIMIT 1')).rows[0];
      if (svc) out.intelligence = money(svc.budget_per_cycle);
    } catch { /* intelligence is an optional module */ }
    try {
      const ts = (await q(`SELECT terms FROM treaties t JOIN bills b ON b.id=t.bill_id
                            WHERE b.status='enacted' AND t.foreign_ratified_at IS NOT NULL AND t.denounced_at IS NULL`)).rows;
      out.foreign_affairs = ts.reduce((n, t) => n + money(t.terms?.tribute_per_cycle), 0);
    } catch { /* diplomacy is optional */ }
    return out;
  }

  async function provisional(cycle) {
    await loadConfig();
    return {
      id: null,
      bill_id: null,
      cycle_no: cycle,
      status: 'provisional',
      carryover: false,
      tax_free_allowance: money(num('tax_free_allowance')),
      tax_rate: rate(num('tax_rate')),
      tax_upper_threshold: money(num('tax_upper_threshold')),
      tax_rate_upper: rate(num('tax_rate_upper')),
      import_tariff: rate(num('foreign_trade_tax')),
      departments: await defaultDepartments(),
      rationale: 'Legacy fiscal settings remain provisional until the House approves its first Presidential Budget.'
    };
  }

  async function planFor(cycle, run = q, lock = false) {
    const found = await approvedFor(cycle, run, lock);
    if (!found.row) return provisional(cycle);
    return {
      ...found.row,
      cycle_no: cycle,
      source_cycle: Number(found.row.cycle_no),
      carryover: found.carryover,
      departments: cleanDepartments(found.row.departments),
      tax_free_allowance: Number(found.row.tax_free_allowance),
      tax_rate: Number(found.row.tax_rate),
      tax_upper_threshold: Number(found.row.tax_upper_threshold),
      tax_rate_upper: Number(found.row.tax_rate_upper),
      import_tariff: Number(found.row.import_tariff)
    };
  }

  async function taxPolicy(cycle = cycleNo()) {
    const p = await planFor(cycle);
    return {
      tax_free_allowance: Number(p.tax_free_allowance),
      tax_rate: Number(p.tax_rate),
      tax_upper_threshold: Number(p.tax_upper_threshold),
      tax_rate_upper: Number(p.tax_rate_upper),
      import_tariff: Number(p.import_tariff),
      provisional: p.status === 'provisional',
      carryover: !!p.carryover
    };
  }

  async function importTariff(cycle = cycleNo()) {
    return Number((await taxPolicy(cycle)).import_tariff) || 0;
  }

  async function departmentLimit(key, cycle = cycleNo()) {
    if (!DEPARTMENTS[key]) return 0;
    const p = await planFor(cycle);
    return money(p.departments?.[key]);
  }

  const cycleFromNote = note => {
    const m = String(note || '').match(/(?:\[cycle\s+|cycle\s+)(\d+)/i);
    return m ? Math.max(1, Number(m[1])) : cycleNo();
  };

  function classify(kind, note) {
    const k = String(kind || '');
    if (k === 'procurement' || k === 'wages') return 'defence';
    if (k === 'foreign_tribute' || k === 'foreign_aid' || k.startsWith('diplomacy.')) return 'foreign_affairs';
    if (k === 'intel.appropriation') return 'intelligence';
    return null;
  }

  async function spent(key, cycle, run = q) {
    const tag = `%[budget:${key}][cycle ${cycle}]%`;
    const r = (await run('SELECT COALESCE(sum(amount),0)::bigint n FROM ledger WHERE note LIKE $1', [tag])).rows[0];
    return Number(r?.n || 0);
  }

  async function supplemental(key, cycle, run = q) {
    const tag = `%[budget:${key}][cycle ${cycle}][supplemental:%`;
    const r = (await run('SELECT COALESCE(sum(amount),0)::bigint n FROM ledger WHERE note LIKE $1', [tag])).rows[0];
    return Number(r?.n || 0);
  }

  async function remaining(key, cycle = cycleNo()) {
    const p = await planFor(cycle);
    if (p.status === 'provisional') {
      if (key === 'defence') {
        const used = (await q(`SELECT COALESCE(sum(amount),0)::bigint n FROM ledger
                                WHERE kind IN ('procurement','wages') AND note LIKE $1`, [`%cycle ${cycle}%`])).rows[0];
        return Math.max(0, money(p.departments?.[key]) - Number(used?.n || 0));
      }
      return money(p.departments?.[key]);
    }
    const base = money(p.departments?.[key]);
    const extra = await supplemental(key, cycle);
    return Math.max(0, base + extra - await spent(key, cycle));
  }

  async function authoriseTreasurySpend(fromAcc, amount, kind, note, run) {
    const key = classify(kind, note);
    if (!key) return { note: String(note || '') };
    const owner = (await run('SELECT owner_kind FROM accounts WHERE id=$1', [fromAcc])).rows[0];
    if (owner?.owner_kind !== 'treasury') return { note: String(note || '') };
    const cycle = cycleFromNote(note);
    const p = await planFor(cycle, run, true);
    if (p.status === 'provisional') return { note: String(note || '') };

    /* A House-enacted Intelligence supplemental is itself an appropriation. It
       expands the line rather than being blocked by the budget it supplements. */
    const billRef = kind === 'intel.appropriation' ? String(note || '').match(/^(B\d+):/)?.[1] : null;
    if (billRef) {
      const bill = (await run("SELECT id FROM bills WHERE ref=$1 AND status='enacted'", [billRef])).rows[0];
      if (bill) return { note: `${note} [budget:${key}][cycle ${cycle}][supplemental:${billRef}]` };
    }

    const limit = money(p.departments?.[key]);
    const used = await spent(key, cycle, run);
    if (used + amount > limit) {
      throw Object.assign(
        new Error(`${DEPARTMENTS[key]} has ${Math.max(0, limit - used)} left in its cycle ${cycle} House-approved budget; this needs ${amount}.`),
        { code: 'BUDGET', status: 409 }
      );
    }
    return { note: `${note} [budget:${key}][cycle ${cycle}]` };
  }

  async function activate(cycle) {
    const p = await planFor(cycle);
    if (p.status === 'provisional') return p;
    const changes = {
      tax_free_allowance: p.tax_free_allowance,
      tax_rate: p.tax_rate,
      tax_upper_threshold: p.tax_upper_threshold,
      tax_rate_upper: p.tax_rate_upper,
      foreign_trade_tax: p.import_tariff,
      military_budget_per_cycle: p.departments.defence
    };
    for (const [key, value] of Object.entries(changes))
      await q('INSERT INTO config(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2', [key, String(value)]);
    try { await q('UPDATE intel_service SET budget_per_cycle=$1', [money(p.departments.intelligence)]); } catch { /* optional */ }
    await loadConfig();
    return p;
  }

  const taxOn = (balance, p) => {
    const b = Number(balance) || 0;
    const free = money(p.tax_free_allowance);
    const threshold = money(p.tax_upper_threshold);
    const base = rate(p.tax_rate);
    const upper = rate(p.tax_rate_upper);
    if (b <= free) return 0;
    if (threshold > free && b > threshold)
      return money((threshold - free) * base + (b - threshold) * upper);
    return money((b - free) * base);
  };

  async function publicSummary(cycle) {
    const p = await planFor(cycle);
    const departments = [];
    let total = 0;
    for (const [key, label] of Object.entries(DEPARTMENTS)) {
      const allocation = money(p.departments?.[key]);
      const actual = p.status === 'provisional' ? 0 : await spent(key, cycle);
      const supplements = p.status === 'provisional' ? 0 : await supplemental(key, cycle);
      total += allocation;
      departments.push({
        key, label, allocation, supplements, spent: actual,
        remaining: Math.max(0, allocation + supplements - actual),
        enforced: ENFORCED_DEPARTMENTS.has(key)
      });
    }
    const accounts = (await q(`SELECT a.balance,u.id FROM accounts a JOIN users u ON u.id=a.owner_id
                                WHERE a.owner_kind='citizen' AND u.is_active AND u.approved AND a.balance > 0`)).rows;
    const defected = new Set(ctx.offshore?.defectors ? await ctx.offshore.defectors() : []);
    const projectedTax = accounts.reduce((n, a) => n + (defected.has(a.id) ? 0 : taxOn(a.balance, p)), 0);
    return {
      ...p,
      departments,
      total_appropriations: total,
      projected_tax: projectedTax,
      projected_tax_balance: projectedTax - total
    };
  }

  async function proposalFor(cycle) {
    return (await q(`SELECT f.*,b.ref,b.title,b.status AS bill_status,b.result
                       FROM fiscal_budgets f LEFT JOIN bills b ON b.id=f.bill_id
                      WHERE f.cycle_no=$1 ORDER BY f.id DESC LIMIT 1`, [cycle])).rows[0] || null;
  }

  async function proposalDefaults(target) {
    const last = await approvedFor(target);
    if (last.row) return {
      tax_free_allowance: Number(last.row.tax_free_allowance), tax_rate: Number(last.row.tax_rate),
      tax_upper_threshold: Number(last.row.tax_upper_threshold), tax_rate_upper: Number(last.row.tax_rate_upper),
      import_tariff: Number(last.row.import_tariff), departments: cleanDepartments(last.row.departments)
    };
    const p = await provisional(target);
    return {
      tax_free_allowance: p.tax_free_allowance, tax_rate: p.tax_rate,
      tax_upper_threshold: p.tax_upper_threshold, tax_rate_upper: p.tax_rate_upper,
      import_tariff: p.import_tariff, departments: p.departments
    };
  }

  app.get('/api/budget', wrap(async (_req, res) => {
    const current = cycleNo();
    const target = current + 1;
    res.json({
      current: await publicSummary(current),
      target_cycle: target,
      next_proposal: await proposalFor(target),
      defaults: await proposalDefaults(target),
      departments: DEPARTMENTS
    });
  }));

  app.post('/api/budget/propose', auth, wrap(async (req, res) => {
    if (!(await holds(req.user.id, 'president')))
      return res.status(403).json({ error: 'Only the President proposes the Republic budget.' });
    const current = cycleNo();
    const target = current + 1;
    const old = await proposalFor(target);
    if (old && ['draft','tabled','division','tied','passed'].includes(old.bill_status))
      return res.status(409).json({ error: `Cycle ${target} already has a budget before the House (${old.ref}).` });
    if (old?.status === 'approved')
      return res.status(409).json({ error: `Cycle ${target} already has an approved budget.` });

    const taxFree = money(req.body?.tax_free_allowance);
    const taxRate = rate(req.body?.tax_rate);
    const threshold = money(req.body?.tax_upper_threshold);
    const upper = rate(req.body?.tax_rate_upper);
    const tariff = rate(req.body?.import_tariff);
    if (threshold < taxFree)
      return res.status(400).json({ error: 'The upper tax threshold cannot be below the tax-free allowance.' });
    const departments = cleanDepartments(req.body?.departments);
    const rationale = String(req.body?.rationale || '').trim().slice(0, 3000);
    const total = Object.values(departments).reduce((n, v) => n + v, 0);
    const lines = Object.entries(DEPARTMENTS).map(([k, label]) => `- **${label}:** ${departments[k]}`).join('\n');
    const body = `# Presidential Budget — cycle ${target}\n\n` +
      `Tax-free allowance: ${taxFree}\n\nBase tax rate: ${(taxRate * 100).toFixed(2)}%\n\n` +
      `Upper threshold: ${threshold}\n\nUpper tax rate: ${(upper * 100).toFixed(2)}%\n\n` +
      `Import tariff: ${(tariff * 100).toFixed(2)}%\n\n## Departmental operating appropriations\n\n${lines}\n\n` +
      `**Total operating appropriations: ${total}.**\n\n` +
      `Office salaries and the citizen dividend remain statutory expenditures outside these operating lines.\n\n` +
      (rationale ? `## President's statement\n\n${rationale}` : '');
    const n = (await q('SELECT count(*)::int n FROM bills')).rows[0].n + 1;
    const ref = `B${String(n).padStart(3, '0')}`;
    const bill = (await q(
      `INSERT INTO bills(ref,title,kind,body,author_id,status) VALUES($1,$2,'budget',$3,$4,'tabled') RETURNING *`,
      [ref, `Budget for cycle ${target}`, body, req.user.id]
    )).rows[0];
    const fiscal = (await q(
      `INSERT INTO fiscal_budgets(bill_id,cycle_no,proposed_by,tax_free_allowance,tax_rate,tax_upper_threshold,tax_rate_upper,import_tariff,departments,rationale)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [bill.id, target, req.user.id, taxFree, taxRate, threshold, upper, tariff, departments, rationale]
    )).rows[0];
    log(req.user.id, 'budget.propose', `${ref}: cycle ${target}, ${total} appropriated`);
    res.json({ ...fiscal, bill_id: bill.id, ref });
  }));

  async function billRejected(billId) {
    await q("UPDATE fiscal_budgets SET status='rejected' WHERE bill_id=$1 AND status='proposed'", [billId]);
  }

  addEnactHook(async (bill, actorId) => {
    if (bill.kind !== 'budget') return;
    const row = (await q("UPDATE fiscal_budgets SET status='approved',approved_at=now() WHERE bill_id=$1 RETURNING *", [bill.id])).rows[0];
    if (!row) return;
    log(actorId, 'budget.approve', `${bill.ref}: cycle ${row.cycle_no}`);
  });

  ctx.budget = {
    DEPARTMENTS, planFor, taxPolicy, importTariff, departmentLimit, remaining,
    authoriseTreasurySpend, activate, billRejected
  };
};
