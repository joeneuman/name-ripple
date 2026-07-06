// The daily scan: watchlist -> 3-letter sweep -> 4-letter slice -> pronounceable 5s.
// Anything confirmed available lands in db.finds and (if SMTP is configured) the digest.

import { get, save } from './store.js';
import { rdapCheck, checkBatch, sleep } from './checker.js';
import { allThreeLetter, fourLetterSlice, pronounceableFive } from './generator.js';
import { sendDigest } from './mailer.js';

let running = false;
let progress = { phase: 'idle', done: 0, total: 0 };
let liveFinds = []; // finds confirmed so far in the currently running scan

export function scanStatus() {
  return { running, ...progress, finds: liveFinds, lastScanAt: get().scanLog[0]?.at || null };
}

export async function runDailyScan(env = process.env) {
  if (running) return { skipped: true, reason: 'scan already running' };
  running = true;
  liveFinds = [];
  const started = Date.now();
  const db = get();
  const newFinds = [];
  const watchlistChanges = [];

  try {
    // --- 1. Watchlist: authoritative RDAP on every entry (small list, direct) ---
    progress = { phase: 'watchlist', done: 0, total: db.watchlist.length };
    for (const entry of db.watchlist) {
      const prev = entry.lastCheck?.status;
      const result = await rdapCheck(entry.domain);
      entry.lastCheck = { at: new Date().toISOString(), ...result };
      if (result.status === 'available' && prev !== 'available') {
        watchlistChanges.push(entry.domain);
        newFinds.push({ domain: entry.domain, source: 'watchlist', foundAt: new Date().toISOString() });
        liveFinds.push({ domain: entry.domain, source: 'watchlist' });
      }
      progress.done++;
      await sleep(300);
    }

    // --- 2. Three-letter full sweep (drop-catching lottery) ---
    let threeChecked = 0;
    if ((env.SCAN_THREE_FULL ?? 'true') !== 'false') {
      const domains = allThreeLetter();
      threeChecked = domains.length;
      progress = { phase: '3-letter sweep', done: 0, total: domains.length };
      const results = await checkBatch(domains, {
        dnsConcurrency: Number(env.DNS_CONCURRENCY) || 50,
        onProgress: (d, t) => (progress = { phase: '3-letter sweep', done: d, total: t }),
        onFind: (domain) => liveFinds.push({ domain, source: '3-letter' }),
      });
      for (const r of results) {
        if (r.status === 'available') newFinds.push({ domain: r.domain, source: '3-letter', foundAt: new Date().toISOString() });
      }
    }

    // --- 3. Four-letter rotating slice ---
    const sliceSize = Number(env.SCAN_FOUR_SLICE) || 10000;
    const { domains: fourDomains, nextCursor } = fourLetterSlice(db.fourLetterCursor || 0, sliceSize);
    progress = { phase: '4-letter slice', done: 0, total: fourDomains.length };
    const fourResults = await checkBatch(fourDomains, {
      dnsConcurrency: Number(env.DNS_CONCURRENCY) || 50,
      onProgress: (d, t) => (progress = { phase: '4-letter slice', done: d, total: t }),
      onFind: (domain) => liveFinds.push({ domain, source: '4-letter' }),
    });
    db.fourLetterCursor = nextCursor;
    for (const r of fourResults) {
      if (r.status === 'available') newFinds.push({ domain: r.domain, source: '4-letter', foundAt: new Date().toISOString() });
    }

    // --- 4. Pronounceable 5-letter candidates ---
    const fiveCount = Number(env.SCAN_FIVE_COUNT) || 500;
    const fiveDomains = pronounceableFive(fiveCount);
    progress = { phase: '5-letter brandables', done: 0, total: fiveDomains.length };
    const fiveResults = await checkBatch(fiveDomains, {
      dnsConcurrency: Number(env.DNS_CONCURRENCY) || 50,
      onProgress: (d, t) => (progress = { phase: '5-letter brandables', done: d, total: t }),
      onFind: (domain) => liveFinds.push({ domain, source: '5-letter' }),
    });
    for (const r of fiveResults) {
      if (r.status === 'available') newFinds.push({ domain: r.domain, source: '5-letter', foundAt: new Date().toISOString() });
    }

    // --- Persist finds (dedupe against history) ---
    const known = new Set(db.finds.map((f) => f.domain));
    const fresh = newFinds.filter((f) => !known.has(f.domain));
    db.finds.unshift(...fresh);
    if (db.finds.length > 5000) db.finds.length = 5000;

    db.scanLog.unshift({
      at: new Date().toISOString(),
      watchlistChecked: db.watchlist.length,
      threeChecked,
      fourChecked: fourDomains.length,
      fiveChecked: fiveDomains.length,
      confirmedAvailable: fresh.length,
      durationMs: Date.now() - started,
    });
    if (db.scanLog.length > 90) db.scanLog.length = 90;
    save();

    // --- Digest ---
    if (fresh.length > 0 || watchlistChanges.length > 0) {
      await sendDigest({ fresh, watchlistChanges }, env).catch((err) =>
        console.error('digest send failed:', err.message)
      );
    }

    return { fresh: fresh.length, watchlistChanges, durationMs: Date.now() - started };
  } finally {
    running = false;
    progress = { phase: 'idle', done: 0, total: 0 };
    liveFinds = [];
  }
}
