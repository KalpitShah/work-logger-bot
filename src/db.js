'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'work-logger.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_status (
    date          TEXT NOT NULL,
    slack_user_id TEXT NOT NULL,
    name          TEXT,
    status        TEXT NOT NULL,
    sent_at       TEXT,
    replied_at    TEXT,
    PRIMARY KEY (date, slack_user_id)
  );

  CREATE TABLE IF NOT EXISTS entries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    date          TEXT NOT NULL,
    slack_user_id TEXT NOT NULL,
    name          TEXT,
    hours         REAL,
    description   TEXT,
    raw_reply     TEXT,
    parsed        INTEGER NOT NULL DEFAULT 0,
    logged_at     TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
  CREATE INDEX IF NOT EXISTS idx_entries_user ON entries(slack_user_id);
`);

// --- Prepared statements -------------------------------------------------

const stmtUpsertSent = db.prepare(`
  INSERT INTO daily_status (date, slack_user_id, name, status, sent_at)
  VALUES (@date, @slack_user_id, @name, 'awaiting_reply', @sent_at)
  ON CONFLICT(date, slack_user_id) DO UPDATE SET
    name    = excluded.name,
    status  = 'awaiting_reply',
    sent_at = excluded.sent_at
`);

const stmtMarkReplied = db.prepare(`
  UPDATE daily_status
  SET status = 'replied', replied_at = @replied_at
  WHERE date = @date AND slack_user_id = @slack_user_id
`);

const stmtGetStatus = db.prepare(`
  SELECT status FROM daily_status WHERE date = @date AND slack_user_id = @slack_user_id
`);

const stmtGetStatusForDate = db.prepare(`
  SELECT date, slack_user_id, name, status, sent_at, replied_at
  FROM daily_status WHERE date = @date
`);

const stmtInsertEntry = db.prepare(`
  INSERT INTO entries (date, slack_user_id, name, hours, description, raw_reply, parsed, logged_at)
  VALUES (@date, @slack_user_id, @name, @hours, @description, @raw_reply, @parsed, @logged_at)
`);

const stmtCountEntries = db.prepare(`SELECT COUNT(*) AS n FROM entries`);

const stmtHoursSince = db.prepare(`
  SELECT COALESCE(SUM(hours), 0) AS total FROM entries WHERE date >= @from
`);

// --- Public helpers ------------------------------------------------------

function markSent({ date, slackUserId, name, sentAt }) {
  stmtUpsertSent.run({
    date,
    slack_user_id: slackUserId,
    name: name || null,
    sent_at: sentAt,
  });
}

function markReplied({ date, slackUserId, repliedAt }) {
  stmtMarkReplied.run({ date, slack_user_id: slackUserId, replied_at: repliedAt });
}

function getStatus({ date, slackUserId }) {
  const row = stmtGetStatus.get({ date, slack_user_id: slackUserId });
  return row ? row.status : null;
}

function getStatusForDate(date) {
  return stmtGetStatusForDate.all({ date });
}

function insertEntry(entry) {
  stmtInsertEntry.run({
    date: entry.date,
    slack_user_id: entry.slack_user_id,
    name: entry.name || null,
    hours: entry.hours === null || entry.hours === undefined ? null : entry.hours,
    description: entry.description || '',
    raw_reply: entry.raw_reply || '',
    parsed: entry.parsed ? 1 : 0,
    logged_at: entry.logged_at,
  });
}

/**
 * Returns entries with optional filtering. Filters: userId, from (date),
 * to (date), q (search in description/raw_reply). Newest first.
 */
function getEntries({ userId, from, to, q, limit = 1000 } = {}) {
  const clauses = [];
  const params = {};

  if (userId) {
    clauses.push('slack_user_id = @userId');
    params.userId = userId;
  }
  if (from) {
    clauses.push('date >= @from');
    params.from = from;
  }
  if (to) {
    clauses.push('date <= @to');
    params.to = to;
  }
  if (q) {
    clauses.push('(description LIKE @q OR raw_reply LIKE @q)');
    params.q = `%${q}%`;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.limit = Math.min(Number(limit) || 1000, 5000);

  const sql = `
    SELECT id, date, slack_user_id, name, hours, description, raw_reply, parsed, logged_at
    FROM entries
    ${where}
    ORDER BY datetime(logged_at) DESC, id DESC
    LIMIT @limit
  `;
  return db.prepare(sql).all(params);
}

function countEntries() {
  return stmtCountEntries.get().n;
}

function sumHoursSince(fromDate) {
  return stmtHoursSince.get({ from: fromDate }).total || 0;
}

module.exports = {
  db,
  markSent,
  markReplied,
  getStatus,
  getStatusForDate,
  insertEntry,
  getEntries,
  countEntries,
  sumHoursSince,
};
