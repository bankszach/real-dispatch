import { DISPATCH_CONTRACT } from "../contracts/dispatch-contract.v1.ts";

export const DISPATCH_CANONICAL_ROLES = Object.freeze({
  DISPATCHER: "dispatcher",
  TECH: "technician",
  TECHNICIAN: "technician",
  AUDIT: "audit",
  SYSTEM: "system",
  AGENT: "agent",
  CUSTOMER: "customer",
  APPROVER: "approver",
  QA: "qa",
  FINANCE: "finance",
  ADMIN: "admin",
});

export const DISPATCH_ROLE_ALIASES = Object.freeze({
  dispatcher: "dispatcher",
  admin: "admin",
  technician: "technician",
  tech: "technician",
  audit: "audit",
  system: "system",
  dispatcher_admin: "dispatcher",
  agent: "agent",
  customer: "customer",
  approver: "approver",
  qa: "qa",
  finance: "finance",
  assistant: "dispatcher",
  bot: "dispatcher",
});

const DISPATCH_CANONICAL_ROLE_SET = new Set(Object.values(DISPATCH_CANONICAL_ROLES));

function routeNeedsTicket(route) {
  return typeof route === "string" && route.includes("{ticketId}");
}

function normalizeHttpMethod(method) {
  return typeof method === "string" ? method.toUpperCase() : "";
}

function freezePolicyMap(map) {
  const entries = Object.entries(map).map(([key, value]) => {
    const copy = {
      ...value,
      allowed_roles: Object.freeze([...(value.allowed_roles ?? [])]),
      allowed_from_states: Array.isArray(value.allowed_from_states)
        ? Object.freeze([...(value.allowed_from_states ?? [])])
        : null,
      payload_schema: value.payload_schema,
      bypass_requirements: value.bypass_requirements,
      idempotency_required: Boolean(value.idempotency_required),
    };
    return [key, Object.freeze(copy)];
  });
  return Object.freeze(Object.fromEntries(entries));
}

function buildEndpointPolicyMap(toolPolicies) {
  const mutable = {};

  for (const policy of Object.values(toolPolicies)) {
    if (!policy.mutating) {
      continue;
    }

    const current = mutable[policy.endpoint] ?? {
      endpoint: policy.endpoint,
      method: policy.method,
      default_tool_name: policy.tool_name,
      allowed_tool_names: [],
      allowed_roles: new Set(),
      expected_to_state: policy.expected_to_state,
      allowed_from_states: policy.allowed_from_states,
      idempotency_required: policy.idempotency_required,
    };

    current.allowed_tool_names.push(policy.tool_name);
    for (const role of policy.allowed_roles) {
      current.allowed_roles.add(role);
    }

    mutable[policy.endpoint] = current;
  }

  const entries = Object.entries(mutable).map(([endpoint, value]) => [
    endpoint,
    Object.freeze({
      endpoint: value.endpoint,
      method: value.method,
      default_tool_name: value.default_tool_name,
      allowed_tool_names: Object.freeze(value.allowed_tool_names),
      allowed_roles: Object.freeze(Array.from(value.allowed_roles)),
      expected_to_state: value.expected_to_state,
      allowed_from_states: value.allowed_from_states,
      idempotency_required: value.idempotency_required,
    }),
  ]);

  return Object.freeze(Object.fromEntries(entries));
}

const TOOL_POLICIES_RAW = (() => {
  const generated = {};
  for (const [toolName, contract] of Object.entries(DISPATCH_CONTRACT)) {
    generated[toolName] = {
      tool_name: contract.tool_name,
      method: contract.http_method,
      endpoint: contract.route,
      mutating: normalizeHttpMethod(contract.http_method) !== "GET",
      requires_ticket_id: routeNeedsTicket(contract.route),
      allowed_roles: [...contract.allowed_roles],
      expected_to_state: contract.resulting_state,
      allowed_from_states: contract.allowed_from_states,
      idempotency_required: contract.idempotency_required,
      payload_schema: contract.payload_schema,
      bypass_requirements: contract.bypass_requirements,
    };
  }
  return Object.freeze(generated);
})();

export const DISPATCH_TOOL_POLICIES = freezePolicyMap(TOOL_POLICIES_RAW);

export const DISPATCH_COMMAND_ENDPOINT_POLICIES = buildEndpointPolicyMap(DISPATCH_TOOL_POLICIES);

export function getDispatchToolPolicy(toolName) {
  if (typeof toolName !== "string") {
    return null;
  }
  return DISPATCH_TOOL_POLICIES[toolName] ?? null;
}

export function getCommandEndpointPolicy(endpoint) {
  if (typeof endpoint !== "string") {
    return null;
  }
  return DISPATCH_COMMAND_ENDPOINT_POLICIES[endpoint] ?? null;
}

export function isRoleAllowedForCommandEndpoint(endpoint, actorRole) {
  const policy = getCommandEndpointPolicy(endpoint);
  if (!policy || typeof actorRole !== "string") {
    return false;
  }
  return policy.allowed_roles.includes(actorRole.toLowerCase());
}

export function isToolAllowedForCommandEndpoint(endpoint, toolName) {
  const policy = getCommandEndpointPolicy(endpoint);
  if (!policy || typeof toolName !== "string") {
    return false;
  }
  return policy.allowed_tool_names.includes(toolName);
}

export function getContractToolPolicyByEndpoint(endpoint) {
  if (typeof endpoint !== "string") {
    return null;
  }
  for (const policy of Object.values(DISPATCH_TOOL_POLICIES)) {
    if (policy.endpoint === endpoint) {
      return policy;
    }
  }
  return null;
}

export function normalizeDispatchRole(value, sourceLabel = "role") {
  if (typeof value !== "string") {
    throw new Error(`${sourceLabel} must be a string`);
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "") {
    throw new Error(`${sourceLabel} is required`);
  }

  const canonicalRole = DISPATCH_ROLE_ALIASES[normalized] ?? normalized;
  if (!DISPATCH_CANONICAL_ROLE_SET.has(canonicalRole)) {
    const allowed = [...DISPATCH_CANONICAL_ROLE_SET].toSorted().join(", ");
    throw new Error(
      `${sourceLabel} '${value}' is not a recognized role. Allowed roles: ${allowed}`,
    );
  }

  return canonicalRole;
}
