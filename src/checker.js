// Two-stage availability check.
//
// Stage 1 (cheap): DNS NS lookup. NXDOMAIN means "no delegation in the registry",
// which is what unregistered domains return — but so do a handful of registered
// domains in serverHold/pendingDelete. So NXDOMAIN only nominates a candidate.
//
// Stage 2 (authoritative): registry RDAP. HTTP 404 = not in the registry = truly
// available to register. 200 = registered (we also pull registrar + expiry).
//
// This mirrors how the commercial expired-domain scanners work, and it's the same
// RDAP check validated in research: e.g. pushtoadddrama.com -> 404 (available),
// atozion.com -> 200 (registered until 2027).

import { Resolver } from 'node:dns/promises';

const RDAP_BASE = {
  com: 'https://rdap.verisign.com/com/v1/domain/',
  net: 'https://rdap.verisign.com/net/v1/domain/',
};
const RDAP_FALLBACK = 'https://rdap.org/domain/';

const resolver = new Resolver();
resolver.setServers(['1.1.1.1', '8.8.8.8']);

/** DNS prefilter. Returns 'candidate' (NXDOMAIN), 'registered', or 'error'. */
export async function dnsStatus(domain) {
  try {
    await resolver.resolveNs(domain);
    return 'registered';
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
      // ENOTFOUND = NXDOMAIN -> candidate. ENODATA = registered but no NS records.
      return err.code === 'ENOTFOUND' ? 'candidate' : 'registered';
    }
    return 'error';
  }
}

/**
 * Authoritative RDAP check. Returns
 *   {status: 'available'} |
 *   {status: 'registered', registrar, expires} |
 *   {status: 'unknown', reason}
 */
export async function rdapCheck(domain, { retries = 3 } = {}) {
  const tld = domain.split('.').pop().toLowerCase();
  const base = RDAP_BASE[tld] || RDAP_FALLBACK;
  const url = base + domain.toLowerCase();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/rdap+json' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 404) return { status: 'available' };
      if (res.status === 429 || res.status >= 500) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const events = data.events || [];
        const expires = events.find((e) => e.eventAction === 'expiration')?.eventDate || null;
        const registrar =
          data.entities?.find((e) => (e.roles || []).includes('registrar'))
            ?.vcardArray?.[1]?.find((f) => f[0] === 'fn')?.[3] || null;
        return { status: 'registered', registrar, expires };
      }
      return { status: 'unknown', reason: `HTTP ${res.status}` };
    } catch (err) {
      if (attempt === retries) return { status: 'unknown', reason: err.message };
      await sleep(1000 * 2 ** attempt);
    }
  }
  return { status: 'unknown', reason: 'retries exhausted' };
}

/**
 * Full two-stage check for one domain. Skips RDAP when DNS already proves registration.
 * Returns {domain, status: 'available'|'registered'|'unknown', registrar?, expires?, via}
 */
export async function checkDomain(domain) {
  const dns = await dnsStatus(domain);
  if (dns === 'registered') return { domain, status: 'registered', via: 'dns' };
  const rdap = await rdapCheck(domain);
  return { domain, ...rdap, via: 'rdap' };
}

/**
 * Check many domains: DNS prefilter at high concurrency, then RDAP-confirm the
 * few candidates gently (serial with a small delay — registries rate-limit).
 * onProgress(done, total) is optional.
 */
export async function checkBatch(domains, { dnsConcurrency = 50, onProgress } = {}) {
  const results = new Map();
  let done = 0;

  // Stage 1: DNS sweep
  const queue = [...domains];
  async function worker() {
    while (queue.length) {
      const d = queue.shift();
      const status = await dnsStatus(d);
      results.set(d, { domain: d, status: status === 'candidate' ? 'candidate' : status, via: 'dns' });
      done++;
      onProgress?.(done, domains.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(dnsConcurrency, domains.length) }, worker));

  // Stage 2: RDAP confirm candidates
  const candidates = [...results.values()].filter((r) => r.status === 'candidate');
  for (const c of candidates) {
    const rdap = await rdapCheck(c.domain);
    results.set(c.domain, { domain: c.domain, ...rdap, via: 'rdap' });
    await sleep(250); // be polite to the registry
  }

  return [...results.values()];
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
