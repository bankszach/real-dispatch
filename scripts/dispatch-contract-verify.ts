#!/usr/bin/env -S node --import tsx

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DISPATCH_CONTRACT,
  type DispatchContract,
} from "../dispatch/contracts/dispatch-contract.v1.ts";
import {
  DISPATCH_COMMAND_ENDPOINT_POLICIES,
  DISPATCH_TOOL_POLICIES,
} from "../dispatch/shared/authorization-policy.mjs";

type ContractRecord = Record<string, DispatchContract>;

const KNOWN_TEST_TOOL_OVERRIDES = new Set(["metrics.view", "unknown.tool", "tool.never.real"]);
const ROOT = resolve(".");

const contract = DISPATCH_CONTRACT as ContractRecord;
const contractToolNames = Object.keys(contract).toSorted();
const contractRoutes = Object.fromEntries(
  contractToolNames.map((toolName) => [contract[toolName].route, toolName]),
);

const problems: string[] = [];

function stableStringify(value: unknown): string {
  if (value == null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.keys(value as object)
      .toSorted()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeStateList(values: unknown): string[] | null {
  if (values == null) {
    return null;
  }
  if (!Array.isArray(values)) {
    return ["__invalid__"];
  }
  return [...new Set(values)].toSorted().map((entry) => String(entry));
}

function assertEqual<T>(label: string, actual: T, expected: T) {
  if (actual === expected) {
    return;
  }
  problems.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertDeepEqual(label: string, actual: unknown, expected: unknown) {
  if (stableStringify(actual) === stableStringify(expected)) {
    return;
  }
  problems.push(`${label} does not match expected schema`);
}

function ensureContractMatchesPolicy() {
  for (const [toolName, contractEntry] of Object.entries(contract)) {
    const policy = DISPATCH_TOOL_POLICIES[toolName];
    if (!policy) {
      problems.push(`Missing authorization policy entry for tool '${toolName}'.`);
      continue;
    }

    assertEqual(`Policy method for '${toolName}'`, policy.method, contractEntry.http_method);
    assertEqual(`Policy endpoint for '${toolName}'`, policy.endpoint, contractEntry.route);

    const isMutating = contractEntry.http_method.toUpperCase() !== "GET";
    assertEqual(`Policy mutating flag for '${toolName}'`, policy.mutating, isMutating);
    assertEqual(
      `Policy requires ticket id for '${toolName}'`,
      policy.requires_ticket_id,
      contractEntry.route.includes("{ticketId}"),
    );
    assertEqual(
      `Policy idempotency flag for '${toolName}'`,
      policy.idempotency_required,
      contractEntry.idempotency_required,
    );
    assertDeepEqual(
      `Payload schema for '${toolName}'`,
      policy.payload_schema,
      contractEntry.payload_schema,
    );
    assertDeepEqual(
      `Bypass requirements for '${toolName}'`,
      policy.bypass_requirements,
      contractEntry.bypass_requirements,
    );

    assertDeepEqual(
      `Allowed roles for '${toolName}'`,
      [...policy.allowed_roles].toSorted(),
      [...contractEntry.allowed_roles].toSorted(),
    );
    assertDeepEqual(
      `Allowed from states for '${toolName}'`,
      normalizeStateList(policy.allowed_from_states),
      normalizeStateList(contractEntry.allowed_from_states),
    );
    assertEqual(
      `Expected to state for '${toolName}'`,
      policy.expected_to_state,
      contractEntry.resulting_state,
    );

    if (isMutating) {
      const endpointPolicy = DISPATCH_COMMAND_ENDPOINT_POLICIES[contractEntry.route];
      if (!endpointPolicy) {
        problems.push(`Missing command endpoint policy for route '${contractEntry.route}'.`);
        continue;
      }

      assertEqual(
        `Command endpoint for '${toolName}'`,
        endpointPolicy.endpoint,
        contractEntry.route,
      );
      assertEqual(
        `Command idempotency for '${toolName}'`,
        endpointPolicy.idempotency_required,
        contractEntry.idempotency_required,
      );
      if (!endpointPolicy.allowed_tool_names.includes(toolName)) {
        problems.push(
          `Command endpoint policy for '${contractEntry.route}' missing tool '${toolName}'.`,
        );
      }
    }
  }

  for (const policyTool of Object.keys(DISPATCH_TOOL_POLICIES)) {
    if (!contractToolNames.includes(policyTool)) {
      problems.push(`Orphan policy tool not in contract: '${policyTool}'.`);
    }
  }
}

function ensureRoutesExistInApi() {
  const serverSource = readFileSync(resolve(ROOT, "dispatch/api/src/server.mjs"), "utf8");
  for (const route of Object.values(contract)) {
    const endpoint = route.route;
    const inDouble = serverSource.includes(`endpoint: "${endpoint}"`);
    const inSingle = serverSource.includes(`endpoint: '${endpoint}'`);
    if (!inDouble && !inSingle) {
      problems.push(`No API route mapping found for contract endpoint '${endpoint}'.`);
    }
  }
}

function collectFiles(rootPath: string): string[] {
  const stats = statSync(rootPath);
  if (!stats.isDirectory()) {
    return [rootPath];
  }

  const entries = readdirSync(rootPath, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(fullPath);
    }
    if (!/\.(mjs|ts)$/.test(entry.name)) {
      return [];
    }
    return [fullPath];
  });
}

function ensureTestsReferenceKnownTools() {
  const testFiles = [
    ...collectFiles(resolve(ROOT, "dispatch/tests")),
    ...collectFiles(resolve(ROOT, "dispatch/tools-plugin/tests")),
  ];
  const observedToolNames = new Set<string>();

  const toolNamePattern = /toolName:\s*["'`]([^"'`]+)["'`]/g;
  for (const file of testFiles) {
    const body = readFileSync(file, "utf8");
    const matches = [...body.matchAll(toolNamePattern)];
    for (const match of matches) {
      observedToolNames.add(match[1]);
    }
  }

  for (const toolName of observedToolNames) {
    if (KNOWN_TEST_TOOL_OVERRIDES.has(toolName)) {
      continue;
    }
    if (!contractToolNames.includes(toolName)) {
      problems.push(`Test reference to undeclared tool '${toolName}'.`);
    }
  }
}

ensureContractMatchesPolicy();
ensureRoutesExistInApi();
ensureTestsReferenceKnownTools();

if (problems.length > 0) {
  console.error("dispatch-contract-verify: FAILED");
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  process.exit(1);
}

console.log("dispatch-contract-verify: OK");
console.log(`tools: ${contractToolNames.length}, routes: ${Object.keys(contractRoutes).length}`);
