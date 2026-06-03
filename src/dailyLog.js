'use strict';

const db = require('./db');
const { todayString } = require('./config');

/**
 * Tracks per-user daily check-in state, backed by MySQL (table: daily_status).
 * The same database powers the web dashboard, so the bot and UI stay in sync.
 */

/**
 * Marks a user as having been sent the daily check-in.
 * @param {string} userId
 * @param {string} [name]
 */
async function markSent(userId, name) {
  await db.markSent({
    date: todayString(),
    slackUserId: userId,
    name,
    sentAt: new Date().toISOString(),
  });
}

/**
 * Marks a user as having replied to today's check-in.
 * @param {string} userId
 */
async function markReplied(userId) {
  await db.markReplied({
    date: todayString(),
    slackUserId: userId,
    repliedAt: new Date().toISOString(),
  });
}

/**
 * Returns true if the user was messaged today and has not yet replied.
 */
async function isAwaitingReply(userId) {
  return (await db.getStatus({ date: todayString(), slackUserId: userId })) === 'awaiting_reply';
}

/**
 * Returns true if the user has already replied today.
 */
async function hasReplied(userId) {
  return (await db.getStatus({ date: todayString(), slackUserId: userId })) === 'replied';
}

/**
 * Returns today's per-user status rows (for the dashboard).
 */
function getTodayStatus() {
  return db.getStatusForDate(todayString());
}

module.exports = {
  markSent,
  markReplied,
  isAwaitingReply,
  hasReplied,
  getTodayStatus,
};
