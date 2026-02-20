import { createHash } from "node:crypto";

const DISPATCH_SMS_ENABLED = parseBoolean(process.env.DISPATCH_SMS_ENABLED, false);
const DISPATCH_SMS_DRY_RUN = parseBoolean(process.env.DISPATCH_SMS_DRY_RUN, true);
const EXTERNAL_ADAPTER_PATH = process.env.DISPATCH_SMS_ADAPTER;

function parseBoolean(value, fallbackValue) {
  if (value == null) {
    return fallbackValue;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return fallbackValue;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "off", "no", "disabled"].includes(normalized)) {
    return false;
  }
  return fallbackValue;
}

function buildDeterministicMessageId(messageKey, to, body) {
  const digest = createHash("sha256");
  digest.update(`${messageKey ?? ""}|${to ?? ""}|${body ?? ""}`);
  return digest.digest("hex");
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

async function loadExternalAdapter() {
  if (!EXTERNAL_ADAPTER_PATH) {
    return null;
  }
  const adapterModule = await import(EXTERNAL_ADAPTER_PATH);
  const adapter = adapterModule?.sendSms;
  if (typeof adapter !== "function") {
    throw new Error("Configured DISPATCH_SMS_ADAPTER does not export sendSms");
  }
  return adapter;
}

function buildStubResponse(messageKey, to) {
  return {
    providerMessageId: buildDeterministicMessageId(messageKey, to, ""),
    provider: "stub-sms",
    status: "accepted",
    note: "stub mode",
  };
}

export async function sendSms({ to, body, messageKey }) {
  const normalizedTo = normalizeAddress(to);
  const normalizedBody = normalizeBody(body);
  const key = messageKey ?? `${normalizedTo}-${normalizedBody}`;

  if (!DISPATCH_SMS_ENABLED) {
    return {
      providerMessageId: buildDeterministicMessageId(
        `disabled:${key}`,
        normalizedTo,
        normalizedBody,
      ),
      provider: "disabled",
      status: "disabled",
      note: "DISPATCH_SMS_ENABLED is false",
    };
  }

  if (DISPATCH_SMS_DRY_RUN) {
    return {
      providerMessageId: buildDeterministicMessageId(
        `dry-run:${key}`,
        normalizedTo,
        normalizedBody,
      ),
      provider: "dry-run",
      status: "dry-run",
      note: "dispatch_sms_dry_run_enabled",
      recipient: normalizedTo,
    };
  }

  const adapter = await loadExternalAdapter();
  if (!adapter) {
    return {
      providerMessageId: buildDeterministicMessageId(`stub:${key}`, normalizedTo, normalizedBody),
      provider: "stub-sms",
      status: "accepted",
      note: "stub because no DISPATCH_SMS_ADAPTER configured",
      recipient: normalizedTo,
      body: normalizedBody,
    };
  }

  return adapter({
    to: normalizedTo,
    body: normalizedBody,
    messageKey: key,
  });
}

export function getSmsAdapterSignature() {
  return {
    enabled: DISPATCH_SMS_ENABLED,
    dryRun: DISPATCH_SMS_DRY_RUN,
    hasExternalAdapter: Boolean(EXTERNAL_ADAPTER_PATH),
  };
}
