'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { App, LogLevel } = require('@slack/bolt');

const { registerHandlers } = require('./slackHandler');
const { startScheduler } = require('./scheduler');

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

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  // Register the incoming-DM listener.
  registerHandlers(app);

  // Connect to Slack over Socket Mode.
  await app.start();

  // Schedule the daily check-in and reminder jobs.
  startScheduler(app);

  console.log('Slack Work Logger is running');
}

main().catch((err) => {
  console.error('Fatal error starting Slack Work Logger:', err);
  process.exit(1);
});
