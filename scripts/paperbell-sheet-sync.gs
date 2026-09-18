/**
 * Paperbell Purchases → Supabase webhook sync
 *
 * SETUP (one-time):
 *  1. Open Extensions → Apps Script in your "Paperbell Purchases" Google Sheet.
 *  2. Paste this entire file.
 *  3. Add these Script Properties (Project Settings → Script Properties):
 *       WEBHOOK_URL       → https://<your-project>.supabase.co/functions/v1/paperbell-webhook
 *       SUPABASE_ANON_KEY → your Supabase project's anon/public key
 *  4. Run installTrigger() once from the editor to register the recurring trigger.
 *
 * PAYLOAD SENT:
 *  {
 *    "event_id":   <Purchase ID column>  — idempotency key; already-processed IDs return 200
 *    "email":      <Email column>        — buyer's email, matched against clients table
 *    "product_id": <Product ID column>   — Paperbell's product ID, must exist in products table
 *  }
 *
 * HOW IT WORKS:
 *  - syncNewPurchases() runs every 5 minutes via a time-based trigger.
 *  - It reads all data rows, skips any Purchase ID already recorded as sent,
 *    and POSTs the rest to the webhook.
 *  - On HTTP 200 the Purchase ID is saved to Script Properties so it is never re-sent.
 *  - On 5xx / network error it retries up to MAX_ATTEMPTS times with exponential backoff.
 *  - On 4xx (bad payload, unmapped product, etc.) it logs the error and moves on
 *    without retrying — fix the data in the sheet, then run resetSentIds() only
 *    for that purchase ID if you need to re-send it.
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const SHEET_NAME   = 'Paperbell Purchases';
const MAX_ATTEMPTS = 3;
const SENT_IDS_KEY = 'sentPurchaseIds';

// 0-based column indices matching your sheet layout:
// Purchase ID | Product ID | Product Description | Date/Time |
// Amount | Currency | Client ID | First Name | Last Name | Email
const COL = {
  PURCHASE_ID: 0,
  PRODUCT_ID:  1,
  EMAIL:        9,
};

// ─── MAIN ────────────────────────────────────────────────────────────────────

function syncNewPurchases() {
  const props      = PropertiesService.getScriptProperties();
  const webhookUrl = props.getProperty('WEBHOOK_URL');
  const anonKey    = props.getProperty('SUPABASE_ANON_KEY');

  if (!webhookUrl || !anonKey) {
    console.error('Missing WEBHOOK_URL or SUPABASE_ANON_KEY in Script Properties.');
    return;
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    console.error(`Sheet "${SHEET_NAME}" not found.`);
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return; // header only

  const rows    = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  const sentIds = getSentIds();
  const newlySent = [];

  for (const row of rows) {
    const purchaseId = String(row[COL.PURCHASE_ID]).trim();
    if (!purchaseId || sentIds.has(purchaseId)) continue;

    const payload = {
      event_id:   purchaseId,
      email:      String(row[COL.EMAIL]).trim(),
      product_id: String(row[COL.PRODUCT_ID]).trim(),
    };

    if (!payload.email || !payload.product_id) {
      console.warn(`Row with purchase ID ${purchaseId} is missing email or product_id — skipping.`);
      continue;
    }

    try {
      postWithRetry(webhookUrl, anonKey, payload);
      sentIds.add(purchaseId);
      newlySent.push(purchaseId);
      console.log(`✓ Sent purchase ${purchaseId}`);
    } catch (err) {
      // Leave unsent — next trigger run will retry.
      console.error(`✗ Failed purchase ${purchaseId}: ${err.message}`);
    }
  }

  if (newlySent.length > 0) {
    props.setProperty(SENT_IDS_KEY, JSON.stringify([...sentIds]));
    console.log(`Saved ${newlySent.length} new sent ID(s).`);
  }
}

// ─── HTTP WITH RETRY ─────────────────────────────────────────────────────────

function postWithRetry(url, anonKey, payload) {
  const backoffMs = [1000, 2000, 4000];
  let lastErr;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) Utilities.sleep(backoffMs[attempt - 1]);

    try {
      const res = UrlFetchApp.fetch(url, {
        method:             'post',
        contentType:        'application/json',
        payload:            JSON.stringify(payload),
        muteHttpExceptions: true,
        headers: {
          Authorization: `Bearer ${anonKey}`,
          apikey:        anonKey,
        },
      });

      const code = res.getResponseCode();
      if (code >= 200 && code < 300) return; // success

      // 4xx = client error (bad data, unmapped product, etc.) — don't retry
      if (code >= 400 && code < 500) {
        throw new Error(`HTTP ${code} (not retrying): ${res.getContentText().slice(0, 300)}`);
      }

      lastErr = new Error(`HTTP ${code}: ${res.getContentText().slice(0, 300)}`);
    } catch (err) {
      if (err.message && err.message.includes('not retrying')) throw err;
      lastErr = err;
    }
  }

  throw lastErr ?? new Error(`Failed after ${MAX_ATTEMPTS} attempts`);
}

// ─── TRACKING ────────────────────────────────────────────────────────────────

function getSentIds() {
  const raw = PropertiesService.getScriptProperties().getProperty(SENT_IDS_KEY);
  return new Set(raw ? JSON.parse(raw) : []);
}

// ─── SETUP ───────────────────────────────────────────────────────────────────

function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncNewPurchases')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('syncNewPurchases')
    .timeBased()
    .everyMinutes(5)
    .create();

  console.log('Trigger installed: syncNewPurchases runs every 5 minutes.');
}

function resetSentIds() {
  PropertiesService.getScriptProperties().deleteProperty(SENT_IDS_KEY);
  console.log('Sent ID tracking cleared.');
}
