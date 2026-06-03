'use strict';

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const dailyLog = require('./dailyLog');

const USERS_CONFIG_PATH = path.join(__dirname, '../config/users.json');

/**
 * Reads config/users.json fresh from disk so edits take effect without a
 * restart.
 */
function loadConfig() {
  const raw = fs.readFileSync(USERS_CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

/**
 * Resolves after the given number of milliseconds.
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns the current day-of-week name (e.g. "Monday") in the given timezone.
 */
function currentWeekday(timezone) {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: timezone,
  });
}

/**
 * Sends today's check-in DM to every configured user.
 */
async function runDailyCheckin(app) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('Could not read users.json for daily check-in:', err.message);
    return;
  }

  const { schedule = {}, messages = {} } = config;
  const days = schedule.days || [];
  const today = currentWeekday(schedule.timezone);

  if (days.length && !days.includes(today)) {
    return; // Not a scheduled day.
  }

  const checkinMessage = messages.checkin;
  if (!checkinMessage) {
    console.error('No checkin message configured; skipping daily check-in.');
    return;
  }

  for (const user of config.users || []) {
    const userId = user.slack_user_id;
    try {
      const open = await app.client.conversations.open({ users: userId });
      const dmChannelId = open.channel && open.channel.id;

      await app.client.chat.postMessage({
        channel: dmChannelId,
        text: checkinMessage,
      });

      await dailyLog.markSent(userId, user.name);
      console.log(`Sent daily check-in to ${user.name} (${userId})`);
    } catch (err) {
      console.error(`Failed to send check-in to ${user.name} (${userId}):`, err.message);
    }

    // Space out messages to stay clear of rate limits.
    await delay(1000);
  }
}

/**
 * Sends a reminder to every configured user who has not yet replied today.
 */
async function runReminder(app) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('Could not read users.json for reminder:', err.message);
    return;
  }

  const { schedule = {}, reminder = {}, messages = {} } = config;

  if (!reminder.enabled) {
    return;
  }

  // Honor the same day-of-week restriction as the check-in.
  const days = schedule.days || [];
  const today = currentWeekday(schedule.timezone);
  if (days.length && !days.includes(today)) {
    return;
  }

  const reminderMessage = messages.reminder;
  if (!reminderMessage) {
    return;
  }

  for (const user of config.users || []) {
    const userId = user.slack_user_id;

    if (!(await dailyLog.isAwaitingReply(userId))) {
      continue;
    }

    try {
      const open = await app.client.conversations.open({ users: userId });
      const dmChannelId = open.channel && open.channel.id;

      await app.client.chat.postMessage({
        channel: dmChannelId,
        text: reminderMessage,
      });
      console.log(`Sent reminder to ${user.name} (${userId})`);
    } catch (err) {
      console.error(`Failed to send reminder to ${user.name} (${userId}):`, err.message);
    }

    await delay(1000);
  }
}

/**
 * Schedules the daily check-in and reminder cron jobs.
 *
 * @param {import('@slack/bolt').App} app
 */
function startScheduler(app) {
  // Read timing once at startup to build the cron expressions. Message content,
  // user list, and day restrictions are re-read fresh on every execution.
  const config = loadConfig();
  const { schedule = {}, reminder = {} } = config;
  const timezone = schedule.timezone || 'UTC';

  const checkinHour = schedule.send_time_hour ?? 18;
  const checkinMinute = schedule.send_time_minute ?? 0;
  const checkinCron = `${checkinMinute} ${checkinHour} * * *`;

  cron.schedule(
    checkinCron,
    () => {
      runDailyCheckin(app).catch((err) =>
        console.error('Unhandled error in daily check-in job:', err.message)
      );
    },
    { timezone }
  );
  console.log(`Scheduled daily check-in at ${checkinCron} (${timezone})`);

  if (reminder.enabled) {
    const reminderHour = reminder.reminder_hour ?? 21;
    const reminderMinute = reminder.reminder_minute ?? 0;
    const reminderCron = `${reminderMinute} ${reminderHour} * * *`;

    cron.schedule(
      reminderCron,
      () => {
        runReminder(app).catch((err) =>
          console.error('Unhandled error in reminder job:', err.message)
        );
      },
      { timezone }
    );
    console.log(`Scheduled reminder at ${reminderCron} (${timezone})`);
  }
}

module.exports = { startScheduler };
