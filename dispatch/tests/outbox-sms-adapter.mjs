import { createHash } from "node:crypto";

let behavior = "accept";
let sendHistory = [];
let failOnceUsed = false;

function buildMessageId(messageKey, body) {
  const digest = createHash("sha256");
  digest.update(`${messageKey ?? ""}|${body ?? ""}`);
  return digest.digest("hex").slice(0, 24);
}

function normalizeAddress(rawAddress) {
  if (typeof rawAddress !== "string") {
    return "UNKNOWN_RECIPIENT";
  }
  const trimmed = rawAddress.trim();
  return trimmed === "" ? "UNKNOWN_RECIPIENT" : trimmed;
}

function normalizeBody(rawBody) {
  if (typeof rawBody !== "string") {
    return "";
  }
  return rawBody;
}

export function resetAdapterState() {
  sendHistory = [];
  failOnceUsed = false;
}

export function setAdapterMode(nextMode) {
  behavior = nextMode === "always_fail" || nextMode === "fail_once" ? nextMode : "accept";
  failOnceUsed = false;
}

export function getAdapterState() {
  return {
    behavior,
    sendCount: sendHistory.length,
    failOnceUsed,
    calls: [...sendHistory],
  };
}

export async function sendSms({ to, body, messageKey }) {
  const normalizedTo = normalizeAddress(to);
  const normalizedBody = normalizeBody(body);
  const effectiveMessageKey = messageKey ?? `${normalizedTo}:${normalizedBody}`;

  sendHistory.push({
    to: normalizedTo,
    body: normalizedBody,
    messageKey: effectiveMessageKey,
    behavior,
    at: new Date().toISOString(),
  });

  if (behavior === "fail_once" && !failOnceUsed) {
    failOnceUsed = true;
    throw new Error("mock sms adapter: fail_once");
  }

  if (behavior === "always_fail") {
    throw new Error("mock sms adapter: always_fail");
  }

  return {
    providerMessageId: buildMessageId(effectiveMessageKey, normalizedBody),
    provider: "mock-sms-adapter",
    status: "accepted",
    note: "mock adapter accept",
  };
}
