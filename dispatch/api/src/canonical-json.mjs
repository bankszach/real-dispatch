import { createHash } from "node:crypto";

function normalize(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalize(entry));
  }

  if (value && typeof value === "object") {
    const record = value;
    const normalized = {};
    const keys = Object.keys(record).sort();
    for (const key of keys) {
      normalized[key] = normalize(record[key]);
    }
    return normalized;
  }

  return value;
}

export function canonicalJsonString(value) {
  return JSON.stringify(normalize(value));
}

export function canonicalJsonHash(value) {
  const digest = createHash("sha256");
  digest.update(canonicalJsonString(value));
  return digest.digest("hex");
}
