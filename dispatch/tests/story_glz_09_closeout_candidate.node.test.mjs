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

const postgresContainer = "rd-story09-closeout-candidate-test";
const postgresPort = 55449;
const dispatchApiPort = 18099;
const baseUrl = `http://127.0.0.1:${dispatchApiPort}`;

const accountId = "00000000-0000-0000-0000-000000000181";
const siteId = "00000000-0000-0000-0000-000000000182";
const techId = "00000000-0000-0000-0000-000000000183";

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
  return `98000000-0000-4000-8000-${suffix}`;
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

function actorHeaders({
  actorId,
  actorRole = "tech",
  toolName,
  requestId,
  correlationId,
  accountScope = accountId,
  siteScope = siteId,
}) {
  return {
    "Idempotency-Key": requestId ?? nextRequestId(),
    "X-Actor-Id": actorId,
    "X-Actor-Role": actorRole,
    ...(toolName != null ? { "X-Tool-Name": toolName } : {}),
    ...(correlationId != null ? { "X-Correlation-Id": correlationId } : {}),
    ...(accountScope != null ? { "X-Account-Scope": accountScope } : {}),
    ...(siteScope != null ? { "X-Site-Scope": siteScope } : {}),
  };
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
      actorId: "dispatcher-story09",
      actorRole: "dispatcher",
      toolName: "ticket.create",
      requestId: nextRequestId(),
      correlationId: `corr-story09-create-${requestCounter}`,
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
      actorId: "dispatcher-story09",
      actorRole: "dispatcher",
      toolName: "ticket.triage",
      requestId: nextRequestId(),
      correlationId: `corr-story09-triage-${ticketId}`,
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
      actorId: "dispatcher-story09",
      actorRole: "dispatcher",
      toolName: "assignment.dispatch",
      requestId: nextRequestId(),
      correlationId: `corr-story09-dispatch-${ticketId}`,
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
      actorId: "tech-story09",
      actorRole: "tech",
      toolName: "tech.check_in",
      requestId: nextRequestId(),
      correlationId: `corr-story09-checkin-${ticketId}`,
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
      actorId: "tech-story09",
      actorRole: "tech",
      toolName: "closeout.add_evidence",
      requestId: nextRequestId(),
      correlationId: `corr-story09-evidence-${ticketId}-${index}`,
    }),
    {
      kind: "PHOTO",
      uri: `s3://dispatch-story09/${ticketId}/${index}.jpg`,
      metadata: {
        evidence_key: evidenceKey,
        source: "story_09_test",
      },
    },
  );
}

async function candidate(ticketId, checklistStatus, options = {}) {
  const payload = {
    checklist_status: checklistStatus,
    ...(typeof options.no_signature_reason === "string" && options.no_signature_reason.trim() !== ""
      ? { no_signature_reason: options.no_signature_reason.trim() }
      : {}),
    ...(Array.isArray(options.evidence_refs) ? { evidence_refs: options.evidence_refs } : {}),
  };

  return post(
    `/tickets/${ticketId}/closeout/candidate`,
    actorHeaders({
      actorId: "tech-story09",
      actorRole: "tech",
      toolName: "closeout.candidate",
      requestId: nextRequestId(),
      correlationId: `corr-story09-candidate-${ticketId}`,
    }),
    payload,
  );
}

function getTicketState(ticketId) {
  return psql(`SELECT state FROM tickets WHERE id = '${ticketId}';`);
}

function getTransitionCount(ticketId) {
  return Number(
    psql(`
      SELECT count(*)
      FROM ticket_state_transitions
      WHERE ticket_id = '${ticketId}'
        AND from_state = 'IN_PROGRESS'
        AND to_state = 'COMPLETED_PENDING_VERIFICATION';
    `),
  );
}

function getCandidateRiskProfileLevel(ticketId) {
  const value = psql(`
    SELECT payload->'risk_profile'->>'level'
    FROM audit_events
    WHERE ticket_id = '${ticketId}'
      AND tool_name = 'closeout.candidate'
    ORDER BY created_at DESC, id DESC
    LIMIT 1;
  `);
  return value === "" ? null : value;
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
    VALUES ('${accountId}', 'Story 09 Closeout Candidate Account');
  `);
  psql(`
    INSERT INTO sites (id, account_id, name, address1, city, region, postal_code, access_instructions)
    VALUES (
      '${siteId}',
      '${accountId}',
      'Story 09 Site',
      '9 Main St',
      'Springfield',
      'CA',
      '94016',
      'Rear gate code 4472'
    );
  `);
  psql(`
    INSERT INTO contacts (site_id, account_id, name, phone, role, is_authorized_requester)
    VALUES ('${siteId}', '${accountId}', 'Alex Dispatcher', '555-0109', 'onsite_contact', true);
  `);
  psql(
    buildTechnicianSeedSql([
      {
        id: techId,
        name: "Story 09 Closeout Tech",
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

test("story 09 closeout candidate succeeds for low-risk closed-out job", async () => {
  const ticketId = await createInProgressTicket("DOOR_WONT_LATCH", "GLZ-09 low-risk candidate");

  const evidenceResult = await Promise.all([
    addEvidence(ticketId, "photo_before_door_edge_and_strike", 1),
    addEvidence(ticketId, "photo_after_latched_alignment", 2),
    addEvidence(ticketId, "note_adjustments_and_test_cycles", 3),
  ]);
  assert.equal(evidenceResult[0].status, 201);
  assert.equal(evidenceResult[1].status, 201);
  assert.equal(evidenceResult[2].status, 201);

  const response = await candidate(ticketId, defaultChecklistStatus(), {
    no_signature_reason: "Customer could not sign at closeout time.",
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.id, ticketId);
  assert.equal(response.body.state, "COMPLETED_PENDING_VERIFICATION");
  assert.equal(getTicketState(ticketId), "COMPLETED_PENDING_VERIFICATION");
  assert.equal(getTransitionCount(ticketId), 1);
  assert.equal(getCandidateRiskProfileLevel(ticketId), "low");
});

test("story 09 closeout candidate enforces manual review for high-risk incidents", async () => {
  const ticketId = await createInProgressTicket(
    "CANNOT_SECURE_ENTRY",
    "GLZ-09 high-risk candidate",
  );

  const evidenceResult = await Promise.all([
    addEvidence(ticketId, "photo_before_security_risk", 11),
    addEvidence(ticketId, "photo_after_temporary_or_permanent_securement", 12),
    addEvidence(ticketId, "note_risk_mitigation_and_customer_handoff", 13),
  ]);
  assert.equal(evidenceResult[0].status, 201);
  assert.equal(evidenceResult[1].status, 201);
  assert.equal(evidenceResult[2].status, 201);

  const response = await candidate(ticketId, defaultChecklistStatus(), {
    no_signature_reason: "Customer unable to sign due to remote lockout lock procedure.",
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "MANUAL_REVIEW_REQUIRED");
  assert.equal(response.body.error.requirement_code, "AUTOMATION_RISK_BLOCK");
  assert.equal(response.body.error.risk_profile.level, "high");
  assert.ok(Array.isArray(response.body.error.risk_profile.reasons));
  assert.ok(response.body.error.risk_profile.reasons.length >= 1);
  assert.equal(response.body.error.risk_profile.incident_type, "CANNOT_SECURE_ENTRY");
  assert.equal(getTicketState(ticketId), "IN_PROGRESS");
  assert.equal(getTransitionCount(ticketId), 0);
  assert.equal(getCandidateRiskProfileLevel(ticketId), null);
});

test("story 09 closeout candidate returns closeout rejection for missing evidence", async () => {
  const ticketId = await createInProgressTicket("DOOR_WONT_LATCH", "GLZ-09 missing evidence");

  const firstEvidence = await addEvidence(ticketId, "photo_before_door_edge_and_strike", 21);
  assert.equal(firstEvidence.status, 201);
  const secondEvidence = await addEvidence(ticketId, "photo_after_latched_alignment", 22);
  assert.equal(secondEvidence.status, 201);

  const response = await candidate(ticketId, defaultChecklistStatus(), {
    no_signature_reason: "No customer signature required for temporary access test.",
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "CLOSEOUT_REQUIREMENTS_INCOMPLETE");
  assert.equal(response.body.error.requirement_code, "MISSING_EVIDENCE");
  assert.deepEqual(response.body.error.missing_evidence_keys, ["note_adjustments_and_test_cycles"]);
  assert.equal(getTicketState(ticketId), "IN_PROGRESS");
  assert.equal(getTransitionCount(ticketId), 0);
});
