'use strict';

const path = require('path');

const USERS_CONFIG_PATH = path.join(__dirname, '../config/users.js');
const DEFAULT_WORKSPACE_ID = 'default';

/**
 * Loads config/users.js fresh on every call (so edits take effect without a
 * restart) and normalizes it to the multi-workspace shape. The require cache is
 * busted each time to match the previous read-fresh-from-disk behavior.
 *
 * Supported formats:
 *   1. Multi-workspace: { workspaces: [ { id, name, users, schedule, ... } ] }
 *   2. Legacy flat:     { users, schedule, reminder, messages } — wrapped into
 *      a single implicit workspace with id 'default' so existing installs and
 *      their stored data (workspace_id='default') keep working.
 */
function loadConfig() {
  delete require.cache[require.resolve(USERS_CONFIG_PATH)];
  return normalizeConfig(require(USERS_CONFIG_PATH));
}

function normalizeConfig(parsed) {
  if (parsed && Array.isArray(parsed.workspaces)) return parsed;
  const { users, schedule, reminder, messages, sheet_id } = parsed || {};
  return {
    workspaces: [
      {
        id: DEFAULT_WORKSPACE_ID,
        name: 'Default Workspace',
        sheet_id: sheet_id || process.env.GOOGLE_SHEET_ID || '',
        users: users || [],
        schedule: schedule || {},
        reminder: reminder || {},
        messages: messages || {},
      },
    ],
  };
}

function getWorkspaces() {
  return loadConfig().workspaces || [];
}

function getWorkspace(workspaceId) {
  return getWorkspaces().find((w) => w.id === workspaceId);
}

/**
 * Returns the configured dashboard users, each shaped
 * { username, workspaces: string[] }. The `workspaces` array lists the
 * workspace ids that user may access; the special value "*" grants access to
 * every configured workspace.
 */
function getDashboardUsers() {
  return loadConfig().dashboard_users || [];
}

/** Finds a dashboard user by username (case-insensitive), or undefined. */
function getDashboardUser(username) {
  const u = String(username || '').toLowerCase();
  return getDashboardUsers().find((du) => String(du.username || '').toLowerCase() === u);
}

/** Env var name holding a dashboard user's password, e.g. DASHBOARD_PASSWORD_KALPIT. */
function dashboardPasswordEnvKey(username) {
  return `DASHBOARD_PASSWORD_${String(username).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/** Timezone for a workspace (or the first workspace if id omitted), default UTC. */
function getTimezone(workspaceId) {
  const workspaces = getWorkspaces();
  const ws = workspaceId ? workspaces.find((w) => w.id === workspaceId) : workspaces[0];
  return (ws && ws.schedule && ws.schedule.timezone) || 'UTC';
}

/** Today's date as YYYY-MM-DD in the given timezone (defaults to UTC). */
function todayString(timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Returns a YYYY-MM-DD date string shifted by `deltaDays` (may be negative).
 * Pure calendar arithmetic on the date parts, so it is timezone-independent
 * and unaffected by DST (no local-time conversion involved).
 */
function shiftDate(dateStr, deltaDays) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

module.exports = {
  loadConfig,
  getWorkspaces,
  getWorkspace,
  getDashboardUsers,
  getDashboardUser,
  dashboardPasswordEnvKey,
  getTimezone,
  todayString,
  shiftDate,
  USERS_CONFIG_PATH,
  DEFAULT_WORKSPACE_ID,
};
