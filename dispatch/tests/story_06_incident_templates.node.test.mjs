import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_INCIDENT_TEMPLATE_SET,
  IncidentTemplatePolicyError,
  evaluateCloseoutRequirements,
  getIncidentTemplate,
  loadIncidentTemplateSetFromFile,
  parseIncidentTemplateSet,
} from "../workflow-engine/rules/closeout-required-evidence.mjs";

test("default incident templates load deterministically and support normalized lookup", () => {
  assert.equal(DEFAULT_INCIDENT_TEMPLATE_SET.schema_version, "2026-02-13");
  assert.equal(DEFAULT_INCIDENT_TEMPLATE_SET.templates.length, 6);

  const fromLowercase = getIncidentTemplate("door_wont_latch");
  const fromMixedCase = getIncidentTemplate("Door_Wont_Latch");

  assert.ok(fromLowercase);
  assert.ok(fromMixedCase);
  assert.deepEqual(fromLowercase, fromMixedCase);
  assert.deepEqual(fromLowercase.required_checklist_keys, [
    "billing_authorization",
    "onsite_photos_after",
    "parts_used_or_needed",
    "resolution_status",
    "work_performed",
  ]);
});

test("unknown incident type fails closed with TEMPLATE_NOT_FOUND", () => {
  const result = evaluateCloseoutRequirements({
    incident_type: "UNMAPPED_INCIDENT",
    evidence_items: [],
    checklist_status: {},
  });

  assert.equal(result.ready, false);
  assert.equal(result.code, "TEMPLATE_NOT_FOUND");
  assert.equal(result.incident_type, "UNMAPPED_INCIDENT");
  assert.equal(result.template_version, null);
  assert.deepEqual(result.missing_evidence_keys, []);
  assert.deepEqual(result.missing_checklist_keys, []);
});

test("missing required evidence is rejected deterministically", () => {
  const result = evaluateCloseoutRequirements({
    incident_type: "DOOR_WONT_LATCH",
    evidence_items: [
      "photo_after_latched_alignment",
      "signature_or_no_signature_reason",
      { key: "note_adjustments_and_test_cycles" },
    ],
    checklist_status: {
      work_performed: true,
      parts_used_or_needed: true,
      resolution_status: true,
      onsite_photos_after: true,
      billing_authorization: true,
    },
  });

  assert.equal(result.ready, false);
  assert.equal(result.code, "MISSING_EVIDENCE");
  assert.deepEqual(result.missing_evidence_keys, ["photo_before_door_edge_and_strike"]);
  assert.deepEqual(result.missing_checklist_keys, []);
});

test("missing checklist items are rejected deterministically", () => {
  const result = evaluateCloseoutRequirements({
    incident_type: "DOOR_WONT_LATCH",
    evidence_items: [
      "photo_before_door_edge_and_strike",
      "photo_after_latched_alignment",
      "note_adjustments_and_test_cycles",
      "signature_or_no_signature_reason",
    ],
    checklist_status: {
      work_performed: true,
      parts_used_or_needed: false,
      resolution_status: true,
      onsite_photos_after: false,
      billing_authorization: true,
    },
  });

  assert.equal(result.ready, false);
  assert.equal(result.code, "MISSING_CHECKLIST");
  assert.deepEqual(result.missing_evidence_keys, []);
  assert.deepEqual(result.missing_checklist_keys, ["onsite_photos_after", "parts_used_or_needed"]);
});

test("missing evidence and checklist produce combined fail-closed result", () => {
  const result = evaluateCloseoutRequirements({
    incident_type: "AUTO_OPERATOR_FAULT",
    evidence_items: ["photo_before_operator_and_sensors"],
    checklist_status: {
      work_performed: true,
    },
  });

  assert.equal(result.ready, false);
  assert.equal(result.code, "MISSING_REQUIREMENTS");
  assert.deepEqual(result.missing_evidence_keys, [
    "note_cycle_and_sensor_tests",
    "photo_after_operator_and_sensors",
    "signature_or_no_signature_reason",
  ]);
  assert.deepEqual(result.missing_checklist_keys, [
    "billing_authorization",
    "onsite_photos_after",
    "parts_used_or_needed",
    "resolution_status",
  ]);
});

test("all required evidence and checklist gates pass when complete", () => {
  const result = evaluateCloseoutRequirements({
    incident_type: "AUTO_OPERATOR_FAULT",
    evidence_items: [
      "photo_before_operator_and_sensors",
      "photo_after_operator_and_sensors",
      "note_cycle_and_sensor_tests",
      "signature_or_no_signature_reason",
    ],
    checklist_status: {
      work_performed: true,
      parts_used_or_needed: true,
      resolution_status: true,
      onsite_photos_after: true,
      billing_authorization: true,
    },
  });

  assert.equal(result.ready, true);
  assert.equal(result.code, "READY");
  assert.deepEqual(result.missing_evidence_keys, []);
  assert.deepEqual(result.missing_checklist_keys, []);
});

test("invalid template sets fail closed at parse/load time", () => {
  assert.throws(
    () =>
      parseIncidentTemplateSet({
        schema_version: "x",
        templates: [
          {
            incident_type: "DUPLICATE",
            required_evidence_keys: ["one"],
            required_checklist_keys: ["work_performed"],
          },
          {
            incident_type: "duplicate",
            required_evidence_keys: ["two"],
            required_checklist_keys: ["work_performed"],
          },
        ],
      }),
    (error) => {
      assert.ok(error instanceof IncidentTemplatePolicyError);
      assert.equal(error.code, "INVALID_TEMPLATE_SET");
      return true;
    },
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "story06-templates-"));
  const badJsonPath = path.join(tempDir, "bad.json");
  fs.writeFileSync(badJsonPath, "{not-json", "utf8");

  assert.throws(
    () => loadIncidentTemplateSetFromFile(badJsonPath),
    (error) => {
      assert.ok(error instanceof IncidentTemplatePolicyError);
      assert.equal(error.code, "INVALID_TEMPLATE_SET");
      assert.equal(error.details.file_path, badJsonPath);
      return true;
    },
  );
});
