'use strict';

const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SHEET_RANGE = 'Sheet1!A:H';
const HEADER_ROW = [
  'Date',
  'Name',
  'Slack User ID',
  'Hours Worked',
  'Description',
  'Raw Reply',
  'Auto-Parsed',
  'Logged At',
];

let sheetsClient = null;

/**
 * Lazily builds and caches the authenticated Sheets v4 client.
 */
function getSheetsClient() {
  if (sheetsClient) {
    return sheetsClient;
  }

  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: privateKey,
    },
    scopes: SCOPES,
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

/**
 * Writes the header row if cell A1 is currently empty. Existing headers are
 * never overwritten.
 */
async function ensureHeaders(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Sheet1!A1',
  });

  const hasValue = Array.isArray(res.data.values) && res.data.values.length > 0;
  if (hasValue) {
    return;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Sheet1!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [HEADER_ROW] },
  });
}

/**
 * Appends a work-log entry to the configured Google Sheet.
 *
 * @param {{
 *   date: string,
 *   name: string,
 *   slack_user_id: string,
 *   hours: number|null,
 *   description: string,
 *   raw_reply: string,
 *   parsed: boolean,
 *   logged_at: string
 * }} entry
 */
async function logEntry(entry) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  try {
    const sheets = getSheetsClient();

    await ensureHeaders(sheets, spreadsheetId);

    const row = [
      entry.date,
      entry.name,
      entry.slack_user_id,
      entry.hours === null || entry.hours === undefined ? '' : entry.hours,
      entry.description,
      entry.raw_reply,
      entry.parsed ? 'Yes' : 'No',
      entry.logged_at,
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: SHEET_RANGE,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  } catch (err) {
    // Log the error AND the raw entry so data is not silently lost.
    console.error('Failed to append entry to Google Sheet:', err.message);
    console.error('Unsaved entry:', JSON.stringify(entry));
    throw err;
  }
}

module.exports = { logEntry };
