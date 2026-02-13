// Real Dispatch core contracts (v1).
// Source of truth: docs/rfcs/0002-dispatch-operating-model-v1.md

export const ContractVersion = "v1" as const;

export const TicketStates = [
  "new",
  "triaged",
  "schedulable",
  "scheduled",
  "dispatched",
  "onsite",
  "closeout_pending",
  "closed",
  "canceled",
] as const;

export type TicketState = (typeof TicketStates)[number];

export const IntakeCheckpointStates = ["new", "needs_info", "triaged"] as const;
export type IntakeCheckpointState = (typeof IntakeCheckpointStates)[number];

export const EntitlementCheckpointStates = [
  "unknown",
  "covered",
  "billable",
  "approval_required",
  "approved",
  "denied",
] as const;
export type EntitlementCheckpointState =
  (typeof EntitlementCheckpointStates)[number];

export const SchedulingCheckpointStates = [
  "ready_to_schedule",
  "proposed",
  "scheduled",
  "dispatched",
] as const;
export type SchedulingCheckpointState =
  (typeof SchedulingCheckpointStates)[number];

export const ExecutionCheckpointStates = [
  "onsite",
  "on_hold",
  "return_visit_required",
  "completed_pending_verification",
] as const;
export type ExecutionCheckpointState = (typeof ExecutionCheckpointStates)[number];

export const VerificationCheckpointStates = ["pending", "verified", "rejected"] as const;
export type VerificationCheckpointState =
  (typeof VerificationCheckpointStates)[number];

export const BillingCheckpointStates = [
  "not_ready",
  "draft_ready",
  "invoiced",
  "paid",
] as const;
export type BillingCheckpointState = (typeof BillingCheckpointStates)[number];

export const Priorities = ["low", "standard", "high", "emergency"] as const;
export type Priority = (typeof Priorities)[number];

export const RiskFlags = [
  "safety",
  "security",
  "business_interruption",
  "ada_egress",
  "after_hours",
] as const;
export type RiskFlag = (typeof RiskFlags)[number];

export const Roles = [
  "system_intake_agent",
  "system_scheduling_agent",
  "system_technician_liaison_agent",
  "system_closeout_agent",
  "operator_admin",
  "technician",
  "customer",
] as const;

export type Role = (typeof Roles)[number];

export type ISO8601 = string;
export type ULID = string;

export type Money = {
  currency: "USD";
  amount_cents: number;
};

export type ActorRef =
  | { role: "operator_admin"; operator_id: ULID }
  | { role: "technician"; technician_id: ULID }
  | { role: "customer"; customer_id: ULID }
  | {
      role:
        | "system_intake_agent"
        | "system_scheduling_agent"
        | "system_technician_liaison_agent"
        | "system_closeout_agent";
      agent_id: ULID;
    };

export type ChannelRef =
  | { kind: "whatsapp"; peer: string }
  | { kind: "telegram"; peer: string }
  | { kind: "sms"; peer: string }
  | { kind: "email"; peer: string }
  | { kind: "webchat"; peer: string }
  | { kind: "phone"; peer: string }
  | { kind: "internal"; peer: "system" };

export type Address = {
  address_line1: string;
  address_line2?: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  lat?: number;
  lon?: number;
};

export type AccountRef = {
  account_id: ULID;
  name: string;
  sla_tier?: "standard" | "priority" | "critical";
  pricing_profile_id?: ULID;
};

export type ServiceTerms = {
  contract_coverage: "covered" | "billable" | "mixed" | "unknown";
  warranty_eligible: boolean;
  after_hours_allowed: boolean;
  default_nte?: Money;
};

export type SiteRef = {
  site_id: ULID;
  display_name: string;
  service_location: Address;
  hours?: string;
  access_rules?: string;
  keyholder_rules?: string;
};

export type AuthorizedContact = {
  contact_id: ULID;
  name: string;
  phone?: string;
  email?: string;
  can_request: boolean;
  can_approve: boolean;
  can_grant_access: boolean;
};

export type RequesterContact = {
  contact_name: string;
  phone?: string;
  email?: string;
};

export const AssetTypes = [
  "auto_door",
  "manual_door",
  "lockset",
  "panic_hardware",
  "storefront",
  "closer",
  "operator",
  "unknown",
] as const;
export type AssetType = (typeof AssetTypes)[number];

export type AssetRef = {
  asset_id: ULID;
  asset_tag?: string;
  type: AssetType;
  make?: string;
  model?: string;
  serial?: string;
  installed_at?: ISO8601;
  warranty_expires_at?: ISO8601;
  compliance_profile?: string;
};

export const PricingModels = ["flat", "time_and_material", "quote_required"] as const;
export type PricingModel = (typeof PricingModels)[number];

export type IncidentTemplate = {
  incident_type_id: string;
  category: string;
  subcategory?: string;
  default_priority: Priority;
  default_sla_minutes: number;
  required_intake_fields: string[];
  required_evidence_before: string[];
  required_evidence_after: string[];
  checklist_steps: string[];
  default_nte_amount_cents?: number;
  replacement_requires_approval: boolean;
  pricing_model: PricingModel;
};

export type IncidentSnapshot = {
  incident_type_id: string;
  summary: string;
  symptoms?: string;
  urgency: Priority;
  risk_flags: RiskFlag[];
  template_version?: string;
};

export type Nte = {
  limit: Money;
  approved_limit: Money;
  escalation_required_above_cents: number;
};

export const ApprovalTypes = [
  "nte_increase",
  "after_hours",
  "replacement",
  "quote",
] as const;
export type ApprovalType = (typeof ApprovalTypes)[number];

export const ApprovalStatuses = ["pending", "approved", "denied", "canceled"] as const;
export type ApprovalStatus = (typeof ApprovalStatuses)[number];

export type ApprovalRequest = {
  approval_id: ULID;
  type: ApprovalType;
  status: ApprovalStatus;
  summary: string;
  requested_amount?: Money;
  requested_at: ISO8601;
  requested_by: ActorRef;
  requested_from: string[];
  decided_at?: ISO8601;
  decided_by?: ActorRef;
  decision_reason?: string;
};

export type AppointmentWindow = {
  window_start: ISO8601;
  window_end: ISO8601;
  timezone: string;
};

export const AppointmentStatuses = [
  "proposed",
  "confirmed",
  "rescheduled",
  "canceled",
] as const;
export type AppointmentStatus = (typeof AppointmentStatuses)[number];

export type Appointment = {
  appointment_id: ULID;
  status: AppointmentStatus;
  window: AppointmentWindow;
  confirmed_at?: ISO8601;
  confirmed_by?: ActorRef;
  customer_confirmation_log?: string;
};

export type DispatchReasoning = {
  skill_match: boolean;
  coverage_tier: "primary" | "secondary" | "tertiary";
  distance_km?: number;
  availability_score?: number;
};

export type DispatchAssignment = {
  assignment_id: ULID;
  technician_id: ULID;
  assigned_at: ISO8601;
  eta_at?: ISO8601;
  reasoning: DispatchReasoning;
};

export const EvidenceKinds = [
  "photo",
  "video",
  "document",
  "signature",
  "note",
  "sensor_test",
] as const;
export type EvidenceKind = (typeof EvidenceKinds)[number];

export type EvidenceItem = {
  evidence_id: ULID;
  kind: EvidenceKind;
  label?: string;
  storage_key?: string;
  content_type?: string;
  size_bytes?: number;
  sha256?: string;
  note_text?: string;
  created_at: ISO8601;
  created_by: ActorRef;
};

export const CloseoutChecklistKeys = [
  "work_performed",
  "parts_used_or_needed",
  "resolution_status",
  "onsite_photos_before",
  "onsite_photos_after",
  "safety_tests_completed",
  "customer_signoff",
  "billing_authorization",
] as const;
export type CloseoutChecklistKey = (typeof CloseoutChecklistKeys)[number];

export const QaStatuses = ["not_sampled", "sampled", "passed", "failed"] as const;
export type QaStatus = (typeof QaStatuses)[number];

export type TechnicianTimelineEntry = {
  timeline_id: ULID;
  type:
    | "acknowledged"
    | "onsite"
    | "status_update"
    | "on_hold"
    | "resumed"
    | "completed";
  message: string;
  created_at: ISO8601;
  created_by: ActorRef;
};

export type WorkflowCheckpoints = {
  intake: IntakeCheckpointState;
  entitlement: EntitlementCheckpointState;
  scheduling: SchedulingCheckpointState;
  execution: ExecutionCheckpointState;
  verification: VerificationCheckpointState;
  billing: BillingCheckpointState;
  emergency_dispatch: boolean;
  safety_lockout: boolean;
  requires_return_visit: boolean;
};

export type WorkOrder = {
  ticket_id: ULID;
  state: TicketState;
  created_at: ISO8601;
  updated_at: ISO8601;

  account: AccountRef;
  site: SiteRef;
  requester: RequesterContact;
  authorized_contacts: AuthorizedContact[];
  service_terms: ServiceTerms;

  incident: IncidentSnapshot;
  incident_template?: IncidentTemplate;
  asset?: AssetRef;

  checkpoints: WorkflowCheckpoints;

  priority: Priority;
  nte: Nte;
  approvals: ApprovalRequest[];

  schedule?: Appointment;
  dispatch?: DispatchAssignment;
  technician_timeline: TechnicianTimelineEntry[];

  evidence: EvidenceItem[];

  closeout: {
    checklist: Record<CloseoutChecklistKey, boolean>;
    ready_for_closeout: boolean;
    completed_at?: ISO8601;
    closeout_packet_attachment_id?: ULID;
    invoice_draft_attachment_id?: ULID;
    qa_status: QaStatus;
  };

  billing: {
    entitlement: EntitlementCheckpointState;
    status: BillingCheckpointState;
    invoice_total?: Money;
    paid_at?: ISO8601;
  };
};

export type Ticket = WorkOrder;

export const AuditEventTypes = [
  "wo.created",
  "wo.info_requested",
  "wo.info_received",
  "wo.triaged",
  "wo.schedulable",
  "wo.entitlement_evaluated",
  "approval.requested",
  "approval.approved",
  "approval.denied",
  "nte.set",
  "change_request.submitted",
  "change_request.approved",
  "change_request.denied",
  "schedule.slot_proposed",
  "schedule.confirmed",
  "schedule.rescheduled",
  "dispatch.assigned",
  "dispatch.eta_updated",
  "wo.dispatched",
  "wo.onsite",
  "wo.on_hold",
  "wo.resumed",
  "evidence.added",
  "checklist.updated",
  "wo.return_visit_required",
  "wo.closeout_pending",
  "closeout.validation_passed",
  "closeout.validation_failed",
  "qa.sampled",
  "qa.result_recorded",
  "billing.invoice_draft_generated",
  "billing.invoice_issued",
  "wo.closed",
  "billing.payment_recorded",
] as const;
export type AuditEventType = (typeof AuditEventTypes)[number];

export type AuditEvent = {
  event_id: ULID;
  event_type: AuditEventType;
  occurred_at: ISO8601;
  request_id: string;
  ticket_id?: ULID;
  account_id?: ULID;
  site_id?: ULID;
  actor: ActorRef;
  channel?: ChannelRef;
  previous_state?: TicketState;
  next_state?: TicketState;
  payload: Record<string, unknown>;
  metadata: {
    schema_version: typeof ContractVersion;
    correlation_id?: string;
  };
};

export const AllowedStateTransitions: Readonly<
  Record<TicketState, readonly TicketState[]>
> = {
  new: ["triaged", "schedulable", "canceled"],
  triaged: ["schedulable", "canceled"],
  schedulable: ["scheduled", "canceled"],
  scheduled: ["scheduled", "dispatched", "canceled"],
  dispatched: ["onsite"],
  onsite: ["closeout_pending"],
  closeout_pending: ["closed"],
  closed: [],
  canceled: [],
};

export function isAllowedStateTransition(from: TicketState, to: TicketState): boolean {
  return AllowedStateTransitions[from].includes(to);
}

export type StateTransition = `${TicketState}->${TicketState}`;

function transitionKey(from: TicketState, to: TicketState): StateTransition {
  return `${from}->${to}`;
}

const AllStateTransitions: StateTransition[] = Object.entries(
  AllowedStateTransitions,
).flatMap(([from, tos]) => tos.map((to) => transitionKey(from as TicketState, to)));

export const RoleAllowedStateTransitions: Readonly<
  Record<Role, readonly StateTransition[]>
> = {
  system_intake_agent: [
    transitionKey("new", "triaged"),
    transitionKey("new", "schedulable"),
    transitionKey("triaged", "schedulable"),
  ],
  system_scheduling_agent: [
    transitionKey("schedulable", "scheduled"),
    transitionKey("scheduled", "scheduled"),
    transitionKey("scheduled", "dispatched"),
  ],
  system_technician_liaison_agent: [
    transitionKey("dispatched", "onsite"),
    transitionKey("onsite", "closeout_pending"),
  ],
  system_closeout_agent: [transitionKey("closeout_pending", "closed")],
  operator_admin: AllStateTransitions,
  technician: [transitionKey("dispatched", "onsite")],
  customer: [],
};

export function isTransitionAllowedForRole(
  role: Role,
  from: TicketState,
  to: TicketState,
): boolean {
  if (!isAllowedStateTransition(from, to)) {
    return false;
  }

  return RoleAllowedStateTransitions[role].includes(transitionKey(from, to));
}

export const DispatchMutationActions = [
  "ticket.create",
  "ticket.add_message",
  "ticket.set_priority",
  "ticket.set_incident_type",
  "ticket.mark_triaged",
  "ticket.mark_schedulable",
  "ticket.cancel",
  "entitlement.evaluate",
  "approval.request",
  "approval.approve",
  "approval.deny",
  "schedule.propose_slots",
  "schedule.confirm",
  "schedule.reschedule",
  "dispatch.assign_tech",
  "dispatch.set_eta",
  "dispatch.mark_onsite",
  "dispatch.mark_on_hold",
  "dispatch.resume_from_hold",
  "closeout.add_note",
  "closeout.add_evidence",
  "closeout.record_parts",
  "closeout.record_labor",
  "closeout.checklist_complete",
  "closeout.mark_ready",
  "closeout.validate",
  "qa.sample",
  "qa.record_result",
  "billing.generate_invoice_draft",
  "billing.compile_closeout_packet",
  "ticket.close",
  "billing.issue_invoice",
  "billing.record_payment",
] as const;
export type DispatchMutationAction = (typeof DispatchMutationActions)[number];

export const RoleAllowedActions: Readonly<
  Record<Role, readonly DispatchMutationAction[]>
> = {
  system_intake_agent: [
    "ticket.create",
    "ticket.add_message",
    "ticket.set_priority",
    "ticket.set_incident_type",
    "ticket.mark_triaged",
    "ticket.mark_schedulable",
  ],
  system_scheduling_agent: [
    "ticket.add_message",
    "entitlement.evaluate",
    "approval.request",
    "schedule.propose_slots",
    "schedule.confirm",
    "schedule.reschedule",
    "dispatch.assign_tech",
    "dispatch.set_eta",
  ],
  system_technician_liaison_agent: [
    "ticket.add_message",
    "dispatch.mark_onsite",
    "dispatch.mark_on_hold",
    "dispatch.resume_from_hold",
    "closeout.add_note",
    "closeout.add_evidence",
    "closeout.record_parts",
    "closeout.record_labor",
    "closeout.checklist_complete",
    "closeout.mark_ready",
  ],
  system_closeout_agent: [
    "closeout.validate",
    "qa.sample",
    "qa.record_result",
    "billing.generate_invoice_draft",
    "billing.compile_closeout_packet",
    "ticket.close",
  ],
  operator_admin: DispatchMutationActions,
  technician: [
    "ticket.add_message",
    "dispatch.mark_onsite",
    "closeout.add_note",
    "closeout.add_evidence",
    "closeout.record_parts",
    "closeout.record_labor",
    "closeout.checklist_complete",
  ],
  customer: ["ticket.add_message"],
};

export function isActionAllowedForRole(
  role: Role,
  action: DispatchMutationAction,
): boolean {
  return RoleAllowedActions[role].includes(action);
}

export type ToolResult<T> = {
  request_id: string;
  ticket: WorkOrder;
  emitted_event_ids: ULID[];
  data: T;
};

export type TicketCreateInput = {
  request_id: string;
  actor: ActorRef;
  channel?: ChannelRef;
  account: AccountRef;
  site: SiteRef;
  requester: RequesterContact;
  service_terms?: ServiceTerms;
  incident: Pick<IncidentSnapshot, "summary" | "symptoms" | "urgency"> & {
    incident_type_id?: string;
    risk_flags?: RiskFlag[];
  };
  incident_template?: IncidentTemplate;
  priority?: Priority;
  asset?: AssetRef;
  initial_message?: {
    raw: string;
    normalized: string;
  };
};

export type TicketCreateOutput = ToolResult<{
  ticket_id: ULID;
}>;

export type TicketAddMessageInput = {
  request_id: string;
  actor: ActorRef;
  channel: ChannelRef;
  ticket_id: ULID;
  message: {
    raw: string;
    normalized: string;
    direction: "inbound" | "outbound";
  };
};

export type TicketAddMessageOutput = ToolResult<Record<string, never>>;

export type TicketSetPriorityInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  priority: Priority;
};

export type TicketSetPriorityOutput = ToolResult<{
  priority: Priority;
}>;

export type TicketSetIncidentTypeInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  incident_type_id: string;
  risk_flags: RiskFlag[];
};

export type TicketSetIncidentTypeOutput = ToolResult<{
  incident_type_id: string;
}>;

export type TicketMarkTriagedInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
};

export type TicketMarkTriagedOutput = ToolResult<Record<string, never>>;

export type TicketMarkSchedulableInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
};

export type TicketMarkSchedulableOutput = ToolResult<Record<string, never>>;

export type EntitlementEvaluateInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  decision: EntitlementCheckpointState;
  reason?: string;
};

export type EntitlementEvaluateOutput = ToolResult<{
  decision: EntitlementCheckpointState;
}>;

export type ApprovalRequestInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  type: ApprovalType;
  summary: string;
  requested_amount?: Money;
  requested_from: string[];
};

export type ApprovalRequestOutput = ToolResult<{
  approval_id: ULID;
}>;

export type ApprovalDecisionInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  approval_id: ULID;
  decision: Extract<ApprovalStatus, "approved" | "denied">;
  reason?: string;
};

export type ApprovalDecisionOutput = ToolResult<{
  approval_id: ULID;
  decision: Extract<ApprovalStatus, "approved" | "denied">;
}>;

export type ScheduleProposeSlotsInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  windows: AppointmentWindow[];
};

export type ScheduleProposeSlotsOutput = ToolResult<{
  proposed: AppointmentWindow[];
}>;

export type ScheduleConfirmInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  selected_window: AppointmentWindow;
  customer_confirmation_log: string;
};

export type ScheduleConfirmOutput = ToolResult<{
  confirmed: AppointmentWindow;
}>;

export type DispatchAssignTechInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  technician_id: ULID;
  reasoning: DispatchReasoning;
};

export type DispatchAssignTechOutput = ToolResult<{
  technician_id: ULID;
}>;

export type DispatchSetEtaInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  eta_at: ISO8601;
};

export type DispatchSetEtaOutput = ToolResult<{
  eta_at: ISO8601;
}>;

export type DispatchMarkOnsiteInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  check_in_at: ISO8601;
};

export type DispatchMarkOnsiteOutput = ToolResult<{
  check_in_at: ISO8601;
}>;

export type DispatchMarkOnHoldInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  reason: "parts" | "access" | "approval" | "safety" | "other";
  note: string;
};

export type DispatchMarkOnHoldOutput = ToolResult<Record<string, never>>;

export type DispatchResumeFromHoldInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  note?: string;
};

export type DispatchResumeFromHoldOutput = ToolResult<Record<string, never>>;

export type CloseoutAddEvidenceInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  evidence: Omit<EvidenceItem, "evidence_id" | "created_at" | "created_by">;
};

export type CloseoutAddEvidenceOutput = ToolResult<{
  evidence_id: ULID;
}>;

export type CloseoutAddNoteInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  note: string;
};

export type CloseoutAddNoteOutput = ToolResult<Record<string, never>>;

export type CloseoutRecordPartsInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  parts: Array<{
    part_number?: string;
    description: string;
    quantity: number;
    unit_cost_cents?: number;
  }>;
};

export type CloseoutRecordPartsOutput = ToolResult<Record<string, never>>;

export type CloseoutRecordLaborInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  labor_minutes: number;
  note?: string;
};

export type CloseoutRecordLaborOutput = ToolResult<Record<string, never>>;

export type CloseoutChecklistCompleteInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  item_key: CloseoutChecklistKey;
};

export type CloseoutChecklistCompleteOutput = ToolResult<{
  item_key: CloseoutChecklistKey;
}>;

export type CloseoutMarkReadyInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
};

export type CloseoutMarkReadyOutput = ToolResult<Record<string, never>>;

export type BillingGenerateInvoiceDraftInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
};

export type BillingGenerateInvoiceDraftOutput = ToolResult<{
  attachment_id: ULID;
}>;

export type BillingCompileCloseoutPacketInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
};

export type BillingCompileCloseoutPacketOutput = ToolResult<{
  attachment_id: ULID;
}>;

export type TicketCloseInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
};

export type TicketCloseOutput = ToolResult<Record<string, never>>;

export type BillingIssueInvoiceInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  invoice_total: Money;
};

export type BillingIssueInvoiceOutput = ToolResult<{
  invoice_total: Money;
}>;

export type BillingRecordPaymentInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  paid_at: ISO8601;
  amount: Money;
};

export type BillingRecordPaymentOutput = ToolResult<{
  paid_at: ISO8601;
  amount: Money;
}>;
