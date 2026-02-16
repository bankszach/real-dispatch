import { buildScheduleHoldReleaseProposal } from "./shadow/schedule-hold-release.propose.mjs";

const proposal = buildScheduleHoldReleaseProposal({
  ticketId: "b3f2c0b7-12e4-4fb8-9f0c-6fcf84a1e2d6",
  ticket: {
    state: "SCHEDULED",
  },
  timeline: {
    events: [{ type: "ticket_opened" }, { type: "schedule_proposed" }],
  },
  hold_reason: "CUSTOMER_PENDING",
  confirmation_window: {
    start: "2026-02-16T10:00:00Z",
    end: "2026-02-16T10:15:00Z",
  },
  correlation_id: "4bf92f3577b34da6a3ce929d0e0e4736",
  trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
  trace_parent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  trace_state: "vendor=demo",
});

const output = {
  mode: "shadow",
  ticket_id: proposal.ticket_id,
  shadow_intent: "propose_only",
  trace_context: proposal.trace_context,
  proposal,
  timeline_length: proposal.timeline_length,
};

console.log(JSON.stringify(output, null, 2));
