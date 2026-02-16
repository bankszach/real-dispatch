function createMissingActivityProxy(name) {
  return () => {
    throw new Error(`Temporal workflow runtime missing dependency for activity '${name}'`);
  };
}

let proxyActivities;
try {
  ({ proxyActivities } = await import("@temporalio/workflow"));
} catch {
  proxyActivities = null;
}

const { readTicket, readTimeline } = proxyActivities
  ? proxyActivities({
      startToCloseTimeout: "1 minute",
    })
  : {
      readTicket: createMissingActivityProxy("readTicket"),
      readTimeline: createMissingActivityProxy("readTimeline"),
    };

const { holdSchedule, releaseSchedule } = proxyActivities
  ? proxyActivities({
      startToCloseTimeout: "1 minute",
    })
  : {
      holdSchedule: createMissingActivityProxy("holdSchedule"),
      releaseSchedule: createMissingActivityProxy("releaseSchedule"),
    };

const { proposeHoldReleasePlan } = proxyActivities
  ? proxyActivities({
      startToCloseTimeout: "1 minute",
    })
  : {
      proposeHoldReleasePlan: createMissingActivityProxy("proposeHoldReleasePlan"),
    };

function formatError(message) {
  return new Error(message);
}

function toSafeObject(value) {
  return value && typeof value === "object" ? value : null;
}

function normalizeTicketId(input) {
  const rawTicketId = input?.ticketId ?? input?.ticket_id ?? input?.id ?? "";
  if (typeof rawTicketId !== "string") {
    return "";
  }
  return rawTicketId.trim();
}

function normalizeHoldPayload(input) {
  const holdReason =
    typeof input?.hold_reason === "string" && input.hold_reason.trim() !== ""
      ? input.hold_reason.trim().toUpperCase()
      : undefined;
  const confirmationWindow = input?.confirmation_window;

  const start = confirmationWindow?.start;
  const end = confirmationWindow?.end;

  if (typeof start !== "string" || typeof end !== "string") {
    const now = new Date();
    const defaultWindow = {
      start: now.toISOString(),
      end: new Date(now.getTime() + 15 * 60_000).toISOString(),
    };
    return {
      hold_reason: holdReason || "CUSTOMER_PENDING",
      confirmation_window: defaultWindow,
    };
  }

  return {
    hold_reason: holdReason || "CUSTOMER_PENDING",
    confirmation_window: {
      start,
      end,
    },
  };
}

function normalizeTraceContext(input = {}) {
  const topLevelTraceId = typeof input.trace_id === "string" ? input.trace_id.trim() : "";
  const topLevelTraceParent =
    typeof input.trace_parent === "string" ? input.trace_parent.trim() : "";
  const topLevelTraceState = typeof input.trace_state === "string" ? input.trace_state.trim() : "";
  const context = toSafeObject(input.trace_context);
  const safeContext = toSafeObject(context) || {};

  return {
    trace_id:
      topLevelTraceId ||
      (typeof safeContext.traceId === "string" ? safeContext.traceId.trim() : null),
    trace_parent:
      topLevelTraceParent ||
      (typeof safeContext.traceParent === "string" ? safeContext.traceParent.trim() : null) ||
      (typeof safeContext.traceparent === "string" ? safeContext.traceparent.trim() : null),
    trace_state:
      topLevelTraceState ||
      (typeof safeContext.traceState === "string" ? safeContext.traceState.trim() : null) ||
      (typeof safeContext.tracestate === "string" ? safeContext.tracestate.trim() : null),
    trace_source:
      typeof input.trace_source === "string"
        ? input.trace_source.trim()
        : typeof safeContext.source === "string"
          ? safeContext.source.trim()
          : null,
  };
}

const SHADOW_WORKFLOW_HOOKS = Object.freeze(new Set(["SCHEDULE_HOLD_RELEASE_SHADOW"]));

function normalizeShadowAction(input = {}) {
  if (typeof input?.action === "string") {
    const upper = input.action.trim().toUpperCase();
    return upper || "SCHEDULE_HOLD_RELEASE_SHADOW";
  }
  return "SCHEDULE_HOLD_RELEASE_SHADOW";
}

function assertSupportedShadowAction(action) {
  if (!SHADOW_WORKFLOW_HOOKS.has(action)) {
    const supported = [...SHADOW_WORKFLOW_HOOKS].join(", ");
    throw formatError(
      `unsupported shadow workflow action '${action}'. Supported actions: ${supported}`,
    );
  }
}

const shadowWorkflowHookRegistry = Object.freeze({
  SCHEDULE_HOLD_RELEASE_SHADOW: async (input = {}, adapters = {}, traceContext = {}) => {
    const readTicketFn = adapters.readTicket;
    const readTimelineFn = adapters.readTimeline;
    const proposeHoldReleaseFn = adapters.proposeHoldReleasePlan;

    if (typeof proposeHoldReleaseFn !== "function") {
      throw formatError("proposeHoldReleasePlan activity is required");
    }

    const ticketId = normalizeTicketId(input);
    if (ticketId === "") {
      throw formatError("ticketId is required");
    }

    if (typeof readTicketFn === "function") {
      const ticketSnapshot = await readTicketFn(ticketId, {
        traceContext,
      });
      if (!ticketSnapshot || typeof ticketSnapshot !== "object") {
        throw formatError(`ticket ${ticketId} not found`);
      }
    }

    const normalizedHold = normalizeHoldPayload(input);
    const proposal = await proposeHoldReleaseFn({
      ticket_id: ticketId,
      hold_reason: normalizedHold.hold_reason,
      confirmation_window: normalizedHold.confirmation_window,
      trace_context: traceContext,
      action: "SCHEDULE_HOLD_RELEASE_SHADOW",
      source: "workflow_shadow",
    });

    let timelineLength = 0;
    if (typeof readTimelineFn === "function") {
      const timeline = await readTimelineFn(ticketId, {
        traceContext,
      });
      timelineLength = Array.isArray(timeline?.events) ? timeline.events.length : 0;
    }

    return {
      mode: "shadow",
      ticket_id: ticketId,
      shadow_intent: "propose_only",
      trace_context: traceContext,
      proposal,
      timeline_length: timelineLength,
      can_apply: false,
    };
  },
});

export function resolveShadowWorkflowHook(actionInput = {}) {
  return normalizeShadowAction(actionInput);
}

export async function runScheduleHoldReleaseWorkflow(input = {}, adapters = {}) {
  const ticketId = normalizeTicketId(input);
  if (ticketId === "") {
    throw formatError("ticketId is required");
  }

  const holdScheduleFn = adapters.holdSchedule;
  const releaseScheduleFn = adapters.releaseSchedule;
  if (typeof holdScheduleFn !== "function" || typeof releaseScheduleFn !== "function") {
    throw formatError("holdSchedule and releaseSchedule activities are required");
  }

  if (typeof adapters.readTicket === "function") {
    const preState = await adapters.readTicket(ticketId);
    if (!preState || typeof preState !== "object") {
      throw formatError(`ticket ${ticketId} not found`);
    }
  }

  const normalizedHold = normalizeHoldPayload(input);
  const hold = await holdScheduleFn(ticketId, {
    holdReason: normalizedHold.hold_reason,
    confirmationWindow: normalizedHold.confirmation_window,
  });

  const release = await releaseScheduleFn(ticketId, {
    confirmationLog: hold.hold_id,
  });

  let timelineLength = 0;
  if (typeof adapters.readTimeline === "function") {
    const timeline = await adapters.readTimeline(ticketId);
    timelineLength = Array.isArray(timeline?.events) ? timeline.events.length : 0;
  }

  return {
    ticket_id: ticketId,
    hold_id: hold.hold_id,
    hold_state: hold.hold_state || hold.ticket?.state || "PENDING_CUSTOMER_CONFIRMATION",
    released_state: release.ticket?.state || release.restored_state || null,
    timeline_length: timelineLength,
  };
}

export async function runScheduleHoldReleaseShadowWorkflow(input = {}, adapters = {}) {
  const action = resolveShadowWorkflowHook(input);
  assertSupportedShadowAction(action);
  const traceContext = normalizeTraceContext(input);
  return shadowWorkflowHookRegistry[action](input, adapters, traceContext);
}

export async function ticketReadbackWorkflow(input) {
  let ticketId = input?.ticketId;
  if (typeof ticketId !== "string" || ticketId.trim() === "") {
    throw new Error("ticketId is required");
  }

  ticketId = ticketId.trim();
  let closureArtifact = null;
  let ticket = null;
  let timeline = null;

  ticket = await readTicket(ticketId, toSafeObject(input));
  timeline = await readTimeline(ticketId, toSafeObject(input));

  closureArtifact = {
    ticketId,
    hasTicket: Boolean(ticket),
    timelineLength: Array.isArray(timeline) ? timeline.length : 0,
  };
  return closureArtifact;
}

export async function scheduleHoldReleaseWorkflow(input) {
  return runScheduleHoldReleaseWorkflow(input, {
    readTicket,
    readTimeline,
    holdSchedule,
    releaseSchedule,
  });
}

export async function scheduleHoldReleaseShadowWorkflow(input) {
  return runScheduleHoldReleaseShadowWorkflow(input, {
    readTicket,
    readTimeline,
    proposeHoldReleasePlan,
  });
}
