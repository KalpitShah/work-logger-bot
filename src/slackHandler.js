'use strict';

const fs = require('fs');
const path = require('path');

const dailyLog = require('./dailyLog');
const parser = require('./parser');
const sheetsLogger = require('./sheetsLogger');

const USERS_CONFIG_PATH = path.join(__dirname, '../config/users.json');

/**
 * Reads config/users.json fresh from disk.
 */
function loadConfig() {
  const raw = fs.readFileSync(USERS_CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

/**
 * Returns the user record from config matching the given Slack user ID, or
 * undefined if not configured.
 */
function findUser(config, userId) {
  return (config.users || []).find((u) => u.slack_user_id === userId);
}

/**
 * Registers the incoming-DM message listener on the Bolt app.
 *
 * @param {import('@slack/bolt').App} app
 */
function registerHandlers(app) {
  app.message(async ({ message, client }) => {
    try {
      // 1. Ignore the bot's own messages.
      if (message.bot_id) {
        return;
      }

      // 2. Only handle direct messages.
      if (message.channel_type !== 'im') {
        return;
      }

      // Ignore message subtypes (edits, joins, etc.) that lack user text.
      if (message.subtype || !message.user || typeof message.text !== 'string') {
        return;
      }

      const config = loadConfig();

      // 3 & 4. Only respond to configured users.
      const userRecord = findUser(config, message.user);
      if (!userRecord) {
        return;
      }

      // 5 & 6. Only log if this user is awaiting a reply today.
      if (!dailyLog.isAwaitingReply(message.user)) {
        return;
      }

      // 7. Parse the reply.
      const parsed = parser.parseReply(message.text);

      // 8. Build the entry and append to the sheet.
      const entry = {
        date: new Date().toISOString().slice(0, 10),
        name: userRecord.name,
        slack_user_id: message.user,
        hours: parsed.hours,
        description: parsed.description,
        raw_reply: parsed.raw,
        parsed: parsed.parsed,
        logged_at: new Date().toISOString(),
      };

      await sheetsLogger.logEntry(entry);

      // 9. Mark the user as having replied.
      dailyLog.markReplied(message.user);

      // 10. Send a confirmation DM if configured.
      const confirmationText =
        config.messages && config.messages.confirmation;
      if (confirmationText) {
        await client.chat.postMessage({
          channel: message.user,
          text: confirmationText,
        });
      }
    } catch (err) {
      // 11. Log but never crash.
      console.error('Error handling incoming message:', err.message);
    }
  });
}

module.exports = { registerHandlers };
