// Tiny JSON persistence: one data file, atomic writes, no native deps.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const DEFAULTS = {
  watchlist: [
    // domain, note, addedAt, lastCheck: {at, status, registrar, expires}
    { domain: 'atozion.com', note: 'Old Greater Zion tourism brand — waiting for it to drop', addedAt: null, lastCheck: null },
  ],
  wordLists: [
    { id: 1, name: 'Adjectives', words: ['cool','awesome','smart','bright','quick','easy','fresh','good','happy','swift','clever','bold','prime','super','ultra'] },
    { id: 2, name: 'Tech Words', words: ['tech','code','app','web','dev','byte','data','cloud','cyber','net','bit','soft','stack','node','api'] },
    { id: 3, name: 'Business Words', words: ['pro','biz','corp','hub','lab','team','work','sync','flow','peak','lead','edge','core','plus','max'] },
    { id: 4, name: 'Creative Words', words: ['art','mind','idea','spark','wave','flex','flux','nova','zen','vibe','echo','pulse','soul','dash','leap'] },
  ],
  // Available domains discovered by any scan. {domain, source, foundAt, confirmedBy}
  finds: [],
  // Rotating cursor into the 4-letter space (index into base-26 enumeration)
  fourLetterCursor: 0,
  scanLog: [], // {at, watchlistChecked, threeChecked, fourChecked, fiveChecked, candidates, confirmedAvailable, durationMs}
};

let db = null;

export function load() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    db = { ...structuredClone(DEFAULTS), ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
  } else {
    db = structuredClone(DEFAULTS);
    save();
  }
  return db;
}

export function save() {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

export function get() {
  return load();
}
