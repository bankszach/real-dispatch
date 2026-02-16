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

const postgresContainer = "rd-story04-queue-test";
const postgresPort = 55444;
const dispatchApiPort = 18094;
const baseUrl = `http://127.0.0.1:${dispatchApiPort}`;

const accountId = "00000000-0000-0000-0000-000000000091";
const siteReadyId = "00000000-0000-0000-0000-000000000092";
const siteCaliforniaId = "00000000-0000-0000-0000-000000000093";
const siteTexasId = "00000000-0000-0000-0000-000000000094";
const siteNewYorkId = "00000000-0000-0000-0000-000000000095";

const MIN_REGION_WEIGHT = 10;
const MAX_REGION_WEIGHT = 990;
const DEFAULT_REGION_WEIGHT = 500;
const PRIORITY_SORT_ORDER = Object.freeze({
  EMERGENCY: 0,
  URGENT: 1,
  ROUTINE: 2,
});

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

function nextRequestId(prefix = "91000000-0000-4000-8000") {
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

function regionWeightFromCode(region) {
  const normalized = typeof region === "string" ? region.trim().toUpperCase() : "";
  if (normalized === "") {
    return DEFAULT_REGION_WEIGHT;
  }

  let seed = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    seed = (seed * 31 + normalized.charCodeAt(i)) % 100000;
  }
  const span = MAX_REGION_WEIGHT - MIN_REGION_WEIGHT;
  return MIN_REGION_WEIGHT + (seed % (span + 1));
}

function queueComparator(left, right) {
  const leftBreach = left.sla_status === "breach" ? 0 : left.sla_status === "warning" ? 1 : 2;
  const rightBreach = right.sla_status === "breach" ? 0 : right.sla_status === "warning" ? 1 : 2;
  if (leftBreach !== rightBreach) {
    return leftBreach - rightBreach;
  }

  if (left.sla_timer_remaining_minutes !== right.sla_timer_remaining_minutes) {
    return left.sla_timer_remaining_minutes - right.sla_timer_remaining_minutes;
  }

  const leftPriority = PRIORITY_SORT_ORDER[left.priority] ?? 9;
  const rightPriority = PRIORITY_SORT_ORDER[right.priority] ?? 9;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  const leftRegionWeight = left.region_weight ?? DEFAULT_REGION_WEIGHT;
  const rightRegionWeight = right.region_weight ?? DEFAULT_REGION_WEIGHT;
  if (leftRegionWeight !== rightRegionWeight) {
    return leftRegionWeight - rightRegionWeight;
  }

  const leftUpdate = Date.parse(left.last_update_at ?? "");
  const rightUpdate = Date.parse(right.last_update_at ?? "");
  if (Number.isFinite(leftUpdate) && Number.isFinite(rightUpdate) && leftUpdate !== rightUpdate) {
    return rightUpdate - leftUpdate;
  }

  return left.ticket_id.localeCompare(right.ticket_id);
}

function getRequestCounter(snapshot, method, endpoint, status) {
  return snapshot.counters.requests_total.find(
    (entry) =>
      entry.method === method &&
      entry.endpoint === endpoint &&
      Number(entry.status) === Number(status),
  )?.count;
}

function getTransitionCounter(snapshot, fromState, toState) {
  return snapshot.counters.transitions_total.find(
    (entry) => entry.from_state === fromState && entry.to_state === toState,
  )?.count;
}

async function createIntakeTicket(params) {
  const {
    siteId,
    summary,
    priority,
    identityConfidence = 99,
    classificationConfidence = 99,
  } = params;
  const requestId = nextRequestId("92000000-0000-4000-8000");

  const response = await post(
    "/tickets/intake",
    actorHeaders({
      actorId: `dispatcher-glz04-${requestId}`,
      actorRole: "dispatcher",
      toolName: "ticket.blind_intake",
      correlationId: `corr-${requestId}`,
      requestId,
    }),
    {
      account_id: accountId,
      site_id: siteId,
      customer_name: `SGLZ04-${requestId}`,
      contact_phone: "555-0100",
      summary,
      incident_type: "DOOR_WONT_LATCH",
      description: `GLZ-04 queue case ${requestId}`,
      priority,
      identity_confidence: identityConfidence,
      classification_confidence: classificationConfidence,
      sop_handoff_acknowledged: true,
    },
  );

  return response;
}

async function createScheduledTicket(params) {
  const { siteId, priority, summary, start, end } = params;
  const create = await createIntakeTicket({
    siteId,
    priority,
    summary,
  });
  assert.equal(create.status, 201);

  const propose = await post(
    `/tickets/${create.body.id}/schedule/propose`,
    actorHeaders({
      actorId: "dispatcher-glz04-scheduler",
      actorRole: "dispatcher",
      toolName: "schedule.propose",
      correlationId: `corr-glz04-propose-${create.body.id}`,
      requestId: nextRequestId("92000000-0000-4000-8000"),
    }),
    {
      options: [{ start, end }],
    },
  );
  assert.equal(propose.status, 200);

  const confirm = await post(
    `/tickets/${create.body.id}/schedule/confirm`,
    actorHeaders({
      actorId: "dispatcher-glz04-scheduler",
      actorRole: "dispatcher",
      toolName: "schedule.confirm",
      correlationId: `corr-glz04-confirm-${create.body.id}`,
      requestId: nextRequestId("92000000-0000-4000-8000"),
    }),
    {
      start,
      end,
    },
  );
  assert.equal(confirm.status, 200);
  return {
    ticketId: create.body.id,
    state: confirm.body.state,
    siteId,
    priority,
  };
}

function queryCount(sql) {
  return Number(psql(sql));
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
    VALUES ('${accountId}', 'GLZ-04 Queue Account');
  `);
  psql(`
    INSERT INTO sites (id, account_id, name, address1, city, region)
    VALUES
      ('${siteReadyId}', '${accountId}', 'GLZ-04 Ready Site', '4 Ready Rd', 'San Francisco', 'CA'),
      ('${siteCaliforniaId}', '${accountId}', 'GLZ-04 CA Site', '4 CA Blvd', 'San Francisco', 'CA'),
      ('${siteTexasId}', '${accountId}', 'GLZ-04 TX Site', '4 TX Blvd', 'Houston', 'TX'),
      ('${siteNewYorkId}', '${accountId}', 'GLZ-04 NY Site', '4 NY Blvd', 'New York', 'NY');
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

test("dispatcher cockpit queue order is deterministic by SLA state, timer, priority, and tie-breakers", async () => {
  const baseTime = new Date();

  const breach = await createScheduledTicket({
    siteId: siteCaliforniaId,
    priority: "ROUTINE",
    summary: "queue-breach",
    start: toIsoFrom(baseTime, -(1440 + 60)),
    end: toIsoFrom(baseTime, -(1440 + 60) + 90),
  });

  const warningUrgentCaOld = await createScheduledTicket({
    siteId: siteCaliforniaId,
    priority: "URGENT",
    summary: "queue-warning-urgent-ca-old",
    start: toIsoFrom(baseTime, -(240 - 45)),
    end: toIsoFrom(baseTime, -(240 - 45) + 90),
  });

  const warningUrgentCaNew = await createScheduledTicket({
    siteId: siteCaliforniaId,
    priority: "URGENT",
    summary: "queue-warning-urgent-ca-new",
    start: toIsoFrom(baseTime, -(240 - 45)),
    end: toIsoFrom(baseTime, -(240 - 45) + 90),
  });

  const warningUrgentTx = await createScheduledTicket({
    siteId: siteTexasId,
    priority: "URGENT",
    summary: "queue-warning-urgent-tx",
    start: toIsoFrom(baseTime, -(240 - 45)),
    end: toIsoFrom(baseTime, -(240 - 45) + 90),
  });

  const warningRoutine = await createScheduledTicket({
    siteId: siteNewYorkId,
    priority: "ROUTINE",
    summary: "queue-warning-routine",
    start: toIsoFrom(baseTime, -(1440 - 45)),
    end: toIsoFrom(baseTime, -(1440 - 45) + 90),
  });

  const healthyEmergency = await createScheduledTicket({
    siteId: siteCaliforniaId,
    priority: "EMERGENCY",
    summary: "queue-healthy",
    start: toIsoFrom(baseTime, 200),
    end: toIsoFrom(baseTime, 260),
  });

  const cockpit = await get(
    "/ux/dispatcher/cockpit?state=SCHEDULED",
    actorHeaders({
      actorId: "dispatcher-glz04-observer",
      actorRole: "dispatcher",
      toolName: "dispatcher.cockpit",
      correlationId: "corr-glz04-cockpit",
    }),
  );

  assert.equal(cockpit.status, 200);

  const observedIds = new Set([
    breach.ticketId,
    warningUrgentCaOld.ticketId,
    warningUrgentCaNew.ticketId,
    warningUrgentTx.ticketId,
    warningRoutine.ticketId,
    healthyEmergency.ticketId,
  ]);

  const queueRows = cockpit.body.queue.filter((row) => observedIds.has(row.ticket_id));
  assert.equal(queueRows.length, 6);

  const sortedRows = [...queueRows].toSorted(queueComparator);
  assert.deepEqual(
    queueRows.map((row) => row.ticket_id),
    sortedRows.map((row) => row.ticket_id),
  );

  assert.equal(queueRows[0].sla_status, "breach");
  assert.equal(queueRows.at(-1).sla_status, "healthy");

  const warningUrgentRows = queueRows.filter((row) => row.sla_status === "warning");
  assert.equal(warningUrgentRows.length, 4);

  const routineWarningIndex = warningUrgentRows.findIndex(
    (row) => row.ticket_id === warningRoutine.ticketId,
  );
  const urgentRows = warningUrgentRows.filter((row) => row.priority === "URGENT");
  assert.equal(urgentRows.length, 3);
  assert.equal(
    warningUrgentRows.findIndex((row) => row.ticket_id === warningUrgentCaOld.ticketId) <
      routineWarningIndex,
    true,
  );
  assert.equal(
    warningUrgentRows.findIndex((row) => row.ticket_id === warningUrgentCaNew.ticketId) <
      routineWarningIndex,
    true,
  );
  assert.equal(
    warningUrgentRows.findIndex((row) => row.ticket_id === warningUrgentTx.ticketId) <
      routineWarningIndex,
    true,
  );

  const urgentSameRegionRows = warningUrgentRows.filter((row) =>
    [warningUrgentCaOld.ticketId, warningUrgentCaNew.ticketId].includes(row.ticket_id),
  );
  assert.equal(urgentSameRegionRows.length, 2);
  const urgentCaNewIndex = queueRows.findIndex(
    (row) => row.ticket_id === warningUrgentCaNew.ticketId,
  );
  const urgentCaOldIndex = queueRows.findIndex(
    (row) => row.ticket_id === warningUrgentCaOld.ticketId,
  );
  assert.ok(urgentCaNewIndex < urgentCaOldIndex);

  const caRow = queueRows.find((row) => row.ticket_id === warningUrgentCaOld.ticketId);
  const txRow = queueRows.find((row) => row.ticket_id === warningUrgentTx.ticketId);
  assert.ok(caRow != null && txRow != null);
  const caWeight = regionWeightFromCode("CA");
  const txWeight = regionWeightFromCode("TX");
  assert.equal(caRow.region_weight, caWeight);
  assert.equal(txRow.region_weight, txWeight);

  const sameWarningUrgentRows = queueRows.filter((row) =>
    [warningUrgentCaOld.ticketId, warningUrgentCaNew.ticketId, warningUrgentTx.ticketId].includes(
      row.ticket_id,
    ),
  );
  if (caWeight === txWeight) {
    assert.ok(sameWarningUrgentRows[0].last_update_at >= sameWarningUrgentRows[1].last_update_at);
  }
});

test("assignment dispatch is blocked outside matrix with explicit policy error context", async () => {
  const triageTicket = await createIntakeTicket({
    siteId: siteReadyId,
    summary: "triage-state-cannot-dispatch",
    priority: "ROUTINE",
    identityConfidence: 20,
    classificationConfidence: 20,
  });
  assert.equal(triageTicket.status, 201);
  assert.equal(triageTicket.body.state, "TRIAGED");

  const transitionsBefore = queryCount(
    `SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${triageTicket.body.id}';`,
  );

  const dispatchAttempt = await post(
    `/tickets/${triageTicket.body.id}/assignment/dispatch`,
    actorHeaders({
      actorId: "dispatcher-glz04-blocked",
      actorRole: "dispatcher",
      toolName: "assignment.dispatch",
      correlationId: "corr-glz04-blocked",
      requestId: nextRequestId("92000000-0000-4000-8000"),
    }),
    {
      tech_id: "00000000-0000-0000-0000-000000000023",
    },
  );

  assert.equal(dispatchAttempt.status, 409);
  assert.equal(dispatchAttempt.body.error.code, "INVALID_STATE_TRANSITION");
  assert.equal(dispatchAttempt.body.error.from_state, "TRIAGED");
  assert.equal(dispatchAttempt.body.error.to_state, "DISPATCHED");
  assert.equal(dispatchAttempt.body.error.correlation_id, "corr-glz04-blocked");

  assert.equal(psql(`SELECT state FROM tickets WHERE id = '${triageTicket.body.id}';`), "TRIAGED");
  assert.equal(
    queryCount(
      `SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${triageTicket.body.id}';`,
    ),
    transitionsBefore,
  );
});

test("queue ordering and state transition paths emit request/error metrics", async () => {
  const baselineMetrics = await get(
    "/metrics",
    actorHeaders({
      actorId: "dispatcher-glz04-metrics",
      actorRole: "dispatcher",
      toolName: "ticket.create",
      requestId: nextRequestId("92000000-0000-4000-8000"),
    }),
  );
  assert.equal(baselineMetrics.status, 200);

  const queueTicket = await createIntakeTicket({
    siteId: siteCaliforniaId,
    summary: "metrics-propose-confirm",
    priority: "URGENT",
  });
  assert.equal(queueTicket.status, 201);
  assert.equal(queueTicket.body.state, "READY_TO_SCHEDULE");

  const start = toIsoFrom(new Date(), 120);
  const end = toIsoFrom(new Date(), 150);
  const propose = await post(
    `/tickets/${queueTicket.body.id}/schedule/propose`,
    actorHeaders({
      actorId: "dispatcher-glz04-metrics",
      actorRole: "dispatcher",
      toolName: "schedule.propose",
      correlationId: "corr-glz04-metrics-propose",
      requestId: nextRequestId("92000000-0000-4000-8000"),
    }),
    { options: [{ start, end }] },
  );
  assert.equal(propose.status, 200);

  const confirm = await post(
    `/tickets/${queueTicket.body.id}/schedule/confirm`,
    actorHeaders({
      actorId: "dispatcher-glz04-metrics",
      actorRole: "dispatcher",
      toolName: "schedule.confirm",
      correlationId: "corr-glz04-metrics-confirm",
      requestId: nextRequestId("92000000-0000-4000-8000"),
    }),
    { start, end },
  );
  assert.equal(confirm.status, 200);

  const dispatchFailure = await post(
    `/tickets/${queueTicket.body.id}/assignment/dispatch`,
    actorHeaders({
      actorId: "dispatcher-glz04-metrics",
      actorRole: "dispatcher",
      toolName: "assignment.dispatch",
      correlationId: "corr-glz04-metrics-dispatch-fail",
      requestId: nextRequestId("92000000-0000-4000-8000"),
    }),
    { tech_id: "00000000-0000-0000-0000-000000000001" },
  );
  assert.equal(dispatchFailure.status, 409);
  assert.equal(dispatchFailure.body.error.code, "ASSIGNMENT_NOT_FOUND");

  const finalMetrics = await get(
    "/metrics",
    actorHeaders({
      actorId: "dispatcher-glz04-metrics",
      actorRole: "dispatcher",
      toolName: "ticket.create",
      requestId: nextRequestId("92000000-0000-4000-8000"),
    }),
  );
  assert.equal(finalMetrics.status, 200);

  assert.equal(
    Number(
      getRequestCounter(finalMetrics.body, "POST", "/tickets/{ticketId}/schedule/propose", 200) ??
        0,
    ) -
      Number(
        getRequestCounter(
          baselineMetrics.body,
          "POST",
          "/tickets/{ticketId}/schedule/propose",
          200,
        ) ?? 0,
      ),
    1,
  );
  assert.equal(
    Number(
      getRequestCounter(finalMetrics.body, "POST", "/tickets/{ticketId}/schedule/confirm", 200) ??
        0,
    ) -
      Number(
        getRequestCounter(
          baselineMetrics.body,
          "POST",
          "/tickets/{ticketId}/schedule/confirm",
          200,
        ) ?? 0,
      ),
    1,
  );
  assert.equal(
    Number(getTransitionCounter(finalMetrics.body, "READY_TO_SCHEDULE", "SCHEDULE_PROPOSED") ?? 0) -
      Number(
        getTransitionCounter(baselineMetrics.body, "READY_TO_SCHEDULE", "SCHEDULE_PROPOSED") ?? 0,
      ),
    1,
  );
  assert.equal(
    Number(getTransitionCounter(finalMetrics.body, "SCHEDULE_PROPOSED", "SCHEDULED") ?? 0) -
      Number(getTransitionCounter(baselineMetrics.body, "SCHEDULE_PROPOSED", "SCHEDULED") ?? 0),
    1,
  );
  assert.equal(
    Number(
      finalMetrics.body.counters.errors_total.find((entry) => entry.code === "ASSIGNMENT_NOT_FOUND")
        ?.count ?? 0,
    ) -
      Number(
        baselineMetrics.body.counters.errors_total.find(
          (entry) => entry.code === "ASSIGNMENT_NOT_FOUND",
        )?.count ?? 0,
      ),
    1,
  );
});
