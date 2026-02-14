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

const postgresContainer = "rd-story01-test";
const postgresPort = 55436;
const dispatchApiPort = 18086;
const baseUrl = `http://127.0.0.1:${dispatchApiPort}`;

const accountId = "00000000-0000-0000-0000-000000000001";
const siteId = "00000000-0000-0000-0000-000000000010";
const techId = "00000000-0000-0000-0000-000000000099";

let app;

function run(command, args, input = undefined) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input,
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout,
        result.stderr,
      ]
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
    VALUES ('${accountId}', 'Acme Facilities');
  `);
  psql(`
    INSERT INTO sites (id, account_id, name, address1, city)
    VALUES ('${siteId}', '${accountId}', 'Main Campus', '1 Main St', 'Springfield');
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

test("idempotency replay returns exact prior response and no duplicate mutation", async () => {
  const payload = {
    account_id: accountId,
    site_id: siteId,
    summary: "Front door will not latch",
    description: "Customer reports recurring latch failure.",
  };
  const headers = {
    "Idempotency-Key": "10000000-0000-4000-8000-000000000001",
    "X-Actor-Id": "dispatcher-1",
    "X-Actor-Role": "dispatcher",
    "X-Tool-Name": "ticket.create",
    "X-Correlation-Id": "corr-1001",
  };

  const first = await post("/tickets", headers, payload);
  assert.equal(first.status, 201);
  assert.equal(first.body.state, "NEW");
  assert.equal(first.body.summary, payload.summary);
  const createdTicketId = first.body.id;

  const second = await post("/tickets", headers, payload);
  assert.equal(second.status, first.status);
  assert.deepEqual(second.body, first.body);

  const ticketCount = Number(psql(`SELECT count(*) FROM tickets WHERE summary = '${payload.summary}';`));
  assert.equal(ticketCount, 1);

  const auditCount = Number(psql(`SELECT count(*) FROM audit_events WHERE ticket_id = '${createdTicketId}';`));
  assert.equal(auditCount, 1);

  const transitionCount = Number(
    psql(`SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${createdTicketId}';`),
  );
  assert.equal(transitionCount, 1);
});

test("idempotency key reuse with different payload returns 409 and no mutation", async () => {
  const conflictPayload = {
    account_id: accountId,
    site_id: siteId,
    summary: "This payload should conflict",
  };
  const headers = {
    "Idempotency-Key": "10000000-0000-4000-8000-000000000001",
    "X-Actor-Id": "dispatcher-1",
    "X-Actor-Role": "dispatcher",
    "X-Tool-Name": "ticket.create",
    "X-Correlation-Id": "corr-1002",
  };

  const response = await post("/tickets", headers, conflictPayload);
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "IDEMPOTENCY_PAYLOAD_MISMATCH");
  assert.equal(response.body.error.request_id, headers["Idempotency-Key"]);

  const conflictSummaryCount = Number(
    psql("SELECT count(*) FROM tickets WHERE summary = 'This payload should conflict';"),
  );
  assert.equal(conflictSummaryCount, 0);
});

test("missing idempotency key returns 400 and no mutation", async () => {
  const payload = {
    account_id: accountId,
    site_id: siteId,
    summary: "No idempotency key request",
  };
  const response = await post(
    "/tickets",
    {
      "X-Actor-Id": "dispatcher-1",
      "X-Actor-Role": "dispatcher",
    },
    payload,
  );

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "MISSING_IDEMPOTENCY_KEY");

  const missingKeySummaryCount = Number(
    psql("SELECT count(*) FROM tickets WHERE summary = 'No idempotency key request';"),
  );
  assert.equal(missingKeySummaryCount, 0);
});

test("invalid transition fails closed and successful mutations emit audit + transition rows", async () => {
  const createForTransition = await post(
    "/tickets",
    {
      "Idempotency-Key": "90000000-0000-4000-8000-000000000001",
      "X-Actor-Id": "dispatcher-1",
      "X-Actor-Role": "dispatcher",
      "X-Tool-Name": "ticket.create",
    },
    {
      account_id: accountId,
      site_id: siteId,
      summary: "Transition validation ticket",
    },
  );
  assert.equal(createForTransition.status, 201);
  const createdTicketId = createForTransition.body.id;

  const invalidTransition = await post(
    `/tickets/${createdTicketId}/schedule/confirm`,
    {
      "Idempotency-Key": "20000000-0000-4000-8000-000000000001",
      "X-Actor-Id": "dispatcher-1",
      "X-Actor-Role": "dispatcher",
      "X-Tool-Name": "schedule.confirm",
    },
    {
      start: "2026-02-14T18:00:00.000Z",
      end: "2026-02-14T19:00:00.000Z",
    },
  );

  assert.equal(invalidTransition.status, 409);
  assert.equal(invalidTransition.body.error.code, "INVALID_STATE_TRANSITION");
  assert.equal(psql(`SELECT state FROM tickets WHERE id = '${createdTicketId}';`), "NEW");

  const triageResponse = await post(
    `/tickets/${createdTicketId}/triage`,
    {
      "Idempotency-Key": "30000000-0000-4000-8000-000000000001",
      "X-Actor-Id": "dispatcher-1",
      "X-Actor-Role": "dispatcher",
      "X-Tool-Name": "ticket.triage",
    },
    {
      priority: "EMERGENCY",
      incident_type: "DOOR_WONT_LATCH_V1",
      nte_cents: 25000,
    },
  );

  assert.equal(triageResponse.status, 200);
  assert.equal(triageResponse.body.state, "TRIAGED");

  const blockedDispatch = await post(
    `/tickets/${createdTicketId}/assignment/dispatch`,
    {
      "Idempotency-Key": "40000000-0000-4000-8000-000000000001",
      "X-Actor-Id": "dispatcher-1",
      "X-Actor-Role": "dispatcher",
      "X-Tool-Name": "assignment.dispatch",
    },
    {
      tech_id: techId,
    },
  );
  assert.equal(blockedDispatch.status, 409);
  assert.equal(blockedDispatch.body.error.code, "INVALID_STATE_TRANSITION");
  assert.equal(psql(`SELECT state FROM tickets WHERE id = '${createdTicketId}';`), "TRIAGED");

  const emergencyDispatch = await post(
    `/tickets/${createdTicketId}/assignment/dispatch`,
    {
      "Idempotency-Key": "50000000-0000-4000-8000-000000000001",
      "X-Actor-Id": "dispatcher-1",
      "X-Actor-Role": "dispatcher",
      "X-Tool-Name": "assignment.dispatch",
    },
    {
      tech_id: techId,
      dispatch_mode: "EMERGENCY_BYPASS",
    },
  );
  assert.equal(emergencyDispatch.status, 200);
  assert.equal(emergencyDispatch.body.state, "DISPATCHED");

  const auditCount = Number(psql(`SELECT count(*) FROM audit_events WHERE ticket_id = '${createdTicketId}';`));
  const transitionCount = Number(
    psql(`SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${createdTicketId}';`),
  );
  assert.equal(auditCount, 3);
  assert.equal(transitionCount, 3);
});
