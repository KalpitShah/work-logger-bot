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
      workspace_id  VARCHAR(64)  NOT NULL DEFAULT 'default',
      date          VARCHAR(10)  NOT NULL,
      slack_user_id VARCHAR(64)  NOT NULL,
      name          VARCHAR(255),
      status        VARCHAR(32)  NOT NULL,
      sent_at       VARCHAR(40),
      replied_at    VARCHAR(40),
      PRIMARY KEY (workspace_id, date, slack_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      workspace_id  VARCHAR(64)  NOT NULL DEFAULT 'default',
      date          VARCHAR(10)  NOT NULL,
      slack_user_id VARCHAR(64)  NOT NULL,
      name          VARCHAR(255),
      hours         DOUBLE,
      description   TEXT,
      raw_reply     TEXT,
      parsed        TINYINT      NOT NULL DEFAULT 0,
      logged_at     VARCHAR(40)  NOT NULL,
      INDEX idx_entries_date (date),
      INDEX idx_entries_user (slack_user_id),
      INDEX idx_entries_workspace (workspace_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await migrate();
}

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c`,
    { t: table, c: column }
  );
  return rows[0].n > 0;
}

/**
 * Upgrades pre-existing single-workspace tables in place. New installs already
 * have the columns from CREATE TABLE, so each guard is a no-op there.
 */
async function migrate() {
  if (!(await columnExists('daily_status', 'workspace_id'))) {
    await pool.query(
      `ALTER TABLE daily_status
         ADD COLUMN workspace_id VARCHAR(64) NOT NULL DEFAULT 'default' FIRST`
    );
    await pool.query(`ALTER TABLE daily_status DROP PRIMARY KEY`);
    await pool.query(
      `ALTER TABLE daily_status ADD PRIMARY KEY (workspace_id, date, slack_user_id)`
    );
  }
  if (!(await columnExists('entries', 'workspace_id'))) {
    await pool.query(
      `ALTER TABLE entries
         ADD COLUMN workspace_id VARCHAR(64) NOT NULL DEFAULT 'default' AFTER id`
    );
    await pool.query(`ALTER TABLE entries ADD INDEX idx_entries_workspace (workspace_id)`);
  }
}

function ready() {
  if (!initPromise) initPromise = init();
  return initPromise;
}

// --- Public helpers ------------------------------------------------------

async function markSent({ workspaceId, date, slackUserId, name, sentAt }) {
  await ready();
  await pool.query(
    `INSERT INTO daily_status (workspace_id, date, slack_user_id, name, status, sent_at)
     VALUES (:workspace_id, :date, :slack_user_id, :name, 'awaiting_reply', :sent_at)
     ON DUPLICATE KEY UPDATE
       name    = VALUES(name),
       status  = 'awaiting_reply',
       sent_at = VALUES(sent_at)`,
    { workspace_id: workspaceId, date, slack_user_id: slackUserId, name: name || null, sent_at: sentAt }
  );
}

async function markReplied({ workspaceId, date, slackUserId, repliedAt }) {
  await ready();
  await pool.query(
    `UPDATE daily_status
     SET status = 'replied', replied_at = :replied_at
     WHERE workspace_id = :workspace_id AND date = :date AND slack_user_id = :slack_user_id`,
    { workspace_id: workspaceId, date, slack_user_id: slackUserId, replied_at: repliedAt }
  );
}

async function getStatus({ workspaceId, date, slackUserId }) {
  await ready();
  const [rows] = await pool.query(
    `SELECT status FROM daily_status
     WHERE workspace_id = :workspace_id AND date = :date AND slack_user_id = :slack_user_id`,
    { workspace_id: workspaceId, date, slack_user_id: slackUserId }
  );
  return rows.length ? rows[0].status : null;
}

/**
 * Returns the date (YYYY-MM-DD) of the most recent still-open ('awaiting_reply')
 * check-in for a user on or after `since`, or null if none is open. Used to let
 * a user reply the morning after a late-night check-in and still have it logged
 * against the correct day. `date` is a YYYY-MM-DD string, so lexicographic
 * ordering matches chronological ordering.
 */
async function findOpenCheckinDate({ workspaceId, slackUserId, since }) {
  await ready();
  const [rows] = await pool.query(
    `SELECT date FROM daily_status
     WHERE workspace_id = :workspace_id
       AND slack_user_id = :slack_user_id
       AND status = 'awaiting_reply'
       AND date >= :since
     ORDER BY date DESC
     LIMIT 1`,
    { workspace_id: workspaceId, slack_user_id: slackUserId, since }
  );
  return rows.length ? rows[0].date : null;
}

async function getStatusForDate({ workspaceId, date }) {
  await ready();
  const [rows] = await pool.query(
    `SELECT workspace_id, date, slack_user_id, name, status, sent_at, replied_at
     FROM daily_status WHERE workspace_id = :workspace_id AND date = :date`,
    { workspace_id: workspaceId, date }
  );
  return rows;
}

async function insertEntry(entry) {
  await ready();
  await pool.query(
    `INSERT INTO entries (workspace_id, date, slack_user_id, name, hours, description, raw_reply, parsed, logged_at)
     VALUES (:workspace_id, :date, :slack_user_id, :name, :hours, :description, :raw_reply, :parsed, :logged_at)`,
    {
      workspace_id: entry.workspace_id || 'default',
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
 * Returns entries with optional filtering. Filters: workspaceId, userId,
 * from (date), to (date), q (search in description/raw_reply). Newest first.
 *
 * logged_at is stored as an ISO 8601 string, so lexicographic ordering matches
 * chronological ordering — no datetime() coercion needed (and MySQL has none).
 */
async function getEntries({ workspaceId, userId, from, to, q, limit = 1000 } = {}) {
  await ready();
  const clauses = [];
  const params = {};

  if (workspaceId) {
    clauses.push('workspace_id = :workspaceId');
    params.workspaceId = workspaceId;
  }
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
    SELECT id, workspace_id, date, slack_user_id, name, hours, description, raw_reply, parsed, logged_at
    FROM entries
    ${where}
    ORDER BY logged_at DESC, id DESC
    LIMIT ${lim}
  `;
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function countEntries({ workspaceId } = {}) {
  await ready();
  if (workspaceId) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS n FROM entries WHERE workspace_id = :workspaceId`,
      { workspaceId }
    );
    return rows[0].n;
  }
  const [rows] = await pool.query(`SELECT COUNT(*) AS n FROM entries`);
  return rows[0].n;
}

async function sumHoursSince(fromDate, workspaceId) {
  await ready();
  const clauses = ['date >= :from'];
  const params = { from: fromDate };
  if (workspaceId) {
    clauses.push('workspace_id = :workspaceId');
    params.workspaceId = workspaceId;
  }
  const [rows] = await pool.query(
    `SELECT COALESCE(SUM(hours), 0) AS total FROM entries WHERE ${clauses.join(' AND ')}`,
    params
  );
  return rows[0].total || 0;
}

/**
 * Returns total hours logged per (date, user) within an optional date range,
 * for building the per-employee daily hours matrix. One row per day a user
 * logged at least one entry; multiple entries on the same day are summed.
 */
async function getDailyHoursByUser({ workspaceId, from, to } = {}) {
  await ready();
  const clauses = ['hours IS NOT NULL'];
  const params = {};
  if (workspaceId) {
    clauses.push('workspace_id = :workspaceId');
    params.workspaceId = workspaceId;
  }
  if (from) {
    clauses.push('date >= :from');
    params.from = from;
  }
  if (to) {
    clauses.push('date <= :to');
    params.to = to;
  }
  const where = `WHERE ${clauses.join(' AND ')}`;
  const [rows] = await pool.query(
    `SELECT date, slack_user_id, MAX(name) AS name, COALESCE(SUM(hours), 0) AS hours
     FROM entries
     ${where}
     GROUP BY date, slack_user_id`,
    params
  );
  return rows;
}

module.exports = {
  pool,
  ready,
  markSent,
  markReplied,
  getStatus,
  findOpenCheckinDate,
  getStatusForDate,
  insertEntry,
  getEntries,
  countEntries,
  sumHoursSince,
  getDailyHoursByUser,
};
