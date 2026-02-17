import { Type } from "@sinclair/typebox";
import { DISPATCH_TOOL_POLICIES } from "../../shared/authorization-policy.mjs";
import { DispatchBridgeError, invokeDispatchAction } from "./bridge.mjs";

/**
 * Closed dispatch tool bridge plugin.
 *
 * This plugin only exposes an allowlisted set of dispatch tools and forwards
 * calls to dispatch-api. Unknown/forbidden actions fail closed.
 */
export default function register(api: {
  pluginConfig?: Record<string, unknown>;
  logger?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
  registerTool: (
    spec: {
      name: string;
      description: string;
      parameters: unknown;
      execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
    },
    opts?: { optional?: boolean },
  ) => void;
}) {
  const actorTypeSchema = Type.Union([
    Type.Literal("HUMAN"),
    Type.Literal("AGENT"),
    Type.Literal("SERVICE"),
    Type.Literal("SYSTEM"),
  ]);
  const actorRoleSchema = Type.String({ minLength: 1 });
  const uuidSchema = Type.String({ format: "uuid", minLength: 36, maxLength: 36 });
  const isoDateTimeSchema = Type.String({ format: "date-time", minLength: 20 });
  const nonNegativeNumberSchema = Type.Number({ minimum: 0 });
  const prioritySchema = Type.Union([
    Type.Literal("EMERGENCY"),
    Type.Literal("URGENT"),
    Type.Literal("ROUTINE"),
  ]);
  const confidencePercentSchema = Type.Number({ minimum: 0, maximum: 100 });
  const schedulingWindowSchema = Type.Object(
    {
      start: isoDateTimeSchema,
      end: isoDateTimeSchema,
    },
    { additionalProperties: true },
  );
  const checklistStatusSchema = Type.Object({}, { additionalProperties: true });
  const locationSchema = Type.Object({}, { additionalProperties: true });
  const metadataSchema = Type.Object({}, { additionalProperties: true });
  const holdReasonSchema = Type.Union([
    Type.Literal("CUSTOMER_PENDING"),
    Type.Literal("CUSTOMER_UNREACHABLE"),
    Type.Literal("CUSTOMER_CONFIRMATION_STALE"),
  ]);
  const resultSchema = Type.Union([Type.Literal("PASS"), Type.Literal("FAIL")]);
  const evidenceDecisionSchema = Type.Union([Type.Literal("APPROVED"), Type.Literal("DENIED")]);
  const dispatchModeSchema = Type.Union([
    Type.Literal("STANDARD"),
    Type.Literal("EMERGENCY_BYPASS"),
  ]);
  const approvalTypeSchema = Type.Union([Type.Literal("NTE_INCREASE"), Type.Literal("PROPOSAL")]);
  const scheduleActionSchema = Type.Object(
    {
      hold_reason: holdReasonSchema,
      confirmation_window: schedulingWindowSchema,
    },
    { additionalProperties: true },
  );
  const serviceTypeSchema = Type.String({ minLength: 1 });
  const recommendationLimitSchema = Type.Integer({ minimum: 1, maximum: 20 });
  const autonomyGlobalScopeSchema = Type.Object(
    {
      scope_type: Type.Optional(Type.Literal("GLOBAL")),
      reason: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  );
  const autonomyIncidentScopeSchema = Type.Object(
    {
      scope_type: Type.Literal("INCIDENT"),
      incident_type: Type.String({ minLength: 1 }),
      reason: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  );
  const autonomyTicketScopeSchema = Type.Object(
    {
      scope_type: Type.Literal("TICKET"),
      ticket_id: uuidSchema,
      reason: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  );
  const autonomyScopeSchema = Type.Union([
    autonomyGlobalScopeSchema,
    autonomyIncidentScopeSchema,
    autonomyTicketScopeSchema,
  ]);
  const unknownPayloadSchema = Type.Object({}, { additionalProperties: true });
  const payloadSchemas = {
    "ticket.create": Type.Object(
      {
        account_id: uuidSchema,
        site_id: uuidSchema,
        summary: Type.String({ minLength: 1 }),
        description: Type.Optional(Type.String({ minLength: 1 })),
        asset_id: Type.Optional(uuidSchema),
        nte_cents: Type.Optional(nonNegativeNumberSchema),
      },
      { additionalProperties: true },
    ),
    "ticket.blind_intake": Type.Object(
      {
        account_id: uuidSchema,
        site_id: uuidSchema,
        summary: Type.String({ minLength: 1 }),
        incident_type: Type.String({ minLength: 1 }),
        customer_name: Type.String({ minLength: 1 }),
        contact_phone: Type.Optional(Type.String({ minLength: 7 })),
        contact_email: Type.Optional(Type.String({ format: "email" })),
        priority: prioritySchema,
        description: Type.Optional(Type.String({ minLength: 1 })),
        nte_cents: Type.Optional(nonNegativeNumberSchema),
        identity_confidence: confidencePercentSchema,
        classification_confidence: confidencePercentSchema,
        sop_handoff_acknowledged: Type.Optional(Type.Boolean()),
        sop_handoff_prompt: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: true },
    ),
    "ticket.triage": Type.Object(
      {
        priority: prioritySchema,
        incident_type: Type.String({ minLength: 1 }),
        nte_cents: Type.Optional(nonNegativeNumberSchema),
        workflow_outcome: Type.Optional(
          Type.Union([
            Type.Literal("TRIAGED"),
            Type.Literal("READY_TO_SCHEDULE"),
            Type.Literal("APPROVAL_REQUIRED"),
          ]),
        ),
        ready_to_schedule: Type.Optional(Type.Boolean()),
        requires_approval: Type.Optional(Type.Boolean()),
        approval_reason: Type.Optional(Type.String({ minLength: 1 })),
        approval_amount_delta_cents: Type.Optional(nonNegativeNumberSchema),
      },
      { additionalProperties: true },
    ),
    "schedule.propose": Type.Object(
      {
        options: Type.Array(schedulingWindowSchema, { minItems: 1 }),
      },
      { additionalProperties: true },
    ),
    "schedule.confirm": Type.Object(
      {
        start: isoDateTimeSchema,
        end: isoDateTimeSchema,
      },
      { additionalProperties: true },
    ),
    "assignment.dispatch": Type.Object(
      {
        tech_id: uuidSchema,
        provider_id: Type.Optional(uuidSchema),
        dispatch_mode: Type.Optional(dispatchModeSchema),
      },
      { additionalProperties: true },
    ),
    "assignment.recommend": Type.Object(
      {
        service_type: serviceTypeSchema,
        recommendation_limit: Type.Optional(recommendationLimitSchema),
        preferred_window: Type.Optional(schedulingWindowSchema),
      },
      { additionalProperties: true },
    ),
    "schedule.hold": scheduleActionSchema,
    "schedule.release": Type.Object(
      {
        confirmation_id: uuidSchema,
      },
      { additionalProperties: true },
    ),
    "schedule.rollback": Type.Object(
      {
        confirmation_id: uuidSchema,
        reason: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: true },
    ),
    "tech.check_in": Type.Object(
      {
        timestamp: isoDateTimeSchema,
        location: Type.Optional(locationSchema),
      },
      { additionalProperties: true },
    ),
    "tech.request_change": Type.Object(
      {
        approval_type: approvalTypeSchema,
        reason: Type.String({ minLength: 1 }),
        amount_delta_cents: Type.Optional(nonNegativeNumberSchema),
        evidence_refs: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      },
      { additionalProperties: true },
    ),
    "approval.decide": Type.Object(
      {
        approval_id: uuidSchema,
        decision: evidenceDecisionSchema,
        notes: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: true },
    ),
    "closeout.add_evidence": Type.Object(
      {
        kind: Type.String({ minLength: 1 }),
        uri: Type.String({ minLength: 1 }),
        checksum: Type.Optional(Type.String({ minLength: 1 })),
        evidence_key: Type.Optional(Type.String({ minLength: 1 })),
        metadata: Type.Optional(metadataSchema),
      },
      { additionalProperties: true },
    ),
    "closeout.candidate": Type.Object(
      {
        checklist_status: checklistStatusSchema,
        no_signature_reason: Type.Optional(Type.String({ minLength: 1 })),
        evidence_refs: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      },
      { additionalProperties: true },
    ),
    "tech.complete": Type.Object(
      {
        checklist_status: checklistStatusSchema,
        no_signature_reason: Type.Optional(Type.String({ minLength: 1 })),
        evidence_refs: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      },
      { additionalProperties: true },
    ),
    "qa.verify": Type.Object(
      {
        timestamp: isoDateTimeSchema,
        result: resultSchema,
        notes: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: true },
    ),
    "billing.generate_invoice": Type.Object({}, { additionalProperties: true }),
    "ops.autonomy.pause": autonomyScopeSchema,
    "ops.autonomy.rollback": autonomyScopeSchema,
    "ops.autonomy.state": Type.Object({}, { additionalProperties: true }),
    "ops.autonomy.replay": Type.Object({}, { additionalProperties: true }),
  } as const;
  const commonEnvelopeFields = {
    actor_id: Type.String({ minLength: 1 }),
    actor_role: Type.Optional(actorRoleSchema),
    actor_type: Type.Optional(actorTypeSchema),
    request_id: Type.Optional(Type.String({ format: "uuid" })),
    correlation_id: Type.Optional(Type.String({ minLength: 1 })),
    trace_id: Type.Optional(Type.String({ minLength: 1 })),
    trace_parent: Type.Optional(Type.String({ minLength: 1 })),
    trace_state: Type.Optional(Type.String({ minLength: 1 })),
  };

  const toolDescriptions = {
    "ticket.create": "Create a ticket via dispatch-api.",
    "ticket.blind_intake": "Create a blind intake ticket via dispatch-api.",
    "ticket.triage": "Triage a ticket via dispatch-api.",
    "schedule.propose": "Propose schedule windows via dispatch-api.",
    "schedule.confirm": "Confirm a schedule window via dispatch-api.",
    "assignment.dispatch": "Dispatch assignment via dispatch-api.",
    "tech.check_in": "Record technician check-in via dispatch-api.",
    "tech.request_change": "Submit technician change request via dispatch-api.",
    "approval.decide": "Approve or deny a change request via dispatch-api.",
    "closeout.add_evidence": "Attach closeout evidence via dispatch-api.",
    "closeout.candidate": "Run candidate closeout automation via dispatch-api.",
    "qa.verify": "Verify closeout package via dispatch-api.",
    "billing.generate_invoice": "Generate invoice state transition via dispatch-api.",
    "ticket.get": "Read ticket snapshot via dispatch-api.",
    "closeout.list_evidence": "Read evidence items via dispatch-api.",
    "ticket.timeline": "Read ordered audit timeline via dispatch-api.",
    "dispatcher.cockpit":
      "Read dispatcher cockpit queue and mapped action surface via dispatch-api.",
    "tech.job_packet":
      "Read technician packet, timeline, evidence, and closeout gate status via dispatch-api.",
  } as const;

  const buildToolParameters = (
    policy: { mutating: boolean; requires_ticket_id: boolean },
    toolName: string,
  ) => {
    const properties: Record<string, unknown> = { ...commonEnvelopeFields };
    if (policy.requires_ticket_id) {
      properties.ticket_id = uuidSchema;
    }
    if (policy.mutating) {
      properties.payload =
        payloadSchemas[toolName as keyof typeof payloadSchemas] ?? unknownPayloadSchema;
    }
    return Type.Object(properties, { additionalProperties: false });
  };

  const asOpenAIFriendlyToolName = (toolName: string) => toolName.replace(/\./g, "_");

  type ToolDefinition = {
    name: string;
    dispatchName: string;
    description: string;
    parameters: unknown;
  };

  const toolDefinitions = Object.values(DISPATCH_TOOL_POLICIES)
    .map(
      (policy) =>
        ({
          name: asOpenAIFriendlyToolName(policy.tool_name),
          dispatchName: policy.tool_name,
          description:
            toolDescriptions[policy.tool_name as keyof typeof toolDescriptions] ??
            `Invoke ${policy.tool_name} via dispatch-api.`,
          parameters: buildToolParameters(policy, policy.tool_name),
        }) as ToolDefinition,
    )
    .toSorted((left, right) => left.name.localeCompare(right.name));

  const toolStatus = {
    tool_names: toolDefinitions.map((tool) => tool.dispatchName),
    plugin: "dispatch-tools",
  };

  const cfg = (api.pluginConfig ?? {}) as Record<string, unknown>;
  const baseUrl =
    typeof cfg.baseUrl === "string" && cfg.baseUrl.trim() !== "" ? cfg.baseUrl.trim() : null;
  const token =
    typeof cfg.token === "string" && cfg.token.trim() !== "" ? cfg.token.trim() : undefined;
  const timeoutMs =
    typeof cfg.timeoutMs === "number" && Number.isFinite(cfg.timeoutMs) ? cfg.timeoutMs : 10_000;

  api.registerTool(
    {
      name: "dispatch_contract_status",
      description: "Returns closed dispatch tool bridge status.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        const statusPayload = {
          ...toolStatus,
          configured: Boolean(baseUrl),
          base_url: baseUrl,
        };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(statusPayload, null, 2),
            },
          ],
          details: statusPayload,
        };
      },
    },
    { optional: true },
  );

  if (!baseUrl) {
    api.logger?.warn?.(
      "dispatch-tools: baseUrl missing in plugin config; bridge tools not registered (fail closed).",
    );
    return;
  }

  const readString = (params: Record<string, unknown>, key: string): string | null =>
    typeof params[key] === "string" && params[key].trim() !== "" ? params[key].trim() : null;

  const asObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;

  const toToolResult = (payload: unknown, isError = false) => ({
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
    isError,
  });

  const toToolError = (error: unknown, toolName: string) => {
    if (error instanceof DispatchBridgeError) {
      return toToolResult(error.toObject(), true);
    }
    return toToolResult(
      {
        error: {
          code: "BRIDGE_INTERNAL_ERROR",
          status: 500,
          message: error instanceof Error ? error.message : String(error),
          tool_name: toolName,
        },
      },
      true,
    );
  };

  for (const tool of toolDefinitions) {
    const dispatchName = tool.dispatchName;
    api.registerTool(
      {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        async execute(_id: string, params: Record<string, unknown>) {
          try {
            const actorId = readString(params, "actor_id");
            const actorRole = readString(params, "actor_role") ?? "dispatcher";
            const result = await invokeDispatchAction({
              baseUrl,
              token,
              timeoutMs,
              logger: api.logger,
              toolName: dispatchName,
              actorId,
              actorRole,
              actorType: readString(params, "actor_type"),
              requestId: readString(params, "request_id"),
              correlationId: readString(params, "correlation_id"),
              traceId: readString(params, "trace_id"),
              traceParent: readString(params, "trace_parent"),
              traceState: readString(params, "trace_state"),
              ticketId: readString(params, "ticket_id"),
              payload: asObject(params.payload),
            });
            return toToolResult(result);
          } catch (error) {
            return toToolError(error, dispatchName);
          }
        },
      },
      { optional: true },
    );
  }

  api.logger?.info?.(
    `dispatch-tools: registered ${toolDefinitions.length} closed bridge tools against ${baseUrl}`,
  );
}
