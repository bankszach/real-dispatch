import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildScheduleHoldReleaseProposal } from "../../packages/control-plane-temporal/src/shadow/schedule-hold-release.propose.mjs";
import { closePool } from "../api/src/db.mjs";
import { startDispatchApi } from "../api/src/server.mjs";
import { invokeDispatchAction } from "../tools-plugin/src/bridge.mjs";

const repoRoot = process.cwd();
const migrationSql = fs.readFileSync(
  path.resolve(repoRoot, "dispatch/db/migrations/001_init.sql"),
  "utf8",
);

const postgresContainer = process.env.DISPATCH_SHADOW_DEMO_CONTAINER || "rd-shadow-proposal-demo";
const postgresPort = Number.parseInt(process.env.DISPATCH_SHADOW_DEMO_POSTGRES_PORT ?? "55443", 10);
const dispatchApiPort = Number.parseInt(process.env.DISPATCH_SHADOW_DEMO_API_PORT ?? "18109", 10);
const dispatchApiBaseUrl = `http://127.0.0.1:${dispatchApiPort}`;

const demoAccountId =
  process.env.DISPATCH_DEMO_ACCOUNT_ID || "00000000-0000-0000-0000-000000000021";
const demoSiteId = process.env.DISPATCH_DEMO_SITE_ID || "00000000-0000-0000-0000-000000000022";
const correlationId = process.env.DISPATCH_SHADOW_DEMO_CORRELATION_ID || randomUUID();

const requestIds = {
  create: "81000000-0000-4000-8000-000000000021",
  triage: "81000000-0000-4000-8000-000000000022",
  propose: "81000000-0000-4000-8000-000000000023",
  confirm: "81000000-0000-4000-8000-000000000024",
};

let app;

function run(command, args, input = undefined) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input,
  });
  if (result.status !== 0) {
    throw new Error(
      [`Command failed: ${command} ${args.join(" ")}`, result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.stdout.trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function psql(sql) {
  return run("docker", [
    "exec",
    "-i",
    postgresContainer,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "dispatch",
    "-d",
    "dispatch",
    "-At",
    "-c",
    sql,
  ]);
}

function extractTimelineLength(timelineResponse) {
  const events = timelineResponse?.events;
  if (Array.isArray(events)) {
    return events.length;
  }
  return 0;
}

async function waitForPostgres() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const probe = spawnSync(
      "docker",
      ["exec", postgresContainer, "pg_isready", "-U", "dispatch", "-d", "dispatch"],
      { encoding: "utf8" },
    );
    if (probe.status === 0) {
      return;
    }
    if (attempt < 30) {
      await sleep(500);
    }
  }
  throw new Error("Postgres container did not become ready");
}

function buildScheduleWindow() {
  const now = new Date();
  return {
    start: now.toISOString(),
    end: new Date(now.getTime() + 45 * 60_000).toISOString(),
  };
}

async function runShadowDemo() {
  spawnSync("docker", ["rm", "-f", postgresContainer], { encoding: "utf8" });
  run("docker", [
    "run",
    "--rm",
    "-d",
    "--name",
    postgresContainer,
    "-e",
    "POSTGRES_USER=dispatch",
    "-e",
    "POSTGRES_PASSWORD=dispatch",
    "-e",
    "POSTGRES_DB=dispatch",
    "-p",
    `${postgresPort}:5432`,
    "postgres:16",
  ]);

  await waitForPostgres();

  run(
    "docker",
    [
      "exec",
      "-i",
      postgresContainer,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "dispatch",
      "-d",
      "dispatch",
    ],
    migrationSql,
  );

  psql(`
    INSERT INTO accounts (id, name)
    VALUES ('${demoAccountId}', 'Shadow Demo Account');
  `);
  psql(`
    INSERT INTO sites (id, account_id, name, address1, city)
    VALUES ('${demoSiteId}', '${demoAccountId}', 'Shadow Demo Site', '99 Demo Way', 'Springfield');
  `);

  process.env.DISPATCH_DATABASE_URL = `postgres://dispatch:dispatch@127.0.0.1:${postgresPort}/dispatch`;
  app = await startDispatchApi({
    host: "127.0.0.1",
    port: dispatchApiPort,
  });

  const scheduleWindow = buildScheduleWindow();

  const createResult = await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "ticket.create",
    actorId: "dispatcher-shadow-demo",
    actorRole: "dispatcher",
    actorType: "AGENT",
    requestId: requestIds.create,
    correlationId,
    payload: {
      account_id: demoAccountId,
      site_id: demoSiteId,
      summary: "Shadow proposal demo run",
      description: "Ticket created for shadow proposal demonstration.",
    },
  });

  const ticketId = createResult.data.id;

  const triageResult = await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "ticket.triage",
    actorId: "dispatcher-shadow-demo",
    actorRole: "dispatcher",
    actorType: "AGENT",
    requestId: requestIds.triage,
    correlationId,
    ticketId,
    payload: {
      priority: "EMERGENCY",
      incident_type: "CANNOT_SECURE_ENTRY",
      ready_to_schedule: true,
      nte_cents: 48000,
    },
  });

  if (triageResult.data.state !== "READY_TO_SCHEDULE") {
    throw new Error(`Unexpected triage state for proposal demo: ${triageResult.data.state}`);
  }

  await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "schedule.propose",
    actorId: "dispatcher-shadow-demo",
    actorRole: "dispatcher",
    actorType: "AGENT",
    requestId: requestIds.propose,
    correlationId,
    ticketId,
    payload: {
      options: [
        {
          start: scheduleWindow.start,
          end: scheduleWindow.end,
        },
      ],
    },
  });

  const confirmResult = await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "schedule.confirm",
    actorId: "dispatcher-shadow-demo",
    actorRole: "dispatcher",
    actorType: "AGENT",
    requestId: requestIds.confirm,
    correlationId,
    ticketId,
    payload: {
      start: scheduleWindow.start,
      end: scheduleWindow.end,
    },
  });

  const timelineBefore = await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "ticket.timeline",
    actorId: "dispatcher-shadow-demo",
    actorRole: "dispatcher",
    actorType: "AGENT",
    correlationId,
    ticketId,
  });

  const timelineLengthBefore = extractTimelineLength(timelineBefore.data);
  const proposalArtifact = buildScheduleHoldReleaseProposal({
    ticketId,
    ticket: confirmResult.data,
    timeline: timelineBefore.data,
    hold_reason: "CUSTOMER_PENDING",
    confirmation_window: scheduleWindow,
    correlation_id: correlationId,
  });

  const proposalPath = path.resolve(
    repoRoot,
    "dispatch/reports/shadow-proposals",
    `${ticketId}.json`,
  );
  fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
  fs.writeFileSync(proposalPath, `${JSON.stringify(proposalArtifact, null, 2)}\n`, "utf8");

  const timelineAfter = await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "ticket.timeline",
    actorId: "dispatcher-shadow-demo",
    actorRole: "dispatcher",
    actorType: "AGENT",
    correlationId,
    ticketId,
  });

  const timelineLengthAfter = extractTimelineLength(timelineAfter.data);

  console.log(`ticket_id: ${ticketId}`);
  console.log(`current_state: ${confirmResult.data.state}`);
  console.log(`timeline_length_before: ${timelineLengthBefore}`);
  console.log(`timeline_length_after: ${timelineLengthAfter}`);
  console.log(`proposal_artifact_path: ${proposalPath}`);

  if (timelineLengthAfter !== timelineLengthBefore) {
    throw new Error(
      `Shadow proposal changed timeline length. before=${timelineLengthBefore}, after=${timelineLengthAfter}`,
    );
  }
}

async function main() {
  try {
    await runShadowDemo();
  } finally {
    if (app) {
      await app.stop();
    }
    await closePool();
    spawnSync("docker", ["rm", "-f", postgresContainer], { encoding: "utf8" });
  }
}

main().catch((error) => {
  console.error("dispatch shadow proposal demo failed:", error.message);
  process.exitCode = 1;
});
