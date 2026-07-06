// Google Sign-In (OAuth 2.0 authorization-code flow) — no passport, just fetch.
// Session lives in a signed cookie (cookie-session). Users are stored in db.users.
//
// Requires in .env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET, PUBLIC_URL.
// PUBLIC_URL is the app's external base, e.g. https://hackbed.com/nameripple (prod)
// or http://localhost:3100 (local). The Google OAuth redirect URI is
// PUBLIC_URL + /auth/google/callback and must be registered in Google Cloud Console.

import crypto from 'node:crypto';
import { get, save } from './store.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export function authConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri() {
  const base = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3100}`).replace(/\/+$/, '');
  return base + '/auth/google/callback';
}

// When Google isn't configured (local dev, or a private install), sign-in is
// bypassed and everyone shares one "local" account — so the app works as before.
const LOCAL_USER = { id: 'local', name: 'Local', email: '', picture: '' };

export function currentUser(req) {
  if (req.session?.user) return req.session.user;
  return authConfigured() ? null : LOCAL_USER;
}

export function requireAuth(req, res, next) {
  if (currentUser(req)) return next();
  res.status(401).json({ error: 'Please sign in first.' });
}

// Mount auth routes on the given router. `base` is the URL prefix (BASE_PATH).
export function mountAuth(route, base) {
  const home = (base || '') + '/';

  route.get('/api/me', (req, res) => {
    res.json({ user: currentUser(req), authConfigured: authConfigured() });
  });

  route.get('/auth/google', (req, res) => {
    if (!authConfigured()) return res.status(503).send('Sign-in is not configured on this server.');
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    res.redirect(`${AUTH_URL}?${params}`);
  });

  route.get('/auth/google/callback', async (req, res) => {
    try {
      if (!req.query.code || req.query.state !== req.session.oauthState) {
        return res.status(400).send('Sign-in failed (bad state). Please try again.');
      }
      req.session.oauthState = undefined;

      const tokenRes = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: req.query.code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri(),
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) throw new Error('token exchange failed');
      const { access_token } = await tokenRes.json();

      const infoRes = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${access_token}` } });
      if (!infoRes.ok) throw new Error('userinfo failed');
      const info = await infoRes.json();

      const db = get();
      const now = new Date().toISOString();
      db.users[info.sub] ??= { createdAt: now };
      Object.assign(db.users[info.sub], {
        email: info.email, name: info.name, picture: info.picture, lastLogin: now,
      });
      db.watchlists[info.sub] ??= [];
      save();

      req.session.user = { id: info.sub, email: info.email, name: info.name, picture: info.picture };
      res.redirect(home);
    } catch (err) {
      console.error('oauth callback error:', err.message);
      res.status(500).send('Sign-in failed. Please try again.');
    }
  });

  route.post('/auth/logout', (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });
}
