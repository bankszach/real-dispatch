import { Type } from "@sinclair/typebox";
import { TypeSystem } from "@sinclair/typebox/system";

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

TypeSystem.Format("uuid", (value) => typeof value === "string" && uuidRegex.test(value));
TypeSystem.Format(
  "date-time",
  (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)),
);
TypeSystem.Format("email", (value) => typeof value === "string" && emailRegex.test(value));

const uuidSchema = Type.String({ format: "uuid", minLength: 36, maxLength: 36 });
const isoDateTimeSchema = Type.String({ format: "date-time", minLength: 20 });
const nonNegativeNumberSchema = Type.Number({ minimum: 0 });
const prioritySchema = Type.Union([
  Type.Literal("EMERGENCY"),
  Type.Literal("URGENT"),
  Type.Literal("ROUTINE"),
]);
const confidencePercentSchema = Type.Number({ minimum: 0, maximum: 100 });
const schedulingWindowSchema = Type.Object(
  {
    start: isoDateTimeSchema,
    end: isoDateTimeSchema,
  },
  { additionalProperties: true },
);
const checklistStatusSchema = Type.Object({}, { additionalProperties: true });
const locationSchema = Type.Object({}, { additionalProperties: true });
const metadataSchema = Type.Object({}, { additionalProperties: true });
const holdReasonSchema = Type.Union([
  Type.Literal("CUSTOMER_PENDING"),
  Type.Literal("CUSTOMER_UNREACHABLE"),
  Type.Literal("CUSTOMER_CONFIRMATION_STALE"),
]);
const resultSchema = Type.Union([Type.Literal("PASS"), Type.Literal("FAIL")]);
const evidenceDecisionSchema = Type.Union([Type.Literal("APPROVED"), Type.Literal("DENIED")]);
const dispatchModeSchema = Type.Union([Type.Literal("STANDARD"), Type.Literal("EMERGENCY_BYPASS")]);
const approvalTypeSchema = Type.Union([Type.Literal("NTE_INCREASE"), Type.Literal("PROPOSAL")]);
const serviceTypeSchema = Type.String({ minLength: 1 });
const recommendationLimitSchema = Type.Integer({ minimum: 1, maximum: 20 });
const scheduleActionSchema = Type.Object(
  {
    hold_reason: holdReasonSchema,
    confirmation_window: schedulingWindowSchema,
  },
  { additionalProperties: true },
);
const autonomyGlobalScopeSchema = Type.Object(
  {
    scope_type: Type.Optional(Type.Literal("GLOBAL")),
    reason: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);
const autonomyIncidentScopeSchema = Type.Object(
  {
    scope_type: Type.Literal("INCIDENT"),
    incident_type: Type.String({ minLength: 1 }),
    reason: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);
const autonomyTicketScopeSchema = Type.Object(
  {
    scope_type: Type.Literal("TICKET"),
    ticket_id: uuidSchema,
    reason: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);
const autonomyScopeSchema = Type.Union([
  autonomyGlobalScopeSchema,
  autonomyIncidentScopeSchema,
  autonomyTicketScopeSchema,
]);

export const DISPATCH_CONTRACT = {
  "ticket.create": {
    tool_name: "ticket.create",
    http_method: "POST",
    route: "/tickets",
    allowed_roles: ["dispatcher", "agent"],
    allowed_from_states: null,
    resulting_state: "NEW",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        account_id: uuidSchema,
        site_id: uuidSchema,
        summary: Type.String({ minLength: 1 }),
        description: Type.Optional(Type.String({ minLength: 1 })),
        asset_id: Type.Optional(uuidSchema),
        nte_cents: Type.Optional(nonNegativeNumberSchema),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "ticket.blind_intake": {
    tool_name: "ticket.blind_intake",
    http_method: "POST",
    route: "/tickets/intake",
    allowed_roles: ["dispatcher", "agent"],
    allowed_from_states: null,
    resulting_state: null,
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        account_id: uuidSchema,
        site_id: uuidSchema,
        summary: Type.String({ minLength: 1 }),
        incident_type: Type.String({ minLength: 1 }),
        customer_name: Type.String({ minLength: 1 }),
        contact_phone: Type.Optional(Type.String({ minLength: 7 })),
        contact_email: Type.Optional(Type.String({ format: "email" })),
        priority: prioritySchema,
        description: Type.Optional(Type.String({ minLength: 1 })),
        nte_cents: Type.Optional(nonNegativeNumberSchema),
        identity_confidence: confidencePercentSchema,
        classification_confidence: confidencePercentSchema,
        sop_handoff_acknowledged: Type.Optional(Type.Boolean()),
        sop_handoff_prompt: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "ticket.triage": {
    tool_name: "ticket.triage",
    http_method: "POST",
    route: "/tickets/{ticketId}/triage",
    allowed_roles: ["dispatcher", "agent"],
    allowed_from_states: ["NEW", "NEEDS_INFO", "TRIAGED"],
    resulting_state: "TRIAGED",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        priority: prioritySchema,
        incident_type: Type.String({ minLength: 1 }),
        nte_cents: Type.Optional(nonNegativeNumberSchema),
        workflow_outcome: Type.Optional(
          Type.Union([
            Type.Literal("TRIAGED"),
            Type.Literal("READY_TO_SCHEDULE"),
            Type.Literal("APPROVAL_REQUIRED"),
          ]),
        ),
        ready_to_schedule: Type.Optional(Type.Boolean()),
        requires_approval: Type.Optional(Type.Boolean()),
        approval_reason: Type.Optional(Type.String({ minLength: 1 })),
        approval_amount_delta_cents: Type.Optional(nonNegativeNumberSchema),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "schedule.propose": {
    tool_name: "schedule.propose",
    http_method: "POST",
    route: "/tickets/{ticketId}/schedule/propose",
    allowed_roles: ["dispatcher", "agent"],
    allowed_from_states: ["READY_TO_SCHEDULE"],
    resulting_state: "SCHEDULE_PROPOSED",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        options: Type.Array(schedulingWindowSchema, { minItems: 1 }),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "schedule.confirm": {
    tool_name: "schedule.confirm",
    http_method: "POST",
    route: "/tickets/{ticketId}/schedule/confirm",
    allowed_roles: ["dispatcher"],
    allowed_from_states: ["SCHEDULE_PROPOSED"],
    resulting_state: "SCHEDULED",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        start: isoDateTimeSchema,
        end: isoDateTimeSchema,
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "assignment.dispatch": {
    tool_name: "assignment.dispatch",
    http_method: "POST",
    route: "/tickets/{ticketId}/assignment/dispatch",
    allowed_roles: ["dispatcher"],
    allowed_from_states: ["TRIAGED", "SCHEDULED"],
    resulting_state: "DISPATCHED",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        tech_id: uuidSchema,
        provider_id: Type.Optional(uuidSchema),
        dispatch_mode: Type.Optional(dispatchModeSchema),
        dispatch_rationale: Type.Optional(Type.String({ minLength: 1 })),
        dispatch_confirmation: Type.Optional(Type.Boolean()),
        recommendation_snapshot_id: Type.Optional(uuidSchema),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: {
      mode_field: "dispatch_mode",
      required_mode: "EMERGENCY_BYPASS",
      required_fields: ["dispatch_rationale", "dispatch_confirmation"],
      require_actor_identity: true,
    },
  },
  "assignment.recommend": {
    tool_name: "assignment.recommend",
    http_method: "POST",
    route: "/tickets/{ticketId}/assignment/recommend",
    allowed_roles: ["dispatcher", "agent"],
    allowed_from_states: ["SCHEDULED", "READY_TO_SCHEDULE", "SCHEDULE_PROPOSED"],
    resulting_state: null,
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        service_type: serviceTypeSchema,
        recommendation_limit: Type.Optional(recommendationLimitSchema),
        preferred_window: Type.Optional(schedulingWindowSchema),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "schedule.hold": {
    tool_name: "schedule.hold",
    http_method: "POST",
    route: "/tickets/{ticketId}/schedule/hold",
    allowed_roles: ["dispatcher"],
    allowed_from_states: ["SCHEDULE_PROPOSED", "SCHEDULED"],
    resulting_state: null,
    idempotency_required: true,
    payload_schema: scheduleActionSchema,
    bypass_requirements: null,
  },
  "schedule.release": {
    tool_name: "schedule.release",
    http_method: "POST",
    route: "/tickets/{ticketId}/schedule/release",
    allowed_roles: ["dispatcher"],
    allowed_from_states: ["PENDING_CUSTOMER_CONFIRMATION"],
    resulting_state: null,
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        customer_confirmation_id: uuidSchema,
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "schedule.rollback": {
    tool_name: "schedule.rollback",
    http_method: "POST",
    route: "/tickets/{ticketId}/schedule/rollback",
    allowed_roles: ["dispatcher"],
    allowed_from_states: ["PENDING_CUSTOMER_CONFIRMATION"],
    resulting_state: null,
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        confirmation_id: uuidSchema,
        reason: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "tech.check_in": {
    tool_name: "tech.check_in",
    http_method: "POST",
    route: "/tickets/{ticketId}/tech/check-in",
    allowed_roles: ["technician", "dispatcher"],
    allowed_from_states: ["DISPATCHED"],
    resulting_state: "IN_PROGRESS",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        timestamp: isoDateTimeSchema,
        location: Type.Optional(locationSchema),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "tech.request_change": {
    tool_name: "tech.request_change",
    http_method: "POST",
    route: "/tickets/{ticketId}/tech/request-change",
    allowed_roles: ["technician"],
    allowed_from_states: ["IN_PROGRESS"],
    resulting_state: "APPROVAL_REQUIRED",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        approval_type: approvalTypeSchema,
        reason: Type.String({ minLength: 1 }),
        amount_delta_cents: Type.Optional(nonNegativeNumberSchema),
        evidence_refs: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "approval.decide": {
    tool_name: "approval.decide",
    http_method: "POST",
    route: "/tickets/{ticketId}/approval/decide",
    allowed_roles: ["approver", "dispatcher"],
    allowed_from_states: ["APPROVAL_REQUIRED"],
    resulting_state: null,
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        approval_id: uuidSchema,
        decision: evidenceDecisionSchema,
        notes: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "closeout.add_evidence": {
    tool_name: "closeout.add_evidence",
    http_method: "POST",
    route: "/tickets/{ticketId}/evidence",
    allowed_roles: ["dispatcher", "agent", "technician"],
    allowed_from_states: null,
    resulting_state: null,
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        kind: Type.String({ minLength: 1 }),
        uri: Type.String({ minLength: 1 }),
        checksum: Type.Optional(Type.String({ minLength: 1 })),
        evidence_key: Type.Optional(Type.String({ minLength: 1 })),
        metadata: Type.Optional(metadataSchema),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "closeout.candidate": {
    tool_name: "closeout.candidate",
    http_method: "POST",
    route: "/tickets/{ticketId}/closeout/candidate",
    allowed_roles: ["dispatcher", "agent", "technician"],
    allowed_from_states: ["IN_PROGRESS"],
    resulting_state: "COMPLETED_PENDING_VERIFICATION",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        checklist_status: checklistStatusSchema,
        no_signature_reason: Type.Optional(Type.String({ minLength: 1 })),
        evidence_refs: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "tech.complete": {
    tool_name: "tech.complete",
    http_method: "POST",
    route: "/tickets/{ticketId}/tech/complete",
    allowed_roles: ["dispatcher", "technician"],
    allowed_from_states: ["IN_PROGRESS"],
    resulting_state: "COMPLETED_PENDING_VERIFICATION",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        checklist_status: checklistStatusSchema,
        no_signature_reason: Type.Optional(Type.String({ minLength: 1 })),
        evidence_refs: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "qa.verify": {
    tool_name: "qa.verify",
    http_method: "POST",
    route: "/tickets/{ticketId}/qa/verify",
    allowed_roles: ["qa", "dispatcher"],
    allowed_from_states: ["COMPLETED_PENDING_VERIFICATION"],
    resulting_state: "VERIFIED",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        timestamp: isoDateTimeSchema,
        result: resultSchema,
        notes: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "billing.generate_invoice": {
    tool_name: "billing.generate_invoice",
    http_method: "POST",
    route: "/tickets/{ticketId}/billing/generate-invoice",
    allowed_roles: ["finance"],
    allowed_from_states: ["VERIFIED"],
    resulting_state: "INVOICED",
    idempotency_required: true,
    payload_schema: Type.Object({}, { additionalProperties: true }),
    bypass_requirements: null,
  },
  "ticket.close": {
    tool_name: "ticket.close",
    http_method: "POST",
    route: "/tickets/{ticketId}/close",
    allowed_roles: ["dispatcher", "finance", "approver"],
    allowed_from_states: ["VERIFIED", "INVOICED"],
    resulting_state: "CLOSED",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        reason: Type.Optional(Type.String({ minLength: 1 })),
        closeout_override_code: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "ticket.force_close": {
    tool_name: "ticket.force_close",
    http_method: "POST",
    route: "/tickets/{ticketId}/force-close",
    allowed_roles: ["dispatcher", "approver"],
    allowed_from_states: ["COMPLETED_PENDING_VERIFICATION"],
    resulting_state: "CLOSED",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        override_code: Type.String({ minLength: 5 }),
        override_reason: Type.String({ minLength: 20 }),
        approver_role: Type.String({ minLength: 1 }),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "ticket.cancel": {
    tool_name: "ticket.cancel",
    http_method: "POST",
    route: "/tickets/{ticketId}/cancel",
    allowed_roles: ["dispatcher", "approver", "finance"],
    allowed_from_states: [
      "NEW",
      "NEEDS_INFO",
      "TRIAGED",
      "APPROVAL_REQUIRED",
      "READY_TO_SCHEDULE",
      "SCHEDULE_PROPOSED",
      "SCHEDULED",
      "PENDING_CUSTOMER_CONFIRMATION",
      "DISPATCHED",
      "ON_SITE",
      "IN_PROGRESS",
      "ON_HOLD",
      "COMPLETED_PENDING_VERIFICATION",
      "VERIFIED",
      "INVOICED",
    ],
    resulting_state: "CANCELLED",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        reason: Type.String({ minLength: 1 }),
        cancellation_code: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "dispatch.force_hold": {
    tool_name: "dispatch.force_hold",
    http_method: "POST",
    route: "/tickets/{ticketId}/dispatch/force-hold",
    allowed_roles: ["dispatcher"],
    allowed_from_states: ["DISPATCHED", "ON_SITE", "IN_PROGRESS"],
    resulting_state: "ON_HOLD",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        hold_reason: Type.Optional(holdReasonSchema),
        reason: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "dispatch.force_unassign": {
    tool_name: "dispatch.force_unassign",
    http_method: "POST",
    route: "/tickets/{ticketId}/dispatch/force-unassign",
    allowed_roles: ["dispatcher"],
    allowed_from_states: [
      "READY_TO_SCHEDULE",
      "SCHEDULE_PROPOSED",
      "SCHEDULED",
      "PENDING_CUSTOMER_CONFIRMATION",
      "DISPATCHED",
      "ON_SITE",
      "IN_PROGRESS",
      "ON_HOLD",
      "COMPLETED_PENDING_VERIFICATION",
      "VERIFIED",
      "INVOICED",
    ],
    resulting_state: "SCHEDULED",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        reason: Type.Optional(Type.String({ minLength: 1 })),
        reassign_type: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  reopen_after_verification: {
    tool_name: "reopen_after_verification",
    http_method: "POST",
    route: "/tickets/{ticketId}/closeout/reopen-after-verification",
    allowed_roles: ["dispatcher", "qa"],
    allowed_from_states: ["VERIFIED", "INVOICED"],
    resulting_state: "IN_PROGRESS",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        reason: Type.String({ minLength: 1 }),
        reopen_scope: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "closeout.evidence_exception": {
    tool_name: "closeout.evidence_exception",
    http_method: "POST",
    route: "/tickets/{ticketId}/closeout/evidence-exception",
    allowed_roles: ["dispatcher", "qa", "approver"],
    allowed_from_states: ["IN_PROGRESS", "COMPLETED_PENDING_VERIFICATION", "VERIFIED", "INVOICED"],
    resulting_state: null,
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        exception_reason: Type.String({ minLength: 1 }),
        evidence_refs: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
        expires_at: Type.Optional(Type.String({ format: "date-time" })),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "dispatch.manual_bypass": {
    tool_name: "dispatch.manual_bypass",
    http_method: "POST",
    route: "/tickets/{ticketId}/dispatch/manual-bypass",
    allowed_roles: ["dispatcher"],
    allowed_from_states: ["IN_PROGRESS", "COMPLETED_PENDING_VERIFICATION"],
    resulting_state: "COMPLETED_PENDING_VERIFICATION",
    idempotency_required: true,
    payload_schema: Type.Object(
      {
        bypass_rationale: Type.String({ minLength: 1 }),
        target_tool: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: true },
    ),
    bypass_requirements: null,
  },
  "ticket.get": {
    tool_name: "ticket.get",
    http_method: "GET",
    route: "/tickets/{ticketId}",
    allowed_roles: ["dispatcher", "agent", "customer", "technician", "qa", "approver", "finance"],
    allowed_from_states: null,
    resulting_state: null,
    idempotency_required: false,
    payload_schema: Type.Object({}, { additionalProperties: false }),
    bypass_requirements: null,
  },
  "closeout.list_evidence": {
    tool_name: "closeout.list_evidence",
    http_method: "GET",
    route: "/tickets/{ticketId}/evidence",
    allowed_roles: ["dispatcher", "agent", "technician", "qa", "approver", "finance"],
    allowed_from_states: null,
    resulting_state: null,
    idempotency_required: false,
    payload_schema: Type.Object({}, { additionalProperties: false }),
    bypass_requirements: null,
  },
  "ticket.timeline": {
    tool_name: "ticket.timeline",
    http_method: "GET",
    route: "/tickets/{ticketId}/timeline",
    allowed_roles: ["dispatcher", "agent", "customer", "technician", "qa", "approver", "finance"],
    allowed_from_states: null,
    resulting_state: null,
    idempotency_required: false,
    payload_schema: Type.Object({}, { additionalProperties: false }),
    bypass_requirements: null,
  },
  "dispatcher.cockpit": {
    tool_name: "dispatcher.cockpit",
    http_method: "GET",
    route: "/ux/dispatcher/cockpit",
    allowed_roles: ["dispatcher"],
    allowed_from_states: null,
    resulting_state: null,
    idempotency_required: false,
    payload_schema: Type.Object({}, { additionalProperties: false }),
    bypass_requirements: null,
  },
  "tech.job_packet": {
    tool_name: "tech.job_packet",
    http_method: "GET",
    route: "/ux/technician/job-packet/{ticketId}",
    allowed_roles: ["technician", "dispatcher"],
    allowed_from_states: null,
    resulting_state: null,
    idempotency_required: false,
    payload_schema: Type.Object({}, { additionalProperties: false }),
    bypass_requirements: null,
  },
  "ops.autonomy.pause": {
    tool_name: "ops.autonomy.pause",
    http_method: "POST",
    route: "/ops/autonomy/pause",
    allowed_roles: ["dispatcher"],
    allowed_from_states: null,
    resulting_state: null,
    idempotency_required: true,
    payload_schema: autonomyScopeSchema,
    bypass_requirements: null,
  },
  "ops.autonomy.rollback": {
    tool_name: "ops.autonomy.rollback",
    http_method: "POST",
    route: "/ops/autonomy/rollback",
    allowed_roles: ["dispatcher"],
    allowed_from_states: null,
    resulting_state: null,
    idempotency_required: true,
    payload_schema: autonomyScopeSchema,
    bypass_requirements: null,
  },
  "ops.autonomy.state": {
    tool_name: "ops.autonomy.state",
    http_method: "GET",
    route: "/ops/autonomy/state",
    allowed_roles: ["dispatcher"],
    allowed_from_states: null,
    resulting_state: null,
    idempotency_required: false,
    payload_schema: Type.Object({}, { additionalProperties: false }),
    bypass_requirements: null,
  },
  "ops.autonomy.replay": {
    tool_name: "ops.autonomy.replay",
    http_method: "GET",
    route: "/ops/autonomy/replay/{ticketId}",
    allowed_roles: ["dispatcher"],
    allowed_from_states: null,
    resulting_state: null,
    idempotency_required: false,
    payload_schema: Type.Object({}, { additionalProperties: false }),
    bypass_requirements: null,
  },
} as const;

export type DispatchContract = (typeof DISPATCH_CONTRACT)[keyof typeof DISPATCH_CONTRACT];
