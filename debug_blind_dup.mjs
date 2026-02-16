import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { startDispatchApi } from "./dispatch/api/src/server.mjs";

const migrationSql = readFileSync(
  path.resolve(process.cwd(), "dispatch/db/migrations/001_init.sql"),
  "utf8",
);
const container = "rd-debug-blind-dup";
const port = 55600;
const apiPort = 18300;
const baseUrl = `http://127.0.0.1:${apiPort}`;
const accountId = "00000000-0000-0000-0000-000000001111";
const siteId = "00000000-0000-0000-0000-000000001122";

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { encoding: "utf8", input });
  if (r.status !== 0) {
    throw new Error(
      [`CMD ${cmd} ${args.join(" ")}`, r.stdout, r.stderr].filter(Boolean).join("\n"),
    );
  }
  return r.stdout.trim();
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPg() {
  for (let i = 0; i < 120; i += 1) {
    const probe = spawnSync(
      "docker",
      ["exec", container, "pg_isready", "-U", "dispatch", "-d", "dispatch"],
      { encoding: "utf8" },
    );
    if (probe.status === 0) {
      return;
    }
    await sleep(250);
  }
  throw new Error("Postgres never became ready");
}

async function post(pathname, headers = {}, payload) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function psql(sql) {
  return run("docker", [
    "exec",
    "-i",
    container,
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

(async () => {
  spawnSync("docker", ["rm", "-f", container], { encoding: "utf8" });
  run("docker", [
    "run",
    "--rm",
    "-d",
    "--name",
    container,
    "-e",
    "POSTGRES_USER=dispatch",
    "-e",
    "POSTGRES_PASSWORD=dispatch",
    "-e",
    "POSTGRES_DB=dispatch",
    "-p",
    `${port}:5432`,
    "postgres:16",
  ]);
  await waitForPg();

  run(
    "docker",
    ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "dispatch", "-d", "dispatch"],
    migrationSql,
  );
  run("docker", [
    "exec",
    "-i",
    container,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "dispatch",
    "-d",
    "dispatch",
    "-c",
    `INSERT INTO accounts (id, name) VALUES ('${accountId}', 'x');`,
  ]);
  run("docker", [
    "exec",
    "-i",
    container,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "dispatch",
    "-d",
    "dispatch",
    "-c",
    `INSERT INTO sites (id, account_id, name, address1, city) VALUES ('${siteId}','${accountId}','site','1','c');`,
  ]);

  process.env.DISPATCH_DATABASE_URL = `postgres://dispatch:dispatch@127.0.0.1:${port}/dispatch`;
  const app = await startDispatchApi({ port: apiPort, testHooks: true });

  const payload = {
    account_id: accountId,
    site_id: siteId,
    customer_name: "Morgan Repeat",
    contact_email: "repeat@example.com",
    summary: "Repeatable blind intake check",
    incident_type: "WINDOW_GLAZING",
    description: "First request should be unique.",
    priority: "ROUTINE",
    identity_confidence: 99,
    classification_confidence: 99,
    sop_handoff_acknowledged: true,
  };
  const headers = {
    "Idempotency-Key": "x-debug-1",
    "X-Actor-Id": "dispatcher-dup",
    "X-Actor-Role": "dispatcher",
    "X-Tool-Name": "ticket.blind_intake",
  };

  const first = await post("/tickets/intake", headers, payload);
  console.log("first", first);
  const duplicate = await post(
    "/tickets/intake",
    { ...headers, "Idempotency-Key": "x-debug-2" },
    payload,
  );
  console.log("duplicate", duplicate);
  console.log(
    "db row",
    psql(
      `SELECT id::text, state FROM tickets WHERE account_id='${accountId}' AND site_id='${siteId}' ORDER BY created_at DESC LIMIT 1;`,
    ),
  );

  if (app?.close) {
    await app.close();
  }
  spawnSync("docker", ["rm", "-f", container], { encoding: "utf8" });
})();
