'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const LOG_FILE = path.join(DATA_DIR, 'daily-log.json');

/**
 * Returns today's date as a YYYY-MM-DD string (local time).
 */
function todayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Ensures the data/ directory exists.
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Creates a fresh log object for today and persists it.
 */
function freshLog() {
  const log = { date: todayString(), users: {} };
  writeLog(log);
  return log;
}

/**
 * Writes the log object to disk synchronously.
 */
function writeLog(log) {
  ensureDataDir();
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), 'utf8');
}

/**
 * Reads the daily log. If the file is missing, corrupted, or from a previous
 * day, a fresh log for today is created and returned.
 */
function getTodayLog() {
  ensureDataDir();

  if (!fs.existsSync(LOG_FILE)) {
    return freshLog();
  }

  let log;
  try {
    const raw = fs.readFileSync(LOG_FILE, 'utf8');
    log = JSON.parse(raw);
  } catch (err) {
    // Corrupted file — delete and start fresh for today.
    console.error('daily-log.json is corrupted, starting fresh:', err.message);
    try {
      fs.unlinkSync(LOG_FILE);
    } catch (_) {
      /* ignore */
    }
    return freshLog();
  }

  if (!log || log.date !== todayString() || typeof log.users !== 'object' || log.users === null) {
    return freshLog();
  }

  return log;
}

/**
 * Marks a user as having been sent the daily check-in.
 */
function markSent(userId) {
  const log = getTodayLog();
  log.users[userId] = {
    status: 'awaiting_reply',
    sent_at: new Date().toISOString(),
  };
  writeLog(log);
}

/**
 * Marks a user as having replied to today's check-in.
 */
function markReplied(userId) {
  const log = getTodayLog();
  const existing = log.users[userId] || {};
  log.users[userId] = {
    ...existing,
    status: 'replied',
    replied_at: new Date().toISOString(),
  };
  writeLog(log);
}

/**
 * Returns true if the user was messaged today and has not yet replied.
 */
function isAwaitingReply(userId) {
  const log = getTodayLog();
  const entry = log.users[userId];
  return Boolean(entry && entry.status === 'awaiting_reply');
}

/**
 * Returns true if the user has already replied today.
 */
function hasReplied(userId) {
  const log = getTodayLog();
  const entry = log.users[userId];
  return Boolean(entry && entry.status === 'replied');
}

module.exports = {
  getTodayLog,
  markSent,
  markReplied,
  isAwaitingReply,
  hasReplied,
};
