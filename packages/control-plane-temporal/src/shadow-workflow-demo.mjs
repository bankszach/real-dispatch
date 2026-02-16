import { runScheduleHoldReleaseShadowWorkflow } from "./workflows.mjs";

const proposal = await runScheduleHoldReleaseShadowWorkflow(
  {
    ticketId: "b3f2c0b7-12e4-4fb8-9f0c-6fcf84a1e2d6",
    hold_reason: "CUSTOMER_PENDING",
    confirmation_window: {
      start: "2026-02-16T10:00:00Z",
      end: "2026-02-16T10:15:00Z",
    },
    trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
    trace_parent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    trace_state: "vendor=demo",
  },
  {
    readTicket: async () => ({
      id: "b3f2c0b7-12e4-4fb8-9f0c-6fcf84a1e2d6",
      state: "SCHEDULED",
      subject: "Demo ticket for shadow workflow proof",
    }),
    readTimeline: async () => ({
      events: [{ type: "ticket_opened" }, { type: "schedule_proposed" }],
    }),
    proposeHoldReleasePlan: async (proposalInput) => ({
      ...proposalInput,
      decision: "PROPOSED",
      can_apply: false,
      reason: "shadow_mode_no_side_effects",
    }),
  },
);

const output = {
  mode: proposal.mode,
  ticket_id: proposal.ticket_id,
  shadow_intent: proposal.shadow_intent,
  trace_context: proposal.trace_context,
  proposal,
  timeline_length: proposal.timeline_length,
};

console.log(JSON.stringify(output, null, 2));
