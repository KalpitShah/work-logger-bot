'use strict';

const db = require('./db');
const { todayString, shiftDate } = require('./config');

/**
 * How many days back, in addition to today, a reply may still be accepted
 * against an open check-in. Default 1 covers the common case of replying the
 * morning after a late-night check-in. Override per workspace with
 * schedule.reply_grace_days.
 */
const DEFAULT_REPLY_GRACE_DAYS = 1;

function replyGraceDays(workspace) {
  const v = workspace.schedule && workspace.schedule.reply_grace_days;
  return Number.isInteger(v) && v >= 0 ? v : DEFAULT_REPLY_GRACE_DAYS;
}

/**
 * Tracks per-user daily check-in state, backed by MySQL (table: daily_status).
 * The same database powers the web dashboard, so the bot and UI stay in sync.
 *
 * Every helper takes the workspace object so rows are scoped by workspace_id
 * and dates are computed in the workspace's own timezone.
 */

function tzOf(workspace) {
  return (workspace.schedule && workspace.schedule.timezone) || 'UTC';
}

/**
 * Marks a user as having been sent the daily check-in.
 * @param {object} workspace
 * @param {string} userId
 * @param {string} [name]
 */
async function markSent(workspace, userId, name) {
  await db.markSent({
    workspaceId: workspace.id,
    date: todayString(tzOf(workspace)),
    slackUserId: userId,
    name,
    sentAt: new Date().toISOString(),
  });
}

/**
 * Marks a user as having replied to a check-in. Defaults to today's check-in,
 * but accepts an explicit date so a late (e.g. next-morning) reply is recorded
 * against the day it answers, not the day it arrived.
 * @param {object} workspace
 * @param {string} userId
 * @param {string} [date] YYYY-MM-DD of the check-in being answered.
 */
async function markReplied(workspace, userId, date) {
  await db.markReplied({
    workspaceId: workspace.id,
    date: date || todayString(tzOf(workspace)),
    slackUserId: userId,
    repliedAt: new Date().toISOString(),
  });
}

/**
 * Returns true if the user was messaged today and has not yet replied.
 */
async function isAwaitingReply(workspace, userId) {
  return (
    (await db.getStatus({
      workspaceId: workspace.id,
      date: todayString(tzOf(workspace)),
      slackUserId: userId,
    })) === 'awaiting_reply'
  );
}

/**
 * Returns the date (YYYY-MM-DD) of the most recent open check-in this user may
 * still answer — today's, or one from the preceding `reply_grace_days` days —
 * or null if none is open. This lets a reply sent after midnight (e.g. the
 * morning after a 22:00 check-in) still be logged against the correct day
 * instead of being silently dropped because "today" has rolled over.
 */
async function getOpenCheckinDate(workspace, userId) {
  const today = todayString(tzOf(workspace));
  const since = shiftDate(today, -replyGraceDays(workspace));
  return db.findOpenCheckinDate({
    workspaceId: workspace.id,
    slackUserId: userId,
    since,
  });
}

/**
 * Returns true if the user has already replied today.
 */
async function hasReplied(workspace, userId) {
  return (
    (await db.getStatus({
      workspaceId: workspace.id,
      date: todayString(tzOf(workspace)),
      slackUserId: userId,
    })) === 'replied'
  );
}

/**
 * Returns today's per-user status rows for the workspace (for the dashboard).
 */
function getTodayStatus(workspace) {
  return db.getStatusForDate({ workspaceId: workspace.id, date: todayString(tzOf(workspace)) });
}

module.exports = {
  markSent,
  markReplied,
  isAwaitingReply,
  getOpenCheckinDate,
  hasReplied,
  getTodayStatus,
};
