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

const postgresContainer = "rd-story12-autonomy-rollout-controls";
const postgresPort = 55450;
const dispatchApiPort = 18100;
const baseUrl = `http://127.0.0.1:${dispatchApiPort}`;

const accountId = "00000000-0000-0000-0000-000000000331";
const siteId = "00000000-0000-0000-0000-000000000332";
const techId = "00000000-0000-0000-0000-000000000333";

let app;
let requestCounter = 1;

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
  const suffix = String(requestCounter).padStart(12, "0");
  requestCounter += 1;
  return `12000000-0000-4000-8000-${suffix}`;
}

function readJson(raw) {
  if (!raw || raw.trim() === "") {
    return null;
  }
  return JSON.parse(raw);
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
    body: readJson(bodyText),
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
    body: readJson(bodyText),
  };
}

function actorHeaders({
  actorId,
  actorRole,
  toolName,
  requestId,
  correlationId,
  accountScope = accountId,
  siteScope = siteId,
  includeIdempotency = true,
}) {
  const headers = {
    "X-Actor-Id": actorId,
    "X-Actor-Role": actorRole,
    ...(toolName != null ? { "X-Tool-Name": toolName } : {}),
    ...(correlationId != null ? { "X-Correlation-Id": correlationId } : {}),
    ...(accountScope != null ? { "X-Account-Scope": accountScope } : {}),
    ...(siteScope != null ? { "X-Site-Scope": siteScope } : {}),
  };

  if (includeIdempotency) {
    headers["Idempotency-Key"] = requestId ?? nextRequestId();
  }

  return headers;
}

function defaultChecklistStatus() {
  return {
    work_performed: true,
    parts_used_or_needed: true,
    resolution_status: true,
    onsite_photos_after: true,
    billing_authorization: true,
  };
}

async function createInProgressTicket(incidentType, summary) {
  const create = await post(
    "/tickets",
    actorHeaders({
      actorId: "dispatcher-story12",
      actorRole: "dispatcher",
      toolName: "ticket.create",
      requestId: nextRequestId(),
      correlationId: `corr-story12-create-${requestCounter}`,
    }),
    {
      account_id: accountId,
      site_id: siteId,
      summary,
    },
  );
  assert.equal(create.status, 201);
  const ticketId = create.body.id;

  const triage = await post(
    `/tickets/${ticketId}/triage`,
    actorHeaders({
      actorId: "dispatcher-story12",
      actorRole: "dispatcher",
      toolName: "ticket.triage",
      requestId: nextRequestId(),
      correlationId: `corr-story12-triage-${ticketId}`,
    }),
    {
      priority: "URGENT",
      incident_type: incidentType,
    },
  );
  assert.equal(triage.status, 200);

  const dispatch = await post(
    `/tickets/${ticketId}/assignment/dispatch`,
    actorHeaders({
      actorId: "dispatcher-story12",
      actorRole: "dispatcher",
      toolName: "assignment.dispatch",
      requestId: nextRequestId(),
      correlationId: `corr-story12-dispatch-${ticketId}`,
    }),
    {
      tech_id: techId,
      dispatch_mode: "STANDARD",
    },
  );
  assert.equal(dispatch.status, 200);

  const checkIn = await post(
    `/tickets/${ticketId}/tech/check-in`,
    actorHeaders({
      actorId: "tech-story12",
      actorRole: "tech",
      toolName: "tech.check_in",
      requestId: nextRequestId(),
      correlationId: `corr-story12-checkin-${ticketId}`,
    }),
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

  return ticketId;
}

async function addEvidence(ticketId, evidenceKey, index) {
  return post(
    `/tickets/${ticketId}/evidence`,
    actorHeaders({
      actorId: "tech-story12",
      actorRole: "tech",
      toolName: "closeout.add_evidence",
      requestId: nextRequestId(),
      correlationId: `corr-story12-evidence-${ticketId}-${index}`,
    }),
    {
      kind: "PHOTO",
      uri: `s3://dispatch-story12/${ticketId}/${index}.jpg`,
      metadata: {
        evidence_key: evidenceKey,
        source: "story_12_test",
      },
    },
  );
}

async function candidate(ticketId, checklistStatus, options = {}) {
  return post(
    `/tickets/${ticketId}/closeout/candidate`,
    actorHeaders({
      actorId: "tech-story12",
      actorRole: "tech",
      toolName: "closeout.candidate",
      requestId: nextRequestId(),
      correlationId: `corr-story12-candidate-${ticketId}`,
    }),
    {
      checklist_status: checklistStatus,
      ...(typeof options.no_signature_reason === "string" &&
      options.no_signature_reason.trim() !== ""
        ? { no_signature_reason: options.no_signature_reason.trim() }
        : {}),
    },
  );
}

function getTicketState(ticketId) {
  return psql(`SELECT state FROM tickets WHERE id = '${ticketId}';`);
}

function getAutonomyReplay(ticketId) {
  const raw = psql(`
    SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb)
    FROM (
      SELECT
        scope_type,
        incident_type,
        ticket_id,
        action,
        previous_is_paused,
        next_is_paused,
        reason,
        created_at
      FROM autonomy_control_history
      WHERE scope_type = 'GLOBAL'
        OR (scope_type = 'INCIDENT' AND incident_type = 'DOOR_WONT_LATCH')
        OR ticket_id = '${ticketId}'
      ORDER BY created_at DESC, id DESC
    ) t
  `);
  return JSON.parse(raw);
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
    VALUES ('${accountId}', 'Story 12 Autonomy Control Account');
  `);
  psql(`
    INSERT INTO sites (
      id,
      account_id,
      name,
      address1,
      city,
      region,
      postal_code,
      access_instructions
    )
    VALUES (
      '${siteId}',
      '${accountId}',
      'Story 12 Site',
      '12 Main St',
      'Springfield',
      'CA',
      '94016',
      'Codeword from dispatcher'
    );
  `);
  psql(`
    INSERT INTO contacts (site_id, account_id, name, phone, role, is_authorized_requester)
    VALUES ('${siteId}', '${accountId}', 'Alex Dispatcher', '555-0131', 'onsite_contact', true);
  `);
  psql(
    buildTechnicianSeedSql([
      {
        id: techId,
        name: "Story 12 Dispatch Tech",
        skills: ["DOOR_WONT_LATCH", "DEFAULT"],
        regions: ["CA"],
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

test("story 12 autonomy controls block closeout until rollback", async () => {
  const ticketId = await createInProgressTicket("DOOR_WONT_LATCH", "GLZ-12 blocked closeout");

  const pauseResponse = await post(
    "/ops/autonomy/pause",
    actorHeaders({
      actorId: "dispatcher-story12-ops",
      actorRole: "dispatcher",
      toolName: "ops.autonomy.pause",
      requestId: nextRequestId(),
      correlationId: `corr-story12-pause-${ticketId}`,
    }),
    {
      scope_type: "INCIDENT",
      incident_type: "DOOR_WONT_LATCH",
      reason: "GLZ-12 incident-level pause validation",
    },
  );
  assert.equal(pauseResponse.status, 200);
  assert.equal(pauseResponse.body.action, "pause");
  assert.equal(pauseResponse.body.current_is_paused, true);

  const stateResponse = await get(
    `/ops/autonomy/state?ticket_id=${encodeURIComponent(ticketId)}&incident_type=DOOR_WONT_LATCH`,
    actorHeaders({
      actorId: "dispatcher-story12-ops",
      actorRole: "dispatcher",
      toolName: "ops.autonomy.state",
      includeIdempotency: false,
    }),
  );
  assert.equal(stateResponse.status, 200);
  assert.equal(stateResponse.body.decision.scope_type, "INCIDENT");
  assert.equal(stateResponse.body.decision.is_paused, true);
  assert.equal(stateResponse.body.decision.incident_type, "DOOR_WONT_LATCH");

  const evidenceResult = await Promise.all([
    addEvidence(ticketId, "photo_before_door_edge_and_strike", 1),
    addEvidence(ticketId, "photo_after_latched_alignment", 2),
    addEvidence(ticketId, "note_adjustments_and_test_cycles", 3),
  ]);
  for (const entry of evidenceResult) {
    assert.equal(entry.status, 201);
  }

  const candidateResponse = await candidate(ticketId, defaultChecklistStatus(), {
    no_signature_reason: "Customer unable to sign on site.",
  });
  assert.equal(candidateResponse.status, 409);
  assert.equal(candidateResponse.body.error.code, "AUTONOMY_DISABLED");
  assert.equal(candidateResponse.body.error.scope_type, "INCIDENT");
  assert.equal(candidateResponse.body.error.scope_id, "DOOR_WONT_LATCH");

  const replayResponse = await get(
    `/ops/autonomy/replay/${ticketId}`,
    actorHeaders({
      actorId: "dispatcher-story12-ops",
      actorRole: "dispatcher",
      toolName: "ops.autonomy.replay",
      includeIdempotency: false,
    }),
  );
  assert.equal(replayResponse.status, 200);
  assert.equal(replayResponse.body.ticket_id, ticketId);
  assert.equal(replayResponse.body.decision.scope_type, "INCIDENT");
  assert.ok(Array.isArray(replayResponse.body.history));
  assert.ok(replayResponse.body.history.length >= 1);
  assert.equal(replayResponse.body.history[0].action, "pause");
});

test("story 12 rollback to manual mode restores technician completion path", async () => {
  const ticketId = await createInProgressTicket(
    "DOOR_WONT_LATCH",
    "GLZ-12 rollback resumes closeout",
  );

  const ticketPause = await post(
    "/ops/autonomy/pause",
    actorHeaders({
      actorId: "dispatcher-story12-ops",
      actorRole: "dispatcher",
      toolName: "ops.autonomy.pause",
      requestId: nextRequestId(),
      correlationId: `corr-story12-ticket-pause-${ticketId}`,
    }),
    {
      scope_type: "TICKET",
      ticket_id: ticketId,
      reason: "Per-ticket safety hold",
    },
  );
  assert.equal(ticketPause.status, 200);

  const pausedState = await get(
    `/ops/autonomy/state?ticket_id=${ticketId}`,
    actorHeaders({
      actorId: "dispatcher-story12-ops",
      actorRole: "dispatcher",
      toolName: "ops.autonomy.state",
      includeIdempotency: false,
    }),
  );
  assert.equal(pausedState.status, 200);
  assert.equal(pausedState.body.decision.scope_type, "TICKET");
  assert.equal(pausedState.body.decision.ticket_id, ticketId);
  assert.equal(pausedState.body.decision.is_paused, true);

  const rollbackResponse = await post(
    "/ops/autonomy/rollback",
    actorHeaders({
      actorId: "dispatcher-story12-ops",
      actorRole: "dispatcher",
      toolName: "ops.autonomy.rollback",
      requestId: nextRequestId(),
      correlationId: `corr-story12-ticket-rollback-${ticketId}`,
    }),
    {
      scope_type: "TICKET",
      ticket_id: ticketId,
      reason: "Autonomy resumed for this ticket",
    },
  );
  assert.equal(rollbackResponse.status, 200);
  assert.equal(rollbackResponse.body.action, "rollback");
  assert.equal(rollbackResponse.body.current_is_paused, false);

  const resumedState = await get(
    `/ops/autonomy/state?ticket_id=${ticketId}`,
    actorHeaders({
      actorId: "dispatcher-story12-ops",
      actorRole: "dispatcher",
      toolName: "ops.autonomy.state",
      includeIdempotency: false,
    }),
  );
  assert.equal(resumedState.status, 200);
  assert.equal(resumedState.body.decision.scope_type, "TICKET");
  assert.equal(resumedState.body.decision.is_paused, false);

  const evidenceResult = await Promise.all([
    addEvidence(ticketId, "photo_before_door_edge_and_strike", 11),
    addEvidence(ticketId, "photo_after_latched_alignment", 12),
    addEvidence(ticketId, "note_adjustments_and_test_cycles", 13),
  ]);
  for (const entry of evidenceResult) {
    assert.equal(entry.status, 201);
  }

  const candidateResponse = await candidate(ticketId, defaultChecklistStatus(), {
    no_signature_reason: "Customer accepted temporary workaround.",
  });
  assert.equal(candidateResponse.status, 200);
  assert.equal(candidateResponse.body.state, "COMPLETED_PENDING_VERIFICATION");
  assert.equal(getTicketState(ticketId), "COMPLETED_PENDING_VERIFICATION");

  const replay = getAutonomyReplay(ticketId);
  assert.ok(Array.isArray(replay));
  assert.ok(replay.length >= 2);
  assert.equal(replay[0].action, "rollback");
  assert.equal(replay[0].next_is_paused, false);
  assert.equal(replay[1].action, "pause");
  assert.equal(replay[1].scope_type, "TICKET");

  const latestReplayResponse = await get(
    `/ops/autonomy/replay/${ticketId}`,
    actorHeaders({
      actorId: "dispatcher-story12-ops",
      actorRole: "dispatcher",
      toolName: "ops.autonomy.replay",
      includeIdempotency: false,
    }),
  );
  assert.equal(latestReplayResponse.status, 200);
  assert.equal(latestReplayResponse.body.ticket_id, ticketId);
  assert.equal(latestReplayResponse.body.incident_type, "DOOR_WONT_LATCH");
  assert.equal(latestReplayResponse.body.decision.scope_type, "TICKET");
  assert.equal(latestReplayResponse.body.decision.is_paused, false);
  assert.ok(Array.isArray(latestReplayResponse.body.history));
  assert.ok(latestReplayResponse.body.history.length >= 2);
  assert.equal(latestReplayResponse.body.history[0].action, "rollback");
});

test("story 12 unauthorized role cannot operate autonomy controls", async () => {
  const response = await post(
    "/ops/autonomy/pause",
    actorHeaders({
      actorId: "tech-story12",
      actorRole: "tech",
      toolName: "ops.autonomy.pause",
      requestId: nextRequestId(),
      correlationId: "corr-story12-unauthorized",
    }),
    {
      scope_type: "GLOBAL",
      reason: "Unauthorized test",
    },
  );
  assert.equal(response.status, 403);
  assert.ok(
    response.body?.error?.code === "FORBIDDEN" || response.body?.error?.code === "TOOL_NOT_ALLOWED",
  );
});
