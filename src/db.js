'use strict';

const mysql = require('mysql2/promise');

/**
 * MySQL-backed storage. Connection details come from the environment so the
 * same code runs locally and on managed hosting. All public helpers are async
 * (mysql2 is promise-based, unlike the previous synchronous better-sqlite3).
 */
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'work_logger',
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_POOL_SIZE) || 10,
  // Lets us keep the original `@name` style as `:name` placeholders.
  namedPlaceholders: true,
  // Enable TLS for managed providers that require it (e.g. PlanetScale, Aiven).
  ssl: process.env.MYSQL_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

// --- Schema --------------------------------------------------------------

// MySQL can't run multiple statements per query() without multipleStatements,
// so each DDL runs separately. The init promise is cached: every public helper
// awaits ready() so the tables exist before the first query, regardless of
// which entry point (bot, scheduler, or dashboard) runs first.
let initPromise = null;

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_status (
      date          VARCHAR(10)  NOT NULL,
      slack_user_id VARCHAR(64)  NOT NULL,
      name          VARCHAR(255),
      status        VARCHAR(32)  NOT NULL,
      sent_at       VARCHAR(40),
      replied_at    VARCHAR(40),
      PRIMARY KEY (date, slack_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      date          VARCHAR(10)  NOT NULL,
      slack_user_id VARCHAR(64)  NOT NULL,
      name          VARCHAR(255),
      hours         DOUBLE,
      description   TEXT,
      raw_reply     TEXT,
      parsed        TINYINT      NOT NULL DEFAULT 0,
      logged_at     VARCHAR(40)  NOT NULL,
      INDEX idx_entries_date (date),
      INDEX idx_entries_user (slack_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

function ready() {
  if (!initPromise) initPromise = init();
  return initPromise;
}

// --- Public helpers ------------------------------------------------------

async function markSent({ date, slackUserId, name, sentAt }) {
  await ready();
  await pool.query(
    `INSERT INTO daily_status (date, slack_user_id, name, status, sent_at)
     VALUES (:date, :slack_user_id, :name, 'awaiting_reply', :sent_at)
     ON DUPLICATE KEY UPDATE
       name    = VALUES(name),
       status  = 'awaiting_reply',
       sent_at = VALUES(sent_at)`,
    { date, slack_user_id: slackUserId, name: name || null, sent_at: sentAt }
  );
}

async function markReplied({ date, slackUserId, repliedAt }) {
  await ready();
  await pool.query(
    `UPDATE daily_status
     SET status = 'replied', replied_at = :replied_at
     WHERE date = :date AND slack_user_id = :slack_user_id`,
    { date, slack_user_id: slackUserId, replied_at: repliedAt }
  );
}

async function getStatus({ date, slackUserId }) {
  await ready();
  const [rows] = await pool.query(
    `SELECT status FROM daily_status WHERE date = :date AND slack_user_id = :slack_user_id`,
    { date, slack_user_id: slackUserId }
  );
  return rows.length ? rows[0].status : null;
}

async function getStatusForDate(date) {
  await ready();
  const [rows] = await pool.query(
    `SELECT date, slack_user_id, name, status, sent_at, replied_at
     FROM daily_status WHERE date = :date`,
    { date }
  );
  return rows;
}

async function insertEntry(entry) {
  await ready();
  await pool.query(
    `INSERT INTO entries (date, slack_user_id, name, hours, description, raw_reply, parsed, logged_at)
     VALUES (:date, :slack_user_id, :name, :hours, :description, :raw_reply, :parsed, :logged_at)`,
    {
      date: entry.date,
      slack_user_id: entry.slack_user_id,
      name: entry.name || null,
      hours: entry.hours === null || entry.hours === undefined ? null : entry.hours,
      description: entry.description || '',
      raw_reply: entry.raw_reply || '',
      parsed: entry.parsed ? 1 : 0,
      logged_at: entry.logged_at,
    }
  );
}

/**
 * Returns entries with optional filtering. Filters: userId, from (date),
 * to (date), q (search in description/raw_reply). Newest first.
 *
 * logged_at is stored as an ISO 8601 string, so lexicographic ordering matches
 * chronological ordering — no datetime() coercion needed (and MySQL has none).
 */
async function getEntries({ userId, from, to, q, limit = 1000 } = {}) {
  await ready();
  const clauses = [];
  const params = {};

  if (userId) {
    clauses.push('slack_user_id = :userId');
    params.userId = userId;
  }
  if (from) {
    clauses.push('date >= :from');
    params.from = from;
  }
  if (to) {
    clauses.push('date <= :to');
    params.to = to;
  }
  if (q) {
    clauses.push('(description LIKE :q OR raw_reply LIKE :q)');
    params.q = `%${q}%`;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  // Inlined as a sanitized integer: MySQL placeholders in LIMIT are finicky.
  const lim = Math.min(Number(limit) || 1000, 5000);

  const sql = `
    SELECT id, date, slack_user_id, name, hours, description, raw_reply, parsed, logged_at
    FROM entries
    ${where}
    ORDER BY logged_at DESC, id DESC
    LIMIT ${lim}
  `;
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function countEntries() {
  await ready();
  const [rows] = await pool.query(`SELECT COUNT(*) AS n FROM entries`);
  return rows[0].n;
}

async function sumHoursSince(fromDate) {
  await ready();
  const [rows] = await pool.query(
    `SELECT COALESCE(SUM(hours), 0) AS total FROM entries WHERE date >= :from`,
    { from: fromDate }
  );
  return rows[0].total || 0;
}

module.exports = {
  pool,
  ready,
  markSent,
  markReplied,
  getStatus,
  getStatusForDate,
  insertEntry,
  getEntries,
  countEntries,
  sumHoursSince,
};
