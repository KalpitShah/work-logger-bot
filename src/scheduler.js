'use strict';

const cron = require('node-cron');

const dailyLog = require('./dailyLog');
const { getWorkspace } = require('./config');

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
 * Sends today's check-in DM to every configured user in the workspace. The
 * workspace is re-read fresh so config edits (users/messages/days) apply
 * without a restart.
 */
async function runDailyCheckin(app, workspaceId) {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return;

  const { schedule = {}, messages = {} } = workspace;
  const days = schedule.days || [];
  if (days.length && !days.includes(currentWeekday(schedule.timezone))) {
    return; // Not a scheduled day.
  }

  const checkinMessage = messages.checkin;
  if (!checkinMessage) {
    console.error(`[${workspaceId}] No checkin message configured; skipping daily check-in.`);
    return;
  }

  for (const user of workspace.users || []) {
    const userId = user.slack_user_id;
    try {
      const open = await app.client.conversations.open({ users: userId });
      const dmChannelId = open.channel && open.channel.id;

      await app.client.chat.postMessage({
        channel: dmChannelId,
        text: checkinMessage,
      });

      await dailyLog.markSent(workspace, userId, user.name);
      console.log(`[${workspaceId}] Sent daily check-in to ${user.name} (${userId})`);
    } catch (err) {
      console.error(`[${workspaceId}] Failed to send check-in to ${user.name} (${userId}):`, err.message);
    }

    // Space out messages to stay clear of rate limits.
    await delay(1000);
  }
}

/**
 * Sends a reminder to every configured user in the workspace who has not yet
 * replied today.
 */
async function runReminder(app, workspaceId) {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return;

  const { schedule = {}, reminder = {}, messages = {} } = workspace;
  if (!reminder.enabled) {
    return;
  }

  // Honor the same day-of-week restriction as the check-in.
  const days = schedule.days || [];
  if (days.length && !days.includes(currentWeekday(schedule.timezone))) {
    return;
  }

  const reminderMessage = messages.reminder;
  if (!reminderMessage) {
    return;
  }

  for (const user of workspace.users || []) {
    const userId = user.slack_user_id;

    if (!(await dailyLog.isAwaitingReply(workspace, userId))) {
      continue;
    }

    try {
      const open = await app.client.conversations.open({ users: userId });
      const dmChannelId = open.channel && open.channel.id;

      await app.client.chat.postMessage({
        channel: dmChannelId,
        text: reminderMessage,
      });
      console.log(`[${workspaceId}] Sent reminder to ${user.name} (${userId})`);
    } catch (err) {
      console.error(`[${workspaceId}] Failed to send reminder to ${user.name} (${userId}):`, err.message);
    }

    await delay(1000);
  }
}

/**
 * Schedules the daily check-in and reminder cron jobs for a single workspace.
 * Called once per workspace.
 *
 * @param {import('@slack/bolt').App} app
 * @param {object} workspace
 */
function startScheduler(app, workspace) {
  // Read timing once at startup to build the cron expressions. Message content,
  // user list, and day restrictions are re-read fresh on every execution.
  const { schedule = {}, reminder = {} } = workspace;
  const timezone = schedule.timezone || 'UTC';

  const checkinHour = schedule.send_time_hour ?? 18;
  const checkinMinute = schedule.send_time_minute ?? 0;
  const checkinCron = `${checkinMinute} ${checkinHour} * * *`;

  cron.schedule(
    checkinCron,
    () => {
      runDailyCheckin(app, workspace.id).catch((err) =>
        console.error(`[${workspace.id}] Unhandled error in daily check-in job:`, err.message)
      );
    },
    { timezone }
  );
  console.log(`[${workspace.id}] Scheduled daily check-in at ${checkinCron} (${timezone})`);

  if (reminder.enabled) {
    const reminderHour = reminder.reminder_hour ?? 21;
    const reminderMinute = reminder.reminder_minute ?? 0;
    const reminderCron = `${reminderMinute} ${reminderHour} * * *`;

    cron.schedule(
      reminderCron,
      () => {
        runReminder(app, workspace.id).catch((err) =>
          console.error(`[${workspace.id}] Unhandled error in reminder job:`, err.message)
        );
      },
      { timezone }
    );
    console.log(`[${workspace.id}] Scheduled reminder at ${reminderCron} (${timezone})`);
  }
}

module.exports = { startScheduler };
