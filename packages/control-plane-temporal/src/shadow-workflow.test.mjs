import assert from "node:assert/strict";
import test from "node:test";
import { buildScheduleHoldReleaseProposal } from "./shadow/schedule-hold-release.propose.mjs";

const baseInput = {
  ticketId: "b3f2c0b7-12e4-4fb8-9f0c-6fcf84a1e2d6",
  correlation_id: "4bf92f3577b34da6a3ce929d0e0e4736",
  trace_parent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  trace_state: "vendor=demo",
  generated_at: "2026-02-16T10:00:00.000Z",
  hold_reason: "CUSTOMER_PENDING",
  confirmation_window: {
    start: "2026-02-16T10:00:00Z",
    end: "2026-02-16T10:15:00Z",
  },
};

test("proposal artifact is proposal-only and mutation-safe", () => {
  const actual = buildScheduleHoldReleaseProposal(baseInput);

  assert.equal(actual.artifact_type, "dispatch-shadow-proposal");
  assert.equal(actual.ticket_id, baseInput.ticketId);
  assert.equal(actual.current_state, null);
  assert.equal(actual.correlation_id, baseInput.correlation_id);
  assert.equal(actual.trace_context.trace_parent, baseInput.trace_parent);
  assert.equal(actual.trace_context.trace_state, baseInput.trace_state);
  assert.equal(actual.timeline_length, 0);
  assert.equal(actual.decision, "PROPOSED");
  assert.equal(actual.can_apply, false);
  assert.equal(actual.safety.mutation_attempted, false);
  assert.equal(actual.proposed_actions.length, 2);
  assert.equal(
    actual.proposed_actions[0].endpoint,
    "/tickets/b3f2c0b7-12e4-4fb8-9f0c-6fcf84a1e2d6/schedule/hold",
  );
  assert.equal(actual.proposed_actions[0].payload.hold_reason, "CUSTOMER_PENDING");
  assert.equal(
    actual.proposed_actions[1].endpoint,
    "/tickets/b3f2c0b7-12e4-4fb8-9f0c-6fcf84a1e2d6/schedule/release",
  );
  assert.equal(actual.proposed_actions[1].method, "POST");
  assert.equal(actual.proposed_actions[1].payload.customer_confirmation_log, "{{hold_id}}");
});

test("proposal timeline length follows timeline.events", () => {
  const actual = buildScheduleHoldReleaseProposal({
    ...baseInput,
    timeline: {
      events: [{}, {}, {}],
    },
    ticket: {
      id: baseInput.ticketId,
      state: "SCHEDULED",
    },
  });

  assert.equal(actual.current_state, "SCHEDULED");
  assert.equal(actual.timeline_length, 3);
});

test("legacy trace_context fields are normalized", () => {
  const actual = buildScheduleHoldReleaseProposal({
    ...baseInput,
    correlation_id: "legacy-correlation",
    trace_context: {
      traceId: "legacy-trace-id",
      traceParent: "00-legacy-parent-0000000000000000-00",
      traceState: "legacy=state",
      source: "legacy",
    },
  });

  assert.equal(actual.trace_context.trace_id, "legacy-trace-id");
  assert.equal(actual.trace_context.trace_parent, "00-legacy-parent-0000000000000000-00");
  assert.equal(actual.trace_context.trace_state, "legacy=state");
  assert.equal(actual.trace_context.trace_source, "legacy");
  assert.equal(actual.correlation_id, "legacy-correlation");
});

test("build function is deterministic for fixed input", () => {
  const first = buildScheduleHoldReleaseProposal(baseInput);
  const second = buildScheduleHoldReleaseProposal(baseInput);
  assert.deepStrictEqual(first, second);
});
