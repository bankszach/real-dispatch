import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { closePool } from "../api/src/db.mjs";
import { startDispatchApi } from "../api/src/server.mjs";
import { DISPATCH_TOOL_POLICIES } from "../shared/authorization-policy.mjs";

const repoRoot = process.cwd();
const uxDir = path.resolve(repoRoot, "dispatch/ux");
const dispatcherSpecPath = path.resolve(uxDir, "dispatcher_cockpit_v0.md");
const techPacketSpecPath = path.resolve(uxDir, "technician_job_packet_v0.md");
const uxReadmePath = path.resolve(uxDir, "README.md");

const migrationSql = fs.readFileSync(
  path.resolve(repoRoot, "dispatch/db/migrations/001_init.sql"),
  "utf8",
);

const postgresContainer = "rd-story10-test";
const postgresPort = 55440;
const dispatchApiPort = 18090;
const baseUrl = `http://127.0.0.1:${dispatchApiPort}`;

const accountId = "00000000-0000-0000-0000-000000000101";
const siteId = "00000000-0000-0000-0000-000000000102";
const outOfScopeAccountId = "00000000-0000-0000-0000-000000000103";
const outOfScopeSiteId = "00000000-0000-0000-0000-000000000104";
const techId = "00000000-0000-0000-0000-000000000105";

let app;
let requestCounter = 1;

function mustInclude(text, pattern, message) {
  assert.match(text, pattern, message);
}

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

function nextRequestId() {
  const id = `71000000-0000-4000-8000-${String(requestCounter).padStart(12, "0")}`;
  requestCounter += 1;
  return id;
}

function readJson(responseText) {
  if (!responseText || responseText.trim() === "") {
    return null;
  }
  return JSON.parse(responseText);
}

function actorHeaders(params) {
  const {
    actorId,
    actorRole,
    toolName,
    accountScope = null,
    siteScope = null,
    correlationId = null,
  } = params;
  const headers = {
    "X-Actor-Id": actorId,
    "X-Actor-Role": actorRole,
    "X-Tool-Name": toolName,
  };
  if (accountScope != null) {
    headers["X-Account-Scope"] = accountScope;
  }
  if (siteScope != null) {
    headers["X-Site-Scope"] = siteScope;
  }
  if (correlationId != null) {
    headers["X-Correlation-Id"] = correlationId;
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
  const responseText = await response.text();
  return {
    status: response.status,
    body: readJson(responseText),
  };
}

async function get(pathname, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "GET",
    headers,
  });
  const responseText = await response.text();
  return {
    status: response.status,
    body: readJson(responseText),
  };
}

function assertActionMapsToPolicy(action, ticketId) {
  const policy = DISPATCH_TOOL_POLICIES[action.tool_name];
  assert.ok(policy, `tool '${action.tool_name}' must be allowlisted`);
  const expectedEndpoint = policy.requires_ticket_id
    ? policy.endpoint.replace("{ticketId}", ticketId)
    : policy.endpoint;
  assert.equal(action.endpoint, expectedEndpoint);
  assert.equal(action.method, policy.method);
}

async function createInProgressTicket() {
  const dispatcherCreateHeaders = {
    "Idempotency-Key": nextRequestId(),
    ...actorHeaders({
      actorId: "dispatcher-story10",
      actorRole: "dispatcher",
      toolName: "ticket.create",
      accountScope: accountId,
      siteScope: siteId,
      correlationId: "corr-story10-create",
    }),
  };

  const create = await post("/tickets", dispatcherCreateHeaders, {
    account_id: accountId,
    site_id: siteId,
    summary: "Story 10 UX packet ticket",
    description: "Dispatcher cockpit and technician packet integration validation",
  });
  assert.equal(create.status, 201);
  const ticketId = create.body.id;

  const triage = await post(
    `/tickets/${ticketId}/triage`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "dispatcher-story10",
        actorRole: "dispatcher",
        toolName: "ticket.triage",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-triage",
      }),
    },
    {
      priority: "EMERGENCY",
      incident_type: "CANNOT_SECURE_ENTRY",
      ready_to_schedule: true,
      nte_cents: 42000,
    },
  );
  assert.equal(triage.status, 200);
  assert.equal(triage.body.state, "READY_TO_SCHEDULE");

  const start = new Date(Date.now() + 45 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 105 * 60 * 1000).toISOString();

  const propose = await post(
    `/tickets/${ticketId}/schedule/propose`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "dispatcher-story10",
        actorRole: "dispatcher",
        toolName: "schedule.propose",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-propose",
      }),
    },
    {
      options: [{ start, end }],
    },
  );
  assert.equal(propose.status, 200);
  assert.equal(propose.body.state, "SCHEDULE_PROPOSED");

  const confirm = await post(
    `/tickets/${ticketId}/schedule/confirm`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "dispatcher-story10",
        actorRole: "dispatcher",
        toolName: "schedule.confirm",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-confirm",
      }),
    },
    {
      start,
      end,
    },
  );
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.state, "SCHEDULED");

  const dispatch = await post(
    `/tickets/${ticketId}/assignment/dispatch`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "dispatcher-story10",
        actorRole: "dispatcher",
        toolName: "assignment.dispatch",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-dispatch",
      }),
    },
    {
      tech_id: techId,
      dispatch_mode: "STANDARD",
    },
  );
  assert.equal(dispatch.status, 200);
  assert.equal(dispatch.body.state, "DISPATCHED");

  const checkIn = await post(
    `/tickets/${ticketId}/tech/check-in`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "tech-story10",
        actorRole: "tech",
        toolName: "tech.check_in",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-checkin",
      }),
    },
    {
      timestamp: new Date().toISOString(),
      location: {
        lat: 37.7749,
        lon: -122.4194,
      },
    },
  );
  assert.equal(checkIn.status, 200);
  assert.equal(checkIn.body.state, "IN_PROGRESS");

  const evidence = await post(
    `/tickets/${ticketId}/evidence`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "tech-story10",
        actorRole: "tech",
        toolName: "closeout.add_evidence",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-evidence",
      }),
    },
    {
      kind: "PHOTO",
      uri: `s3://dispatch-story10/${ticketId}/before.jpg`,
      metadata: {
        evidence_key: "photo_before_security_risk",
      },
    },
  );
  assert.equal(evidence.status, 201);

  return ticketId;
}

async function createDispatchedTicket() {
  const dispatcherCreateHeaders = {
    "Idempotency-Key": nextRequestId(),
    ...actorHeaders({
      actorId: "dispatcher-story10-dispatch",
      actorRole: "dispatcher",
      toolName: "ticket.create",
      accountScope: accountId,
      siteScope: siteId,
      correlationId: "corr-story10-create-dispatch",
    }),
  };

  const create = await post("/tickets", dispatcherCreateHeaders, {
    account_id: accountId,
    site_id: siteId,
    summary: "Story 10 UX ticket for dispatch contract checks",
  });
  assert.equal(create.status, 201);
  const ticketId = create.body.id;

  const triage = await post(
    `/tickets/${ticketId}/triage`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "dispatcher-story10-dispatch",
        actorRole: "dispatcher",
        toolName: "ticket.triage",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-triage-dispatch",
      }),
    },
    {
      priority: "EMERGENCY",
      incident_type: "CANNOT_SECURE_ENTRY",
      ready_to_schedule: true,
      nte_cents: 42000,
    },
  );
  assert.equal(triage.status, 200);

  const start = new Date(Date.now() + 45 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 105 * 60 * 1000).toISOString();

  const propose = await post(
    `/tickets/${ticketId}/schedule/propose`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "dispatcher-story10-dispatch",
        actorRole: "dispatcher",
        toolName: "schedule.propose",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-propose-dispatch",
      }),
    },
    {
      options: [{ start, end }],
    },
  );
  assert.equal(propose.status, 200);

  const confirm = await post(
    `/tickets/${ticketId}/schedule/confirm`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "dispatcher-story10-dispatch",
        actorRole: "dispatcher",
        toolName: "schedule.confirm",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-confirm-dispatch",
      }),
    },
    {
      start,
      end,
    },
  );
  assert.equal(confirm.status, 200);

  const dispatch = await post(
    `/tickets/${ticketId}/assignment/dispatch`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "dispatcher-story10-dispatch",
        actorRole: "dispatcher",
        toolName: "assignment.dispatch",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-dispatch",
      }),
    },
    {
      tech_id: techId,
      dispatch_mode: "STANDARD",
    },
  );
  assert.equal(dispatch.status, 200);
  assert.equal(dispatch.body.state, "DISPATCHED");

  return ticketId;
}

async function createScheduledTicket() {
  const dispatcherCreateHeaders = {
    "Idempotency-Key": nextRequestId(),
    ...actorHeaders({
      actorId: "dispatcher-story10-scheduled",
      actorRole: "dispatcher",
      toolName: "ticket.create",
      accountScope: accountId,
      siteScope: siteId,
      correlationId: "corr-story10-create-scheduled",
    }),
  };

  const create = await post("/tickets", dispatcherCreateHeaders, {
    account_id: accountId,
    site_id: siteId,
    summary: "Story 10 UX ticket for bypass checks",
  });
  assert.equal(create.status, 201);
  const ticketId = create.body.id;

  const triage = await post(
    `/tickets/${ticketId}/triage`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "dispatcher-story10-scheduled",
        actorRole: "dispatcher",
        toolName: "ticket.triage",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-triage-scheduled",
      }),
    },
    {
      priority: "EMERGENCY",
      incident_type: "CANNOT_SECURE_ENTRY",
      ready_to_schedule: true,
      nte_cents: 42000,
    },
  );
  assert.equal(triage.status, 200);

  const start = new Date(Date.now() + 45 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 105 * 60 * 1000).toISOString();

  const propose = await post(
    `/tickets/${ticketId}/schedule/propose`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "dispatcher-story10-scheduled",
        actorRole: "dispatcher",
        toolName: "schedule.propose",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-propose-scheduled",
      }),
    },
    {
      options: [{ start, end }],
    },
  );
  assert.equal(propose.status, 200);

  const confirm = await post(
    `/tickets/${ticketId}/schedule/confirm`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "dispatcher-story10-scheduled",
        actorRole: "dispatcher",
        toolName: "schedule.confirm",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-confirm-scheduled",
      }),
    },
    {
      start,
      end,
    },
  );
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.state, "SCHEDULED");

  return ticketId;
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
    VALUES
      ('${accountId}', 'Story 10 In Scope Account'),
      ('${outOfScopeAccountId}', 'Story 10 Out Of Scope Account');
  `);
  psql(`
    INSERT INTO sites (id, account_id, name, address1, city, region, postal_code, access_instructions)
    VALUES
      ('${siteId}', '${accountId}', 'Story 10 Site', '10 Main St', 'Springfield', 'CA', '94016', 'Rear gate keypad 4472'),
      ('${outOfScopeSiteId}', '${outOfScopeAccountId}', 'Story 10 OOS Site', '11 Main St', 'Shelbyville', 'CA', '94017', 'Use front desk');
  `);
  psql(`
    INSERT INTO contacts (site_id, account_id, name, phone, role, is_authorized_requester)
    VALUES
      ('${siteId}', '${accountId}', 'Alex Dispatcher', '555-0107', 'onsite_contact', true);
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

test("story 10 UX artifacts exist and are non-empty", () => {
  for (const filePath of [dispatcherSpecPath, techPacketSpecPath, uxReadmePath]) {
    assert.ok(fs.existsSync(filePath), `missing UX artifact: ${filePath}`);
    const stat = fs.statSync(filePath);
    assert.ok(stat.size > 0, `UX artifact is empty: ${filePath}`);
  }
});

test("dispatcher cockpit spec includes SLA timers, assignment override, timeline, and wireframe", () => {
  const content = fs.readFileSync(dispatcherSpecPath, "utf8");

  mustInclude(content, /SLA Timer Rules/i, "dispatcher spec must define SLA timer behavior");
  mustInclude(
    content,
    /Assignment Override Flow/i,
    "dispatcher spec must define assignment override",
  );
  mustInclude(content, /Timeline Panel/i, "dispatcher spec must define timeline view");
  mustInclude(content, /Wireframe \(ASCII\)/i, "dispatcher spec must include wireframe");

  mustInclude(content, /sla_timer_remaining/i, "queue fields must include sla timer column");
  mustInclude(content, /correlation_id/i, "timeline fields must include correlation id");
});

test("technician job packet spec includes required packet fields and closeout evidence gates", () => {
  const content = fs.readFileSync(techPacketSpecPath, "utf8");

  mustInclude(content, /Packet Structure/i, "tech packet spec must define packet structure");
  mustInclude(
    content,
    /Evidence Checklist Mapping/i,
    "tech packet spec must define evidence mapping",
  );
  mustInclude(content, /Signature Requirement/i, "tech packet spec must define signature handling");
  mustInclude(
    content,
    /Closeout Gate Behavior/i,
    "tech packet spec must define closeout gate behavior",
  );
  mustInclude(content, /Mobile Wireframe \(ASCII\)/i, "tech packet spec must include wireframe");

  mustInclude(content, /no_signature_reason/i, "tech packet must require no-signature reason path");
  mustInclude(content, /Complete Work/i, "tech packet must define completion action gating");
});

test("dispatcher cockpit response maps actions to closed dispatch endpoints and exposes state policy errors", async () => {
  const ticketId = await createInProgressTicket();

  const cockpit = await get(
    `/ux/dispatcher/cockpit?ticket_id=${ticketId}`,
    actorHeaders({
      actorId: "dispatcher-story10",
      actorRole: "dispatcher",
      toolName: "dispatcher.cockpit",
      accountScope: accountId,
      siteScope: siteId,
      correlationId: "corr-story10-cockpit",
    }),
  );

  assert.equal(cockpit.status, 200);
  assert.equal(Array.isArray(cockpit.body.queue), true);
  assert.ok(cockpit.body.queue.length > 0);

  const row = cockpit.body.queue.find((entry) => entry.ticket_id === ticketId);
  assert.ok(row, "cockpit queue should include created ticket");
  assert.equal(typeof row.sla_timer_remaining, "string");
  assert.ok(["healthy", "warning", "breach"].includes(row.sla_status));
  assert.equal(Array.isArray(row.actions), true);

  for (const action of row.actions) {
    assertActionMapsToPolicy(action, ticketId);
  }

  const scheduleProposeAction = row.actions.find(
    (action) => action.action_id === "schedule_propose",
  );
  assert.ok(scheduleProposeAction);
  assert.equal(scheduleProposeAction.enabled, false);
  assert.equal(scheduleProposeAction.policy_error.code, "INVALID_STATE_TRANSITION");
  assert.equal(scheduleProposeAction.policy_error.dimension, "state");

  const timelineAction = row.actions.find((action) => action.action_id === "open_timeline");
  assert.ok(timelineAction);
  assert.equal(timelineAction.enabled, true);

  assert.ok(cockpit.body.selected_ticket);
  assert.equal(cockpit.body.selected_ticket.ticket.id, ticketId);
  assert.ok(Array.isArray(cockpit.body.selected_ticket.timeline.events));
  assert.ok(cockpit.body.selected_ticket.timeline.events.length >= 6);
});

test("dispatcher cockpit fail-closed role and tool errors include policy dimensions", async () => {
  const roleBlocked = await get(
    "/ux/dispatcher/cockpit",
    actorHeaders({
      actorId: "tech-story10",
      actorRole: "tech",
      toolName: "dispatcher.cockpit",
      accountScope: accountId,
      siteScope: siteId,
      correlationId: "corr-story10-cockpit-role",
    }),
  );

  assert.equal(roleBlocked.status, 403);
  assert.equal(roleBlocked.body.error.code, "FORBIDDEN");
  assert.equal(roleBlocked.body.error.policy_error.dimension, "role");

  const toolBlocked = await get(
    "/ux/dispatcher/cockpit",
    actorHeaders({
      actorId: "dispatcher-story10",
      actorRole: "dispatcher",
      toolName: "ticket.timeline",
      accountScope: accountId,
      siteScope: siteId,
      correlationId: "corr-story10-cockpit-tool",
    }),
  );

  assert.equal(toolBlocked.status, 403);
  assert.equal(toolBlocked.body.error.code, "TOOL_NOT_ALLOWED");
  assert.equal(toolBlocked.body.error.policy_error.dimension, "tool");
});

test("unknown role is fail-closed with role policy error", async () => {
  const unknownRoleBlocked = await get("/ux/dispatcher/cockpit", {
    "X-Actor-Id": "dispatcher-story10-unknown-role",
    "X-Actor-Role": "hobbit",
    "X-Tool-Name": "dispatcher.cockpit",
    "X-Account-Scope": accountId,
    "X-Site-Scope": siteId,
    "X-Correlation-Id": "corr-story10-unknown-role",
  });

  assert.equal(unknownRoleBlocked.status, 401);
  assert.equal(unknownRoleBlocked.body.error.code, "INVALID_AUTH_CLAIMS");
  assert.equal(unknownRoleBlocked.body.error.policy_error.dimension, "role");
});

test("dispatcher cockpit action surface excludes assignment recommendation tooling", async () => {
  const ticketId = await createInProgressTicket();
  const cockpit = await get(
    `/ux/dispatcher/cockpit?ticket_id=${ticketId}`,
    actorHeaders({
      actorId: "dispatcher-story10",
      actorRole: "dispatcher",
      toolName: "dispatcher.cockpit",
      accountScope: accountId,
      siteScope: siteId,
      correlationId: "corr-story10-cockpit-recommend-disabled",
    }),
  );

  assert.equal(cockpit.status, 200);
  const row = cockpit.body.queue.find((entry) => entry.ticket_id === ticketId);
  assert.ok(row);
  assert.equal(
    row.actions.some((action) => action.tool_name === "assignment.recommend"),
    false,
    "assignment recommendation should not be in cockpit actions",
  );
});

test("tech.check_in accepts canonical technician role alias", async () => {
  const ticketId = await createDispatchedTicket();

  const checkIn = await post(
    `/tickets/${ticketId}/tech/check-in`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "tech-story10-alias",
        actorRole: "technician",
        toolName: "tech.check_in",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-checkin-alias",
      }),
    },
    {
      timestamp: new Date().toISOString(),
      location: {
        lat: 37.7749,
        lon: -122.4194,
      },
    },
  );

  assert.equal(checkIn.status, 200);
  assert.equal(checkIn.body.state, "IN_PROGRESS");
});

test("assignment.recommend returns deterministic transition error before recommendation context is ready", async () => {
  const create = await post(
    "/tickets",
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "dispatcher-story10-recommend",
        actorRole: "dispatcher",
        toolName: "ticket.create",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-recommend-create",
      }),
    },
    {
      account_id: accountId,
      site_id: siteId,
      summary: "Story 10 UX recommendation state mismatch",
    },
  );
  assert.equal(create.status, 201);
  const ticketId = create.body.id;

  const recommend = await post(
    `/tickets/${ticketId}/assignment/recommend`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "dispatcher-story10-recommend",
        actorRole: "dispatcher",
        toolName: "assignment.recommend",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-recommend-blocked",
      }),
    },
    {
      service_type: "CANNOT_SECURE_ENTRY",
    },
  );

  assert.equal(recommend.status, 409);
  assert.equal(recommend.body.error.code, "INVALID_STATE_TRANSITION");
  assert.equal(recommend.body.error.policy_error.dimension, "state");
  assert.equal(recommend.body.error.from_state, "NEW");
  assert.equal(
    Array.isArray(recommend.body.error.allowed_from_states),
    true,
    "state failure should include allowed_from_states",
  );
  assert.equal(recommend.body.error.to_state, null);
});

test("EMERGENCY_BYPASS dispatch requires explicit confirmation", async () => {
  const ticketId = await createScheduledTicket();

  const bypassBlocked = await post(
    `/tickets/${ticketId}/assignment/dispatch`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "dispatcher-story10-bypass",
        actorRole: "dispatcher",
        toolName: "assignment.dispatch",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-bypass-blocked",
      }),
    },
    {
      tech_id: techId,
      dispatch_mode: "EMERGENCY_BYPASS",
      dispatch_rationale: "High priority safety risk while en route",
    },
  );

  assert.equal(bypassBlocked.status, 409);
  assert.equal(bypassBlocked.body.error.code, "ASSIGNMENT_BYPASS_DENIED");
  assert.equal(bypassBlocked.body.error.policy_error.dimension, "policy");
  assert.equal(bypassBlocked.body.error.required_confirmation, true);
  assert.equal(bypassBlocked.body.error.dispatch_mode, "EMERGENCY_BYPASS");
});

test("EMERGENCY_BYPASS dispatch records bypass audit markers", async () => {
  const ticketId = await createScheduledTicket();

  const bypass = await post(
    `/tickets/${ticketId}/assignment/dispatch`,
    {
      "Idempotency-Key": nextRequestId(),
      ...actorHeaders({
        actorId: "dispatcher-story10-bypass-success",
        actorRole: "dispatcher",
        toolName: "assignment.dispatch",
        accountScope: accountId,
        siteScope: siteId,
        correlationId: "corr-story10-bypass-success",
      }),
    },
    {
      tech_id: techId,
      dispatch_mode: "EMERGENCY_BYPASS",
      dispatch_rationale: "Emergency risk escalation observed from dispatch telemetry",
      dispatch_confirmation: true,
    },
  );

  assert.equal(bypass.status, 200);
  assert.equal(bypass.body.state, "DISPATCHED");

  const timeline = await get(
    `/tickets/${ticketId}/timeline`,
    actorHeaders({
      actorId: "dispatcher-story10-bypass-success",
      actorRole: "dispatcher",
      toolName: "ticket.timeline",
      accountScope: accountId,
      siteScope: siteId,
      correlationId: "corr-story10-bypass-success-timeline",
    }),
  );
  assert.equal(timeline.status, 200);
  assert.equal(Array.isArray(timeline.body.events), true);

  const dispatchEvent = [...timeline.body.events]
    .toReversed()
    .find((event) => event.tool_name === "assignment.dispatch");
  assert.ok(dispatchEvent);
  const dispatchValidation = dispatchEvent.payload?.dispatch_validation;
  assert.ok(dispatchValidation);
  assert.equal(dispatchValidation.bypass_used, true);
  assert.equal(dispatchValidation.bypass_mode, "EMERGENCY_BYPASS");
  assert.equal(dispatchValidation.dispatch_confirmation, true);
  assert.equal(
    dispatchValidation.dispatch_rationale,
    "Emergency risk escalation observed from dispatch telemetry",
  );
});

test("technician packet uses API truth for timeline/evidence/closeout gate and surfaces evidence errors", async () => {
  const ticketId = await createInProgressTicket();

  const packet = await get(
    `/ux/technician/job-packet/${ticketId}`,
    actorHeaders({
      actorId: "tech-story10",
      actorRole: "tech",
      toolName: "tech.job_packet",
      accountScope: accountId,
      siteScope: siteId,
      correlationId: "corr-story10-packet",
    }),
  );

  assert.equal(packet.status, 200);
  assert.equal(packet.body.packet.header.ticket_id, ticketId);
  assert.equal(packet.body.packet.header.current_state, "IN_PROGRESS");
  assert.equal(Array.isArray(packet.body.packet.timeline.events), true);
  assert.ok(packet.body.packet.timeline.events.length >= 6);
  assert.equal(Array.isArray(packet.body.packet.evidence_requirements.evidence_items), true);
  assert.ok(packet.body.packet.evidence_requirements.evidence_items.length >= 1);

  const requiredEvidenceKeys = packet.body.packet.evidence_requirements.required_evidence.map(
    (entry) => entry.key,
  );
  assert.ok(requiredEvidenceKeys.includes("signature_or_no_signature_reason"));

  assert.equal(packet.body.packet.closeout_gate.ready, false);
  assert.equal(packet.body.packet.closeout_gate.code, "MISSING_SIGNATURE_CONFIRMATION");

  const completeWorkAction = packet.body.packet.actions.find(
    (action) => action.action_id === "complete_work",
  );
  assert.ok(completeWorkAction);
  assertActionMapsToPolicy(completeWorkAction, ticketId);
  assert.equal(completeWorkAction.enabled, false);
  assert.equal(completeWorkAction.policy_error.code, "CLOSEOUT_REQUIREMENTS_INCOMPLETE");
  assert.equal(completeWorkAction.policy_error.dimension, "evidence");
  assert.equal(completeWorkAction.policy_error.requirement_code, "MISSING_SIGNATURE_CONFIRMATION");

  const candidateAction = packet.body.packet.actions.find(
    (action) => action.action_id === "candidate",
  );
  assert.ok(candidateAction);
  assertActionMapsToPolicy(candidateAction, ticketId);
  assert.equal(candidateAction.enabled, false);
  assert.equal(candidateAction.policy_error.code, "CLOSEOUT_REQUIREMENTS_INCOMPLETE");
  assert.equal(candidateAction.policy_error.dimension, "evidence");
  assert.equal(candidateAction.policy_error.requirement_code, "MISSING_SIGNATURE_CONFIRMATION");

  const requestChangeAction = packet.body.packet.actions.find(
    (action) => action.action_id === "request_change",
  );
  assert.ok(requestChangeAction);
  assert.equal(requestChangeAction.enabled, true);
});

test("technician packet enforces scope fail closed with policy dimension", async () => {
  const ticketId = await createInProgressTicket();

  const blocked = await get(
    `/ux/technician/job-packet/${ticketId}`,
    actorHeaders({
      actorId: "tech-story10",
      actorRole: "tech",
      toolName: "tech.job_packet",
      accountScope: outOfScopeAccountId,
      siteScope: outOfScopeSiteId,
      correlationId: "corr-story10-scope-blocked",
    }),
  );

  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, "FORBIDDEN_SCOPE");
  assert.equal(blocked.body.error.policy_error.dimension, "scope");
});
