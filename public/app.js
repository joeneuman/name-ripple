// URL Scoop frontend — vanilla JS, no build step.

const $ = (sel) => document.querySelector(sel);
// Relative URL so the app works at the domain root locally AND under a
// subpath in production (e.g. hackbed.com/nameripple/ -> nameripple/api/...).
const api = async (path, opts) => {
  const res = await fetch('api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Tabs ----------
document.querySelectorAll('nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ---------- Dashboard ----------
$('#quickcheck-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const domain = $('#quickcheck-input').value.trim().toLowerCase();
  if (!domain) return;
  const out = $('#quickcheck-result');
  out.textContent = 'Checking ' + domain + '…';
  try {
    const r = await api('/check/' + encodeURIComponent(domain));
    if (r.status === 'available') {
      out.innerHTML = `<span class="status-available">${esc(domain)} is AVAILABLE</span> (confirmed by registry RDAP)`;
    } else if (r.status === 'registered') {
      out.innerHTML = `<span class="status-registered">${esc(domain)} is registered</span>` +
        (r.expires ? ` — expires ${esc(r.expires.slice(0, 10))}` : '') +
        (r.registrar ? ` via ${esc(r.registrar)}` : '');
    } else {
      out.innerHTML = `<span class="status-unknown">Couldn't determine status: ${esc(r.reason || 'unknown')}</span>`;
    }
  } catch (err) {
    out.innerHTML = `<span class="status-unknown">${esc(err.message)}</span>`;
  }
});

async function refreshScanStatus() {
  try {
    const s = await api('/scan/status');
    $('#scan-status').textContent = s.running
      ? `Running: ${s.phase} — ${s.done.toLocaleString()} / ${s.total.toLocaleString()}`
      : 'Idle. Next run per server cron schedule.';
    $('#scan-now').disabled = s.running;
  } catch { /* server restarting */ }
}

$('#scan-now').addEventListener('click', async () => {
  try { await api('/scan/run', { method: 'POST' }); } catch (err) { alert(err.message); }
  refreshScanStatus();
});

function findChip(f) {
  return `<span class="find available"><span class="name">${esc(f.domain)}<span class="src">${esc(f.source)} · ${esc((f.foundAt || '').slice(0, 10))}</span></span></span>`;
}

async function refreshFinds() {
  const finds = await api('/finds');
  $('#finds-count').textContent = finds.length;
  $('#finds').innerHTML = finds.length
    ? finds.map(findChip).join('')
    : '<span class="quiet">Nothing yet — the first scan will populate this.</span>';
}

async function refreshScanLog() {
  const log = await api('/scanlog');
  $('#scanlog tbody').innerHTML = log.map((l) => `<tr>
    <td>${esc(l.at.slice(0, 16).replace('T', ' '))}</td>
    <td>${l.watchlistChecked}</td><td>${l.threeChecked.toLocaleString()}</td>
    <td>${l.fourChecked.toLocaleString()}</td><td>${l.fiveChecked.toLocaleString()}</td>
    <td><b>${l.confirmedAvailable}</b></td>
    <td>${Math.round(l.durationMs / 1000)}s</td>
  </tr>`).join('') || '<tr><td colspan="7" class="quiet">No scans yet.</td></tr>';
}

// ---------- Watchlist ----------
async function refreshWatchlist() {
  const list = await api('/watchlist');
  $('#watchlist-table tbody').innerHTML = list.map((w) => {
    const lc = w.lastCheck || {};
    const statusClass = lc.status === 'available' ? 'status-available' : lc.status === 'registered' ? 'status-registered' : 'status-unknown';
    return `<tr>
      <td class="mono">${esc(w.domain)}</td>
      <td class="${statusClass}">${esc(lc.status || 'not checked yet')}</td>
      <td>${esc(lc.expires ? lc.expires.slice(0, 10) : '—')}</td>
      <td>${esc(lc.registrar || '—')}</td>
      <td>${esc(w.note || '')}</td>
      <td><button class="danger" data-unwatch="${esc(w.domain)}">remove</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="quiet">Watchlist is empty.</td></tr>';

  document.querySelectorAll('[data-unwatch]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api('/watchlist/' + encodeURIComponent(btn.dataset.unwatch), { method: 'DELETE' });
      refreshWatchlist();
    });
  });
}

$('#watch-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#watch-error').textContent = '';
  try {
    await api('/watchlist', {
      method: 'POST',
      body: JSON.stringify({ domain: $('#watch-domain').value, note: $('#watch-note').value }),
    });
    $('#watch-domain').value = '';
    $('#watch-note').value = '';
    refreshWatchlist();
  } catch (err) {
    $('#watch-error').textContent = err.message;
  }
});

// ---------- Word lists ----------
let wordLists = [];

async function refreshLists() {
  wordLists = await api('/lists');
  // Ripple pickers
  const opts = wordLists.map((l) => `<option value="${l.id}">${esc(l.name)} (${l.words.length})</option>`).join('');
  $('#ripple-first').innerHTML = opts;
  $('#ripple-second').innerHTML = opts;
  // Manager
  $('#lists-container').innerHTML = wordLists.map((l) => `<div class="wordlist">
    <h3>${esc(l.name)} <button class="danger" data-dellist="${l.id}">delete</button></h3>
    <div class="words">${l.words.map(esc).join(', ')}</div>
  </div>`).join('');
  document.querySelectorAll('[data-dellist]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api('/lists/' + btn.dataset.dellist, { method: 'DELETE' });
      refreshLists();
    });
  });
}

$('#ai-list-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = $('#ai-prompt').value.trim();
  if (!prompt) return;
  $('#ai-list-go').disabled = true;
  $('#ai-list-status').textContent = 'Asking the AI for 20 words…';
  try {
    const list = await api('/ai/wordlist', { method: 'POST', body: JSON.stringify({ prompt }) });
    $('#ai-list-status').textContent = `Added "${list.name}" (${list.words.length} words) — ready in the Ripple tab.`;
    $('#ai-prompt').value = '';
    refreshLists();
  } catch (err) {
    $('#ai-list-status').textContent = err.message;
  }
  $('#ai-list-go').disabled = false;
});

$('#list-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const words = $('#list-words').value.split('\n').map((w) => w.trim()).filter(Boolean);
  try {
    await api('/lists', { method: 'POST', body: JSON.stringify({ name: $('#list-name').value, words }) });
    $('#list-name').value = '';
    $('#list-words').value = '';
    refreshLists();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Ripple ----------
let rippleResults = [];
// Maps the checked (lowercase) domain back to its readable CapitalizedWords form,
// e.g. "coolbyte.com" -> "CoolByte.com", so you can see which two words combined.
let rippleDisplay = {};
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

function renderRipple() {
  const availOnly = $('#ripple-available-only').checked;
  const shown = availOnly ? rippleResults.filter((r) => r.status === 'available') : rippleResults;
  $('#ripple-results').innerHTML = shown.map((r) => {
    const cls = r.status === 'available' ? 'available' : r.status === 'registered' ? 'registered' : 'unknown';
    const starred = shortlisted.has(r.domain);
    const star = r.status === 'available'
      ? `<button class="star${starred ? ' starred' : ''}" data-star="${esc(r.domain)}" title="${starred ? 'On shortlist' : 'Add to shortlist'}" ${starred ? 'disabled' : ''}>${starred ? '★' : '☆'}</button>`
      : '';
    return `<span class="find ${cls}">${star}<span class="name">${esc(rippleDisplay[r.domain] || r.domain)}</span></span>`;
  }).join('') || '<span class="quiet">No results' + (availOnly ? ' available' : '') + '.</span>';

  document.querySelectorAll('#ripple-results [data-star]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.star;
      try {
        await api('/shortlist', {
          method: 'POST',
          body: JSON.stringify({ domain, display: rippleDisplay[domain] || domain }),
        });
      } catch (err) {
        if (!/Already/.test(err.message)) return alert(err.message);
      }
      await refreshShortlist();
      renderRipple();
    });
  });
}

$('#ripple-available-only').addEventListener('change', renderRipple);

$('#ripple-pick').addEventListener('click', async () => {
  const candidates = rippleResults
    .filter((r) => r.status === 'available')
    .map((r) => ({ domain: r.domain, display: rippleDisplay[r.domain] || r.domain }));
  const btn = $('#ripple-pick');
  btn.disabled = true;
  btn.textContent = 'Picking…';
  try {
    const { added, considered } = await api('/ripple/pick', {
      method: 'POST',
      body: JSON.stringify({ candidates }),
    });
    $('#ripple-progress').textContent = added.length
      ? `AI shortlisted ${added.length} of ${considered}: ${added.map((a) => a.display).join(', ')} — see Shortlist below.`
      : `AI looked at all ${considered} and shortlisted none — none stood out.`;
    await refreshShortlist();
    renderRipple();
  } catch (err) {
    alert(err.message);
  }
  btn.disabled = false;
  btn.textContent = 'AI pick the best';
});

$('#ripple-go').addEventListener('click', async () => {
  const first = wordLists.find((l) => l.id === Number($('#ripple-first').value));
  const second = wordLists.find((l) => l.id === Number($('#ripple-second').value));
  const tld = $('#ripple-tld').value;
  if (!first || !second) return alert('Pick both word lists');

  // The original Name Ripple combination logic: First+Second, concatenated, plus TLD.
  // Checked lowercase (DNS is case-insensitive); displayed as CapitalizedWords for readability.
  // Optional max length applies to the name itself, not the TLD.
  const maxLen = Number($('#ripple-maxlen').value) || Infinity;
  const combos = [];
  let skipped = 0;
  rippleDisplay = {};
  for (const a of first.words) for (const b of second.words) {
    if (a.length + b.length > maxLen) { skipped++; continue; }
    const lower = (a + b + tld).toLowerCase();
    combos.push(lower);
    rippleDisplay[lower] = cap(a) + cap(b) + tld;
  }
  if (combos.length === 0) return alert(`Every combination is longer than ${maxLen} letters — raise the max length.`);

  $('#ripple-go').disabled = true;
  $('#ripple-progress').textContent = `Checking ${combos.length} combinations…` + (skipped ? ` (${skipped} skipped as too long)` : '');
  rippleResults = [];
  renderRipple();

  try {
    const { jobId } = await api('/ripple/jobs', { method: 'POST', body: JSON.stringify({ domains: combos }) });
    const poll = setInterval(async () => {
      try {
        const job = await api('/ripple/jobs/' + jobId);
        $('#ripple-progress').textContent = job.finished
          ? `Done — ${job.results.filter((r) => r.status === 'available').length} available of ${job.total}`
          : `Checking… ${job.done} / ${job.total} (then RDAP-confirming candidates)`;
        if (job.finished) {
          clearInterval(poll);
          $('#ripple-go').disabled = false;
          rippleResults = (job.results || []).sort((a, b) => (a.status === 'available' ? -1 : 1) - (b.status === 'available' ? -1 : 1));
          renderRipple();
          $('#ripple-pick').hidden = !rippleResults.some((r) => r.status === 'available');
        }
      } catch (err) {
        clearInterval(poll);
        $('#ripple-go').disabled = false;
        $('#ripple-progress').textContent = err.message;
      }
    }, 800);
  } catch (err) {
    $('#ripple-go').disabled = false;
    $('#ripple-progress').textContent = err.message;
  }
});

// ---------- Shortlist ----------
let shortlisted = new Set();

function aiReportHtml(s) {
  if (!s.ai) return '';
  const a = s.ai;
  const critRow = (label, c) => `<div class="ai-crit ai-${esc(c.rating)}"><b>${label}:</b> ${esc(c.rating)} — ${esc(c.reason)}</div>`;
  return `<tr class="ai-report-row"><td colspan="6">
    <div class="ai-report">
      <span class="ai-verdict ai-verdict-${esc(a.verdict)}">${esc(a.verdict)}</span>
      <p>${esc(a.summary)}</p>
      ${critRow('Unique', a.criteria.unique)}${critRow('Positive response', a.criteria.positive)}${critRow('Memorable', a.criteria.memorable)}
      ${a.soundsLike?.length ? `<div class="ai-list"><b>Sounds like:</b> ${a.soundsLike.map(esc).join(' · ')}</div>` : ''}
      ${a.risks?.length ? `<div class="ai-list"><b>Risks:</b> ${a.risks.map(esc).join(' · ')}</div>` : ''}
    </div>
  </td></tr>`;
}

async function refreshShortlist() {
  const list = await api('/shortlist');
  shortlisted = new Set(list.map((s) => s.domain));

  const CRITERIA = ['unique', 'positive', 'memorable'];
  $('#shortlist-table tbody').innerHTML = list.map((s) => {
    const passes = CRITERIA.filter((k) => s.criteria[k]).length;
    return `<tr>
      <td class="mono">${esc(s.display)}${passes === 3 ? ' <span class="all-three" title="Passes all three">✓✓✓</span>' : ''}${s.pickReason ? `<div class="pick-reason">AI pick: ${esc(s.pickReason)}</div>` : ''}</td>
      ${CRITERIA.map((k) => `<td><input type="checkbox" data-crit="${k}" data-domain="${esc(s.domain)}" ${s.criteria[k] ? 'checked' : ''}></td>`).join('')}
      <td>${esc((s.addedAt || '').slice(0, 10))}</td>
      <td class="row-actions">
        <button class="secondary small" data-evaluate="${esc(s.domain)}">${s.ai ? 'Re-evaluate' : 'Evaluate'}</button>
        <button class="danger" data-unstar="${esc(s.domain)}">remove</button>
      </td>
    </tr>${aiReportHtml(s)}`;
  }).join('') || '<tr><td colspan="6" class="quiet">Nothing starred yet — run a Ripple check and star the names that make you pause.</td></tr>';

  document.querySelectorAll('#shortlist-table [data-evaluate]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Evaluating…';
      try {
        await api('/shortlist/' + encodeURIComponent(btn.dataset.evaluate) + '/evaluate', { method: 'POST' });
        refreshShortlist();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = 'Evaluate';
      }
    });
  });

  document.querySelectorAll('#shortlist-table [data-crit]').forEach((box) => {
    box.addEventListener('change', async () => {
      await api('/shortlist/' + encodeURIComponent(box.dataset.domain) + '/criteria', {
        method: 'POST',
        body: JSON.stringify({ key: box.dataset.crit, value: box.checked }),
      });
      refreshShortlist();
    });
  });
  document.querySelectorAll('#shortlist-table [data-unstar]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api('/shortlist/' + encodeURIComponent(btn.dataset.unstar), { method: 'DELETE' });
      await refreshShortlist();
      renderRipple();
    });
  });
}

// ---------- Boot ----------
refreshFinds();
refreshScanLog();
refreshWatchlist();
refreshLists();
refreshShortlist();
refreshScanStatus();
setInterval(refreshScanStatus, 5000);
