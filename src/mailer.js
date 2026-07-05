import nodemailer from 'nodemailer';

export async function sendDigest({ fresh, watchlistChanges }, env = process.env) {
  if (!env.SMTP_HOST) {
    console.log('[digest] SMTP not configured; finds:', fresh.map((f) => f.domain).join(', '));
    return;
  }
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 587,
    secure: Number(env.SMTP_PORT) === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });

  const watchlistBlock = watchlistChanges.length
    ? `<h2 style="color:#0E5A54">🎯 Watchlist drops — act now</h2>
       <ul>${watchlistChanges.map((d) => `<li><b>${d}</b> is AVAILABLE</li>`).join('')}</ul>`
    : '';

  const bySource = {};
  for (const f of fresh) (bySource[f.source] ||= []).push(f.domain);
  const findsBlock = Object.entries(bySource)
    .map(([src, domains]) => `<h3>${src} (${domains.length})</h3><p>${domains.join(' · ')}</p>`)
    .join('');

  await transporter.sendMail({
    from: env.DIGEST_FROM || 'URL Scoop <scoop@localhost>',
    to: env.DIGEST_TO,
    subject: `URL Scoop: ${fresh.length} available domain${fresh.length === 1 ? '' : 's'} found${watchlistChanges.length ? ' — WATCHLIST DROP!' : ''}`,
    html: `${watchlistBlock}${findsBlock}
      <p style="color:#888;font-size:12px">Confirmed via registry RDAP. Register fast — drops get re-caught quickly.</p>`,
  });
}
