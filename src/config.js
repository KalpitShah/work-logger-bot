'use strict';

const fs = require('fs');
const path = require('path');

const USERS_CONFIG_PATH = path.join(__dirname, '../config/users.json');

/**
 * Reads config/users.json fresh from disk so edits take effect without a
 * restart.
 */
function loadConfig() {
  const raw = fs.readFileSync(USERS_CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

/**
 * Returns the configured timezone, defaulting to UTC.
 */
function getTimezone() {
  try {
    const config = loadConfig();
    return (config.schedule && config.schedule.timezone) || 'UTC';
  } catch (_) {
    return 'UTC';
  }
}

/**
 * Returns today's date as YYYY-MM-DD in the given timezone (defaults to the
 * configured timezone). Using en-CA yields the ISO-style ordering.
 */
function todayString(timezone) {
  const tz = timezone || getTimezone();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

module.exports = { loadConfig, getTimezone, todayString, USERS_CONFIG_PATH };
