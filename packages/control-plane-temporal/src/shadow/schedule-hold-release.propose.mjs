const DEFAULT_CONFIRMATION_WINDOW_MINUTES = 15;
const DEFAULT_HOLD_REASON = "CUSTOMER_PENDING";
const HOUR_MINUTES = 60;
const HOLD_ENDPOINT = "/tickets/{ticketId}/schedule/hold";
const RELEASE_ENDPOINT = "/tickets/{ticketId}/schedule/release";

function sanitizeString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeTicketId(ticketIdInput) {
  return sanitizeString(ticketIdInput) ?? undefined;
}

function sanitizeTimelineLength(timeline) {
  if (Array.isArray(timeline?.events)) {
    return timeline.events.length;
  }
  if (Array.isArray(timeline)) {
    return timeline.length;
  }
  return 0;
}

function parseIsoDate(value) {
  const normalized = sanitizeString(value);
  if (normalized == null) {
    return null;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function buildDefaultWindow() {
  const now = new Date();
  const start = now.toISOString();
  const end = new Date(now.getTime() + DEFAULT_CONFIRMATION_WINDOW_MINUTES * 60_000).toISOString();
  return { start, end };
}

function normalizeConfirmationWindow(rawWindow) {
  const start = parseIsoDate(rawWindow?.start);
  const end = parseIsoDate(rawWindow?.end);

  if (start == null || end == null) {
    return buildDefaultWindow();
  }

  if (new Date(end).getTime() <= new Date(start).getTime()) {
    return buildDefaultWindow();
  }

  return { start, end };
}

function normalizeHoldReason(rawReason) {
  const normalized = sanitizeString(rawReason) || DEFAULT_HOLD_REASON;
  return normalized.toUpperCase();
}

function normalizeTraceContext(input = {}) {
  const raw =
    input.trace_context && typeof input.trace_context === "object" ? input.trace_context : null;
  return {
    trace_id: sanitizeString(input.trace_id) || sanitizeString(raw?.traceId) || null,
    trace_parent: sanitizeString(input.trace_parent) || sanitizeString(raw?.traceParent) || null,
    trace_state: sanitizeString(input.trace_state) || sanitizeString(raw?.traceState) || null,
    trace_source: sanitizeString(input.trace_source) || sanitizeString(raw?.source) || null,
  };
}

function resolveGeneratedAt(rawValue) {
  const parsed = parseIsoDate(rawValue);
  return parsed ?? new Date().toISOString();
}

function normalizeActionPayload() {
  const now = new Date();
  return {
    hold_reason: DEFAULT_HOLD_REASON,
    confirmation_window: {
      start: new Date(now.getTime() + 10 * 60_000).toISOString(),
      end: new Date(now.getTime() + HOUR_MINUTES * 60_000).toISOString(),
    },
  };
}

export function buildScheduleHoldReleaseProposal(input = {}) {
  const ticketId = normalizeTicketId(input.ticket_id ?? input.ticketId ?? input.id);
  if (ticketId == null) {
    throw new Error("ticket_id is required");
  }

  const ticket = input.ticket && typeof input.ticket === "object" ? input.ticket : null;
  const correlationId = sanitizeString(input.correlation_id);
  const timelineLength = sanitizeTimelineLength(input.timeline);
  const holdReason = normalizeHoldReason(input.hold_reason);
  const confirmationWindow = normalizeConfirmationWindow(input.confirmation_window);
  const traceContext = normalizeTraceContext(input);
  const generatedAt = resolveGeneratedAt(input.generated_at);

  const holdPayload = {
    hold_reason: holdReason,
    confirmation_window: confirmationWindow,
  };
  const releasePayload = {
    customer_confirmation_log: sanitizeString(input.confirmation_log) || "{{hold_id}}",
  };

  return {
    artifact_type: "dispatch-shadow-proposal",
    artifact_version: 1,
    generated_at: generatedAt,
    ticket_id: ticketId,
    correlation_id: correlationId,
    trace_context: traceContext,
    current_state: ticket?.state ?? null,
    timeline_length: timelineLength,
    proposed_actions: [
      {
        endpoint: HOLD_ENDPOINT.replace("{ticketId}", ticketId),
        method: "POST",
        payload: holdPayload,
      },
      {
        endpoint: RELEASE_ENDPOINT.replace("{ticketId}", ticketId),
        method: "POST",
        payload: releasePayload,
      },
    ],
    safety: {
      mutation_attempted: false,
      mode: "proposal",
    },
    decision: "PROPOSED",
    reason: "shadow_mode_no_side_effects",
    can_apply: false,
    fallback_plan: {
      suggested_confirmation_window_fallback: normalizeActionPayload(),
    },
  };
}
