import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
// Load .env from the app folder, not the process's working directory,
// so the app behaves the same no matter where it's launched from.
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

import express from 'express';
import cron from 'node-cron';
import crypto from 'node:crypto';
import { get, save } from './store.js';
import { checkDomain, checkBatch } from './checker.js';
import { runDailyScan, scanStatus } from './scan.js';
import { generateWordList, evaluateName, pickNames } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));

// Serve under a subpath (e.g. BASE_PATH=/nameripple behind nginx at hackbed.com/nameripple).
// All routes below are defined on `route` and mounted at BASE. Frontend uses relative URLs.
const BASE = (process.env.BASE_PATH || '').replace(/\/+$/, '');
const route = express.Router();

// Optional basic auth (set AUTH_USER/AUTH_PASS in .env before exposing publicly)
if (process.env.AUTH_USER) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [user, pass] = Buffer.from(header.split(' ')[1] || '', 'base64').toString().split(':');
    if (user === process.env.AUTH_USER && pass === process.env.AUTH_PASS) return next();
    res.set('WWW-Authenticate', 'Basic realm="urlscoop"').status(401).send('Auth required');
  });
}

route.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- Watchlist ----------
route.get('/api/watchlist', (req, res) => res.json(get().watchlist));

route.post('/api/watchlist', async (req, res) => {
  const domain = String(req.body.domain || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+\.[a-z]{2,}$/.test(domain)) return res.status(400).json({ error: 'Enter a valid domain like atozion.com' });
  const db = get();
  if (db.watchlist.some((w) => w.domain === domain)) return res.status(409).json({ error: 'Already watching that domain' });
  const entry = { domain, note: String(req.body.note || ''), addedAt: new Date().toISOString(), lastCheck: null };
  // Check it immediately so the row is never blank
  entry.lastCheck = { at: new Date().toISOString(), ...(await checkDomain(domain)) };
  db.watchlist.push(entry);
  save();
  res.json(entry);
});

route.delete('/api/watchlist/:domain', (req, res) => {
  const db = get();
  const before = db.watchlist.length;
  db.watchlist = db.watchlist.filter((w) => w.domain !== req.params.domain.toLowerCase());
  save();
  res.json({ removed: before - db.watchlist.length });
});

// ---------- Word lists (Name Ripple) ----------
route.get('/api/lists', (req, res) => res.json(get().wordLists));

route.post('/api/lists', (req, res) => {
  const { name, words } = req.body;
  if (!name?.trim() || !Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'Need a list name and at least one word' });
  }
  const db = get();
  if (db.wordLists.some((l) => l.name.toLowerCase() === name.trim().toLowerCase())) {
    return res.status(409).json({ error: `A list named "${name.trim()}" already exists — delete it first.` });
  }
  const id = Math.max(0, ...db.wordLists.map((l) => l.id)) + 1;
  const list = { id, name: name.trim(), words: words.map((w) => String(w).trim().toLowerCase()).filter(Boolean) };
  db.wordLists.push(list);
  save();
  res.json(list);
});

route.delete('/api/lists/:id', (req, res) => {
  const db = get();
  db.wordLists = db.wordLists.filter((l) => l.id !== Number(req.params.id));
  save();
  res.json({ ok: true });
});

// ---------- AI: prompt -> word list ----------
route.post('/api/ai/wordlist', async (req, res) => {
  const prompt = String(req.body.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'Describe the list you want, e.g. "kitchen items"' });
  try {
    const { name, words } = await generateWordList(prompt);
    if (words.length === 0) return res.status(502).json({ error: 'The AI returned no usable words — try rephrasing' });
    const db = get();
    if (db.wordLists.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: `A list named "${name}" already exists — delete it first or ask for something different.` });
    }
    const id = Math.max(0, ...db.wordLists.map((l) => l.id)) + 1;
    const list = { id, name, words };
    db.wordLists.push(list);
    save();
    res.json(list);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ---------- AI: evaluate a shortlisted name ----------
route.post('/api/shortlist/:domain/evaluate', async (req, res) => {
  const db = get();
  const entry = db.shortlist.find((s) => s.domain === req.params.domain.toLowerCase());
  if (!entry) return res.status(404).json({ error: 'Not on shortlist' });
  try {
    entry.ai = await evaluateName(entry.display, entry.domain);
    save();
    res.json(entry);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ---------- AI: pick shortlist-worthy names from ripple results ----------
route.post('/api/ripple/pick', async (req, res) => {
  const candidates = (req.body.candidates || [])
    .map((c) => ({ domain: String(c.domain || '').toLowerCase(), display: String(c.display || c.domain || '') }))
    .filter((c) => /^[a-z0-9-]+\.[a-z]{2,}$/.test(c.domain));
  if (candidates.length === 0) return res.status(400).json({ error: 'No available names to pick from' });
  if (candidates.length > 300) return res.status(400).json({ error: 'Too many candidates (max 300)' });
  try {
    const picks = await pickNames(candidates);
    const db = get();
    const added = [];
    for (const pick of picks) {
      const c = candidates.find((x) => x.display.toLowerCase() === pick.name.toLowerCase() || x.domain === pick.name.toLowerCase());
      if (!c || db.shortlist.some((s) => s.domain === c.domain)) continue;
      db.shortlist.unshift({
        domain: c.domain,
        display: c.display,
        addedAt: new Date().toISOString(),
        criteria: { unique: false, positive: false, memorable: false },
        pickReason: pick.reason,
      });
      added.push({ display: c.display, reason: pick.reason });
    }
    save();
    res.json({ added, considered: candidates.length });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ---------- Ripple check jobs ----------
// Client generates combos, posts them here; job checks DNS-fast then RDAP-confirms
// candidates; client polls for progress. Jobs live in memory.
const jobs = new Map();

route.post('/api/ripple/jobs', (req, res) => {
  const domains = [...new Set((req.body.domains || []).map((d) => String(d).trim().toLowerCase()).filter((d) => /^[a-z0-9-]+\.[a-z]{2,}$/.test(d)))];
  if (domains.length === 0) return res.status(400).json({ error: 'No valid domains' });
  if (domains.length > 5000) return res.status(400).json({ error: 'Max 5000 combos per run' });

  const id = crypto.randomUUID();
  const job = { id, total: domains.length, done: 0, results: [], finished: false, startedAt: Date.now() };
  jobs.set(id, job);

  checkBatch(domains, {
    dnsConcurrency: 25,
    onProgress: (done) => (job.done = done),
  })
    .then((results) => {
      job.results = results;
      job.finished = true;
    })
    .catch((err) => {
      job.error = err.message;
      job.finished = true;
    });

  // Expire jobs after an hour
  setTimeout(() => jobs.delete(id), 3600_000).unref();
  res.json({ jobId: id });
});

route.get('/api/ripple/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found (expired?)' });
  res.json(job);
});

// ---------- Shortlist (starred names + three-criteria rubric) ----------
route.get('/api/shortlist', (req, res) => res.json(get().shortlist));

route.post('/api/shortlist', (req, res) => {
  const domain = String(req.body.domain || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+\.[a-z]{2,}$/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const db = get();
  if (db.shortlist.some((s) => s.domain === domain)) return res.status(409).json({ error: 'Already shortlisted' });
  const entry = {
    domain,
    display: String(req.body.display || domain),
    addedAt: new Date().toISOString(),
    criteria: { unique: false, positive: false, memorable: false },
  };
  db.shortlist.unshift(entry);
  save();
  res.json(entry);
});

route.post('/api/shortlist/:domain/criteria', (req, res) => {
  const db = get();
  const entry = db.shortlist.find((s) => s.domain === req.params.domain.toLowerCase());
  if (!entry) return res.status(404).json({ error: 'Not on shortlist' });
  const { key, value } = req.body;
  if (!['unique', 'positive', 'memorable'].includes(key)) return res.status(400).json({ error: 'Unknown criterion' });
  entry.criteria[key] = Boolean(value);
  save();
  res.json(entry);
});

route.delete('/api/shortlist/:domain', (req, res) => {
  const db = get();
  const before = db.shortlist.length;
  db.shortlist = db.shortlist.filter((s) => s.domain !== req.params.domain.toLowerCase());
  save();
  res.json({ removed: before - db.shortlist.length });
});

// ---------- Finds + scan control ----------
route.get('/api/finds', (req, res) => res.json(get().finds.slice(0, 500)));
route.get('/api/scanlog', (req, res) => res.json(get().scanLog));
route.get('/api/scan/status', (req, res) => res.json(scanStatus()));

route.post('/api/scan/run', (req, res) => {
  const status = scanStatus();
  if (status.running) return res.status(409).json({ error: 'Scan already running' });
  const COOLDOWN_MS = 4 * 60 * 60 * 1000;
  const sinceLast = status.lastScanAt ? Date.now() - new Date(status.lastScanAt).getTime() : Infinity;
  if (sinceLast < COOLDOWN_MS) {
    const mins = Math.ceil((COOLDOWN_MS - sinceLast) / 60000);
    return res.status(429).json({ error: `Scans are limited to one every 4 hours — try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
  }
  runDailyScan().catch((err) => console.error('manual scan failed:', err));
  res.json({ started: true });
});

// Quick one-off check (used by the dashboard's "check a domain" box)
route.get('/api/check/:domain', async (req, res) => {
  const domain = req.params.domain.toLowerCase();
  if (!/^[a-z0-9-]+\.[a-z]{2,}$/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  res.json(await checkDomain(domain));
});

app.use(BASE || '/', route);
if (BASE) app.get('/', (req, res) => res.redirect(BASE + '/'));

// ---------- Cron ----------
// Default: 18:00 UTC — ~90% through Verisign's daily ~11am-2pm ET deletion batch
// (2pm EDT / 1pm EST). Early beats thorough for luck-based catches. Override with CRON_SCHEDULE.
const schedule = process.env.CRON_SCHEDULE || '0 18 * * *';
cron.schedule(schedule, () => {
  console.log(`[cron] daily scan starting (${new Date().toISOString()})`);
  runDailyScan().then((r) => console.log('[cron] scan done:', JSON.stringify(r))).catch((err) => console.error('[cron] scan failed:', err));
});

const port = Number(process.env.PORT) || 3100;
app.listen(port, () => {
  console.log(`URL Scoop running on http://localhost:${port}${BASE || ''} — daily scan at cron "${schedule}"`);
});
