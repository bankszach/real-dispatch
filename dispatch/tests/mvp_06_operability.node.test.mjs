import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closePool } from "../api/src/db.mjs";
import { startDispatchApi } from "../api/src/server.mjs";

const repoRoot = process.cwd();
const migrationSql = fs.readFileSync(
  path.resolve(repoRoot, "dispatch/db/migrations/001_init.sql"),
  "utf8",
);

const postgresContainer = "rd-mvp06-test";
const postgresPort = 55446;
const dispatchApiPort = 18096;
const baseUrl = `http://127.0.0.1:${dispatchApiPort}`;

const accountId = "00000000-0000-0000-0000-000000000121";
const siteId = "00000000-0000-0000-0000-000000000122";
const techId = "00000000-0000-0000-0000-000000000123";

const requestIds = {
  createStuck: "86000000-0000-4000-8000-000000000001",
  triageStuck: "86000000-0000-4000-8000-000000000002",
  createCloseout: "86000000-0000-4000-8000-000000000003",
  triageCloseout: "86000000-0000-4000-8000-000000000004",
  dispatchCloseout: "86000000-0000-4000-8000-000000000005",
  checkInCloseout: "86000000-0000-4000-8000-000000000006",
  completeCloseout: "86000000-0000-4000-8000-000000000007",
  conflictCreate: "86000000-0000-4000-8000-000000000008",
};

let app;
let tempDir;
let logSinkPath;
let metricsSinkPath;
let alertsSinkPath;

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

async function post(pathname, headers, payload = {}) {
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

function readNdjson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (raw === "") {
    return [];
  }
  return raw.split("\n").map((line) => JSON.parse(line));
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
    VALUES ('${accountId}', 'MVP 06 Account');
  `);
  psql(`
    INSERT INTO sites (id, account_id, name, address1, city)
    VALUES ('${siteId}', '${accountId}', 'MVP 06 Site', '106 Main St', 'Springfield');
  `);

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-mvp06-"));
  logSinkPath = path.join(tempDir, "dispatch-api.log.ndjson");
  metricsSinkPath = path.join(tempDir, "dispatch-api.metrics.json");
  alertsSinkPath = path.join(tempDir, "dispatch-api.alerts.ndjson");

  process.env.DISPATCH_DATABASE_URL = `postgres://dispatch:dispatch@127.0.0.1:${postgresPort}/dispatch`;
  app = await startDispatchApi({
    host: "127.0.0.1",
    port: dispatchApiPort,
    logSinkPath,
    metricsSinkPath,
    alertsSinkPath,
    alertThresholds: {
      stuckSchedulingCount: 1,
      stuckSchedulingMinutes: 0,
      completionRejectionCount: 1,
      idempotencyConflictCount: 1,
      authPolicyRejectionCount: 1,
    },
  });
});

test.after(async () => {
  if (app) {
    await app.stop();
  }
  await closePool();
  spawnSync("docker", ["rm", "-f", postgresContainer], { encoding: "utf8" });
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("mvp-06 alerts detect key failure modes and durable sinks persist outputs", async () => {
  const createStuck = await post(
    "/tickets",
    {
      "Idempotency-Key": requestIds.createStuck,
      "X-Actor-Id": "dispatcher-mvp06",
      "X-Actor-Role": "dispatcher",
      "X-Tool-Name": "ticket.create",
      "X-Correlation-Id": "corr-mvp06-stuck-create",
    },
    {
      account_id: accountId,
      site_id: siteId,
      summary: "MVP-06 stuck scheduling trigger",
    },
  );
  assert.equal(createStuck.status, 201);
  const stuckTicketId = createStuck.body.id;

  const triageStuck = await post(
    `/tickets/${stuckTicketId}/triage`,
    {
      "Idempotency-Key": requestIds.triageStuck,
      "X-Actor-Id": "dispatcher-mvp06",
      "X-Actor-Role": "dispatcher",
      "X-Tool-Name": "ticket.triage",
      "X-Correlation-Id": "corr-mvp06-stuck-triage",
    },
    {
      priority: "URGENT",
      incident_type: "DOOR_WONT_LATCH",
      workflow_outcome: "READY_TO_SCHEDULE",
    },
  );
  assert.equal(triageStuck.status, 200);
  assert.equal(triageStuck.body.state, "READY_TO_SCHEDULE");

  const createCloseout = await post(
    "/tickets",
    {
      "Idempotency-Key": requestIds.createCloseout,
      "X-Actor-Id": "dispatcher-mvp06",
      "X-Actor-Role": "dispatcher",
      "X-Tool-Name": "ticket.create",
      "X-Correlation-Id": "corr-mvp06-closeout-create",
    },
    {
      account_id: accountId,
      site_id: siteId,
      summary: "MVP-06 completion rejection trigger",
    },
  );
  assert.equal(createCloseout.status, 201);
  const closeoutTicketId = createCloseout.body.id;

  const triageCloseout = await post(
    `/tickets/${closeoutTicketId}/triage`,
    {
      "Idempotency-Key": requestIds.triageCloseout,
      "X-Actor-Id": "dispatcher-mvp06",
      "X-Actor-Role": "dispatcher",
      "X-Tool-Name": "ticket.triage",
      "X-Correlation-Id": "corr-mvp06-closeout-triage",
    },
    {
      priority: "URGENT",
      incident_type: "DOOR_WONT_LATCH",
    },
  );
  assert.equal(triageCloseout.status, 200);

  const dispatchCloseout = await post(
    `/tickets/${closeoutTicketId}/assignment/dispatch`,
    {
      "Idempotency-Key": requestIds.dispatchCloseout,
      "X-Actor-Id": "dispatcher-mvp06",
      "X-Actor-Role": "dispatcher",
      "X-Tool-Name": "assignment.dispatch",
      "X-Correlation-Id": "corr-mvp06-closeout-dispatch",
    },
    {
      tech_id: techId,
      dispatch_mode: "EMERGENCY_BYPASS",
      dispatch_confirmation: true,
      dispatch_rationale:
        "Escalated dispatch needed to preserve continuity during closeout testing",
    },
  );
  assert.equal(dispatchCloseout.status, 200);

  const checkInCloseout = await post(
    `/tickets/${closeoutTicketId}/tech/check-in`,
    {
      "Idempotency-Key": requestIds.checkInCloseout,
      "X-Actor-Id": "tech-mvp06",
      "X-Actor-Role": "tech",
      "X-Tool-Name": "tech.check_in",
      "X-Correlation-Id": "corr-mvp06-closeout-checkin",
    },
    {
      timestamp: "2026-02-16T12:00:00.000Z",
      location: {
        lat: 47.6097,
        lon: -122.3331,
      },
    },
  );
  assert.equal(checkInCloseout.status, 200);
  assert.equal(checkInCloseout.body.state, "IN_PROGRESS");

  const closeoutRejected = await post(
    `/tickets/${closeoutTicketId}/tech/complete`,
    {
      "Idempotency-Key": requestIds.completeCloseout,
      "X-Actor-Id": "tech-mvp06",
      "X-Actor-Role": "tech",
      "X-Tool-Name": "tech.complete",
      "X-Correlation-Id": "corr-mvp06-closeout-complete",
    },
    {
      checklist_status: {
        work_performed: true,
        parts_used_or_needed: true,
        resolution_status: true,
        onsite_photos_after: true,
        billing_authorization: true,
      },
    },
  );
  assert.equal(closeoutRejected.status, 409);
  assert.equal(closeoutRejected.body.error.code, "CLOSEOUT_REQUIREMENTS_INCOMPLETE");

  const conflictFirst = await post(
    "/tickets",
    {
      "Idempotency-Key": requestIds.conflictCreate,
      "X-Actor-Id": "dispatcher-mvp06",
      "X-Actor-Role": "dispatcher",
      "X-Tool-Name": "ticket.create",
      "X-Correlation-Id": "corr-mvp06-conflict",
    },
    {
      account_id: accountId,
      site_id: siteId,
      summary: "MVP-06 conflict first payload",
    },
  );
  assert.equal(conflictFirst.status, 201);

  const conflictSecond = await post(
    "/tickets",
    {
      "Idempotency-Key": requestIds.conflictCreate,
      "X-Actor-Id": "dispatcher-mvp06",
      "X-Actor-Role": "dispatcher",
      "X-Tool-Name": "ticket.create",
      "X-Correlation-Id": "corr-mvp06-conflict",
    },
    {
      account_id: accountId,
      site_id: siteId,
      summary: "MVP-06 conflict second payload",
    },
  );
  assert.equal(conflictSecond.status, 409);
  assert.equal(conflictSecond.body.error.code, "IDEMPOTENCY_PAYLOAD_MISMATCH");

  const authFailure = await get(`/tickets/${stuckTicketId}/timeline`, {
    "X-Actor-Id": "customer-mvp06",
    "X-Actor-Role": "customer",
    "X-Tool-Name": "ticket.create",
    "X-Correlation-Id": "corr-mvp06-auth-failure",
  });
  assert.equal(authFailure.status, 403);
  assert.ok(["FORBIDDEN", "TOOL_NOT_ALLOWED"].includes(authFailure.body.error.code));

  const alertsResponse = await get("/ops/alerts", {
    "X-Correlation-Id": "corr-mvp06-alerts",
  });
  assert.equal(alertsResponse.status, 200);
  const alerts = alertsResponse.body.alerts;
  const alertCodes = alerts.map((entry) => entry.code).toSorted();
  assert.deepEqual(alertCodes, [
    "AUTH_POLICY_FAILURE_SPIKE",
    "COMPLETION_REJECTION_SPIKE",
    "IDEMPOTENCY_CONFLICT_SPIKE",
    "STUCK_SCHEDULING",
  ]);

  assert.ok(alertsResponse.body.signals.stuck_scheduling_count >= 1);
  assert.ok(alertsResponse.body.signals.completion_rejection_count >= 1);
  assert.ok(alertsResponse.body.signals.idempotency_conflict_count >= 1);
  assert.ok(alertsResponse.body.signals.auth_policy_rejection_count >= 1);

  assert.equal(
    alertsResponse.body.runbooks.STUCK_SCHEDULING,
    "dispatch/ops/runbooks/stuck_scheduling.md",
  );
  assert.equal(
    alertsResponse.body.runbooks.COMPLETION_REJECTION_SPIKE,
    "dispatch/ops/runbooks/completion_rejection.md",
  );
  assert.equal(
    alertsResponse.body.runbooks.IDEMPOTENCY_CONFLICT_SPIKE,
    "dispatch/ops/runbooks/idempotency_conflict.md",
  );
  assert.equal(
    alertsResponse.body.runbooks.AUTH_POLICY_FAILURE_SPIKE,
    "dispatch/ops/runbooks/auth_policy_failure.md",
  );

  assert.equal(fs.existsSync(logSinkPath), true);
  const logEntries = readNdjson(logSinkPath);
  assert.ok(logEntries.length > 0);
  assert.ok(logEntries.some((entry) => entry.endpoint === "/ops/alerts" && entry.status === 200));
  assert.ok(logEntries.some((entry) => entry.error_code === "IDEMPOTENCY_PAYLOAD_MISMATCH"));
  assert.ok(logEntries.some((entry) => entry.error_code === "CLOSEOUT_REQUIREMENTS_INCOMPLETE"));
  assert.ok(
    logEntries.some((entry) => ["FORBIDDEN", "TOOL_NOT_ALLOWED"].includes(entry.error_code)),
  );

  assert.equal(fs.existsSync(metricsSinkPath), true);
  const metricsSnapshot = JSON.parse(fs.readFileSync(metricsSinkPath, "utf8"));
  assert.equal(metricsSnapshot.service, "dispatch-api");
  assert.ok(metricsSnapshot.counters.idempotency_conflict_total >= 1);
  const completionCounter = metricsSnapshot.counters.errors_total.find(
    (entry) => entry.code === "CLOSEOUT_REQUIREMENTS_INCOMPLETE",
  );
  assert.ok(Number(completionCounter?.count ?? 0) >= 1);

  assert.equal(fs.existsSync(alertsSinkPath), true);
  const alertSinkSnapshots = readNdjson(alertsSinkPath);
  assert.ok(alertSinkSnapshots.length >= 1);
  const latestAlertSinkSnapshot = alertSinkSnapshots[alertSinkSnapshots.length - 1];
  assert.ok(Array.isArray(latestAlertSinkSnapshot.alerts));
  assert.ok(latestAlertSinkSnapshot.alerts.length >= 4);
});

test("mvp-06 runbooks and drill artifacts are published", () => {
  const runbookDir = path.resolve(repoRoot, "dispatch/ops/runbooks");
  const requiredFiles = [
    "README.md",
    "stuck_scheduling.md",
    "completion_rejection.md",
    "idempotency_conflict.md",
    "auth_policy_failure.md",
    "mvp_06_on_call_drill.md",
  ];

  for (const fileName of requiredFiles) {
    const filePath = path.resolve(runbookDir, fileName);
    assert.equal(fs.existsSync(filePath), true, `${fileName} must exist`);
    const content = fs.readFileSync(filePath, "utf8");
    assert.ok(content.trim().length > 0, `${fileName} must be non-empty`);
  }

  const drillPath = path.resolve(runbookDir, "mvp_06_on_call_drill.md");
  const drillContent = fs.readFileSync(drillPath, "utf8");
  assert.match(drillContent, /STUCK_SCHEDULING/);
  assert.match(drillContent, /COMPLETION_REJECTION_SPIKE/);
  assert.match(drillContent, /IDEMPOTENCY_CONFLICT_SPIKE/);
  assert.match(drillContent, /AUTH_POLICY_FAILURE_SPIKE/);
});
