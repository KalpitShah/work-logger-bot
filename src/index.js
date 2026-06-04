'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { App, LogLevel } = require('@slack/bolt');

const { registerHandlers } = require('./slackHandler');
const { startScheduler } = require('./scheduler');
const { startWebServer } = require('./webServer');
const { getWorkspaces } = require('./config');

/**
 * Creates runtime directories (logs/) if they do not exist.
 */
function ensureRuntimeDirs() {
  for (const dir of ['../logs']) {
    const full = path.join(__dirname, dir);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
    }
  }
}

/** Env var name holding a token for a workspace, e.g. SLACK_BOT_TOKEN_ACME. */
function envKey(prefix, workspaceId) {
  return `${prefix}_${String(workspaceId).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

function tokensFor(workspace) {
  const botKey = envKey('SLACK_BOT_TOKEN', workspace.id);
  const appKey = envKey('SLACK_APP_TOKEN', workspace.id);
  // Fall back to the legacy single-workspace env vars for id 'default'.
  const botToken =
    process.env[botKey] || (workspace.id === 'default' ? process.env.SLACK_BOT_TOKEN : undefined);
  const appToken =
    process.env[appKey] || (workspace.id === 'default' ? process.env.SLACK_APP_TOKEN : undefined);
  return { botToken, appToken, botKey, appKey };
}

/**
 * Builds and starts one Bolt App for a workspace, with its own token pair,
 * handlers, and scheduler. A workspace with missing tokens is skipped (logged)
 * so the process and other workspaces keep running; its historical data still
 * shows in the dashboard.
 */
async function startWorkspaceApp(workspace) {
  const { botToken, appToken, botKey, appKey } = tokensFor(workspace);
  if (!botToken || !appToken) {
    console.error(
      `[${workspace.id}] Missing ${botKey} or ${appKey}; skipping Slack app (its data still shows in the dashboard).`
    );
    return;
  }

  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  registerHandlers(app, workspace);

  try {
    await app.start();
    startScheduler(app, workspace);
    console.log(`[${workspace.id}] Slack app "${workspace.name}" is running`);
  } catch (err) {
    console.error(`[${workspace.id}] Slack app failed to start (dashboard still running):`, err.message);
  }
}

async function main() {
  ensureRuntimeDirs();

  // Start the web dashboard first. It binds to process.env.PORT, which also
  // serves as the keep-alive HTTP server required by managed Node.js hosting
  // (e.g. Hostinger Business "Plan A").
  await startWebServer();

  const workspaces = getWorkspaces();
  if (!workspaces.length) {
    console.error('No workspaces configured in config/users.json');
  }

  // Start each workspace's Slack app independently; one bad workspace (missing
  // tokens or a failed connection) won't stop the others or the dashboard.
  for (const workspace of workspaces) {
    await startWorkspaceApp(workspace);
  }

  console.log('Slack Work Logger is running');
}

main().catch((err) => {
  console.error('Fatal error starting Slack Work Logger:', err);
  process.exit(1);
});
