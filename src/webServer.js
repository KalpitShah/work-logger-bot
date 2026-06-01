'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

const db = require('./db');
const { loadConfig, todayString } = require('./config');

const PUBLIC_DIR = path.join(__dirname, '../public');
const VIEWS_DIR = path.join(PUBLIC_DIR, 'views');

const DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME || 'admin';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'changeme';

/**
 * Timing-safe string comparison to avoid leaking length/timing info.
 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Returns the YYYY-MM-DD string for N days ago in the configured timezone.
 */
function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: require('./config').getTimezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.redirect('/login');
}

function requireApiAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

/**
 * Builds and returns the configured Express app (not yet listening).
 */
function createWebServer() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(
    session({
      name: 'wl.sid',
      secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false, // set true only if always served over HTTPS
        maxAge: 1000 * 60 * 60 * 12, // 12 hours
      },
    })
  );

  // --- Public routes -----------------------------------------------------

  // Health check for the hosting platform (keeps the process alive / monitored).
  app.get('/health', (req, res) => res.json({ ok: true }));

  // Static assets (CSS/JS) are safe to serve publicly — no secrets.
  app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')));

  app.get('/login', (req, res) => {
    if (req.session && req.session.authed) return res.redirect('/');
    res.sendFile(path.join(VIEWS_DIR, 'login.html'));
  });

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    if (safeEqual(username || '', DASHBOARD_USERNAME) && safeEqual(password || '', DASHBOARD_PASSWORD)) {
      req.session.authed = true;
      req.session.username = DASHBOARD_USERNAME;
      return res.json({ ok: true });
    }
    return res.status(401).json({ error: 'Invalid username or password' });
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  // --- Protected page ----------------------------------------------------

  app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(VIEWS_DIR, 'index.html'));
  });

  // --- Protected API -----------------------------------------------------

  app.get('/api/me', requireApiAuth, (req, res) => {
    res.json({ username: req.session.username });
  });

  // Configured users (for filter dropdowns).
  app.get('/api/users', requireApiAuth, (req, res) => {
    try {
      const config = loadConfig();
      res.json({ users: config.users || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Today's per-user check-in status, merged with the configured user list so
  // users who have not been messaged yet still appear ("not_sent").
  app.get('/api/status/today', requireApiAuth, (req, res) => {
    try {
      const date = todayString();
      const config = loadConfig();
      const rows = db.getStatusForDate(date);
      const byId = new Map(rows.map((r) => [r.slack_user_id, r]));

      const users = (config.users || []).map((u) => {
        const row = byId.get(u.slack_user_id);
        return {
          slack_user_id: u.slack_user_id,
          name: u.name,
          status: row ? row.status : 'not_sent',
          sent_at: row ? row.sent_at : null,
          replied_at: row ? row.replied_at : null,
        };
      });

      // Include any status rows for users no longer in config.
      for (const row of rows) {
        if (!users.find((u) => u.slack_user_id === row.slack_user_id)) {
          users.push({
            slack_user_id: row.slack_user_id,
            name: row.name || row.slack_user_id,
            status: row.status,
            sent_at: row.sent_at,
            replied_at: row.replied_at,
          });
        }
      }

      res.json({ date, users });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Logged work entries, with optional filters.
  app.get('/api/entries', requireApiAuth, (req, res) => {
    try {
      const { user, from, to, q, limit } = req.query;
      const entries = db.getEntries({
        userId: user || undefined,
        from: from || undefined,
        to: to || undefined,
        q: q || undefined,
        limit: limit || 1000,
      });
      res.json({ entries });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Summary cards.
  app.get('/api/summary', requireApiAuth, (req, res) => {
    try {
      const date = todayString();
      const config = loadConfig();
      const totalUsers = (config.users || []).length;
      const todayRows = db.getStatusForDate(date);

      const repliedToday = todayRows.filter((r) => r.status === 'replied').length;
      const awaitingToday = todayRows.filter((r) => r.status === 'awaiting_reply').length;

      res.json({
        date,
        totalUsers,
        repliedToday,
        awaitingToday,
        sentToday: todayRows.length,
        totalEntries: db.countEntries(),
        hoursLast7Days: Math.round(db.sumHoursSince(dateNDaysAgo(6)) * 100) / 100,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

/**
 * Starts the web server listening on the platform-provided port.
 * @returns {Promise<import('http').Server>}
 */
function startWebServer() {
  const app = createWebServer();
  const port = process.env.PORT || 3000;
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`Dashboard listening on port ${port}`);
      resolve(server);
    });
  });
}

module.exports = { createWebServer, startWebServer };
