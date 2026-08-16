/* The Judicial Enforcement Act and The Creation of an Economy Act — front end.

   Loaded after app.js. It registers two extra pages through window.Republic
   rather than editing app.js, so the Acts can be added or dropped on their own. */

(function () {
  const R = window.Republic;
  if (!R) {
    console.warn('[republic] acts.js loaded without app.js');
    return;
  }
  const { api, esc, md, toast, $, when, day } = R;
  const ME = () => R.me();
  const STATE = () => R.state();

  const sym = () => STATE()?.config?.currency_symbol || 'M';
  const cash = n => `${sym()}${Number(n || 0).toLocaleString()}`;
  const held = o => (ME()?.offices || []).includes(o);

  /* ------------------------------------------------------------- the court */

  async function viewCourt(v) {
    const c = await api('/api/court');
    const iAmJustice = held('justice');
    const laws = await api('/api/laws');

    const byWhom = a =>
      a === 'people' ? 'by the People' : a === 'house' ? 'by the House' : 'by the President';
    v.innerHTML = `
      <div class="court-head">
        <p class="court-title">In the Supreme Court of</p>
        <h1 class="court-name">${esc(STATE().config.nation_name)}</h1>
        <p class="court-quorum">${c.sitting} of 3 Justices sitting · two agreeing decide</p>
      </div>

      <div class="card">
        <h2>The bench</h2>
        <div class="bench">
          ${c.seats
            .map(
              s => `<div class="justice ${s.display_name ? '' : 'vacant'}">
            <span class="justice-seat">Seat ${s.seat}</span>
            <div class="justice-mark">${esc(s.display_name ? s.display_name.trim()[0].toUpperCase() : '—')}</div>
            <span class="justice-name">${esc(s.display_name || 'Vacant')}</span>
            <span class="justice-by">${s.appointer === 'people' ? 'elected by the Citizens' : `appointed ${esc(byWhom(s.appointer))}`}</span>
            ${s.term_ends ? `<span class="justice-term">until ${day(s.term_ends)}</span>` : ''}
            ${
              s.can_appoint || s.can_vacate
                ? `<div class="row" style="margin-top:10px;justify-content:center">
              ${s.can_appoint ? `<button class="btn btn-sm btn-primary" data-fill="${s.seat}" data-appointer="${s.appointer}">Appoint</button>` : ''}
              ${s.can_vacate ? `<button class="btn btn-sm" data-vacate="${s.seat}">${s.user_id === ME().id ? 'Resign' : 'Remove'}</button>` : ''}
            </div>`
                : s.display_name
                  ? '<span class="justice-term">seated for the term</span>'
                  : ''
            }
          </div>`
            )
            .join('')}
        </div>
        <p class="small muted" style="margin-top:14px">A Justice may hold no other office, and serves ${esc(STATE().config.justice_terms)} cycles — outlasting whoever appointed them. A seat can only be filled when it is empty: a sitting Justice leaves by resigning, by being impeached at two thirds of the House, or by serving out the term.</p>
        ${
          c.ballot
            ? `<div class="item" style="margin-top:12px">
          <div class="item-top"><span class="item-title">The People's seat is being voted on</span>
            <span class="tag">${esc(c.ballot.status)}</span></div>
          <p class="small muted" style="margin-top:4px">Seat 3 belongs to the Citizens, so it is filled at a ballot rather than by appointment. Anyone may stand, everyone votes, and a tie leaves it empty and runs the vote again.</p>
          <div class="row" style="margin-top:8px"><a class="btn btn-sm btn-primary" href="#/election/${c.ballot.id}">Go to the ballot</a></div>
        </div>`
            : !c.seats[2].user_id
              ? `<p class="small muted" style="margin-top:10px">The People's seat is empty and no ballot is open. It is filled by a vote of every Citizen, not by appointment — the Returning Officer calls one from the elections page.</p>`
              : ''
        }
      </div>

      <div class="card">
        <h2>Bring a case</h2>
        <p class="small muted">Any citizen may. No permission is needed from the House or the President.</p>
        <form id="case" class="stack" style="margin-top:12px">
          <label class="field"><span>Title</span><input name="title" required placeholder="What is wrong, in a line"></label>
          <div class="grid2">
            <label class="field"><span>Against</span><select name="target_kind" id="ck">
              <option value="law">A law</option>
              <option value="act">An act of an officer</option>
            </select></label>
            <label class="field" id="cl"><span>Which law</span><select name="target_law_id">
              ${laws.map(l => `<option value="${l.id}">${esc(l.ref)} ${esc(l.title)}</option>`).join('')}
            </select></label>
          </div>
          <label class="field" id="cn" hidden><span>Which act, by whom</span><input name="target_note" placeholder="e.g. the Speaker refusing to table B004"></label>
          <label class="field"><span>Your case</span><textarea name="claim" required placeholder="Why does this offend the Constitution or the law?"></textarea></label>
          <button class="btn btn-primary">Bring it before the Court</button>
        </form>
      </div>

      <div class="card">
        <h2>Cause list</h2>
        ${
          c.cases.length
            ? c.cases
                .map(
                  x => `
          <a class="cause" href="#/case/${x.id}">
            <div class="cause-top">
              <span><span class="cause-ref">${esc(x.ref)}</span> <span class="cause-title">${esc(x.title)}</span></span>
              <span class="tag ${x.status === 'upheld' ? 'on-oxide' : x.status === 'dismissed' ? 'on-green' : 'on-violet'}">${esc(x.status)}</span>
            </div>
            <div class="cause-meta">${esc(x.brought_by_name || 'unknown')} v. the Republic · lodged ${when(x.created_at)} · ${x.opinions} of 2 opinions given</div>
          </a>`
                )
                .join('')
            : '<div class="empty">No case has been brought.</div>'
        }
      </div>`;

    const ck = $('#ck');
    const syncCase = () => {
      $('#cl').hidden = ck.value !== 'law';
      $('#cn').hidden = ck.value !== 'act';
    };
    ck.onchange = syncCase;
    syncCase();

    $('#case').onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (f.target_kind !== 'law') delete f.target_law_id;
      else f.target_law_id = Number(f.target_law_id);
      try {
        const r = await api('/api/court/cases', { method: 'POST', body: f });
        location.hash = `#/case/${r.id}`;
      } catch (err) {
        toast(err.message, true);
      }
    };

    document.querySelectorAll('[data-fill]').forEach(
      b =>
        (b.onclick = async () => {
          const people = await api('/api/citizens');
          const name = prompt(
            `Seat ${b.dataset.fill} is filled by ${b.dataset.appointer === 'people' ? 'the People' : 'the ' + b.dataset.appointer}.\nWho? Type their display name exactly.\n\n${people.map(p => p.display_name).join(', ')}`
          );
          if (!name) return;
          const who = people.find(p => p.display_name.toLowerCase() === name.trim().toLowerCase());
          if (!who) return toast('No citizen by that name.', true);
          try {
            await api(`/api/court/seats/${b.dataset.fill}`, { method: 'POST', body: { user_id: who.id } });
            toast('Appointed.');
            R.reload();
          } catch (err) {
            toast(err.message, true);
          }
        })
    );
    document.querySelectorAll('[data-vacate]').forEach(
      b =>
        (b.onclick = async () => {
          if (!confirm('Vacate this seat?')) return;
          try {
            await api(`/api/court/seats/${b.dataset.vacate}/vacate`, { method: 'POST' });
            R.reload();
          } catch (err) {
            toast(err.message, true);
          }
        })
    );
  }

  async function viewCase(v, id) {
    const c = await api('/api/court/cases/' + id);
    const open = c.status === 'open';
    v.innerHTML = `
      <h1 class="page">${esc(c.title)}</h1>
      <p class="page-sub"><span class="ref">${esc(c.ref)}</span> · brought by ${esc(c.brought_by_name || 'unknown')} · ${day(c.created_at)} ·
        <span class="tag ${c.status === 'upheld' ? 'on-oxide' : c.status === 'dismissed' ? 'on-green' : 'on-violet'}">${esc(c.status)}</span></p>

      <div class="card"><p class="eyebrow">The complaint</p><div class="prose">${md(c.claim)}</div></div>

      ${
        c.law_ref
          ? `<div class="card">
        <p class="eyebrow">Complained of · ${esc(c.law_ref)} ${esc(c.law_title)}${c.law_repealed ? ' (struck down)' : ''}</p>
        <div class="prose">${md(c.law_body || '')}</div></div>`
          : c.target_note
            ? `<div class="card"><p class="eyebrow">Complained of</p><p>${esc(c.target_note)}</p></div>`
            : ''
      }

      ${
        c.ruling
          ? `<div class="judgment">
        <p class="judgment-head">Judgment of the Court · ${when(c.ruled_at)}</p>
        <div class="prose">${md(c.ruling)}</div>
        <div style="margin-top:18px"><span class="verdict ${esc(c.status)}">${esc(c.status === 'upheld' ? 'Complaint upheld' : 'Complaint dismissed')}</span></div>
      </div>`
          : `<div class="judgment"><p class="judgment-head">Before the Court</p>
        <p class="small muted">No judgment has been given. Two Justices must agree.</p>
        <div style="margin-top:14px"><span class="verdict open">Reserved</span></div></div>`
      }

      ${
        open && c.i_am_justice && !c.my_opinion
          ? `<div class="card">
        <h2>Your opinion</h2>
        <p class="small muted">Two Justices agreeing decide the case. Reasons are required and are published.</p>
        <form id="op" class="stack" style="margin-top:12px">
          <label class="field"><span>Reasons</span><textarea name="reason" required></textarea></label>
          <div class="row">
            <button class="btn btn-no" name="vote" value="uphold">Uphold the complaint</button>
            <button class="btn btn-aye" name="vote" value="dismiss">Dismiss it</button>
          </div>
        </form></div>`
          : ''
      }

      ${
        c.opinions.length
          ? `<div class="card"><h2>Opinions</h2>
        ${c.opinions
          .map(
            o => `<div class="opinion">
          <div class="opinion-by">${esc(o.display_name)} J. <em>— ${esc(o.vote === 'uphold' ? 'would uphold' : 'would dismiss')}, ${when(o.at)}</em></div>
          <div class="opinion-body">${esc(o.reason)}</div></div>`
          )
          .join('')}</div>`
          : ''
      }

      ${
        open && c.brought_by_name === ME().display_name
          ? '<button class="btn" id="wd">Withdraw the case</button>'
          : ''
      }`;

    if ($('#op'))
      $('#op').onsubmit = async e => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        f.vote = e.submitter?.value;
        if (!f.vote) return toast('Choose uphold or dismiss.', true);
        try {
          const r = await api(`/api/court/cases/${id}/opinion`, { method: 'POST', body: f });
          toast(
            r.decided
              ? `The Court has ruled: ${r.outcome}${r.struck ? ` — ${r.struck} struck down` : ''}`
              : 'Opinion recorded. The Court needs two.'
          );
          R.reload();
        } catch (err) {
          toast(err.message, true);
        }
      };
    if ($('#wd'))
      $('#wd').onclick = async () => {
        if (!confirm('Withdraw this case?')) return;
        await api(`/api/court/cases/${id}/withdraw`, { method: 'POST' });
        R.reload();
      };
  }

  /* ----------------------------------------------------------- the economy */

  async function viewEconomy(v) {
    const [e, me, market, orders, bank, inventory, budget] = await Promise.all([
      api('/api/economy'),
      api('/api/economy/me'),
      api('/api/economy/market'),
      api('/api/economy/orders'),
      api('/api/economy/bank'),
      api('/api/economy/inventory'),
      api('/api/budget')
    ]);
    const fiscal = budget.current || {};
    const policy = fiscal;
    const budgetState = fiscal.status === 'provisional' ? 'Provisional' : fiscal.carryover ? `Carry-over from cycle ${Number(fiscal.source_cycle || 0)}` : 'House approved';
    // Three of these seven lines are ceilings something in the Republic
    // actually checks against before it spends; the rest are the President's
    // stated priorities with no spending route yet, so "0 spent, all
    // remaining" would read as an enforced budget that isn't one. Said plainly
    // instead, the same call this app makes wherever a number would otherwise
    // imply a guarantee it can't back up.
    const deptRows = (fiscal.departments || []).map(d => `<div class="item"><div class="item-top"><span class="item-title">${esc(d.label)}</span><span class="result-count">${cash(d.allocation + d.supplements)}</span></div><div class="item-meta">${d.enforced
      ? `${cash(d.spent)} spent · ${cash(d.remaining)} remaining${d.supplements ? ` · ${cash(d.supplements)} supplemental` : ''}`
      : `proposed · not yet a spending line the Republic checks against`}</div></div>`).join('');
    const defaults = budget.defaults || {};
    const defaultDepts = defaults.departments || {};
    const next = budget.next_proposal;
    const proposalForm = has('president') ? `<div class="card"><p class="eyebrow">President</p><h2>Propose cycle ${Number(budget.target_cycle)} budget</h2><p class="small muted">The proposal is tabled immediately. The House approves or rejects it by division; a carried budget takes effect without a second executive assent.</p><form id="fiscal-budget" class="stack"><div class="grid2"><label class="field"><span>Tax-free allowance</span><input name="tax_free_allowance" type="number" min="0" value="${Number(defaults.tax_free_allowance || 0)}" required></label><label class="field"><span>Base tax rate (%)</span><input name="tax_rate" type="number" min="0" max="100" step="0.01" value="${(Number(defaults.tax_rate || 0) * 100).toFixed(2)}" required></label><label class="field"><span>Upper threshold</span><input name="tax_upper_threshold" type="number" min="0" value="${Number(defaults.tax_upper_threshold || 0)}" required></label><label class="field"><span>Upper tax rate (%)</span><input name="tax_rate_upper" type="number" min="0" max="100" step="0.01" value="${(Number(defaults.tax_rate_upper || 0) * 100).toFixed(2)}" required></label><label class="field"><span>Import tariff (%)</span><input name="import_tariff" type="number" min="0" max="100" step="0.01" value="${(Number(defaults.import_tariff || 0) * 100).toFixed(2)}" required></label></div><h3>Departmental operating appropriations</h3><div class="grid2">${Object.entries(budget.departments || {}).map(([key,label]) => `<label class="field"><span>${esc(label)}</span><input name="dept_${esc(key)}" type="number" min="0" value="${Number(defaultDepts[key] || 0)}" required></label>`).join('')}</div><label class="field"><span>President's budget statement</span><textarea name="rationale" maxlength="3000" rows="5" placeholder="Priorities, trade-offs and the reason for the tax settlement."></textarea></label><button class="btn btn-primary">Send budget to the House</button></form></div>` : '';
    const fiscalCard = `<div class="card"><div class="item-top"><div><p class="eyebrow">Public budget · cycle ${Number(fiscal.cycle_no || 0)}</p><h2>${esc(budgetState)}</h2></div>${fiscal.status === 'provisional' ? '<span class="tag on-violet">Provisional</span>' : '<span class="tag on-green">Approved</span>'}</div><div class="grid2" style="margin-top:12px"><div class="item"><div class="item-title">Tax settlement</div><div class="item-meta">${cash(policy.tax_free_allowance)} tax-free · ${Math.round(Number(policy.tax_rate || 0) * 10000) / 100}% to ${cash(policy.tax_upper_threshold)} · ${Math.round(Number(policy.tax_rate_upper || 0) * 10000) / 100}% above · ${Math.round(Number(policy.import_tariff || 0) * 10000) / 100}% import tariff</div></div><div class="item"><div class="item-title">Operating appropriations</div><div class="item-meta">${cash(fiscal.total_appropriations || 0)} approved · current-balance tax estimate ${cash(fiscal.projected_tax || 0)} · tax less appropriations ${cash(fiscal.projected_tax_balance || 0)}</div></div></div><p class="small muted" style="margin-top:10px">Office salaries and the citizen dividend are statutory expenditure outside these operating lines. Once the first budget is approved, a missed cycle visibly carries the last plan forward until the House replaces it.</p><div class="list" style="margin-top:12px">${deptRows || '<div class="empty">No departmental appropriations.</div>'}</div>${next ? `<p class="small" style="margin-top:12px">Cycle ${Number(budget.target_cycle)}: <a href="#/bill/${Number(next.bill_id)}"><span class="ref">${esc(next.ref || '')}</span> ${esc(next.title || 'Budget proposal')}</a> · ${esc(next.bill_status || next.status)}</p>` : `<p class="small muted" style="margin-top:12px">No budget has yet been proposed for cycle ${Number(budget.target_cycle)}.</p>`}</div>`;

    v.innerHTML = `
      <h1 class="page">The economy</h1>
      <p class="page-sub">${esc(e.currency)} · ${cash(e.dividend)} to every citizen each cycle</p>

      <div class="passbook">
        <div class="passbook-top">
          <div>
            <div class="passbook-label">${esc(STATE().config.nation_name)} · current account</div>
            <div class="passbook-holder">${esc(ME().display_name)}</div>
          </div>
          <div class="passbook-no">NO. ${String(me.account.id).padStart(6, '0')}</div>
        </div>
        <div class="passbook-balance">
          <div class="passbook-label">Available balance</div>
          <span class="balance-figure">${cash(me.account.balance)}</span>
          <div class="balance-side">
            <div><span>On deposit</span><strong>${cash(bank.deposit)}</strong></div>
            <div><span>Owed to the bank</span><strong>${cash(bank.owed)}</strong></div>
            <div><span>Dividend each cycle</span><strong>${cash(e.dividend)}</strong></div>
          </div>
        </div>
        <div class="statement">
          <p class="passbook-label" style="color:var(--ink-2);padding-top:12px">Recent movements</p>
          ${
            me.ledger.length
              ? me.ledger
                  .map(l => {
                    const inbound = l.to_id === me.account.id;
                    return `<div class="entry">
              <div><div class="entry-what">${esc(l.note || l.kind)}<span class="entry-kind">${esc(l.kind)}</span></div>
                <div class="entry-when">${when(l.at)}</div></div>
              <div class="entry-amount ${inbound ? 'in' : 'out'}">${inbound ? '+' : '−'}${cash(l.amount)}</div>
            </div>`;
                  })
                  .join('')
              : '<p class="small muted">Nothing has moved yet.</p>'
          }
        </div>
      </div>

      <div class="grid2">
        <div class="card"><h2>Send money</h2>
          <form id="pay" class="stack">
            <div class="grid2">
              <label class="field"><span>Pay</span><select name="user_id" id="payto"></select></label>
              <label class="field"><span>Amount</span><input name="amount" type="number" min="1" required></label>
            </div>
            <label class="field"><span>Note</span><input name="note" placeholder="What for?"></label>
            <button class="btn btn-primary">Send</button>
          </form>
          <h2 style="margin-top:24px">The public bank</h2>
          <p class="small muted">Deposits earn ${Math.round(Number(STATE().config.deposit_rate) * 100)}% a cycle. Loans cost ${Math.round(Number(STATE().config.loan_rate) * 100)}%, up to ${cash(bank.ceiling)}.</p>
          <div class="row" style="margin-top:12px">
            <input id="bamt" type="number" min="1" placeholder="Amount" style="width:120px">
            <button class="btn btn-sm" data-bank="deposit">Deposit</button>
            <button class="btn btn-sm" data-bank="withdraw">Withdraw</button>
            <button class="btn btn-sm" data-bank="borrow">Borrow</button>
          </div>
          ${
            bank.loans.filter(l => l.status !== 'repaid').length
              ? `<div class="list" style="margin-top:14px">
            ${bank.loans
              .filter(l => l.status !== 'repaid')
              .map(
                l => `<div class="item">
              <div class="item-top"><span class="item-title">Loan ${l.id}${l.status === 'default' ? ' <span class="tag on-oxide">default</span>' : ''}</span>
                <span class="money">${cash(l.outstanding)}</span></div>
              <div class="row" style="margin-top:6px">
                <input type="number" min="1" placeholder="Repay" style="width:100px" data-repay-amt="${l.id}">
                <button class="btn btn-sm" data-repay="${l.id}">Repay</button></div>
            </div>`
              )
              .join('')}</div>`
              : ''
          }
        </div>
        <div class="card"><p class="eyebrow">The state</p>
          <p><strong>Treasury</strong> ${cash(e.treasury)}</p>
          <p class="small muted">Tax this cycle: nothing below ${cash(policy.tax_free_allowance)}, ${Math.round(Number(policy.tax_rate || 0) * 10000) / 100}% up to ${cash(policy.tax_upper_threshold)}, then ${Math.round(Number(policy.tax_rate_upper || 0) * 10000) / 100}% above it.</p>
          <h2 style="margin-top:18px">Who holds what</h2>
          <div class="list">${e.holders
            .map(
              h => `<div class="item"><div class="item-top">
            <span class="item-title">${esc(h.display_name)}</span><span class="result-count">${cash(h.balance)}</span>
          </div></div>`
            )
            .join('')}</div>
        </div>
      </div>

      ${fiscalCard}
      ${proposalForm}

      <div class="card">
        <h2>The market</h2>
        ${
          market.length
            ? `<div class="list">${market
                .map(
                  l => `
          <div class="item"><div class="item-top">
            <span class="item-title">${esc(l.title)} <span class="tag">${esc(l.business_name)}</span></span>
            <span class="row"><span class="result-count">${cash(l.price)}</span>
              <button class="btn btn-sm btn-primary" data-buy="${l.id}">Buy</button></span></div>
            ${l.good_category ? `<div class="item-meta">${esc(l.good_category.replaceAll('_', ' '))} · per ${esc(l.unit || 'unit')}${l.stock === null ? '' : ` · ${l.stock} in stock`}</div>` : ''}
            ${l.description ? `<div class="small" style="margin-top:4px">${esc(l.description)}</div>` : ''}
            <div class="item-meta">${l.stock === null ? 'unlimited' : l.stock + ' left'}</div>
          </div>`
                )
                .join('')}</div>`
            : '<div class="empty">Nothing is for sale yet. Found a business and list something.</div>'
        }
      </div>

      ${String(STATE().config.goods_economy_enabled) === 'true' || inventory.length ? `<div class="card">
        <h2>Your strategic goods</h2>
        <p class="small muted">Domestic goods enter your inventory when you confirm delivery. Foreign-market goods enter it as soon as the purchase is paid.</p>
        ${inventory.length ? `<div class="list">${inventory.map(i => {
          const category = String(i.good_category || '').replaceAll('_', ' ');
          const label = category ? category.charAt(0).toUpperCase() + category.slice(1) : 'Strategic good';
          const qty = Number(i.quantity) || 0;
          const unit = esc(i.unit || 'unit');
          return `<div class="item"><div class="item-top"><span class="item-title">${esc(i.title)} <span class="tag">${esc(label)}</span></span><span class="result-count">${qty.toLocaleString()} × ${unit}</span></div>${i.description ? `<div class="small" style="margin-top:4px">${esc(i.description)}</div>` : ''}<div class="item-meta">${i.source_name ? `From ${esc(i.source_name)} · ` : ''}${when(i.updated_at || i.acquired_at)}</div></div>`;
        }).join('')}</div>` : '<p class="small muted">You do not own any strategic goods yet.</p>'}
      </div>` : ''}

      <div class="card">
        <h2>Your orders</h2>
        ${
          orders.length
            ? `<div class="list">${orders
                .map(
                  o => `
          <div class="item"><div class="item-top">
            <span class="item-title">${esc(o.title || 'a listing')} <span class="tag">${esc(o.business_name || '')}</span></span>
            <span class="tag ${o.status === 'delivered' ? 'on-green' : o.status === 'disputed' ? 'on-oxide' : 'on-violet'}">${esc(o.status)}</span></div>
          <div class="item-meta">${cash(o.price)} · ${when(o.created_at)}${o.buyer_name ? ' · ' + esc(o.buyer_name) : ''}</div>
          ${
            o.status === 'escrow'
              ? `<div class="row" style="margin-top:8px">
            ${
              o.buyer_id === ME().id
                ? `<button class="btn btn-sm btn-aye" data-confirm="${o.id}">It arrived</button>
                 <button class="btn btn-sm btn-no" data-dispute="${o.id}">It did not</button>`
                : `<button class="btn btn-sm" data-refund="${o.id}">Refund</button>`
            }
          </div>`
              : ''
          }
        </div>`
                )
                .join('')}</div>`
            : '<p class="small muted">Nothing bought or sold yet.</p>'
        }
      </div>

      <div class="card">
        <h2>Businesses</h2>
        <form id="found" class="stack">
          <div class="grid2">
            <label class="field"><span>Name</span><input name="name" required></label>
            <label class="field"><span>Form</span><select name="form">
              <option value="coop">Co-operative — owned by those who work in it</option>
              <option value="sole">Sole trader</option>
              <option value="company">Company</option>
            </select></label>
          </div>
          <label class="field"><span>What it does</span><textarea name="description" style="min-height:80px"></textarea></label>
          ${
            String(STATE().config.goods_economy_enabled) === 'true'
              ? `<label class="field"><span>Good category</span><select name="good_category" required>
            <option value="">Choose…</option><option value="food">Food</option><option value="raw_materials">Raw materials</option><option value="energy">Energy</option><option value="industrial_goods">Industrial goods</option><option value="technology">Technology</option><option value="arms">Arms</option><option value="luxury">Luxury</option><option value="services">Services</option>
          </select></label>`
              : ''
          }
          <button class="btn btn-primary">Found it${Number(STATE().config.registration_fee) ? ` (${cash(STATE().config.registration_fee)})` : ''}</button>
        </form>
        <div class="list" style="margin-top:16px">${
          e.businesses
            .map(
              b => `
          <a class="item" href="#/business/${b.id}">
            <div class="item-top"><span class="item-title">${esc(b.name)} <span class="tag">${esc(b.form)}</span></span>
              <span class="result-count">${cash(b.balance)}</span></div>
            <div class="item-meta">${esc(b.founder_name || '')} · ${b.members} owner${b.members > 1 ? 's' : ''} · ${b.listings} listing${b.listings === 1 ? '' : 's'}</div>
          </a>`
            )
            .join('') || '<div class="empty">No businesses yet.</div>'
        }</div>
      </div>`;

    api('/api/citizens').then(cs => {
      $('#payto').innerHTML = cs
        .filter(c => c.id !== ME().id)
        .map(c => `<option value="${c.id}">${esc(c.display_name)}</option>`)
        .join('');
    });

    if ($('#fiscal-budget')) $('#fiscal-budget').onsubmit = async ev => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(ev.target));
      const departments = {};
      for (const key of Object.keys(budget.departments || {})) departments[key] = Number(f[`dept_${key}`] || 0);
      try {
        const r = await api('/api/budget/propose', { method: 'POST', body: {
          tax_free_allowance: Number(f.tax_free_allowance),
          tax_rate: Number(f.tax_rate) / 100,
          tax_upper_threshold: Number(f.tax_upper_threshold),
          tax_rate_upper: Number(f.tax_rate_upper) / 100,
          import_tariff: Number(f.import_tariff) / 100,
          departments,
          rationale: f.rationale
        }});
        toast(`Budget ${r.ref} sent to the House.`);
        location.hash = `#/bill/${r.bill_id}`;
      } catch (err) { toast(err.message, true); }
    };

    $('#pay').onsubmit = async ev => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(ev.target));
      try {
        await api('/api/economy/transfer', {
          method: 'POST',
          body: { user_id: Number(f.user_id), amount: Number(f.amount), note: f.note }
        });
        toast('Sent.');
        R.reload();
      } catch (err) {
        toast(err.message, true);
      }
    };
    $('#found').onsubmit = async ev => {
      ev.preventDefault();
      try {
        const b = await api('/api/economy/businesses', {
          method: 'POST',
          body: Object.fromEntries(new FormData(ev.target))
        });
        location.hash = `#/business/${b.id}`;
      } catch (err) {
        toast(err.message, true);
      }
    };
    const act = (attr, path, confirmText) =>
      document.querySelectorAll(`[${attr}]`).forEach(
        b =>
          (b.onclick = async () => {
            if (confirmText && !confirm(confirmText)) return;
            try {
              await api(`/api/economy/orders/${b.getAttribute(attr)}/${path}`, { method: 'POST' });
              R.reload();
            } catch (err) {
              toast(err.message, true);
            }
          })
      );
    document.querySelectorAll('[data-bank]').forEach(
      b =>
        (b.onclick = async () => {
          const amount = Number($('#bamt').value);
          if (!amount) return toast('Enter an amount.', true);
          try {
            await api(`/api/economy/bank/${b.dataset.bank}`, { method: 'POST', body: { amount, cycles: 4 } });
            toast('Done.');
            R.reload();
          } catch (err) {
            toast(err.message, true);
          }
        })
    );
    document.querySelectorAll('[data-repay]').forEach(
      b =>
        (b.onclick = async () => {
          const amount = Number(document.querySelector(`[data-repay-amt="${b.dataset.repay}"]`).value);
          if (!amount) return toast('Enter an amount.', true);
          try {
            await api('/api/economy/bank/repay', {
              method: 'POST',
              body: { loan_id: Number(b.dataset.repay), amount }
            });
            R.reload();
          } catch (err) {
            toast(err.message, true);
          }
        })
    );
    act('data-confirm', 'confirm');
    act('data-refund', 'refund', 'Refund this order in full?');
    document.querySelectorAll('[data-dispute]').forEach(
      b =>
        (b.onclick = async () => {
          const claim = prompt('What went wrong? This becomes a case before the Supreme Court.');
          if (!claim) return;
          try {
            const r = await api(`/api/economy/orders/${b.dataset.dispute}/dispute`, {
              method: 'POST',
              body: { claim }
            });
            toast(`Case ${r.ref} opened.`);
            location.hash = `#/case/${r.case_id}`;
          } catch (err) {
            toast(err.message, true);
          }
        })
    );
    document.querySelectorAll('[data-buy]').forEach(
      b =>
        (b.onclick = async () => {
          try {
            await api(`/api/economy/listings/${b.dataset.buy}/buy`, { method: 'POST' });
            toast('Bought. The money is held until you confirm it arrived.');
            R.reload();
          } catch (err) {
            toast(err.message, true);
          }
        })
    );
  }

  async function viewBusiness(v, id) {
    const b = await api('/api/economy/businesses/' + id);
    v.innerHTML = `
      <h1 class="page">${esc(b.name)}</h1>
      <p class="page-sub">${esc(b.form)}${b.good_category ? ` · ${esc(b.good_category.replaceAll('_', ' '))}` : ''} · founded by ${esc(b.founder_name || 'unknown')} · ${cash(b.balance)}</p>
      ${b.description ? `<div class="card"><div class="prose">${md(b.description)}</div></div>` : ''}
      <div class="card"><h2>Owners</h2><p>${b.members.map(m => esc(m.display_name)).join(', ')}</p></div>

      ${b.mine && String(STATE().config.goods_economy_enabled) === 'true' && !b.good_category ? `<div class="card"><h2>Classify this business</h2><p class="small muted">Strategic goods mode is enabled. Choose the type of good this business produces before creating new listings.</p><form id="classify" class="row"><select name="good_category" required><option value="food">Food</option><option value="raw_materials">Raw materials</option><option value="energy">Energy</option><option value="industrial_goods">Industrial goods</option><option value="technology">Technology</option><option value="arms">Arms</option><option value="luxury">Luxury</option><option value="services">Services</option></select><button class="btn btn-primary">Save</button></form></div>` : ''}

      <div class="card"><h2>For sale</h2>
        ${
          b.listings.length
            ? `<div class="list">${b.listings
                .map(
                  l => `
          <div class="item"><div class="item-top">
            <span class="item-title">${esc(l.title)}</span>
            <span class="row"><span class="result-count">${cash(l.price)}</span>
            ${
              b.mine
                ? `<button class="btn btn-sm" data-pull="${l.id}">Withdraw</button>`
                : `<button class="btn btn-sm btn-primary" data-buy="${l.id}">Buy</button>`
            }</span></div>
            ${l.good_category ? `<div class="item-meta">${esc(l.good_category.replaceAll('_', ' '))} · per ${esc(l.unit || 'unit')}${l.stock === null ? '' : ` · ${l.stock} in stock`}</div>` : ''}
            ${l.description ? `<div class="small" style="margin-top:4px">${esc(l.description)}</div>` : ''}
          </div>`
                )
                .join('')}</div>`
            : '<p class="small muted">Nothing listed.</p>'
        }
        ${
          b.mine
            ? `<form id="list" class="stack" style="margin-top:16px">
          <label class="field"><span>Title</span><input name="title" required></label>
          <label class="field"><span>Description</span><textarea name="description" style="min-height:70px"></textarea></label>
          <div class="grid2">
            <label class="field"><span>Price</span><input name="price" type="number" min="0" required></label>
            <label class="field"><span>Stock (blank = unlimited)</span><input name="stock" type="number" min="0"></label>
            ${String(STATE().config.goods_economy_enabled) === 'true' ? `<label class="field"><span>Unit</span><input name="unit" value="unit" placeholder="kg, tonne, crate, licence…"></label>` : ''}
          </div>
          <button class="btn btn-primary">List it</button>
        </form>`
            : ''
        }
      </div>

      <div class="card" id="mkt"><h2>Shares</h2><p class="small muted">Loading…</p></div>

      ${
        b.orders.length
          ? `<div class="card"><h2>Orders</h2><div class="list">${b.orders
              .map(
                o => `
        <div class="item"><div class="item-top">
          <span class="item-title">${esc(o.title || '')} — ${esc(o.buyer_name || '')}</span>
          <span class="tag">${esc(o.status)}</span></div>
        <div class="item-meta">${cash(o.price)} · ${when(o.created_at)}</div></div>`
              )
              .join('')}</div></div>`
          : ''
      }`;

    if ($('#classify'))
      $('#classify').onsubmit = async ev => {
        ev.preventDefault();
        try {
          await api(`/api/economy/businesses/${id}/good-category`, {
            method: 'PUT',
            body: Object.fromEntries(new FormData(ev.target))
          });
          toast('Business classified.');
          R.reload();
        } catch (err) {
          toast(err.message, true);
        }
      };
    if ($('#list'))
      $('#list').onsubmit = async ev => {
        ev.preventDefault();
        const f = Object.fromEntries(new FormData(ev.target));
        try {
          await api(`/api/economy/businesses/${id}/listings`, { method: 'POST', body: f });
          toast('Listed.');
          R.reload();
        } catch (err) {
          toast(err.message, true);
        }
      };
    document.querySelectorAll('[data-pull]').forEach(
      x =>
        (x.onclick = async () => {
          await api(`/api/economy/listings/${x.dataset.pull}/withdraw`, { method: 'POST' });
          R.reload();
        })
    );
    document.querySelectorAll('[data-buy]').forEach(
      x =>
        (x.onclick = async () => {
          try {
            await api(`/api/economy/listings/${x.dataset.buy}/buy`, { method: 'POST' });
            toast('Bought. Held until you confirm it arrived.');
            R.reload();
          } catch (err) {
            toast(err.message, true);
          }
        })
    );
    drawMarket(id, b);
  }

  /* Part 5 — the order book, the tape, and the register of holders. */
  async function drawMarket(id, b) {
    const box = $('#mkt');
    let m;
    try {
      m = await api(`/api/economy/businesses/${id}/market`);
    } catch {
      box.innerHTML = '<h2>Shares</h2><p class="small muted">Not available.</p>';
      return;
    }

    if (!Number(m.business.shares_issued)) {
      box.innerHTML = `<h2>Shares</h2>
        <p class="small muted">This business has issued no shares. Once issued the number is fixed for good.</p>
        ${
          b.mine
            ? `<form id="issue" class="row" style="margin-top:12px">
          <input name="qty" type="number" min="1" value="100" style="width:120px">
          <button class="btn btn-primary">Issue shares</button></form>`
            : ''
        }`;
      if ($('#issue'))
        $('#issue').onsubmit = async ev => {
          ev.preventDefault();
          try {
            await api(`/api/economy/businesses/${id}/issue`, {
              method: 'POST',
              body: { qty: Number(new FormData(ev.target).get('qty')) }
            });
            R.reload();
          } catch (err) {
            toast(err.message, true);
          }
        };
      return;
    }

    const bids = m.book.filter(o => o.side === 'bid');
    const asks = m.book.filter(o => o.side === 'ask');
    const col = (title, rows, side) => `<div>
      <p class="eyebrow">${title}</p>
      ${
        rows.length
          ? rows
              .map(
                o => `<div class="entry">
        <div><div class="entry-what">${esc(o.display_name)}</div><div class="entry-when">${o.remaining} share${Number(o.remaining) === 1 ? '' : 's'}</div></div>
        <div class="entry-amount ${side === 'bid' ? 'in' : 'out'}">${cash(o.price)}
          ${o.display_name === ME().display_name ? `<button class="btn btn-sm" data-cancel="${o.id}" style="margin-left:8px">×</button>` : ''}</div>
      </div>`
              )
              .join('')
          : '<p class="small muted">None.</p>'
      }</div>`;

    box.innerHTML = `<h2>Shares</h2>
      <div class="row" style="gap:22px;margin-bottom:14px">
        <div><p class="eyebrow">Last traded</p><span class="money-big">${m.last ? cash(m.last) : '—'}</span></div>
        <div><p class="eyebrow">In issue</p><span class="money-big">${m.business.shares_issued}</span></div>
        <div><p class="eyebrow">You hold</p><span class="money-big">${m.mine}</span></div>
      </div>
      <div class="grid2">${col('Bids', bids, 'bid')}${col('Offers', asks, 'ask')}</div>

      <form id="order" class="stack" style="margin-top:18px">
        <div class="grid2">
          <label class="field"><span>Side</span><select name="side">
            <option value="bid">Buy</option><option value="ask">Sell</option></select></label>
          <label class="field"><span>Price a share</span><input name="price" type="number" min="1" required></label>
        </div>
        <label class="field"><span>How many</span><input name="qty" type="number" min="1" required></label>
        <button class="btn btn-primary">Place the order</button>
      </form>
      <p class="small muted" style="margin-top:8px">No citizen may hold more than ${Math.round(m.cap * 100)}% of a business. Every trade is public, with both parties named.</p>

      <h2 style="margin-top:24px">Register of holders</h2>
      <div class="list">${m.holders
        .map(
          h => `<div class="item"><div class="item-top">
        <span class="item-title">${esc(h.display_name)} ${(h.offices || []).length ? `<span class="tag on-violet">${esc(officeList(h.offices, ', '))}</span>` : ''}</span>
        <span class="money">${h.qty} · ${Math.round((Number(h.qty) / Number(m.business.shares_issued)) * 100)}%</span>
      </div></div>`
        )
        .join('')}</div>

      ${
        m.trades.length
          ? `<h2 style="margin-top:24px">The tape</h2>
        ${m.trades
          .map(
            t => `<div class="entry">
          <div><div class="entry-what">${esc(t.seller_name || '?')} → ${esc(t.buyer_name || '?')}</div>
            <div class="entry-when">${when(t.at)} · ${t.qty} share${Number(t.qty) === 1 ? '' : 's'}</div></div>
          <div class="entry-amount">${cash(t.price)}</div></div>`
          )
          .join('')}`
          : ''
      }

      ${
        b.mine
          ? `<form id="paydiv" class="row" style="margin-top:20px">
        <input name="per_share" type="number" min="1" placeholder="Per share" style="width:120px">
        <button class="btn">Declare a dividend</button></form>`
          : ''
      }`;

    $('#order').onsubmit = async ev => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(ev.target));
      try {
        const r = await api(`/api/economy/businesses/${id}/order`, {
          method: 'POST',
          body: { side: f.side, price: Number(f.price), qty: Number(f.qty) }
        });
        toast(
          r.filled
            ? `${r.filled} filled${r.remaining ? `, ${r.remaining} resting on the book` : ''}`
            : 'Order placed.'
        );
        drawMarket(id, b);
      } catch (err) {
        toast(err.message, true);
      }
    };
    document.querySelectorAll('[data-cancel]').forEach(
      x =>
        (x.onclick = async () => {
          try {
            await api(`/api/economy/orders/share/${x.dataset.cancel}/cancel`, { method: 'POST' });
            drawMarket(id, b);
          } catch (err) {
            toast(err.message, true);
          }
        })
    );
    if ($('#paydiv'))
      $('#paydiv').onsubmit = async ev => {
        ev.preventDefault();
        try {
          const r = await api(`/api/economy/businesses/${id}/dividend`, {
            method: 'POST',
            body: { per_share: Number(new FormData(ev.target).get('per_share')) }
          });
          toast(`Paid ${cash(r.total)} to ${r.holders} holders.`);
          R.reload();
        } catch (err) {
          toast(err.message, true);
        }
      };
  }

  /* ------------------------------------------------------------ the world

     Real coastlines, invented countries. The shapes are precomputed SVG paths in
     world-map.js; this only decides what colour each one is and what happens when
     you touch it.

     Two things are readable at a glance. A foreign power's own colour is the
     fill, so the identity generated for a state survives when the preview is
     committed. RECOGNITION is the border: a recognised power is drawn solid,
     an unrecognised one hatched and dashed — it is on the map because it exists,
     not because the Republic says it does. Standing remains explicit in the
     detail panel rather than replacing every neutral country's colour. Unclaimed
     land is flat and unlabelled; it is nobody's, and naming it would invent a
     state that has no account, no standing and no cabinet.

     Real country names are never rendered here. A territory is called whatever
     the power holding it is called, and nothing else. */
  /* Standing colours are still useful for unsaved Returning Officer territory
     previews and as a safe fallback for old powers without a valid colour. */
  const STANDING_FILL = {
    allied:   '#2C6A4F',
    friendly: '#5E9078',
    neutral:  '#8B909B',
    strained: '#B8863C',
    hostile:  '#A8362B',
    at_war:   '#7E241C'
  };
  const standingLabel = s => (s === 'at_war' ? 'at war' : String(s || 'neutral'));
  const powerFill = p => /^#[0-9a-f]{6}$/i.test(String(p?.colour || ''))
    ? String(p.colour)
    : (STANDING_FILL[p?.standing] || STANDING_FILL.neutral);

  /* Nation export: SVG straight from the server, PNG drawn from that same SVG
     on a canvas in the browser. `worldexport.js` deliberately has no
     rasteriser — the browser already owns one — so the PNG button never
     touches a new endpoint, it just paints what the SVG button downloads. */
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportFilename() {
    return (STATE()?.config?.nation_name || 'republic')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'republic';
  }

  async function fetchExportSvgText() {
    const svgText = await api('/api/world/export.svg?borders=1');
    if (typeof svgText !== 'string' || !svgText.startsWith('<svg'))
      throw new Error('The world export did not come back as an SVG.');
    return svgText;
  }

  async function downloadWorldSvg() {
    try {
      const svgText = await fetchExportSvgText();
      triggerDownload(new Blob([svgText], { type: 'image/svg+xml' }), `${exportFilename()}.svg`);
    } catch (err) { toast(err.message, true); }
  }

  async function downloadWorldPng() {
    try {
      const svgText = await fetchExportSvgText();
      const svgUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
      try {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('The exported SVG could not be drawn to a canvas.'));
          img.src = svgUrl;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width || 800;
        canvas.height = img.naturalHeight || img.height || 800;
        canvas.getContext('2d').drawImage(img, 0, 0);
        const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!pngBlob) throw new Error('The canvas could not produce a PNG.');
        triggerDownload(pngBlob, `${exportFilename()}.png`);
      } finally {
        URL.revokeObjectURL(svgUrl);
      }
    } catch (err) { toast(err.message, true); }
  }

  function exportButtonsHtml() {
    return `<div class="row wm-export-row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
      <button type="button" class="btn btn-sm" data-export-svg="1">Download SVG</button>
      <button type="button" class="btn btn-sm" data-export-png="1">Download PNG</button>
    </div>`;
  }

  function bindExportButtons() {
    document.querySelectorAll('[data-export-svg]').forEach(b => (b.onclick = downloadWorldSvg));
    document.querySelectorAll('[data-export-png]').forEach(b => (b.onclick = downloadWorldPng));
  }

  /* Subdivision geometry, fetched when it is actually needed.

     It used to be one 2.9 MB script tag in index.html, parsed on every page
     load by every user whether or not they ever opened the map, and precached
     by the service worker with `addAll` — which is all-or-nothing, so one
     failed fetch left the worker permanently uninstalled. Now the geometry is
     one file per territory and a session downloads only the territories it
     looks at.

     `window.WORLD_SUBDIVISIONS` keeps the same `{ shapes, parents }` shape the
     rest of this file already expects, so everything downstream is unchanged;
     it simply starts empty and fills in. */
  const SUBDIV = (window.WORLD_SUBDIVISIONS = window.WORLD_SUBDIVISIONS || {
    shapes: {}, parents: {}, meta: null, loaded: new Set(), detail: new Set()
  });

  async function subdivIndex() {
    if (SUBDIV.meta) return SUBDIV.meta;
    const [meta, parents] = await Promise.all([
      fetch('subdiv/index.json').then(r => r.json()),
      fetch('subdiv/parents.json').then(r => r.json())
    ]);
    Object.assign(SUBDIV.parents, parents);
    SUBDIV.meta = meta;
    return meta;
  }

  /* `codes` are opaque subdivision ids handed out by the API. The parents index
     is the only way to know which territory file holds each one — the client
     cannot work it out without downloading everything, which is the whole point
     of the split. Anything whose parent we do not recognise is skipped rather
     than guessed at. */
  async function loadSubdivisions(codes, { detail = false } = {}) {
    if (!codes || !codes.length) return SUBDIV;
    await subdivIndex();
    const want = new Set();
    for (const c of codes) {
      const t = SUBDIV.parents[c];
      if (!t) continue;
      const done = detail ? SUBDIV.detail : SUBDIV.loaded;
      if (!done.has(t)) want.add(t);
    }
    await Promise.all([...want].map(async t => {
      try {
        const j = await fetch(`subdiv/${t}${detail ? '.d' : ''}.json`).then(r => r.ok ? r.json() : null);
        if (!j) return;
        Object.assign(SUBDIV.shapes, j.shapes || {});
        (detail ? SUBDIV.detail : SUBDIV.loaded).add(t);
      } catch { /* a territory that will not load simply does not draw */ }
    }));
    return SUBDIV;
  }

  /* One whole territory, by its own code. The picker needs every subdivision of
     the country being edited, not just the ones already owned, so it cannot go
     through the parents index. Detail geometry, because this is the view where
     somebody is choosing individual subdivisions and needs to tell them apart. */
  async function loadTerritoryShapes(territory) {
    const t = String(territory);
    if (SUBDIV.detail.has(t)) return SUBDIV;
    await subdivIndex();
    const j = await fetch(`subdiv/${t}.d.json`).then(r => r.ok ? r.json() : null);
    if (j) {
      Object.assign(SUBDIV.shapes, j.shapes || {});
      for (const c of Object.keys(j.shapes || {})) SUBDIV.parents[c] = t;
      SUBDIV.detail.add(t);
      SUBDIV.loaded.add(t);
    }
    return SUBDIV;
  }

  /* Every subdivision the map is about to mention, so one pass fetches the lot
     rather than one request per territory as the renderer walks them. */
  function subdivisionCodesIn(world) {
    const out = [];
    for (const c of world?.republic?.subdivisions || []) out.push(c);
    for (const p of world?.powers || []) for (const c of p.subdivisions || []) out.push(c);
    return out;
  }

  function worldMap(world) {
    const M = window.WORLD_MAP;
    const S = window.WORLD_SUBDIVISIONS || { shapes: {}, parents: {} };
    if (!M || !world) return '';

    const republicHeld = new Set(world.republic?.territories || []);
    const republicPartial = new Set(world.republic?.partial_territories || []);
    const republicSubs = new Set(world.republic?.subdivisions || []);
    const subdivisionOwners = new Map();
    const countriesWithSubdivisionOwnership = new Set();

    for (const code of republicSubs) {
      const country = S.parents?.[code];
      if (country) countriesWithSubdivisionOwnership.add(String(country));
      subdivisionOwners.set(code, {
        kind: 'republic',
        name: world.republic?.name || STATE().config.nation_name,
        fill: 'var(--indelible-fill)'
      });
    }
    for (const p of world.powers) {
      for (const code of p.subdivisions || []) {
        const country = S.parents?.[code];
        if (country) countriesWithSubdivisionOwnership.add(String(country));
        subdivisionOwners.set(code, {
          kind: 'foreign', power: p, name: p.name,
          fill: powerFill(p)
        });
      }
    }

    /* Whole-country/legacy ownership still uses the country path. If a country
       has exact subdivision ownership, the neutral parent is drawn underneath
       and the real subdivision polygons become authoritative. */
    const ownersByCountry = {};
    const addOwner = (code, owner) => {
      if (!ownersByCountry[code]) ownersByCountry[code] = [];
      ownersByCountry[code].push(owner);
    };
    for (const code of republicHeld)
      addOwner(code, {
        kind: 'republic',
        name: world.republic?.name || STATE().config.nation_name,
        partial: republicPartial.has(code),
        fill: 'var(--indelible-fill)'
      });
    for (const p of world.powers) {
      const partial = new Set(p.partial_territories || []);
      for (const code of p.territories || [])
        addOwner(code, {
          kind: 'foreign', power: p, name: p.name,
          partial: partial.has(code),
          fill: powerFill(p)
        });
    }

    const splitDefs = [];
    const countryShapes = Object.entries(M.shapes)
      .map(([code, d]) => {
        if (countriesWithSubdivisionOwnership.has(String(code)))
          return `<path d="${d}" class="wm-land" data-territory="${code}" />`;

        const owners = ownersByCountry[code] || [];
        if (!owners.length)
          return `<path d="${d}" class="wm-land" data-territory="${code}" />`;

        if (owners.length > 1) {
          const gid = `wm-split-${String(code).replace(/[^A-Za-z0-9_-]/g, '-')}`;
          const step = 100 / owners.length;
          const stops = owners.map((owner, i) => {
            const from = (i * step).toFixed(2), to = ((i + 1) * step).toFixed(2);
            return `<stop offset="${from}%" style="stop-color:${owner.fill}"/><stop offset="${to}%" style="stop-color:${owner.fill}"/>`;
          }).join('');
          splitDefs.push(`<linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient>`);
          const names = owners.map(o => o.name).join(' / ');
          return `<path d="${d}" class="wm-split is-partial" data-territory="${code}" style="fill:url(#${gid})" aria-label="Split territory — ${esc(names)}">
                    <title>Split territory — ${esc(names)}</title>
                  </path>`;
        }

        const owner = owners[0];
        if (owner.kind === 'republic')
          return `<path d="${d}" class="wm-republic ${owner.partial ? 'is-partial' : ''}" data-territory="${code}" aria-label="${esc(owner.name)}${owner.partial ? ' — partial territory' : ''}">
                    <title>${esc(owner.name)}${owner.partial ? ' — partial territory' : ''}</title>
                  </path>`;

        const p = owner.power;
        return `<path d="${d}" class="wm-claim ${owner.partial ? 'is-partial' : ''} ${p.recognised ? 'is-recognised' : 'is-unrecognised'} ${p.standing === 'at_war' ? 'is-at-war' : ''}"
                      style="fill:${owner.fill}" data-power="${p.id}" data-territory="${code}"
                      tabindex="0" role="button"
                      aria-label="${esc(p.name)}, ${esc(standingLabel(p.standing))}, ${p.recognised ? 'recognised' : 'unrecognised'}${owner.partial ? ', partial territory' : ''}">
                  <title>${esc(p.name)} — ${esc(standingLabel(p.standing))}, ${p.recognised ? 'recognised' : 'not recognised'}${owner.partial ? ', partial territory' : ''}</title>
                </path>`;
      })
      .join('');

    /* Each country's generated ADM1 geometry is clipped to the existing
       country outline. That keeps the current coastline/projection intact while
       displaying genuine internal subdivision borders. */
    const subCodesByCountry = {};
    for (const [subCode, parent] of Object.entries(S.parents || {})) {
      if (!S.shapes?.[subCode] || !M.shapes?.[parent]) continue;
      if (!subCodesByCountry[parent]) subCodesByCountry[parent] = [];
      subCodesByCountry[parent].push(subCode);
    }
    const clipDefs = Object.keys(subCodesByCountry)
      .map(code => `<clipPath id="wm-clip-${code}"><path d="${M.shapes[code]}"/></clipPath>`)
      .join('');

    const subdivisionGroups = Object.entries(subCodesByCountry).map(([country, codes]) => {
      const hasOwnership = countriesWithSubdivisionOwnership.has(String(country));
      const densityClass = codes.length > 30 ? ' is-dense' : '';
      const activeClass = hasOwnership ? ' is-active' : '';
      const paths = codes.map(code => {
        const d = S.shapes[code];
        const owner = subdivisionOwners.get(code);
        if (!owner)
          return `<path d="${d}" class="wm-subdivision wm-subdivision-border" data-subdivision="${esc(code)}"/>`;
        if (owner.kind === 'republic')
          return `<path d="${d}" class="wm-subdivision wm-subdivision-owned wm-republic" data-subdivision="${esc(code)}" aria-label="${esc(owner.name)} subdivision">
                    <title>${esc(owner.name)} subdivision</title>
                  </path>`;
        const p = owner.power;
        return `<path d="${d}" class="wm-subdivision wm-subdivision-owned wm-claim ${p.recognised ? 'is-recognised' : 'is-unrecognised'} ${p.standing === 'at_war' ? 'is-at-war' : ''}"
                    style="fill:${owner.fill}" data-power="${p.id}" data-subdivision="${esc(code)}"
                    tabindex="0" role="button"
                    aria-label="${esc(p.name)}, ${esc(standingLabel(p.standing))}, subdivision">
                  <title>${esc(p.name)} — ${esc(standingLabel(p.standing))}</title>
                </path>`;
      }).join('');
      return `<g class="wm-subdivision-country${activeClass}${densityClass}" data-territory="${country}" data-subdivision-count="${codes.length}" clip-path="url(#wm-clip-${country})">${paths}</g>`;
    }).join('');

    /* Country outlines are redrawn above ADM1 paths. This keeps international
       borders visually stronger than internal borders and hides tiny source-
       dataset coastline differences at the clip edge. */
    const countryOutlines = Object.entries(M.shapes)
      .map(([code, d]) => `<path d="${d}" class="wm-country-outline" data-outline-territory="${code}"/>`)
      .join('');

    /* The country centroid is only a fallback. Once this SVG is in the DOM,
       placeWorldLabels() measures the polygons the state actually owns. This
       matters for generated worlds where several powers can hold subdivisions
       of the same parent territory: using that parent's centroid put their names
       directly on top of one another. */
    const republicLabel = (() => {
      const code = [...republicHeld]
        .filter(c => M.centroids[c])
        .sort((a, b) => (M.shapes[b] || '').length - (M.shapes[a] || '').length)[0];
      if (!code && !republicSubs.size) return '';
      const [x, y] = code ? M.centroids[code] : [M.width / 2, M.height / 2];
      return `<text class="wm-label" x="${x}" y="${y}" data-world-label="republic">${esc(world.republic?.name || STATE().config.nation_name)}</text>`;
    })();

    const labels = republicLabel + world.powers
      .filter(p => (p.territories || []).length || (p.subdivisions || []).length)
      .map(p => {
        const code = (p.territories || [])
          .filter(c => M.centroids[c])
          .sort((a, b) => (M.shapes[b] || '').length - (M.shapes[a] || '').length)[0];
        const [x, y] = code ? M.centroids[code] : [M.width / 2, M.height / 2];
        return `<text class="wm-label" x="${x}" y="${y}" data-world-label="power" data-power="${p.id}">${esc(p.name)}</text>`;
      })
      .join('');

    const unclaimed = Object.keys(M.shapes).length - world.claimed;
    const hasSubdivisionGeometry = Object.keys(S.shapes || {}).length > 0;

    return `<section class="card wm-card">
      <div class="dip-section-head">
        <span class="dip-section-kicker">The world · powers and recognition</span>
        <h2>Powers of the world</h2>
      </div>
      ${world.powers.length ? '' : '<p class="small muted">No foreign powers exist yet, so the world is empty. The Returning Officer creates them below.</p>'}
      ${hasSubdivisionGeometry ? '' : '<p class="small muted territory-map-warning">Subdivision geometry has not been generated yet. Run <code>python tools/generate-world-subdivisions.py</code> from the repository root.</p>'}
      <div class="wm-frame">
        <svg viewBox="0 0 ${M.width} ${M.height}" class="wm-svg" role="img" aria-label="Map of the world by foreign power and recognition">
          <defs>
            <pattern id="wm-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="none"/>
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--paper, #14161A)" stroke-width="2.5" opacity="0.55"/>
            </pattern>
            ${splitDefs.join('')}
            ${clipDefs}
          </defs>
          <g class="wm-shapes">${countryShapes}</g>
          <g class="wm-subdivision-layer">${subdivisionGroups}</g>
          <g class="wm-country-outline-layer" aria-hidden="true">${countryOutlines}</g>
          <g class="wm-preview-layer" aria-hidden="true"></g>
          <g class="wm-labels">${labels}</g>
        </svg>
      </div>
      <div class="wm-legend">
        ${world.powers.map(p => `<span class="wm-key"><i style="background:${esc(powerFill(p))}"></i>${esc(p.name)}</span>`).join('')}
        ${(world.republic?.territories || []).length ? `<span class="wm-key"><i class="wm-key-republic"></i>${esc(world.republic?.name || STATE().config.nation_name)}</span>` : ''}
        ${hasSubdivisionGeometry ? '<span class="wm-key"><i class="wm-key-subdivision"></i>subdivision border</span>' : ''}
        <span class="wm-key" id="wm-preview-key" hidden><i class="wm-key-preview"></i>unsaved edit</span>
        <span class="wm-key"><i class="wm-key-hatch"></i>not recognised</span>
        <span class="wm-key"><i class="wm-key-land"></i>unclaimed (${unclaimed})</span>
      </div>
      ${exportButtonsHtml()}
      ${hasSubdivisionGeometry ? '<p class="small muted wm-boundary-credit">Subdivision boundaries: geoBoundaries gbOpen ADM1 (CC BY 4.0).</p>' : ''}
      <div id="wm-detail" class="wm-detail" hidden></div>
    </section>`;
  }


  /* Put each label at the centroid of all geometry the state actually owns,
     rather than the centre of one territory. Generated states often span several
     subdivisions (and sometimes several parent territories), so the weighted
     polygon centroid is the centre of the nation as a whole. Collision offsets
     are only a fallback when two true nation centres happen to be very close. */
  function measureWorldLabelPath(d) {
    const rings = [];
    for (const part of String(d || '').split('M').slice(1)) {
      const pts = [];
      for (const chunk of part.replace(/Z/gi, '').split('L')) {
        if (!chunk) continue;
        const comma = chunk.indexOf(',');
        if (comma < 0) continue;
        const x = Number(chunk.slice(0, comma));
        const y = Number(chunk.slice(comma + 1));
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
      }
      if (pts.length >= 3) rings.push(pts);
    }

    let area = 0, cx = 0, cy = 0;
    for (const ring of rings) {
      let signed = 0, rx = 0, ry = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % ring.length];
        const f = x1 * y2 - x2 * y1;
        signed += f;
        rx += (x1 + x2) * f;
        ry += (y1 + y2) * f;
      }
      signed /= 2;
      const weight = Math.abs(signed);
      if (weight <= 1e-9) continue;
      area += weight;
      cx += (rx / (6 * signed)) * weight;
      cy += (ry / (6 * signed)) * weight;
    }
    return area > 0 ? { area, cx: cx / area, cy: cy / area } : null;
  }

  function placeWorldLabels() {
    const svg = document.querySelector('.wm-svg');
    if (!svg) return;
    const labels = [...svg.querySelectorAll('.wm-label[data-world-label]')];
    if (!labels.length) return;

    const vb = svg.viewBox?.baseVal;
    const width = vb?.width || window.WORLD_MAP?.width || 800;
    const height = vb?.height || window.WORLD_MAP?.height || 400;
    const placed = [];
    const intersects = (a, b, pad = 2) =>
      a.x < b.x + b.width + pad && a.x + a.width + pad > b.x &&
      a.y < b.y + b.height + pad && a.y + a.height + pad > b.y;
    const boxOf = node => {
      try {
        const b = node.getBBox();
        return b && Number.isFinite(b.x) && b.width >= 0 ? b : null;
      } catch { return null; }
    };

    const entries = labels.map(label => {
      const selector = label.dataset.worldLabel === 'republic'
        ? '.wm-republic'
        : `.wm-claim[data-power="${label.dataset.power}"]`;
      const measures = [...svg.querySelectorAll(selector)]
        .map(path => measureWorldLabelPath(path.getAttribute('d')))
        .filter(Boolean);
      const area = measures.reduce((n, m) => n + m.area, 0);
      const centre = area > 0 ? {
        x: measures.reduce((n, m) => n + m.cx * m.area, 0) / area,
        y: measures.reduce((n, m) => n + m.cy * m.area, 0) / area
      } : null;
      return { label, centre, area };
    }).filter(e => e.centre).sort((a, b) => b.area - a.area);

    const offsets = [
      [0, 0], [0, -10], [0, 10], [14, 0], [-14, 0],
      [14, -10], [-14, -10], [14, 10], [-14, 10]
    ];

    for (const { label, centre } of entries) {
      let best = null;
      for (const [dx, dy] of offsets) {
        const tx = centre.x + dx, ty = centre.y + dy;
        label.setAttribute('x', tx);
        label.setAttribute('y', ty);
        let b = boxOf(label);
        if (!b) continue;
        const x = Math.max(b.width / 2 + 2, Math.min(width - b.width / 2 - 2, tx));
        const y = Math.max(b.height / 2 + 2, Math.min(height - b.height / 2 - 2, ty));
        label.setAttribute('x', x);
        label.setAttribute('y', y);
        b = boxOf(label);
        if (!b) continue;
        const collisions = placed.reduce((n, other) => n + (intersects(b, other) ? 1 : 0), 0);
        if (!best || collisions < best.collisions) best = { x, y, box: b, collisions };
        if (!collisions) break;
      }
      if (!best) continue;
      label.setAttribute('x', best.x);
      label.setAttribute('y', best.y);
      placed.push(best.box);
    }
  }

  function setSubdivisionCountryState(code, className, on) {
    if (!code) return;
    const group = document.querySelector(`.wm-subdivision-country[data-territory="${String(code)}"]`);
    if (group) group.classList.toggle(className, !!on);
  }

  function setEditingSubdivisionCountry(code) {
    document.querySelectorAll('.wm-subdivision-country.is-editing').forEach(n => n.classList.remove('is-editing'));
    if (code) setSubdivisionCountryState(code, 'is-editing', true);
  }

  /* Clicking a country is how you find out who it is. The panel says only what
     the map cannot: the standing in words, whether the Republic recognises them,
     and how much of the world they hold. Hover/focus reveals that country's
     internal ADM1 lines without turning the full-world view into visual noise. */
  function bindWorldMap(world) {
    if (!world) return;
    placeWorldLabels();
    requestAnimationFrame(placeWorldLabels);
    const detail = document.querySelector('#wm-detail');
    if (!detail) return;
    const byId = Object.fromEntries(world.powers.map(p => [String(p.id), p]));

    document.querySelectorAll('.wm-shapes [data-territory]').forEach(n => {
      const code = n.dataset.territory;
      n.addEventListener('mouseenter', () => setSubdivisionCountryState(code, 'is-hovered', true));
      n.addEventListener('mouseleave', () => setSubdivisionCountryState(code, 'is-hovered', false));
      n.addEventListener('focus', () => setSubdivisionCountryState(code, 'is-hovered', true));
      n.addEventListener('blur', () => setSubdivisionCountryState(code, 'is-hovered', false));
    });

    const show = id => {
      const p = byId[String(id)];
      if (!p) return;
      document.querySelectorAll('.wm-claim').forEach(n => n.classList.toggle('is-picked', n.dataset.power === String(p.id)));
      detail.hidden = false;
      detail.innerHTML = `<div class="item-top">
          <span class="item-title"><span class="wm-dot" style="background:${esc(p.colour || '#5B2E9E')}"></span>${esc(p.name)}</span>
          <span><span class="tag">${esc(standingLabel(p.standing))}</span>${
            p.recognised ? '<span class="tag on-green">recognised</span>' : '<span class="tag">unrecognised</span>'
          }</span>
        </div>
        <p class="small muted" style="margin-top:6px">${
          p.adjective ? esc(p.adjective) + '. ' : ''
        }Holds ${p.territories.length} territor${p.territories.length === 1 ? 'y' : 'ies'}.${
          p.recognised
            ? ''
            : ' The Republic has not recognised this state — recognition is a bill, and the House votes on it.'
        }</p>`;
    };
    document.querySelectorAll('[data-power]').forEach(n => {
      n.onclick = () => show(n.dataset.power);
      n.onkeydown = ev => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); show(n.dataset.power); }
      };
    });
  }

  /* Handing out the world. Real country names stay inside this Returning
     Officer console. Both the Republic and foreign powers now use the same
     country -> top-level subdivision editor; old whole-country rows are kept as
     legacy assignments until the RO deliberately edits them. */
  function setTerritoryDraftPreview(entries) {
    const M = window.WORLD_MAP;
    const S = window.WORLD_SUBDIVISIONS || { shapes: {}, parents: {} };
    const layer = document.querySelector('.wm-preview-layer');
    const key = document.querySelector('#wm-preview-key');
    if (!M || !layer) return;
    const rows = (entries || []).map(x => {
      if (x?.subdivision_code && S.shapes?.[x.subdivision_code]) {
        const parent = x.country_code || S.parents?.[x.subdivision_code];
        return { ...x, d: S.shapes[x.subdivision_code], parent, subdivision: true };
      }
      if (x?.code && M.shapes[x.code]) return { ...x, d: M.shapes[x.code], parent: x.code, subdivision: false };
      return null;
    }).filter(Boolean);
    layer.innerHTML = rows.map(x => `<path d="${x.d}" class="wm-draft-preview ${x.subdivision ? 'is-subdivision' : ''} ${x.release ? 'is-release' : ''}"
      style="--wm-preview-fill:${x.fill || STANDING_FILL.neutral};${x.subdivision && x.parent ? `clip-path:url(#wm-clip-${x.parent})` : ''}"
      ${x.subdivision ? `data-subdivision="${esc(x.subdivision_code)}"` : `data-territory="${esc(x.code)}"`}>
      <title>${esc(x.label || 'Unsaved territory edit')}</title>
    </path>`).join('');
    if (key) key.hidden = !rows.length;
  }

  function territoryEditorHtml({ prefix, title, kicker, description, adminState }) {
    const M = window.WORLD_MAP, N = window.TERRITORY_NAMES;
    if (!M || !N) return '';
    const selected = adminState?.subdivisions || [];
    const legacy = new Set(adminState?.legacy_territories || []);
    const blockedCountries = new Map((adminState?.blocked_countries || []).map(x => [String(x.code), x]));
    const blockedCounts = {};
    for (const item of adminState?.blocked_subdivisions || [])
      blockedCounts[item.country_code] = (blockedCounts[item.country_code] || 0) + 1;
    const counts = {};
    for (const item of selected) counts[item.country_code] = (counts[item.country_code] || 0) + 1;

    const countries = Object.keys(M.shapes)
      .sort((a, b) => String(N[a] || a).localeCompare(String(N[b] || b)))
      .map(code => {
        const blocked = blockedCountries.get(code);
        let suffix = '';
        if (legacy.has(code)) suffix = ' — whole country (legacy)';
        else if (counts[code]) suffix = ` — ${counts[code]} selected`;
        if (blocked) suffix += `${suffix ? ';' : ' —'} held by ${blocked.owner_name || 'another state'}`;
        else if (blockedCounts[code]) suffix += `${suffix ? ';' : ' —'} ${blockedCounts[code]} unavailable`;
        return `<option value="${code}" data-label="${esc(N[code] || code)}" ${blocked ? 'disabled' : ''}>${esc(N[code] || code)}${esc(suffix)}</option>`;
      }).join('');

    return `<div class="territory-editor" data-territory-editor="${prefix}">
      <div class="dip-section-head"><span class="dip-section-kicker">${esc(kicker)}</span><h3>${esc(title)}</h3></div>
      <p class="small muted">${esc(description)}</p>
      <div class="republic-territory-grid">
        <div class="stack">
          <label class="field"><span>1. Country</span><select id="${prefix}-country"><option value="">Choose a country…</option>${countries}</select></label>
          <label class="field"><span>2. Find subdivision</span><input id="${prefix}-subdivision-search" type="search" placeholder="Search this country…" disabled></label>
          <div class="row republic-territory-actions">
            <button class="btn btn-sm" type="button" id="${prefix}-select-visible" disabled>Select visible</button>
            <button class="btn btn-sm" type="button" id="${prefix}-clear-country" disabled>Clear country</button>
          </div>
          <div id="${prefix}-subdivision-list" class="republic-subdivision-list"><p class="small muted">Choose a country to see its subdivisions.</p></div>
        </div>
        <div class="republic-territory-summary-wrap">
          <div class="item-top"><strong>Selected territory</strong><span class="tag" id="${prefix}-selected-count">${selected.length + legacy.size}</span></div>
          <p class="small muted territory-preview-note">Unsaved changes appear on the map above with a faded overlay.</p>
          <div id="${prefix}-territory-summary" class="republic-territory-summary"></div>
        </div>
      </div>
      <div class="row republic-territory-save">
        <button class="btn btn-primary" type="button" id="${prefix}-territories-save">Save territory</button>
        <button class="btn" type="button" id="${prefix}-territories-clear">Release all</button>
      </div>
    </div>`;
  }

  function republicTerritoryPicker(world, adminState) {
    return `<div class="card dip-ro-console republic-territory-editor">${territoryEditorHtml({
      prefix: 'ro-republic',
      title: `${STATE().config.nation_name} territory`,
      kicker: 'Initial world setup',
      description: 'Choose a country, then assign only the top-level subdivisions the Republic starts with. Subdivisions already held elsewhere are disabled; whole-country foreign claims block the country.',
      adminState
    })}</div>`;
  }

  function territoryPicker(powerId, world, adminState) {
    const power = world?.powers?.find(p => String(p.id) === String(powerId));
    return territoryEditorHtml({
      prefix: 'ro-foreign',
      title: `${power?.name || 'Foreign power'} territory`,
      kicker: 'Foreign borders',
      description: 'Choose a country, then assign top-level subdivisions to this power. Land held by the Republic or another foreign power is unavailable until it is released there first.',
      adminState
    });
  }

  function bindSubdivisionTerritoryEditor({ prefix, adminState, ownerLabel, previewFill, saveUrl, refresh }) {
    const countryEl = document.querySelector(`#${prefix}-country`);
    if (!countryEl) return;
    const N = window.TERRITORY_NAMES || {};
    const listEl = document.querySelector(`#${prefix}-subdivision-list`);
    const searchEl = document.querySelector(`#${prefix}-subdivision-search`);
    const selectVisible = document.querySelector(`#${prefix}-select-visible`);
    const clearCountry = document.querySelector(`#${prefix}-clear-country`);
    const summaryEl = document.querySelector(`#${prefix}-territory-summary`);
    const countEl = document.querySelector(`#${prefix}-selected-count`);
    const selected = new Map((adminState?.subdivisions || []).map(x => [x.code, { ...x }]));
    const legacy = new Set(adminState?.legacy_territories || []);
    const blockedCountries = new Map((adminState?.blocked_countries || []).map(x => [String(x.code), x]));
    const blockedSubdivisions = new Map((adminState?.blocked_subdivisions || []).map(x => [String(x.code), x]));
    const loaded = new Map();

    const initialSelected = new Map([...selected].map(([k, v]) => [k, { ...v }]));
    const initialLegacy = new Set(legacy);
    const countryName = code => N[code] || code;
    const selectedFor = (country, source = selected) => [...source.values()].filter(x => x.country_code === country);
    const signature = (country, source = selected, legacySource = legacy) =>
      legacySource.has(country) ? 'WHOLE' : selectedFor(country, source).map(x => x.code).sort().join('|');
    const currentHas = code => legacy.has(code) || selectedFor(code).length > 0;

    function updateDraftPreview() {
      const entries = [];
      const subdivisionCodes = new Set([...initialSelected.keys(), ...selected.keys()]);
      for (const code of subdivisionCodes) {
        const before = initialSelected.get(code);
        const after = selected.get(code);
        if (!!before === !!after) continue;
        const meta = after || before;
        entries.push({
          code: meta.country_code,
          country_code: meta.country_code,
          subdivision_code: code,
          fill: after ? previewFill : STANDING_FILL.neutral,
          release: !after,
          label: after ? `Unsaved: assign this subdivision to ${ownerLabel}` : `Unsaved: release this subdivision from ${ownerLabel}`
        });
      }

      const legacyCountries = new Set([...initialLegacy, ...legacy]);
      for (const code of legacyCountries) {
        const before = initialLegacy.has(code), after = legacy.has(code);
        if (before === after) continue;
        entries.push({
          code,
          fill: after ? previewFill : STANDING_FILL.neutral,
          release: !after,
          label: after ? `Unsaved: assign this whole territory to ${ownerLabel}` : `Unsaved: release this whole territory from ${ownerLabel}`
        });
      }
      setTerritoryDraftPreview(entries);
    }

    function updateCountryLabels() {
      const blockedCounts = {};
      for (const item of blockedSubdivisions.values()) blockedCounts[item.country_code] = (blockedCounts[item.country_code] || 0) + 1;
      for (const option of countryEl.options) {
        if (!option.value) continue;
        const base = option.dataset.label || countryName(option.value);
        const n = selectedFor(option.value).length;
        const blocked = blockedCountries.get(option.value);
        let suffix = legacy.has(option.value) ? ' — whole country (legacy)' : n ? ` — ${n} selected` : '';
        if (blocked) suffix += `${suffix ? ';' : ' —'} held by ${blocked.owner_name || 'another state'}`;
        else if (blockedCounts[option.value]) suffix += `${suffix ? ';' : ' —'} ${blockedCounts[option.value]} unavailable`;
        option.textContent = base + suffix;
      }
    }

    function renderSummary() {
      const groups = new Map();
      for (const item of selected.values()) {
        if (!groups.has(item.country_code)) groups.set(item.country_code, []);
        groups.get(item.country_code).push(item);
      }
      for (const code of legacy) if (!groups.has(code)) groups.set(code, []);
      countEl.textContent = String(selected.size + legacy.size);
      if (!groups.size) {
        summaryEl.innerHTML = '<p class="small muted">Nothing selected yet.</p>';
      } else {
        summaryEl.innerHTML = [...groups.entries()]
          .sort((a, b) => countryName(a[0]).localeCompare(countryName(b[0])))
          .map(([code, items]) => `<div class="republic-summary-country">
            <div class="item-top"><strong>${esc(countryName(code))}</strong><button class="btn btn-sm" type="button" data-territory-remove-country="${code}">Clear</button></div>
            <p class="small muted">${legacy.has(code) ? 'Whole country (legacy assignment)' : items.sort((a,b)=>a.name.localeCompare(b.name)).map(x=>esc(x.name)).join(', ')}</p>
          </div>`).join('');
        summaryEl.querySelectorAll('[data-territory-remove-country]').forEach(btn => btn.onclick = () => {
          const code = btn.dataset.territoryRemoveCountry;
          for (const [key, item] of [...selected]) if (item.country_code === code) selected.delete(key);
          legacy.delete(code);
          updateCountryLabels();
          renderSummary();
          updateDraftPreview();
          if (countryEl.value === code) renderCountry(code);
        });
      }
      updateCountryLabels();
    }

    function renderCountry(code) {
      const rows = loaded.get(code) || [];
      const term = String(searchEl.value || '').trim().toLowerCase();
      const visible = rows.filter(x => !term || `${x.name} ${x.type} ${x.code}`.toLowerCase().includes(term));
      if (!rows.length) {
        listEl.innerHTML = '<p class="small muted">No top-level subdivision data is available for this country. An existing whole-country legacy assignment is preserved until you release it.</p>';
        return;
      }
      /* The name table and the geometry do not always agree: the source draws
         some countries at a different granularity than ISO does, so a handful of
         named subdivisions have no shape. Selecting one used to be silent — it
         simply drew nothing, which is most of what "the map is broken" meant.
         Say so instead, and refuse the selection rather than accept a holding
         nobody can see on the map. */
      const unmapped = x => !SUBDIV.shapes[String(x.code)];
      listEl.innerHTML = visible.length ? visible.map(x => {
        const blocked = blockedSubdivisions.get(String(x.code));
        const checked = selected.has(x.code);
        const bare = unmapped(x) && !checked;
        return `<label class="republic-subdivision-option ${blocked ? 'is-blocked' : ''} ${bare ? 'is-unmapped' : ''}">
          <input type="checkbox" value="${esc(x.code)}" ${checked ? 'checked' : ''} ${(blocked || bare) && !checked ? 'disabled' : ''}>
          <span><strong>${esc(x.name)}</strong><small>${esc([
            x.type,
            blocked ? `Held by ${blocked.owner_name || 'another state'}` : '',
            bare ? 'No mapped border — cannot be assigned' : ''
          ].filter(Boolean).join(' · '))}</small></span>
        </label>`;
      }).join('') : '<p class="small muted">No subdivisions match that search.</p>';
      const bareCount = visible.filter(unmapped).length;
      if (bareCount)
        listEl.insertAdjacentHTML('afterbegin',
          `<p class="small muted">${bareCount} of ${visible.length} have no mapped border and cannot be assigned. The map only hands out what it can draw.</p>`);
      listEl.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach(cb => cb.onchange = () => {
        const meta = rows.find(x => x.code === cb.value);
        if (cb.checked) selected.set(meta.code, { country_code: code, ...meta }); else selected.delete(cb.value);
        renderSummary();
        updateDraftPreview();
      });
    }

    async function loadCountry(code) {
      searchEl.value = '';
      setEditingSubdivisionCountry(code);
      if (!code) {
        searchEl.disabled = selectVisible.disabled = clearCountry.disabled = true;
        listEl.innerHTML = '<p class="small muted">Choose a country to see its subdivisions.</p>';
        return;
      }
      searchEl.disabled = selectVisible.disabled = clearCountry.disabled = false;
      listEl.innerHTML = '<p class="small muted">Loading subdivisions…</p>';
      try {
        if (!loaded.has(code)) {
          /* Names come from the server, which is the only place they exist;
             geometry comes from that territory's own file. Both are needed
             before the picker can draw a preview, and neither is worth having
             until the Returning Officer opens this country. */
          const [data] = await Promise.all([
            api(`/api/admin/territories/subdivisions/${encodeURIComponent(code)}`),
            loadTerritoryShapes(code).catch(() => {})
          ]);
          loaded.set(code, data.subdivisions || []);
        }
        if (legacy.has(code) && loaded.get(code).length) {
          for (const meta of loaded.get(code)) {
            if (!blockedSubdivisions.has(String(meta.code)))
              selected.set(meta.code, { country_code: code, ...meta });
          }
          legacy.delete(code);
          renderSummary();
          updateDraftPreview();
        }
        renderCountry(code);
      } catch (err) {
        listEl.innerHTML = `<p class="small muted">${esc(err.message)}</p>`;
      }
    }

    countryEl.onchange = () => loadCountry(countryEl.value);
    searchEl.oninput = () => renderCountry(countryEl.value);
    selectVisible.onclick = () => {
      const code = countryEl.value, rows = loaded.get(code) || [], term = String(searchEl.value || '').trim().toLowerCase();
      rows
        .filter(x => !blockedSubdivisions.has(String(x.code)))
        .filter(x => !term || `${x.name} ${x.type} ${x.code}`.toLowerCase().includes(term))
        .forEach(meta => selected.set(meta.code, { country_code: code, ...meta }));
      renderCountry(code);
      renderSummary();
      updateDraftPreview();
    };
    clearCountry.onclick = () => {
      const code = countryEl.value;
      for (const [key, item] of [...selected]) if (item.country_code === code) selected.delete(key);
      legacy.delete(code);
      renderCountry(code);
      renderSummary();
      updateDraftPreview();
    };
    document.querySelector(`#${prefix}-territories-save`).onclick = async () => {
      try {
        await api(saveUrl, {
          method: 'PUT',
          body: {
            subdivisions: [...selected.values()].map(x => ({ country_code: x.country_code, code: x.code })),
            legacy_codes: [...legacy]
          }
        });
        toast(`${selected.size} subdivisions saved for ${ownerLabel}.`);
        setTerritoryDraftPreview([]);
        refresh();
      } catch (err) { toast(err.message, true); }
    };
    document.querySelector(`#${prefix}-territories-clear`).onclick = async () => {
      try {
        await api(saveUrl, { method: 'PUT', body: { subdivisions: [], legacy_codes: [] } });
        toast(`${ownerLabel} territory released.`);
        setTerritoryDraftPreview([]);
        refresh();
      } catch (err) { toast(err.message, true); }
    };

    renderSummary();
    updateDraftPreview();
  }

  function bindRepublicTerritoryPicker(adminState, refresh) {
    bindSubdivisionTerritoryEditor({
      prefix: 'ro-republic',
      adminState,
      ownerLabel: STATE().config.nation_name,
      previewFill: 'var(--indelible-fill)',
      saveUrl: '/api/admin/republic/territories',
      refresh
    });
  }

  function bindTerritoryPicker(powerId, power, adminState, refresh) {
    bindSubdivisionTerritoryEditor({
      prefix: 'ro-foreign',
      adminState,
      ownerLabel: power?.name || 'foreign power',
      previewFill: powerFill(power),
      saveUrl: `/api/admin/foreign/powers/${powerId}/territories`,
      refresh
    });
  }

  /* The procedural world generator. Power is set before any land is handed
     out, so what this form actually chooses is a spread of strength around
     the Republic's own — the map is only asked afterwards to make that real.
     Nothing exists until the Returning Officer commits a preview; discard as
     many as it takes. */
  function worldgenNationRow(n) {
    return `<div class="item">
      <div class="item-top">
        <span class="item-title">${esc(n.name)}</span>
        <span class="tag${n.satisfied ? ' on-green' : ''}">${esc(n.target_multiple)}x target · ${esc(n.achieved_multiple)}x achieved</span>
      </div>
      <p class="small muted">${n.subdivision_count} subdivision(s) · strength ${n.strength}${n.name_degraded ? ' · name drawn from the reserve list' : ''}</p>
      <p class="small muted">${esc(n.stopped_because || '')}</p>
    </div>`;
  }

  function worldgenPlanHtml(plan) {
    if (!plan) return '';
    const nations = plan.nations || [];
    return `<div class="stack" id="worldgen-plan" style="margin-top:14px">
      <p class="small muted">Seed <code>${esc(plan.seed)}</code> · ${nations.length} power(s) · Republic strength ${esc(plan.republic_strength)} (${esc(plan.republic_strength_source || '')}) · ${esc(plan.claimed_by_generation)} of ${esc(plan.unclaimed_before)} unclaimed pieces used, ${esc(plan.unclaimed_after)} left.</p>
      <img class="worldgen-preview-img" alt="Preview of a generated world" data-preview-for="${plan.id}">
      ${(plan.warnings || []).length ? `<div class="list">${plan.warnings.map(w => `<p class="small muted">${esc(w)}</p>`).join('')}</div>` : ''}
      <div class="list">${nations.map(worldgenNationRow).join('')}</div>
      <p class="small muted">${esc(plan.recognition || '')}</p>
      ${plan.status === 'preview' || !plan.status
        ? `<div class="row" style="gap:8px">
        <button class="btn btn-primary btn-sm" data-worldgen-commit="${plan.id}">Commit this world</button>
        <button class="btn btn-sm" data-worldgen-discard="${plan.id}">Discard</button>
      </div>`
        : `<p class="small muted">This generation is ${esc(plan.status)}.</p>`}
      <div id="worldgen-commit-result"></div>
    </div>`;
  }

  async function loadWorldgenPreview(id) {
    const img = document.querySelector(`img[data-preview-for="${id}"]`);
    if (!img) return;
    try {
      const svgText = await api(`/api/world/generations/${id}/preview.svg`);
      if (typeof svgText !== 'string' || !svgText.startsWith('<svg')) throw new Error('no preview');
      const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
      if (img.dataset.blobUrl) URL.revokeObjectURL(img.dataset.blobUrl);
      img.dataset.blobUrl = url;
      img.src = url;
    } catch { /* the image tag simply stays broken; the numbers above still tell the story */ }
  }

  function worldgenSectionHtml(gens) {
    const rows = gens?.generations || [];
    return `<details class="card dip-ro-create dip-ro-worldgen"><summary><strong>Generate a world</strong></summary>
      <div class="stack" style="margin-top:12px">
        <p class="small muted">The Republic's own strength is read first, and every neighbour is set as a multiple of it — only then is the map asked to satisfy those numbers. Every power arrives unrecognised. Nothing goes live until you commit; throw a preview away and try another seed as often as you like.</p>
        <form id="worldgen-generate" class="stack">
          <div class="grid2">
            <label class="field"><span>Seed (optional)</span><input name="seed" placeholder="random"></label>
            <label class="field"><span>Number of powers</span><input name="powers" type="number" min="1" max="24" value="8"></label>
          </div>
          <div class="grid2">
            <label class="field"><span>Fill share (0.2–0.95)</span><input name="fill_share" type="number" step="0.01" min="0.2" max="0.95" value="0.72"></label>
            <label class="field"><span>Reach (40–400)</span><input name="reach" type="number" min="40" max="400" value="170"></label>
          </div>
          <label class="field"><span>Republic strength override (optional)</span><input name="republic_strength" type="number" min="1" placeholder="read from war.js if left blank"></label>
          <button class="btn btn-primary">Generate preview</button>
        </form>
        <div id="worldgen-active"></div>
        <h3 class="small muted" style="margin-top:6px">Past generations</h3>
        <div class="list" id="worldgen-list">${
          rows.length
            ? rows.map(g => `<div class="item">
          <div class="item-top"><span class="item-title">Seed ${esc(g.seed)}</span><span class="tag${g.status === 'committed' ? ' on-green' : ''}">${esc(g.status)}</span></div>
          <p class="small muted">${esc(g.powers)} power(s) · Republic strength ${esc(g.republic_strength)}${g.created_by_name ? ` · ${esc(g.created_by_name)}` : ''}${g.committed_at ? ` · committed ${esc(g.committed_at)}` : ''}</p>
          ${g.status === 'preview' ? `<div class="row" style="gap:8px"><button type="button" class="btn btn-sm" data-worldgen-view="${g.id}">Open preview</button></div>` : ''}
        </div>`).join('')
            : '<p class="muted">No generations yet.</p>'
        }</div>
      </div>
    </details>`;
  }

  function bindWorldgenPlanButtons() {
    document.querySelectorAll('[data-worldgen-commit]').forEach(b => {
      b.onclick = async () => {
        if (!confirm('Commit this world? Its powers become real and the generation cannot be discarded afterward.')) return;
        try {
          const r = await api(`/api/world/generations/${b.dataset.worldgenCommit}/commit`, { method: 'POST' });
          const out = document.querySelector('#worldgen-commit-result');
          if (out) {
            out.innerHTML = `<p class="small"><strong>Committed. Each key is shown once — save it now.</strong></p>` +
              (r.powers || []).map(p => `<p class="small">${esc(p.name)} · ${esc(p.subdivisions)} subdivision(s)</p><textarea readonly>${esc(p.key)}</textarea>`).join('');
          }
          toast(`${(r.powers || []).length} power(s) committed.`);
        } catch (err) { toast(err.message, true); }
      };
    });
    document.querySelectorAll('[data-worldgen-discard]').forEach(b => {
      b.onclick = async () => {
        if (!confirm('Discard this preview?')) return;
        try {
          await api(`/api/world/generations/${b.dataset.worldgenDiscard}/discard`, { method: 'POST' });
          toast('Preview discarded.');
          viewDiplomacy();
        } catch (err) { toast(err.message, true); }
      };
    });
  }

  function bindWorldgenSection() {
    const form = document.querySelector('#worldgen-generate');
    if (form) {
      form.onsubmit = async ev => {
        ev.preventDefault();
        const fd = Object.fromEntries(new FormData(ev.target));
        const body = {
          seed: fd.seed || undefined,
          powers: fd.powers || undefined,
          fill_share: fd.fill_share || undefined,
          reach: fd.reach || undefined,
          republic_strength: fd.republic_strength || undefined
        };
        const active = document.querySelector('#worldgen-active');
        if (active) active.innerHTML = '<p class="small muted">Generating…</p>';
        try {
          const plan = await api('/api/world/generate', { method: 'POST', body });
          if (active) active.innerHTML = worldgenPlanHtml(plan);
          bindWorldgenPlanButtons();
          loadWorldgenPreview(plan.id);
          toast(`Preview generated: ${(plan.nations || []).length} power(s).`);
        } catch (err) {
          if (active) active.innerHTML = '';
          toast(err.message, true);
        }
      };
    }
    document.querySelectorAll('[data-worldgen-view]').forEach(b => {
      b.onclick = async () => {
        const active = document.querySelector('#worldgen-active');
        if (active) active.innerHTML = '<p class="small muted">Loading…</p>';
        try {
          const plan = await api(`/api/world/generations/${b.dataset.worldgenView}`);
          if (active) {
            active.innerHTML = worldgenPlanHtml(plan);
            active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
          bindWorldgenPlanButtons();
          loadWorldgenPreview(plan.id);
        } catch (err) { toast(err.message, true); }
      };
    });
  }

  /* The Foreign Office. Appointed by the government, dismissable by it, and
     holding no power to bind — which is what the note under the name says,
     because a player looking at a minister needs to know that immediately. */
  function foreignOffice(fo, canAppoint, isMinister, powers) {
    if (!fo) return '';
    const by = fo.appointer === 'prime_minister' ? 'Prime Minister' : 'President';
    return `<section class="card">
      <div class="dip-section-head">
        <span class="dip-section-kicker">The Foreign Office</span>
        <h2>Foreign Minister</h2>
      </div>
      <p style="font-size:1.1rem;font-weight:650;margin:10px 0 4px">${esc(fo.minister?.display_name || 'Vacant')}</p>
      <p class="small muted">Appointed by the ${esc(by)} and dismissable by them. Holds the channel to foreign governments, and binds nothing: treaties, recognition and emergencies all arrive as bills, and the House votes on every one.${
        fo.minister ? '' : ' While the office is empty the President speaks for the Republic.'
      }</p>
      ${exportButtonsHtml()}
      ${
        canAppoint || isMinister
          ? `<div class="row" style="margin-top:14px;gap:8px;flex-wrap:wrap">
        ${
          canAppoint
            ? `<form id="fo-appoint" class="row" style="gap:8px;flex:1;min-width:240px">
          <select name="user_id" style="flex:1"></select>
          <button class="btn btn-sm btn-primary">${fo.minister ? 'Replace' : 'Appoint'}</button>
        </form>`
            : ''
        }
        ${fo.minister ? `<button class="btn btn-sm" data-fo-dismiss="1">${isMinister ? 'Resign' : 'Dismiss'}</button>` : ''}
      </div>`
          : ''
      }
    </section>`;
  }

  async function bindForeignOffice() {
    const form = document.querySelector('#fo-appoint');
    if (form) {
      try {
        const cs = await api('/api/citizens');
        form.user_id.innerHTML = cs
          .map(c => `<option value="${c.id}">${esc(c.display_name)}${(c.offices || []).length ? ` — ${esc(officeList(c.offices, ', '))}` : ''}</option>`)
          .join('');
      } catch {}
      form.onsubmit = async ev => {
        ev.preventDefault();
        try {
          await api('/api/diplomacy/foreign-office/appoint', { method: 'POST', body: { user_id: Number(ev.target.user_id.value) } });
          viewDiplomacy();
        } catch (err) { toast(err.message, true); }
      };
    }
    document.querySelectorAll('[data-fo-dismiss]').forEach(b => {
      b.onclick = async () => {
        try {
          await api('/api/diplomacy/foreign-office/dismiss', { method: 'POST' });
          viewDiplomacy();
        } catch (err) { toast(err.message, true); }
      };
    });
  }

  async function viewDiplomacy() {
    const box = document.querySelector('#view');
    const me = ME();
    const isPresident = !!me?.offices?.includes('president');
    const isSpeaker = !!me?.offices?.includes('speaker');
    const isMinister = !!me?.offices?.includes('foreign_minister');
    const [powers, dispatches, treaties, offers, conflicts, balance, adminPowers, world, fo, republicTerritoryAdmin, govCatalogue, worldgenGens, exportDesk, foreignIntel, crises, shipments, bilateral, privateCables, ambassadors] = await Promise.all([
      api('/api/diplomacy/powers'),
      api('/api/diplomacy/dispatches'),
      api('/api/diplomacy/treaties'),
      api('/api/diplomacy/offers'),
      api('/api/diplomacy/conflicts'),
      api('/api/diplomacy/balance'),
      me?.is_admin ? api('/api/admin/foreign/powers') : Promise.resolve([]),
      api('/api/diplomacy/map').catch(() => null),
      api('/api/diplomacy/foreign-office').catch(() => null),
      me?.is_admin ? api('/api/admin/republic/territories').catch(() => ({ subdivisions: [], legacy_territories: [] })) : Promise.resolve(null),
      /* Catches rather than throws: an older server has no archetypes route and
         the whole Diplomacy page should not go blank because of it. */
      me?.is_admin ? api('/api/admin/foreign/archetypes').catch(() => ({ archetypes: [], strengths: {}, default_agent: null })) : Promise.resolve(null),
      /* Same reasoning: an older server has no world generator at all. */
      me?.is_admin ? api('/api/world/generations').catch(() => ({ generations: [] })) : Promise.resolve(null),
      me ? api('/api/diplomacy/export-desk').catch(() => null) : Promise.resolve(null),
      me ? api('/api/diplomacy/foreign-intelligence').catch(() => null) : Promise.resolve(null),
      api('/api/diplomacy/crises').catch(() => []),
      api('/api/diplomacy/shipments').catch(() => []),
      api('/api/diplomacy/bilateral').catch(() => ({ agreements: [], conflicts: [] })),
      me ? api('/api/diplomacy/private').catch(() => null) : Promise.resolve(null),
      me ? api('/api/diplomacy/eligible-ambassadors').catch(() => null) : Promise.resolve(null)
    ]);
    /* Before the map is drawn, not while. The renderer is synchronous and
       returns a string, so anything it needs has to be in hand first. */
    await loadSubdivisions(subdivisionCodesIn(world)).catch(() => {});
    /* The channel belongs to the Foreign Minister. The President keeps it only
       while that office is empty — they assent to treaties, and negotiating
       what you then assent to is one person doing both halves. */
    const canDiplomat = isMinister || (isPresident && !fo?.minister) || isSpeaker;
    const canAppointMinister = !!me?.offices?.includes(fo?.appointer || 'president');
    const standing = p =>
      `<span class="tag">${esc(p.standing)}</span>${p.recognised ? '<span class="tag on-green">recognised</span>' : '<span class="tag">unrecognised</span>'}`;
    const kindLabel = k =>
      ({
        dispatch: 'Dispatch',
        treaty_proposal: 'Treaty proposal',
        trade_proposal: 'Trade proposal',
        ultimatum: 'Ultimatum',
        other: 'Other'
      })[k] || 'Dispatch';
    const goodLabel = k =>
      ({
        food: 'Food',
        raw_materials: 'Raw materials',
        energy: 'Energy',
        industrial_goods: 'Industrial goods',
        technology: 'Technology',
        arms: 'Arms',
        luxury: 'Luxury',
        services: 'Services'
      })[k] || '';
    const treatyTermLabel = (key, value) => {
      const labels = {
        trade_open: 'Open trade', tariff_free: 'Tariff-free', tariff_rate: 'Tariff', export_cap: 'Export cap',
        non_aggression: 'Non-aggression', mutual_defence: 'Mutual defence', military_access: 'Military access',
        intelligence_sharing: 'Intelligence sharing', extradition: 'Extradition', offshore_disclosure: 'Offshore disclosure',
        arms_embargo: 'Arms embargo', technology_embargo: 'Technology embargo', territorial_guarantee: 'Territorial guarantee',
        foreign_aid_per_cycle: 'Foreign aid / cycle', loan_repayment_per_cycle: 'Loan repayment / cycle',
        currency_swap_limit: 'Currency swap limit', tribute_per_cycle: 'Tribute / cycle'
      };
      if (!labels[key] || key === 'idempotency_key' || value === false || value == null || value === '') return '';
      if (typeof value === 'boolean') return labels[key];
      if (key === 'tariff_rate') return `${labels[key]} ${(Number(value) * 100).toFixed(1)}%`;
      return `${labels[key]} ${Number.isFinite(Number(value)) ? Number(value).toLocaleString() : value}`;
    };
    const treatyTerms = terms => Object.entries(terms || {}).map(([k, v]) => treatyTermLabel(k, v)).filter(Boolean);
    const activeAdminPowers = adminPowers.filter(p => !p.revoked_at);
    const messageForm =
      canDiplomat && powers.length
        ? `<section class="card dip-compose">
      <div class="dip-section-kicker">Government channel · outgoing cable</div>
      <h2>Official government diplomacy</h2>
      <p class="small muted">Send plaintext to a foreign government. This is negotiation only: a treaty proposal does not become law until a formal treaty is agreed and goes through the Republic's constitutional process.</p>
      <form id="official-foreign-message" class="stack">
        <div class="grid2"><label class="field"><span>Foreign power</span><select name="power_id">${powers.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Message type</span><select name="message_kind"><option value="dispatch">Dispatch</option><option value="treaty_proposal">Treaty proposal</option><option value="trade_proposal">Trade proposal</option><option value="ultimatum">Ultimatum</option><option value="other">Other</option></select></label></div>
        <label class="field"><span>Subject</span><input name="subject" maxlength="200" required></label>
        <label class="field"><span>Plaintext message</span><textarea name="body" maxlength="4000" rows="7" required></textarea></label>
        ${isSpeaker && !isPresident ? `<label class="field"><span>Enacted House resolution bill ID</span><input name="resolution_bill_id" type="number" min="1" required><span class="small muted">The Speaker may send official diplomacy only under an enacted House motion.</span></label>` : ''}
        <button class="btn btn-primary">Send official message</button>
      </form></section>`
        : '';

    const exportSources = exportDesk
      ? [
          ...(exportDesk.listings || []).map(x => ({
            kind: 'listing',
            id: x.id,
            title: `${x.business_name} — ${x.title}`,
            detail: x.stock === null || x.stock === undefined ? `unlimited · ${x.unit || 'unit'}` : `${Number(x.stock).toLocaleString()} × ${x.unit || 'unit'}`,
            category: goodLabel(x.good_category)
          })),
          ...(exportDesk.inventory || []).map(x => ({
            kind: 'inventory',
            id: x.id,
            title: x.title,
            detail: `${Number(x.quantity).toLocaleString()} × ${x.unit || 'unit'} in your inventory`,
            category: goodLabel(x.good_category)
          }))
        ]
      : [];
    const exportDeskHtml = !me || !exportDesk
      ? ''
      : `<section class="dip-section"><div class="dip-section-head"><span class="dip-section-kicker">Direct commercial channel</span><h2>Targeted exports</h2></div>
        ${exportDesk.enabled
          ? `<p class="small muted">Reserve strategic goods and offer them directly to one foreign government at a price in that government's own currency. The goods return to you if the offer is rejected or cancelled.</p>
            ${(exportDesk.powers || []).length && exportSources.length ? `<form id="targeted-export-form" class="stack">
              <div class="grid2"><label class="field"><span>Foreign power</span><select name="power_id" id="targeted-export-power">${exportDesk.powers.map(p => `<option value="${p.id}" data-code="${esc(p.currency_code || '')}">${esc(p.name)} · ${esc(p.currency_code || '')}</option>`).join('')}</select></label>
              <label class="field"><span>Goods</span><select name="source" id="targeted-export-source">${exportSources.map(x => `<option value="${x.kind}:${x.id}">${esc(x.title)} · ${esc(x.category || 'Strategic good')} · ${esc(x.detail)}</option>`).join('')}</select></label></div>
              <div class="grid2"><label class="field"><span>Quantity</span><input name="quantity" type="number" min="1" step="1" value="1" required></label><label class="field"><span>Price per unit <span id="targeted-export-code" class="muted"></span></span><input name="unit_price" type="number" min="0" step="1" required></label></div>
              <label class="field"><span>Note to the buyer</span><textarea name="note" rows="3" maxlength="1200" placeholder="Optional commercial terms or reason for the offer"></textarea></label>
              <button class="btn btn-primary">Send targeted export offer</button>
            </form>` : '<p class="small muted">You need both strategic goods to sell and a recognised foreign power with an open trade treaty.</p>'}
            <div class="list" style="margin-top:12px">${(exportDesk.offers || []).length ? exportDesk.offers.map(o => {
              const total = Number(o.unit_price || 0) * Number(o.quantity || 0);
              const markValue = Number(o.currency_rate) > 0 ? Math.ceil(total / Number(o.currency_rate)) : null;
              return `<div class="item"><div class="item-top"><span class="item-title">${esc(o.title)} → ${esc(o.power_name)}</span><span class="tag ${o.status === 'accepted' ? 'on-green' : o.status === 'rejected' || o.status === 'cancelled' ? 'on-oxide' : ''}">${esc(String(o.status || '').replace(/(^|\s)\S/g, m => m.toUpperCase()))}</span></div><p class="small muted">${Number(o.quantity).toLocaleString()} × ${esc(o.unit || 'unit')} · ${Number(o.unit_price).toLocaleString()} ${esc(o.currency_code || '')} each · ${total.toLocaleString()} ${esc(o.currency_code || '')} total${markValue === null ? '' : ` · about ${cash(markValue)} at the current rate`}</p>${o.note ? `<p>${esc(o.note)}</p>` : ''}${o.status === 'pending' ? `<button class="btn btn-sm" data-cancel-export="${o.id}">Cancel and return goods</button>` : ''}</div>`;
            }).join('') : '<p class="small muted">No targeted export offers yet.</p>'}</div>`
          : '<p class="small muted">Targeted exports become available when the strategic-goods economy is enabled.</p>'}
      </section>`;

    const pendingSpyApproaches = (foreignIntel?.recruitments || []).filter(r => r.status === 'pending');
    const pendingTurnApproaches = (foreignIntel?.turn_offers || []).filter(r => r.status === 'pending');
    const foreignIntelHtml = !me || !foreignIntel
      ? ''
      : `<section class="dip-section"><div class="dip-section-head"><span class="dip-section-kicker">Private channel</span><h2>Foreign intelligence</h2></div>
        <p class="small muted">A foreign government can approach you whether you remain a Republic citizen or have defected. You become its agent only if you accept. Recruitment and your operation reports are visible here only to you.</p>
        ${pendingSpyApproaches.length ? `<h3>Recruitment approaches</h3><div class="list">${pendingSpyApproaches.map(r => `<div class="item"><div class="item-top"><span class="item-title">${esc(r.power_name)} · codename ${esc(r.codename)}</span><span class="tag on-violet">Pending</span></div><p>${esc(r.pitch)}</p><p class="small muted">Signing bonus: ${Number(r.signing_bonus || 0).toLocaleString()} ${esc(r.currency_code || '')}${r.currency_rate ? ` · current rate ${Number(r.currency_rate).toFixed(3)} per ${esc(STATE().config.currency_name || 'Mark')}` : ''}</p><div class="row"><button class="btn btn-primary btn-sm" data-spy-recruit="${r.id}" data-accept="1">Accept</button><button class="btn btn-sm" data-spy-recruit="${r.id}" data-accept="0">Decline</button></div></div>`).join('')}</div>` : '<p class="small muted">No foreign service is currently approaching you.</p>'}
        ${(foreignIntel.agents || []).length ? `<h3>Your foreign-agent roles</h3><div class="list">${foreignIntel.agents.map(a => `<div class="item"><div class="item-top"><span class="item-title">${esc(a.power_name)} · ${esc(a.codename)}</span><span class="tag ${a.status === 'active' ? 'on-green' : ''}">${esc(String(a.status || '').replace(/(^|\s)\S/g, m => m.toUpperCase()))}</span></div><p class="small muted">Experience ${Number(a.experience || 0)}${a.status === 'active' ? ` · <button class="btn btn-sm" data-spy-resign="${a.id}">Resign as agent</button>` : ''}</p></div>`).join('')}</div>` : ''}
        ${(foreignIntel.operations || []).length ? `<h3>Operations involving you</h3><div class="list">${foreignIntel.operations.map(o => `<div class="item"><div class="item-top"><span class="item-title">${esc(o.power_name)} · ${esc(String(o.kind || '').replaceAll('_', ' ').replace(/(^|\s)\S/g, m => m.toUpperCase()))}</span><span class="tag ${o.outcome === 'success' ? 'on-green' : 'on-oxide'}">${esc(String(o.outcome || '').replace(/(^|\s)\S/g, m => m.toUpperCase()))}</span></div><p>${esc(o.report || '')}</p><p class="small muted">Budget ${Number(o.budget || 0).toLocaleString()} ${esc(o.currency_code || '')} · score ${Number(o.score || 0)} / threshold ${Number(o.threshold || 0)}${o.detected ? ' · detected' : ''}${o.attributed ? ' · attributed' : ''} · cycle ${Number(o.cycle_no || 0)}</p></div>`).join('')}</div>` : ''}
        ${pendingTurnApproaches.length ? `<h3>Republic counter-intelligence approaches</h3><div class="list">${pendingTurnApproaches.map(t => `<div class="item"><div class="item-top"><span class="item-title">Codename ${esc(t.codename)} · ${esc(t.power_name)}</span><span class="tag on-violet">Double-agent approach</span></div><p>${esc(t.pitch)}</p><p class="small muted">Accepting secretly marks this foreign role as a Republic double agent.</p><div class="row"><button class="btn btn-primary btn-sm" data-spy-turn="${t.id}" data-accept="1">Accept</button><button class="btn btn-sm" data-spy-turn="${t.id}" data-accept="0">Decline</button></div></div>`).join('')}</div>` : ''}
      </section>`;

    const embassyHtml = !canDiplomat
      ? ''
      : `<section class="dip-section"><div class="dip-section-head"><span class="dip-section-kicker">Embassies · sealed traffic</span><h2>Private diplomacy</h2></div>
        <p class="small muted">Private cables require an open embassy. They remain sealed unless deliberately leaked or exposed by intelligence.</p>
        <div class="grid2"><form id="embassy-form" class="stack"><label class="field"><span>Foreign power</span><select name="power_id">${powers.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><label class="field"><span>Embassy status</span><select name="status"><option value="open">Open</option><option value="closed">Close</option><option value="recalled">Recall ambassador</option><option value="expelled">Expel mission</option></select></label><label class="field"><span>Republic ambassador</span><select name="republic_ambassador_user_id"><option value="">No change / none</option>${(ambassadors || []).map(a => `<option value="${a.id}">${esc(a.display_name)}</option>`).join('')}</select></label>${isSpeaker && !isPresident ? `<label class="field"><span>Enacted House resolution bill ID</span><input name="resolution_bill_id" type="number" min="1" required></label>` : ''}<button class="btn">Update embassy</button></form>
        <form id="private-cable-form" class="stack"><label class="field"><span>Foreign power</span><select name="power_id">${powers.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><label class="field"><span>Subject</span><input name="subject" maxlength="200" required></label><label class="field"><span>Sealed cable</span><textarea name="body" rows="5" maxlength="4000" required></textarea></label>${isSpeaker && !isPresident ? `<label class="field"><span>Enacted House resolution bill ID</span><input name="resolution_bill_id" type="number" min="1" required></label>` : ''}<button class="btn btn-primary">Send private cable</button></form></div>
        <div class="list" style="margin-top:12px">${(privateCables || []).length ? privateCables.slice(0,20).map(d => `<div class="item"><div class="item-top"><span class="item-title">${d.direction === 'outgoing' ? 'Republic →' : '←'} ${esc(d.power_name)} · ${esc(d.subject)}</span><span class="tag ${d.leaked_at ? 'on-oxide' : 'on-violet'}">${d.leaked_at ? 'Leaked' : 'Sealed'}</span></div><p>${esc(d.body)}</p><p class="small muted">${d.author_name ? `Authorised by ${esc(d.author_name)} · ` : ''}${new Date(d.created_at).toLocaleString()}</p></div>`).join('') : '<p class="muted">No private cables.</p>'}</div></section>`;

    const crisisHtml = `<section class="dip-section dip-alerts"><div class="dip-section-head"><span class="dip-section-kicker">Deadline diplomacy</span><h2>Diplomatic crises</h2></div><div class="list">${crises.length ? crises.map(c => `<div class="item"><div class="item-top"><span class="item-title">${esc(c.power_name)} · ${esc(c.title)}</span><span class="tag ${c.status === 'settled' ? 'on-green' : c.status === 'failed' ? 'on-oxide' : 'on-violet'}">${esc(String(c.status || '').replaceAll('_',' '))}</span></div><p><strong>Demand:</strong> ${esc(c.demand || '')}</p>${c.republic_offer ? `<p><strong>Republic offer:</strong> ${esc(c.republic_offer)}</p>` : ''}${c.foreign_reply ? `<p><strong>Foreign reply:</strong> ${esc(c.foreign_reply)}</p>` : ''}<p class="small muted">${c.deadline_cycle == null ? 'No deadline' : `Deadline cycle ${Number(c.deadline_cycle)}`}</p>${canDiplomat && ['open','offered'].includes(c.status) ? `<button class="btn btn-sm" data-crisis-offer="${c.id}">Make / revise negotiated offer</button>` : ''}</div>`).join('') : '<p class="muted">No active or recorded crises.</p>'}</div></section>`;

    const bilateralHtml = `<section class="dip-section"><div class="dip-section-head"><span class="dip-section-kicker">World system</span><h2>Foreign-to-foreign relations</h2></div>
      <h3>Agreements</h3><div class="list">${(bilateral?.agreements || []).length ? bilateral.agreements.map(a => `<div class="item"><div class="item-top"><span class="item-title">${esc(a.proposer_name)} ↔ ${esc(a.counterparty_name)}</span><span class="tag on-green">${esc(String(a.kind || '').replaceAll('_',' '))}</span></div><p>${esc(a.title)}</p></div>`).join('') : '<p class="muted">No active foreign-to-foreign agreements.</p>'}</div>
      <h3>Conflicts</h3><div class="list">${(bilateral?.conflicts || []).length ? bilateral.conflicts.map(c => `<div class="item"><div class="item-top"><span class="item-title">${esc(c.aggressor_name)} → ${esc(c.target_name)}</span><span class="tag on-oxide">${esc(c.kind)}</span></div><p>${esc(c.grievance)}</p>${c.demands ? `<p class="small muted">Demand: ${esc(c.demands)}</p>` : ''}</div>`).join('') : '<p class="muted">No active conflicts between foreign powers.</p>'}</div></section>`;

    const shipmentsHtml = `<section class="dip-section"><div class="dip-section-head"><span class="dip-section-kicker">Trade routes</span><h2>International shipments</h2></div><div class="list">${shipments.length ? shipments.slice(0,40).map(s => {
      const origin = s.origin_name || (s.republic_direction === 'export' ? 'Republic' : 'Unknown');
      const destination = s.destination_name || (s.republic_direction === 'import' ? 'Republic' : 'Unknown');
      return `<div class="item"><div class="item-top"><span class="item-title">${esc(origin)} → ${esc(destination)} · ${esc(s.title)}</span><span class="tag ${s.status === 'arrived' ? 'on-green' : ['seized','lost'].includes(s.status) ? 'on-oxide' : ''}">${esc(String(s.status || '').replaceAll('_',' '))}</span></div><p class="small muted">${Number(s.quantity).toLocaleString()} ${esc(s.unit || 'unit')} · ${goodLabel(s.good_category) ? esc(goodLabel(s.good_category)) : 'Goods'} · departed cycle ${Number(s.departed_cycle)} · ETA cycle ${Number(s.eta_cycle)} · route risk ${Number(s.risk || 0)}%</p></div>`;
    }).join('') : '<p class="muted">No international shipments yet.</p>'}</div></section>`;

    box.innerHTML = `<div class="diplomacy-office">
      <header class="dip-head"><div><p class="dip-head-code">FOREIGN OFFICE · DIPLOMATIC NETWORK</p><h1>Diplomacy</h1><p class="muted">Official diplomacy remains on the public record; recognised states may also maintain sealed embassy channels whose existence and leaks can carry political consequences.</p></div><div class="dip-signal" aria-hidden="true"><span></span><span></span><span></span></div></header>
      ${worldMap(world)}

      ${messageForm}

      ${foreignOffice(fo, canAppointMinister, isMinister, powers)}

      <section class="dip-section"><div class="dip-section-head"><span class="dip-section-kicker">Recognised contacts</span><h2>Powers</h2></div><div class="list dip-powers">${powers.length ? powers.map(p => `<div class="item"><div class="item-top"><span class="item-title"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(p.colour)};margin-right:7px"></span>${esc(p.name)}</span><span>${standing(p)}</span></div><div class="row"><button class="btn btn-sm" data-dossier="${p.id}">Open country dossier</button>${me && !p.recognised ? `<button class="btn btn-sm" data-recognise="${p.id}">Move recognition</button>` : ''}${me && p.recognised ? `<button class="btn btn-sm" data-sanction="${p.id}" data-power-name="${esc(p.name)}">Move sanctions</button>` : ''}</div></div>`).join('') : '<p class="muted">No foreign powers.</p>'}</div><div id="country-dossier" style="margin-top:12px"></div></section>

      <section class="dip-section dip-correspondence"><div class="dip-section-head"><span class="dip-section-kicker">Cable traffic · public record</span><h2>Diplomatic correspondence</h2></div><div class="dip-thread">${
        dispatches.length
          ? dispatches
              .slice(0, 50)
              .map(
                d =>
                  `<article class="dip-message ${d.direction === 'outgoing' ? 'is-republic' : 'is-foreign'} ${d.in_reply_to ? 'is-reply' : ''}"><div class="dip-message-route"><span class="dip-route-mark">${d.direction === 'outgoing' ? 'R' : 'F'}</span><div><span class="dip-sender">${d.direction === 'outgoing' ? 'Republic Foreign Office' : esc(d.power_name)}</span><span class="dip-route-detail">${d.direction === 'outgoing' ? `To ${esc(d.power_name)}` : 'To the Republic'}</span></div><span class="dip-message-id">#${d.id}</span></div><div class="dip-message-head"><h3>${esc(d.subject)}</h3><div class="dip-message-tags"><span class="tag ${d.message_kind === 'ultimatum' ? 'on-oxide' : d.message_kind === 'treaty_proposal' ? 'on-violet' : d.message_kind === 'trade_proposal' ? 'on-green' : ''}">${kindLabel(d.message_kind)}</span><span class="tag">${d.direction}</span></div></div><p class="dip-meta">${d.in_reply_to ? `In reply to cable #${d.in_reply_to}` : 'New diplomatic thread'}${d.author_name ? ` · authorised by ${esc(d.author_name)}` : ''}</p><div class="dip-message-body">${esc(d.body).replace(/\n/g, '<br>')}</div>${canDiplomat ? `<div class="dip-message-actions"><button class="btn btn-sm" data-reply="${d.id}" data-reply-kind="${esc(d.message_kind || 'dispatch')}" data-reply-subject="${esc(d.subject)}">Reply on this channel</button></div>` : ''}</article>`
              )
              .join('')
          : '<p class="muted">No dispatches.</p>'
      }</div></section>

      <div class="dip-grid">
        <section class="dip-section"><div class="dip-section-head"><span class="dip-section-kicker">Ratification desk</span><h2>Treaties</h2></div><div class="list">${treaties.length ? treaties.map(t => { const terms=treatyTerms(t.terms); return `<div class="item"><div class="item-top"><span class="item-title">${esc(t.title)}</span><span class="tag">${esc(t.republic_status)}</span></div><p class="small muted">${esc(t.power_name)} · ${esc(t.bill_ref || '')}</p>${terms.length ? `<p>${terms.map(x => `<span class="tag">${esc(x)}</span>`).join(' ')}</p>` : ''}</div>`; }).join('') : '<p class="muted">No treaties.</p>'}</div></section>
        <section class="dip-section"><div class="dip-section-head"><span class="dip-section-kicker">Commercial attaché</span><h2>Foreign market</h2></div><div class="list">${offers.length ? offers.map(o => {
          const localPrice = Number(o.local_price ?? o.price) || 0;
          const price = Number(o.mark_price ?? localPrice) || 0;
          const tax = Number(o.tariff ?? 0) || 0;
          const total = Number(o.total_mark_price ?? (price + tax)) || (price + tax);
          const tariffRate = Number(o.tariff_rate ?? 0) || 0;
          const code = o.currency_code || '';
          const category = goodLabel(o.good_category);
          const stock = o.stock === null || o.stock === undefined ? 'No stock limit' : `${Number(o.stock).toLocaleString()} in stock`;
          const unit = o.unit ? ` · per ${esc(o.unit)}` : '';
          return `<div class="item"><div class="item-top"><span class="item-title">${esc(o.title)} · ${esc(o.power_name)}</span><span class="money">${code ? `${localPrice.toLocaleString()} ${esc(code)}` : cash(price)}</span></div>
            ${(category || o.unit || (o.stock !== null && o.stock !== undefined)) ? `<p class="small muted">${category ? `<span class="tag">${esc(category)}</span> ` : ''}${esc(stock)}${unit}</p>` : ''}
            ${o.description ? `<p>${esc(o.description)}</p>` : ''}
            <p class="small muted">${code && o.currency_rate ? `1 ${esc(STATE().config.currency_name || 'Mark')} = ${Number(o.currency_rate).toFixed(3)} ${esc(code)} · ` : ''}${cash(price)} at the current rate${tax ? ` + ${cash(tax)} import tariff (${(tariffRate * 100).toFixed(1)}%)` : ' · no import tariff'} · <strong>${cash(total)} total</strong></p>
            ${me ? `<button class="btn btn-sm" data-foreign-buy="${o.id}">Buy</button>` : ''}</div>`;
        }).join('') : '<p class="muted">No foreign offers.</p>'}</div></section>
      </div>

      <div class="dip-grid">
        <section class="dip-section dip-alerts"><div class="dip-section-head"><span class="dip-section-kicker">Alerts & declarations</span><h2>Conflicts</h2></div><div class="list">${conflicts.length ? conflicts.map(c => `<div class="item"><div class="item-top"><span class="item-title">${esc(c.power_name)} · ${esc(c.kind)}</span><span class="tag on-oxide">${esc(c.status)}</span></div><p>${esc(c.grievance)}</p>${me?.is_admin && c.status !== 'resolved' ? `<button class="btn btn-sm" data-resolve-conflict="${c.id}">Record resolution</button>` : ''}</div>`).join('') : '<p class="muted">No conflicts.</p>'}</div></section>
        <section class="dip-section"><div class="dip-section-head"><span class="dip-section-kicker">Economic desk</span><h2>Balance of trade</h2></div><div class="list">${balance.map(b => `<div class="item"><div class="item-top"><span class="item-title">${esc(b.name)}</span><span class="money">net ${cash(b.net)}</span></div>
          <div class="dip-ledger">
            <div class="dip-ledger-cell"><span>Buying power</span><strong>${cash(b.buying_power_marks ?? b.purse ?? 0)}</strong><span class="dip-ledger-note">Mark reserves + local treasury at the current FX rate</span></div>
            <div class="dip-ledger-cell"><span>Their Mark reserve</span><strong>${cash(b.mark_reserve ?? 0)}</strong></div>
            <div class="dip-ledger-cell"><span>Local treasury</span><strong>${Number(b.local_treasury || 0).toLocaleString()} ${esc(b.currency_code || '')}</strong></div>
            <div class="dip-ledger-cell"><span>Our FX reserve</span><strong>${Number(b.republic_reserve || 0).toLocaleString()} ${esc(b.currency_code || '')}</strong></div>
            <div class="dip-ledger-cell is-surplus"><span>Our exports</span><strong>${cash(b.exports)}</strong></div>
            <div class="dip-ledger-cell is-deficit"><span>Our imports</span><strong>${cash(b.imports)}</strong></div>
          </div>
          ${b.currency_code ? `<p class="small muted" style="margin-top:8px">1 ${esc(STATE().config.currency_name || 'Mark')} = ${Number(b.currency_rate || 0).toFixed(3)} ${esc(b.currency_code)} · supply ${Number(b.local_supply || 0).toLocaleString()} · domestic circulation ${Number(b.local_circulation || 0).toLocaleString()}${b.monetary_actions?.length ? ` · latest: ${esc(b.monetary_actions[0].kind === 'issue' ? 'printed' : 'distributed')} ${Number(b.monetary_actions[0].amount).toLocaleString()} ${esc(b.currency_code)} — ${esc(b.monetary_actions[0].reason || '')}` : ''}</p>` : ''}
          ${b.export_cap ? `<div class="dip-allowance ${Number(b.spent_this_cycle) >= Number(b.export_cap) ? 'is-spent' : ''}"><span style="width:${Math.min(100, Math.round((Number(b.spent_this_cycle) / Number(b.export_cap)) * 100))}%"></span></div>
          <span class="dip-ledger-note">${b.spent_this_cycle} of ${b.export_cap} spent buying from us this cycle</span>` : ''}</div>`).join('')}</div></section>
      </div>

      ${embassyHtml}
      <div class="dip-grid">${crisisHtml}${bilateralHtml}</div>
      ${shipmentsHtml}
      ${exportDeskHtml}
      ${foreignIntelHtml}

      ${
        me?.is_admin
          ? `<section class="dip-ro"><div class="dip-ro-head"><span class="dip-section-kicker">Restricted operations console</span><h2>Returning Officer — foreign powers</h2></div><p class="small muted">Operational control of foreign powers and their LLM governments. Recognition and treaties still follow the Republic's political rules. Every change made here is written to the public record.</p>
        ${republicTerritoryPicker(world, republicTerritoryAdmin)}
        <div class="card dip-ro-console"><label class="field"><span>Manage power</span><select id="ro-power-select">${adminPowers.map(p => `<option value="${p.id}">${esc(p.name)}${p.revoked_at ? ' (revoked)' : ''}</option>`).join('')}</select></label><div id="ro-power-panel"></div></div>
        <details class="card dip-ro-create" open><summary><strong>Create a foreign power</strong></summary><form id="newpower" class="stack" style="margin-top:12px"><p class="small muted">A name, a government and a rough strength is the whole of it. The cabinet, its ministers and their instructions come with the archetype, and the models are configured for you${govCatalogue?.default_agent ? ` — this server will use <strong>${esc(govCatalogue.default_agent.provider)}</strong>` : ''}. Everything below the button is optional.</p><div class="grid2"><label class="field"><span>Power name</span><input name="name" required></label><label class="field"><span>Government</span><select name="archetype" id="newpower-archetype">${(govCatalogue?.archetypes || []).map(a => `<option value="${esc(a.id)}">${esc(a.label)}</option>`).join('')}<option value="">(no government — configure by hand)</option></select></label></div><label class="field"><span>Rough strength</span><select name="strength">${Object.entries(govCatalogue?.strengths || {}).map(([k, v]) => `<option value="${esc(k)}" ${k === 'matched' ? 'selected' : ''}>${esc(k)} (${v})</option>`).join('')}</select></label><p class="small muted" id="newpower-blurb"></p><button class="btn btn-primary">Create power</button><details><summary class="small muted">Appearance and standing</summary><div class="grid2" style="margin-top:8px"><label class="field"><span>Adjective</span><input name="adjective"></label><label class="field"><span>Colour</span><input name="colour" type="color" value="#5B2E9E"></label></div><label class="field"><span>Standing</span><select name="standing"><option>neutral</option><option>friendly</option><option>allied</option><option>strained</option><option>hostile</option><option>at_war</option></select></label></details><div id="newpowerkey"></div></form></details>
        ${worldgenGens ? worldgenSectionHtml(worldgenGens) : ''}
      </section>`
          : ''
      }
    </div>`;

    bindWorldMap(world);
    bindForeignOffice();
    bindExportButtons();

    const renderDossier = d => {
      const target = document.querySelector('#country-dossier');
      if (!target || !d?.power) return;
      const r = d.relationship || {};
      const metrics = [['Trust',r.trust],['Fear',r.fear],['Respect',r.respect],['Grievance',r.grievance],['Trade dependency',r.trade_dependency],['Ideological affinity',r.ideological_affinity]];
      const cur=d.currency || {};
      const production=d.foreign_economy?.production || [], stock=d.foreign_economy?.stockpile || [];
      const stockFor=k=>Number(stock.find(x=>x.good_category===k)?.quantity||0);
      const sanctionsAndConflicts=[
        ...(d.republic_sanctions||[]).filter(x=>x.active).map(x=>`<div class="item"><span class="tag on-oxide">Republic sanctions</span> <strong>${esc(x.bill_ref||'')}</strong><p class="small muted">${esc(JSON.stringify(x.measures||{}))}</p>${me ? `<button class="btn btn-sm" data-lift-sanction="${x.id}">Move to lift</button>`:''}</div>`),
        ...(d.conflicts||[]).map(c=>`<div class="item"><span class="tag on-oxide">${esc(c.kind)}</span> ${esc(c.grievance)}${c.measures && Object.keys(c.measures).length ? `<p class="small muted">Measures: ${esc(JSON.stringify(c.measures))}</p>`:''}</div>`)
      ];
      const bilateralPosition=[
        ...(d.bilateral_agreements||[]).map(a=>`<div class="item">${esc(a.proposer_name)} ↔ ${esc(a.counterparty_name)} · <span class="tag on-green">${esc(a.kind.replaceAll('_',' '))}</span> ${esc(a.title)}</div>`),
        ...(d.bilateral_conflicts||[]).filter(c=>c.status==='open').map(c=>`<div class="item">${esc(c.aggressor_name)} → ${esc(c.target_name)} · <span class="tag on-oxide">${esc(c.kind)}</span> ${esc(c.grievance)}</div>`)
      ];
      target.innerHTML=`<article class="card"><div class="item-top"><div><span class="dip-section-kicker">Country dossier</span><h2 style="margin:4px 0">${esc(d.power.name)}</h2></div><span>${standing(d.power)}</span></div>
        ${d.power.persona ? `<p>${esc(d.power.persona)}</p>` : ''}
        <h3>Relationship</h3><div class="grid2">${metrics.map(([k,v])=>`<div class="item"><span class="small muted">${k}</span><div><strong>${Number(v||0)}</strong></div></div>`).join('')}</div>
        <h3>Government & embassy</h3><p>${(d.ministers||[]).length ? d.ministers.map(m=>`${esc(m.role.replaceAll('_',' '))}: <strong>${esc(m.display_name)}</strong>`).join(' · ') : 'No cabinet data.'}</p><p class="small muted">Embassy: ${esc(String(d.embassy?.status||'closed').replaceAll('_',' '))}${d.embassy?.foreign_ambassador_name ? ` · foreign ambassador ${esc(d.embassy.foreign_ambassador_name)}` : ''}</p>
        <h3>Currency & economy</h3>${cur.code ? `<p><strong>1 ${esc(STATE().config.currency_name || 'Mark')} = ${Number(cur.rate||0).toFixed(3)} ${esc(cur.code)}</strong> · treasury ${Number(cur.treasury_balance||0).toLocaleString()} · circulation ${Number(cur.circulation||0).toLocaleString()} · supply ${Number(cur.money_supply||0).toLocaleString()} · their Mark reserve ${cash(cur.republic_mark_reserve||0)} · our reserve ${Number(cur.republic_reserve||0).toLocaleString()} ${esc(cur.code)}</p>` : '<p class="muted">No currency data.</p>'}
        <div class="list">${production.map(x=>`<div class="item"><div class="item-top"><span class="item-title">${esc(goodLabel(x.good_category)||x.good_category)}</span><span class="tag">${stockFor(x.good_category).toLocaleString()} stock</span></div><p class="small muted">Produces ${Number(x.capacity||0).toLocaleString()} / cycle · base price ${Number(x.base_price||0).toLocaleString()} local units</p></div>`).join('')}</div>
        <h3>Treaties & compliance</h3><div class="list">${(d.treaties||[]).length ? d.treaties.map(t=>{ const terms=treatyTerms(t.terms); return `<div class="item"><div class="item-top"><span class="item-title">${esc(t.title)}</span><span class="tag">${esc(t.republic_status||'')}</span></div>${terms.length?`<p>${terms.map(x=>`<span class="tag">${esc(x)}</span>`).join(' ')}</p>`:''}</div>`;}).join(''):'<p class="muted">No treaties.</p>'}</div>
        ${(d.treaty_compliance||[]).length ? `<p class="small muted">Recent compliance: ${d.treaty_compliance.slice(0,8).map(c=>`${esc(c.treaty_title)} · ${esc(c.obligation.replaceAll('_',' '))}: <strong>${esc(c.status)}</strong>`).join(' · ')}</p>` : ''}
        <h3>Sanctions & conflicts</h3><div class="list">${sanctionsAndConflicts.length ? sanctionsAndConflicts.join('') : '<p class="muted">No active sanctions or conflicts.</p>'}</div>
        <h3>International position</h3>${(d.foreign_relations||[]).length ? `<p class="small muted">${d.foreign_relations.map(x=>`${esc(x.counterparty_name)}: trust ${Number(x.trust||0)}, grievance ${Number(x.grievance||0)}, trade dependence ${Number(x.trade_dependency||0)}, affinity ${Number(x.ideological_affinity||0)}`).join(' · ')}</p>` : ''}<div class="list">${bilateralPosition.length ? bilateralPosition.join('') : '<p class="muted">No recorded bilateral commitments.</p>'}</div>
        <h3>Known intelligence</h3><div class="list">${(d.known_intelligence||[]).length ? d.known_intelligence.map(i=>`<div class="item"><div class="item-top"><span class="item-title">${esc(i.ref)} · ${esc(i.subject)}</span><span class="tag">${esc(i.confidence||'moderate')} confidence</span></div><p>${esc(i.body||'')}</p></div>`).join(''):'<p class="muted">No declassified intelligence in the dossier.</p>'}</div>
        <h3>Relationship timeline</h3><div class="list">${(d.timeline||[]).length ? d.timeline.slice(0,20).map(e=>`<div class="item"><div class="item-top"><span class="item-title">${esc(String(e.kind||'').replaceAll('_',' '))}</span><span class="small muted">cycle ${Number(e.cycle_no||0)}</span></div><p>${esc(e.summary||'')}</p></div>`).join(''):'<p class="muted">No relationship events yet.</p>'}</div>
      </article>`;
      target.querySelectorAll('[data-lift-sanction]').forEach(btn=>btn.onclick=()=>busy(btn,async()=>{
        try { const b=await api(`/api/diplomacy/sanctions/${btn.dataset.liftSanction}/lift`,{method:'POST',body:{reason:'The Republic shall lift the recorded sanctions.'}}); toast(`Motion ${b.ref} filed to lift sanctions.`); viewDiplomacy(); }
        catch(err){ toast(err.message,true); }
      }));
    };

    document.querySelectorAll('[data-dossier]').forEach(btn => btn.onclick = () => busy(btn, async () => {
      try { renderDossier(await api(`/api/diplomacy/powers/${btn.dataset.dossier}/dossier`)); }
      catch (err) { toast(err.message, true); }
    }));
    document.querySelectorAll('[data-sanction]').forEach(btn => btn.onclick = () => busy(btn, async () => {
      const reason=prompt(`Reason for sanctions on ${btn.dataset.powerName}`); if(!reason) return;
      const raw=prompt('Categories to restrict (comma-separated: food, raw_materials, energy, industrial_goods, technology, arms, luxury, services). Leave blank for none.','arms,technology') || '';
      const categories=raw.split(',').map(x=>x.trim()).filter(Boolean);
      const trade_ban=confirm('Apply a complete two-way trade ban? Cancel = targeted measures only.');
      const fx_ban=confirm('Freeze new foreign-exchange conversion with this power?');
      const surcharge=prompt('Extra import tariff as a decimal (0 to 1). Example: 0.25 = 25%.','0');
      try { const b=await api(`/api/diplomacy/powers/${btn.dataset.sanction}/sanction`,{method:'POST',body:{reason,categories,trade_ban,fx_ban,tariff_surcharge:Number(surcharge)||0}}); toast(`Sanctions motion ${b.ref} filed.`); }
      catch(err){ toast(err.message,true); }
    }));
    document.querySelectorAll('[data-crisis-offer]').forEach(btn => btn.onclick = () => busy(btn, async () => {
      const offer=prompt('Republic settlement offer / counter-offer'); if(!offer) return;
      const body={offer};
      if(isSpeaker && !isPresident) { const r=prompt('Enacted House resolution bill ID'); if(!r) return; body.resolution_bill_id=Number(r); }
      try { await api(`/api/diplomacy/crises/${btn.dataset.crisisOffer}/offer`,{method:'POST',body}); toast('Negotiated offer sent through the diplomatic channel.'); viewDiplomacy(); }
      catch(err){ toast(err.message,true); }
    }));
    if(document.querySelector('#embassy-form')) document.querySelector('#embassy-form').onsubmit=ev=>{
      ev.preventDefault(); busy(ev.submitter,async()=>{ const body=Object.fromEntries(new FormData(ev.target)); try { await api(`/api/diplomacy/powers/${body.power_id}/embassy`,{method:'POST',body}); toast('Embassy status updated.'); viewDiplomacy(); } catch(err){toast(err.message,true);} });
    };
    if(document.querySelector('#private-cable-form')) document.querySelector('#private-cable-form').onsubmit=ev=>{
      ev.preventDefault(); busy(ev.submitter,async()=>{ const body=Object.fromEntries(new FormData(ev.target)); try { await api('/api/diplomacy/private',{method:'POST',body}); toast('Sealed diplomatic cable sent.'); viewDiplomacy(); } catch(err){toast(err.message,true);} });
    };

    const targetedPower = document.querySelector('#targeted-export-power');
    const targetedCode = document.querySelector('#targeted-export-code');
    const showTargetCurrency = () => {
      if (!targetedPower || !targetedCode) return;
      targetedCode.textContent = targetedPower.selectedOptions[0]?.dataset.code || '';
    };
    if (targetedPower) {
      targetedPower.onchange = showTargetCurrency;
      showTargetCurrency();
    }
    if (document.querySelector('#targeted-export-form'))
      document.querySelector('#targeted-export-form').onsubmit = ev => {
        ev.preventDefault();
        busy(ev.submitter || ev.target.querySelector('button'), async () => {
          const raw = Object.fromEntries(new FormData(ev.target));
          const [source_kind, source_id] = String(raw.source || '').split(':');
          try {
            const r = await api('/api/diplomacy/export-offers', {
              method: 'POST',
              body: {
                power_id: Number(raw.power_id),
                source_kind,
                source_id: Number(source_id),
                quantity: Number(raw.quantity),
                unit_price: Number(raw.unit_price),
                note: raw.note
              }
            });
            toast(`Offer #${r.id} sent. Goods are reserved until it is accepted, rejected or cancelled.`);
            viewDiplomacy();
          } catch (err) {
            toast(err.message, true);
          }
        });
      };
    document.querySelectorAll('[data-cancel-export]').forEach(btn =>
      (btn.onclick = () =>
        busy(btn, async () => {
          try {
            await api(`/api/diplomacy/export-offers/${btn.dataset.cancelExport}`, { method: 'DELETE' });
            toast('Export offer cancelled; reserved goods returned.');
            viewDiplomacy();
          } catch (err) {
            toast(err.message, true);
          }
        }))
    );
    document.querySelectorAll('[data-spy-recruit]').forEach(btn =>
      (btn.onclick = () =>
        busy(btn, async () => {
          try {
            const accepted = btn.dataset.accept === '1';
            const r = await api(`/api/diplomacy/foreign-intelligence/recruitments/${btn.dataset.spyRecruit}/respond`, {
              method: 'POST',
              body: { accept: accepted }
            });
            toast(
              accepted
                ? `You accepted ${r.power_name}'s recruitment.${r.signing_bonus ? ` ${Number(r.signing_bonus).toLocaleString()} ${r.currency_code || ''} was paid to your FX holdings.` : ''}`
                : 'Recruitment declined.'
            );
            viewDiplomacy();
          } catch (err) {
            toast(err.message, true);
          }
        }))
    );
    document.querySelectorAll('[data-spy-turn]').forEach(btn =>
      (btn.onclick = () =>
        busy(btn, async () => {
          try {
            const accepted = btn.dataset.accept === '1';
            await api(`/api/diplomacy/foreign-intelligence/turns/${btn.dataset.spyTurn}/respond`, { method: 'POST', body: { accept: accepted } });
            toast(accepted ? 'Counter-intelligence approach accepted. Your foreign role is now secretly doubled.' : 'Counter-intelligence approach declined.');
            viewDiplomacy();
          } catch (err) { toast(err.message, true); }
        }))
    );
    document.querySelectorAll('[data-spy-resign]').forEach(btn =>
      (btn.onclick = () =>
        busy(btn, async () => {
          try {
            await api(`/api/diplomacy/foreign-intelligence/agents/${btn.dataset.spyResign}/resign`, { method: 'POST' });
            toast('You resigned from that foreign intelligence service.');
            viewDiplomacy();
          } catch (err) {
            toast(err.message, true);
          }
        }))
    );
    if (me?.is_admin) bindRepublicTerritoryPicker(republicTerritoryAdmin, viewDiplomacy);
    if (me?.is_admin) bindWorldgenSection();

    if (document.querySelector('#official-foreign-message'))
      document.querySelector('#official-foreign-message').onsubmit = async ev => {
        ev.preventDefault();
        const body = Object.fromEntries(new FormData(ev.target));
        try {
          await api('/api/diplomacy/dispatches', { method: 'POST', body });
          toast('Official diplomatic message entered in the public record.');
          viewDiplomacy();
        } catch (err) {
          toast(err.message, true);
        }
      };
    document.querySelectorAll('[data-recognise]').forEach(
      btn =>
        (btn.onclick = async () => {
          try {
            const b = await api(`/api/diplomacy/powers/${btn.dataset.recognise}/recognition`, {
              method: 'POST'
            });
            toast(`Recognition bill ${b.ref} proposed.`);
            R.reload();
          } catch (err) {
            toast(err.message, true);
          }
        })
    );
    document.querySelectorAll('[data-reply]').forEach(
      btn =>
        (btn.onclick = async () => {
          const subject = prompt('Reply subject', `Re: ${btn.dataset.replySubject || ''}`);
          if (!subject) return;
          const body = prompt('Official reply text');
          if (!body) return;
          const payload = { subject, body, message_kind: btn.dataset.replyKind || 'dispatch' };
          if (isSpeaker && !isPresident) {
            const r = prompt('Enacted House resolution bill ID');
            if (!r) return;
            payload.resolution_bill_id = Number(r);
          }
          try {
            await api(`/api/diplomacy/dispatches/${btn.dataset.reply}/reply`, {
              method: 'POST',
              body: payload
            });
            toast('Reply entered in the public record.');
            viewDiplomacy();
          } catch (err) {
            toast(err.message, true);
          }
        })
    );
    document.querySelectorAll('[data-foreign-buy]').forEach(
      btn =>
        (btn.onclick = async () => {
          try {
            const r = await api(`/api/diplomacy/offers/${btn.dataset.foreignBuy}/buy`, { method: 'POST' });
            toast(`Bought for ${cash(r.total)}${r.currency_code ? ` (${Number(r.local_price).toLocaleString()} ${r.currency_code})` : ''}.${r.shipment ? ` Shipment #${r.shipment.id} is due cycle ${r.shipment.eta_cycle}.` : r.inventory ? ' Added to your strategic goods inventory.' : ''}`);
            viewDiplomacy();
          } catch (err) {
            toast(err.message, true);
          }
        })
    );
    document.querySelectorAll('[data-resolve-conflict]').forEach(
      btn =>
        (btn.onclick = async () => {
          const outcome = prompt('Outcome to enter in the record');
          if (!outcome) return;
          const citation = prompt('Citation/evidence for the result');
          if (!citation) return;
          try {
            await api(`/api/admin/foreign/conflicts/${btn.dataset.resolveConflict}/resolve`, {
              method: 'POST',
              body: { outcome, citation }
            });
            toast('Conflict resolution recorded.');
            viewDiplomacy();
          } catch (err) {
            toast(err.message, true);
          }
        })
    );
    /* What the chosen government actually is, before it is created. The point
       of archetypes is that they change mechanics, so the mechanics are what
       this shows: who decides, how fast, and what it will refuse. */
    const archetypeSummary = a =>
      a
        ? `<strong>${esc(a.label)}</strong> — ${esc(a.blurb)}<br>Decides by <strong>${esc(a.decision_method)}</strong> · ${a.actions_per_cycle} action(s) per cycle · ${a.cabinet.length} ministers · under pressure it <strong>${esc(a.posture === 'escalate' ? 'escalates' : a.posture === 'stall' ? 'stalls' : a.posture === 'trade' ? 'trades' : 'measures')}</strong>.<br>Will never: ${a.refusals.map(r => esc(r.why)).join(' ')}`
        : 'No government. You will have to add ministers and instructions by hand before this power does anything.';
    if (document.querySelector('#newpower')) {
      const arSel = document.querySelector('#newpower-archetype'),
        arBlurb = document.querySelector('#newpower-blurb');
      const showBlurb = () => {
        arBlurb.innerHTML = archetypeSummary((govCatalogue?.archetypes || []).find(a => a.id === arSel.value));
      };
      if (arSel && arBlurb) {
        arSel.onchange = showBlurb;
        showBlurb();
      }
      document.querySelector('#newpower').onsubmit = async ev => {
        ev.preventDefault();
        try {
          const r = await api('/api/admin/foreign/powers', {
            method: 'POST',
            body: Object.fromEntries(new FormData(ev.target))
          });
          document.querySelector('#newpowerkey').innerHTML =
            `${r.government ? `<p class="small">Installed a <strong>${esc(r.government.label || r.government.archetype)}</strong>: ${r.government.ministers} ministers deciding by ${esc(r.government.decision_method)}, running on <strong>${esc(r.government.provider)}/${esc(r.government.model)}</strong>. It is ready to run a turn now.</p>` : ''}<p class="small"><strong>Save this key now; it is shown once.</strong></p><textarea readonly>${esc(r.key)}</textarea>`;
          toast('Foreign power created and recorded.');
        } catch (err) {
          toast(err.message, true);
        }
      };
    }

    /* What each minister proposed, who voted for it and what carried.
       Debugging a cabinet you cannot see is guesswork — and until this existed,
       a turn that did nothing and a turn where everything was refused by the
       archetype looked identical from here. */
    function deliberationHtml(d) {
      if (!d || !d.turn) return '<p class="muted">This government has not met yet.</p>';
      const t = d.turn,
        refused = t.result?.refused || [];
      if (!d.proposals.length)
        return `<p class="muted">Turn #${t.id} · cycle ${t.cycle_number}: no minister put a usable proposal to the cabinet.</p>${refused.length ? `<ul class="small muted">${refused.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}`;
      return `<p class="small muted">Turn #${t.id} · cycle ${t.cycle_number} · ${d.proposals.length} proposal(s), voting round ${d.last_round}${t.result?.status ? ` · outcome <strong>${esc(t.result.status)}</strong>` : ''}${t.result?.error ? ` — ${esc(t.result.error)}` : ''}</p>
        <div class="list">${d.proposals
          .map(
            p => `<div class="item"${p.carried ? ' style="border-left:3px solid var(--accent,#5B2E9E)"' : ''}>
              <div class="item-top"><span class="item-title">${esc(p.display_name)} · ${esc(String(p.role).replace(/_/g, ' '))}</span><span class="tag${p.carried ? ' on-green' : ''}">${esc(p.action_kind)}${p.carried ? ' · carried' : ''}</span></div>
              <p class="small">${esc(p.rationale || '')}</p>
              <p class="small muted">priority ${p.priority} · ${p.votes} vote(s), weight ${p.weight}${p.voters.length ? ` — ${p.voters.map(v => esc(v.display_name)).join(', ')}` : ' — nobody'}</p>
              ${p.voters.filter(v => v.reasoning).map(v => `<p class="small muted">${esc(v.display_name)}: ${esc(v.reasoning)}</p>`).join('')}
            </div>`
          )
          .join('')}</div>
        ${refused.length ? `<p class="small muted">Refused by this government: </p><ul class="small muted">${refused.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}`;
    }

    async function loadRoPower(id) {
      const panel = document.querySelector('#ro-power-panel');
      if (!panel || !id) return;
      panel.innerHTML = '<p class="muted">Loading…</p>';
      try {
        const p = adminPowers.find(x => String(x.id) === String(id));
        const [detail, territoryAdmin, delib] = await Promise.all([
          api(`/api/admin/foreign/powers/${id}/government`),
          api(`/api/admin/foreign/powers/${id}/territories`),
          api(`/api/admin/foreign/powers/${id}/deliberation`).catch(() => null)
        ]);
        const g = detail.government || {};
        const agents = detail.agents || [];
        panel.innerHTML = `<div class="stack" style="margin-top:12px">
          <form id="ro-power-edit" class="stack"><div class="grid2"><label class="field"><span>Adjective</span><input name="adjective" value="${esc(p?.adjective || '')}"></label><label class="field"><span>Colour</span><input name="colour" type="color" value="${esc(p?.colour || '#5B2E9E')}"></label></div><label class="field"><span>Standing</span><select name="standing">${['allied', 'friendly', 'neutral', 'strained', 'hostile', 'at_war'].map(x => `<option value="${x}" ${p?.standing === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><button class="btn">Save power settings</button></form>
          <div class="row"><button class="btn btn-sm" id="ro-rotate-key">Rotate foreign API key</button>${p?.revoked_at ? '' : `<button class="btn btn-sm" id="ro-revoke-power">Revoke power</button>`}</div><div id="ro-key-output"></div>
          <h3>Government</h3>
          <p class="small muted">${archetypeSummary(detail.archetype)}</p>
          <form id="ro-archetype" class="row"><select name="archetype">${(govCatalogue?.archetypes || []).map(a => `<option value="${esc(a.id)}" ${detail.archetype?.id === a.id ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select><button class="btn btn-sm">${detail.archetype ? 'Replace government' : 'Install a government'}</button></form>
          <details><summary class="small muted">Decision machinery by hand</summary><form id="ro-government" class="stack" style="margin-top:8px"><div class="grid2"><label class="field"><span>Decision method</span><select name="decision_method">${['executive', 'cabinet', 'weighted', 'consensus'].map(x => `<option value="${x}" ${g.decision_method === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label class="field"><span>Decision threshold</span><input name="decision_threshold" type="number" min="0" max="1" step="0.05" value="${g.decision_threshold ?? 0.5}"></label></div><label class="field"><span>Max deliberation rounds</span><input name="max_rounds" type="number" min="1" max="4" value="${g.max_rounds ?? 1}"></label><button class="btn">Save government</button></form></details>
          <h3>Ministers</h3><div class="list">${agents.length ? agents.map(a => `<div class="item"><div class="item-top"><span class="item-title">${esc(a.display_name)} · ${esc(a.role)}</span><span class="tag">${esc(a.model_provider)} / ${esc(a.model_name)}</span></div><p class="small muted">weight ${a.vote_weight} · ${a.active ? 'active' : 'inactive'}</p><button class="btn btn-sm" data-agent-toggle="${a.id}" data-agent-active="${a.active ? '1' : '0'}">${a.active ? 'Deactivate' : 'Activate'}</button></div>`).join('') : '<p class="muted">No ministers configured.</p>'}</div>
          <details><summary class="small muted">Add a minister by hand, or change models</summary><form id="ro-new-agent" class="stack" style="margin-top:8px"><div class="grid2"><label class="field"><span>Role</span><input name="role" placeholder="foreign_minister" required></label><label class="field"><span>Character name</span><input name="display_name" required></label></div><div class="grid2"><label class="field"><span>Free provider</span><select name="model_provider"><option value="groq">groq</option><option value="gemini">gemini</option><option value="openrouter">openrouter</option><option value="mock">mock</option></select></label><label class="field"><span>Model</span><input name="model_name" value="llama-3.1-8b-instant"></label></div><div class="row"><button class="btn btn-sm" type="button" id="ro-test-key">Test this model now</button></div><div id="ro-test-result"></div><label class="field"><span>Role instructions</span><textarea name="system_prompt" rows="4"></textarea></label><button class="btn">Add minister</button></form></details>
          ${territoryPicker(id, world, territoryAdmin)}
          <h3>The last deliberation</h3><div id="ro-delib">${deliberationHtml(delib)}</div>
          <div class="row"><button class="btn btn-primary" id="ro-run-turn">Run foreign government turn</button><button class="btn" id="ro-load-turns">View recent turns</button></div><div id="ro-turns"></div>
        </div>`;
        bindTerritoryPicker(id, p, territoryAdmin, viewDiplomacy);

        document.querySelector('#ro-power-edit').onsubmit = async ev => {
          ev.preventDefault();
          try {
            await api(`/api/admin/foreign/powers/${id}`, {
              method: 'PUT',
              body: Object.fromEntries(new FormData(ev.target))
            });
            toast('Power settings recorded.');
            viewDiplomacy();
          } catch (err) {
            toast(err.message, true);
          }
        };
        document.querySelector('#ro-archetype').onsubmit = async ev => {
          ev.preventDefault();
          const archetype = new FormData(ev.target).get('archetype');
          if (!confirm('Install this government? Its ministers replace any of the same names, and its decision method replaces the current one.')) return;
          try {
            const r = await api(`/api/admin/foreign/powers/${id}/archetype`, {
              method: 'POST',
              body: { archetype }
            });
            toast(`${r.ministers} ministers installed on ${r.provider}/${r.model}.`);
            loadRoPower(id);
          } catch (err) {
            toast(err.message, true);
          }
        };
        document.querySelector('#ro-government').onsubmit = async ev => {
          ev.preventDefault();
          const body = Object.fromEntries(new FormData(ev.target));
          body.decision_threshold = Number(body.decision_threshold);
          body.max_rounds = Number(body.max_rounds);
          try {
            await api(`/api/admin/foreign/powers/${id}/government`, { method: 'PUT', body });
            toast('Government settings recorded.');
            loadRoPower(id);
          } catch (err) {
            toast(err.message, true);
          }
        };
        const af = document.querySelector('#ro-new-agent'),
          provider = af.elements.model_provider,
          model = af.elements.model_name,
          defaults = {
            groq: 'llama-3.1-8b-instant',
            gemini: 'gemini-2.5-flash-lite',
            openrouter: 'openrouter/free',
            mock: 'mock'
          };
        provider.onchange = () => (model.value = defaults[provider.value] || '');
        /* Say plainly whether the key works, at the moment it is chosen. The
           old failure mode was a minister saved happily and a turn that failed
           a cycle later with "every configured free LLM provider failed". */
        document.querySelector('#ro-test-key').onclick = async () => {
          const out = document.querySelector('#ro-test-result');
          out.innerHTML = '<p class="small muted">Calling the provider…</p>';
          try {
            const r = await api('/api/admin/foreign/llm-test', {
              method: 'POST',
              body: { model_provider: provider.value, model_name: model.value }
            });
            out.innerHTML = r.ok
              ? `<p class="small"><span class="tag on-green">works</span> ${esc(r.provider)}/${esc(r.model)} answered in ${r.ms ?? 0}ms.</p>`
              : `<p class="small"><span class="tag">failed</span> ${esc(r.error || 'no reason given')}</p><p class="small muted">${esc(r.hint || '')}</p>`;
          } catch (err) {
            out.innerHTML = `<p class="small"><span class="tag">failed</span> ${esc(err.message)}</p>`;
          }
        };
        af.onsubmit = async ev => {
          ev.preventDefault();
          try {
            await api(`/api/admin/foreign/powers/${id}/agents`, {
              method: 'POST',
              body: Object.fromEntries(new FormData(ev.target))
            });
            toast('Minister created and recorded.');
            loadRoPower(id);
          } catch (err) {
            toast(err.message, true);
          }
        };
        document.querySelectorAll('[data-agent-toggle]').forEach(
          b =>
            (b.onclick = async () => {
              try {
                await api(`/api/admin/foreign/agents/${b.dataset.agentToggle}`, {
                  method: 'PUT',
                  body: { active: b.dataset.agentActive !== '1' }
                });
                toast('Minister status recorded.');
                loadRoPower(id);
              } catch (err) {
                toast(err.message, true);
              }
            })
        );
        document.querySelector('#ro-rotate-key').onclick = async () => {
          if (!confirm('Rotate this foreign power key? The previous key will stop working.')) return;
          try {
            const r = await api(`/api/admin/foreign/powers/${id}/rotate-key`, { method: 'POST' });
            document.querySelector('#ro-key-output').innerHTML =
              `<p class="small"><strong>New key — save it now; it is shown once.</strong></p><textarea readonly>${esc(r.key)}</textarea>`;
            toast('Foreign key rotated and recorded.');
          } catch (err) {
            toast(err.message, true);
          }
        };
        if (document.querySelector('#ro-revoke-power'))
          document.querySelector('#ro-revoke-power').onclick = async () => {
            if (!confirm('Revoke this foreign power credential?')) return;
            try {
              await api(`/api/admin/foreign/powers/${id}/revoke`, { method: 'POST' });
              toast('Foreign power revoked and recorded.');
              viewDiplomacy();
            } catch (err) {
              toast(err.message, true);
            }
          };
        document.querySelector('#ro-run-turn').onclick = async () => {
          try {
            const r = await api(`/api/admin/foreign/powers/${id}/run-turn`, { method: 'POST' });
            toast(
              r.already_ran
                ? 'This government has already met this cycle.'
                : r.chosen
                  ? `Government chose ${r.chosen.action_kind}; action recorded.`
                  : 'Government took no action; turn recorded.'
            );
            /* Redraw the deliberation in place rather than the whole page: what
               the cabinet just argued about is the thing you came to read. */
            const d = await api(`/api/admin/foreign/powers/${id}/deliberation`).catch(() => null);
            document.querySelector('#ro-delib').innerHTML = deliberationHtml(d);
          } catch (err) {
            toast(err.message, true);
          }
        };
        document.querySelector('#ro-load-turns').onclick = async () => {
          try {
            const turns = await api(`/api/admin/foreign/powers/${id}/turns`);
            document.querySelector('#ro-turns').innerHTML =
              `<div class="list">${turns.length ? turns.map(t => `<div class="item"><div class="item-top"><span class="item-title">Turn #${t.id} · cycle ${t.cycle_number}</span><span class="tag">${esc(t.result?.status || t.status)}</span></div><p class="small muted">${t.proposal_count ?? 0} proposal(s) · chosen ${t.chosen_proposal_id || 'none'} · ${esc(t.created_at || '')}</p><button class="btn btn-sm" data-show-turn="${t.id}">Show the deliberation</button></div>`).join('') : '<p class="muted">No turns.</p>'}</div>`;
            document.querySelectorAll('[data-show-turn]').forEach(
              b =>
                (b.onclick = async () => {
                  try {
                    document.querySelector('#ro-delib').innerHTML = deliberationHtml(
                      await api(`/api/admin/foreign/turns/${b.dataset.showTurn}`)
                    );
                  } catch (err) {
                    toast(err.message, true);
                  }
                })
            );
          } catch (err) {
            toast(err.message, true);
          }
        };
      } catch (err) {
        panel.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
      }
    }
    const sel = document.querySelector('#ro-power-select');
    if (sel) {
      sel.onchange = () => loadRoPower(sel.value);
      if (sel.value) loadRoPower(sel.value);
    }
  }

  /* --------------------------------------------------------- intelligence */

  const intelLabel = value => {
    const text = String(value || '').replaceAll('_', ' ');
    return text ? text[0].toUpperCase() + text.slice(1) : '';
  };
  const intelOpName = kind => intelLabel(kind);

  function intelGateNeeds(tier, progress, gates) {
    const gate = gates?.[tier];
    if (!gate || tier <= 1) return [];
    const needs = [];
    const tradecraft = Number(progress?.tradecraft || 0);
    const budget = Number(progress?.committed_budget || 0);
    const completed = tier === 2 ? Number(progress?.successful_tier1 || 0) : Number(progress?.successful_tier2 || 0);
    if (tradecraft < Number(gate.tradecraft || 0)) needs.push(`${Number(gate.tradecraft) - tradecraft} tradecraft`);
    if (budget < Number(gate.budget || 0)) needs.push(`${cash(Number(gate.budget) - budget)} committed budget`);
    if (completed < Number(gate.completed || 0))
      needs.push(`${Number(gate.completed) - completed} successful tier ${tier - 1} mission${Number(gate.completed) - completed === 1 ? '' : 's'}`);
    return needs;
  }

  async function viewIntel(v, recentOperation = null) {
    const me = ME();
    const [agency, dashboard, operations, powers] = await Promise.all([
      api('/api/intel/agency'),
      api('/api/intel'),
      api('/api/intel/operations'),
      api('/api/diplomacy/powers').catch(() => [])
    ]);
    const service = agency.service;
    const progress = agency.progress || {
      tier: Number(agency.tier || 0),
      tradecraft: Number(service?.tradecraft || 0),
      committed_budget: Number(service?.committed_budget || 0),
      successful_tier1: 0,
      successful_tier2: 0
    };
    const gates = progress.gates || agency.gates || {};
    const ops = agency.ops || {};
    const finance = agency.finance || { operating_balance: 0, recurring_budget: Number(service?.budget_per_cycle || 0), payroll_per_cycle: 0, active_agents: 0, funding_requests: [] };
    const cleared = !!dashboard.cleared;
    const isRO = !!me?.is_admin;
    const director = agency.director || null;
    const nomination = agency.nomination || null;
    const iAmDirector = !!agency.i_am_director;
    const canNominate = !!agency.can_nominate;
    const isMP = !!(me?.offices || []).includes('mp');
    const isSpeaker = !!(me?.offices || []).includes('speaker');
    const canCharter = !!me &&
      (STATE()?.config?.bill_proposers === 'citizens' || (me.offices || []).some(o => o === 'mp' || o === 'speaker'));
    const [assets, citizens, assignments, agents, compromisedAgents] = await Promise.all([
      cleared && service ? api('/api/intel/assets') : Promise.resolve([]),
      service && (canNominate || iAmDirector || isRO) ? api('/api/citizens') : Promise.resolve([]),
      cleared && service ? api('/api/intel/assignments').catch(() => []) : Promise.resolve([]),
      cleared && service ? api('/api/intel/agents').catch(() => []) : Promise.resolve([]),
      cleared && service ? api('/api/intel/foreign-agents/compromised').catch(() => []) : Promise.resolve([])
    ]);
    // Sealed content stands in for itself: fixed bar widths keyed off the
    // report id, so the same report always redacts the same way rather than
    // reshuffling on every render. Nothing here hides real text — the body was
    // never sent for a sealed report — this is what standing in its place
    // looks like, the same way a blacked-out dossier page does.
    const redactionBars = seed => {
      const widths = [92, 61, 78, 45, 85, 70];
      const n = 2 + (seed % 2);
      return Array.from({ length: n }, (_, i) => widths[(seed + i * 3) % widths.length])
        .map(w => `<span class="intel-redaction" style="width:${w}%"></span>`).join('');
    };
    const stampTag = (label, on) => `<span class="tag intel-stamp ${on ? 'is-on' : ''}">${esc(label)}</span>`;
    const completedFor = tier => tier === 2 ? Number(progress.successful_tier1 || 0) : tier === 3 ? Number(progress.successful_tier2 || 0) : 0;
    // Three numbers have to clear at once to open a tier, and a number alone
    // reads the same whether it is one point short or ninety short. A bar per
    // requirement says which one is actually holding the gate shut.
    const gateBar = (have, need, label, fmt = n => n.toLocaleString()) => {
      const pct = need > 0 ? Math.min(100, Math.round((have / need) * 100)) : 100;
      const met = have >= need;
      return `<div class="intel-gate-row"><span class="small ${met ? '' : 'muted'}">${label}</span><div class="bar intel-gate-bar"><span style="width:${pct}%;${met ? '' : 'background:var(--ink-3)'}"></span></div><span class="small mono ${met ? '' : 'muted'}">${fmt(have)} / ${fmt(need)}</span></div>`;
    };
    const tierCards = [1, 2, 3].map(tier => {
      const gate = gates[tier] || {};
      const open = !!service && Number(progress.tier || 0) >= tier;
      const current = Number(progress.tier || 0) === tier && service;
      return `<div class="item intel-tier-card ${open ? 'is-open' : ''} ${current ? 'is-current' : ''}">
        <div class="item-top"><span class="item-title">Tier ${tier} · ${esc(gate.name || '')}</span><span class="tag ${open ? 'on-green' : ''}">${open ? (current ? 'Current' : 'Open') : 'Locked'}</span></div>
        ${tier === 1 ? '<p class="small muted" style="margin-top:6px">Collection opens with the charter — no gate to clear.</p>' : `<div class="stack" style="gap:6px;margin-top:8px">
          ${gateBar(Number(progress.tradecraft || 0), Number(gate.tradecraft || 0), 'Tradecraft')}
          ${gateBar(Number(progress.committed_budget || 0), Number(gate.budget || 0), 'Committed budget', cash)}
          ${gateBar(completedFor(tier), Number(gate.completed || 0), 'Qualifying missions')}
        </div>`}
      </div>`;
    }).join('');
    const operationCatalogue = Object.entries(ops).map(([kind, op]) => {
      const open = !!service && Number(progress.tier || 0) >= Number(op.tier || 0);
      const locked = !service ? 'charter the service first' : intelGateNeeds(Number(op.tier), progress, gates).join(' · ') || 'open the previous tier';
      return `<div class="item intel-op-card ${open ? 'is-open' : 'is-locked'}"><div class="item-top"><span class="item-title mono">${esc(intelOpName(kind).toUpperCase())}</span>${open ? `<span class="tag on-green">Tier ${Number(op.tier || 0)}</span>` : stampTag(`Restricted · Tier ${Number(op.tier || 0)}`, false)}</div>
        <div class="item-meta">${cash(op.costUnit)} per score point · base difficulty ${Number(op.difficulty || 0)}${op.needsAsset ? ' · asset required' : ''}</div>
        ${open ? '' : `<p class="small muted">Needs ${esc(locked)}.</p>`}</div>`;
    }).join('');
    const opOptions = Object.entries(ops).map(([kind, op]) => {
      const open = !!service && Number(progress.tier || 0) >= Number(op.tier || 0);
      const locked = intelGateNeeds(Number(op.tier), progress, gates).join(', ') || 'previous tier';
      return `<option value="${esc(kind)}" ${open ? '' : 'disabled'}>${esc(intelOpName(kind))} · Tier ${Number(op.tier || 0)}${open ? '' : ` · Locked: ${esc(locked)}`}</option>`;
    }).join('');
    const powerOptions = powers.map(p => `<option value="${Number(p.id)}">${esc(p.name)}</option>`).join('');
    const assetRows = assets.length ? assets.map(a => `<div class="item"><div class="item-top"><span class="item-title">${esc(a.codename)}</span><span class="tag ${a.status === 'active' ? 'on-green' : a.status === 'blown' ? 'on-oxide' : ''}">${esc(intelLabel(a.status))}</span></div><div class="item-meta">${esc(a.power_name)} · experience ${Number(a.experience || 0)} · recruited cycle ${Number(a.recruited_cycle || 0)}${a.target_agent_id ? ` · foreign seat #${Number(a.target_agent_id)}` : ''}</div>${iAmDirector && a.status === 'active' ? `<button class="btn btn-sm" data-intel-extract="${Number(a.id)}">Extract asset</button>` : ''}</div>`).join('') : '<div class="empty">No assets are on the register.</div>';
    const operationRows = operations.length ? operations.map(o => `<div class="item"><div class="item-top"><span class="item-title">${esc(intelOpName(o.kind))} · ${esc(o.power_name || 'Domestic')}</span><span class="tag ${o.outcome === 'success' ? 'on-green' : 'on-oxide'}">${esc(intelLabel(o.outcome))}</span></div><div class="item-meta">Tier ${Number(o.tier || 0)} · score ${Number(o.score || 0)} / threshold ${Number(o.threshold || 0)} · operation budget ${cash(o.budget)}${Number(o.agent_pay_total || 0) ? ` · agent pay ${cash(o.agent_pay_total)}` : ''}</div></div>`).join('') : '<div class="empty">No intelligence operation has been recorded.</div>';
    const reportRows = cleared ? (dashboard.reports || []).map(r => `<div class="item intel-dossier-item"><div class="item-top"><span class="item-title"><span class="ref">${esc(r.ref)}</span> ${esc(r.subject)}</span>${r.sealed ? stampTag('Sealed', true) : `<span class="tag on-green">Declassified</span>`}</div><div class="item-meta">Filed cycle ${Number(r.filed_cycle || 0)} · ${esc(r.confidence || 'unknown')} confidence · ${esc(r.sourcing || 'source not stated')}${r.declassifies_at_cycle ? ` · declassifies cycle ${Number(r.declassifies_at_cycle)}` : ''}</div>${r.sealed ? `<div class="intel-redaction-block">${redactionBars(Number(r.id) || 0)}</div><p class="small muted">Opening this report is logged in the public read register.</p><button class="btn btn-sm" data-intel-read="${Number(r.id)}">Read sealed report</button><div id="intel-report-${Number(r.id)}"></div>` : `<div class="prose" style="margin-top:10px">${esc(r.body || '').replace(/\n/g, '<br>')}</div>`}</div>`).join('') : '';
    const activeClearances = (dashboard.clearances || []).filter(c => !c.until || new Date(c.until).getTime() > Date.now());
    const clearanceSource = c => c.source === 'ro' ? 'RO' : c.source === 'director' ? 'Office' : c.source === 'service' ? 'Director' : c.source === 'agent' ? 'Agent' : 'Service';
    const clearanceRows = (iAmDirector || isRO) ? activeClearances.map(c => `<div class="item"><div class="item-top"><span class="item-title">${esc(c.display_name)}</span><div class="row" style="gap:6px"><span class="tag">${esc(clearanceSource(c))}</span>${Number(c.user_id) === Number(director?.id) ? '<span class="tag on-green">Director</span>' : `<button class="btn btn-sm" data-intel-revoke="${Number(c.user_id)}">Revoke</button>`}</div></div><div class="item-meta">${esc(c.reason || '')} · since ${when(c.since)}${c.until ? ` · until ${when(c.until)}` : ''}</div></div>`).join('') : '';
    const rosterAgents = agents.filter(a => a.active);
    const activeAgents = rosterAgents.filter(a => a.cleared !== false);
    const agentOptions = activeAgents.map(a => `<option value="${Number(a.user_id)}">${esc(a.display_name)} · ${esc(intelLabel(a.role || 'field agent'))} · ${cash(a.operation_pay)} mission fee</option>`).join('');
    const agentRows = iAmDirector ? (rosterAgents.length ? rosterAgents.map(a => `<div class="item"><div class="item-top"><span class="item-title">${esc(a.display_name)}</span><button class="btn btn-sm" data-intel-agent-retire="${Number(a.user_id)}">Retire from Service</button></div><div class="item-meta">${esc(intelLabel(a.role || 'field agent'))} · ${cash(a.salary_per_cycle)} / cycle · ${cash(a.operation_pay)} / operation · ${Number(a.missions || 0)} mission(s)${a.cleared === false ? ' · clearance expired/revoked' : a.clearance_until ? ` · clearance until ${when(a.clearance_until)}` : ''}</div>${a.notes ? `<p class="small muted">${esc(a.notes)}</p>` : ''}</div>`).join('') : '<div class="empty">No player-agents are enlisted.</div>') : '';
    const myAgent = agents.find(a => a.active && Number(a.user_id) === Number(me?.id));
    const fundingRows = (finance.funding_requests || []).length ? finance.funding_requests.map(r => `<div class="item"><div class="item-top"><span class="item-title"><span class="ref">${esc(r.ref)}</span> ${esc(r.request_kind === 'recurring' ? 'Recurring budget increase' : 'Supplemental appropriation')}</span><span class="tag">${esc(intelLabel(r.status))}</span></div><div class="item-meta">${cash(r.amount)} · ${esc(r.purpose || '')}</div></div>`).join('') : '<div class="empty">No funding requests have been filed.</div>';
    const assignmentRows = assignments.length ? assignments.map(a => `<div class="item"><div class="item-top"><span class="item-title">${iAmDirector ? `${esc(a.display_name)} · ` : ''}${esc(intelOpName(a.kind))}</span><span class="tag ${a.outcome === 'success' ? 'on-green' : 'on-oxide'}">${esc(intelLabel(a.outcome))}</span></div><div class="item-meta">${esc(a.power_name || 'Domestic')} · cycle ${Number(a.cycle_no || 0)} · ${esc(intelLabel(a.role || 'field agent'))} · paid ${cash(a.pay)}</div></div>`).join('') : '<div class="empty">No operation assignments yet.</div>';
    const appointerName = agency.appointer === 'prime_minister' ? 'Prime Minister' : 'President';
    const leadershipCard = service ? `<div class="card"><p class="eyebrow">Service leadership</p><div class="item-top"><div><h2>${director ? esc(director.display_name) : 'Director vacant'}</h2><p class="small muted">${director ? `Confirmed Director · term ends ${when(agency.director_term_ends)}` : nomination ? `${esc(nomination.display_name)} nominated by ${esc(nomination.nominated_by_name || appointerName)} · ${Number(nomination.confirmations || 0)} / ${Number(agency.needed || 1)} confirmations` : `The ${esc(appointerName)} may nominate a Director.`}</p></div>${director ? '<span class="tag on-green">In office</span>' : nomination ? '<span class="tag">Before the House</span>' : '<span class="tag on-oxide">Vacant</span>'}</div><p class="small muted" style="margin-top:10px">The Director serves ${Number(agency.director_terms || 4)} cycles under the current rules. Once confirmed, only term expiry, impeachment or the Director's own resignation ends the appointment.</p>${canNominate && !director ? `<form id="intel-director-nominate" class="stack" style="margin-top:14px"><label class="field"><span>Nominee</span><select name="user_id" required>${citizens.map(c => `<option value="${Number(c.id)}">${esc(c.display_name)}</option>`).join('')}</select></label><button class="btn btn-primary">Nominate Director</button></form>` : ''}${nomination && (isMP || isSpeaker) ? `<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:12px">${isMP ? `<button class="btn btn-primary" data-intel-director-confirm>${agency.i_confirmed ? 'Confirmation recorded' : 'Confirm nominee'}</button>${agency.i_confirmed ? '<button class="btn" data-intel-director-unconfirm>Withdraw confirmation</button>' : ''}` : ''}${isSpeaker ? '<button class="btn" data-intel-director-refuse>Declare refusal</button>' : ''}</div>` : ''}${iAmDirector ? '<button class="btn" style="margin-top:12px" data-intel-director-resign>Resign as Director</button>' : ''}</div>` : '';

    v.innerHTML = `
      <div class="intel-page">
      <h1 class="page">Intelligence</h1>
      <p class="page-sub">The gate is public. Operations stay on the record. Report bodies stay sealed until their clock runs out.</p>

      ${service ? `<div class="card intel-folder" data-tab="Charter"><div class="item-top"><div><p class="eyebrow">Chartered intelligence service</p><h2 style="margin-top:4px">Tier ${Number(progress.tier || 0)} · ${esc(gates[progress.tier]?.name || '')}</h2></div><span class="tag on-green">Active</span></div><div class="prose">${esc(service.charter || '').replace(/\n/g, '<br>')}</div><p class="small muted" style="margin-top:12px">Reports declassify after ${Number(service.declassify_after_cycles || 0)} cycle(s) · ordinary budget ${cash(service.budget_per_cycle)} per cycle.</p></div>` : `<div class="card"><h2>No intelligence service has been chartered</h2><p class="small muted">The service comes into existence only after the House enacts its charter as a motion.</p></div>`}

      ${leadershipCard}

      ${!service && canCharter ? `<div class="card"><h2>Charter an intelligence service</h2><p class="small muted">This files a motion. It does not create the service until the bill is enacted.</p><form id="intel-charter" class="stack"><label class="field"><span>Title</span><input name="title" required value="Establishment of an Intelligence Service"></label><label class="field"><span>Charter</span><textarea name="charter" required minlength="20" rows="7" placeholder="Set out the service's purpose and limits."></textarea></label><div class="grid2"><label class="field"><span>Declassify reports after</span><input name="declassify_after_cycles" type="number" min="1" value="3" required><span class="small muted">cycles</span></label><label class="field"><span>Budget per cycle</span><input name="budget_per_cycle" type="number" min="0" value="0" required></label></div><button class="btn btn-primary">File charter motion</button></form></div>` : !service ? `<div class="card"><p class="small muted">Only someone who may propose a bill can file the charter motion.</p></div>` : ''}

      <div class="card"><h2>Tier gates</h2><p class="small muted">All figures are public. Every requirement in a gate must be met at the same time.</p><div class="list" style="margin-top:12px">${tierCards}</div></div>

      <div class="card"><h2>Operations catalogue</h2><div class="list">${operationCatalogue}</div></div>

      ${iAmDirector && service ? `<div class="grid2"><div class="card"><p class="eyebrow">Director of Intelligence</p><h2>Service clearance</h2><p class="small muted">The Director grants ordinary Service access. Clearance alone does not put a citizen on the operational roster.</p><form id="intel-clearance-director" class="stack"><label class="field"><span>Citizen</span><select name="user_id" required>${citizens.filter(c => Number(c.id) !== Number(director?.id)).map(c => `<option value="${Number(c.id)}">${esc(c.display_name)}</option>`).join('')}</select></label><label class="field"><span>Reason</span><input name="reason" maxlength="500" required></label><label class="field"><span>Expiry (optional)</span><input name="until" type="datetime-local"></label><button class="btn btn-primary">Grant clearance</button></form></div><div class="card"><p class="eyebrow">Director of Intelligence</p><h2>Player-agent roster</h2><p class="small muted">Add any active citizen as an agent; enlistment creates a Service-clearance row if they do not already have one. Set their role, standing salary and mission fee.</p><form id="intel-agent" class="stack"><label class="field"><span>Citizen</span><select name="user_id" required>${citizens.filter(c => Number(c.id) !== Number(director?.id)).map(c => `<option value="${Number(c.id)}">${esc(c.display_name)}</option>`).join('')}</select></label><label class="field"><span>Role</span><input name="role" maxlength="80" value="Field agent" required></label><div class="grid2"><label class="field"><span>Salary per cycle</span><input name="salary_per_cycle" type="number" min="0" value="0" required></label><label class="field"><span>Pay per operation</span><input name="operation_pay" type="number" min="0" value="0" required></label></div><label class="field"><span>Internal notes (optional)</span><textarea name="notes" maxlength="600" rows="3"></textarea></label><button class="btn btn-primary">Enlist / update agent</button></form></div></div><div class="card"><h2>Service staffing register</h2><div class="list">${clearanceRows || '<div class="empty">No clearances are active.</div>'}</div><h3 style="margin-top:16px">Active player-agents</h3><div class="list" style="margin-top:10px">${agentRows}</div></div><div class="card"><p class="eyebrow">Director of Intelligence</p><h2>Service finances</h2><div class="grid2"><div class="item"><div class="item-title">Operating balance</div><div class="item-meta">${cash(finance.operating_balance)} on hand</div></div><div class="item"><div class="item-title">Recurring appropriation</div><div class="item-meta">${cash(finance.recurring_budget)} per cycle · payroll ${cash(finance.payroll_per_cycle)} per cycle</div></div></div>${Number(finance.payroll_per_cycle) > 0 ? (() => {
        // Payroll is all-or-none: if the balance can't cover it in full,
        // nobody gets paid that cycle. Showing the shortfall before it
        // happens is the whole value of a Director even opening this page.
        const pct = Math.min(100, Math.round((Number(finance.operating_balance) / Number(finance.payroll_per_cycle)) * 100));
        const short = Number(finance.operating_balance) < Number(finance.payroll_per_cycle);
        return `<div class="intel-gate-row" style="margin-top:10px;grid-template-columns:140px 1fr auto"><span class="small ${short ? '' : 'muted'}">Next payroll</span><div class="bar intel-gate-bar"><span style="width:${pct}%;${short ? 'background:var(--oxide)' : ''}"></span></div><span class="small mono ${short ? '' : 'muted'}">${cash(finance.operating_balance)} / ${cash(finance.payroll_per_cycle)}</span></div>${short ? `<p class="small" style="color:var(--oxide);margin-top:6px">Short by ${cash(Number(finance.payroll_per_cycle) - Number(finance.operating_balance))} — payroll is all-or-none, so on the current balance no agent is paid this cycle unless the balance rises first.</p>` : ''}`;
      })() : ''}<p class="small muted" style="margin-top:12px">The recurring appropriation is transferred into the Service account each cycle. Agent salaries, mission fees and operations all come from that account; the Director cannot pull money directly from the Treasury.</p><form id="intel-funding" class="stack" style="margin-top:14px"><input type="hidden" name="request_kind" value="supplemental"><div class="grid2"><div class="item"><div class="item-title">Current-cycle supplement</div><div class="item-meta">The House may add money above the Presidential Budget. Recurring funding belongs in the next Presidential Budget.</div></div><label class="field"><span>Amount</span><input name="amount" type="number" min="1" required></label></div><label class="field"><span>Purpose</span><textarea name="purpose" minlength="10" maxlength="1200" required></textarea></label><button class="btn btn-primary">File supplemental funding motion</button></form><h3 style="margin-top:16px">Funding requests</h3><div class="list" style="margin-top:10px">${fundingRows}</div></div>` : ''}

      ${isRO && service ? `<div class="card"><p class="eyebrow">Returning Officer</p><h2>Clearance override</h2><p class="small muted">The RO may grant or revoke security access. This does not enlist an agent, order a mission or authorise interference with the Service's findings.</p><form id="intel-clearance-ro" class="stack"><label class="field"><span>Citizen</span><select name="user_id" required>${citizens.filter(c => Number(c.id) !== Number(director?.id)).map(c => `<option value="${Number(c.id)}">${esc(c.display_name)}</option>`).join('')}</select></label><label class="field"><span>Reason</span><input name="reason" maxlength="500" required></label><label class="field"><span>Expiry (optional)</span><input name="until" type="datetime-local"></label><button class="btn btn-primary">Grant RO clearance</button></form><div class="list" style="margin-top:14px">${clearanceRows || '<div class="empty">No clearances are active.</div>'}</div></div>` : ''}

      ${(iAmDirector || isRO) && service ? `<div class="card"><p class="eyebrow">${iAmDirector ? 'Director of Intelligence' : 'Returning Officer'}</p><h2>Foreign counter-intelligence assessment</h2><p class="small muted">Record the Service's published estimate of a foreign power's defensive capability.</p><form id="intel-counter" class="stack"><label class="field"><span>Foreign power</span><select name="power_id" required>${powerOptions}</select></label><label class="field"><span>Counter-intelligence rating</span><input name="counter_intel" type="number" min="0" max="500" required></label><button class="btn btn-primary">Record assessment</button></form></div>` : ''}

      ${cleared && service ? `<div class="card"><h2>Assets</h2><div class="list">${assetRows}</div></div>` : ''}

      ${myAgent && !iAmDirector ? `<div class="card"><p class="eyebrow">Your Service terms</p><h2>${esc(intelLabel(myAgent.role || 'field agent'))}</h2><p class="small muted">You are on the active player-agent roster at ${cash(myAgent.salary_per_cycle)} per cycle plus ${cash(myAgent.operation_pay)} per assigned operation · ${Number(myAgent.missions || 0)} mission(s) recorded.</p></div>` : ''}

      ${iAmDirector && service ? `<div class="card intel-folder" data-tab="Operation"><p class="eyebrow">Director of Intelligence</p><h2>Order an operation</h2><p class="small muted">Choose cleared player-agents to work the mission. Their identities stay off the public operations register.</p><form id="intel-operation" class="stack"><label class="field"><span>Operation</span><select name="kind" id="intel-kind" required>${opOptions}</select></label><div class="grid2"><label class="field" id="intel-power-wrap"><span>Target power</span><select name="power_id" id="intel-power">${powerOptions}</select></label><label class="field"><span>Budget</span><input name="budget" type="number" min="1" required></label></div><label class="field"><span>Assigned agents (optional)</span><select name="agent_ids" id="intel-agents" multiple size="${Math.min(6, Math.max(2, activeAgents.length))}">${agentOptions}</select><span class="small muted">Only active roster agents with current Service clearance appear here. Use Ctrl/Cmd-click to select more than one.</span></label><label class="field" id="intel-asset-wrap"><span>Foreign asset (optional unless the operation requires one)</span><select name="asset_id" id="intel-asset"><option value="">Choose automatically</option></select></label><div class="grid2"><label class="field"><span>Codename (optional)</span><input name="codename" maxlength="60"></label><label class="field"><span>Notes (optional)</span><textarea name="notes" maxlength="1500" rows="3"></textarea></label></div><p class="small"><strong>Operation budgets and mission fees are paid from the Service operating balance (${cash(finance.operating_balance)}). Committed money is spent whether the mission succeeds or fails.</strong></p><button class="btn btn-primary">Order operation</button></form>${recentOperation ? `<div id="intel-op-result" class="item" style="margin-top:14px"><div class="item-top"><span class="item-title">${esc(intelOpName(recentOperation.kind))} recorded</span><span class="tag ${recentOperation.outcome === 'success' ? 'on-green' : 'on-oxide'}">${esc(intelLabel(recentOperation.outcome))}</span></div><div class="item-meta">Score ${Number(recentOperation.score || 0)} / threshold ${Number(recentOperation.threshold || 0)} · ${Number(recentOperation.assigned_agent_count || 0)} assigned agent(s) · agent pay ${cash(recentOperation.agent_pay_total)}</div></div>` : '<div id="intel-op-result"></div>'}</div>` : ''}

      ${cleared && service ? `<div class="card"><h2>${iAmDirector ? 'Operation assignments' : 'Your operation assignments'}</h2><p class="small muted">Assignment identities are Service information and do not appear in the public operations register.</p><div class="list">${assignmentRows}</div></div><div class="card"><h2>Reports</h2><p class="small muted">A sealed report opens only to a cleared citizen. Reading it is itself logged and public.</p><div class="list">${reportRows || '<div class="empty">No reports have been filed.</div>'}</div></div>` : ''}

      ${cleared && service ? `<div class="card"><h2>Compromised foreign agents</h2><p class="small muted">These agents are known because a foreign operation exposed them. An active known agent can be approached to work secretly for the Republic; accepting is the agent player's choice.</p><div class="list">${compromisedAgents.length ? compromisedAgents.map(a => `<div class="item"><div class="item-top"><span class="item-title">${esc(a.power_name)} · ${esc(a.codename)} · ${esc(a.display_name)}</span><span class="tag ${a.double_agent ? 'on-green' : a.status === 'burned' ? 'on-oxide' : 'on-violet'}">${a.double_agent ? 'Double agent' : a.status === 'burned' ? 'Burned' : 'Identified'}</span></div><div class="item-meta">Experience ${Number(a.experience || 0)}${a.status === 'active' && !a.double_agent ? ` · <button class="btn btn-sm" data-intel-turn-agent="${Number(a.id)}">Approach as double agent</button>` : ''}</div></div>`).join('') : '<div class="empty">No foreign player agents have been identified.</div>'}</div></div>` : ''}

      <div class="card"><h2>Public operations register</h2><div class="list">${operationRows}</div></div>
      </div>`;

    if ($('#intel-charter')) $('#intel-charter').onsubmit = e => {
      e.preventDefault();
      busy(e.submitter || e.target.querySelector('button'), async () => {
        const f = Object.fromEntries(new FormData(e.target));
        f.declassify_after_cycles = Number(f.declassify_after_cycles);
        f.budget_per_cycle = Number(f.budget_per_cycle);
        try {
          const bill = await api('/api/intel/establish', { method: 'POST', body: f });
          toast(`Filed as ${bill.ref}. The House decides.`);
          location.hash = `#/bill/${bill.id}`;
        } catch (err) { toast(err.message, true); }
      });
    };

    if ($('#intel-director-nominate')) $('#intel-director-nominate').onsubmit = e => {
      e.preventDefault();
      busy(e.submitter || e.target.querySelector('button'), async () => {
        try {
          await api('/api/intel/director/nominate', { method: 'POST', body: { user_id: Number(new FormData(e.target).get('user_id')) } });
          toast('Director nomination placed before the House.');
          await viewIntel(v);
        } catch (err) { toast(err.message, true); }
      });
    };

    document.querySelectorAll('[data-intel-director-confirm]').forEach(btn => btn.onclick = () => busy(btn, async () => {
      try {
        const r = await api('/api/intel/director/confirm', { method: 'POST', body: { support: true } });
        toast(r.confirmed ? 'Director confirmed by the House.' : `Confirmation recorded: ${Number(r.votes || 0)} / ${Number(r.needed || 1)}.`);
        await viewIntel(v);
      } catch (err) { toast(err.message, true); }
    }));

    document.querySelectorAll('[data-intel-director-unconfirm]').forEach(btn => btn.onclick = () => busy(btn, async () => {
      try {
        await api('/api/intel/director/confirm', { method: 'POST', body: { support: false } });
        toast('Confirmation withdrawn.');
        await viewIntel(v);
      } catch (err) { toast(err.message, true); }
    }));

    document.querySelectorAll('[data-intel-director-refuse]').forEach(btn => btn.onclick = () => busy(btn, async () => {
      if (!confirm('Declare that the House has refused this nomination?')) return;
      try {
        await api('/api/intel/director/refuse', { method: 'POST' });
        toast('Nomination refused.');
        await viewIntel(v);
      } catch (err) { toast(err.message, true); }
    }));

    document.querySelectorAll('[data-intel-director-resign]').forEach(btn => btn.onclick = () => busy(btn, async () => {
      if (!confirm('Resign as Director of Intelligence? This ends the protected office and its automatic clearance.')) return;
      try {
        await api('/api/intel/director/resign', { method: 'POST' });
        toast('Director resigned.');
        await viewIntel(v);
      } catch (err) { toast(err.message, true); }
    }));

    ['#intel-clearance-director', '#intel-clearance-ro'].forEach(sel => {
      if (!$(sel)) return;
      $(sel).onsubmit = e => {
        e.preventDefault();
        busy(e.submitter || e.target.querySelector('button'), async () => {
          const f = Object.fromEntries(new FormData(e.target));
          f.user_id = Number(f.user_id);
          if (!f.until) delete f.until;
          try {
            await api('/api/intel/clearance', { method: 'POST', body: f });
            toast('Clearance recorded.');
            await viewIntel(v);
          } catch (err) { toast(err.message, true); }
        });
      };
    });

    if ($('#intel-agent')) $('#intel-agent').onsubmit = e => {
      e.preventDefault();
      busy(e.submitter || e.target.querySelector('button'), async () => {
        const f = Object.fromEntries(new FormData(e.target));
        f.user_id = Number(f.user_id);
        f.salary_per_cycle = Number(f.salary_per_cycle);
        f.operation_pay = Number(f.operation_pay);
        if (!f.notes) delete f.notes;
        try {
          await api('/api/intel/agents', { method: 'POST', body: f });
          toast('Agent roster updated.');
          await viewIntel(v);
        } catch (err) { toast(err.message, true); }
      });
    };

    document.querySelectorAll('[data-intel-agent-retire]').forEach(btn => btn.onclick = () => busy(btn, async () => {
      if (!confirm('Retire this citizen from the Service agent roster? Clearance created by enlistment ends too; independently granted clearance remains.')) return;
      try {
        await api(`/api/intel/agents/${btn.dataset.intelAgentRetire}`, { method: 'DELETE' });
        toast('Agent retired from operational duty.');
        await viewIntel(v);
      } catch (err) { toast(err.message, true); }
    }));

    if ($('#intel-funding')) $('#intel-funding').onsubmit = e => {
      e.preventDefault();
      busy(e.submitter || e.target.querySelector('button'), async () => {
        const f = Object.fromEntries(new FormData(e.target));
        f.amount = Number(f.amount);
        try {
          const bill = await api('/api/intel/funding-request', { method: 'POST', body: f });
          toast(`Funding request filed as ${bill.ref}. The House decides.`);
          location.hash = `#/bill/${bill.id}`;
        } catch (err) { toast(err.message, true); }
      });
    };

    document.querySelectorAll('[data-intel-revoke]').forEach(btn => btn.onclick = () => busy(btn, async () => {
      if (!confirm('Revoke this clearance? Sealed access ends immediately.')) return;
      try {
        await api(`/api/intel/clearance/${btn.dataset.intelRevoke}`, { method: 'DELETE' });
        toast('Clearance revoked.');
        await viewIntel(v);
      } catch (err) { toast(err.message, true); }
    }));

    if ($('#intel-counter')) $('#intel-counter').onsubmit = e => {
      e.preventDefault();
      busy(e.submitter || e.target.querySelector('button'), async () => {
        const f = Object.fromEntries(new FormData(e.target));
        try {
          await api(`/api/intel/powers/${Number(f.power_id)}/counter-intel`, { method: 'PUT', body: { counter_intel: Number(f.counter_intel) } });
          toast('Counter-intelligence rating recorded.');
          e.target.reset();
        } catch (err) { toast(err.message, true); }
      });
    };

    const syncOperation = () => {
      if (!$('#intel-kind')) return;
      const op = ops[$('#intel-kind').value] || {};
      $('#intel-power-wrap').hidden = op.needsPower === false;
      const target = Number($('#intel-power')?.value || 0);
      const matching = assets.filter(a => a.status === 'active' && (!target || Number(a.power_id) === target));
      $('#intel-asset').innerHTML = '<option value="">Choose automatically</option>' + matching.map(a => `<option value="${Number(a.id)}">${esc(a.codename)} · ${esc(a.power_name)}</option>`).join('');
      $('#intel-asset-wrap').hidden = !op.needsAsset;
    };
    if ($('#intel-kind')) {
      $('#intel-kind').onchange = syncOperation;
      $('#intel-power').onchange = syncOperation;
      syncOperation();
      $('#intel-operation').onsubmit = e => {
        e.preventDefault();
        busy(e.submitter || e.target.querySelector('button'), async () => {
          const fd = new FormData(e.target);
          const f = Object.fromEntries(fd);
          const op = ops[f.kind] || {};
          f.agent_ids = fd.getAll('agent_ids').map(Number).filter(Boolean);
          f.budget = Number(f.budget);
          if (op.needsPower === false) delete f.power_id; else f.power_id = Number(f.power_id);
          if (f.asset_id) f.asset_id = Number(f.asset_id); else delete f.asset_id;
          if (!f.codename) delete f.codename;
          if (!f.notes) delete f.notes;
          try {
            const r = await api('/api/intel/operations', { method: 'POST', body: f });
            toast('Operation recorded.');
            await viewIntel(v, r.operation);
          } catch (err) { toast(err.message, true); }
        });
      };
    }

    document.querySelectorAll('[data-intel-turn-agent]').forEach(btn => btn.onclick = () => busy(btn, async () => {
      const pitch = prompt('Counter-intelligence pitch to this agent');
      if (!pitch) return;
      try {
        await api(`/api/intel/foreign-agents/${btn.dataset.intelTurnAgent}/turn`, { method: 'POST', body: { pitch } });
        toast('Counter-intelligence approach sent. The player must choose whether to accept.');
        await viewIntel(v);
      } catch (err) { toast(err.message, true); }
    }));

    document.querySelectorAll('[data-intel-extract]').forEach(btn => btn.onclick = () => busy(btn, async () => {
      if (!confirm('Extract this asset? They will no longer be available for operations.')) return;
      try {
        await api(`/api/intel/assets/${btn.dataset.intelExtract}/extract`, { method: 'POST' });
        toast('Asset extracted.');
        await viewIntel(v);
      } catch (err) { toast(err.message, true); }
    }));

    document.querySelectorAll('[data-intel-read]').forEach(btn => btn.onclick = () => busy(btn, async () => {
      try {
        const r = await api(`/api/intel/reports/${btn.dataset.intelRead}/read`, { method: 'POST' });
        const out = document.querySelector(`#intel-report-${btn.dataset.intelRead}`);
        out.innerHTML = `<div class="prose" style="margin-top:10px">${esc(r.body || '').replace(/\n/g, '<br>')}</div>`;
        const item = btn.closest('.intel-dossier-item');
        const block = item?.querySelector('.intel-redaction-block');
        if (block) block.classList.add('is-lifted');
        const stamp = item?.querySelector('.intel-stamp');
        if (stamp) { stamp.textContent = 'Opened'; stamp.classList.remove('is-on'); }
        btn.hidden = true;
        toast('Report opened. The read is on the public register.');
      } catch (err) { toast(err.message, true); }
    }));
  }


  /* Register only what the server actually has.

     The server mounts judiciary.js and economy.js by name and carries on
     without them, so the front end has to do the same — otherwise a Republic
     running core alone shows a Court tab that 404s. This lets one build of the
     site serve an instance with the Acts and one without. */
  (async () => {
    const present = async path => {
      try { await api(path); return true; }
      catch (err) { return !/404|no such endpoint/i.test(err.message || ''); }
    };
    if (await present('/api/court')) {
      R.addRoute('court', 'The Court', viewCourt);
      R.addSubRoute('case', viewCase);
    }
    if (await present('/api/economy')) {
      R.addRoute('economy', 'Economy', viewEconomy);
      R.addSubRoute('business', viewBusiness);
    }
    if (await present('/api/diplomacy/powers')) {
      R.addRoute('diplomacy', 'Diplomacy', viewDiplomacy);
    }
    if (await present('/api/intel/agency')) {
      R.addRoute('intel', 'Intelligence', viewIntel);
    }
    R.refreshNav();
  })();
})();
