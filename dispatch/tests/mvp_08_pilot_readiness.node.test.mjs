import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { closePool } from "../api/src/db.mjs";
import { startDispatchApi } from "../api/src/server.mjs";
import { DispatchBridgeError, isUuid, invokeDispatchAction } from "../tools-plugin/src/bridge.mjs";

const repoRoot = process.cwd();
const migrationSql = fs.readFileSync(
  path.resolve(repoRoot, "dispatch/db/migrations/001_init.sql"),
  "utf8",
);

const readinessTemplateFile = path.resolve(
  repoRoot,
  "dispatch/policy/incident_type_templates.v1.json",
);
const readinessRunbookPath = path.resolve(
  repoRoot,
  "dispatch/ops/runbooks/mvp_08_pilot_cutover_readiness.md",
);
const v0LaunchGatePacketPath = path.resolve(
  repoRoot,
  "dispatch/ops/runbooks/v0_launch_gate_evidence_packet.md",
);

const postgresContainer = "rd-story08-pilot-uat";
const postgresPort = 55443;
const dispatchApiPort = 18093;
const baseUrl = `http://127.0.0.1:${dispatchApiPort}`;

const accountId = "00000000-0000-0000-0000-000000000081";
const siteId = "00000000-0000-0000-0000-000000000082";
const techId = "00000000-0000-0000-0000-000000000083";
let requestCounter = 1;
const readinessTemplates = loadPilotTemplates(readinessTemplateFile);

let app;

function loadPilotTemplates(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const templates = Array.isArray(raw?.templates) ? raw.templates : [];

  return templates
    .filter((entry) => {
      return (
        entry &&
        typeof entry.incident_type === "string" &&
        entry.incident_type.trim() !== "" &&
        Array.isArray(entry.required_evidence_keys) &&
        entry.required_evidence_keys.length > 0 &&
        Array.isArray(entry.required_checklist_keys) &&
        entry.required_checklist_keys.length > 0
      );
    })
    .map((entry) => ({
      incident_type: entry.incident_type.trim().toUpperCase(),
      nte_cents: 75000 + Number(requestCounter),
      required_evidence_keys: [...new Set(entry.required_evidence_keys)],
      required_checklist_keys: [...new Set(entry.required_checklist_keys)],
      summary: `Pilot UAT for ${entry.incident_type.trim().toUpperCase()}`,
    }));
}

function stableSorted(values) {
  return [...new Set(values)].toSorted((left, right) => left.localeCompare(right));
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

function nextRequestId(prefix = "82000000-0000-4000-8000") {
  const id = `${prefix}-${String(requestCounter).padStart(12, "0")}`;
  requestCounter += 1;
  return id;
}

function readJson(raw) {
  if (!raw || raw.trim() === "") {
    return null;
  }
  return JSON.parse(raw);
}

function actorHeaders(params) {
  const { actorId, actorRole, toolName, correlationId } = params;

  const headers = {
    "X-Actor-Id": actorId,
    "X-Actor-Role": actorRole,
    "X-Tool-Name": toolName,
  };

  if (correlationId != null) {
    headers["X-Correlation-Id"] = correlationId;
  }

  return headers;
}

async function postJson(pathname, headers, payload) {
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

async function getJson(pathname, headers = {}) {
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

function readEvidencePayload(ticketId, evidenceKey, order) {
  if (evidenceKey === "signature_or_no_signature_reason") {
    return {
      kind: "SIGNATURE",
      uri: `s3://dispatch-pilot-uat/${ticketId}/${order}-signature.txt`,
      metadata: {
        evidence_key: evidenceKey,
        capture_method: "remote-signature",
      },
    };
  }

  if (evidenceKey.startsWith("photo_")) {
    return {
      kind: "PHOTO",
      uri: `s3://dispatch-pilot-uat/${ticketId}/${order}-${evidenceKey}.jpg`,
      metadata: {
        evidence_key: evidenceKey,
        capture_phase: "before",
      },
    };
  }

  return {
    kind: "NOTE",
    uri: `s3://dispatch-pilot-uat/${ticketId}/${order}-${evidenceKey}.txt`,
    metadata: {
      evidence_key: evidenceKey,
    },
  };
}

function buildChecklistPayload(requiredChecklistKeys) {
  const checklist_status = {};
  for (const key of requiredChecklistKeys) {
    checklist_status[key] = true;
  }
  return { checklist_status };
}

async function getTechnicianPacket(ticketId, correlationId) {
  const packet = await getJson(
    `/ux/technician/job-packet/${ticketId}`,
    actorHeaders({
      actorId: `tech-story08-${ticketId}`,
      actorRole: "tech",
      toolName: "tech.job_packet",
      correlationId,
    }),
  );
  return packet;
}

async function getDispatcherCockpit(query, correlationId) {
  const search = query == null || query === "" ? "" : `?${query}`;
  return getJson(
    `/ux/dispatcher/cockpit${search}`,
    actorHeaders({
      actorId: `dispatcher-story08-${search ? search.replace(/\W+/g, "-").replace(/^-|-$|--+/g, "") : "default"}`,
      actorRole: "dispatcher",
      toolName: "dispatcher.cockpit",
      correlationId,
    }),
  );
}

test.before(async () => {
  if (readinessTemplates.length === 0) {
    throw new Error("No valid incident templates available for MVP-08 pilot matrix");
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

  psql(`
    INSERT INTO accounts (id, name)
    VALUES
      ('${accountId}', 'MVP-08 Pilot Readiness Account');
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
    VALUES
      (
        '${siteId}',
        '${accountId}',
        'MVP-08 Pilot Site',
        '8 Pilot Drive',
        'Springfield',
        'CA',
        '94016',
        'Open front door, then call on arrival'
      );
  `);
  psql(`
    INSERT INTO contacts (
      site_id,
      account_id,
      name,
      phone,
      role,
      escalation_level,
      is_authorized_requester
    )
    VALUES (
      '${siteId}',
      '${accountId}',
      'Pilot Contact',
      '555-0198',
      'onsite_contact',
      1,
      true
    );
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

test("pilot UAT matrix executes dispatcher+technician lifecycle across top incident templates", async () => {
  const topTemplates = readinessTemplates.slice(0, 6);
  assert.ok(topTemplates.length > 0);

  const observedTemplates = [];

  for (const [index, template] of topTemplates.entries()) {
    const incidentType = template.incident_type;
    const correlationId = `corr-story08-uat-${incidentType.toLowerCase()}`;
    const requiredEvidenceKeys = stableSorted(template.required_evidence_keys);
    const requiredChecklistKeys = stableSorted(template.required_checklist_keys);

    const create = await invokeDispatchAction({
      baseUrl,
      toolName: "ticket.create",
      actorId: `dispatcher-story08-${incidentType.toLowerCase()}`,
      actorRole: "dispatcher",
      actorType: "AGENT",
      requestId: nextRequestId(),
      correlationId,
      payload: {
        account_id: accountId,
        site_id: siteId,
        summary: template.summary,
        description: `Pilot matrix execution for ${incidentType}`,
      },
    });

    assert.equal(create.status, 201);
    const ticketId = create.data.id;
    assert.ok(isUuid(ticketId));

    const triage = await invokeDispatchAction({
      baseUrl,
      toolName: "ticket.triage",
      actorId: `dispatcher-story08-${incidentType.toLowerCase()}`,
      actorRole: "dispatcher",
      actorType: "AGENT",
      requestId: nextRequestId(),
      correlationId,
      ticketId,
      payload: {
        priority: "EMERGENCY",
        incident_type: incidentType,
        nte_cents: template.nte_cents,
      },
    });
    assert.equal(triage.status, 200);
    assert.equal(triage.data.state, "TRIAGED");

    const dispatch = await invokeDispatchAction({
      baseUrl,
      toolName: "assignment.dispatch",
      actorId: `dispatcher-story08-${incidentType.toLowerCase()}`,
      actorRole: "dispatcher",
      actorType: "AGENT",
      requestId: nextRequestId(),
      correlationId,
      ticketId,
      payload: {
        tech_id: techId,
        dispatch_mode: "EMERGENCY_BYPASS",
      },
    });
    assert.equal(dispatch.status, 200);
    assert.equal(dispatch.data.state, "DISPATCHED");

    const checkIn = await invokeDispatchAction({
      baseUrl,
      toolName: "tech.check_in",
      actorId: `tech-story08-${incidentType.toLowerCase()}`,
      actorRole: "tech",
      actorType: "AGENT",
      requestId: nextRequestId(),
      correlationId,
      ticketId,
      payload: {
        timestamp: `2026-02-15T${String(index + 11).padStart(2, "0")}:20:00.000Z`,
        location: {
          lat: 37.7749,
          lon: -122.4194,
        },
      },
    });
    assert.equal(checkIn.status, 200);
    assert.equal(checkIn.data.state, "IN_PROGRESS");

    const packetBefore = await getTechnicianPacket(ticketId, correlationId);
    assert.equal(packetBefore.status, 200);
    assert.equal(packetBefore.body.packet.header.current_state, "IN_PROGRESS");
    assert.equal(packetBefore.body.packet.header.incident_type, incidentType);

    const requiredFromPacket = packetBefore.body.packet.evidence_requirements.required_evidence
      .map((entry) => entry.key)
      .toSorted((left, right) => left.localeCompare(right));
    assert.deepEqual(requiredFromPacket, requiredEvidenceKeys);

    const closeoutItems = packetBefore.body.packet.checklist.required_items;
    const requiredChecklistFromPacket = closeoutItems
      .map((entry) => entry.key)
      .toSorted((left, right) => left.localeCompare(right));
    assert.deepEqual(requiredChecklistFromPacket, requiredChecklistKeys);

    assert.equal(packetBefore.body.packet.closeout_gate.ready, false);
    assert.equal(packetBefore.body.packet.closeout_gate.code, "MISSING_SIGNATURE_CONFIRMATION");
    assert.deepEqual(packetBefore.body.packet.closeout_gate.missing_evidence_keys, [
      "signature_or_no_signature_reason",
    ]);

    await assert.rejects(
      invokeDispatchAction({
        baseUrl,
        toolName: "tech.complete",
        actorId: `tech-story08-${incidentType.toLowerCase()}`,
        actorRole: "tech",
        actorType: "AGENT",
        requestId: nextRequestId(),
        correlationId,
        ticketId,
        payload: buildChecklistPayload(requiredChecklistKeys),
      }),
      (error) => {
        assert.ok(error instanceof DispatchBridgeError);
        assert.equal(error.status, 409);
        assert.equal(error.code, "DISPATCH_API_ERROR");
        assert.equal(error.details.dispatch_error.error.code, "CLOSEOUT_REQUIREMENTS_INCOMPLETE");
        assert.equal(
          error.details.dispatch_error.error.requirement_code,
          "MISSING_SIGNATURE_CONFIRMATION",
        );
        assert.deepEqual(error.details.dispatch_error.error.missing_evidence_keys, [
          "signature_or_no_signature_reason",
        ]);
        return true;
      },
    );

    const evidenceEntries = [...requiredEvidenceKeys];
    const noSignatureTemplatePath = requiredEvidenceKeys.includes(
      "signature_or_no_signature_reason",
    );

    const nonSignatureEvidence = evidenceEntries.filter(
      (entry) => entry !== "signature_or_no_signature_reason",
    );
    for (const [evidenceIndex, evidenceKey] of nonSignatureEvidence.entries()) {
      const evidenceResponse = await invokeDispatchAction({
        baseUrl,
        toolName: "closeout.add_evidence",
        actorId: `tech-story08-${incidentType.toLowerCase()}`,
        actorRole: "tech",
        actorType: "AGENT",
        requestId: nextRequestId(),
        correlationId,
        ticketId,
        payload: readEvidencePayload(
          ticketId,
          evidenceKey,
          `${incidentType.toLowerCase()}-${String(evidenceIndex).padStart(2, "0")}`,
        ),
      });
      assert.equal(evidenceResponse.status, 201);
      assert.equal(evidenceResponse.data.ticket_id, ticketId);
    }

    const finalPacketRequest = buildChecklistPayload(requiredChecklistKeys);
    const finalPayload = {
      ...finalPacketRequest,
    };

    if (index % 2 === 0) {
      // Alternate with explicit no-signature reason on even rows to verify no-signature path.
      finalPayload.no_signature_reason = "Customer declined signature capture";
    } else {
      const signatureEvidence = await invokeDispatchAction({
        baseUrl,
        toolName: "closeout.add_evidence",
        actorId: `tech-story08-${incidentType.toLowerCase()}`,
        actorRole: "tech",
        actorType: "AGENT",
        requestId: nextRequestId(),
        correlationId,
        ticketId,
        payload: readEvidencePayload(
          ticketId,
          "signature_or_no_signature_reason",
          `${incidentType.toLowerCase()}-signature`,
        ),
      });
      assert.equal(signatureEvidence.status, 201);
    }

    const complete = await invokeDispatchAction({
      baseUrl,
      toolName: "tech.complete",
      actorId: `tech-story08-${incidentType.toLowerCase()}`,
      actorRole: "tech",
      actorType: "AGENT",
      requestId: nextRequestId(),
      correlationId,
      ticketId,
      payload: finalPayload,
    });
    assert.equal(complete.status, 200);
    assert.equal(complete.data.state, "COMPLETED_PENDING_VERIFICATION");

    const verify = await invokeDispatchAction({
      baseUrl,
      toolName: "qa.verify",
      actorId: `qa-story08-${incidentType.toLowerCase()}`,
      actorRole: "qa",
      actorType: "AGENT",
      requestId: nextRequestId(),
      correlationId,
      ticketId,
      payload: {
        timestamp: `2026-02-15T${String(index + 12).padStart(2, "0")}:35:00.000Z`,
        result: "PASS",
        notes: `Pilot QA verification for ${incidentType}`,
      },
    });
    assert.equal(verify.status, 200);
    assert.equal(verify.data.state, "VERIFIED");

    const invoice = await invokeDispatchAction({
      baseUrl,
      toolName: "billing.generate_invoice",
      actorId: `finance-story08-${incidentType.toLowerCase()}`,
      actorRole: "finance",
      actorType: "AGENT",
      requestId: nextRequestId(),
      correlationId,
      ticketId,
      payload: {},
    });
    assert.equal(invoice.status, 200);
    assert.equal(invoice.data.state, "INVOICED");

    const packetAfter = await getTechnicianPacket(ticketId, correlationId);
    assert.equal(packetAfter.status, 200);
    assert.equal(packetAfter.body.packet.closeout_gate.ready, true);
    assert.equal(packetAfter.body.packet.closeout_gate.code, "READY");

    const cockpit = await getDispatcherCockpit(
      `state=INVOICED&ticket_id=${ticketId}&account_id=${accountId}&site_id=${siteId}`,
      correlationId,
    );
    assert.equal(cockpit.status, 200);
    assert.equal(Array.isArray(cockpit.body.queue), true);

    const queueRow = cockpit.body.queue.find((entry) => entry.ticket_id === ticketId);
    assert.ok(queueRow, `ticket ${ticketId} must be visible on cockpit queue`);
    assert.equal(queueRow.state, "INVOICED");
    const openPacketAction = queueRow.actions.find(
      (action) => action.action_id === "open_technician_packet",
    );
    assert.ok(openPacketAction);
    assert.equal(openPacketAction.enabled, true);

    const timeline = await invokeDispatchAction({
      baseUrl,
      toolName: "ticket.timeline",
      actorId: `dispatcher-story08-${incidentType.toLowerCase()}`,
      actorRole: "dispatcher",
      actorType: "AGENT",
      correlationId,
      ticketId,
    });
    assert.equal(timeline.status, 200);
    assert.equal(timeline.data.ticket_id, ticketId);
    assert.ok(Array.isArray(timeline.data.events));
    assert.ok(timeline.data.events.length >= 8);

    const lastEvent = timeline.data.events.at(-1);
    assert.equal(lastEvent.tool_name, "billing.generate_invoice");

    observedTemplates.push({
      incidentType,
      ticketId,
      state: queueRow.state,
      packetReady: packetAfter.body.packet.closeout_gate.ready,
      usedNoSignature: index % 2 === 0,
      evidenceCount: packetAfter.body.packet.evidence_requirements.evidence_items.length,
      timelineCount: timeline.data.events.length,
      signatureExpected: noSignatureTemplatePath,
    });
  }

  assert.ok(observedTemplates.length >= 1);
  assert.ok(observedTemplates.every((entry) => entry.packetReady));
});

test("pilot readiness runbook and checklist artifacts are published and explicit", () => {
  assert.ok(fs.existsSync(readinessRunbookPath), "pilot cutover readiness runbook should exist");
  const content = fs.readFileSync(readinessRunbookPath, "utf8");

  assert.ok(content.trim().length > 0);
  assert.match(content, /Pilot UAT Matrix/i);
  assert.match(content, /Go\/(No-)?Go Gates/i);
  assert.match(content, /Rollback Rehearsal/i);
  assert.match(content, /Release Candidate Freeze/i);
  assert.match(content, /dispatcher\/technician lifecycle/i);
  assert.match(content, /top incident templates/i);
});

test("V0 launch gate evidence packet is published and references required controls", () => {
  assert.ok(fs.existsSync(v0LaunchGatePacketPath), "V0 launch gate evidence packet should exist");
  const content = fs.readFileSync(v0LaunchGatePacketPath, "utf8");

  assert.ok(content.trim().length > 0);
  assert.match(content, /V0-LAUNCH-GATE/i);
  assert.match(content, /GLZ-10|GLZ-11|GLZ-12/i);
  assert.match(content, /autonomy/);
  assert.match(content, /pilot readiness/i);
  assert.ok(content.includes("dispatch/tests/mvp_08_pilot_readiness.node.test.mjs"));
  assert.ok(
    content.includes("dispatch/tests/story_glz_12_autonomy_rollout_controls.node.test.mjs"),
  );
  assert.ok(content.toLowerCase().includes("dispatcher/technician lifecycle"));
});
