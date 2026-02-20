import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { closePool } from "../api/src/db.mjs";
import { startDispatchApi } from "../api/src/server.mjs";
import { buildTechnicianSeedSql } from "./helpers/technicians.mjs";

const repoRoot = process.cwd();
const migrationSql = fs.readFileSync(
  path.resolve(repoRoot, "dispatch/db/migrations/001_init.sql"),
  "utf8",
);

const postgresContainer = "rd-technician-directory";
const postgresPort = 55455;
const dispatchApiPort = 18112;
const baseUrl = `http://127.0.0.1:${dispatchApiPort}`;

const accountId = "00000000-0000-0000-0000-000000000901";
const siteId = "00000000-0000-0000-0000-000000000902";
const techActiveOneId = "00000000-0000-0000-0000-000000000903";
const techActiveTwoId = "00000000-0000-0000-0000-000000000904";
const techInactiveId = "00000000-0000-0000-0000-000000000905";
const techNoSkillId = "00000000-0000-0000-0000-000000000906";
const techOutOfRegionId = "00000000-0000-0000-0000-000000000907";

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

function nextRequestId(prefix = "96000000-0000-4000-8000") {
  requestCounter += 1;
  return `${prefix}-${String(requestCounter).padStart(12, "0")}`;
}

function toIsoFrom(baseAt, offsetMinutes) {
  return new Date(baseAt.getTime() + offsetMinutes * 60_000).toISOString();
}

function queryCount(sql) {
  return Number(psql(sql));
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

async function createTriagedTicket(params = {}) {
  const {
    summary = "Technician directory triage case",
    incidentType = "DOOR_WONT_LATCH",
    priority = "ROUTINE",
  } = params;

  const createRequestId = nextRequestId("96000000-0000-4000-8000");
  const create = await post(
    "/tickets",
    actorHeaders({
      actorId: "dispatcher-directory-create",
      actorRole: "dispatcher",
      toolName: "ticket.create",
      correlationId: `corr-directory-create-${createRequestId}`,
      requestId: createRequestId,
    }),
    {
      account_id: accountId,
      site_id: siteId,
      summary,
      description: "Directory-backed assignment coverage case",
    },
  );
  assert.equal(create.status, 201);
  assert.equal(create.body.state, "NEW");

  const triageRequestId = nextRequestId("96000000-0000-4000-8000");
  const triage = await post(
    `/tickets/${create.body.id}/triage`,
    actorHeaders({
      actorId: "dispatcher-directory-triage",
      actorRole: "dispatcher",
      toolName: "ticket.triage",
      correlationId: `corr-directory-triage-${triageRequestId}`,
      requestId: triageRequestId,
    }),
    {
      priority,
      incident_type: incidentType,
      nte_cents: 15000,
    },
  );
  assert.equal(triage.status, 200);
  assert.equal(triage.body.state, "TRIAGED");
  return triage.body;
}

async function createScheduledTicket() {
  const ticket = await createTriagedTicket({
    summary: "Technician directory scheduled case",
    incidentType: "DOOR_WONT_LATCH",
    priority: "URGENT",
  });
  const now = new Date();
  const start = toIsoFrom(now, 30);
  const end = toIsoFrom(now, 60);
  const proposalRequestId = nextRequestId("96000000-0000-4000-8000");
  const propose = await post(
    `/tickets/${ticket.id}/schedule/propose`,
    actorHeaders({
      actorId: "dispatcher-directory-scheduler",
      actorRole: "dispatcher",
      toolName: "schedule.propose",
      correlationId: `corr-directory-propose-${proposalRequestId}`,
      requestId: proposalRequestId,
    }),
    {
      options: [{ start, end }],
    },
  );
  assert.equal(propose.status, 200);

  const confirmRequestId = nextRequestId("96000000-0000-4000-8000");
  const confirm = await post(
    `/tickets/${ticket.id}/schedule/confirm`,
    actorHeaders({
      actorId: "dispatcher-directory-scheduler",
      actorRole: "dispatcher",
      toolName: "schedule.confirm",
      correlationId: `corr-directory-confirm-${confirmRequestId}`,
      requestId: confirmRequestId,
    }),
    { start, end },
  );
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.state, "SCHEDULED");
  return confirm.body;
}

test.before(async () => {
  spawnSync("docker", ["rm", "-f", postgresContainer], { encoding: "utf8" });
  run("docker", [
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
    VALUES ('${accountId}', 'Tech Directory Validation');
  `);
  psql(`
    INSERT INTO sites (id, account_id, name, address1, city, region)
    VALUES (
      '${siteId}',
      '${accountId}',
      'Dispatch Ops Facility',
      '100 Service Way',
      'Springfield',
      'CA'
    );
  `);
  psql(
    buildTechnicianSeedSql([
      {
        id: techActiveOneId,
        name: "Tech Directory Active One",
        skills: ["DOOR_WONT_LATCH", "DEFAULT"],
        regions: ["CA"],
        active: true,
      },
      {
        id: techActiveTwoId,
        name: "Tech Directory Active Two",
        skills: ["DOOR_WONT_LATCH", "DEFAULT"],
        regions: ["CA"],
        active: true,
      },
      {
        id: techInactiveId,
        name: "Tech Directory Inactive",
        skills: ["DOOR_WONT_LATCH", "DEFAULT"],
        regions: ["CA"],
        active: false,
      },
      {
        id: techNoSkillId,
        name: "Tech Directory No Skill",
        skills: ["LOCK_REPAIR"],
        regions: ["CA"],
        active: true,
      },
      {
        id: techOutOfRegionId,
        name: "Tech Directory Out of Region",
        skills: ["DOOR_WONT_LATCH", "DEFAULT"],
        regions: ["TX"],
        active: true,
      },
    ]),
  );

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

test("assignment recommendation ordering is deterministic from DB-backed technician directory", async () => {
  const scheduled = await createScheduledTicket();
  const requestId = nextRequestId("96000000-0000-4000-8000");
  const baseNow = new Date();
  const recommendPayload = {
    service_type: "DOOR_WONT_LATCH",
    recommendation_limit: 10,
    preferred_window: {
      start: toIsoFrom(baseNow, 15),
      end: toIsoFrom(baseNow, 45),
    },
  };
  const firstRecommendation = await post(
    `/tickets/${scheduled.id}/assignment/recommend`,
    actorHeaders({
      actorId: "dispatcher-directory",
      actorRole: "dispatcher",
      toolName: "assignment.recommend",
      correlationId: `corr-directory-rec-${scheduled.id}`,
      requestId,
    }),
    recommendPayload,
  );
  assert.equal(firstRecommendation.status, 201);
  const firstIds = firstRecommendation.body.recommendations.map((entry) => entry.tech_id);
  assert.deepEqual(firstIds, [...firstIds].toSorted());

  const replayRecommendation = await post(
    `/tickets/${scheduled.id}/assignment/recommend`,
    actorHeaders({
      actorId: "dispatcher-directory",
      actorRole: "dispatcher",
      toolName: "assignment.recommend",
      correlationId: `corr-directory-rec-replay-${scheduled.id}`,
      requestId: nextRequestId("96000000-0000-4000-8000"),
    }),
    recommendPayload,
  );
  assert.equal(replayRecommendation.status, 201);
  assert.deepEqual(
    replayRecommendation.body.recommendations,
    firstRecommendation.body.recommendations,
  );

  for (let i = 0; i < firstRecommendation.body.recommendations.length - 1; i += 1) {
    assert.ok(
      firstRecommendation.body.recommendations[i].score >=
        firstRecommendation.body.recommendations[i + 1].score,
    );
  }
});

test("inactive technician cannot be dispatched", async () => {
  const triaged = await createTriagedTicket({ summary: "Directory inactive technician case" });
  const dispatchResponse = await post(
    `/tickets/${triaged.id}/assignment/dispatch`,
    actorHeaders({
      actorId: "dispatcher-directory",
      actorRole: "dispatcher",
      toolName: "assignment.dispatch",
      correlationId: `corr-directory-inactive-${triaged.id}`,
      requestId: nextRequestId("96000000-0000-4000-8000"),
    }),
    {
      tech_id: techInactiveId,
      dispatch_mode: "STANDARD",
    },
  );
  assert.equal(dispatchResponse.status, 409);
  assert.equal(dispatchResponse.body.error.code, "TECH_UNAVAILABLE");
  assert.equal(psql(`SELECT state FROM tickets WHERE id = '${triaged.id}';`), "TRIAGED");
});

test("technician lacking service skill cannot be dispatched", async () => {
  const triaged = await createTriagedTicket({ summary: "Directory no-skill dispatch case" });
  const dispatchResponse = await post(
    `/tickets/${triaged.id}/assignment/dispatch`,
    actorHeaders({
      actorId: "dispatcher-directory",
      actorRole: "dispatcher",
      toolName: "assignment.dispatch",
      correlationId: `corr-directory-noskill-${triaged.id}`,
      requestId: nextRequestId("96000000-0000-4000-8000"),
    }),
    {
      tech_id: techNoSkillId,
      dispatch_mode: "STANDARD",
    },
  );
  assert.equal(dispatchResponse.status, 409);
  assert.equal(dispatchResponse.body.error.code, "ASSIGNMENT_CAPABILITY_MISMATCH");
  assert.equal(psql(`SELECT state FROM tickets WHERE id = '${triaged.id}';`), "TRIAGED");
});

test("technician outside service region cannot be dispatched", async () => {
  const triaged = await createTriagedTicket({ summary: "Directory region dispatch case" });
  const dispatchResponse = await post(
    `/tickets/${triaged.id}/assignment/dispatch`,
    actorHeaders({
      actorId: "dispatcher-directory",
      actorRole: "dispatcher",
      toolName: "assignment.dispatch",
      correlationId: `corr-directory-region-${triaged.id}`,
      requestId: nextRequestId("96000000-0000-4000-8000"),
    }),
    {
      tech_id: techOutOfRegionId,
      dispatch_mode: "STANDARD",
    },
  );
  assert.equal(dispatchResponse.status, 409);
  assert.equal(dispatchResponse.body.error.code, "ASSIGNMENT_ZONE_MISMATCH");
  assert.equal(psql(`SELECT state FROM tickets WHERE id = '${triaged.id}';`), "TRIAGED");
});

test("emergency bypass dispatch still works with DB-backed technicians", async () => {
  const triaged = await createTriagedTicket({ summary: "Directory emergency bypass case" });
  const dispatchResponse = await post(
    `/tickets/${triaged.id}/assignment/dispatch`,
    actorHeaders({
      actorId: "dispatcher-directory",
      actorRole: "dispatcher",
      toolName: "assignment.dispatch",
      correlationId: `corr-directory-emergency-${triaged.id}`,
      requestId: nextRequestId("96000000-0000-4000-8000"),
    }),
    {
      tech_id: techActiveOneId,
      dispatch_mode: "EMERGENCY_BYPASS",
      dispatch_confirmation: true,
      dispatch_rationale: "Dispatch immediately to preserve safety continuity",
    },
  );
  assert.equal(dispatchResponse.status, 200);
  assert.equal(dispatchResponse.body.state, "DISPATCHED");
  assert.equal(dispatchResponse.body.assigned_tech_id, techActiveOneId);
});

test("idempotency key replay preserves assignment transition state", async () => {
  const triaged = await createTriagedTicket({ summary: "Directory idempotent dispatch case" });
  const idempotencyKey = nextRequestId("96000000-0000-4000-8000");

  const firstDispatch = await post(
    `/tickets/${triaged.id}/assignment/dispatch`,
    actorHeaders({
      actorId: "dispatcher-directory",
      actorRole: "dispatcher",
      toolName: "assignment.dispatch",
      correlationId: `corr-directory-idem-${triaged.id}-first`,
      requestId: idempotencyKey,
    }),
    {
      tech_id: techActiveTwoId,
      dispatch_mode: "STANDARD",
    },
  );
  assert.equal(firstDispatch.status, 200);
  assert.equal(firstDispatch.body.state, "DISPATCHED");
  const afterFirst = queryCount(
    `SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${triaged.id}';`,
  );

  const replayDispatch = await post(
    `/tickets/${triaged.id}/assignment/dispatch`,
    actorHeaders({
      actorId: "dispatcher-directory",
      actorRole: "dispatcher",
      toolName: "assignment.dispatch",
      correlationId: `corr-directory-idem-${triaged.id}-replay`,
      requestId: idempotencyKey,
    }),
    {
      tech_id: techActiveTwoId,
      dispatch_mode: "STANDARD",
    },
  );
  assert.equal(replayDispatch.status, firstDispatch.status);
  assert.deepEqual(replayDispatch.body, firstDispatch.body);

  const afterReplay = queryCount(
    `SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${triaged.id}';`,
  );
  assert.equal(afterReplay, afterFirst);
});
