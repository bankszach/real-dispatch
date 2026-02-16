import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { closePool } from "../api/src/db.mjs";
import { startDispatchApi } from "../api/src/server.mjs";

const repoRoot = process.cwd();
const migrationSql = fs.readFileSync(
  path.resolve(repoRoot, "dispatch/db/migrations/001_init.sql"),
  "utf8",
);

const postgresContainer = "rd-story06-confirmation-hold-chain-test";
const postgresPort = 55446;
const dispatchApiPort = 18106;
const baseUrl = `http://127.0.0.1:${dispatchApiPort}`;

const accountId = "00000000-0000-0000-0000-000000000161";
const siteId = "00000000-0000-0000-0000-000000000162";

let app;
let requestCounter = 0;

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

function psql(sql) {
  return run("docker", [
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
    "-At",
    "-c",
    sql,
  ]);
}

function queryCount(sql) {
  return Number(psql(sql));
}

function nextRequestId(prefix = "96000000-0000-4000-8000") {
  requestCounter += 1;
  return `${prefix}-${String(requestCounter).padStart(12, "0")}`;
}

function toIsoFrom(baseAt, offsetMinutes) {
  return new Date(baseAt.getTime() + offsetMinutes * 60_000).toISOString();
}

function actorHeaders({ actorId, actorRole = "dispatcher", toolName, correlationId, requestId }) {
  const headers = {
    "X-Actor-Id": actorId,
    "X-Actor-Role": actorRole,
  };

  if (toolName != null) {
    headers["X-Tool-Name"] = toolName;
  }
  if (correlationId != null) {
    headers["X-Correlation-Id"] = correlationId;
  }
  if (requestId != null) {
    headers["Idempotency-Key"] = requestId;
  }

  return headers;
}

async function post(pathname, headers, payload) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  const bodyText = await response.text();
  return {
    status: response.status,
    body: bodyText ? JSON.parse(bodyText) : null,
  };
}

async function get(pathname, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "GET",
    headers,
  });
  const bodyText = await response.text();
  return {
    status: response.status,
    body: bodyText ? JSON.parse(bodyText) : null,
  };
}

function getRequestCounter(snapshot, method, endpoint, status) {
  return snapshot.counters.requests_total.find(
    (entry) =>
      entry.method === method &&
      entry.endpoint === endpoint &&
      Number(entry.status) === Number(status),
  )?.count;
}

function getErrorCounter(snapshot, code) {
  return snapshot.counters.errors_total.find((entry) => entry.code === code)?.count;
}

function getTransitionCounter(snapshot, fromState, toState) {
  return snapshot.counters.transitions_total.find(
    (entry) => entry.from_state === fromState && entry.to_state === toState,
  )?.count;
}

async function createIntakeTicket(params) {
  const {
    siteId: ticketSiteId,
    summary,
    priority,
    identityConfidence = 99,
    classificationConfidence = 99,
    actorSuffix = "dispatcher-glz06",
  } = params;
  const requestId = nextRequestId("96000000-0000-4000-8000");
  const response = await post(
    "/tickets/intake",
    actorHeaders({
      actorId: actorSuffix,
      actorRole: "dispatcher",
      toolName: "ticket.blind_intake",
      requestId,
      correlationId: `corr-glz06-intake-${requestId}`,
    }),
    {
      account_id: accountId,
      site_id: ticketSiteId,
      customer_name: `SGLZ06-${requestId}`,
      contact_phone: "555-0200",
      summary,
      incident_type: "DOOR_WONT_LATCH",
      description: `GLZ-06 contract case ${requestId}`,
      priority,
      identity_confidence: identityConfidence,
      classification_confidence: classificationConfidence,
      sop_handoff_acknowledged: true,
    },
  );
  return response;
}

async function createScheduledTicket({ summary, priority = "ROUTINE" }) {
  const create = await createIntakeTicket({
    siteId,
    summary,
    priority,
  });
  assert.equal(create.status, 201);
  assert.equal(create.body.state, "READY_TO_SCHEDULE");

  const start = toIsoFrom(new Date(), 120);
  const end = toIsoFrom(new Date(), 150);

  const propose = await post(
    `/tickets/${create.body.id}/schedule/propose`,
    actorHeaders({
      actorId: "dispatcher-glz06-scheduler",
      actorRole: "dispatcher",
      toolName: "schedule.propose",
      requestId: nextRequestId("96000000-0000-4000-8000"),
      correlationId: `corr-glz06-propose-${create.body.id}`,
    }),
    {
      options: [{ start, end }],
    },
  );
  assert.equal(propose.status, 200);

  const confirm = await post(
    `/tickets/${create.body.id}/schedule/confirm`,
    actorHeaders({
      actorId: "dispatcher-glz06-scheduler",
      actorRole: "dispatcher",
      toolName: "schedule.confirm",
      requestId: nextRequestId("96000000-0000-4000-8000"),
      correlationId: `corr-glz06-confirm-${create.body.id}`,
    }),
    {
      start,
      end,
    },
  );
  assert.equal(confirm.status, 200);

  return {
    ticketId: create.body.id,
    start,
    end,
  };
}

test.before(async () => {
  spawnSync("docker", ["rm", "-f", postgresContainer], { encoding: "utf8" });
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

  psql(`
    INSERT INTO accounts (id, name)
    VALUES ('${accountId}', 'GLZ-06 Confirmation Hold Account');
  `);
  psql(`
    INSERT INTO sites (id, account_id, name, address1, city, region)
    VALUES ('${siteId}', '${accountId}', 'GLZ-06 Site', '6 Hold Rd', 'Phoenix', 'AZ');
  `);

  process.env.DISPATCH_DATABASE_URL = `postgres://dispatch:dispatch@127.0.0.1:${postgresPort}/dispatch`;
  app = await startDispatchApi({
    host: "127.0.0.1",
    port: dispatchApiPort,
  });
});

test.after(async () => {
  if (app) {
    await app.stop();
  }
  await closePool();
  spawnSync("docker", ["rm", "-f", postgresContainer], { encoding: "utf8" });
});

test("hold + release restores schedule state and records immutable audit/timeline events", async () => {
  const scheduled = await createScheduledTicket({
    summary: "glz06-hold-release-success",
    priority: "URGENT",
  });

  const beforeHoldTransitions = queryCount(
    `SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${scheduled.ticketId}';`,
  );
  const beforeHoldAudit = queryCount(
    `SELECT count(*) FROM audit_events WHERE ticket_id = '${scheduled.ticketId}';`,
  );
  const beforeMetrics = await get(
    "/metrics",
    actorHeaders({
      actorId: "dispatcher-glz06-metrics",
      actorRole: "dispatcher",
      toolName: "metrics.view",
    }),
  );
  assert.equal(beforeMetrics.status, 200);

  const holdWindow = {
    start: toIsoFrom(new Date(), 30),
    end: toIsoFrom(new Date(), 60),
  };
  const hold = await post(
    `/tickets/${scheduled.ticketId}/schedule/hold`,
    actorHeaders({
      actorId: "dispatcher-glz06-scheduler",
      actorRole: "dispatcher",
      toolName: "schedule.hold",
      requestId: nextRequestId("96000000-0000-4000-8000"),
      correlationId: `corr-glz06-hold-${scheduled.ticketId}`,
    }),
    {
      hold_reason: "CUSTOMER_PENDING",
      confirmation_window: holdWindow,
    },
  );
  assert.equal(hold.status, 201);
  assert.equal(hold.body.ticket.state, "PENDING_CUSTOMER_CONFIRMATION");
  assert.equal(hold.body.hold_id != null, true);
  assert.equal(hold.body.snapshot_id != null, true);

  const release = await post(
    `/tickets/${scheduled.ticketId}/schedule/release`,
    actorHeaders({
      actorId: "dispatcher-glz06-scheduler",
      actorRole: "dispatcher",
      toolName: "schedule.release",
      requestId: nextRequestId("96000000-0000-4000-8000"),
      correlationId: `corr-glz06-release-${scheduled.ticketId}`,
    }),
    {
      customer_confirmation_log: hold.body.hold_id,
    },
  );
  assert.equal(release.status, 200);
  assert.equal(release.body.ticket.state, "SCHEDULED");
  assert.equal(release.body.restored_state, "SCHEDULED");
  assert.equal(release.body.hold_id, hold.body.hold_id);
  assert.equal(release.body.snapshot_id, hold.body.snapshot_id);
  assert.equal(release.body.restored_window.start, scheduled.start);
  assert.equal(release.body.restored_window.end, scheduled.end);

  const afterHoldTransitions = queryCount(
    `SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${scheduled.ticketId}';`,
  );
  const afterHoldAudit = queryCount(
    `SELECT count(*) FROM audit_events WHERE ticket_id = '${scheduled.ticketId}';`,
  );

  assert.equal(afterHoldTransitions - beforeHoldTransitions, 2);
  assert.equal(afterHoldAudit - beforeHoldAudit, 2);
  assert.equal(
    queryCount(
      `SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${scheduled.ticketId}'
       AND from_state = 'SCHEDULED' AND to_state = 'PENDING_CUSTOMER_CONFIRMATION';`,
    ) -
      queryCount(
        `SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${scheduled.ticketId}'
       AND from_state = 'PENDING_CUSTOMER_CONFIRMATION' AND to_state = 'SCHEDULED';`,
      ),
    0,
  );
  const holdTransitionCount = queryCount(
    `SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${scheduled.ticketId}'
     AND from_state = 'SCHEDULED' AND to_state = 'PENDING_CUSTOMER_CONFIRMATION';`,
  );
  const releaseTransitionCount = queryCount(
    `SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${scheduled.ticketId}'
     AND from_state = 'PENDING_CUSTOMER_CONFIRMATION' AND to_state = 'SCHEDULED';`,
  );
  assert.equal(holdTransitionCount, 1);
  assert.equal(releaseTransitionCount, 1);

  const finalMetrics = await get(
    "/metrics",
    actorHeaders({
      actorId: "dispatcher-glz06-metrics",
      actorRole: "dispatcher",
      toolName: "metrics.view",
    }),
  );
  assert.equal(finalMetrics.status, 200);

  assert.equal(
    Number(
      getRequestCounter(finalMetrics.body, "POST", "/tickets/{ticketId}/schedule/hold", 201) ?? 0,
    ) -
      Number(
        getRequestCounter(beforeMetrics.body, "POST", "/tickets/{ticketId}/schedule/hold", 201) ??
          0,
      ),
    1,
  );
  assert.equal(
    Number(
      getRequestCounter(finalMetrics.body, "POST", "/tickets/{ticketId}/schedule/release", 200) ??
        0,
    ) -
      Number(
        getRequestCounter(
          beforeMetrics.body,
          "POST",
          "/tickets/{ticketId}/schedule/release",
          200,
        ) ?? 0,
      ),
    1,
  );
  assert.equal(
    Number(
      getTransitionCounter(finalMetrics.body, "SCHEDULED", "PENDING_CUSTOMER_CONFIRMATION") ?? 0,
    ) -
      Number(
        getTransitionCounter(beforeMetrics.body, "SCHEDULED", "PENDING_CUSTOMER_CONFIRMATION") ?? 0,
      ),
    1,
  );
  assert.equal(
    Number(
      getTransitionCounter(finalMetrics.body, "PENDING_CUSTOMER_CONFIRMATION", "SCHEDULED") ?? 0,
    ) -
      Number(
        getTransitionCounter(beforeMetrics.body, "PENDING_CUSTOMER_CONFIRMATION", "SCHEDULED") ?? 0,
      ),
    1,
  );
});

test("rollback returns a held ticket to the immutable snapshot and supports idempotent hold capture", async () => {
  const scheduled = await createScheduledTicket({
    summary: "glz06-rollback-path",
    priority: "ROUTINE",
  });
  const holdWindow = {
    start: toIsoFrom(new Date(), 30),
    end: toIsoFrom(new Date(), 90),
  };
  const holdRequestId = nextRequestId("96000000-0000-4000-8000");
  const hold = await post(
    `/tickets/${scheduled.ticketId}/schedule/hold`,
    actorHeaders({
      actorId: "dispatcher-glz06-scheduler",
      actorRole: "dispatcher",
      toolName: "schedule.hold",
      requestId: holdRequestId,
      correlationId: `corr-glz06-hold-rollback-${scheduled.ticketId}`,
    }),
    {
      hold_reason: "CUSTOMER_UNREACHABLE",
      confirmation_window: holdWindow,
    },
  );
  assert.equal(hold.status, 201);

  const holdReplay = await post(
    `/tickets/${scheduled.ticketId}/schedule/hold`,
    actorHeaders({
      actorId: "dispatcher-glz06-scheduler",
      actorRole: "dispatcher",
      toolName: "schedule.hold",
      requestId: holdRequestId,
      correlationId: `corr-glz06-hold-replay-${scheduled.ticketId}`,
    }),
    {
      hold_reason: "CUSTOMER_UNREACHABLE",
      confirmation_window: holdWindow,
    },
  );
  assert.equal(holdReplay.status, 201);
  assert.equal(holdReplay.body.hold_id, hold.body.hold_id);
  assert.equal(holdReplay.body.snapshot_id, hold.body.snapshot_id);

  const rollback = await post(
    `/tickets/${scheduled.ticketId}/schedule/rollback`,
    actorHeaders({
      actorId: "dispatcher-glz06-scheduler",
      actorRole: "dispatcher",
      toolName: "schedule.rollback",
      requestId: nextRequestId("96000000-0000-4000-8000"),
      correlationId: `corr-glz06-rollback-${scheduled.ticketId}`,
    }),
    {
      confirmation_id: hold.body.hold_id,
      reason: "customer_unable_to_reach",
    },
  );
  assert.equal(rollback.status, 200);
  assert.equal(rollback.body.ticket.state, "SCHEDULED");
  assert.equal(rollback.body.hold_id, hold.body.hold_id);
  assert.equal(rollback.body.restored_state, "SCHEDULED");
  assert.equal(rollback.body.restored_window.start, scheduled.start);
  assert.equal(rollback.body.restored_window.end, scheduled.end);

  assert.equal(
    queryCount(
      `SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${scheduled.ticketId}'
       AND from_state = 'PENDING_CUSTOMER_CONFIRMATION' AND to_state = 'SCHEDULED';`,
    ),
    1,
  );
  assert.equal(psql(`SELECT state FROM tickets WHERE id = '${scheduled.ticketId}';`), "SCHEDULED");
});

test("release rejects stale confirmation windows with explicit correlation and payload context", async () => {
  const scheduled = await createScheduledTicket({
    summary: "glz06-stale-release",
    priority: "ROUTINE",
  });

  const holdWindow = {
    start: toIsoFrom(new Date(), -120),
    end: toIsoFrom(new Date(), -60),
  };
  const hold = await post(
    `/tickets/${scheduled.ticketId}/schedule/hold`,
    actorHeaders({
      actorId: "dispatcher-glz06-scheduler",
      actorRole: "dispatcher",
      toolName: "schedule.hold",
      requestId: nextRequestId("96000000-0000-4000-8000"),
      correlationId: `corr-glz06-hold-stale-${scheduled.ticketId}`,
    }),
    {
      hold_reason: "CUSTOMER_CONFIRMATION_STALE",
      confirmation_window: holdWindow,
    },
  );
  assert.equal(hold.status, 201);

  const before = await get(
    "/metrics",
    actorHeaders({
      actorId: "dispatcher-glz06-metrics",
      actorRole: "dispatcher",
      toolName: "metrics.view",
    }),
  );
  assert.equal(before.status, 200);

  const staleRelease = await post(
    `/tickets/${scheduled.ticketId}/schedule/release`,
    actorHeaders({
      actorId: "dispatcher-glz06-scheduler",
      actorRole: "dispatcher",
      toolName: "schedule.release",
      requestId: nextRequestId("96000000-0000-4000-8000"),
      correlationId: `corr-glz06-stale-release-${scheduled.ticketId}`,
    }),
    {
      customer_confirmation_log: hold.body.hold_id,
    },
  );
  assert.equal(staleRelease.status, 409);
  assert.equal(staleRelease.body.error.code, "CUSTOMER_CONFIRMATION_STALE");
  assert.equal(staleRelease.body.error.hold_id, hold.body.hold_id);
  assert.equal(staleRelease.body.error.snapshot_id, hold.body.snapshot_id);
  assert.equal(
    staleRelease.body.error.correlation_id,
    `corr-glz06-stale-release-${scheduled.ticketId}`,
  );
  assert.equal(
    psql(`SELECT state FROM tickets WHERE id = '${scheduled.ticketId}';`),
    "PENDING_CUSTOMER_CONFIRMATION",
  );

  const after = await get(
    "/metrics",
    actorHeaders({
      actorId: "dispatcher-glz06-metrics",
      actorRole: "dispatcher",
      toolName: "metrics.view",
    }),
  );
  assert.equal(after.status, 200);
  assert.equal(
    Number(getErrorCounter(after.body, "CUSTOMER_CONFIRMATION_STALE") ?? 0) -
      Number(getErrorCounter(before.body, "CUSTOMER_CONFIRMATION_STALE") ?? 0),
    1,
  );
  assert.equal(
    Number(
      getRequestCounter(after.body, "POST", "/tickets/{ticketId}/schedule/release", 409) ?? 0,
    ) -
      Number(
        getRequestCounter(before.body, "POST", "/tickets/{ticketId}/schedule/release", 409) ?? 0,
      ),
    1,
  );
});

test("hold lifecycle commands are blocked outside pending-confirmation states", async () => {
  const triage = await createIntakeTicket({
    siteId,
    summary: "glz06-state-blocked",
    priority: "ROUTINE",
    identityConfidence: 10,
    classificationConfidence: 10,
  });
  assert.equal(triage.status, 201);
  assert.equal(psql(`SELECT state FROM tickets WHERE id = '${triage.body.id}';`), "TRIAGED");

  const holdBlocked = await post(
    `/tickets/${triage.body.id}/schedule/hold`,
    actorHeaders({
      actorId: "dispatcher-glz06-blocked",
      actorRole: "dispatcher",
      toolName: "schedule.hold",
      requestId: nextRequestId("96000000-0000-4000-8000"),
      correlationId: `corr-glz06-blocked-hold-${triage.body.id}`,
    }),
    {
      hold_reason: "CUSTOMER_PENDING",
      confirmation_window: {
        start: toIsoFrom(new Date(), 10),
        end: toIsoFrom(new Date(), 20),
      },
    },
  );
  assert.equal(holdBlocked.status, 409);
  assert.equal(holdBlocked.body.error.code, "SCHEDULE_HOLD_STATE_CONFLICT");
  assert.equal(holdBlocked.body.error.correlation_id, `corr-glz06-blocked-hold-${triage.body.id}`);

  const releaseBlocked = await post(
    `/tickets/${triage.body.id}/schedule/release`,
    actorHeaders({
      actorId: "dispatcher-glz06-blocked",
      actorRole: "dispatcher",
      toolName: "schedule.release",
      requestId: nextRequestId("96000000-0000-4000-8000"),
      correlationId: `corr-glz06-blocked-release-${triage.body.id}`,
    }),
    {
      customer_confirmation_log: "00000000-0000-4000-8000-000000000999",
    },
  );
  assert.equal(releaseBlocked.status, 409);
  assert.equal(releaseBlocked.body.error.code, "SCHEDULE_HOLD_STATE_CONFLICT");
  assert.equal(
    releaseBlocked.body.error.correlation_id,
    `corr-glz06-blocked-release-${triage.body.id}`,
  );

  const rollbackBlocked = await post(
    `/tickets/${triage.body.id}/schedule/rollback`,
    actorHeaders({
      actorId: "dispatcher-glz06-blocked",
      actorRole: "dispatcher",
      toolName: "schedule.rollback",
      requestId: nextRequestId("96000000-0000-4000-8000"),
      correlationId: `corr-glz06-blocked-rollback-${triage.body.id}`,
    }),
    {
      confirmation_id: "00000000-0000-4000-8000-000000000998",
      reason: "pre-hold-rollback",
    },
  );
  assert.equal(rollbackBlocked.status, 409);
  assert.equal(rollbackBlocked.body.error.code, "SCHEDULE_HOLD_STATE_CONFLICT");
  assert.equal(
    rollbackBlocked.body.error.correlation_id,
    `corr-glz06-blocked-rollback-${triage.body.id}`,
  );
});
