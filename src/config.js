'use strict';

const fs = require('fs');
const path = require('path');

const USERS_CONFIG_PATH = path.join(__dirname, '../config/users.json');
const DEFAULT_WORKSPACE_ID = 'default';

/**
 * Reads config/users.json fresh from disk (so edits take effect without a
 * restart) and normalizes it to the multi-workspace shape.
 *
 * Supported formats:
 *   1. Multi-workspace: { workspaces: [ { id, name, users, schedule, ... } ] }
 *   2. Legacy flat:     { users, schedule, reminder, messages } — wrapped into
 *      a single implicit workspace with id 'default' so existing installs and
 *      their stored data (workspace_id='default') keep working.
 */
function loadConfig() {
  const raw = fs.readFileSync(USERS_CONFIG_PATH, 'utf8');
  return normalizeConfig(JSON.parse(raw));
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

module.exports = {
  loadConfig,
  getWorkspaces,
  getWorkspace,
  getTimezone,
  todayString,
  USERS_CONFIG_PATH,
  DEFAULT_WORKSPACE_ID,
};
