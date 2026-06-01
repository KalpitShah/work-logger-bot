'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { App, LogLevel } = require('@slack/bolt');

const { registerHandlers } = require('./slackHandler');
const { startScheduler } = require('./scheduler');
const { startWebServer } = require('./webServer');

/**
 * Creates runtime directories (data/, logs/) if they do not exist.
 */
function ensureRuntimeDirs() {
  for (const dir of ['../data', '../logs']) {
    const full = path.join(__dirname, dir);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
    }
  }
}

async function main() {
  ensureRuntimeDirs();

  // Start the web dashboard first. It binds to process.env.PORT, which also
  // serves as the keep-alive HTTP server required by managed Node.js hosting
  // (e.g. Hostinger Business "Plan A").
  await startWebServer();

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  // Register the incoming-DM listener.
  registerHandlers(app);

  // Connect to Slack over Socket Mode. If Slack credentials are missing or
  // invalid, keep the dashboard running rather than crashing the process.
  try {
    await app.start();
    startScheduler(app);
    console.log('Slack Work Logger is running');
  } catch (err) {
    console.error('Slack app failed to start (dashboard still running):', err.message);
  }
}

main().catch((err) => {
  console.error('Fatal error starting Slack Work Logger:', err);
  process.exit(1);
});
