import assert from "node:assert/strict";
import test from "node:test";
import { startDispatchApi } from "../api/src/server.mjs";
import { DISPATCH_CONTRACT } from "../contracts/dispatch-contract.v1.ts";

const NULL_SENTINEL = "__NULL__";

const transitionKey = (fromState, toState) => `${fromState ?? NULL_SENTINEL}->${toState}`;

const collectContractTransitions = () => {
  const transitions = new Set();
  for (const contract of Object.values(DISPATCH_CONTRACT)) {
    if (!contract || typeof contract.resulting_state !== "string") {
      continue;
    }
    const toState = String(contract.resulting_state).trim();
    if (toState === "") {
      continue;
    }

    const fromStates = Array.isArray(contract.allowed_from_states)
      ? contract.allowed_from_states
      : contract.allowed_from_states == null
        ? [null]
        : [];
    for (const rawFromState of fromStates) {
      const fromState = rawFromState == null ? null : String(rawFromState).trim();
      if (fromState === "") {
        continue;
      }
      transitions.add(transitionKey(fromState, toState));
    }
  }
  return transitions;
};

const buildConstraintDefinition = (transitionKeys) => {
  const grouped = new Map();
  for (const key of transitionKeys) {
    const separatorIndex = key.indexOf("->");
    const fromState = key.slice(0, separatorIndex);
    const toState = key.slice(separatorIndex + 2);

    const normalizedFrom = fromState === NULL_SENTINEL ? null : fromState;
    const existing = grouped.get(normalizedFrom) ?? [];
    existing.push(toState);
    grouped.set(normalizedFrom, [...existing]);
  }

  const clauses = [...grouped.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .flatMap(([fromState, states]) => {
      const orderedStates = [...new Set(states)].toSorted();
      if (orderedStates.length === 0) {
        return [];
      }
      if (orderedStates.length === 1) {
        const nextState = orderedStates[0];
        return [
          `(${fromState == null ? "from_state IS NULL" : `from_state='${fromState}'`} AND to_state='${nextState}')`,
        ];
      }
      const inList = orderedStates.map((state) => `'${state}'`);
      return [
        `(${fromState == null ? "from_state IS NULL" : `from_state='${fromState}'`} AND to_state IN (${inList.join(",")}))`,
      ];
    });

  return `CHECK (${clauses.join(" OR ")})`;
};

const healthPool = (stateTransitionConstraintDefinition) => ({
  async query() {
    return {
      rows: [
        {
          db_query_ok: true,
          has_tickets_table: true,
          has_evidence_immutable_column: true,
          has_closeout_artifacts_table: true,
          has_ticket_state_enum: true,
          has_cancelled_state_transition_label: true,
          has_state_transition_constraint: true,
          state_transition_constraint_definition: stateTransitionConstraintDefinition,
          state_transition_constraint_name: "chk_ticket_state_transition_valid",
        },
      ],
    };
  },
});

const runHealthWithTransitionSet = async (transitionKeys) => {
  const constraintDefinition = buildConstraintDefinition(transitionKeys);
  const app = await startDispatchApi({
    host: "127.0.0.1",
    port: 0,
    pool: healthPool(constraintDefinition),
  });
  const started = await app.start();
  try {
    const response = await fetch(`http://${started.host}:${started.port}/health`);
    return {
      status: response.status,
      body: await response.json(),
    };
  } finally {
    await app.stop();
  }
};

const baseTransitionKeys = collectContractTransitions();

test("health check passes when DB constraint exactly matches contract graph", async () => {
  const result = await runHealthWithTransitionSet(baseTransitionKeys);
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "ok");
  assert.equal(result.body.failures.length, 0);
});

test("health check fails when a SSOT transition is missing from DB constraint", async () => {
  const missingTransition = [...baseTransitionKeys].find((key) => key.includes("->"));
  assert.ok(missingTransition, "expected at least one contract transition");

  const transitionKeys = new Set(baseTransitionKeys);
  transitionKeys.delete(missingTransition);

  const result = await runHealthWithTransitionSet(transitionKeys);
  assert.equal(result.status, 503);
  assert.equal(result.body.status, "unhealthy");
  assert.ok(
    result.body.failures.some((failure) => failure.name === missingTransition),
    `expected failure for missing transition ${missingTransition}`,
  );
});

test("health check fails when DB allows a transition not represented in contract", async () => {
  const syntheticTransition = transitionKey("CLOSED", "NEW");
  assert.ok(
    !baseTransitionKeys.has(syntheticTransition),
    "fixture transition unexpectedly exists in contract",
  );

  const transitionKeys = new Set(baseTransitionKeys);
  transitionKeys.add(syntheticTransition);

  const result = await runHealthWithTransitionSet(transitionKeys);
  assert.equal(result.status, 503);
  assert.equal(result.body.status, "unhealthy");
  assert.ok(
    result.body.failures.some((failure) => failure.name === syntheticTransition),
    `expected failure for DB-only transition ${syntheticTransition}`,
  );
});

test("health check fails when override and normal tools share the same from->to transition", async (t) => {
  const overlapTransition = transitionKey("READY_TO_SCHEDULE", "SCHEDULED");

  DISPATCH_CONTRACT["__test__.drift_override_overlap"] = {
    tool_name: "force_override_overlap",
    allowed_roles: ["dispatcher"],
    allowed_from_states: ["READY_TO_SCHEDULE"],
    resulting_state: "SCHEDULED",
    payload_schema: {},
    idempotency_required: false,
  };

  t.after(async () => {
    delete DISPATCH_CONTRACT["__test__.drift_override_overlap"];
  });

  const transitionKeys = collectContractTransitions();
  assert.ok(transitionKeys.has(overlapTransition));

  const result = await runHealthWithTransitionSet(transitionKeys);
  assert.equal(result.status, 503);
  assert.equal(result.body.status, "unhealthy");
  assert.ok(
    result.body.failures.some((failure) => failure.name === overlapTransition),
    `expected overlap failure for ${overlapTransition}`,
  );
});
