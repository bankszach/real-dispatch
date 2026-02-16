import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildScheduleHoldReleaseProposal } from "../../packages/control-plane-temporal/src/shadow/schedule-hold-release.propose.mjs";
import { closePool } from "../api/src/db.mjs";
import { startDispatchApi } from "../api/src/server.mjs";
import { invokeDispatchAction } from "../tools-plugin/src/bridge.mjs";

const repoRoot = process.cwd();
const migrationSql = fs.readFileSync(
  path.resolve(repoRoot, "dispatch/db/migrations/001_init.sql"),
  "utf8",
);

const postgresContainer = "rd-story09-shadow-test";
const postgresPort = 55447;
const dispatchApiPort = 18119;
const dispatchApiBaseUrl = `http://127.0.0.1:${dispatchApiPort}`;

const accountId = "00000000-0000-0000-0000-000000000031";
const siteId = "00000000-0000-0000-0000-000000000032";

const requestIds = {
  create: "90000000-0000-4000-8000-000000000031",
  triage: "90000000-0000-4000-8000-000000000032",
  propose: "90000000-0000-4000-8000-000000000033",
  confirm: "90000000-0000-4000-8000-000000000034",
};

const correlationId = "corr-story09-shadow-proposal";

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
  return Array.isArray(timelineResponse?.events) ? timelineResponse.events.length : 0;
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

test.before(async () => {
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
    VALUES ('${accountId}', 'Story 09 Account');
  `);
  psql(`
    INSERT INTO sites (id, account_id, name, address1, city)
    VALUES ('${siteId}', '${accountId}', 'Story 09 Site', '9 Story Ave', 'Springfield');
  `);

  process.env.DISPATCH_DATABASE_URL = `postgres://dispatch:dispatch@127.0.0.1:${postgresPort}/dispatch`;
  app = await startDispatchApi({
    host: "127.0.0.1",
    port: dispatchApiPort,
  });
});

test.after(async () => {
  if (app) {
    await app.stop();
  }
  await closePool();
  spawnSync("docker", ["rm", "-f", postgresContainer], { encoding: "utf8" });
});

test("shadow proposal runner emits no mutation while proposing hold/release", async () => {
  const createResult = await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "ticket.create",
    actorId: "dispatcher-story09",
    actorRole: "dispatcher",
    actorType: "AGENT",
    requestId: requestIds.create,
    correlationId,
    payload: {
      account_id: accountId,
      site_id: siteId,
      summary: "Shadow proposal demo test",
      description: "Ticket used to validate proposal artifact generation.",
    },
  });

  const ticketId = createResult.data.id;
  assert.equal(createResult.status, 201);

  const triageResult = await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "ticket.triage",
    actorId: "dispatcher-story09",
    actorRole: "dispatcher",
    actorType: "AGENT",
    requestId: requestIds.triage,
    correlationId,
    ticketId,
    payload: {
      priority: "EMERGENCY",
      incident_type: "CANNOT_SECURE_ENTRY",
      ready_to_schedule: true,
      nte_cents: 66000,
    },
  });

  assert.equal(triageResult.status, 200);
  assert.equal(triageResult.data.state, "READY_TO_SCHEDULE");

  const scheduleWindow = buildScheduleWindow();

  await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "schedule.propose",
    actorId: "dispatcher-story09",
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
    actorId: "dispatcher-story09",
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

  assert.equal(confirmResult.status, 200);
  assert.equal(confirmResult.data.state, "SCHEDULED");

  const timelineBefore = await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "ticket.timeline",
    actorId: "dispatcher-story09",
    actorRole: "dispatcher",
    actorType: "AGENT",
    correlationId,
    ticketId,
  });
  const timelineLengthBefore = extractTimelineLength(timelineBefore.data);

  const proposal = buildScheduleHoldReleaseProposal({
    ticketId,
    ticket: confirmResult.data,
    timeline: timelineBefore.data,
    hold_reason: "CUSTOMER_PENDING",
    confirmation_window: scheduleWindow,
    correlation_id: correlationId,
  });

  const timelineAfter = await invokeDispatchAction({
    baseUrl: dispatchApiBaseUrl,
    toolName: "ticket.timeline",
    actorId: "dispatcher-story09",
    actorRole: "dispatcher",
    actorType: "AGENT",
    correlationId,
    ticketId,
  });
  const timelineLengthAfter = extractTimelineLength(timelineAfter.data);

  assert.equal(proposal.ticket_id, ticketId);
  assert.equal(proposal.current_state, "SCHEDULED");
  assert.equal(proposal.timeline_length, timelineLengthBefore);
  assert.equal(timelineLengthAfter, timelineLengthBefore);
  assert.equal(proposal.safety.mutation_attempted, false);
  assert.equal(proposal.proposed_actions.length, 2);
  assert.deepEqual(proposal.proposed_actions[0], {
    endpoint: `/tickets/${ticketId}/schedule/hold`,
    method: "POST",
    payload: {
      hold_reason: "CUSTOMER_PENDING",
      confirmation_window: {
        start: proposal.proposed_actions[0].payload.confirmation_window.start,
        end: proposal.proposed_actions[0].payload.confirmation_window.end,
      },
    },
  });
  assert.equal(proposal.proposed_actions[1].endpoint, `/tickets/${ticketId}/schedule/release`);
});
