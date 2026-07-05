import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { get, save } from './store.js';
import { checkDomain, checkBatch } from './checker.js';
import { runDailyScan, scanStatus } from './scan.js';

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

// ---------- Finds + scan control ----------
route.get('/api/finds', (req, res) => res.json(get().finds.slice(0, 500)));
route.get('/api/scanlog', (req, res) => res.json(get().scanLog));
route.get('/api/scan/status', (req, res) => res.json(scanStatus()));

route.post('/api/scan/run', (req, res) => {
  const status = scanStatus();
  if (status.running) return res.status(409).json({ error: 'Scan already running' });
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
const schedule = process.env.CRON_SCHEDULE || '15 6 * * *';
cron.schedule(schedule, () => {
  console.log(`[cron] daily scan starting (${new Date().toISOString()})`);
  runDailyScan().then((r) => console.log('[cron] scan done:', JSON.stringify(r))).catch((err) => console.error('[cron] scan failed:', err));
});

const port = Number(process.env.PORT) || 3100;
app.listen(port, () => {
  console.log(`URL Scoop running on http://localhost:${port}${BASE || ''} — daily scan at cron "${schedule}"`);
});
