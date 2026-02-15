import { createHash, randomUUID } from "node:crypto";

const DEFAULT_LOOP_MS = 20_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_BATCH_LIMIT = 20;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;

const identity = process.env.DISPATCH_WORKER_IDENTITY || "dispatch-worker";
const actorId = process.env.DISPATCH_WORKER_ACTOR_ID || `${identity}-system`;
const actorRole = process.env.DISPATCH_WORKER_ACTOR_ROLE || "dispatcher";
const actorType = process.env.DISPATCH_WORKER_ACTOR_TYPE || "SERVICE";
const heartbeatMs = parsePositiveInt(process.env.DISPATCH_WORKER_HEARTBEAT_MS, DEFAULT_LOOP_MS);
const loopMs = parsePositiveInt(process.env.DISPATCH_WORKER_LOOP_MS, DEFAULT_LOOP_MS);
const requestTimeoutMs = parsePositiveInt(
  process.env.DISPATCH_WORKER_REQUEST_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
);
const batchLimit = parsePositiveInt(process.env.DISPATCH_WORKER_BATCH_LIMIT, DEFAULT_BATCH_LIMIT);
const shutdownTimeoutMs = parsePositiveInt(
  process.env.DISPATCH_WORKER_SHUTDOWN_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
);
const apiBaseUrl = normalizeBaseUrl(process.env.DISPATCH_API_URL || "http://127.0.0.1:8080");

const metrics = Object.seal({
  cycles: 0,
  api_calls: 0,
  recommendations: 0,
  dispatches: 0,
  skipped: 0,
  errors: 0,
  last_error: null,
});

let shuttingDown = false;
let tickTimer = null;
let shutdownRequested = false;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeBaseUrl(rawUrl) {
  const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (trimmed === "") {
    return "http://127.0.0.1:8080";
  }
  return trimmed.replace(/\/+$/u, "");
}

function toIsoDate(value) {
  return value.toISOString();
}

function logEvent(level, event, payload = {}) {
  const line = {
    level,
    service: "dispatch-worker",
    worker: identity,
    event,
    ts: toIsoDate(new Date()),
    ...payload,
  };
  if (level === "error") {
    console.error(JSON.stringify(line));
    return;
  }
  if (level === "warn") {
    console.warn(JSON.stringify(line));
    return;
  }
  console.log(JSON.stringify(line));
}

function buildUuidFromSeed(seed) {
  const hash = createHash("sha256").update(`${identity}|${seed}`).digest("hex");

  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(
    17,
    20,
  )}-${hash.slice(20, 32)}`;
}

function buildIdempotencyKey(action, ticketId) {
  return buildUuidFromSeed(`${action}|${ticketId}|${identity}`);
}

function buildCorrelation() {
  return randomUUID();
}

function buildApiHeaders({ toolName, idempotencyKey }) {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "x-actor-id": actorId,
    "x-actor-role": actorRole,
    "x-actor-type": actorType,
    "x-tool-name": toolName,
  };

  if (idempotencyKey) {
    headers["idempotency-key"] = idempotencyKey;
  }

  return headers;
}

function parseJsonSafe(rawBody) {
  if (rawBody == null || rawBody === "") {
    return null;
  }
  try {
    return JSON.parse(rawBody);
  } catch (error) {
    return {
      invalid_json: true,
      parse_error: error?.message || "invalid-json",
      raw: rawBody,
    };
  }
}

async function requestDispatchApi({ method, path, toolName, body = null, idempotencyKey = null }) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("dispatch-worker-request-timeout"),
    requestTimeoutMs,
  );
  const requestUrl = `${apiBaseUrl}${path}`;
  const requestBody = body == null ? undefined : JSON.stringify(body);
  const requestInit = {
    method,
    headers: buildApiHeaders({ toolName, idempotencyKey }),
    body: requestBody,
    signal: controller.signal,
  };

  metrics.api_calls += 1;
  try {
    const response = await fetch(requestUrl, requestInit);
    const rawBody = await response.text();
    const payload = parseJsonSafe(rawBody);
    if (!response.ok) {
      const parsedCode =
        payload && typeof payload === "object" ? payload.error_code || payload.code : null;
      const parsedMessage =
        payload && typeof payload === "object" ? payload.message || payload.error : rawBody;
      const apiError = new Error(
        `dispatch-api ${method} ${path} -> ${response.status} ${parsedCode || "error"}`,
      );
      apiError.name = "DispatchApiError";
      apiError.status = response.status;
      apiError.code = parsedCode || "API_ERROR";
      apiError.path = path;
      apiError.body = payload;
      apiError.message_text = parsedMessage;
      throw apiError;
    }

    return payload;
  } catch (error) {
    if (error?.name === "DispatchApiError") {
      throw error;
    }
    const wrapper = new Error(error?.message || "dispatch-api request failed");
    wrapper.name = "DispatchApiTransportError";
    wrapper.path = path;
    wrapper.method = method;
    wrapper.cause = error;
    throw wrapper;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeQueuedTicket(ticket) {
  if (ticket == null || typeof ticket !== "object") {
    return null;
  }
  const ticketId = ticket.ticket_id;
  if (typeof ticketId !== "string" || ticketId.trim() === "") {
    return null;
  }

  return {
    ticket_id: ticketId,
    state: ticket.state,
    service_type: ticket.incident_type || "DEFAULT",
    site_id: ticket.site_id || null,
    assigned_tech_id: ticket.assigned_tech || null,
  };
}

function summarizeQueue(tickets) {
  if (!Array.isArray(tickets)) {
    return {
      total: 0,
      with_tech: 0,
      missing_tech: 0,
    };
  }
  let withTech = 0;
  for (const ticket of tickets) {
    if (ticket?.assigned_tech_id) {
      withTech += 1;
    }
  }
  return {
    total: tickets.length,
    with_tech: withTech,
    missing_tech: tickets.length - withTech,
  };
}

async function recommendAndDispatch(ticket) {
  const recommendationPath = `/tickets/${ticket.ticket_id}/assignment/recommend`;
  const dispatchPath = `/tickets/${ticket.ticket_id}/assignment/dispatch`;
  const serviceType =
    typeof ticket.service_type === "string" && ticket.service_type.trim() !== ""
      ? ticket.service_type
      : "DEFAULT";
  const recommendationIdempotency = buildIdempotencyKey("recommend", ticket.ticket_id);
  const dispatchIdempotency = buildIdempotencyKey("dispatch", ticket.ticket_id);

  let recommendation;
  try {
    recommendation = await requestDispatchApi({
      method: "POST",
      path: recommendationPath,
      toolName: "assignment.recommend",
      body: {
        service_type: serviceType,
        recommendation_limit: 1,
      },
      idempotencyKey: recommendationIdempotency,
    });
    metrics.recommendations += 1;
  } catch (error) {
    metrics.errors += 1;
    metrics.last_error = `recommend:${error.code || error.name || "error"}`;
    logEvent("error", "worker.recommend_error", {
      ticket_id: ticket.ticket_id,
      error: error.message,
      code: error.code || error.name || "recommendation_failed",
      status: error.status || null,
      path: recommendationPath,
      correlation_id: buildCorrelation(),
    });
    return false;
  }

  const recommendations = Array.isArray(recommendation?.recommendations)
    ? recommendation.recommendations
    : [];
  const topTech = recommendations.find((entry) => entry && typeof entry.tech_id === "string");
  if (!topTech) {
    metrics.skipped += 1;
    logEvent("warn", "worker.no_recommendation", {
      ticket_id: ticket.ticket_id,
      summary: summarizeQueue([ticket]),
    });
    return false;
  }

  const dispatchPayload = {
    tech_id: topTech.tech_id,
    recommendation_snapshot_id: recommendation.snapshot_id || null,
    dispatch_mode: "WORKER_AUTO",
  };

  try {
    await requestDispatchApi({
      method: "POST",
      path: dispatchPath,
      toolName: "assignment.dispatch",
      body: dispatchPayload,
      idempotencyKey: dispatchIdempotency,
    });
    metrics.dispatches += 1;
    logEvent("info", "worker.dispatch_success", {
      ticket_id: ticket.ticket_id,
      tech_id: topTech.tech_id,
      recommendation_snapshot_id: recommendation.snapshot_id || null,
      correlation_id: buildCorrelation(),
    });
    return true;
  } catch (error) {
    metrics.errors += 1;
    metrics.last_error = `dispatch:${error.code || error.name || "error"}`;
    logEvent("error", "worker.dispatch_error", {
      ticket_id: ticket.ticket_id,
      tech_id: topTech.tech_id,
      error: error.message,
      code: error.code || error.name || "dispatch_failed",
      status: error.status || null,
      path: dispatchPath,
      correlation_id: buildCorrelation(),
    });
    return false;
  }
}

async function runCycle() {
  const correlation = buildCorrelation();
  if (shuttingDown) {
    return null;
  }

  metrics.cycles += 1;
  const cycle = metrics.cycles;
  let cockpit;
  try {
    cockpit = await requestDispatchApi({
      method: "GET",
      path: "/ux/dispatcher/cockpit?state=SCHEDULED",
      toolName: "dispatcher.cockpit",
    });
  } catch (error) {
    metrics.errors += 1;
    metrics.last_error = `cockpit:${error.code || error.name || "error"}`;
    logEvent("error", "worker.cockpit_error", {
      error: error.message,
      code: error.code || error.name || "cockpit_fetch_failed",
      status: error.status || null,
      correlation_id: correlation,
    });
    return {
      cycle,
      queued_count: 0,
      processed_count: 0,
      skipped_count: 0,
      success_count: 0,
    };
  }

  const rawQueue = Array.isArray(cockpit?.queue) ? cockpit.queue : [];
  const queue = rawQueue
    .map(normalizeQueuedTicket)
    .filter((ticket) => ticket && ticket.state === "SCHEDULED" && ticket.assigned_tech_id == null);
  const selected = queue.slice(0, batchLimit);
  const summary = summarizeQueue(selected);

  logEvent("info", "worker.heartbeat", {
    cycle,
    queue_total: summary.total,
    queue_missing_tech: summary.missing_tech,
    batch_limit: batchLimit,
    correlation_id: correlation,
  });

  let successCount = 0;
  let skippedCount = 0;

  for (const ticket of selected) {
    if (shuttingDown) {
      break;
    }

    const success = await recommendAndDispatch(ticket);
    if (success) {
      successCount += 1;
      continue;
    }
    skippedCount += 1;
  }

  return {
    cycle,
    queued_count: summary.total,
    processed_count: successCount + skippedCount,
    skipped_count: skippedCount,
    success_count: successCount,
  };
}

function clearTickTimer() {
  if (tickTimer != null) {
    clearTimeout(tickTimer);
    tickTimer = null;
  }
}

function requestShutdown(signal) {
  if (shutdownRequested) {
    return;
  }
  shutdownRequested = true;
  shuttingDown = true;
  clearTickTimer();
  logEvent("warn", "worker.shutdown_requested", {
    signal,
    cycle: metrics.cycles,
    pending_error_count: metrics.errors,
  });

  setTimeout(() => {
    if (!shuttingDown) {
      return;
    }
    logEvent("error", "worker.shutdown_forced", {
      signal,
      reason: "worker shutdown timeout exceeded",
      timeout_ms: shutdownTimeoutMs,
    });
    process.exit(1);
  }, shutdownTimeoutMs).unref();
}

process.on("SIGINT", () => {
  requestShutdown("SIGINT");
});
process.on("SIGTERM", () => {
  requestShutdown("SIGTERM");
});

async function runWorkerLoop() {
  shuttingDown = false;
  logEvent("info", "worker.started", {
    identity,
    actor_id: actorId,
    actor_role: actorRole,
    actor_type: actorType,
    api_base: apiBaseUrl,
    heartbeat_ms: heartbeatMs,
    loop_ms: loopMs,
    batch_limit,
    request_timeout_ms: requestTimeoutMs,
    idempotency_profile: "ticket-scoped deterministic uuid",
  });

  while (!shuttingDown) {
    const cycleSummary = await runCycle();
    if (cycleSummary) {
      logEvent("info", "worker.cycle_complete", cycleSummary);
    }
    if (shuttingDown) {
      break;
    }

    await new Promise((resolve) => {
      tickTimer = setTimeout(resolve, loopMs);
    });
    tickTimer = null;
  }

  logEvent("info", "worker.shutdown_complete", {
    cycles: metrics.cycles,
    api_calls: metrics.api_calls,
    recommendations: metrics.recommendations,
    dispatches: metrics.dispatches,
    skipped: metrics.skipped,
    errors: metrics.errors,
    last_error: metrics.last_error,
  });
}

runWorkerLoop().catch((error) => {
  clearTickTimer();
  logEvent("error", "worker.fatal_error", {
    message: error?.message || "worker loop crashed",
    stack: error?.stack || null,
  });
  process.exit(1);
});
