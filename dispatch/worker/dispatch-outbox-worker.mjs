import { randomUUID } from "node:crypto";
import { getPool } from "../api/src/db.mjs";
import { sendSms } from "../comms/sms-adapter.mjs";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_BATCH_LIMIT = 20;
const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_BASE_RETRY_MS = 5_000;
const DEFAULT_MAX_RETRY_MS = 5 * 60_000;

const smsEnabled = parseBoolean(process.env.DISPATCH_SMS_ENABLED, false);
const maxAttempts = parsePositiveInteger(
  process.env.DISPATCH_OUTBOX_MAX_ATTEMPTS,
  DEFAULT_MAX_ATTEMPTS,
);
const batchLimit = parsePositiveInteger(
  process.env.DISPATCH_OUTBOX_BATCH_LIMIT,
  DEFAULT_BATCH_LIMIT,
);
const baseRetryMs = parsePositiveInteger(
  process.env.DISPATCH_OUTBOX_RETRY_BASE_MS,
  DEFAULT_BASE_RETRY_MS,
);
const maxRetryMs = parsePositiveInteger(
  process.env.DISPATCH_OUTBOX_RETRY_MAX_MS,
  DEFAULT_MAX_RETRY_MS,
);
const pollIntervalMs = parsePositiveInteger(
  process.env.DISPATCH_OUTBOX_POLL_MS,
  DEFAULT_POLL_INTERVAL_MS,
);

const STATUS_PENDING = "PENDING";
const STATUS_SENT = "SENT";
const STATUS_DEAD_LETTER = "DEAD_LETTER";

function parseBoolean(value, fallbackValue) {
  if (value == null) {
    return fallbackValue;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return fallbackValue;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "off", "no", "disabled"].includes(normalized)) {
    return false;
  }
  return fallbackValue;
}

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return parsed;
}

function backoffDelayMs(attemptCount) {
  const exponent = Math.max(0, attemptCount - 1);
  const next = baseRetryMs * 2 ** exponent;
  return Math.min(maxRetryMs, next);
}

function toIsoDate(value = new Date()) {
  return value.toISOString();
}

function clampErrorMessage(error) {
  if (error == null) {
    return "unknown";
  }
  if (typeof error === "string") {
    return error;
  }
  return error.message || error.toString();
}

function buildAuditPayload(outboxId, row, status, extra = {}) {
  return {
    outbox_id: outboxId,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    event_type: row.event_type,
    attempt_count: row.attempt_count,
    status,
    worker: "dispatch-outbox-worker",
    ...extra,
  };
}

async function writeOutboxAudit(client, params) {
  const { outboxId, row, status, extra } = params;
  await client.query(
    `
      INSERT INTO audit_events (
        ticket_id,
        actor_type,
        actor_id,
        actor_role,
        tool_name,
        request_id,
        correlation_id,
        trace_id,
        before_state,
        after_state,
        payload
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `,
    [
      row.aggregate_type === "ticket" ? row.aggregate_id : null,
      "SYSTEM",
      "dispatch-outbox-worker",
      "SYSTEM",
      "dispatch.outbox_worker",
      randomUUID(),
      null,
      null,
      null,
      null,
      buildAuditPayload(outboxId, row, status, extra),
    ],
  );
}

async function markOutboxSuccess(client, row, providerResult) {
  const payload = {
    ...row.payload,
    provider: providerResult.provider,
    provider_message_id: providerResult.providerMessageId,
    provider_status: providerResult.status,
    last_send_at: toIsoDate(),
    dry_run: providerResult.note === "dispatch_sms_dry_run_enabled",
  };

  await client.query(
    `
      UPDATE dispatch_outbox
      SET
        status = $2,
        payload = $3,
        last_error = null,
        updated_at = now()
      WHERE id = $1
    `,
    [row.id, STATUS_SENT, payload],
  );
}

async function markOutboxFailure(client, row, errorMessage) {
  const nextAttemptCount = row.attempt_count + 1;
  const shouldRetry = nextAttemptCount < maxAttempts;

  const status = shouldRetry ? STATUS_PENDING : STATUS_DEAD_LETTER;
  const nextAttemptAt = shouldRetry
    ? new Date(Date.now() + backoffDelayMs(nextAttemptCount))
    : new Date();
  await client.query(
    `
      UPDATE dispatch_outbox
      SET
        status = $2,
        attempt_count = $3,
        next_attempt_at = $4,
        last_error = $5,
        updated_at = now()
      WHERE id = $1
    `,
    [row.id, status, nextAttemptCount, nextAttemptAt, errorMessage],
  );

  return status === STATUS_DEAD_LETTER;
}

async function sendOutboxRow(client, row) {
  const message = {
    to: row.payload?.to ?? null,
    body: row.payload?.body ?? "",
    messageKey: row.idempotency_key,
  };

  const providerResult = await sendSms(message);
  await markOutboxSuccess(client, row, providerResult);
  await writeOutboxAudit(client, {
    outboxId: row.id,
    row,
    status: STATUS_SENT,
    extra: {
      provider_result: providerResult,
    },
  });
  return { status: "sent", providerMessageId: providerResult.providerMessageId };
}

async function processOutboxRow(client, row) {
  try {
    await sendOutboxRow(client, row);
    return { processed: true, sent: true, deadLettered: false };
  } catch (error) {
    const deadLettered = await markOutboxFailure(client, row, clampErrorMessage(error));
    await writeOutboxAudit(client, {
      outboxId: row.id,
      row,
      status: deadLettered ? STATUS_DEAD_LETTER : STATUS_PENDING,
      extra: {
        error: clampErrorMessage(error),
      },
    });
    return { processed: true, sent: false, deadLettered };
  }
}

export async function runOutboxWorkerIteration() {
  if (!smsEnabled) {
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      deadLettered: 0,
      skipped: true,
      reason: "sms_disabled",
    };
  }

  const pool = getPool();
  const client = await pool.connect();
  let rows = [];
  try {
    await client.query("BEGIN");
    const pendingResult = await client.query(
      `
        SELECT *
        FROM dispatch_outbox
        WHERE status = $1
          AND next_attempt_at <= now()
        ORDER BY created_at
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      `,
      [STATUS_PENDING, batchLimit],
    );
    rows = pendingResult.rows;

    if (rows.length === 0) {
      await client.query("COMMIT");
      return {
        processed: 0,
        sent: 0,
        failed: 0,
        deadLettered: 0,
        skipped: true,
        reason: "no_rows",
      };
    }

    const summary = {
      processed: 0,
      sent: 0,
      failed: 0,
      deadLettered: 0,
      skipped: false,
    };
    for (const row of rows) {
      const result = await processOutboxRow(client, row);
      summary.processed += 1;
      if (result.sent) {
        summary.sent += 1;
      } else if (result.deadLettered) {
        summary.deadLettered += 1;
        summary.failed += 1;
      } else {
        summary.failed += 1;
      }
    }

    await client.query("COMMIT");
    return summary;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function runOutboxWorker({ iterations = 1 } = {}) {
  const count = Number.isInteger(iterations) && iterations > 0 ? iterations : 1;
  for (let current = 0; current < count; current += 1) {
    const result = await runOutboxWorkerIteration();
    if (result.processed === 0 || current === count - 1) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const iterations = parsePositiveInteger(process.env.DISPATCH_OUTBOX_ITERATIONS, 1);
  runOutboxWorker({ iterations })
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(error?.message || "outbox worker failed");
      process.exitCode = 1;
    });
}
