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

/**
 * Returns the list of YYYY-MM-DD strings from `from` to `to` inclusive, newest
 * first. Stepping in UTC keeps the arithmetic free of DST/timezone drift since
 * the stored dates are plain calendar days.
 */
function datesDescending(from, to) {
  const out = [];
  const start = new Date(from + 'T00:00:00Z');
  const cur = new Date(to + 'T00:00:00Z');
  let guard = 0;
  while (cur >= start && guard < 1000) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() - 1);
    guard += 1;
  }
  return out;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Builds a per-employee daily hours matrix for a date range. Columns are the
 * configured users (in config order), followed by any extra users that appear
 * in the data but are no longer configured. Every day in the range is a row,
 * even days with zero logged hours.
 *
 * @returns {Promise<{from: string, to: string, users: Array<{slack_user_id: string, name: string}>, rows: Array<{date: string, cells: Object, total: number}>, totals: Object, grandTotal: number}>}
 */
async function computeHoursMatrix({ from, to }) {
  const config = loadConfig();
  const users = (config.users || []).map((u) => ({
    slack_user_id: u.slack_user_id,
    name: u.name,
  }));

  const dataRows = await db.getDailyHoursByUser({ from, to });

  // Append users present in the data but missing from config.
  const seen = new Set(users.map((u) => u.slack_user_id));
  for (const r of dataRows) {
    if (!seen.has(r.slack_user_id)) {
      seen.add(r.slack_user_id);
      users.push({ slack_user_id: r.slack_user_id, name: r.name || r.slack_user_id });
    }
  }

  const cell = new Map();
  for (const r of dataRows) {
    cell.set(r.date + '|' + r.slack_user_id, Number(r.hours) || 0);
  }

  const totals = {};
  for (const u of users) totals[u.slack_user_id] = 0;
  let grandTotal = 0;

  const rows = datesDescending(from, to).map((date) => {
    const cells = {};
    let total = 0;
    for (const u of users) {
      const h = cell.get(date + '|' + u.slack_user_id) || 0;
      cells[u.slack_user_id] = round2(h);
      totals[u.slack_user_id] += h;
      total += h;
    }
    grandTotal += total;
    return { date, cells, total: round2(total) };
  });

  for (const u of users) totals[u.slack_user_id] = round2(totals[u.slack_user_id]);

  return { from, to, users, rows, totals, grandTotal: round2(grandTotal) };
}

/**
 * Resolves the {from, to} range from query params, defaulting to the last
 * `days` (default 30) ending today in the configured timezone.
 */
function resolveRange(query) {
  const days = Math.min(Math.max(Number(query.days) || 30, 1), 366);
  const to = query.to || todayString();
  const from = query.from || dateNDaysAgo(days - 1);
  return { from, to };
}

/**
 * Escapes a value for a CSV cell, quoting when it contains a comma, quote, or
 * newline (RFC 4180).
 */
function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
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
  app.get('/api/status/today', requireApiAuth, async (req, res) => {
    try {
      const date = todayString();
      const config = loadConfig();
      const rows = await db.getStatusForDate(date);
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
  app.get('/api/entries', requireApiAuth, async (req, res) => {
    try {
      const { user, from, to, q, limit } = req.query;
      const entries = await db.getEntries({
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
  app.get('/api/summary', requireApiAuth, async (req, res) => {
    try {
      const date = todayString();
      const config = loadConfig();
      const totalUsers = (config.users || []).length;
      const todayRows = await db.getStatusForDate(date);

      const repliedToday = todayRows.filter((r) => r.status === 'replied').length;
      const awaitingToday = todayRows.filter((r) => r.status === 'awaiting_reply').length;

      const totalEntries = await db.countEntries();
      const hoursLast7Days = Math.round((await db.sumHoursSince(dateNDaysAgo(6))) * 100) / 100;

      res.json({
        date,
        totalUsers,
        repliedToday,
        awaitingToday,
        sentToday: todayRows.length,
        totalEntries,
        hoursLast7Days,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Per-employee daily hours matrix (default: last 30 days, newest first).
  app.get('/api/hours-matrix', requireApiAuth, async (req, res) => {
    try {
      const { from, to } = resolveRange(req.query);
      const matrix = await computeHoursMatrix({ from, to });
      res.json(matrix);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // CSV export of the hours matrix for a selected date range.
  app.get('/api/export.csv', requireApiAuth, async (req, res) => {
    try {
      const { from, to } = resolveRange(req.query);
      const { users, rows, totals, grandTotal } = await computeHoursMatrix({ from, to });

      const header = ['Date', ...users.map((u) => u.name), 'Total'];
      const lines = [header.map(csvCell).join(',')];
      for (const r of rows) {
        const line = [r.date, ...users.map((u) => r.cells[u.slack_user_id] || 0), r.total];
        lines.push(line.map(csvCell).join(','));
      }
      const totalLine = ['Total', ...users.map((u) => totals[u.slack_user_id] || 0), grandTotal];
      lines.push(totalLine.map(csvCell).join(','));

      // Prepend a BOM so Excel opens UTF-8 cleanly.
      const csv = '﻿' + lines.join('\r\n') + '\r\n';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="work-hours_${from}_to_${to}.csv"`
      );
      res.send(csv);
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
