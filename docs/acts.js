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
    const [e, me, market, orders, bank] = await Promise.all([
      api('/api/economy'),
      api('/api/economy/me'),
      api('/api/economy/market'),
      api('/api/economy/orders'),
      api('/api/economy/bank')
    ]);

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
          <p class="small muted">Tax: nothing below ${cash(e.tax_free)}, then ${Math.round(e.tax_rate * 100)}% on the excess.</p>
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
        <span class="item-title">${esc(h.display_name)} ${(h.offices || []).length ? `<span class="tag on-violet">${esc(h.offices.join(', '))}</span>` : ''}</span>
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

     Two things are readable at a glance, because those are the two the map is
     for. STANDING is the fill, on one scale from allied to at war, so the
     temperature of the world is legible without reading a single label.
     RECOGNITION is the border: a recognised power is drawn solid, an
     unrecognised one hatched and dashed — it is on the map because it exists,
     not because the Republic says it does. Unclaimed land is flat and unlabelled;
     it is nobody's, and naming it would invent a state that has no account, no
     standing and no cabinet.

     Real country names are never rendered here. A territory is called whatever
     the power holding it is called, and nothing else. */
  /* Fixed colours, not theme variables. This is a data scale — allied through
     at war — and it has to mean the same thing in light mode and dark, or a
     player who switches themes learns the map twice. They run cool to warm so
     the ordering survives most colour blindness; the at-war border and the
     legend carry the rest. */
  const STANDING_FILL = {
    allied:   '#2C6A4F',
    friendly: '#5E9078',
    neutral:  '#8B909B',
    strained: '#B8863C',
    hostile:  '#A8362B',
    at_war:   '#7E241C'
  };
  const STANDING_ORDER = ['allied', 'friendly', 'neutral', 'strained', 'hostile', 'at_war'];
  const standingLabel = s => (s === 'at_war' ? 'at war' : String(s || 'neutral'));

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
          fill: STANDING_FILL[p.standing] || STANDING_FILL.neutral
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
          fill: STANDING_FILL[p.standing] || STANDING_FILL.neutral
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

    const republicLabel = (() => {
      const code = [...republicHeld]
        .filter(c => M.centroids[c])
        .sort((a, b) => (M.shapes[b] || '').length - (M.shapes[a] || '').length)[0];
      if (!code) return '';
      const [x, y] = M.centroids[code];
      return `<text class="wm-label" x="${x}" y="${y}">${esc(world.republic?.name || STATE().config.nation_name)}</text>`;
    })();

    const labels = republicLabel + world.powers
      .filter(p => (p.territories || []).length)
      .map(p => {
        const code = p.territories
          .filter(c => M.centroids[c])
          .sort((a, b) => (M.shapes[b] || '').length - (M.shapes[a] || '').length)[0];
        if (!code) return '';
        const [x, y] = M.centroids[code];
        return `<text class="wm-label" x="${x}" y="${y}" data-power="${p.id}">${esc(p.name)}</text>`;
      })
      .join('');

    const unclaimed = Object.keys(M.shapes).length - world.claimed;
    const hasSubdivisionGeometry = Object.keys(S.shapes || {}).length > 0;

    return `<section class="card wm-card">
      <div class="dip-section-head">
        <span class="dip-section-kicker">The world · standing and recognition</span>
        <h2>Powers of the world</h2>
      </div>
      ${world.powers.length ? '' : '<p class="small muted">No foreign powers exist yet, so the world is empty. The Returning Officer creates them below.</p>'}
      ${hasSubdivisionGeometry ? '' : '<p class="small muted territory-map-warning">Subdivision geometry has not been generated yet. Run <code>python tools/generate-world-subdivisions.py</code> from the repository root.</p>'}
      <div class="wm-frame">
        <svg viewBox="0 0 ${M.width} ${M.height}" class="wm-svg" role="img" aria-label="Map of the world by diplomatic standing">
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
        ${STANDING_ORDER.map(k => `<span class="wm-key"><i style="background:${STANDING_FILL[k]}"></i>${standingLabel(k)}</span>`).join('')}
        ${(world.republic?.territories || []).length ? `<span class="wm-key"><i class="wm-key-republic"></i>${esc(world.republic?.name || STATE().config.nation_name)}</span>` : ''}
        ${hasSubdivisionGeometry ? '<span class="wm-key"><i class="wm-key-subdivision"></i>subdivision border</span>' : ''}
        <span class="wm-key" id="wm-preview-key" hidden><i class="wm-key-preview"></i>unsaved edit</span>
        <span class="wm-key"><i class="wm-key-hatch"></i>not recognised</span>
        <span class="wm-key"><i class="wm-key-land"></i>unclaimed (${unclaimed})</span>
      </div>
      ${hasSubdivisionGeometry ? '<p class="small muted wm-boundary-credit">Subdivision boundaries: geoBoundaries gbOpen ADM1 (CC BY 4.0).</p>' : ''}
      <div id="wm-detail" class="wm-detail" hidden></div>
    </section>`;
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
      listEl.innerHTML = visible.length ? visible.map(x => {
        const blocked = blockedSubdivisions.get(String(x.code));
        const checked = selected.has(x.code);
        return `<label class="republic-subdivision-option ${blocked ? 'is-blocked' : ''}">
          <input type="checkbox" value="${esc(x.code)}" ${checked ? 'checked' : ''} ${blocked && !checked ? 'disabled' : ''}>
          <span><strong>${esc(x.name)}</strong><small>${esc([x.type, blocked ? `Held by ${blocked.owner_name || 'another state'}` : ''].filter(Boolean).join(' · '))}</small></span>
        </label>`;
      }).join('') : '<p class="small muted">No subdivisions match that search.</p>';
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
          const data = await api(`/api/admin/territories/subdivisions/${encodeURIComponent(code)}`);
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
      previewFill: STANDING_FILL[power?.standing] || STANDING_FILL.neutral,
      saveUrl: `/api/admin/foreign/powers/${powerId}/territories`,
      refresh
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
          .map(c => `<option value="${c.id}">${esc(c.display_name)}${(c.offices || []).length ? ` — ${esc((c.offices || []).join(', '))}` : ''}</option>`)
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
    const [powers, dispatches, treaties, offers, conflicts, balance, adminPowers, world, fo, republicTerritoryAdmin] = await Promise.all([
      api('/api/diplomacy/powers'),
      api('/api/diplomacy/dispatches'),
      api('/api/diplomacy/treaties'),
      api('/api/diplomacy/offers'),
      api('/api/diplomacy/conflicts'),
      api('/api/diplomacy/balance'),
      me?.is_admin ? api('/api/admin/foreign/powers') : Promise.resolve([]),
      api('/api/diplomacy/map').catch(() => null),
      api('/api/diplomacy/foreign-office').catch(() => null),
      me?.is_admin ? api('/api/admin/republic/territories').catch(() => ({ subdivisions: [], legacy_territories: [] })) : Promise.resolve(null)
    ]);
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

    box.innerHTML = `<div class="diplomacy-office">
      <header class="dip-head"><div><p class="dip-head-code">FOREIGN OFFICE · PUBLIC CHANNEL</p><h1>Diplomacy</h1><p class="muted">Foreign powers speak to the Republic publicly. Official government messages and Returning Officer actions are entered in the public record.</p></div><div class="dip-signal" aria-hidden="true"><span></span><span></span><span></span></div></header>
      ${worldMap(world)}

      ${messageForm}

      ${foreignOffice(fo, canAppointMinister, isMinister, powers)}

      <section class="dip-section"><div class="dip-section-head"><span class="dip-section-kicker">Recognised contacts</span><h2>Powers</h2></div><div class="list dip-powers">${powers.length ? powers.map(p => `<div class="item"><div class="item-top"><span class="item-title"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(p.colour)};margin-right:7px"></span>${esc(p.name)}</span><span>${standing(p)}</span></div>${me && !p.recognised ? `<button class="btn btn-sm" data-recognise="${p.id}">Move recognition</button>` : ''}</div>`).join('') : '<p class="muted">No foreign powers.</p>'}</div></section>

      <section class="dip-section dip-correspondence"><div class="dip-section-head"><span class="dip-section-kicker">Cable traffic · public record</span><h2>Diplomatic correspondence</h2></div><div class="dip-thread">${
        dispatches.length
          ? dispatches
              .slice(0, 50)
              .map(
                d =>
                  `<article class="dip-message ${d.direction === 'outbound' ? 'is-republic' : 'is-foreign'} ${d.in_reply_to ? 'is-reply' : ''}"><div class="dip-message-route"><span class="dip-route-mark">${d.direction === 'outbound' ? 'R' : 'F'}</span><div><span class="dip-sender">${d.direction === 'outbound' ? 'Republic Foreign Office' : esc(d.power_name)}</span><span class="dip-route-detail">${d.direction === 'outbound' ? `To ${esc(d.power_name)}` : 'To the Republic'}</span></div><span class="dip-message-id">#${d.id}</span></div><div class="dip-message-head"><h3>${esc(d.subject)}</h3><div class="dip-message-tags"><span class="tag ${d.message_kind === 'ultimatum' ? 'on-oxide' : d.message_kind === 'treaty_proposal' ? 'on-violet' : d.message_kind === 'trade_proposal' ? 'on-green' : ''}">${kindLabel(d.message_kind)}</span><span class="tag">${d.direction}</span></div></div><p class="dip-meta">${d.in_reply_to ? `In reply to cable #${d.in_reply_to}` : 'New diplomatic thread'}${d.author_name ? ` · authorised by ${esc(d.author_name)}` : ''}</p><div class="dip-message-body">${esc(d.body).replace(/\n/g, '<br>')}</div>${canDiplomat ? `<div class="dip-message-actions"><button class="btn btn-sm" data-reply="${d.id}" data-reply-kind="${esc(d.message_kind || 'dispatch')}" data-reply-subject="${esc(d.subject)}">Reply on this channel</button></div>` : ''}</article>`
              )
              .join('')
          : '<p class="muted">No dispatches.</p>'
      }</div></section>

      <div class="dip-grid">
        <section class="dip-section"><div class="dip-section-head"><span class="dip-section-kicker">Ratification desk</span><h2>Treaties</h2></div><div class="list">${treaties.length ? treaties.map(t => `<div class="item"><div class="item-top"><span class="item-title">${esc(t.title)}</span><span class="tag">${esc(t.republic_status)}</span></div><p class="small muted">${esc(t.power_name)} · ${esc(t.bill_ref || '')}</p></div>`).join('') : '<p class="muted">No treaties.</p>'}</div></section>
        <section class="dip-section"><div class="dip-section-head"><span class="dip-section-kicker">Commercial attaché</span><h2>Foreign market</h2></div><div class="list">${offers.length ? offers.map(o => `<div class="item"><div class="item-top"><span class="item-title">${esc(o.title)} · ${esc(o.power_name)}</span><span class="money">${o.price}</span></div>${me ? `<button class="btn btn-sm" data-foreign-buy="${o.id}">Buy</button>` : ''}</div>`).join('') : '<p class="muted">No foreign offers.</p>'}</div></section>
      </div>

      <div class="dip-grid">
        <section class="dip-section dip-alerts"><div class="dip-section-head"><span class="dip-section-kicker">Alerts & declarations</span><h2>Conflicts</h2></div><div class="list">${conflicts.length ? conflicts.map(c => `<div class="item"><div class="item-top"><span class="item-title">${esc(c.power_name)} · ${esc(c.kind)}</span><span class="tag on-oxide">${esc(c.status)}</span></div><p>${esc(c.grievance)}</p>${me?.is_admin && c.status !== 'resolved' ? `<button class="btn btn-sm" data-resolve-conflict="${c.id}">Record resolution</button>` : ''}</div>`).join('') : '<p class="muted">No conflicts.</p>'}</div></section>
        <section class="dip-section"><div class="dip-section-head"><span class="dip-section-kicker">Economic desk</span><h2>Balance of trade</h2></div><div class="list">${balance.map(b => `<div class="item"><div class="item-top"><span class="item-title">${esc(b.name)}</span><span class="money">net ${b.net}</span></div>
          <div class="dip-ledger">
            <div class="dip-ledger-cell"><span>Their purse</span><strong>${b.purse ?? '—'}</strong><span class="dip-ledger-note">what they can still spend here</span></div>
            <div class="dip-ledger-cell is-surplus"><span>Our exports</span><strong>${b.exports}</strong></div>
            <div class="dip-ledger-cell is-deficit"><span>Our imports</span><strong>${b.imports}</strong></div>
          </div>
          ${b.export_cap ? `<div class="dip-allowance ${Number(b.spent_this_cycle) >= Number(b.export_cap) ? 'is-spent' : ''}"><span style="width:${Math.min(100, Math.round((Number(b.spent_this_cycle) / Number(b.export_cap)) * 100))}%"></span></div>
          <span class="dip-ledger-note">${b.spent_this_cycle} of ${b.export_cap} spent buying from us this cycle</span>` : ''}</div>`).join('')}</div></section>
      </div>

      ${
        me?.is_admin
          ? `<section class="dip-ro"><div class="dip-ro-head"><span class="dip-section-kicker">Restricted operations console</span><h2>Returning Officer — foreign powers</h2></div><p class="small muted">Operational control of foreign powers and their LLM governments. Recognition and treaties still follow the Republic's political rules. Every change made here is written to the public record.</p>
        ${republicTerritoryPicker(world, republicTerritoryAdmin)}
        <div class="card dip-ro-console"><label class="field"><span>Manage power</span><select id="ro-power-select">${adminPowers.map(p => `<option value="${p.id}">${esc(p.name)}${p.revoked_at ? ' (revoked)' : ''}</option>`).join('')}</select></label><div id="ro-power-panel"></div></div>
        <details class="card dip-ro-create"><summary><strong>Create a foreign power</strong></summary><form id="newpower" class="stack" style="margin-top:12px"><div class="grid2"><label class="field"><span>Power name</span><input name="name" required></label><label class="field"><span>Adjective</span><input name="adjective"></label></div><div class="grid2"><label class="field"><span>Colour</span><input name="colour" type="color" value="#5B2E9E"></label><label class="field"><span>Standing</span><select name="standing"><option>neutral</option><option>friendly</option><option>allied</option><option>strained</option><option>hostile</option><option>at_war</option></select></label></div><button class="btn btn-primary">Create power</button><div id="newpowerkey"></div></form></details>
      </section>`
          : ''
      }
    </div>`;

    bindWorldMap(world);
    bindForeignOffice();
    if (me?.is_admin) bindRepublicTerritoryPicker(republicTerritoryAdmin, viewDiplomacy);

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
            toast(`Bought for ${r.total}.`);
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
    if (document.querySelector('#newpower'))
      document.querySelector('#newpower').onsubmit = async ev => {
        ev.preventDefault();
        try {
          const r = await api('/api/admin/foreign/powers', {
            method: 'POST',
            body: Object.fromEntries(new FormData(ev.target))
          });
          document.querySelector('#newpowerkey').innerHTML =
            `<p class="small"><strong>Save this key now; it is shown once.</strong></p><textarea readonly>${esc(r.key)}</textarea>`;
          toast('Foreign power created and recorded.');
        } catch (err) {
          toast(err.message, true);
        }
      };

    async function loadRoPower(id) {
      const panel = document.querySelector('#ro-power-panel');
      if (!panel || !id) return;
      panel.innerHTML = '<p class="muted">Loading…</p>';
      try {
        const p = adminPowers.find(x => String(x.id) === String(id));
        const [detail, territoryAdmin] = await Promise.all([
          api(`/api/admin/foreign/powers/${id}/government`),
          api(`/api/admin/foreign/powers/${id}/territories`)
        ]);
        const g = detail.government || {};
        const agents = detail.agents || [];
        panel.innerHTML = `<div class="stack" style="margin-top:12px">
          <form id="ro-power-edit" class="stack"><div class="grid2"><label class="field"><span>Adjective</span><input name="adjective" value="${esc(p?.adjective || '')}"></label><label class="field"><span>Colour</span><input name="colour" type="color" value="${esc(p?.colour || '#5B2E9E')}"></label></div><label class="field"><span>Standing</span><select name="standing">${['allied', 'friendly', 'neutral', 'strained', 'hostile', 'at_war'].map(x => `<option value="${x}" ${p?.standing === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><button class="btn">Save power settings</button></form>
          <div class="row"><button class="btn btn-sm" id="ro-rotate-key">Rotate foreign API key</button>${p?.revoked_at ? '' : `<button class="btn btn-sm" id="ro-revoke-power">Revoke power</button>`}</div><div id="ro-key-output"></div>
          <h3>LLM government</h3><form id="ro-government" class="stack"><div class="grid2"><label class="field"><span>Decision method</span><select name="decision_method">${['executive', 'cabinet', 'weighted', 'consensus'].map(x => `<option value="${x}" ${g.decision_method === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label class="field"><span>Decision threshold</span><input name="decision_threshold" type="number" min="0" max="1" step="0.05" value="${g.decision_threshold ?? 0.5}"></label></div><label class="field"><span>Max deliberation rounds</span><input name="max_rounds" type="number" min="1" max="4" value="${g.max_rounds ?? 1}"></label><button class="btn">Save government</button></form>
          <h3>Ministers</h3><div class="list">${agents.length ? agents.map(a => `<div class="item"><div class="item-top"><span class="item-title">${esc(a.display_name)} · ${esc(a.role)}</span><span class="tag">${esc(a.model_provider)} / ${esc(a.model_name)}</span></div><p class="small muted">weight ${a.vote_weight} · ${a.active ? 'active' : 'inactive'}</p><button class="btn btn-sm" data-agent-toggle="${a.id}" data-agent-active="${a.active ? '1' : '0'}">${a.active ? 'Deactivate' : 'Activate'}</button></div>`).join('') : '<p class="muted">No ministers configured.</p>'}</div>
          <form id="ro-new-agent" class="stack"><div class="grid2"><label class="field"><span>Role</span><input name="role" placeholder="foreign_minister" required></label><label class="field"><span>Character name</span><input name="display_name" required></label></div><div class="grid2"><label class="field"><span>Free provider</span><select name="model_provider"><option value="groq">groq</option><option value="gemini">gemini</option><option value="openrouter">openrouter</option><option value="mock">mock</option></select></label><label class="field"><span>Model</span><input name="model_name" value="llama-3.1-8b-instant"></label></div><label class="field"><span>Role instructions</span><textarea name="system_prompt" rows="4"></textarea></label><button class="btn">Add minister</button></form>
          ${territoryPicker(id, world, territoryAdmin)}
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
              r.chosen
                ? `Government chose ${r.chosen.action_kind}; action recorded.`
                : 'Government took no action; turn recorded.'
            );
            viewDiplomacy();
          } catch (err) {
            toast(err.message, true);
          }
        };
        document.querySelector('#ro-load-turns').onclick = async () => {
          try {
            const turns = await api(`/api/admin/foreign/powers/${id}/turns`);
            document.querySelector('#ro-turns').innerHTML =
              `<div class="list">${turns.length ? turns.map(t => `<div class="item"><div class="item-top"><span class="item-title">Turn #${t.id} · cycle ${t.cycle_number}</span><span class="tag">${esc(t.status)}</span></div><p class="small muted">chosen proposal ${t.chosen_proposal_id || 'none'} · ${esc(t.created_at || '')}</p></div>`).join('') : '<p class="muted">No turns.</p>'}</div>`;
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
    R.refreshNav();
  })();
})();
