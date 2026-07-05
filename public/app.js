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
  return `<span class="find available"><span class="name">${esc(f.domain)}</span><span class="src">${esc(f.source)} · ${esc((f.foundAt || '').slice(0, 10))}</span></span>`;
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
    return `<span class="find ${cls}"><span class="name">${esc(rippleDisplay[r.domain] || r.domain)}</span></span>`;
  }).join('') || '<span class="quiet">No results' + (availOnly ? ' available' : '') + '.</span>';
}

$('#ripple-available-only').addEventListener('change', renderRipple);

$('#ripple-go').addEventListener('click', async () => {
  const first = wordLists.find((l) => l.id === Number($('#ripple-first').value));
  const second = wordLists.find((l) => l.id === Number($('#ripple-second').value));
  const tld = $('#ripple-tld').value;
  if (!first || !second) return alert('Pick both word lists');

  // The original Name Ripple combination logic: First+Second, concatenated, plus TLD.
  // Checked lowercase (DNS is case-insensitive); displayed as CapitalizedWords for readability.
  const combos = [];
  rippleDisplay = {};
  for (const a of first.words) for (const b of second.words) {
    const lower = (a + b + tld).toLowerCase();
    combos.push(lower);
    rippleDisplay[lower] = cap(a) + cap(b) + tld;
  }

  $('#ripple-go').disabled = true;
  $('#ripple-progress').textContent = `Checking ${combos.length} combinations…`;
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

// ---------- Boot ----------
refreshFinds();
refreshScanLog();
refreshWatchlist();
refreshLists();
refreshScanStatus();
setInterval(refreshScanStatus, 5000);
