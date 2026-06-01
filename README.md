# Slack Work Logger

A production-ready Node.js bot that DMs your team a daily check-in over Slack,
listens for their replies via **Socket Mode** (no public webhook needed), parses
the hours worked and a description, and appends each entry to a **Google Sheet**.

Runs persistently on a VPS under **PM2**.

## How it works

1. A `node-cron` job sends a daily DM to every user listed in
   `config/users.json` asking how many hours they worked and what they did.
2. The bot connects to Slack over an outbound WebSocket (Socket Mode), so no
   public HTTP endpoint or inbound firewall rule is required.
3. When a configured user replies in their DM, the reply is parsed and a row is
   appended to your Google Sheet via the Sheets v4 API.
4. An optional reminder job nudges anyone who hasn't replied yet.

## Project structure

```
slack-work-logger/
  src/
    index.js          entry point, initializes Bolt app and cron
    scheduler.js      cron jobs that send daily DMs + reminders
    slackHandler.js   handles incoming DM replies via Bolt
    sheetsLogger.js   appends rows to the Google Sheet
    parser.js         extracts hours + description from free-text replies
    dailyLog.js       tracks who was messaged today and their reply status
  config/
    users.json        users, schedule, reminder, and message text
  data/
    daily-log.json    runtime state (auto-created, git-ignored)
  logs/               PM2 logs (auto-created, git-ignored)
  .env                secrets (never committed)
  .env.example        template of required keys
  ecosystem.config.js PM2 config
  package.json
```

The only file you normally edit to manage users, timings, and message text is
`config/users.json`. The scheduler reads it fresh on every run, so user/schedule
changes take effect **without a restart**.

---

## Part 1: Slack App Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click
   **Create New App → From Scratch**. Give it a name and pick your workspace.
2. In the sidebar open **Socket Mode** and toggle **Enable Socket Mode** on.
3. Open **Basic Information → App-Level Tokens** and click **Generate
   Token and Scopes**. Add the `connections:write` scope and generate it. The
   token starts with `xapp-` — this is your **`SLACK_APP_TOKEN`**.
4. Open **OAuth & Permissions → Scopes → Bot Token Scopes** and add:
   - `chat:write`
   - `im:history`
   - `im:read`
   - `users:read`
5. Open **Event Subscriptions**, toggle **Enable Events** on, expand
   **Subscribe to bot events**, and add `message.im`.
6. Back on **OAuth & Permissions**, click **Install to Workspace** and authorize.
7. Copy the **Bot User OAuth Token** (starts with `xoxb-`) — this is your
   **`SLACK_BOT_TOKEN`**.
8. **Finding a user's Slack User ID:** click the person's profile in Slack, open
   the three-dot **more** menu, and choose **Copy member ID** (starts with `U`).

---

## Part 2: Google Sheets Setup

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Sheets API** for that project
   (APIs & Services → Library → Google Sheets API → Enable).
3. Create a **Service Account** (APIs & Services → Credentials → Create
   Credentials → Service Account). It needs **no special GCP roles**.
4. On the service account, open **Keys → Add Key → Create new key → JSON** and
   download the JSON key file.
5. Create a new **Google Sheet**.
6. Click **Share** and share the sheet with the service account's `client_email`
   value, granting it **Editor** access.
7. From the downloaded JSON key, copy:
   - `client_email` → **`GOOGLE_SERVICE_ACCOUNT_EMAIL`**
   - `private_key` → **`GOOGLE_PRIVATE_KEY`**
8. From the sheet URL
   `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`, copy `<SHEET_ID>`
   → **`GOOGLE_SHEET_ID`**.

> The header row (`Date`, `Name`, `Slack User ID`, `Hours Worked`,
> `Description`, `Raw Reply`, `Auto-Parsed`, `Logged At`) is written
> automatically on the first run if the sheet is empty.

### About `GOOGLE_PRIVATE_KEY`

The private key contains newlines. In the `.env` file, keep them as the literal
two-character sequence `\n` and wrap the whole value in double quotes, e.g.:

```
GOOGLE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----"
```

The app converts `\n` back into real newlines at runtime.

---

## Part 3: VPS Deployment on Hostinger

1. SSH into your VPS.
2. Install Node.js 22 using nvm:
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
   source ~/.bashrc
   nvm install 22
   nvm use 22
   ```
3. Install PM2 globally:
   ```bash
   npm install pm2@latest -g
   ```
4. Copy or clone the project to the VPS, e.g. `/home/user/slack-work-logger`.
5. Configure environment and users:
   ```bash
   cp .env.example .env
   # edit .env and fill in all values
   # edit config/users.json with your real Slack user IDs, names, and timings
   ```
6. Install dependencies:
   ```bash
   npm install
   ```
7. Start with PM2:
   ```bash
   pm2 start ecosystem.config.js
   ```
8. Persist the process list and enable start on boot:
   ```bash
   pm2 save
   pm2 startup
   # then run the command PM2 prints out
   ```

### Adding / removing users

Edit `config/users.json` — **no restart needed**, the scheduler reads it fresh
on each run. If you also want the message handlers to pick up changes
immediately, run `pm2 restart slack-work-logger`.

---

## Part 4: Useful PM2 Commands

```bash
pm2 logs slack-work-logger     # live logs
pm2 status                     # check if running
pm2 restart slack-work-logger  # restart
pm2 stop slack-work-logger     # stop
```

---

## Local development

```bash
npm install
cp .env.example .env   # fill in real values
npm start
```

You should see `Slack Work Logger is running` once it connects.

## Reply parsing examples

The parser is intentionally forgiving. Examples of recognized replies:

| Reply                                   | Hours | Description                          |
| --------------------------------------- | ----- | ----------------------------------- |
| `6.5 hours, dashboard redesign`         | 6.5   | dashboard redesign                  |
| `worked on API bugs ~6`                 | 6     | API bugs                            |
| `6-7 hours fixing the deploy pipeline`  | 6     | fixing the deploy pipeline          |
| `half day, doctor appt then code review`| 4     | doctor appt then code review        |
| `full day on onboarding flow`           | 8     | onboarding flow                     |
| `day off`                               | 0     | day off                             |

If hours can't be determined, the row is still logged with `Auto-Parsed = No`
and the full reply preserved, so nothing is lost.
