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
    R.refreshNav();
  })();
})();
