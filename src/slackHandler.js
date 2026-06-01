'use strict';

const dailyLog = require('./dailyLog');
const parser = require('./parser');
const sheetsLogger = require('./sheetsLogger');
const db = require('./db');
const { loadConfig, todayString } = require('./config');

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

      // 8. Build the entry.
      const entry = {
        date: todayString(),
        name: userRecord.name,
        slack_user_id: message.user,
        hours: parsed.hours,
        description: parsed.description,
        raw_reply: parsed.raw,
        parsed: parsed.parsed,
        logged_at: new Date().toISOString(),
      };

      // 8a. Persist to the local SQLite DB first so the dashboard always has
      //     the record, regardless of Google Sheets configuration.
      try {
        db.insertEntry(entry);
      } catch (dbErr) {
        console.error('Failed to write entry to SQLite:', dbErr.message);
        console.error('Unsaved entry:', JSON.stringify(entry));
      }

      // 8b. Best-effort: also append to Google Sheets if configured. A failure
      //     here (e.g. no credentials) must not block logging or confirmation.
      try {
        await sheetsLogger.logEntry(entry);
      } catch (sheetErr) {
        // sheetsLogger already logs the error and raw entry.
      }

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
