import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { closePool } from "../api/src/db.mjs";
import { startDispatchApi } from "../api/src/server.mjs";
import { DISPATCH_CONTRACT, MUTATING_TOOLS } from "../contracts/dispatch-contract.v1.ts";
import { makeTestToken } from "./helpers/auth-test-token.mjs";

const repoRoot = process.cwd();
const migrationSql = fs.readFileSync(
  path.resolve(repoRoot, "dispatch/db/migrations/001_init.sql"),
  "utf8",
);

const postgresContainer = "rd-mutation-integrity-test";
const postgresPort = 55439;
const dispatchApiPort = 18189;
const baseUrl = `http://127.0.0.1:${dispatchApiPort}`;
const accountId = "00000000-0000-0000-0000-000000000001";
const siteId = "00000000-0000-0000-0000-000000000010";
const techId = "00000000-0000-0000-0000-000000000099";
const authJwtSecret = process.env.DISPATCH_AUTH_JWT_SECRET || "dispatch-mutation-integrity-secret";
const authJwtIssuer = process.env.DISPATCH_AUTH_JWT_ISSUER || "";
const authJwtAudience = process.env.DISPATCH_AUTH_JWT_AUDIENCE || "";

const CLOSEOUT_TEMPLATE = "DOOR_WONT_LATCH";
const CLOSEOUT_EVIDENCE_KEYS = [
  "photo_before_door_edge_and_strike",
  "photo_after_latched_alignment",
  "note_adjustments_and_test_cycles",
  "signature_or_no_signature_reason",
];
const CLOSEOUT_CHECKLIST_KEYS = [
  "work_performed",
  "parts_used_or_needed",
  "resolution_status",
  "onsite_photos_after",
  "billing_authorization",
];

let app;
let previousAuthEnv = {};

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

function psqlNumber(sql) {
  return Number(psql(sql) || 0);
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

function toolHeaders(toolName, options = {}) {
  const {
    actorRole = "dispatcher",
    actorId = "dispatcher-1",
    requestId = randomUUID(),
    correlationId = `corr-${randomUUID()}`,
    idempotencyKey,
  } = options;

  const headers = {
    Authorization: `Bearer ${makeTestToken({
      actor_id: actorId,
      role: actorRole,
      scope: {
        account_ids: [accountId],
        site_ids: [siteId],
      },
      secret: authJwtSecret,
      issuer: authJwtIssuer || undefined,
      audience: authJwtAudience || undefined,
    })}`,
    "X-Tool-Name": toolName,
    "X-Correlation-Id": correlationId,
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };

  return { headers, requestId, correlationId };
}

function endpointFor(toolName, ticketId) {
  const route = DISPATCH_CONTRACT[toolName].route;
  if (!route.includes("{ticketId}")) {
    return route;
  }
  if (!ticketId) {
    throw new Error(`Tool ${toolName} requires ticketId`);
  }
  return route.replace("{ticketId}", ticketId);
}

async function createTicket(seed = randomUUID()) {
  const response = await post(
    "/tickets",
    toolHeaders("ticket.create", {
      idempotencyKey: randomUUID(),
      correlationId: `seed-${seed}`,
      requestId: randomUUID(),
    }).headers,
    {
      account_id: accountId,
      site_id: siteId,
      summary: `Integrity ticket ${seed}`,
      description: "Generated for mutation integrity checks.",
      nte_cents: 10000,
    },
  );

  assert.equal(response.status, 201);
  assert.equal(response.body.state, "NEW");
  assert.ok(response.body.id);
  return response.body;
}

async function seedTicketState(ticket, targetState) {
  psql(
    `UPDATE tickets SET state = '${targetState}', version = version + 1, scheduled_start = null, scheduled_end = null, incident_type = '${CLOSEOUT_TEMPLATE}' WHERE id = '${ticket.id}';`,
  );
  return ticket;
}

async function ensureScheduledWindow(ticketId, start, end) {
  psql(
    `UPDATE tickets SET scheduled_start = '${start}', scheduled_end = '${end}' WHERE id = '${ticketId}';`,
  );
}

async function addDoorEvidence(ticketId, actorRole = "dispatcher") {
  const evidenceUrlBase = `s3://dispatch-mut-int/${ticketId}`;
  for (const [index, evidenceKey] of CLOSEOUT_EVIDENCE_KEYS.entries()) {
    const requestId = randomUUID();
    const correlationId = `evidence-${randomUUID()}`;
    const { headers } = toolHeaders("closeout.add_evidence", {
      actorRole,
      requestId,
      correlationId,
      idempotencyKey: requestId,
    });
    const response = await post(`/tickets/${ticketId}/evidence`, headers, {
      kind: `photo_${index}`,
      uri: `${evidenceUrlBase}/${index}.jpg`,
      evidence_key: evidenceKey,
      metadata: {
        evidence_key: evidenceKey,
      },
    });
    assert.equal(response.status, 201);
  }
}

async function prepareCloseoutCandidate(ticketId, actorRole = "dispatcher") {
  await addDoorEvidence(ticketId, actorRole);
  const candidate = await post(
    `/tickets/${ticketId}/closeout/candidate`,
    toolHeaders("closeout.candidate", {
      actorRole,
      requestId: randomUUID(),
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
    }).headers,
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
  assert.equal(candidate.status, 200);
  return candidate;
}

async function prepareVerifiedTicket(ticketId, actorRole = "dispatcher") {
  await prepareCloseoutCandidate(ticketId, actorRole);
  const qaVerify = await post(
    `/tickets/${ticketId}/qa/verify`,
    toolHeaders("qa.verify", {
      actorRole,
      requestId: randomUUID(),
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
    }).headers,
    {
      timestamp: "2026-02-25T17:10:00.000Z",
      result: "PASS",
    },
  );
  assert.equal(qaVerify.status, 200);
  return qaVerify;
}

async function setupForTool(toolName) {
  const setup = {
    toolName,
    actorRole: "dispatcher",
    payload: {},
    expectedTransitionCount: 0,
    expectedHttpStatus: 200,
    setupTicket: null,
    setupTeardown: async () => {},
  };

  if (toolName === "ticket.create") {
    setup.payload = {
      account_id: accountId,
      site_id: siteId,
      summary: `create for mutation ${randomUUID()}`,
      description: "Direct create mutation fixture",
      nte_cents: 4000,
    };
    setup.expectedTransitionCount = 0;
    setup.expectedHttpStatus = 201;
    return setup;
  }

  if (toolName === "ticket.blind_intake") {
    setup.payload = {
      account_id: accountId,
      site_id: siteId,
      summary: `blind intake ${randomUUID()}`,
      incident_type: "DOOR_WONT_LATCH",
      customer_name: "Intake Test",
      priority: "EMERGENCY",
      description: "Blind intake fixture",
      nte_cents: 3500,
      contact_phone: "+15551230000",
      identity_confidence: 98,
      classification_confidence: 98,
      sop_handoff_acknowledged: true,
      sop_handoff_prompt: "manual",
    };
    setup.expectedTransitionCount = 1;
    setup.expectedHttpStatus = 201;
    return setup;
  }

  const ticket = await createTicket(`seed-${toolName}`);

  switch (toolName) {
    case "ticket.triage":
      setup.setupTicket = ticket;
      setup.payload = {
        priority: "EMERGENCY",
        incident_type: "DOOR_WONT_LATCH",
        nte_cents: 5000,
      };
      setup.expectedTransitionCount = 1;
      break;

    case "schedule.propose": {
      const { headers } = toolHeaders("ticket.triage", {
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
      });
      await post(`/tickets/${ticket.id}/triage`, headers, {
        priority: "EMERGENCY",
        incident_type: "DOOR_WONT_LATCH",
        nte_cents: 2000,
        workflow_outcome: "READY_TO_SCHEDULE",
      });
      setup.setupTicket = ticket;
      setup.payload = {
        options: [
          {
            start: "2026-02-20T10:00:00.000Z",
            end: "2026-02-20T11:00:00.000Z",
          },
        ],
      };
      setup.expectedTransitionCount = 1;
      break;
    }

    case "schedule.confirm": {
      const { headers } = toolHeaders("ticket.triage", {
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
      });
      await post(`/tickets/${ticket.id}/triage`, headers, {
        priority: "EMERGENCY",
        incident_type: "DOOR_WONT_LATCH",
        nte_cents: 2500,
      });
      const triageTool = toolHeaders("schedule.propose", {
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
      });
      await post(`/tickets/${ticket.id}/schedule/propose`, triageTool.headers, {
        options: [
          {
            start: "2026-02-20T09:00:00.000Z",
            end: "2026-02-20T10:00:00.000Z",
          },
        ],
      });
      setup.setupTicket = ticket;
      psql(`UPDATE tickets SET state = 'SCHEDULE_PROPOSED' WHERE id = '${ticket.id}';`);
      setup.payload = {
        start: "2026-02-20T09:30:00.000Z",
        end: "2026-02-20T10:30:00.000Z",
      };
      setup.expectedTransitionCount = 1;
      break;
    }

    case "assignment.dispatch":
      await seedTicketState(ticket, "SCHEDULED");
      setup.setupTicket = ticket;
      setup.payload = {
        tech_id: techId,
      };
      setup.expectedTransitionCount = 1;
      break;

    case "assignment.recommend": {
      await seedTicketState(ticket, "SCHEDULED");
      await ensureScheduledWindow(
        ticket.id,
        "2026-02-21T11:00:00.000Z",
        "2026-02-21T12:00:00.000Z",
      );
      setup.setupTicket = ticket;
      setup.payload = {
        service_type: "DOOR_REPAIR_V1",
        recommendation_limit: 3,
      };
      setup.expectedTransitionCount = 0;
      setup.expectedHttpStatus = 201;
      break;
    }

    case "schedule.hold": {
      await seedTicketState(ticket, "SCHEDULED");
      await ensureScheduledWindow(
        ticket.id,
        "2026-02-21T11:00:00.000Z",
        "2026-02-21T12:00:00.000Z",
      );
      setup.setupTicket = ticket;
      setup.payload = {
        hold_reason: "CUSTOMER_PENDING",
        confirmation_window: {
          start: "2026-02-21T11:30:00.000Z",
          end: "2026-02-21T11:45:00.000Z",
        },
      };
      setup.expectedTransitionCount = 1;
      setup.expectedHttpStatus = 201;
      break;
    }

    case "schedule.release": {
      await seedTicketState(ticket, "SCHEDULED");
      await ensureScheduledWindow(
        ticket.id,
        "2026-02-22T12:00:00.000Z",
        "2026-02-22T13:00:00.000Z",
      );
      const hold = await post(
        `/tickets/${ticket.id}/schedule/hold`,
        toolHeaders("schedule.hold", {
          requestId: randomUUID(),
          correlationId: randomUUID(),
          idempotencyKey: randomUUID(),
        }).headers,
        {
          hold_reason: "CUSTOMER_PENDING",
          confirmation_window: {
            start: "2026-02-22T12:15:00.000Z",
            end: "2026-02-22T12:25:00.000Z",
          },
        },
      );
      assert.equal(hold.status, 201);
      setup.setupTicket = ticket;
      setup.payload = {
        customer_confirmation_id: hold.body.hold_id,
      };
      setup.expectedTransitionCount = 1;
      break;
    }

    case "schedule.rollback": {
      await seedTicketState(ticket, "SCHEDULED");
      await ensureScheduledWindow(
        ticket.id,
        "2026-02-23T12:00:00.000Z",
        "2026-02-23T13:00:00.000Z",
      );
      const hold = await post(
        `/tickets/${ticket.id}/schedule/hold`,
        toolHeaders("schedule.hold", {
          requestId: randomUUID(),
          correlationId: randomUUID(),
          idempotencyKey: randomUUID(),
        }).headers,
        {
          hold_reason: "CUSTOMER_PENDING",
          confirmation_window: {
            start: "2026-02-23T12:15:00.000Z",
            end: "2026-02-23T12:25:00.000Z",
          },
        },
      );
      assert.equal(hold.status, 201);
      setup.setupTicket = ticket;
      setup.payload = {
        confirmation_id: hold.body.hold_id,
        reason: "reschedule required",
      };
      setup.expectedTransitionCount = 1;
      break;
    }

    case "tech.check_in": {
      await seedTicketState(ticket, "DISPATCHED");
      setup.setupTicket = ticket;
      setup.payload = {
        timestamp: "2026-02-24T15:10:00.000Z",
        location: {},
      };
      setup.expectedTransitionCount = 2;
      break;
    }

    case "tech.request_change": {
      await seedTicketState(ticket, "IN_PROGRESS");
      setup.actorRole = "technician";
      setup.setupTicket = ticket;
      setup.payload = {
        approval_type: "NTE_INCREASE",
        reason: "Customer requested escalation",
        amount_delta_cents: 1234,
      };
      setup.expectedTransitionCount = 1;
      break;
    }

    case "approval.decide": {
      await seedTicketState(ticket, "IN_PROGRESS");
      const requestChange = await post(
        `/tickets/${ticket.id}/tech/request-change`,
        toolHeaders("tech.request_change", {
          actorRole: "technician",
          requestId: randomUUID(),
          correlationId: randomUUID(),
          idempotencyKey: randomUUID(),
        }).headers,
        {
          approval_type: "NTE_INCREASE",
          reason: "NTE uplift requested by customer",
        },
      );
      assert.equal(requestChange.status, 200);
      setup.setupTicket = ticket;
      setup.payload = {
        approval_id: requestChange.body.approval.id,
        decision: "APPROVED",
      };
      setup.expectedTransitionCount = 1;
      break;
    }

    case "closeout.add_evidence": {
      await seedTicketState(ticket, "IN_PROGRESS");
      setup.setupTicket = ticket;
      setup.payload = {
        kind: "photo",
        uri: "s3://dispatch-mut-int/closeout-note.txt",
        evidence_key: "photo_before_door_edge_and_strike",
      };
      setup.expectedTransitionCount = 0;
      setup.expectedHttpStatus = 201;
      break;
    }

    case "closeout.candidate": {
      await seedTicketState(ticket, "IN_PROGRESS");
      await addDoorEvidence(ticket.id);
      setup.setupTicket = ticket;
      setup.payload = {
        checklist_status: {
          work_performed: true,
          parts_used_or_needed: true,
          resolution_status: true,
          onsite_photos_after: true,
          billing_authorization: true,
        },
      };
      setup.expectedTransitionCount = 1;
      break;
    }

    case "tech.complete": {
      await seedTicketState(ticket, "IN_PROGRESS");
      await addDoorEvidence(ticket.id);
      setup.setupTicket = ticket;
      setup.payload = {
        checklist_status: {
          work_performed: true,
          parts_used_or_needed: true,
          resolution_status: true,
          onsite_photos_after: true,
          billing_authorization: true,
        },
      };
      setup.expectedTransitionCount = 1;
      break;
    }

    case "qa.verify": {
      await seedTicketState(ticket, "IN_PROGRESS");
      await prepareCloseoutCandidate(ticket.id);
      setup.setupTicket = { ...ticket, state: "COMPLETED_PENDING_VERIFICATION" };
      setup.payload = {
        timestamp: "2026-02-25T17:10:00.000Z",
        result: "PASS",
      };
      setup.expectedTransitionCount = 1;
      break;
    }

    case "billing.generate_invoice": {
      await seedTicketState(ticket, "VERIFIED");
      setup.setupTicket = ticket;
      setup.payload = {};
      setup.actorRole = "finance";
      setup.expectedTransitionCount = 1;
      break;
    }

    case "ticket.close": {
      await seedTicketState(ticket, "IN_PROGRESS");
      await prepareVerifiedTicket(ticket.id);
      setup.setupTicket = ticket;
      setup.setupTicket.state = "VERIFIED";
      setup.payload = {
        reason: "Customer requested closure",
      };
      setup.expectedTransitionCount = 1;
      break;
    }

    case "ticket.force_close": {
      await seedTicketState(ticket, "IN_PROGRESS");
      await prepareCloseoutCandidate(ticket.id);
      setup.setupTicket = ticket;
      setup.setupTicket.state = "COMPLETED_PENDING_VERIFICATION";
      setup.payload = {
        override_code: "FORCE",
        override_reason: "Escalation required for safety follow-up",
        approver_role: "dispatcher",
      };
      setup.expectedTransitionCount = 1;
      break;
    }

    case "ticket.cancel": {
      await seedTicketState(ticket, "NEW");
      setup.setupTicket = ticket;
      setup.payload = {
        reason: "Customer requested immediate cancellation",
      };
      setup.expectedTransitionCount = 1;
      break;
    }

    case "dispatch.force_hold": {
      await seedTicketState(ticket, "IN_PROGRESS");
      setup.setupTicket = ticket;
      setup.payload = {
        hold_reason: "CUSTOMER_PENDING",
      };
      setup.expectedTransitionCount = 1;
      break;
    }

    case "dispatch.force_unassign": {
      await seedTicketState(ticket, "IN_PROGRESS");
      setup.setupTicket = ticket;
      setup.payload = {
        reason: "Customer moved location",
      };
      setup.expectedTransitionCount = 1;
      break;
    }

    case "reopen_after_verification": {
      await seedTicketState(ticket, "INVOICED");
      setup.setupTicket = ticket;
      setup.payload = {
        reason: "Verification mismatch from customer signature",
        reopen_scope: "IN_PROGRESS",
      };
      setup.expectedTransitionCount = 1;
      break;
    }

    case "closeout.evidence_exception": {
      await seedTicketState(ticket, "IN_PROGRESS");
      setup.setupTicket = ticket;
      setup.payload = {
        exception_reason: "Pending signature documentation",
        evidence_refs: [CLOSEOUT_EVIDENCE_KEYS[0]],
        expires_at: "2026-02-27T12:00:00.000Z",
      };
      setup.expectedTransitionCount = 0;
      break;
    }

    case "dispatch.manual_bypass": {
      await seedTicketState(ticket, "IN_PROGRESS");
      setup.setupTicket = ticket;
      setup.payload = {
        bypass_rationale: "Escalation override applied",
        target_tool: "tech.complete",
      };
      setup.expectedTransitionCount = 1;
      break;
    }

    case "ops.autonomy.pause":
      setup.payload = {
        scope_type: "GLOBAL",
      };
      setup.expectedTransitionCount = 0;
      break;

    case "ops.autonomy.rollback":
      setup.payload = {
        scope_type: "GLOBAL",
      };
      setup.expectedTransitionCount = 0;
      break;

    default:
      throw new Error(`No setup fixture configured for ${toolName}`);
  }

  return setup;
}

test.before(async () => {
  previousAuthEnv = {
    DISPATCH_AUTH_ALLOW_DEV_HEADERS: process.env.DISPATCH_AUTH_ALLOW_DEV_HEADERS,
    DISPATCH_AUTH_JWT_SECRET: process.env.DISPATCH_AUTH_JWT_SECRET,
    DISPATCH_AUTH_JWT_ISSUER: process.env.DISPATCH_AUTH_JWT_ISSUER,
    DISPATCH_AUTH_JWT_AUDIENCE: process.env.DISPATCH_AUTH_JWT_AUDIENCE,
  };

  process.env.DISPATCH_AUTH_ALLOW_DEV_HEADERS = "false";
  process.env.DISPATCH_AUTH_JWT_SECRET = authJwtSecret;
  if (authJwtIssuer) {
    process.env.DISPATCH_AUTH_JWT_ISSUER = authJwtIssuer;
  } else {
    delete process.env.DISPATCH_AUTH_JWT_ISSUER;
  }
  if (authJwtAudience) {
    process.env.DISPATCH_AUTH_JWT_AUDIENCE = authJwtAudience;
  } else {
    delete process.env.DISPATCH_AUTH_JWT_AUDIENCE;
  }

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

  psql(`INSERT INTO accounts (id, name) VALUES ('${accountId}', 'Acme Facilities');`);
  psql(
    `INSERT INTO sites (id, account_id, name, address1, city) VALUES ('${siteId}', '${accountId}', 'Main Campus', '1 Main St', 'Springfield');`,
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
  if (previousAuthEnv.DISPATCH_AUTH_ALLOW_DEV_HEADERS === undefined) {
    delete process.env.DISPATCH_AUTH_ALLOW_DEV_HEADERS;
  } else {
    process.env.DISPATCH_AUTH_ALLOW_DEV_HEADERS = previousAuthEnv.DISPATCH_AUTH_ALLOW_DEV_HEADERS;
  }
  if (previousAuthEnv.DISPATCH_AUTH_JWT_SECRET === undefined) {
    delete process.env.DISPATCH_AUTH_JWT_SECRET;
  } else {
    process.env.DISPATCH_AUTH_JWT_SECRET = previousAuthEnv.DISPATCH_AUTH_JWT_SECRET;
  }
  if (previousAuthEnv.DISPATCH_AUTH_JWT_ISSUER === undefined) {
    delete process.env.DISPATCH_AUTH_JWT_ISSUER;
  } else {
    process.env.DISPATCH_AUTH_JWT_ISSUER = previousAuthEnv.DISPATCH_AUTH_JWT_ISSUER;
  }
  if (previousAuthEnv.DISPATCH_AUTH_JWT_AUDIENCE === undefined) {
    delete process.env.DISPATCH_AUTH_JWT_AUDIENCE;
  } else {
    process.env.DISPATCH_AUTH_JWT_AUDIENCE = previousAuthEnv.DISPATCH_AUTH_JWT_AUDIENCE;
  }
  spawnSync("docker", ["rm", "-f", postgresContainer], { encoding: "utf8" });
});

for (const toolName of MUTATING_TOOLS) {
  if (!DISPATCH_CONTRACT[toolName]) {
    continue;
  }

  test(`mutation integrity: ${toolName}`, async () => {
    const toolFixture = await setupForTool(toolName);
    const requestId = randomUUID();
    const correlationId = `corr-${toolName}-${randomUUID()}`;
    const ticketId = toolFixture.setupTicket ? toolFixture.setupTicket.id : null;

    const endpoint = endpointFor(toolName, ticketId);
    const noKeyHeaders = toolHeaders(toolName, {
      actorRole: toolFixture.actorRole,
      requestId,
      correlationId,
    }).headers;

    const missingKey = await post(endpoint, noKeyHeaders, toolFixture.payload);
    assert.equal(missingKey.status, 400);
    assert.equal(missingKey.body.error.code, "MISSING_IDEMPOTENCY_KEY");

    const idempotencyKey = randomUUID();
    const { headers } = toolHeaders(toolName, {
      actorRole: toolFixture.actorRole,
      requestId,
      correlationId,
      idempotencyKey,
    });

    const beforeTransitionCount = ticketId
      ? psqlNumber(`SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${ticketId}';`)
      : 0;

    const first = await post(endpoint, headers, toolFixture.payload);
    assert.equal(first.status, toolFixture.expectedHttpStatus ?? 200);

    const afterTransitionCount = ticketId
      ? psqlNumber(`SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${ticketId}';`)
      : 0;
    const transitionDelta = afterTransitionCount - beforeTransitionCount;

    assert.equal(
      transitionDelta,
      toolFixture.expectedTransitionCount,
      `expected ${toolFixture.expectedTransitionCount} transition row(s) for ${toolName}`,
    );

    const replay = await post(endpoint, headers, toolFixture.payload);
    assert.equal(replay.status, first.status);
    assert.deepEqual(replay.body, first.body);

    const afterReplayTransitionCount = ticketId
      ? psqlNumber(`SELECT count(*) FROM ticket_state_transitions WHERE ticket_id = '${ticketId}';`)
      : 0;

    assert.equal(
      afterReplayTransitionCount,
      afterTransitionCount,
      `replay should not create extra transitions for ${toolName}`,
    );

    const auditRows = psqlNumber(
      `SELECT count(*) FROM audit_events WHERE correlation_id = '${correlationId}';`,
    );
    assert.ok(auditRows >= 1);

    const idempotencyRows = psqlNumber(
      `SELECT count(*) FROM idempotency_keys WHERE request_id = '${idempotencyKey}' AND actor_id = 'dispatcher-1';`,
    );
    assert.equal(idempotencyRows, 1);
  });
}
