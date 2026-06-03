# Slack Work Logger

A production-ready Node.js bot that DMs your team a daily check-in over Slack,
listens for their replies via **Socket Mode** (no public webhook needed), parses
the hours worked and a description, stores everything in a **MySQL** database
(and optionally a **Google Sheet**), and shows it all in an authenticated
**web dashboard**.

Runs on a VPS under **PM2**, or on managed Node.js hosting such as
**Hostinger Business** (the dashboard's HTTP server doubles as the keep-alive the
platform expects).

## How it works

1. A `node-cron` job sends a daily DM to every user listed in
   `config/users.json` asking how many hours they worked and what they did.
2. The bot connects to Slack over an outbound WebSocket (Socket Mode), so no
   public inbound webhook is required.
3. When a configured user replies in their DM, the reply is parsed and stored in
   a **MySQL** database (and appended to your Google Sheet if configured).
4. An optional reminder job nudges anyone who hasn't replied yet.
5. A built-in **web dashboard** (password-protected) shows today's check-in
   status (sent / awaiting / replied) and a searchable table of all logged
   entries.

## The dashboard

Open the server's URL in a browser and sign in with `DASHBOARD_USERNAME` /
`DASHBOARD_PASSWORD` (see `.env`). You get:

- **Summary cards** — replied today, awaiting reply, hours logged in the last 7
  days, and total entries.
- **Today's Status tab** — every configured user with a colored badge
  (Replied / Awaiting / Not sent) plus the times the message was sent and replied.
- **All Entries tab** — every logged entry (date, name, hours, description, raw
  reply, auto-parsed flag, logged-at), with filters by user, date range, and a
  free-text search.

The dashboard is plain HTML/CSS/JS (no build step) so it deploys anywhere.

## Project structure

```
slack-work-logger/
  src/
    index.js          entry point: web server + Bolt app + cron
    webServer.js      Express dashboard (auth, API, static), binds to PORT
    scheduler.js      cron jobs that send daily DMs + reminders
    slackHandler.js   handles incoming DM replies via Bolt
    sheetsLogger.js   best-effort append of rows to the Google Sheet
    parser.js         extracts hours + description from free-text replies
    dailyLog.js       per-user daily check-in status (backed by MySQL)
    db.js             MySQL (mysql2) schema + queries
    config.js         shared config + timezone-aware date helpers
  public/
    views/            login.html, index.html (dashboard)
    assets/           styles.css, app.js, login.js
  config/
    users.json        users, schedule, reminder, and message text
  logs/               PM2 logs (auto-created, git-ignored)
  .env                secrets (never committed)
  .env.example        template of required keys
  ecosystem.config.js PM2 config
  package.json
```

The only file you normally edit to manage users, timings, and message text is
`config/users.json`. The scheduler reads it fresh on every run, so user/schedule
changes take effect **without a restart**.

> **Storage note:** the MySQL database is the source of truth for the dashboard
> and is written first, so the dashboard works even if Google Sheets is not
> configured. Google Sheets logging is best-effort: a Sheets failure is logged
> but never blocks recording the reply or sending the confirmation.

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

## Part 3: Environment variables

Copy `.env.example` to `.env` and fill it in. Full list:

| Variable | Required | Purpose |
| --- | --- | --- |
| `SLACK_BOT_TOKEN` | yes | Bot token (`xoxb-…`) for sending DMs |
| `SLACK_APP_TOKEN` | yes | App-level token (`xapp-…`) for Socket Mode |
| `MYSQL_HOST` | yes | MySQL host |
| `MYSQL_PORT` | optional | MySQL port (defaults to `3306`) |
| `MYSQL_USER` | yes | MySQL user |
| `MYSQL_PASSWORD` | yes | MySQL password |
| `MYSQL_DATABASE` | yes | MySQL database name (must already exist) |
| `MYSQL_SSL` | optional | Set to `true` if the provider requires TLS |
| `GOOGLE_SHEET_ID` | optional | Enables Google Sheets mirroring |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | optional | Service account for Sheets |
| `GOOGLE_PRIVATE_KEY` | optional | Service account key for Sheets |
| `PORT` | optional | Dashboard port (managed hosts inject this; defaults to `3000`) |
| `DASHBOARD_USERNAME` | yes | Dashboard login username |
| `DASHBOARD_PASSWORD` | yes | Dashboard login password — **change it** |
| `SESSION_SECRET` | recommended | Signs session cookies; use a long random string |

> The Google variables are optional: without them the bot still records every
> reply to MySQL and the dashboard works fully — it just skips the Sheet.
>
> The database (named by `MYSQL_DATABASE`) must exist before first run; the app
> creates the `daily_status` and `entries` tables automatically.

Generate a strong session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Part 4: Deploy on Hostinger Business (managed Node.js) — "Plan A"

Hostinger **Business** web hosting can run this because the dashboard is a real
HTTP server bound to `process.env.PORT`, which is exactly what the managed
Node.js platform expects (it would otherwise idle out a no-HTTP background
worker). The Slack Socket Mode connection and cron jobs run inside the same
process.

1. In **hPanel → Websites → your site → Node.js**, create an application:
   - **Application root:** the folder you upload the project to.
   - **Application startup file:** `src/index.js`
   - **Node.js version:** 22.x
2. Upload the project (Git deploy or File Manager). Do **not** upload `.env`
   or `node_modules/`.
3. Set the environment variables from Part 3 in the Node.js app's
   **Environment variables** section (don't commit `.env` to the server). Leave
   `PORT` unset — Hostinger provides it. Point the `MYSQL_*` variables at your
   managed MySQL instance.
4. Run **NPM Install** from the Node.js panel (or `npm install` over SSH).
   - `mysql2` is pure JavaScript with no native build step, so this needs no
     compiler on any platform.
5. **Start/Restart** the application from the panel.
6. Visit your domain and sign in to the dashboard. The bot is live as soon as
   the process is running.

> Persistence: data lives in your MySQL server, not on the app's local disk, so
> it survives restarts and redeploys regardless of whether the app directory is
> wiped. Make sure the `MYSQL_*` credentials point at a durable database.

---

## Part 5: VPS Deployment on Hostinger

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

## Part 6: Useful PM2 Commands

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

You should see `Dashboard listening on port 3000` and then
`Slack Work Logger is running` once it connects. Open
<http://localhost:3000> and sign in with your `DASHBOARD_USERNAME` /
`DASHBOARD_PASSWORD`.

The dashboard starts even if Slack credentials are missing or invalid, so you
can develop the UI against the MySQL database independently.

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
