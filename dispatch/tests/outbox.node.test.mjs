import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { canonicalJsonHash } from "../api/src/canonical-json.mjs";
import { closePool, getPool } from "../api/src/db.mjs";
import { startDispatchApi } from "../api/src/server.mjs";
import { DispatchBridgeError, invokeDispatchAction } from "../tools-plugin/src/bridge.mjs";

const repoRoot = process.cwd();
const migrationSql = fs.readFileSync(
  path.resolve(repoRoot, "dispatch/db/migrations/001_init.sql"),
  "utf8",
);

const postgresContainer = "rd-outbox-test";
const postgresPort = 55444;
const dispatchApiPort = 18093;
const dispatchApiBaseUrl = `http://127.0.0.1:${dispatchApiPort}`;
const adapterPath = path.resolve(repoRoot, "dispatch/tests/outbox-sms-adapter.mjs");

const accountId = "00000000-0000-0000-0000-000000000211";
const siteId = "00000000-0000-0000-0000-000000000212";
const techId = "00000000-0000-0000-0000-000000000213";
const scheduleConfirmEvent = "schedule.confirm.sms";

const scheduleTimes = {
  start: "2026-02-20T10:00:00.000Z",
  end: "2026-02-20T11:00:00.000Z",
};

let app;
let pool;
let previousSmsEnv;
let worker;
let smsAdapter;

function run(command, args, input = undefined) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input,
  });
  if (result.status !== 0) {
    throw new Error(
      [`Command failed: ${command} ${args.join(" ")}`, result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.stdout.trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outboxTransitionId(ticketId, eventType, fromState, scheduledStart, scheduledEnd) {
  return `${ticketId}:${eventType}:${canonicalJsonHash({
    ticket_id: ticketId,
    event_type: eventType,
    from_state: fromState,
    to_state: "SCHEDULED",
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
  })}`;
}

function outboxIdempotencyKey(ticketId, eventType, stateTransitionId) {
  return `${ticketId}:${eventType}:${stateTransitionId}`;
}

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function insertOutboxRow(params) {
  const {
    aggregateId,
    eventType = scheduleConfirmEvent,
    payload,
    idempotencyKey,
    status = "PENDING",
    attemptCount = 0,
  } = params;

  const insertResult = await query(
    `
      INSERT INTO dispatch_outbox (
        aggregate_type,
        aggregate_id,
        event_type,
        payload,
        idempotency_key,
        status,
        attempt_count
      )
      VALUES ('ticket', $1, $2, $3, $4, $5, $6)
      RETURNING id
    `,
    [aggregateId, eventType, payload, idempotencyKey, status, attemptCount],
  );
  return insertResult.rows[0];
}

async function insertTicketAndPrepareForScheduleConfirm() {
  const createResponse = await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "ticket.create",
    actorId: "dispatcher-outbox",
    actorRole: "dispatcher",
    actorType: "AGENT",
    requestId: randomUUID(),
    correlationId: randomUUID(),
    payload: {
      account_id: accountId,
      site_id: siteId,
      summary: "Outbox SMS flow",
      description: "Ticket for outbox test path.",
      nte_cents: 8500,
    },
  });

  const ticketId = createResponse.data.id;

  await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "ticket.triage",
    actorId: "dispatcher-outbox",
    actorRole: "dispatcher",
    actorType: "AGENT",
    requestId: randomUUID(),
    correlationId: randomUUID(),
    ticketId,
    payload: {
      priority: "ROUTINE",
      incident_type: "CANNOT_SECURE_ENTRY",
      ready_to_schedule: true,
      description: "Ready for schedule confirm test",
      nte_cents: 8500,
    },
  });

  await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "schedule.propose",
    actorId: "dispatcher-outbox",
    actorRole: "dispatcher",
    actorType: "AGENT",
    requestId: randomUUID(),
    correlationId: randomUUID(),
    ticketId,
    payload: {
      options: [scheduleTimes],
    },
  });

  return { ticketId, ...scheduleTimes };
}

async function countOutbox(ticketId, eventType = null) {
  const result = await query(
    eventType == null
      ? "SELECT count(*)::int AS count FROM dispatch_outbox WHERE aggregate_id = $1"
      : "SELECT count(*)::int AS count FROM dispatch_outbox WHERE aggregate_id = $1 AND event_type = $2",
    eventType == null ? [ticketId] : [ticketId, eventType],
  );
  return result.rows[0]?.count ?? 0;
}

async function getOutboxById(outboxId) {
  const result = await query("SELECT * FROM dispatch_outbox WHERE id = $1", [outboxId]);
  return result.rows[0] ?? null;
}

function toIdError(error) {
  return error instanceof Error && (error.code === "23505" || error.code === "23503");
}

function actionErrorCodeMatcher(expectedStatus) {
  return (error) => {
    if (!(error instanceof DispatchBridgeError)) {
      throw error;
    }
    if (expectedStatus != null) {
      assert.equal(error.status, expectedStatus);
    }
    return true;
  };
}

async function clearOutboxState() {
  await query("DELETE FROM dispatch_outbox");
}

function setSmsMode(mode) {
  smsAdapter.setAdapterMode(mode);
  smsAdapter.resetAdapterState();
}

test.before(async () => {
  previousSmsEnv = {
    enabled: process.env.DISPATCH_SMS_ENABLED,
    dryRun: process.env.DISPATCH_SMS_DRY_RUN,
    adapter: process.env.DISPATCH_SMS_ADAPTER,
    maxAttempts: process.env.DISPATCH_OUTBOX_MAX_ATTEMPTS,
    retryBaseMs: process.env.DISPATCH_OUTBOX_RETRY_BASE_MS,
    retryMaxMs: process.env.DISPATCH_OUTBOX_RETRY_MAX_MS,
    pollMs: process.env.DISPATCH_OUTBOX_POLL_MS,
  };

  process.env.DISPATCH_SMS_ENABLED = "true";
  process.env.DISPATCH_SMS_DRY_RUN = "false";
  process.env.DISPATCH_SMS_ADAPTER = adapterPath;
  process.env.DISPATCH_OUTBOX_MAX_ATTEMPTS = "2";
  process.env.DISPATCH_OUTBOX_RETRY_BASE_MS = "1";
  process.env.DISPATCH_OUTBOX_RETRY_MAX_MS = "100";
  process.env.DISPATCH_OUTBOX_POLL_MS = "10";

  run("docker", ["rm", "-f", postgresContainer]);
  run("docker", [
    "run",
    "--rm",
    "-d",
    "--name",
    postgresContainer,
    "-e",
    "POSTGRES_USER=dispatch",
    "-e",
    "POSTGRES_PASSWORD=dispatch",
    "-e",
    "POSTGRES_DB=dispatch",
    "-p",
    `${postgresPort}:5432`,
    "postgres:16",
  ]);

  let ready = false;
  for (let i = 0; i < 30; i += 1) {
    const probe = spawnSync(
      "docker",
      ["exec", postgresContainer, "pg_isready", "-U", "dispatch", "-d", "dispatch"],
      { encoding: "utf8" },
    );
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await sleep(500);
  }

  if (!ready) {
    throw new Error("Postgres container did not become ready");
  }

  process.env.DISPATCH_DATABASE_URL = `postgres://dispatch:dispatch@127.0.0.1:${postgresPort}/dispatch`;

  pool = getPool();

  run(
    "docker",
    [
      "exec",
      "-i",
      postgresContainer,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "dispatch",
      "-d",
      "dispatch",
    ],
    migrationSql,
  );

  await query(
    `INSERT INTO accounts (id, name)
     VALUES ('${accountId}', 'Outbox Account');`,
  );
  await query(
    `INSERT INTO sites (id, account_id, name, address1, city)
     VALUES ('${siteId}', '${accountId}', 'Outbox Site', '100 Main St', 'Testville');`,
  );

  app = await startDispatchApi({
    host: "127.0.0.1",
    port: dispatchApiPort,
  });

  pool = getPool();
  const workerModule = await import("../worker/dispatch-outbox-worker.mjs");
  const adapterModule = await import("./outbox-sms-adapter.mjs");
  worker = workerModule;
  smsAdapter = adapterModule;

  setSmsMode("accept");
});

test.after(async () => {
  if (app) {
    await app.stop();
  }

  if (previousSmsEnv != null) {
    if (previousSmsEnv.enabled === undefined) {
      delete process.env.DISPATCH_SMS_ENABLED;
    } else {
      process.env.DISPATCH_SMS_ENABLED = previousSmsEnv.enabled;
    }

    if (previousSmsEnv.dryRun === undefined) {
      delete process.env.DISPATCH_SMS_DRY_RUN;
    } else {
      process.env.DISPATCH_SMS_DRY_RUN = previousSmsEnv.dryRun;
    }

    if (previousSmsEnv.adapter === undefined) {
      delete process.env.DISPATCH_SMS_ADAPTER;
    } else {
      process.env.DISPATCH_SMS_ADAPTER = previousSmsEnv.adapter;
    }

    if (previousSmsEnv.maxAttempts === undefined) {
      delete process.env.DISPATCH_OUTBOX_MAX_ATTEMPTS;
    } else {
      process.env.DISPATCH_OUTBOX_MAX_ATTEMPTS = previousSmsEnv.maxAttempts;
    }

    if (previousSmsEnv.retryBaseMs === undefined) {
      delete process.env.DISPATCH_OUTBOX_RETRY_BASE_MS;
    } else {
      process.env.DISPATCH_OUTBOX_RETRY_BASE_MS = previousSmsEnv.retryBaseMs;
    }

    if (previousSmsEnv.retryMaxMs === undefined) {
      delete process.env.DISPATCH_OUTBOX_RETRY_MAX_MS;
    } else {
      process.env.DISPATCH_OUTBOX_RETRY_MAX_MS = previousSmsEnv.retryMaxMs;
    }

    if (previousSmsEnv.pollMs === undefined) {
      delete process.env.DISPATCH_OUTBOX_POLL_MS;
    } else {
      process.env.DISPATCH_OUTBOX_POLL_MS = previousSmsEnv.pollMs;
    }
  }

  await closePool();
  run("docker", ["rm", "-f", postgresContainer]);
});

test.beforeEach(async () => {
  await clearOutboxState();
  setSmsMode("accept");
});

test("outbox row is written atomically with schedule.confirm", async () => {
  const { ticketId, start, end } = await insertTicketAndPrepareForScheduleConfirm();

  const response = await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "schedule.confirm",
    actorId: "dispatcher-outbox-confirm",
    actorRole: "dispatcher",
    actorType: "AGENT",
    requestId: randomUUID(),
    correlationId: randomUUID(),
    ticketId,
    payload: { start, end },
  });

  assert.equal(response.status, 200);
  assert.equal(response.data.state, "SCHEDULED");

  const rowCount = await countOutbox(ticketId, scheduleConfirmEvent);
  assert.equal(rowCount, 1);

  const rowResult = await query(
    "SELECT * FROM dispatch_outbox WHERE aggregate_id = $1 AND event_type = $2 ORDER BY created_at DESC LIMIT 1",
    [ticketId, scheduleConfirmEvent],
  );
  const outboxRow = rowResult.rows[0];
  assert.equal(outboxRow.status, "PENDING");
  assert.equal(outboxRow.attempt_count, 0);
  assert.equal(typeof outboxRow.idempotency_key, "string");

  const transitionId = outboxTransitionId(
    ticketId,
    scheduleConfirmEvent,
    "SCHEDULE_PROPOSED",
    start,
    end,
  );
  const expectedIdempotencyKey = outboxIdempotencyKey(ticketId, scheduleConfirmEvent, transitionId);
  assert.equal(outboxRow.idempotency_key, expectedIdempotencyKey);
});

test("outbox insert failure rolls back schedule.confirm transition", async () => {
  const { ticketId, start, end } = await insertTicketAndPrepareForScheduleConfirm();

  const beforeTransitionCountResult = await query(
    "SELECT count(*)::int AS count FROM ticket_state_transitions WHERE ticket_id = $1",
    [ticketId],
  );
  const beforeTransitionCount = beforeTransitionCountResult.rows[0]?.count ?? 0;

  const transitionId = outboxTransitionId(
    ticketId,
    scheduleConfirmEvent,
    "SCHEDULE_PROPOSED",
    start,
    end,
  );
  const idempotencyKey = outboxIdempotencyKey(ticketId, scheduleConfirmEvent, transitionId);

  await insertOutboxRow({
    aggregateId: ticketId,
    eventType: scheduleConfirmEvent,
    payload: {
      channel: "SMS",
      to: "+15555550001",
      body: "duplicate injection",
      event_type: scheduleConfirmEvent,
    },
    idempotencyKey,
  });

  await assert.rejects(
    () =>
      invokeDispatchAction({
        baseUrl: dispatchApiBaseUrl,
        toolName: "schedule.confirm",
        actorId: "dispatcher-outbox-confirm",
        actorRole: "dispatcher",
        actorType: "AGENT",
        requestId: randomUUID(),
        correlationId: randomUUID(),
        ticketId,
        payload: { start, end },
      }),
    actionErrorCodeMatcher(),
  );

  const stateResult = await query("SELECT state::text FROM tickets WHERE id = $1", [ticketId]);
  assert.equal(stateResult.rows[0]?.state, "SCHEDULE_PROPOSED");

  const afterTransitionCountResult = await query(
    "SELECT count(*)::int AS count FROM ticket_state_transitions WHERE ticket_id = $1",
    [ticketId],
  );
  assert.equal(afterTransitionCountResult.rows[0]?.count, beforeTransitionCount);

  const collisionResult = await query(
    "SELECT count(*)::int AS count FROM dispatch_outbox WHERE idempotency_key = $1",
    [idempotencyKey],
  );
  assert.equal(collisionResult.rows[0]?.count, 1);
});

test("worker sends each outbox message exactly once", async () => {
  const { ticketId, start, end } = await insertTicketAndPrepareForScheduleConfirm();

  await setSmsMode("accept");
  await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "schedule.confirm",
    actorId: "dispatcher-outbox-confirm",
    actorRole: "dispatcher",
    actorType: "AGENT",
    requestId: randomUUID(),
    correlationId: randomUUID(),
    ticketId,
    payload: { start, end },
  });

  const rowResult = await query(
    "SELECT id FROM dispatch_outbox WHERE aggregate_id = $1 AND event_type = $2 ORDER BY created_at DESC LIMIT 1",
    [ticketId, scheduleConfirmEvent],
  );
  assert.ok(rowResult.rows[0]?.id);

  const firstSummary = await worker.runOutboxWorkerIteration();
  assert.equal(firstSummary.processed, 1);
  assert.equal(firstSummary.sent, 1);
  assert.equal(smsAdapter.getAdapterState().sendCount, 1);

  const secondSummary = await worker.runOutboxWorkerIteration();
  assert.equal(secondSummary.processed, 0);
  assert.equal(smsAdapter.getAdapterState().sendCount, 1);

  const finalRow = await getOutboxById(rowResult.rows[0].id);
  assert.equal(finalRow.status, "SENT");
});

test("duplicate outbox idempotency keys are rejected", async () => {
  const idempotencyKey = `dup-${randomUUID()}`;
  await insertOutboxRow({
    aggregateId: accountId,
    payload: {
      channel: "SMS",
      to: "+15555550002",
      body: "first",
      event_type: scheduleConfirmEvent,
    },
    idempotencyKey,
    eventType: scheduleConfirmEvent,
  });

  await assert.rejects(async () => {
    await insertOutboxRow({
      aggregateId: accountId,
      payload: {
        channel: "SMS",
        to: "+15555550002",
        body: "duplicate",
        event_type: scheduleConfirmEvent,
      },
      idempotencyKey,
      eventType: scheduleConfirmEvent,
    });
  }, toIdError);

  const rowCountResult = await query(
    "SELECT count(*)::int AS count FROM dispatch_outbox WHERE idempotency_key = $1",
    [idempotencyKey],
  );
  assert.equal(rowCountResult.rows[0]?.count, 1);
});
test("outbox worker retries and increments attempt count", async () => {
  const row = await insertOutboxRow({
    aggregateId: accountId,
    payload: {
      channel: "SMS",
      to: "+15555550003",
      body: "retry",
      event_type: scheduleConfirmEvent,
    },
    idempotencyKey: `retry-${randomUUID()}`,
    eventType: scheduleConfirmEvent,
  });

  setSmsMode("fail_once");
  const firstRun = await worker.runOutboxWorkerIteration();
  assert.equal(firstRun.processed, 1);
  assert.equal(firstRun.sent, 0);

  const firstState = await getOutboxById(row.id);
  assert.equal(firstState.attempt_count, 1);
  assert.equal(firstState.status, "PENDING");

  setSmsMode("accept");
  await query("UPDATE dispatch_outbox SET next_attempt_at = now() WHERE id = $1", [row.id]);

  const secondRun = await worker.runOutboxWorkerIteration();
  assert.equal(secondRun.processed, 1);
  assert.equal(secondRun.sent, 1);

  const secondState = await getOutboxById(row.id);
  assert.equal(secondState.attempt_count, 1);
  assert.equal(secondState.status, "SENT");
});

test("outbox worker dead-letters after max attempts", async () => {
  const row = await insertOutboxRow({
    aggregateId: accountId,
    payload: {
      channel: "SMS",
      to: "+15555550004",
      body: "always fails",
      event_type: scheduleConfirmEvent,
    },
    idempotencyKey: `dead-${randomUUID()}`,
    eventType: scheduleConfirmEvent,
  });

  setSmsMode("always_fail");
  const runSummary = await worker.runOutboxWorker({ iterations: 2 });
  assert.equal(runSummary.processed, 2);
  assert.equal(runSummary.deadLettered, 1);

  const finalState = await getOutboxById(row.id);
  assert.equal(finalState.status, "DEAD_LETTER");
  assert.equal(finalState.attempt_count, 2);
  assert.equal(typeof finalState.last_error, "string");
});

test("outbox.replay sets dead-letter row back to pending", async () => {
  const row = await insertOutboxRow({
    aggregateId: accountId,
    payload: {
      channel: "SMS",
      to: "+15555550005",
      body: "for replay",
      event_type: scheduleConfirmEvent,
    },
    idempotencyKey: `replay-${randomUUID()}`,
    eventType: scheduleConfirmEvent,
    status: "DEAD_LETTER",
    attemptCount: 2,
  });

  const replay = await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "outbox.replay",
    actorId: "finance-outbox-replay",
    actorRole: "finance",
    actorType: "AGENT",
    requestId: randomUUID(),
    correlationId: randomUUID(),
    payload: {
      outbox_id: row.id,
    },
  });

  assert.equal(replay.status, 200);
  assert.equal(replay.data.status, "PENDING");
  assert.equal(replay.data.id, row.id);

  const replayState = await getOutboxById(row.id);
  assert.equal(replayState.status, "PENDING");
  assert.equal(replayState.attempt_count, 0);
  assert.equal(replayState.last_error, null);
});

test("worker sends are recorded as outbox audit events", async () => {
  const row = await insertOutboxRow({
    aggregateId: accountId,
    payload: {
      channel: "SMS",
      to: "+15555550006",
      body: "audit capture",
      event_type: scheduleConfirmEvent,
    },
    idempotencyKey: `audit-${randomUUID()}`,
    eventType: scheduleConfirmEvent,
  });

  setSmsMode("accept");
  const runSummary = await worker.runOutboxWorkerIteration();
  assert.equal(runSummary.sent, 1);

  const auditRows = await query(
    `SELECT count(*)::int AS count
     FROM audit_events
     WHERE tool_name = 'dispatch.outbox_worker'
       AND payload->>'outbox_id' = $1`,
    [row.id],
  );
  assert.equal(auditRows.rows[0]?.count, 1);

  const statusAudit = await query(
    `SELECT payload->>'status' AS status
     FROM audit_events
     WHERE tool_name = 'dispatch.outbox_worker'
       AND payload->>'outbox_id' = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [row.id],
  );
  assert.equal(statusAudit.rows[0]?.status, "SENT");
});
