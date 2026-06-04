'use strict';

const db = require('./db');
const { todayString } = require('./config');

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
 * Marks a user as having replied to today's check-in.
 * @param {object} workspace
 * @param {string} userId
 */
async function markReplied(workspace, userId) {
  await db.markReplied({
    workspaceId: workspace.id,
    date: todayString(tzOf(workspace)),
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
  hasReplied,
  getTodayStatus,
};
