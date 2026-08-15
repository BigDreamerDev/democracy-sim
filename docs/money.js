/* The Treasury and the Fed — front end.

   Loaded after acts.js, and registered the same way: through window.Republic,
   and only where the server actually answers. A Republic running core alone, or
   with the economy but not this module, shows neither tab.

   Two pages, deliberately different in feel. The Treasury is the government's
   department and reads like a set of accounts. The Fed is nobody's and reads
   like a record of decisions, because that is what independence looks like from
   the outside: you cannot instruct it, you can only read what it did and why. */

(function () {
  const R = window.Republic;
  if (!R) {
    console.warn('[republic] money.js loaded without app.js');
    return;
  }
  const { api, esc, md, toast, $, when, day } = R;
  const ME = () => R.me();
  const STATE = () => R.state();

  const sym = () => STATE()?.config?.currency_symbol || 'M';
  const cash = n => `${sym()}${Number(n || 0).toLocaleString()}`;
  const pct = n => `${Math.round(Number(n || 0) * 100)}%`;
  const held = o => (ME()?.offices || []).includes(o);

  /* Every form on these pages does the same three things, so they say it once. */
  const onSubmit = (sel, fn) => {
    const el = $(sel);
    if (!el) return;
    el.onsubmit = async ev => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(ev.target).entries());
      try {
        await fn(body, ev.target);
        R.reload();
      } catch (err) {
        toast(err.message, true);
      }
    };
  };
  const onClick = (attr, fn) =>
    document.querySelectorAll(`[${attr}]`).forEach(
      x =>
        (x.onclick = async () => {
          try {
            await fn(x.getAttribute(attr), x);
            R.reload();
          } catch (err) {
            toast(err.message, true);
          }
        })
    );

  const citizenOptions = cs =>
    cs
      .map(
        c =>
          `<option value="${c.id}">${esc(c.display_name)}${(c.offices || []).length ? ` — ${esc((c.offices || []).join(', '))}` : ''}</option>`
      )
      .join('');

  /* ==================================================== THE TREASURY */

  async function viewTreasury(v) {
    const [t, citizens] = await Promise.all([api('/api/treasury'), api('/api/citizens')]);
    const mine = t.i_am_treasurer;
    const appointer = t.appointer === 'prime_minister' ? 'Prime Minister' : 'President';
    const canAppoint = held(t.appointer);

    v.innerHTML = `
      <h1 class="page">The Treasury</h1>
      <p class="page-sub">The public accounts, answerable to the House. It may not create money.</p>

      <div class="card">
        <div class="grid2">
          <div>
            <p class="eyebrow">Treasurer</p>
            <strong style="font-size:1.2rem">${esc(t.treasurer?.display_name || 'Vacant')}</strong>
            <p class="small muted" style="margin-top:6px">Appointed by the ${esc(appointer)}, and dismissable by them. The Treasury is the government's department and falls with it.</p>
          </div>
          <div>
            <p class="eyebrow">The currency</p>
            <strong style="font-size:1.2rem">${esc(t.currency.name)} (${esc(t.currency.symbol)})</strong>
            <p class="small muted" style="margin-top:6px">Named by the Treasurer.</p>
          </div>
        </div>
        ${
          canAppoint || (t.treasurer && (mine || canAppoint))
            ? `<div class="row" style="margin-top:16px;flex-wrap:wrap;gap:8px">
          ${
            canAppoint
              ? `<form id="appoint" class="row" style="gap:8px;flex:1;min-width:240px">
            <select name="user_id" style="flex:1">${citizenOptions(citizens)}</select>
            <button class="btn btn-sm btn-primary">${t.treasurer ? 'Replace' : 'Appoint'}</button>
          </form>`
              : ''
          }
          ${t.treasurer && (mine || canAppoint) ? `<button class="btn btn-sm" data-dismiss="1">${mine ? 'Resign' : 'Dismiss'}</button>` : ''}
        </div>`
            : ''
        }
      </div>

      <div class="card">
        <h2>The accounts</h2>
        <div class="grid2" style="margin-top:12px">
          <div>
            <p class="eyebrow">Treasury balance</p>
            <span class="balance-figure">${cash(t.balance)}</span>
            <p class="small muted">${t.balance < 0 ? 'In deficit. The dividend is unconditional, so this is allowed to go negative.' : 'In surplus.'}</p>
          </div>
          <div>
            <p class="eyebrow">In circulation</p>
            <span class="balance-figure">${cash(t.circulating)}</span>
            <p class="small muted">Held by citizens, businesses and banks. Issued by the Fed, which the Treasury cannot do.</p>
          </div>
        </div>
        <div class="row" style="margin-top:14px;gap:18px;flex-wrap:wrap">
          <span class="tag">Held in escrow ${cash(t.escrow)}</span>
          <span class="tag">Ownership cap ${pct(t.ownership_cap)}</span>
        </div>
        ${
          t.flows.length
            ? `<div class="list" style="margin-top:16px">
          ${t.flows
            .map(
              f => `<div class="item"><div class="item-top">
            <span class="item-title">${esc(f.kind)}</span>
            <span class="money">${cash(f.total)}</span></div>
            <p class="small muted">${f.n} movement${f.n === 1 ? '' : 's'}</p></div>`
            )
            .join('')}
        </div>`
            : '<p class="small muted" style="margin-top:14px">Nothing has moved through the Treasury yet.</p>'
        }
      </div>

      ${
        mine
          ? `<div class="card">
        <h2>The Treasurer's business</h2>
        <p class="small muted">Naming the money and fixing the ownership cap are the Treasurer's alone. Rates of tax are not — those belong to the House, and the rate of interest belongs to the Fed.</p>
        <form id="currency" class="stack" style="margin-top:14px">
          <div class="grid2">
            <label class="field"><span>Name of the currency</span><input name="currency_name" value="${esc(t.currency.name)}" required></label>
            <label class="field"><span>Symbol</span><input name="currency_symbol" value="${esc(t.currency.symbol)}" maxlength="4" required></label>
          </div>
          <button class="btn btn-primary">Rename the money</button>
        </form>
        <form id="cap" class="row" style="margin-top:16px;gap:8px">
          <label class="field" style="flex:1"><span>Most of one business a citizen may hold (0–1)</span>
            <input name="ownership_cap" type="number" step="0.01" min="0.01" max="1" value="${esc(String(t.ownership_cap))}" required></label>
          <button class="btn btn-sm" style="align-self:end">Fix the cap</button>
        </form>
        <form id="statement" class="stack" style="margin-top:20px">
          <label class="field"><span>Statement to the House</span>
            <textarea name="body" rows="5" placeholder="What was taken this cycle, and what was spent." required></textarea></label>
          <button class="btn btn-primary">Publish it</button>
        </form>
      </div>`
          : ''
      }

      <div class="card">
        <h2>Statements to the House</h2>
        ${
          t.statements.length
            ? t.statements
                .map(
                  s => `<div class="item">
          <div class="item-top"><span class="item-title">${esc(s.ref)}${s.cycle_no ? ` · cycle ${s.cycle_no}` : ''}</span>
            <span class="small muted">${esc(s.by_name || '—')} · ${day(s.at)}</span></div>
          <div class="prose" style="margin-top:8px">${md(s.body)}</div>
        </div>`
                )
                .join('')
            : '<p class="small muted">The Treasury has reported nothing yet. Part 6 says it must, each cycle.</p>'
        }
      </div>`;

    onSubmit('#appoint', b => api('/api/treasury/appoint', { method: 'POST', body: { user_id: Number(b.user_id) } }));
    onSubmit('#currency', b => api('/api/treasury/currency', { method: 'POST', body: b }));
    onSubmit('#cap', b =>
      api('/api/treasury/ownership-cap', { method: 'POST', body: { ownership_cap: Number(b.ownership_cap) } })
    );
    onSubmit('#statement', b => api('/api/treasury/statement', { method: 'POST', body: b }));
    onClick('data-dismiss', () => api('/api/treasury/dismiss', { method: 'POST' }));
  }

  /* ========================================================= THE FED */

  async function viewFed(v) {
    const [f, citizens] = await Promise.all([api('/api/fed'), api('/api/citizens')]);
    const mine = f.i_am_chair;
    const iAmPres = held('president');
    const iAmMp = held('mp');

    const decisionTag = k =>
      ({ rate: 'Rate', issue: 'Issue', retire: 'Retirement', licence: 'Licence', refusal: 'Refusal', closure: 'Closure' })[k] ||
      k;

    v.innerHTML = `
      <h1 class="page">The Fed</h1>
      <p class="page-sub">The money supply, the rate of interest, and the licensing of banks. No officer may instruct it.</p>

      <div class="card">
        <div class="grid2">
          <div>
            <p class="eyebrow">Head of the Fed</p>
            <strong style="font-size:1.2rem">${esc(f.chair?.display_name || 'Vacant')}</strong>
            ${f.term_ends ? `<p class="small muted" style="margin-top:6px">Serving ${esc(String(f.terms))} cycles, until ${day(f.term_ends)} — deliberately longer than the President who nominated them.</p>` : ''}
          </div>
          <div>
            <p class="eyebrow">In issue</p>
            <span class="balance-figure">${cash(f.issued)}</span>
            <p class="small muted">${cash(f.circulating)} is in the hands of citizens, businesses and banks.</p>
          </div>
        </div>
        <p class="small muted" style="margin-top:16px">The President nominates and the House confirms. After that nobody may dismiss the head of the Fed — not the President who chose them, not the House, not the Prime Minister. Only impeachment at two thirds, like any other officer, and a Supermajority of Citizens may abolish the Fed outright.</p>
        ${mine ? '<div class="row" style="margin-top:12px"><button class="btn btn-sm" data-resign="1">Lay down the office</button></div>' : ''}
      </div>

      ${
        f.nomination
          ? `<div class="card">
        <h2>Before the House</h2>
        <p><strong>${esc(f.nomination.display_name)}</strong>, nominated by ${esc(f.nomination.nominated_by_name || 'the President')}.</p>
        <p class="small muted">${f.nomination.confirmations} of ${f.needed} needed, from a House of ${f.house}. An appointment without confirmation is of no effect.</p>
        ${
          iAmMp
            ? `<div class="row" style="margin-top:12px">
          <button class="btn btn-sm btn-primary" data-confirm="1">${f.i_confirmed ? 'Confirmed' : 'Confirm'}</button>
          ${f.i_confirmed ? '<button class="btn btn-sm" data-unconfirm="1">Withdraw</button>' : ''}
          ${held('speaker') ? '<button class="btn btn-sm" data-refuse="1">Declare the House refuses</button>' : ''}
        </div>`
            : ''
        }
      </div>`
          : iAmPres && !f.chair
            ? `<div class="card">
        <h2>Nominate</h2>
        <p class="small muted">Yours to nominate and the House's to confirm. Choose carefully: you will not be able to remove them, and they will most likely outlast your presidency.</p>
        <form id="nominate" class="row" style="margin-top:12px;gap:8px">
          <select name="user_id" style="flex:1">${citizenOptions(citizens)}</select>
          <button class="btn btn-primary">Nominate</button>
        </form>
      </div>`
            : ''
      }

      <div class="card">
        <h2>Rates</h2>
        <div class="row" style="gap:18px;flex-wrap:wrap;margin-top:8px">
          <span class="tag">Deposits ${pct(f.rates.deposit_rate)}</span>
          <span class="tag">Loans ${pct(f.rates.loan_rate)}</span>
          <span class="tag">Ceiling ${cash(f.rates.loan_ceiling)}</span>
          <span class="tag">Reserve ${pct(f.rates.reserve_ratio)}</span>
        </div>
        <p class="small muted" style="margin-top:12px">These cannot be changed by a bill. Article 21.10 puts them out of the reach of the House, the President, the Prime Minister and the Speaker alike.</p>
        ${
          mine
            ? `<form id="rates" class="stack" style="margin-top:16px">
          <div class="grid2">
            <label class="field"><span>Rate on deposits (0–1)</span><input name="deposit_rate" type="number" step="0.01" min="0" max="1" value="${esc(String(f.rates.deposit_rate))}"></label>
            <label class="field"><span>Rate on loans (0–1)</span><input name="loan_rate" type="number" step="0.01" min="0" max="1" value="${esc(String(f.rates.loan_rate))}"></label>
          </div>
          <div class="grid2">
            <label class="field"><span>Ceiling on one citizen's borrowing</span><input name="loan_ceiling" type="number" min="0" value="${esc(String(f.rates.loan_ceiling))}"></label>
            <label class="field"><span>Reserve a licensed bank must hold (0–1)</span><input name="reserve_ratio" type="number" step="0.01" min="0" max="1" value="${esc(String(f.rates.reserve_ratio))}"></label>
          </div>
          <label class="field"><span>Your reasons — published, and required</span>
            <textarea name="reasons" rows="3" placeholder="Why this, and why now." required></textarea></label>
          <button class="btn btn-primary">Set the rates</button>
        </form>`
            : ''
        }
      </div>

      ${
        mine
          ? `<div class="card">
        <h2>The money supply</h2>
        <p class="small muted">Issuing pays the Treasury from the Fed, whose own balance goes negative by exactly that much. Nothing appears from nowhere: what is in issue is always visible above.</p>
        <div class="grid2" style="margin-top:14px">
          <form id="issue" class="stack">
            <label class="field"><span>Issue to the Treasury</span><input name="amount" type="number" min="1" required></label>
            <label class="field"><span>Reasons</span><textarea name="reasons" rows="2" required></textarea></label>
            <button class="btn btn-primary">Issue</button>
          </form>
          <form id="retire" class="stack">
            <label class="field"><span>Take out of circulation</span><input name="amount" type="number" min="1" required></label>
            <label class="field"><span>Reasons</span><textarea name="reasons" rows="2" required></textarea></label>
            <button class="btn">Retire</button>
          </form>
        </div>
      </div>`
          : ''
      }

      <div class="card">
        <h2>The record</h2>
        <p class="small muted">Article 21.12: the Fed publishes its reasons for every decision it takes. A decision cannot be recorded without them.</p>
        ${
          f.decisions.length
            ? `<div class="list" style="margin-top:14px">${f.decisions
                .map(
                  d => `<div class="item">
          <div class="item-top"><span class="item-title">${esc(d.ref)} · ${esc(decisionTag(d.kind))}</span>
            <span class="small muted">${esc(d.by_name || '—')} · ${day(d.at)}</span></div>
          <p style="margin-top:4px">${esc(d.detail)}</p>
          <p class="small muted" style="margin-top:6px">${esc(d.reasons)}</p>
        </div>`
                )
                .join('')}</div>`
            : '<p class="small muted" style="margin-top:12px">The Fed has decided nothing yet.</p>'
        }
      </div>

      <div id="banks"></div>`;

    onSubmit('#nominate', b => api('/api/fed/nominate', { method: 'POST', body: { user_id: Number(b.user_id) } }));
    onSubmit('#rates', b => api('/api/fed/rates', { method: 'POST', body: b }));
    onSubmit('#issue', b => api('/api/fed/issue', { method: 'POST', body: b }));
    onSubmit('#retire', b => api('/api/fed/retire', { method: 'POST', body: b }));
    onClick('data-confirm', () => api('/api/fed/confirm', { method: 'POST', body: { support: true } }));
    onClick('data-unconfirm', () => api('/api/fed/confirm', { method: 'POST', body: { support: false } }));
    onClick('data-refuse', () => api('/api/fed/refuse', { method: 'POST' }));
    onClick('data-resign', () => api('/api/fed/resign', { method: 'POST' }));

    drawBanks(mine);
  }

  /* ==================================================== THE BANKS */

  async function drawBanks(iAmChair) {
    const box = $('#banks');
    if (!box) return;
    let d;
    try {
      d = await api('/api/banks');
    } catch {
      box.innerHTML = '';
      return;
    }

    const statusTagFor = b =>
      ({
        applied: '<span class="tag">awaiting the Fed</span>',
        licensed: '<span class="tag">licensed</span>',
        refused: '<span class="tag on-oxide">refused</span>',
        closed: '<span class="tag on-oxide">closed</span>'
      })[b.status] || '';

    box.innerHTML = `
      <div class="card">
        <h2>Banks</h2>
        <p class="small muted">Any citizen may apply. The Fed licenses, sets the reserve each must hold, and closes one that breaks its conditions. If a bank fails, depositors are made good up to ${cash(d.guarantee)} by the Treasury and the owner loses everything they put in.</p>

        ${
          d.banks.length
            ? `<div class="list" style="margin-top:16px">
          ${d.banks
            .map(b => {
              const canBank = b.status === 'licensed';
              const short = b.reserves < b.required_reserve;
              return `<div class="item">
            <div class="item-top">
              <span class="item-title">${esc(b.name)} ${statusTagFor(b)}</span>
              <span class="money">${cash(b.reserves)}</span>
            </div>
            <p class="small muted">Founded by ${esc(b.founder_name || '—')} · ${cash(b.deposits)} on deposit · ${cash(b.lent)} lent out · reserve ${pct(b.reserve_ratio)}${short && canBank ? ' — <strong>below its reserve</strong>' : ''}</p>
            ${b.prospectus ? `<p class="small" style="margin-top:6px">${esc(b.prospectus)}</p>` : ''}
            ${b.reasons ? `<p class="small muted" style="margin-top:6px">The Fed: ${esc(b.reasons)}</p>` : ''}

            ${
              canBank
                ? `<div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">
              <input type="number" min="1" placeholder="Amount" style="width:110px" data-amt="${b.id}">
              <button class="btn btn-sm" data-deposit="${b.id}">Deposit</button>
              <button class="btn btn-sm" data-withdraw="${b.id}">Withdraw</button>
              <button class="btn btn-sm" data-borrow="${b.id}">Borrow</button>
              <span class="small muted">on deposit ${cash(b.my_deposit)} · pays ${pct(b.deposit_rate)}, charges ${pct(b.loan_rate)}</span>
            </div>`
                : ''
            }

            ${
              b.my_loans.filter(l => l.status !== 'repaid').length
                ? b.my_loans
                    .filter(l => l.status !== 'repaid')
                    .map(
                      l => `<div class="row" style="margin-top:8px;gap:6px">
              <span class="small">Loan ${l.id}${l.status === 'default' ? ' <span class="tag on-oxide">default</span>' : ''} — ${cash(l.outstanding)} owed${b.status === 'closed' ? ', now to the Treasury' : ''}</span>
              <input type="number" min="1" placeholder="Repay" style="width:100px" data-repay-amt="${l.id}">
              <button class="btn btn-sm" data-repay="${b.id}:${l.id}">Repay</button>
            </div>`
                    )
                    .join('')
                : ''
            }

            ${
              b.is_founder && canBank
                ? `<form class="row" style="margin-top:10px;gap:6px" data-rates="${b.id}">
              <input name="deposit_rate" type="number" step="0.01" min="0" max="1" value="${esc(String(b.deposit_rate))}" style="width:90px" title="Rate paid on deposits">
              <input name="loan_rate" type="number" step="0.01" min="0" max="1" value="${esc(String(b.loan_rate))}" style="width:90px" title="Rate charged on loans">
              <button class="btn btn-sm">Set your rates</button>
            </form>`
                : ''
            }

            ${
              iAmChair && b.status !== 'closed'
                ? `<div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">
              <input placeholder="Your reasons — published" style="flex:1;min-width:200px" data-reasons="${b.id}">
              ${b.status !== 'licensed' ? `<button class="btn btn-sm btn-primary" data-licence="${b.id}">License</button>` : ''}
              ${b.status !== 'licensed' ? `<button class="btn btn-sm" data-refuse-bank="${b.id}">Refuse</button>` : ''}
              ${b.status === 'licensed' ? `<button class="btn btn-sm" data-close-bank="${b.id}">Close it</button>` : ''}
            </div>`
                : ''
            }
          </div>`;
            })
            .join('')}
        </div>`
            : '<p class="small muted" style="margin-top:12px">No one has applied to open a bank.</p>'
        }

        ${
          iAmChair
            ? '<p class="small muted" style="margin-top:16px">You license the banks, so you may not own one.</p>'
            : `<form id="applybank" class="stack" style="margin-top:20px">
          <h2>Open a bank</h2>
          <p class="small muted">Capital of at least ${cash(d.charter_fee)}, paid in when you apply and returned if the Fed refuses you. If the Fed later closes your bank, it is gone.</p>
          <div class="grid2">
            <label class="field"><span>Name</span><input name="name" required></label>
            <label class="field"><span>Capital</span><input name="capital" type="number" min="${d.charter_fee}" value="${d.charter_fee}" required></label>
          </div>
          <label class="field"><span>Prospectus</span><textarea name="prospectus" rows="3" placeholder="What this bank is for, and how it will hold its reserve."></textarea></label>
          <button class="btn btn-primary">Apply for a licence</button>
        </form>`
        }
      </div>`;

    const amt = id => Number(document.querySelector(`[data-amt="${id}"]`)?.value || 0);
    const reasons = id => String(document.querySelector(`[data-reasons="${id}"]`)?.value || '');

    onSubmit('#applybank', b =>
      api('/api/banks', { method: 'POST', body: { ...b, capital: Number(b.capital) } })
    );
    onClick('data-deposit', id => api(`/api/banks/${id}/deposit`, { method: 'POST', body: { amount: amt(id) } }));
    onClick('data-withdraw', id => api(`/api/banks/${id}/withdraw`, { method: 'POST', body: { amount: amt(id) } }));
    onClick('data-borrow', id => api(`/api/banks/${id}/borrow`, { method: 'POST', body: { amount: amt(id) } }));
    onClick('data-licence', id =>
      api(`/api/banks/${id}/licence`, { method: 'POST', body: { reasons: reasons(id) } })
    );
    onClick('data-refuse-bank', id =>
      api(`/api/banks/${id}/refuse`, { method: 'POST', body: { reasons: reasons(id) } })
    );
    onClick('data-close-bank', id =>
      api(`/api/banks/${id}/close`, { method: 'POST', body: { reasons: reasons(id) } })
    );
    onClick('data-repay', pair => {
      const [bankId, loanId] = pair.split(':');
      const amount = Number(document.querySelector(`[data-repay-amt="${loanId}"]`)?.value || 0);
      return api(`/api/banks/${bankId}/repay`, { method: 'POST', body: { loan_id: Number(loanId), amount } });
    });
    document.querySelectorAll('[data-rates]').forEach(form => {
      form.onsubmit = async ev => {
        ev.preventDefault();
        const b = Object.fromEntries(new FormData(ev.target).entries());
        try {
          await api(`/api/banks/${ev.target.dataset.rates}/rates`, {
            method: 'POST',
            body: { deposit_rate: Number(b.deposit_rate), loan_rate: Number(b.loan_rate) }
          });
          R.reload();
        } catch (err) {
          toast(err.message, true);
        }
      };
    });
  }

  /* ================================================== SUPPLY AND UPKEEP

     War here is logistics, by the group's decision: buy equipment, keep it
     supplied, pay for it — no movement, no deployment, no dice. So the page is
     a Quartermaster's page, and the number it leads with is the one a
     quartermaster actually wants: how many cycles the store covers. */

  const CAT_LABEL = {
    food: 'Food', raw_materials: 'Raw materials', energy: 'Energy',
    industrial_goods: 'Industrial goods', technology: 'Technology',
    arms: 'Arms', luxury: 'Luxury', services: 'Services'
  };

  const STAGE_LABEL = { grievance: 'Grievance', ultimatum: 'Ultimatum', blockade: 'Blockade', open_war: 'Open war' };

  async function viewWar(v) {
    const [d, front] = await Promise.all([api('/api/war'), api('/api/war/conflicts').catch(() => null)]);
    const mine = d.i_am_quartermaster;
    const by = d.appointer === 'prime_minister' ? 'Prime Minister' : 'President';
    const canAppoint = held(d.appointer);

    /* Anything under two cycles of cover is the thing to shout about — one
       cycle of warning is not warning. */
    const critical = d.forecast.filter(f => f.per_cycle > 0 && f.cycles_covered !== null && f.cycles_covered < 2);

    v.innerHTML = `
      <h1 class="page">Supply</h1>
      <p class="page-sub">What the Republic holds, what its forces eat, and what that costs. No orders are given here — this is the storehouse, not a battlefield.</p>

      <div class="card">
        <div class="grid2">
          <div>
            <p class="eyebrow">Quartermaster</p>
            <strong style="font-size:1.2rem">${esc(d.quartermaster?.display_name || 'Vacant')}</strong>
            <p class="small muted" style="margin-top:6px">Appointed by the ${esc(by)} and dismissable by them. Spends only what the House has voted.</p>
          </div>
          <div>
            <p class="eyebrow">Readiness</p>
            <span class="balance-figure">${d.readiness === null ? '—' : d.readiness + '%'}</span>
            <p class="small muted">${
              d.readiness === null
                ? 'Nothing is standing.'
                : d.readiness >= 90
                  ? 'Fully supplied.'
                  : 'Falling while supply is short. It recovers slower than it falls.'
            }</p>
          </div>
        </div>
        ${
          canAppoint || (d.quartermaster && mine)
            ? `<div class="row" style="margin-top:16px;gap:8px;flex-wrap:wrap">
          ${canAppoint ? `<form id="qm-appoint" class="row" style="gap:8px;flex:1;min-width:240px">
            <select name="user_id" style="flex:1"></select>
            <button class="btn btn-sm btn-primary">${d.quartermaster ? 'Replace' : 'Appoint'}</button></form>` : ''}
          ${d.quartermaster && (mine || canAppoint) ? `<button class="btn btn-sm" data-qm-dismiss="1">${mine ? 'Resign' : 'Dismiss'}</button>` : ''}
        </div>`
            : ''
        }
      </div>

      ${frontLine(front)}

      ${
        critical.length
          ? `<div class="card" style="border-color:var(--oxide)">
        <h2>Running out</h2>
        <p class="small muted">At the current establishment:</p>
        <div class="list" style="margin-top:10px">${critical
          .map(f => `<div class="item"><div class="item-top">
            <span class="item-title">${esc(CAT_LABEL[f.category] || f.category)}</span>
            <span class="money">${f.cycles_covered === 0 ? 'none left' : f.cycles_covered + ' cycle'}</span></div>
            <p class="small muted">${f.held} held · ${f.per_cycle} needed each cycle</p></div>`)
          .join('')}</div>
      </div>`
          : ''
      }

      <div class="card">
        <h2>The storehouse</h2>
        <div class="list" style="margin-top:12px">
          ${d.forecast
            .map(f => `<div class="item"><div class="item-top">
              <span class="item-title">${esc(CAT_LABEL[f.category] || f.category)}</span>
              <span class="money">${f.held}</span></div>
              <p class="small muted">${f.per_cycle} a cycle · ${
                f.cycles_covered === null ? 'not consumed' : `${f.cycles_covered} cycle${f.cycles_covered === 1 ? '' : 's'} covered`
              }</p></div>`)
            .join('')}
        </div>
        <div class="row" style="margin-top:14px;gap:18px;flex-wrap:wrap">
          ${Object.entries(d.stockpile)
            .filter(([c]) => !d.forecast.some(f => f.category === c))
            .map(([c, n]) => `<span class="tag">${esc(CAT_LABEL[c] || c)} ${n}</span>`)
            .join('')}
        </div>
      </div>

      <div class="card">
        <h2>The establishment</h2>
        <p class="small muted">Each unit of size eats, burns and wears out every cycle, and is paid. A standing army in peacetime is a bill that arrives forever.</p>
        <div class="row" style="margin-top:12px;gap:18px;flex-wrap:wrap">
          <span class="tag">${d.size} of size</span>
          <span class="tag">${cash(d.wages_per_cycle)} in pay a cycle</span>
          <span class="tag">budget ${cash(d.budget)} · ${cash(d.budget_left)} left this cycle</span>
        </div>
        ${
          d.formations.length
            ? `<div class="list" style="margin-top:14px">${d.formations
                .map(f => `<div class="item"><div class="item-top">
            <span class="item-title">${esc(f.name)}</span>
            <span class="money">${Math.round(Number(f.readiness))}%</span></div>
            <p class="small muted">${esc(f.arm)} · size ${f.size}</p>
            ${mine ? `<div class="row" style="margin-top:8px"><button class="btn btn-sm" data-disband="${f.id}">Disband</button></div>` : ''}
          </div>`)
                .join('')}</div>`
            : '<p class="small muted" style="margin-top:12px">Nothing is standing. Upkeep costs nothing, which is the cheapest defence policy there is.</p>'
        }
        ${
          mine
            ? `<form id="raise" class="stack" style="margin-top:18px">
          <div class="grid2">
            <label class="field"><span>Name</span><input name="name" placeholder="First Regiment" required></label>
            <label class="field"><span>Size</span><input name="size" type="number" min="1" max="50" value="1" required></label>
          </div>
          <label class="field"><span>Arm</span><select name="arm"><option value="army">Army</option><option value="navy">Navy</option><option value="air">Air</option></select></label>
          <p class="small muted">Raising costs ${d.raise_cost_arms} arms from the storehouse for every unit of size. You cannot raise what you have not equipped.</p>
          <button class="btn btn-primary">Raise it</button>
        </form>`
            : ''
        }
      </div>

      ${mine ? '<div class="card"><h2>Procurement</h2><p class="small muted">The Republic buys at the seller\'s price, from the same market citizens use. There is no requisition and no state discount — if you want cheap arms, the Republic needs an arms industry.</p><div id="procure" class="list" style="margin-top:14px"></div></div>' : ''}

      <div class="card">
        <h2>Upkeep</h2>
        ${
          d.runs.length
            ? `<div class="list">${d.runs
                .map(r => `<div class="item"><div class="item-top">
            <span class="item-title">Cycle ${r.cycle_no}</span>
            <span class="money">${cash(r.paid)}</span></div>
            <p class="small muted">${esc(r.detail)}</p></div>`)
                .join('')}</div>`
            : '<p class="small muted">Upkeep has not run yet.</p>'
        }
      </div>`;

    onSubmit('#qm-appoint', b => api('/api/war/quartermaster/appoint', { method: 'POST', body: { user_id: Number(b.user_id) } }));
    onSubmit('#raise', b => api('/api/war/formations', { method: 'POST', body: { ...b, size: Number(b.size) } }));
    onClick('data-qm-dismiss', () => api('/api/war/quartermaster/dismiss', { method: 'POST' }));
    onClick('data-disband', id => api(`/api/war/formations/${id}/disband`, { method: 'POST' }));

    const sel = document.querySelector('#qm-appoint select');
    if (sel) {
      try {
        const cs = await api('/api/citizens');
        sel.innerHTML = cs.map(c => `<option value="${c.id}">${esc(c.display_name)}${(c.offices || []).length ? ` — ${esc((c.offices || []).join(', '))}` : ''}</option>`).join('');
      } catch {}
    }
    if (mine) await drawProcurement();
  }

  /* The front. A conflict here is a countdown, not a battle — so what the card
     shows is which way it is moving and how many cycles are left before the
     next stage. That number is what makes the House act, so it leads. */
  function frontLine(front) {
    if (!front || !front.conflicts?.length) return '';
    return `<div class="card">
      <h2>The front</h2>
      <p class="small muted">Nothing is fought here. Each cycle a conflict moves by how well your forces are supplied against what the other side brings — and when it crosses a line, it escalates. Peace is a treaty, and a treaty is a bill.</p>
      <div class="row" style="margin-top:10px"><span class="tag">the Republic brings ${front.ours}</span></div>
      <div class="list" style="margin-top:12px">
        ${front.conflicts
          .map(c => {
            const worsening = c.moving > 0;
            const pct = Math.max(0, Math.min(100, Number(c.pressure)));
            return `<div class="item">
          <div class="item-top">
            <span class="item-title">${esc(c.power_name)}</span>
            <span class="tag ${c.stage === 'open_war' || c.stage === 'blockade' ? 'on-oxide' : ''}">${esc(STAGE_LABEL[c.stage] || c.stage)}</span>
          </div>
          <div class="wm-pressure"><i style="width:${pct}%;background:${worsening ? 'var(--oxide)' : 'var(--tally)'}"></i></div>
          <p class="small muted" style="margin-top:6px">
            ${esc(c.grievance || '')}
          </p>
          <p class="small muted" style="margin-top:4px">
            They bring ${c.strength} against your ${front.ours} ·
            ${
              worsening
                ? `worsening by ${c.moving} a cycle${c.cycles_to_next ? ` · ${c.cycles_to_next} cycle${c.cycles_to_next === 1 ? '' : 's'} to ${esc(STAGE_LABEL[c.next_stage] || c.next_stage)}` : ''}`
                : c.moving < 0
                  ? `easing by ${-c.moving} a cycle`
                  : 'holding steady'
            }
          </p>
        </div>`;
          })
          .join('')}
      </div>
    </div>`;
  }

  /* The market, filtered to what the storehouse can actually hold. A listing
     with no category cannot be stored, so it is not offered. */
  async function drawProcurement() {
    const box = $('#procure');
    if (!box) return;
    let listings = [];
    try {
      listings = (await api('/api/economy/listings')).filter(l => l.category);
    } catch {}
    if (!listings.length) {
      box.innerHTML = '<p class="small muted">Nothing on the market is categorised, so nothing can be bought into the storehouse. Businesses classify themselves on the Economy page.</p>';
      return;
    }
    box.innerHTML = listings
      .map(l => `<div class="item">
        <div class="item-top"><span class="item-title">${esc(l.title)}</span><span class="money">${cash(l.price)}</span></div>
        <p class="small muted">${esc(l.business_name)} · ${esc(CAT_LABEL[l.category] || l.category)}${l.stock === null ? '' : ` · ${l.stock} left`}</p>
        <div class="row" style="margin-top:8px;gap:6px">
          <input type="number" min="1" value="1" style="width:90px" data-units="${l.id}">
          <button class="btn btn-sm" data-buy="${l.id}">Buy for the Republic</button>
        </div>
      </div>`)
      .join('');
    onClick('data-buy', id =>
      api(`/api/war/procure/listing/${id}`, {
        method: 'POST',
        body: { units: Number(document.querySelector(`[data-units="${id}"]`)?.value || 1) }
      })
    );
  }

  /* ============================================ OFFSHORE, FOREX, DEFECTION

     Three features on one page because they share one idea: money, and a
     citizen, that have moved somewhere the Republic cannot see or reach at
     will. Nothing here creates or destroys a mark — a deposit, a conversion
     and a renunciation each move something that already existed, and the
     server is what enforces that, not this file. */

  const canProposeHere = () =>
    STATE()?.config?.bill_proposers === 'citizens' || (ME()?.offices || []).some(o => o === 'mp' || o === 'speaker');

  function defectionCard(d) {
    if (d.my_defection) {
      const x = d.my_defection;
      return `<div class="card" style="border-color:var(--oxide)">
        <h2>You have renounced the Republic</h2>
        <p class="small muted">To ${esc(x.power_name || 'a foreign power')}${x.renounced_cycle ? `, cycle ${x.renounced_cycle}` : ''}.</p>
        <p style="margin-top:8px">${esc(x.reasons)}</p>
        <p class="small muted" style="margin-top:8px">${cash(x.sequestered)} of domestic holdings froze at the moment you left, and stays frozen until the House passes a bill of readmission. What you hold offshore is untouched — that was the point of holding it there.</p>
      </div>`;
    }
    return `<div class="card">
      <h2>Renounce the Republic</h2>
      <p class="small muted">You lose the vote, the dividend and any office at once — Article 1.2 ties citizenship to membership of the Group. Domestic holdings freeze exactly where they sit, pending a bill; what you hold offshore stays yours. There is a route back, and it costs a share of what was frozen.</p>
      ${
        d.powers.length
          ? `<form id="renounce" class="stack" style="margin-top:12px">
        <label class="field"><span>Join</span><select name="power_id" required>${d.powers.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Why, in a sentence — leaving is a public act</span><textarea name="reasons" rows="2" required></textarea></label>
        <button class="btn" style="border-color:var(--oxide)">Renounce</button>
      </form>`
          : '<p class="small muted" style="margin-top:10px">No foreign power exists to join yet.</p>'
      }
    </div>`;
  }

  function powerCard(p) {
    const acc = p.my_account;
    const c = p.currency;
    const monetary = c?.actions?.length
      ? `<div style="margin-top:10px"><p class="eyebrow">Recent monetary decisions</p>${c.actions.slice(0, 3).map(a =>
          `<p class="small muted">${a.kind === 'issue' ? 'Printed' : 'Distributed'} ${Number(a.amount).toLocaleString()} ${esc(c.code)} — ${esc(a.reason)}</p>`
        ).join('')}</div>`
      : '';
    return `<div class="item">
      <div class="item-top">
        <span class="item-title">${esc(p.name)}${p.discloses ? ' <span class="tag">discloses by treaty</span>' : ''}</span>
        ${c ? `<span class="money">1 ${esc(STATE()?.config?.currency_name || 'Mark')} = ${Number(c.rate).toFixed(3)} ${esc(c.code)}</span>` : '<span class="small muted">no currency yet</span>'}
      </div>
      <p class="small muted">Standing: ${esc(p.standing)}</p>
      ${c ? `<p class="small muted" style="margin-top:6px">Supply ${Number(c.money_supply).toLocaleString()} ${esc(c.code)} · treasury ${Number(c.treasury_balance).toLocaleString()} · domestic circulation ${Number(c.circulation).toLocaleString()} · Republic reserve ${Number(c.republic_reserve).toLocaleString()} ${esc(c.code)} · their Republic-mark reserve ${cash(c.republic_mark_reserve)}</p>${monetary}` : ''}
      <div class="grid2" style="margin-top:10px;gap:14px">
        <div>
          <p class="eyebrow">Offshore account</p>
          ${
            acc
              ? `<p>${cash(acc.balance)}${acc.frozen ? ' <span class="tag on-oxide">frozen</span>' : ''}</p>
                 ${acc.frozen ? `<p class="small" style="margin-top:4px;color:var(--oxide)">${esc(acc.frozen_reason)}</p>` : ''}
                 ${
                   acc.frozen
                     ? ''
                     : `<div class="row" style="margin-top:6px;gap:6px;flex-wrap:wrap">
                   <input type="number" min="1" placeholder="Amount" style="width:110px" data-off-amt="${p.id}">
                   <button class="btn btn-sm" data-off-deposit="${p.id}">Deposit</button>
                   <button class="btn btn-sm" data-off-withdraw="${p.id}">Withdraw</button>
                 </div>`
                 }`
              : `<button class="btn btn-sm" data-off-open="${p.id}">Open an account</button>`
          }
        </div>
        <div>
          <p class="eyebrow">Foreign exchange</p>
          ${
            c
              ? `<p>Holding ${p.my_units} ${esc(c.code)}</p>
             <div class="row" style="margin-top:6px;gap:6px;flex-wrap:wrap">
               <input type="number" min="1" placeholder="Marks to convert" style="width:130px" data-fx-buy-amt="${p.id}">
               <button class="btn btn-sm" data-fx-buy="${p.id}">Buy ${esc(c.code)}</button>
             </div>
             <div class="row" style="margin-top:6px;gap:6px;flex-wrap:wrap">
               <input type="number" min="1" placeholder="${esc(c.code)} to sell" style="width:130px" data-fx-sell-amt="${p.id}">
               <button class="btn btn-sm" data-fx-sell="${p.id}">Sell for ${esc(STATE()?.config?.currency_name || 'marks')}</button>
             </div>`
              : '<p class="small muted">No currency yet.</p>'
          }
        </div>
      </div>
    </div>`;
  }

  function houseCard(d) {
    const live = d.defections.filter(x => x.status === 'defected');
    return `<div class="card">
      <h2>What the House can do about it</h2>
      <p class="small muted">An inquiry directs the intelligence service to find out who holds what abroad — a sealed report, cleared to whoever the bill names. A seizure takes what a citizen holds abroad, and can come back empty-handed if the haven has frozen the account first.</p>

      <form id="inquiry" class="stack" style="margin-top:12px">
        <div class="grid2">
          <label class="field"><span>Haven</span>
            <select name="power_id"><option value="">Any haven</option>${d.powers.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Clear to read it — citizen IDs, comma-separated</span><input name="clear_ids" placeholder="e.g. 3, 7"></label>
        </div>
        <button class="btn btn-sm">Move an inquiry</button>
      </form>

      <form id="seizure" class="stack" style="margin-top:16px">
        <div class="grid2">
          <label class="field"><span>Citizen (user id)</span><input name="user_id" type="number" min="1" required></label>
          <label class="field"><span>Haven</span>
            <select name="power_id"><option value="">Any haven</option>${d.powers.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        </div>
        <button class="btn btn-sm">Move a seizure</button>
      </form>

      ${
        live.length
          ? `<div style="margin-top:16px">
        <p class="eyebrow">Move a readmission</p>
        <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">
          ${live.map(x => `<button class="btn btn-sm" data-readmit="${x.id}">${esc(x.display_name)}, back from ${esc(x.power_name || 'abroad')}</button>`).join('')}
        </div>
      </div>`
          : ''
      }
    </div>`;
  }

  async function viewOffshore(v) {
    const d = await api('/api/offshore');

    if (!d.enabled) {
      v.innerHTML = `
        <h1 class="page">Offshore &amp; Forex</h1>
        <p class="page-sub">Switched off. The Returning Officer turns this on from the admin page.</p>`;
      return;
    }

    v.innerHTML = `
      <h1 class="page">Offshore &amp; Forex</h1>
      <p class="page-sub">Banking abroad is opaque, not secret: the House can find it by inquiry, take it by bill, or compel a haven to publish it by treaty. A power that has soured on the Republic can freeze what it holds — usually the moment you wanted it.</p>

      ${defectionCard(d)}

      <div class="card">
        <h2>Foreign currencies</h2>
        <p class="small muted">Rates move once a cycle from the balance of trade, conflict pressure, and relative monetary expansion. Foreign printing or distribution weakens that currency; Republic issuance weakens ours. Nothing here is random.</p>
        <div class="list" style="margin-top:12px">
          ${d.powers.map(powerCard).join('') || '<p class="small muted">No foreign power exists yet.</p>'}
        </div>
      </div>

      ${
        d.disclosed.length
          ? `<div class="card">
        <h2>Disclosed holdings</h2>
        <p class="small muted">These havens have agreed, by treaty, to publish what they hold. That is what a citizen who opened an account here was afraid of.</p>
        <div class="list" style="margin-top:10px">${d.disclosed
          .map(h => `<div class="item"><div class="item-top"><span class="item-title">${esc(h.display_name)}</span><span class="money">${cash(h.balance)}</span></div></div>`)
          .join('')}</div>
      </div>`
          : ''
      }

      <div class="card">
        <h2>Fixings</h2>
        <p class="small muted">Every move a rate has ever made, with the inputs that caused it — the arithmetic behind next cycle's rate is here before the payrun runs.</p>
        ${
          d.fixings.length
            ? `<div class="list" style="margin-top:10px">${d.fixings
                .map(
                  f => `<div class="item">
          <div class="item-top"><span class="item-title">${esc(f.power_name || '—')} · cycle ${f.cycle_no}</span>
            <span class="money">${Number(f.rate_before).toFixed(3)} → ${Number(f.rate_after).toFixed(3)}</span></div>
          <p class="small muted">${esc(f.note)}</p></div>`
                )
                .join('')}</div>`
            : '<p class="small muted" style="margin-top:10px">No fixing has run yet.</p>'
        }
      </div>

      ${
        d.my_trades.length
          ? `<div class="card">
        <h2>Your conversions</h2>
        <div class="list" style="margin-top:10px">${d.my_trades
          .map(
            t => `<div class="item"><div class="item-top">
          <span class="item-title">${t.side === 'buy' ? 'Bought' : 'Sold'} ${t.units} at ${Number(t.rate).toFixed(3)}</span>
          <span class="money">${cash(t.marks)}</span></div>
          <p class="small muted">${t.spread ? `${t.spread} spread · ` : ''}${when(t.at)}</p></div>`
          )
          .join('')}</div>
      </div>`
          : ''
      }

      ${canProposeHere() ? houseCard(d) : ''}

      <div class="card">
        <h2>Renunciations</h2>
        <p class="small muted">Who has gone, to whom, and what froze when they left. Leaving is a public act.</p>
        ${
          d.defections.length
            ? `<div class="list" style="margin-top:10px">${d.defections
                .map(
                  x => `<div class="item">
          <div class="item-top"><span class="item-title">${esc(x.display_name)}</span>
            <span class="tag ${x.status === 'defected' ? 'on-oxide' : ''}">${x.status === 'defected' ? 'gone' : 'returned'}</span></div>
          <p class="small muted">To ${esc(x.power_name || 'a foreign power')}${x.renounced_cycle ? `, cycle ${x.renounced_cycle}` : ''} · ${cash(x.sequestered)} froze on the way out</p>
        </div>`
                )
                .join('')}</div>`
            : '<p class="small muted" style="margin-top:10px">Nobody has renounced the Republic.</p>'
        }
      </div>`;

    onSubmit('#renounce', b => api('/api/defection', { method: 'POST', body: b }));

    const offAmt = id => Number(document.querySelector(`[data-off-amt="${id}"]`)?.value || 0);
    onClick('data-off-open', id => api('/api/offshore/open', { method: 'POST', body: { power_id: Number(id) } }));
    onClick('data-off-deposit', id =>
      api('/api/offshore/deposit', { method: 'POST', body: { power_id: Number(id), amount: offAmt(id) } })
    );
    onClick('data-off-withdraw', id =>
      api('/api/offshore/withdraw', { method: 'POST', body: { power_id: Number(id), amount: offAmt(id) } })
    );

    onClick('data-fx-buy', id =>
      api('/api/forex/buy', {
        method: 'POST',
        body: { power_id: Number(id), amount: Number(document.querySelector(`[data-fx-buy-amt="${id}"]`)?.value || 0) }
      })
    );
    onClick('data-fx-sell', id =>
      api('/api/forex/sell', {
        method: 'POST',
        body: { power_id: Number(id), units: Number(document.querySelector(`[data-fx-sell-amt="${id}"]`)?.value || 0) }
      })
    );

    onSubmit('#inquiry', b =>
      api('/api/offshore/inquiry', {
        method: 'POST',
        body: {
          power_id: b.power_id ? Number(b.power_id) : null,
          clear: String(b.clear_ids || '')
            .split(',')
            .map(s => Number(s.trim()))
            .filter(Boolean)
        }
      })
    );
    onSubmit('#seizure', b =>
      api('/api/offshore/seizure', {
        method: 'POST',
        body: { user_id: Number(b.user_id), power_id: b.power_id ? Number(b.power_id) : null }
      })
    );
    onClick('data-readmit', id => api(`/api/defections/${id}/readmit`, { method: 'POST' }));
  }

  /* Registered only where the server answers, exactly as acts.js does it. */
  (async () => {
    const present = async path => {
      try {
        await api(path);
        return true;
      } catch (err) {
        return !/404|no such endpoint|503|not running/i.test(err.message || '');
      }
    };
    if (await present('/api/treasury')) R.addRoute('treasury', 'Treasury', viewTreasury);
    if (await present('/api/fed')) R.addRoute('fed', 'The Fed', viewFed);
    if (await present('/api/war')) R.addRoute('war', 'Supply', viewWar);
    if (await present('/api/offshore')) R.addRoute('offshore', 'Offshore & Forex', viewOffshore);
    R.refreshNav();
  })();
})();
