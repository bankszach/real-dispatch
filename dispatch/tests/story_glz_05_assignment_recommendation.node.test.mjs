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

const postgresContainer = "rd-story05-assignment-recommendation-test";
const postgresPort = 55445;
const dispatchApiPort = 18105;
const baseUrl = `http://127.0.0.1:${dispatchApiPort}`;

const accountId = "00000000-0000-0000-0000-000000000151";
const siteCaliforniaId = "00000000-0000-0000-0000-000000000152";
const siteTexasId = "00000000-0000-0000-0000-000000000153";

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

function nextRequestId(prefix = "95000000-0000-4000-8000") {
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

function queryCount(sql) {
  return Number(psql(sql));
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
    incidentType = "DOOR_WONT_LATCH",
    identityConfidence = 99,
    classificationConfidence = 99,
    actorSuffix = "dispatcher-glz05",
  } = params;
  const requestId = nextRequestId("95000000-0000-4000-8000");
  const response = await post(
    "/tickets/intake",
    actorHeaders({
      actorId: actorSuffix,
      actorRole: "dispatcher",
      toolName: "ticket.blind_intake",
      correlationId: `corr-glz05-intake-${requestId}`,
      requestId,
    }),
    {
      account_id: accountId,
      site_id: siteId,
      customer_name: `SGLZ05-${requestId}`,
      contact_phone: "555-0100",
      summary,
      incident_type: incidentType,
      description: `GLZ-05 contract case ${requestId}`,
      priority,
      identity_confidence: identityConfidence,
      classification_confidence: classificationConfidence,
      sop_handoff_acknowledged: true,
    },
  );
  return response;
}

async function createScheduledTicket(params) {
  const { siteId, priority = "ROUTINE", summary, incidentType = "DOOR_WONT_LATCH" } = params;
  const baseNow = new Date();
  const start = toIsoFrom(baseNow, 120);
  const end = toIsoFrom(baseNow, 150);

  const create = await createIntakeTicket({
    siteId,
    summary,
    priority,
    incidentType,
  });
  assert.equal(create.status, 201);
  assert.equal(create.body.state, "READY_TO_SCHEDULE");

  const propose = await post(
    `/tickets/${create.body.id}/schedule/propose`,
    actorHeaders({
      actorId: "dispatcher-glz05-scheduler",
      actorRole: "dispatcher",
      toolName: "schedule.propose",
      requestId: nextRequestId("95000000-0000-4000-8000"),
      correlationId: `corr-glz05-propose-${create.body.id}`,
    }),
    { options: [{ start, end }] },
  );
  assert.equal(propose.status, 200);

  const confirm = await post(
    `/tickets/${create.body.id}/schedule/confirm`,
    actorHeaders({
      actorId: "dispatcher-glz05-scheduler",
      actorRole: "dispatcher",
      toolName: "schedule.confirm",
      requestId: nextRequestId("95000000-0000-4000-8000"),
      correlationId: `corr-glz05-confirm-${create.body.id}`,
    }),
    { start, end },
  );
  assert.equal(confirm.status, 200);

  return {
    ticketId: create.body.id,
    start,
    end,
  };
}

function assertRecommendationPayload(recommendations) {
  assert.ok(Array.isArray(recommendations));
  assert.ok(recommendations.length >= 2);
  for (const recommendation of recommendations) {
    assert.equal(typeof recommendation.tech_id, "string");
    assert.equal(typeof recommendation.tech_name, "string");
    assert.equal(typeof recommendation.score, "number");
    assert.ok(recommendation.matches != null);
    assert.equal(typeof recommendation.matches.capability, "boolean");
    assert.equal(typeof recommendation.matches.zone, "boolean");
    assert.equal(typeof recommendation.matches.active_load, "number");
    assert.equal(typeof recommendation.matches.distance_bucket, "number");
  }
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
    VALUES ('${accountId}', 'GLZ-05 Assignment Contract Account');
  `);
  psql(`
    INSERT INTO sites (id, account_id, name, address1, city, region)
    VALUES
      ('${siteCaliforniaId}', '${accountId}', 'GLZ-05 CA Site', '5 CA Blvd', 'San Francisco', 'CA'),
      ('${siteTexasId}', '${accountId}', 'GLZ-05 TX Site', '5 TX Blvd', 'Austin', 'TX');
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

test("assignment recommendation ordering is deterministic and idempotent", async () => {
  const scheduled = await createScheduledTicket({
    siteId: siteCaliforniaId,
    priority: "URGENT",
    summary: "glz05-recommend-deterministic-order",
  });

  const recommendationPayload = {
    service_type: "DOOR_WONT_LATCH",
    recommendation_limit: 10,
    preferred_window: {
      start: toIsoFrom(new Date(), 120),
      end: toIsoFrom(new Date(), 180),
    },
  };

  const recommendationId = nextRequestId("95000000-0000-4000-8000");
  const firstRecommendation = await post(
    `/tickets/${scheduled.ticketId}/assignment/recommend`,
    actorHeaders({
      actorId: "dispatcher-glz05-recommender",
      actorRole: "dispatcher",
      toolName: "assignment.recommend",
      requestId: recommendationId,
      correlationId: `corr-glz05-recommend-${recommendationId}`,
    }),
    recommendationPayload,
  );
  assert.equal(firstRecommendation.status, 201);
  assert.equal(firstRecommendation.body.snapshot_id != null, true);
  assert.equal(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      firstRecommendation.body.snapshot_id,
    ),
    true,
  );

  const replayRecommendation = await post(
    `/tickets/${scheduled.ticketId}/assignment/recommend`,
    actorHeaders({
      actorId: "dispatcher-glz05-recommender",
      actorRole: "dispatcher",
      toolName: "assignment.recommend",
      requestId: recommendationId,
      correlationId: `corr-glz05-recommend-replay-${recommendationId}`,
    }),
    recommendationPayload,
  );
  assert.equal(replayRecommendation.status, 201);
  assert.equal(replayRecommendation.body.snapshot_id, firstRecommendation.body.snapshot_id);
  assert.deepEqual(
    replayRecommendation.body.recommendations,
    firstRecommendation.body.recommendations,
  );

  const secondRecommendation = await post(
    `/tickets/${scheduled.ticketId}/assignment/recommend`,
    actorHeaders({
      actorId: "dispatcher-glz05-recommender",
      actorRole: "dispatcher",
      toolName: "assignment.recommend",
      requestId: nextRequestId("95000000-0000-4000-8000"),
      correlationId: `corr-glz05-recommend-second-${scheduled.ticketId}`,
    }),
    recommendationPayload,
  );
  assert.equal(secondRecommendation.status, 201);
  assert.deepEqual(
    secondRecommendation.body.recommendations,
    firstRecommendation.body.recommendations,
  );

  assertRecommendationPayload(firstRecommendation.body.recommendations);
  assert.ok(firstRecommendation.body.recommendations[0].matches.capability);

  for (let i = 0; i < firstRecommendation.body.recommendations.length - 1; i += 1) {
    assert.ok(
      firstRecommendation.body.recommendations[i].score >=
        firstRecommendation.body.recommendations[i + 1].score,
    );
  }

  const transitions = queryCount(
    `SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${scheduled.ticketId}';`,
  );
  assert.ok(transitions > 0);
});

test("assignment recommendation snapshot enforces dispatch lineage and policy checks", async () => {
  const scheduled = await createScheduledTicket({
    siteId: siteCaliforniaId,
    priority: "ROUTINE",
    summary: "glz05-recommend-snapshot-policy",
  });

  const recommendation = await post(
    `/tickets/${scheduled.ticketId}/assignment/recommend`,
    actorHeaders({
      actorId: "dispatcher-glz05-policy",
      actorRole: "dispatcher",
      toolName: "assignment.recommend",
      requestId: nextRequestId("95000000-0000-4000-8000"),
      correlationId: `corr-glz05-policy-rec-${scheduled.ticketId}`,
    }),
    {
      service_type: "DOOR_WONT_LATCH",
      recommendation_limit: 5,
    },
  );
  assert.equal(recommendation.status, 201);
  assertRecommendationPayload(recommendation.body.recommendations);

  const mismatchCandidate = recommendation.body.recommendations.find(
    (entry) => entry.tech_id !== recommendation.body.recommendations[0].tech_id,
  );
  assert.ok(mismatchCandidate != null);

  const mismatchDispatch = await post(
    `/tickets/${scheduled.ticketId}/assignment/dispatch`,
    actorHeaders({
      actorId: "dispatcher-glz05-policy",
      actorRole: "dispatcher",
      toolName: "assignment.dispatch",
      requestId: nextRequestId("95000000-0000-4000-8000"),
      correlationId: `corr-glz05-mismatch-${scheduled.ticketId}`,
    }),
    {
      tech_id: mismatchCandidate.tech_id,
      recommendation_snapshot_id: recommendation.body.snapshot_id,
    },
  );

  assert.equal(mismatchDispatch.status, 409);
  assert.equal(mismatchDispatch.body.error.code, "ASSIGNMENT_RECOMMENDATION_MISMATCH");
  assert.equal(
    mismatchDispatch.body.error.recommendation_snapshot_id,
    recommendation.body.snapshot_id,
  );
  assert.equal(
    mismatchDispatch.body.error.correlation_id,
    `corr-glz05-mismatch-${scheduled.ticketId}`,
  );

  const capabilityMismatch = await post(
    `/tickets/${scheduled.ticketId}/assignment/dispatch`,
    actorHeaders({
      actorId: "dispatcher-glz05-policy",
      actorRole: "dispatcher",
      toolName: "assignment.dispatch",
      requestId: nextRequestId("95000000-0000-4000-8000"),
      correlationId: `corr-glz05-capability-${scheduled.ticketId}`,
    }),
    {
      tech_id: "00000000-0000-0000-0000-000000000143",
    },
  );
  assert.equal(capabilityMismatch.status, 409);
  assert.equal(capabilityMismatch.body.error.code, "ASSIGNMENT_CAPABILITY_MISMATCH");
  assert.equal(
    capabilityMismatch.body.error.correlation_id,
    `corr-glz05-capability-${scheduled.ticketId}`,
  );

  const txTicket = await createScheduledTicket({
    siteId: siteTexasId,
    summary: "glz05-zone-mismatch",
    priority: "URGENT",
  });
  const zoneMismatchDispatch = await post(
    `/tickets/${txTicket.ticketId}/assignment/dispatch`,
    actorHeaders({
      actorId: "dispatcher-glz05-policy",
      actorRole: "dispatcher",
      toolName: "assignment.dispatch",
      requestId: nextRequestId("95000000-0000-4000-8000"),
      correlationId: `corr-glz05-zone-${txTicket.ticketId}`,
    }),
    {
      tech_id: "00000000-0000-0000-0000-000000000083",
    },
  );
  assert.equal(zoneMismatchDispatch.status, 409);
  assert.equal(zoneMismatchDispatch.body.error.code, "ASSIGNMENT_ZONE_MISMATCH");
  assert.equal(
    zoneMismatchDispatch.body.error.correlation_id,
    `corr-glz05-zone-${txTicket.ticketId}`,
  );
});

test("assignment dispatch is gated by role policy and records recommendation path metrics", async () => {
  const scheduled = await createScheduledTicket({
    siteId: siteCaliforniaId,
    summary: "glz05-dispatch-role-success",
  });

  const recommendation = await post(
    `/tickets/${scheduled.ticketId}/assignment/recommend`,
    actorHeaders({
      actorId: "dispatcher-glz05-assign",
      actorRole: "dispatcher",
      toolName: "assignment.recommend",
      requestId: nextRequestId("95000000-0000-4000-8000"),
      correlationId: `corr-glz05-assign-rec-${scheduled.ticketId}`,
    }),
    {
      service_type: "DOOR_WONT_LATCH",
      recommendation_limit: 5,
    },
  );
  assert.equal(recommendation.status, 201);

  const policyBlockedDispatch = await post(
    `/tickets/${scheduled.ticketId}/assignment/dispatch`,
    actorHeaders({
      actorId: "customer-glz05-assign",
      actorRole: "customer",
      toolName: "assignment.dispatch",
      requestId: nextRequestId("95000000-0000-4000-8000"),
      correlationId: `corr-glz05-policy-block-${scheduled.ticketId}`,
    }),
    {
      tech_id: recommendation.body.recommendations[0].tech_id,
      recommendation_snapshot_id: recommendation.body.snapshot_id,
    },
  );
  assert.equal(policyBlockedDispatch.status, 403);
  assert.equal(policyBlockedDispatch.body.error.code, "FORBIDDEN");
  assert.equal(psql(`SELECT state FROM tickets WHERE id = '${scheduled.ticketId}';`), "SCHEDULED");

  const baseline = await get(
    "/metrics",
    actorHeaders({
      actorId: "dispatcher-glz05-assign-metrics",
      actorRole: "dispatcher",
      toolName: "metrics.view",
    }),
  );
  assert.equal(baseline.status, 200);

  const beforeTransitionCount = queryCount(
    `SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${scheduled.ticketId}'
     AND from_state = 'SCHEDULED' AND to_state = 'DISPATCHED';`,
  );
  const baselineAssignedWithSnapshot = Number(
    baseline.body.counters?.dispatch_assignments_with_snapshot_total ?? 0,
  );

  const dispatch = await post(
    `/tickets/${scheduled.ticketId}/assignment/dispatch`,
    actorHeaders({
      actorId: "dispatcher-glz05-assign",
      actorRole: "dispatcher",
      toolName: "assignment.dispatch",
      requestId: nextRequestId("95000000-0000-4000-8000"),
      correlationId: `corr-glz05-assign-${scheduled.ticketId}`,
    }),
    {
      tech_id: recommendation.body.recommendations[0].tech_id,
      recommendation_snapshot_id: recommendation.body.snapshot_id,
    },
  );
  assert.equal(dispatch.status, 200);
  assert.equal(dispatch.body.state, "DISPATCHED");
  assert.equal(dispatch.body.assigned_tech_id, recommendation.body.recommendations[0].tech_id);

  const after = await get(
    "/metrics",
    actorHeaders({
      actorId: "dispatcher-glz05-assign-metrics",
      actorRole: "dispatcher",
      toolName: "metrics.view",
    }),
  );
  assert.equal(after.status, 200);

  const afterTransitionCount = queryCount(
    `SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${scheduled.ticketId}'
     AND from_state = 'SCHEDULED' AND to_state = 'DISPATCHED';`,
  );
  const assignedWithSnapshot = Number(
    after.body.counters?.dispatch_assignments_with_snapshot_total ?? 0,
  );
  const assignedWithoutSnapshot = Number(
    after.body.counters?.dispatch_assignments_without_snapshot_total ?? 0,
  );
  const baselineAssignedWithoutSnapshot = Number(
    baseline.body.dispatch_assignments_without_snapshot_total ?? 0,
  );

  assert.equal(afterTransitionCount - beforeTransitionCount, 1);
  assert.equal(
    assignedWithSnapshot +
      assignedWithoutSnapshot -
      (baselineAssignedWithSnapshot + baselineAssignedWithoutSnapshot),
    1,
  );
  assert.equal(
    Number(getTransitionCounter(after.body, "SCHEDULED", "DISPATCHED") ?? 0) -
      Number(getTransitionCounter(baseline.body, "SCHEDULED", "DISPATCHED") ?? 0),
    1,
  );
  assert.equal(
    Number(
      getRequestCounter(after.body, "POST", "/tickets/{ticketId}/assignment/dispatch", 200) ?? 0,
    ) -
      Number(
        getRequestCounter(baseline.body, "POST", "/tickets/{ticketId}/assignment/dispatch", 200) ??
          0,
      ),
    1,
  );
});
