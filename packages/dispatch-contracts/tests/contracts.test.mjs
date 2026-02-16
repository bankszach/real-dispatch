import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTraceContextHeaders,
  extractTraceContextFromHeaders,
  parseTraceParent,
  validateDispatchCommand,
  validateThinSliceWorkflowCommand,
  THIN_SLICE_EVENTS,
  THIN_SLICE_SCHEMA_VERSION,
} from "../src/index.mjs";

test("parseTraceParent accepts W3C traceparent and exposes trace id", () => {
  const parsed = parseTraceParent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
  assert.equal(parsed?.version, "00");
  assert.equal(parsed?.traceId, "4bf92f3577b34da6a3ce929d0e0e4736");
  assert.equal(parsed?.parentId, "00f067aa0ba902b7");
});

test("extractTraceContextFromHeaders maps traceparent in preference to legacy x-trace-id", () => {
  const context = extractTraceContextFromHeaders({
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    "x-trace-id": "legacy-trace",
  });
  assert.equal(context.source, "traceparent");
  assert.equal(context.traceId, "4bf92f3577b34da6a3ce929d0e0e4736");
});

test("buildTraceContextHeaders produces legacy x-trace-id for backward compatibility", () => {
  const result = buildTraceContextHeaders({ traceId: "legacy-123" });
  assert.equal(result.headers["x-trace-id"], "legacy-123");
  assert.equal(result.emittedTraceId, "legacy-123");
  assert.equal(result.source, null);
});

test("validateDispatchCommand enforces required envelope fields", () => {
  const invalid = validateDispatchCommand({
    tenantId: "tenant-1",
    toolName: "ticket.create",
    actor: {
      id: "dispatcher-1",
      role: "dispatcher",
      type: "AGENT",
    },
    requestId: "req-1",
    correlationId: "corr-1",
    payload: { hello: "world" },
  });
  assert.equal(invalid.ok, true);

  const invalidResult = validateDispatchCommand({
    tenantId: "tenant-1",
    toolName: "ticket.create",
  });
  assert.equal(invalidResult.ok, false);
  assert.ok(invalidResult.errors.length >= 1);
});

test("validateThinSliceWorkflowCommand enforces required workflow envelope fields", () => {
  const valid = validateThinSliceWorkflowCommand({
    ticket_id: "ticket-1",
    policy_context: { priority: "standard" },
    requested_window: {
      start: "2026-02-16T09:00:00Z",
      end: "2026-02-16T10:00:00Z",
    },
    envelope: {
      correlation_id: "corr-1",
      causation_id: "corr-0",
      idempotency_key: "idem-1",
      ticket_id: "ticket-1",
      actor: {
        id: "dispatcher-1",
        role: "dispatcher",
        type: "AGENT",
      },
      timestamp: "2026-02-16T08:30:00Z",
      schema_version: THIN_SLICE_SCHEMA_VERSION,
      event_name: THIN_SLICE_EVENTS.WORKFLOW_REQUESTED,
    },
  });
  assert.equal(valid.ok, true);

  const invalid = validateThinSliceWorkflowCommand({
    ticket_id: "ticket-1",
    policy_context: { priority: "standard" },
    requested_window: {
      start: "2026-02-16T09:00:00Z",
      end: "",
    },
    envelope: {
      correlation_id: "corr-1",
      causation_id: "corr-0",
      idempotency_key: "idem-1",
      ticket_id: "ticket-1",
      actor: {
        id: "dispatcher-1",
        role: "dispatcher",
        type: "AGENT",
      },
      timestamp: "2026-02-16T08:30:00Z",
      schema_version: THIN_SLICE_SCHEMA_VERSION,
      event_name: "invalid.event",
    },
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.length >= 1);
});
