'use strict';

/*
 * Workspace, user, schedule, and message configuration.
 *
 * This is a plain CommonJS module (not JSON) so it can carry comments. It is
 * read FRESH on every access — src/config.js busts the require cache each time —
 * so edits here take effect without restarting the bot or scheduler.
 *
 * Tokens are NOT stored here. Each workspace's Slack tokens live in .env by
 * convention: SLACK_BOT_TOKEN_<ID> / SLACK_APP_TOKEN_<ID>, where <ID> is the
 * workspace id uppercased with non-alphanumerics replaced by "_".
 */

// Shared check-in / reminder / confirmation copy. Defined once and reused by
// each workspace below so the wording stays consistent. Override per workspace
// by replacing `messages` with a workspace-specific object.
const messages = {
  // First DM of the day, asking for the update.
  checkin: [
    'Hey! Quick daily check-in.',
    '',
    'Please reply with your hours and what you worked on, separated by a `|`:',
    '',
    '*hours* `|` *what you worked on*',
    '',
    'For example:',
    '• `3 hours | redesigned the dashboard layout and added the date-range filter`',
    '• `2h | fixed the login bug where expired sessions were not redirecting to /login`',
  ].join('\n'),

  // Nudge sent later if the user hasn't replied yet.
  reminder: 'Hey, just a reminder to send in your daily update when you get a chance!',

  // Sent after a reply is successfully logged.
  confirmation: 'Thanks! Your update has been logged.',

  // Sent when a reply is missing the "|" separator or the hours can't be read.
  // The user stays "awaiting reply" so they can simply resend in the right shape.
  format_help: [
    "I couldn't read that. Please use *hours* `|` *what you worked on*.",
    '',
    'For example:',
    '• `3 hours | redesigned the dashboard layout and added the date-range filter`',
    '• `2h | fixed the login bug where expired sessions were not redirecting to /login`',
  ].join('\n'),
};

// Daily schedule shared by the workspaces below. Times are in each workspace's
// own `timezone`. `days` whitelists which weekdays the check-in/reminder run.
const schedule = {
  send_time_hour: 22, // 24h clock, workspace timezone
  send_time_minute: 0,
  timezone: 'Asia/Kolkata',
  days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};

// Reminder fires at this time if the user is still awaiting a reply.
const reminder = {
  enabled: true,
  reminder_hour: 23,
  reminder_minute: 0,
};

module.exports = {
  // Dashboard logins. `workspaces` lists the workspace ids each user may view;
  // use "*" to grant access to every workspace. Passwords live in .env as
  // DASHBOARD_PASSWORD_<USERNAME>.
  dashboard_users: [
    { username: 'kalpit', workspaces: ['avetria', 'misfit'] },
    { username: 'suraj', workspaces: ['avetria'] },
  ],

  // One entry per Slack workspace. `id` drives env-var token naming and
  // dashboard scoping; `sheet_id` is the (currently unused) Google Sheet id.
  workspaces: [
    {
      id: 'avetria',
      name: 'Avetria',
      sheet_id: '',
      users: [
        { slack_user_id: 'U0AGQ48DBQ9', name: 'Vimarsh' },
        { slack_user_id: 'U0AK32UUWFJ', name: 'Rijul' },
        // { slack_user_id: 'U0AGA8AS1B2', name: 'Kalpit' },
      ],
      schedule,
      reminder,
      messages,
    },

    {
      id: 'misfit',
      name: 'Misfit',
      sheet_id: '',
      users: [
        { slack_user_id: 'U0B1P6NLMSR', name: 'Dainik' },
        // { slack_user_id: 'U0B1SJ7E6MQ', name: 'Kalpit' },
      ],
      schedule,
      reminder,
      messages,
    },
  ],
};
