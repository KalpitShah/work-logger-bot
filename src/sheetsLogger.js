'use strict';

/*
 * Google Sheets logging is currently DISABLED. The implementation below is
 * commented out and no callers remain (see src/slackHandler.js). A no-op
 * `logEntry` stub is exported so any lingering `require('./sheetsLogger')`
 * stays safe.
 *
 * To re-enable: uncomment the implementation below, restore the `sheetsLogger`
 * require and the append call in src/slackHandler.js, and set the GOOGLE_* env
 * vars / per-workspace sheet_id.
 */

// const { google } = require('googleapis');
//
// const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
// const SHEET_RANGE = 'Sheet1!A:H';
// const HEADER_ROW = [
//   'Date',
//   'Name',
//   'Slack User ID',
//   'Hours Worked',
//   'Description',
//   'Raw Reply',
//   'Auto-Parsed',
//   'Logged At',
// ];
//
// let sheetsClient = null;
//
// // Lazily builds and caches the authenticated Sheets v4 client.
// function getSheetsClient() {
//   if (sheetsClient) {
//     return sheetsClient;
//   }
//
//   const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
//
//   const auth = new google.auth.GoogleAuth({
//     credentials: {
//       client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
//       private_key: privateKey,
//     },
//     scopes: SCOPES,
//   });
//
//   sheetsClient = google.sheets({ version: 'v4', auth });
//   return sheetsClient;
// }
//
// // Writes the header row if cell A1 is currently empty. Existing headers are
// // never overwritten.
// async function ensureHeaders(sheets, spreadsheetId) {
//   const res = await sheets.spreadsheets.values.get({
//     spreadsheetId,
//     range: 'Sheet1!A1',
//   });
//
//   const hasValue = Array.isArray(res.data.values) && res.data.values.length > 0;
//   if (hasValue) {
//     return;
//   }
//
//   await sheets.spreadsheets.values.update({
//     spreadsheetId,
//     range: 'Sheet1!A1',
//     valueInputOption: 'USER_ENTERED',
//     requestBody: { values: [HEADER_ROW] },
//   });
// }
//
// // Appends a work-log entry to the configured Google Sheet. `sheetId` is the
// // per-workspace sheet id; falls back to the global GOOGLE_SHEET_ID env var.
// // If neither is set, the append is skipped silently.
// async function logEntry(entry, sheetId) {
//   const spreadsheetId = sheetId || process.env.GOOGLE_SHEET_ID;
//   if (!spreadsheetId) return; // No sheet configured for this workspace; skip.
//
//   try {
//     const sheets = getSheetsClient();
//
//     await ensureHeaders(sheets, spreadsheetId);
//
//     const row = [
//       entry.date,
//       entry.name,
//       entry.slack_user_id,
//       entry.hours === null || entry.hours === undefined ? '' : entry.hours,
//       entry.description,
//       entry.raw_reply,
//       entry.parsed ? 'Yes' : 'No',
//       entry.logged_at,
//     ];
//
//     await sheets.spreadsheets.values.append({
//       spreadsheetId,
//       range: SHEET_RANGE,
//       valueInputOption: 'USER_ENTERED',
//       requestBody: { values: [row] },
//     });
//   } catch (err) {
//     // Log the error AND the raw entry so data is not silently lost.
//     console.error('Failed to append entry to Google Sheet:', err.message);
//     console.error('Unsaved entry:', JSON.stringify(entry));
//     throw err;
//   }
// }

// No-op stub while Google Sheets logging is disabled (see block above).
async function logEntry() {}

module.exports = { logEntry };
