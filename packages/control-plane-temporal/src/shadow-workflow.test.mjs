import assert from "node:assert/strict";
import test from "node:test";
import { runScheduleHoldReleaseShadowWorkflow } from "./workflows.mjs";

const baseInput = {
  ticketId: "b3f2c0b7-12e4-4fb8-9f0c-6fcf84a1e2d6",
  hold_reason: "CUSTOMER_PENDING",
  confirmation_window: {
    start: "2026-02-16T10:00:00Z",
    end: "2026-02-16T10:15:00Z",
  },
  trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
  trace_parent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  trace_state: "vendor=demo",
};

function buildAdapters() {
  return {
    readTicket: async (ticketId, context) => {
      assert.equal(ticketId, baseInput.ticketId);
      assert.equal(context.traceContext.trace_id, baseInput.trace_id);
      assert.equal(context.traceContext.trace_parent, baseInput.trace_parent);
      assert.equal(context.traceContext.trace_state, baseInput.trace_state);
      return {
        id: ticketId,
        state: "SCHEDULED",
      };
    },
    readTimeline: async (ticketId) => {
      assert.equal(ticketId, baseInput.ticketId);
      return {
        events: [{ type: "ticket_opened" }, { type: "schedule_proposed" }],
      };
    },
    proposeHoldReleasePlan: async (proposalInput) => ({
      ...proposalInput,
      mode: "shadow",
      decision: "PROPOSED",
      can_apply: false,
      reason: "shadow_mode_no_side_effects",
    }),
  };
}

test("shadow workflow emits proposal-only result with trace continuity", async () => {
  const actual = await runScheduleHoldReleaseShadowWorkflow(baseInput, buildAdapters());

  assert.equal(actual.mode, "shadow");
  assert.equal(actual.shadow_intent, "propose_only");
  assert.equal(actual.can_apply, false);
  assert.equal(actual.trace_context.trace_id, baseInput.trace_id);
  assert.equal(actual.trace_context.trace_parent, baseInput.trace_parent);
  assert.equal(actual.trace_context.trace_state, baseInput.trace_state);
  assert.equal(actual.proposal.mode, "shadow");
  assert.equal(actual.proposal.decision, "PROPOSED");
  assert.equal(actual.proposal.can_apply, false);
  assert.equal(actual.proposal.trace_context.trace_id, baseInput.trace_id);
  assert.equal(actual.proposal.trace_context.trace_parent, baseInput.trace_parent);
  assert.equal(actual.timeline_length, 2);
});

test("shadow workflow is deterministic for fixed input", async () => {
  const first = await runScheduleHoldReleaseShadowWorkflow(baseInput, buildAdapters());
  const second = await runScheduleHoldReleaseShadowWorkflow(baseInput, buildAdapters());
  assert.deepStrictEqual(first, second);
});

test("traceparent-like input has precedence over legacy trace context fields", async () => {
  const withLegacyInput = {
    ...baseInput,
    trace_context: {
      traceId: "legacy-trace-id",
      traceParent: "00-legacy-parent-0000000000000000-00",
      source: "legacy",
    },
  };

  const actual = await runScheduleHoldReleaseShadowWorkflow(withLegacyInput, buildAdapters());
  assert.equal(actual.trace_context.trace_id, baseInput.trace_id);
  assert.equal(actual.trace_context.trace_parent, baseInput.trace_parent);
  assert.equal(actual.trace_context.trace_source, "legacy");
});
