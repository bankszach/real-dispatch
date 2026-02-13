// Real Dispatch core contracts.
// Source of truth: docs/rfcs/0001-dispatch-core-contracts-v0.md

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

export const CloseoutChecklistKeys = [
  "work_performed",
  "parts_used_or_needed",
  "resolution_status",
  "onsite_photos_after",
  "billing_authorization",
] as const;
export type CloseoutChecklistKey = (typeof CloseoutChecklistKeys)[number];

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
  | { kind: "internal"; peer: "system" };

export type Money = { currency: "USD"; amount_cents: number };

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

export type Ticket = {
  ticket_id: ULID;
  state: TicketState;

  created_at: ISO8601;
  updated_at: ISO8601;

  customer_id: ULID;

  customer: {
    site_name?: string;
    contact_name: string;
    phone?: string;
    email?: string;
  };

  service_location: Address;

  issue: {
    summary: string;
    classification?: string;
    door_system_type?: string;
    security_safety_status?: string;
    access_details?: string;
    photos_available?: boolean;
  };

  priority: "standard" | "emergency";

  billing: {
    account_type: "cod" | "account" | "national_account" | "tbd";
    emergency_rate_approved?: boolean;
    invoice_draft_attachment_id?: ULID;
    closeout_packet_attachment_id?: ULID;
    invoice_total?: Money;
  };

  assigned_technician_id?: ULID;

  schedule?: {
    status: "proposed" | "confirmed";
    window_start: ISO8601;
    window_end: ISO8601;
    timezone: string;
    eta_text?: string;
  };

  closeout: {
    checklist: Record<CloseoutChecklistKey, boolean>;
    completed_at?: ISO8601;
  };
};

export type Customer = {
  customer_id: ULID;
  display_name: string;
  phone?: string;
  email?: string;
};

export type Technician = {
  technician_id: ULID;
  display_name: string;
  phone?: string;
};

export type Attachment = {
  attachment_id: ULID;
  ticket_id: ULID;
  kind: "photo" | "pdf" | "audio" | "signature" | "packet" | "invoice_draft";
  storage_key: string;
  sha256?: string;
  content_type: string;
  size_bytes: number;
  created_at: ISO8601;
  created_by: ActorRef;
};

export const AuditEventTypes = [
  "ticket.created",
  "ticket.message_added",
  "ticket.priority_set",
  "ticket.state_changed",
  "schedule.slots_proposed",
  "schedule.confirmed",
  "dispatch.tech_assigned",
  "dispatch.eta_set",
  "closeout.note_added",
  "closeout.photo_added",
  "closeout.checklist_item_completed",
  "billing.invoice_draft_generated",
  "billing.closeout_packet_compiled",
] as const;

export type AuditEventType = (typeof AuditEventTypes)[number];

export type AuditEvent = {
  event_id: ULID;
  occurred_at: ISO8601;

  request_id: string;
  type: AuditEventType;

  ticket_id?: ULID;

  actor: ActorRef;
  channel?: ChannelRef;

  previous_state?: TicketState;
  next_state?: TicketState;

  payload: Record<string, unknown>;
};

// Explicit transition matrix for server-side enforcement.
export const AllowedStateTransitions: Readonly<Record<TicketState, readonly TicketState[]>> = {
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

// ------------------------
// Tool contracts (v0)
// ------------------------

export const DispatchMutationActions = [
  "ticket.create",
  "ticket.add_message",
  "ticket.set_priority",
  "schedule.propose_slots",
  "schedule.confirm",
  "dispatch.assign_tech",
  "dispatch.set_eta",
  "closeout.add_note",
  "closeout.add_photo",
  "closeout.checklist_complete",
  "billing.generate_invoice_draft",
  "billing.compile_closeout_packet",
] as const;

export type DispatchMutationAction = (typeof DispatchMutationActions)[number];

export const RoleAllowedActions: Readonly<Record<Role, readonly DispatchMutationAction[]>> = {
  system_intake_agent: ["ticket.create", "ticket.add_message", "ticket.set_priority"],
  system_scheduling_agent: [
    "ticket.add_message",
    "schedule.propose_slots",
    "schedule.confirm",
    "dispatch.assign_tech",
    "dispatch.set_eta",
  ],
  system_technician_liaison_agent: [
    "ticket.add_message",
    "closeout.add_note",
    "closeout.add_photo",
    "closeout.checklist_complete",
  ],
  system_closeout_agent: ["billing.generate_invoice_draft", "billing.compile_closeout_packet"],
  operator_admin: DispatchMutationActions,
  technician: ["ticket.add_message", "closeout.add_note", "closeout.add_photo"],
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
  ticket: Ticket;
  emitted_event_ids: ULID[];
  data: T;
};

export type TicketCreateInput = {
  request_id: string;
  actor: ActorRef;
  channel?: ChannelRef;

  customer: Ticket["customer"];
  service_location: Ticket["service_location"];
  issue: Ticket["issue"];
  billing_account_type?: Ticket["billing"]["account_type"];

  priority?: Ticket["priority"];

  initial_message?: {
    raw: string;
    normalized: string;
  };
};

export type TicketCreateOutput = ToolResult<{
  customer_id: ULID;
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
  priority: Ticket["priority"];
};

export type TicketSetPriorityOutput = ToolResult<{
  priority: Ticket["priority"];
}>;

export type ScheduleProposeSlotsInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;

  windows: Array<{
    window_start: ISO8601;
    window_end: ISO8601;
    timezone: string;
  }>;
};

export type ScheduleProposeSlotsOutput = ToolResult<{
  proposed: ScheduleProposeSlotsInput["windows"];
}>;

export type ScheduleConfirmInput = {
  request_id: string;
  actor: ActorRef;
  channel?: ChannelRef;
  ticket_id: ULID;

  selected_window: {
    window_start: ISO8601;
    window_end: ISO8601;
    timezone: string;
  };
};

export type ScheduleConfirmOutput = ToolResult<{
  confirmed: ScheduleConfirmInput["selected_window"];
}>;

export type DispatchAssignTechInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  technician_id: ULID;
};

export type DispatchAssignTechOutput = ToolResult<{
  technician_id: ULID;
}>;

export type DispatchSetEtaInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  eta_text: string;
};

export type DispatchSetEtaOutput = ToolResult<{
  eta_text: string;
}>;

export type CloseoutAddNoteInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  note: {
    text: string;
  };
};

export type CloseoutAddNoteOutput = ToolResult<Record<string, never>>;

export type CloseoutAddPhotoInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;

  photo: {
    storage_key: string;
    sha256?: string;
    content_type: string;
    size_bytes: number;
  };
};

export type CloseoutAddPhotoOutput = ToolResult<{
  attachment_id: ULID;
}>;

export type CloseoutChecklistCompleteInput = {
  request_id: string;
  actor: ActorRef;
  ticket_id: ULID;
  item_key: CloseoutChecklistKey;
};

export type CloseoutChecklistCompleteOutput = ToolResult<{
  item_key: CloseoutChecklistKey;
}>;

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
