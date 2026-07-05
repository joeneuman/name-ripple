# URL Scoop

Daily domain drop-watcher + Name Ripple combination checker, in one small Node app.

**What it does, once a day (cron):**
1. **Watchlist** — every domain you've manually added (e.g. `atozion.com`) is checked
   against registry RDAP. The day one drops, it's flagged and emailed.
2. **3-letter sweep** — all 17,576 three-letter .coms, DNS-prefiltered then
   RDAP-confirmed. All are registered today; this catches the rare drop.
3. **4-letter slice** — rotates through all 456,976 four-letter .coms in daily
   slices (default 10,000/day ≈ full cycle every 46 days).
4. **5-letter brandables** — generates ~500 fresh pronounceable five-letter names
   (CVCVC-style) and checks them. This is where real available finds show up daily.

**Plus the Ripple tab** — the Name Ripple workflow: pick two word lists and a TLD,
every First+Second combination is generated and checked with live progress.

## How availability is checked (two stages)

- **DNS prefilter** (fast, thousands/minute): NXDOMAIN nominates a candidate.
- **RDAP confirm** (authoritative): the registry's own RDAP endpoint. HTTP 404 =
  truly not registered = available. This kills the false positives that DNS-only
  checkers (including old Name Ripple) suffer from — registered domains with no
  DNS still show as taken, and we get registrar + expiry dates for free.

## Run locally

```bash
npm install
cp .env.example .env   # edit if desired
npm start              # http://localhost:3100
npm run scan           # trigger one full scan from the CLI
```

Data lives in `data/db.json` (gitignored). No database server needed.

## Deploy on the DigitalOcean project server (hackbed.com/nameripple)

DNS: point an A record for `hackbed.com` at the droplet (143.198.105.249).

```bash
# on the droplet
git clone -b urlscoop https://github.com/joeneuman/name-ripple.git nameripple
cd nameripple
npm install --omit=dev
cp .env.example .env && nano .env    # set BASE_PATH=/nameripple, SMTP + AUTH at minimum

# keep it running with pm2
npm install -g pm2
pm2 start src/server.js --name nameripple
pm2 save && pm2 startup
```

Nginx (TLS via certbot afterwards):

```nginx
server {
    server_name hackbed.com;
    location /nameripple/ {
        proxy_pass http://127.0.0.1:3100;   # no trailing path: prefix passes through
        proxy_set_header Host $host;
    }
    location = /nameripple { return 301 /nameripple/; }
}
```

`BASE_PATH=/nameripple` in `.env` makes the app serve itself under that prefix,
so nginx doesn't need to rewrite anything. Leave `BASE_PATH` empty when running
at a domain root or locally.

The daily scan runs **inside the Node process** via node-cron (`CRON_SCHEDULE`,
default 06:15 server time) — no system crontab needed. If you'd rather use system
cron, disable by leaving the process off-hours and run `npm run scan` from crontab.

## Email digest

Fill the `SMTP_*` vars in `.env` (any SMTP provider — e.g. a Gmail app password,
Resend, Mailgun). Leave `SMTP_HOST` blank to skip email; finds still accumulate on
the dashboard. The digest only sends on days something was actually found, and
watchlist drops get a 🎯 headline.

## Security note

Set `AUTH_USER` / `AUTH_PASS` in `.env` before exposing the port publicly —
otherwise anyone can run scans on your box. The Ripple checker caps at 5,000
combos per run and RDAP confirms are rate-limited to stay polite to registries.

## Rate-limit etiquette

Verisign's RDAP endpoint throttles aggressive clients. The scanner only sends
RDAP requests for DNS-NXDOMAIN candidates (a tiny fraction), serially, with a
250 ms gap and exponential backoff on 429. Don't crank `SCAN_FOUR_SLICE` past
~50k/day or the DNS resolvers may start throttling too.
