import fs from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_TEMPLATE_FILE = fileURLToPath(
  new URL("../../policy/incident_type_templates.v1.json", import.meta.url),
);

function stableSorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function normalizeIncidentType(value, fieldName = "incident_type") {
  if (typeof value !== "string" || value.trim() === "") {
    throw new IncidentTemplatePolicyError(
      "INVALID_TEMPLATE_SET",
      `Field '${fieldName}' must be a non-empty string`,
    );
  }
  return value.trim().toUpperCase();
}

function normalizeStringList(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new IncidentTemplatePolicyError(
      "INVALID_TEMPLATE_SET",
      `Field '${fieldName}' must be a non-empty array`,
    );
  }

  const normalized = value.map((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new IncidentTemplatePolicyError(
        "INVALID_TEMPLATE_SET",
        `Field '${fieldName}[${index}]' must be a non-empty string`,
      );
    }
    return item.trim();
  });

  return Object.freeze(stableSorted(Array.from(new Set(normalized))));
}

function normalizeTemplate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IncidentTemplatePolicyError("INVALID_TEMPLATE_SET", "Template entries must be objects");
  }

  const incidentType = normalizeIncidentType(value.incident_type, "incident_type");
  const version =
    typeof value.version === "string" && value.version.trim() !== "" ? value.version.trim() : "1.0.0";
  const requiredEvidenceKeys = normalizeStringList(value.required_evidence_keys, "required_evidence_keys");
  const requiredChecklistKeys = normalizeStringList(
    value.required_checklist_keys,
    "required_checklist_keys",
  );

  return Object.freeze({
    incident_type: incidentType,
    version,
    required_evidence_keys: requiredEvidenceKeys,
    required_checklist_keys: requiredChecklistKeys,
  });
}

export class IncidentTemplatePolicyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "IncidentTemplatePolicyError";
    this.code = code;
    this.details = details;
  }
}

export function parseIncidentTemplateSet(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new IncidentTemplatePolicyError("INVALID_TEMPLATE_SET", "Template set must be an object");
  }

  const schemaVersion =
    typeof raw.schema_version === "string" && raw.schema_version.trim() !== ""
      ? raw.schema_version.trim()
      : "unknown";

  if (!Array.isArray(raw.templates) || raw.templates.length === 0) {
    throw new IncidentTemplatePolicyError(
      "INVALID_TEMPLATE_SET",
      "Field 'templates' must be a non-empty array",
    );
  }

  const byIncidentType = {};
  for (const entry of raw.templates) {
    const template = normalizeTemplate(entry);
    if (byIncidentType[template.incident_type]) {
      throw new IncidentTemplatePolicyError(
        "INVALID_TEMPLATE_SET",
        `Duplicate incident template '${template.incident_type}'`,
      );
    }
    byIncidentType[template.incident_type] = template;
  }

  const templates = Object.freeze(
    stableSorted(Object.keys(byIncidentType)).map((incidentType) => byIncidentType[incidentType]),
  );

  return Object.freeze({
    schema_version: schemaVersion,
    templates,
    templates_by_incident_type: Object.freeze({ ...byIncidentType }),
  });
}

export function loadIncidentTemplateSetFromFile(filePath = DEFAULT_TEMPLATE_FILE) {
  const rawText = fs.readFileSync(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new IncidentTemplatePolicyError("INVALID_TEMPLATE_SET", "Template file must be valid JSON", {
      file_path: filePath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    return parseIncidentTemplateSet(parsed);
  } catch (error) {
    if (error instanceof IncidentTemplatePolicyError) {
      throw new IncidentTemplatePolicyError(error.code, error.message, {
        ...error.details,
        file_path: filePath,
      });
    }
    throw error;
  }
}

export const DEFAULT_INCIDENT_TEMPLATE_SET = loadIncidentTemplateSetFromFile();

export function getIncidentTemplate(incidentType, templateSet = DEFAULT_INCIDENT_TEMPLATE_SET) {
  const normalizedIncidentType = normalizeIncidentType(incidentType);
  return templateSet.templates_by_incident_type[normalizedIncidentType] ?? null;
}

function collectEvidenceKeys(evidenceItems) {
  if (!Array.isArray(evidenceItems)) {
    return new Set();
  }

  const keys = [];
  for (const item of evidenceItems) {
    if (typeof item === "string" && item.trim() !== "") {
      keys.push(item.trim());
      continue;
    }

    if (item && typeof item === "object") {
      if (typeof item.key === "string" && item.key.trim() !== "") {
        keys.push(item.key.trim());
      }
    }
  }

  return new Set(keys);
}

function missingChecklistKeys(requiredChecklistKeys, checklistStatus) {
  if (!checklistStatus || typeof checklistStatus !== "object" || Array.isArray(checklistStatus)) {
    return [...requiredChecklistKeys];
  }

  const missing = [];
  for (const key of requiredChecklistKeys) {
    if (checklistStatus[key] !== true) {
      missing.push(key);
    }
  }
  return missing;
}

export function evaluateCloseoutRequirements(input, templateSet = DEFAULT_INCIDENT_TEMPLATE_SET) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new IncidentTemplatePolicyError("INVALID_INPUT", "Input must be an object");
  }

  const incidentType = normalizeIncidentType(input.incident_type);
  const template = getIncidentTemplate(incidentType, templateSet);

  if (!template) {
    return {
      ready: false,
      code: "TEMPLATE_NOT_FOUND",
      incident_type: incidentType,
      template_version: null,
      missing_evidence_keys: [],
      missing_checklist_keys: [],
    };
  }

  const evidenceKeys = collectEvidenceKeys(input.evidence_items);
  const missingEvidenceKeys = template.required_evidence_keys.filter((key) => !evidenceKeys.has(key));
  const missingChecklist = missingChecklistKeys(template.required_checklist_keys, input.checklist_status);

  const missingEvidenceSorted = stableSorted(missingEvidenceKeys);
  const missingChecklistSorted = stableSorted(missingChecklist);

  const code =
    missingEvidenceSorted.length > 0 && missingChecklistSorted.length > 0
      ? "MISSING_REQUIREMENTS"
      : missingEvidenceSorted.length > 0
        ? "MISSING_EVIDENCE"
        : missingChecklistSorted.length > 0
          ? "MISSING_CHECKLIST"
          : "READY";

  return {
    ready: code === "READY",
    code,
    incident_type: incidentType,
    template_version: template.version,
    missing_evidence_keys: missingEvidenceSorted,
    missing_checklist_keys: missingChecklistSorted,
  };
}
