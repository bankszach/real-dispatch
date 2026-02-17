import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { DispatchBridgeError, invokeDispatchAction } from "../tools-plugin/src/bridge.mjs";

const DISPATCH_API_URL =
  process.env.DISPATCH_API_URL?.trim() ||
  `http://127.0.0.1:${process.env.DISPATCH_API_PORT || "8080"}`;

const DEMO_ACCOUNT_ID =
  process.env.DISPATCH_DEMO_ACCOUNT_ID || "d3f77db0-5d1a-4f9c-b0ea-111111111111";
const DEMO_SITE_ID = process.env.DISPATCH_DEMO_SITE_ID || "7f6a2b2c-8f1e-4f2b-b3a1-222222222222";
const DEMO_TECH_ID = process.env.DISPATCH_DEMO_TECH_ID || "4a0f1f70-98d0-4b39-bf5f-111111111111";

const CORRELATION_ID = process.env.DISPATCH_DEMO_CORRELATION_ID || randomUUID();

const DISPATCH_BASE_ACTION_CONTEXT = {
  baseUrl: DISPATCH_API_URL,
  requestId: null,
  correlationId: CORRELATION_ID,
};

function nextRequestId() {
  return randomUUID();
}

async function runToolAction({ toolName, actorId, actorRole, ticketId, payload, requestId }) {
  return invokeDispatchAction({
    ...DISPATCH_BASE_ACTION_CONTEXT,
    toolName,
    actorId,
    actorRole,
    actorType: "AGENT",
    requestId: requestId || nextRequestId(),
    ticketId,
    payload,
  });
}

async function getView(path, { actorId, actorRole, toolName }) {
  const response = await fetch(`${DISPATCH_API_URL}${path}`, {
    headers: {
      accept: "application/json",
      "x-correlation-id": CORRELATION_ID,
      "x-actor-id": actorId,
      "x-actor-role": actorRole,
      "x-actor-type": "AGENT",
      "x-tool-name": toolName,
    },
  });

  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : null;

  return {
    status: response.status,
    body,
  };
}

function assertSuccessCloseoutBlocked(error) {
  assert.ok(error instanceof DispatchBridgeError, "Expected bridge error for incomplete closeout");
  const closeoutError = error.details?.dispatch_error?.error;
  assert.equal(
    closeoutError?.code,
    "CLOSEOUT_REQUIREMENTS_INCOMPLETE",
    "Expected closeout gate failure code",
  );
  assert.ok(
    Array.isArray(closeoutError?.missing_evidence_keys),
    "Expected missing_evidence_keys list",
  );
  assert.ok(
    closeoutError.missing_evidence_keys.length > 0,
    "Expected at least one missing evidence key",
  );
}

async function addEvidence({ ticketId, evidenceKey, uri, kind, requestId }) {
  return runToolAction({
    toolName: "closeout.add_evidence",
    actorId: "tech-demo-smoke",
    actorRole: "tech",
    ticketId,
    requestId,
    payload: {
      kind,
      uri,
      metadata: {
        evidence_key: evidenceKey,
        source: "dispatch-demo-script",
      },
    },
  });
}

async function main() {
  console.log(`Running canonical dispatch smoke flow against ${DISPATCH_API_URL}`);

  const create = await runToolAction({
    toolName: "ticket.create",
    actorId: "dispatcher-demo",
    actorRole: "dispatcher",
    payload: {
      account_id: DEMO_ACCOUNT_ID,
      site_id: DEMO_SITE_ID,
      summary: "Dispatch demo smoke ticket",
      description: "Canonical lifecycle smoke test for demo readiness",
    },
    requestId: process.env.DISPATCH_DEMO_CREATE_REQUEST_ID || nextRequestId(),
  });

  assert.equal(create.status, 201);
  const ticketId = create.data.id;
  assert.ok(ticketId);

  const triage = await runToolAction({
    toolName: "ticket.triage",
    actorId: "dispatcher-demo",
    actorRole: "dispatcher",
    ticketId,
    requestId: process.env.DISPATCH_DEMO_TRIAGE_REQUEST_ID || nextRequestId(),
    payload: {
      priority: "EMERGENCY",
      incident_type: "CANNOT_SECURE_ENTRY",
      nte_cents: 88000,
    },
  });
  assert.equal(triage.status, 200);

  const assign = await runToolAction({
    toolName: "assignment.dispatch",
    actorId: "dispatcher-demo",
    actorRole: "dispatcher",
    ticketId,
    requestId: process.env.DISPATCH_DEMO_DISPATCH_REQUEST_ID || nextRequestId(),
    payload: {
      tech_id: DEMO_TECH_ID,
      dispatch_mode: "EMERGENCY_BYPASS",
    },
  });
  assert.equal(assign.status, 200);

  const checkIn = await runToolAction({
    toolName: "tech.check_in",
    actorId: "tech-demo-smoke",
    actorRole: "tech",
    ticketId,
    requestId: process.env.DISPATCH_DEMO_CHECKIN_REQUEST_ID || nextRequestId(),
    payload: {
      timestamp: "2026-02-17T15:20:00.000Z",
      location: {
        lat: 37.777,
        lng: -122.416,
      },
    },
  });
  assert.equal(checkIn.status, 200);
  assert.equal(checkIn.data.state, "IN_PROGRESS");

  const blockedRequestId = process.env.DISPATCH_DEMO_COMPLETE_FAIL_REQUEST_ID || nextRequestId();
  try {
    await runToolAction({
      toolName: "tech.complete",
      actorId: "tech-demo-smoke",
      actorRole: "tech",
      ticketId,
      requestId: blockedRequestId,
      payload: {
        checklist_status: {
          work_performed: true,
          parts_used_or_needed: true,
          resolution_status: true,
          onsite_photos_after: true,
          billing_authorization: true,
        },
      },
    });

    throw new Error("tech.complete should fail before evidence is attached");
  } catch (error) {
    assertSuccessCloseoutBlocked(error);
  }

  const baseUri = `s3://dispatch-evidence/${ticketId}`;
  const evidenceRequestId = process.env.DISPATCH_DEMO_EVIDENCE_REQUEST_ID || nextRequestId();
  const evidence1 = await addEvidence({
    ticketId,
    evidenceKey: "photo_before_security_risk",
    uri: `${baseUri}/photo-before.jpg`,
    kind: "PHOTO",
    requestId: evidenceRequestId,
  });
  const evidenceReplay = await addEvidence({
    ticketId,
    evidenceKey: "photo_before_security_risk",
    uri: `${baseUri}/photo-before.jpg`,
    kind: "PHOTO",
    requestId: evidenceRequestId,
  });
  assert.equal(evidenceReplay.data.id, evidence1.data.id);

  await addEvidence({
    ticketId,
    evidenceKey: "photo_after_temporary_or_permanent_securement",
    uri: `${baseUri}/photo-after.jpg`,
    kind: "PHOTO",
    requestId: process.env.DISPATCH_DEMO_EVIDENCE_AFTER_REQUEST_ID || nextRequestId(),
  });
  await addEvidence({
    ticketId,
    evidenceKey: "note_risk_mitigation_and_customer_handoff",
    uri: `${baseUri}/note.txt`,
    kind: "NOTE",
    requestId: process.env.DISPATCH_DEMO_EVIDENCE_NOTE_REQUEST_ID || nextRequestId(),
  });
  await addEvidence({
    ticketId,
    evidenceKey: "signature_or_no_signature_reason",
    uri: `${baseUri}/signature.txt`,
    kind: "NOTE",
    requestId: process.env.DISPATCH_DEMO_SIGNATURE_REQUEST_ID || nextRequestId(),
  });

  const complete = await runToolAction({
    toolName: "tech.complete",
    actorId: "tech-demo-smoke",
    actorRole: "tech",
    ticketId,
    requestId: process.env.DISPATCH_DEMO_COMPLETE_REQUEST_ID || nextRequestId(),
    payload: {
      checklist_status: {
        work_performed: true,
        parts_used_or_needed: true,
        resolution_status: true,
        onsite_photos_after: true,
        billing_authorization: true,
      },
    },
  });
  assert.equal(complete.status, 200);
  assert.equal(complete.data.state, "COMPLETED_PENDING_VERIFICATION");

  const verify = await runToolAction({
    toolName: "qa.verify",
    actorId: "qa-demo-smoke",
    actorRole: "qa",
    ticketId,
    requestId: process.env.DISPATCH_DEMO_VERIFY_REQUEST_ID || nextRequestId(),
    payload: {
      timestamp: "2026-02-17T16:20:00.000Z",
      result: "PASS",
      notes: "Demo smoke verified",
    },
  });
  assert.equal(verify.status, 200);
  assert.equal(verify.data.state, "VERIFIED");

  const invoice = await runToolAction({
    toolName: "billing.generate_invoice",
    actorId: "finance-demo-smoke",
    actorRole: "finance",
    ticketId,
    requestId: process.env.DISPATCH_DEMO_INVOICE_REQUEST_ID || nextRequestId(),
    payload: {},
  });
  assert.equal(invoice.status, 200);
  assert.equal(invoice.data.state, "INVOICED");

  const ticket = await runToolAction({
    toolName: "ticket.get",
    actorId: "dispatcher-demo",
    actorRole: "dispatcher",
    ticketId,
  });
  assert.equal(ticket.status, 200);
  assert.equal(ticket.data.state, "INVOICED");

  const timeline = await runToolAction({
    toolName: "ticket.timeline",
    actorId: "dispatcher-demo",
    actorRole: "dispatcher",
    ticketId,
  });
  assert.equal(timeline.status, 200);
  assert.ok(Array.isArray(timeline.data.events));
  assert.ok(timeline.data.events.length >= 10);

  const cockpit = await getView(`/ux/dispatcher/cockpit?ticket_id=${ticketId}`, {
    actorId: "dispatcher-demo",
    actorRole: "dispatcher",
    toolName: "dispatcher.cockpit",
  });
  assert.equal(cockpit.status, 200);
  assert.ok(Array.isArray(cockpit.body.queue));
  assert.ok(cockpit.body.queue.some((entry) => entry.ticket_id === ticketId));

  const jobPacket = await getView(`/ux/technician/job-packet/${ticketId}`, {
    actorId: "tech-demo-smoke",
    actorRole: "tech",
    toolName: "tech.job_packet",
  });
  assert.equal(jobPacket.status, 200);
  assert.equal(jobPacket.body?.packet?.header?.ticket_id, ticketId);
  assert.equal(jobPacket.body.packet.closeout_gate?.ready, true);

  console.log("Smoke scenario complete", {
    ticket_id: ticketId,
    state: ticket.data.state,
    timeline_events: timeline.data.events.length,
    cockpit_queue_size: cockpit.body.queue.length,
  });
}

main().catch((error) => {
  console.error("dispatch demo smoke failed:", error.message);
  if (error instanceof assert.AssertionError) {
    console.error(error.stack);
  } else if (error instanceof DispatchBridgeError && error.details?.dispatch_error) {
    console.error(JSON.stringify(error.details.dispatch_error, null, 2));
  }
  process.exitCode = 1;
});
