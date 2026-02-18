import assert from "node:assert/strict";
import test from "node:test";
import { invokeDispatchAction } from "../src/bridge.mjs";
import registerDispatchTools from "../src/index.ts";

function collectPluginTools(pluginConfig = null) {
  const toolSpecs = new Map();
  const api = {
    pluginConfig: pluginConfig ?? {},
    registerTool(toolSpec) {
      toolSpecs.set(toolSpec.name, toolSpec);
      return undefined;
    },
  };

  registerDispatchTools(api);
  return toolSpecs;
}

test("invokeDispatchAction forwards W3C traceparent and tracestate for read tool", async () => {
  const captured = [];
  const fakeFetch = async (url, init) => {
    captured.push(init?.headers ?? {});
    return new Response(
      JSON.stringify({
        ok: true,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  await invokeDispatchAction({
    baseUrl: "http://dispatch-api.internal",
    toolName: "ticket.get",
    actorId: "dispatcher-trace-test",
    actorRole: "dispatcher",
    actorType: "AGENT",
    ticketId: "51000000-0000-4000-8000-000000000001",
    requestId: "41000000-0000-4000-8000-000000000001",
    correlationId: "corr-traceparent-test",
    traceParent: "00-4bf92f3577b34da6a3ce929d0e0e4736a-00f067aa0ba902b7-01",
    traceState: "congo=t61rcWkgMzE,rojo=00f067aa0ba902b7",
    fetchImpl: fakeFetch,
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].traceparent, "00-4bf92f3577b34da6a3ce929d0e0e4736a-00f067aa0ba902b7-01");
  assert.equal(captured[0].tracestate, "congo=t61rcWkgMzE,rojo=00f067aa0ba902b7");
  assert.equal(captured[0]["x-trace-id"], undefined);
});

test("invokeDispatchAction forwards W3C traceparent and tracestate for mutating tool", async () => {
  const captured = [];
  const fakeFetch = async (url, init) => {
    captured.push(init?.headers ?? {});
    return new Response(
      JSON.stringify({
        ok: true,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  await invokeDispatchAction({
    baseUrl: "http://dispatch-api.internal",
    toolName: "ticket.create",
    actorId: "dispatcher-trace-test",
    actorRole: "dispatcher",
    actorType: "AGENT",
    requestId: "41000000-0000-4000-8000-000000000003",
    correlationId: "corr-traceparent-mutate-test",
    traceParent: "00-4bf92f3577b34da6a3ce929d0e0e4736a-00f067aa0ba902b7-01",
    traceState: "congo=t61rcWkgMzE,rojo=00f067aa0ba902b7",
    payload: {
      account_id: "51000000-0000-4000-8000-000000000001",
      site_id: "51000000-0000-4000-8000-000000000002",
      summary: "Trace test ticket",
    },
    fetchImpl: fakeFetch,
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].traceparent, "00-4bf92f3577b34da6a3ce929d0e0e4736a-00f067aa0ba902b7-01");
  assert.equal(captured[0].tracestate, "congo=t61rcWkgMzE,rojo=00f067aa0ba902b7");
  assert.equal(captured[0]["x-trace-id"], undefined);
});

test("invokeDispatchAction falls back to legacy x-trace-id header", async () => {
  const captured = [];
  const fakeFetch = async (url, init) => {
    captured.push(init?.headers ?? {});
    return new Response(
      JSON.stringify({
        ok: true,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  await invokeDispatchAction({
    baseUrl: "http://dispatch-api.internal",
    toolName: "ticket.get",
    actorId: "dispatcher-trace-test",
    actorRole: "dispatcher",
    actorType: "AGENT",
    ticketId: "51000000-0000-4000-8000-000000000002",
    requestId: "41000000-0000-4000-8000-000000000002",
    correlationId: "corr-trace-legacy-test",
    traceId: "legacy-trace-id",
    fetchImpl: fakeFetch,
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0]["x-trace-id"], "legacy-trace-id");
  assert.equal(captured[0].traceparent, undefined);
  assert.equal(captured[0].tracestate, undefined);
});

test("invokeDispatchAction works without trace headers", async () => {
  const captured = [];
  const fakeFetch = async (url, init) => {
    captured.push(init?.headers ?? {});
    return new Response(
      JSON.stringify({
        ok: true,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  await invokeDispatchAction({
    baseUrl: "http://dispatch-api.internal",
    toolName: "ticket.get",
    actorId: "dispatcher-trace-test",
    actorRole: "dispatcher",
    actorType: "AGENT",
    ticketId: "51000000-0000-4000-8000-000000000001",
    fetchImpl: fakeFetch,
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0]["x-trace-id"], undefined);
  assert.equal(captured[0].traceparent, undefined);
  assert.equal(captured[0].tracestate, undefined);
});

test("invokeDispatchAction aliases technician role through normalization", async () => {
  const captured = [];
  const fakeFetch = async (url, init) => {
    captured.push(init?.headers ?? {});
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  await invokeDispatchAction({
    baseUrl: "http://dispatch-api.internal",
    toolName: "tech.check_in",
    actorId: "tech-story10-bridge",
    actorRole: "technician",
    actorType: "AGENT",
    ticketId: "51000000-0000-4000-8000-000000000001",
    requestId: "41000000-0000-4000-8000-000000000005",
    correlationId: "corr-bridge-tech-alias",
    payload: {
      timestamp: new Date().toISOString(),
      location: {
        lat: 37.7749,
      },
    },
    fetchImpl: fakeFetch,
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0]["x-actor-role"], "technician");
});

test("invokeDispatchAction rejects unknown actor role with role policy error shape", async () => {
  await assert.rejects(
    invokeDispatchAction({
      baseUrl: "http://dispatch-api.internal",
      toolName: "ticket.create",
      actorId: "dispatcher-story10-bridge",
      actorRole: "hobbit",
      actorType: "AGENT",
      requestId: "41000000-0000-4000-8000-000000000004",
      correlationId: "corr-bridge-unknown-role",
    }),
    (error) => {
      assert.equal(error.code, "INVALID_AUTH_CLAIMS");
      assert.equal(error.details.policy_error.dimension, "role");
      assert.equal(error.details.policy_error.code, "INVALID_AUTH_CLAIMS");
      return true;
    },
  );
});

test("invokeDispatchAction rejects disallowed actor role with role policy error shape", async () => {
  await assert.rejects(
    invokeDispatchAction({
      baseUrl: "http://dispatch-api.internal",
      toolName: "tech.request_change",
      actorId: "dispatcher-story10-role-blocked",
      actorRole: "dispatcher",
      actorType: "AGENT",
      ticketId: "51000000-0000-4000-8000-000000000006",
      requestId: "41000000-0000-4000-8000-000000000006",
      correlationId: "corr-bridge-role-forbidden",
      payload: {
        approval_type: "NTE_INCREASE",
        reason: "Routine approval request from technician perspective",
      },
    }),
    (error) => {
      assert.equal(error.code, "TOOL_ROLE_FORBIDDEN");
      assert.equal(error.details.policy_error.dimension, "role");
      assert.equal(error.details.policy_error.code, "TOOL_ROLE_FORBIDDEN");
      return true;
    },
  );
});

test("invokeDispatchAction rejects unknown tool with tool policy error shape", async () => {
  await assert.rejects(
    invokeDispatchAction({
      baseUrl: "http://dispatch-api.internal",
      toolName: "tool.never.real",
      actorId: "dispatcher-story10-unknown-tool",
      actorRole: "dispatcher",
      actorType: "AGENT",
      requestId: "41000000-0000-4000-8000-000000000007",
      correlationId: "corr-bridge-unknown-tool",
    }),
    (error) => {
      assert.equal(error.code, "UNKNOWN_TOOL");
      assert.equal(error.details.policy_error.dimension, "tool");
      assert.equal(error.details.policy_error.code, "UNKNOWN_TOOL");
      return true;
    },
  );
});

test("dispatch contract status exposes only public bridge tools", async () => {
  const toolSpecs = collectPluginTools();
  const statusTool = toolSpecs.get("dispatch_contract_status");
  assert.ok(statusTool, "dispatch_contract_status tool should be registered");
  const status = await statusTool.execute?.();
  const publicTools = status?.details?.tool_names ?? [];
  assert.equal(Array.isArray(publicTools), true);
  assert.equal(publicTools.includes("assignment.recommend"), false);
  assert.equal(publicTools.includes("assignment.dispatch"), true);
});
