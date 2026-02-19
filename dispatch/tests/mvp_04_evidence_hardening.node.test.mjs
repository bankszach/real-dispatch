import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { closePool } from "../api/src/db.mjs";
import { createDispatchApiServer, startDispatchApi } from "../api/src/server.mjs";

const repoRoot = process.cwd();
const migrationSql = fs.readFileSync(
  path.resolve(repoRoot, "dispatch/db/migrations/001_init.sql"),
  "utf8",
);

const postgresContainer = "rd-mvp04-test";
const postgresPort = 55445;
const dispatchApiPort = 18095;
const strictDispatchApiPort = 18096;
const objectStorePort = 28140;
const baseUrl = `http://127.0.0.1:${dispatchApiPort}`;
const strictBaseUrl = `http://127.0.0.1:${strictDispatchApiPort}`;
const objectStoreBaseUrl = `http://127.0.0.1:${objectStorePort}`;

const accountId = "00000000-0000-0000-0000-000000000101";
const siteId = "00000000-0000-0000-0000-000000000102";
const techId = "00000000-0000-0000-0000-000000000103";

let app;
let strictApp;
let objectStoreServer;
let requestCounter = 1;
const strictObjectStoreArtifacts = new Map();

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

function nextRequestId() {
  const suffix = String(requestCounter).padStart(12, "0");
  requestCounter += 1;
  return `84000000-0000-4000-8000-${suffix}`;
}

function strictArtifactKey(ticketId, artifactKey, suffix = "jpg") {
  return `/objects/${ticketId}/${artifactKey}.${suffix}`;
}

function registerStrictObjectArtifact(ticketId, artifactKey, checksum, suffix = "jpg") {
  const artifactPath = strictArtifactKey(ticketId, artifactKey, suffix);
  strictObjectStoreArtifacts.set(artifactPath, checksum);
  return `${objectStoreBaseUrl}${artifactPath}`;
}

function startStrictObjectStore() {
  objectStoreServer = createServer((request, response) => {
    const url = new URL(request.url, objectStoreBaseUrl);
    const checksum = strictObjectStoreArtifacts.get(url.pathname);
    if (checksum == null) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.setHeader("etag", `"${checksum}"`);
    response.setHeader("content-type", "text/plain");
    response.writeHead(200);
    response.end();
  });
  objectStoreServer.listen(objectStorePort, "127.0.0.1");
}

function queryScalar(sql) {
  return psql(sql).trim();
}

function queryCount(sql) {
  return Number(queryScalar(sql));
}

function getTicketState(ticketId) {
  return queryScalar(`SELECT state FROM tickets WHERE id = '${ticketId}';`);
}

async function withDispatchHealthServer(nodeEnv, handler) {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousHeadEnv = process.env.DISPATCH_EVIDENCE_REQUIRE_HEAD;
  const previousChecksumEnv = process.env.REQUIRE_EVIDENCE_CHECKSUM;
  const previousLegacyChecksumEnv = process.env.DISPATCH_EVIDENCE_REQUIRE_CHECKSUM;

  process.env.NODE_ENV = nodeEnv;
  delete process.env.DISPATCH_EVIDENCE_REQUIRE_HEAD;
  delete process.env.REQUIRE_EVIDENCE_CHECKSUM;
  delete process.env.DISPATCH_EVIDENCE_REQUIRE_CHECKSUM;

  const app = createDispatchApiServer({
    host: "127.0.0.1",
    port: 0,
  });
  const started = await app.start();
  try {
    return await handler(`http://${started.host}:${started.port}`);
  } finally {
    await app.stop();

    if (previousNodeEnv == null) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }

    if (previousHeadEnv == null) {
      delete process.env.DISPATCH_EVIDENCE_REQUIRE_HEAD;
    } else {
      process.env.DISPATCH_EVIDENCE_REQUIRE_HEAD = previousHeadEnv;
    }

    if (previousChecksumEnv == null) {
      delete process.env.REQUIRE_EVIDENCE_CHECKSUM;
    } else {
      process.env.REQUIRE_EVIDENCE_CHECKSUM = previousChecksumEnv;
    }

    if (previousLegacyChecksumEnv == null) {
      delete process.env.DISPATCH_EVIDENCE_REQUIRE_CHECKSUM;
    } else {
      process.env.DISPATCH_EVIDENCE_REQUIRE_CHECKSUM = previousLegacyChecksumEnv;
    }
  }
}

async function post(pathname, headers, payload = {}, requestBaseUrl = baseUrl) {
  const response = await fetch(`${requestBaseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  const bodyText = await response.text();
  return {
    status: response.status,
    body: bodyText ? JSON.parse(bodyText) : null,
  };
}

async function createInProgressTicket(summary, requestBaseUrl = baseUrl) {
  const create = await post(
    "/tickets",
    {
      "Idempotency-Key": nextRequestId(),
      "X-Actor-Id": "dispatcher-mvp04",
      "X-Actor-Role": "dispatcher",
      "X-Tool-Name": "ticket.create",
      "X-Correlation-Id": "corr-mvp04-create",
    },
    {
      account_id: accountId,
      site_id: siteId,
      summary,
    },
    requestBaseUrl,
  );
  assert.equal(create.status, 201);
  const ticketId = create.body.id;

  const triage = await post(
    `/tickets/${ticketId}/triage`,
    {
      "Idempotency-Key": nextRequestId(),
      "X-Actor-Id": "dispatcher-mvp04",
      "X-Actor-Role": "dispatcher",
      "X-Tool-Name": "ticket.triage",
      "X-Correlation-Id": "corr-mvp04-triage",
    },
    {
      priority: "URGENT",
      incident_type: "DOOR_WONT_LATCH",
    },
    requestBaseUrl,
  );
  assert.equal(triage.status, 200);

  const dispatch = await post(
    `/tickets/${ticketId}/assignment/dispatch`,
    {
      "Idempotency-Key": nextRequestId(),
      "X-Actor-Id": "dispatcher-mvp04",
      "X-Actor-Role": "dispatcher",
      "X-Tool-Name": "assignment.dispatch",
      "X-Correlation-Id": "corr-mvp04-dispatch",
    },
    {
      tech_id: techId,
      dispatch_mode: "EMERGENCY_BYPASS",
      dispatch_confirmation: true,
      dispatch_rationale: "Priority evidence-based bypass during evidence workflow validation",
    },
    requestBaseUrl,
  );
  assert.equal(dispatch.status, 200);

  const checkIn = await post(
    `/tickets/${ticketId}/tech/check-in`,
    {
      "Idempotency-Key": nextRequestId(),
      "X-Actor-Id": "tech-mvp04",
      "X-Actor-Role": "tech",
      "X-Tool-Name": "tech.check_in",
      "X-Correlation-Id": "corr-mvp04-checkin",
    },
    {
      timestamp: "2026-02-16T16:00:00.000Z",
      location: {
        lat: 37.777,
        lng: -122.416,
      },
    },
    requestBaseUrl,
  );
  assert.equal(checkIn.status, 200);
  assert.equal(checkIn.body.state, "IN_PROGRESS");

  return ticketId;
}

async function addEvidence(
  ticketId,
  evidenceKey,
  uri,
  kind = "PHOTO",
  checksum = null,
  requestBaseUrl = baseUrl,
) {
  const response = await post(
    `/tickets/${ticketId}/evidence`,
    {
      "Idempotency-Key": nextRequestId(),
      "X-Actor-Id": "tech-mvp04",
      "X-Actor-Role": "tech",
      "X-Tool-Name": "closeout.add_evidence",
      "X-Correlation-Id": "corr-mvp04-evidence",
    },
    {
      kind,
      checksum,
      uri,
      metadata: {
        evidence_key: evidenceKey,
        source: "mvp_04_test",
      },
    },
    requestBaseUrl,
  );
  assert.equal(response.status, 201);
  return response.body;
}

async function completeTicket(ticketId, options = {}, requestBaseUrl = baseUrl) {
  const payload = {
    checklist_status: {
      work_performed: true,
      parts_used_or_needed: true,
      resolution_status: true,
      onsite_photos_after: true,
      billing_authorization: true,
    },
  };
  if (typeof options.noSignatureReason === "string" && options.noSignatureReason.trim() !== "") {
    payload.no_signature_reason = options.noSignatureReason.trim();
  }
  if (Array.isArray(options.evidenceRefs)) {
    payload.evidence_refs = options.evidenceRefs;
  }

  return post(
    `/tickets/${ticketId}/tech/complete`,
    {
      "Idempotency-Key": nextRequestId(),
      "X-Actor-Id": "tech-mvp04",
      "X-Actor-Role": "tech",
      "X-Tool-Name": "tech.complete",
      "X-Correlation-Id": "corr-mvp04-complete",
    },
    payload,
    requestBaseUrl,
  );
}

async function verifyTicket(ticketId, requestBaseUrl = baseUrl) {
  return post(
    `/tickets/${ticketId}/qa/verify`,
    {
      "Idempotency-Key": nextRequestId(),
      "X-Actor-Id": "qa-mvp04",
      "X-Actor-Role": "qa",
      "X-Tool-Name": "qa.verify",
      "X-Correlation-Id": "corr-mvp04-verify",
    },
    {
      timestamp: "2026-02-16T17:00:00.000Z",
      result: "PASS",
      notes: "QA verification for MVP-04",
    },
    requestBaseUrl,
  );
}

async function closeTicket(ticketId, requestBaseUrl = baseUrl) {
  return post(
    `/tickets/${ticketId}/close`,
    {
      "Idempotency-Key": nextRequestId(),
      "X-Actor-Id": "dispatcher-mvp04-close",
      "X-Actor-Role": "finance",
      "X-Tool-Name": "ticket.close",
      "X-Correlation-Id": "corr-mvp04-close",
    },
    {
      reason: "Automated phase 4 evidence integrity check",
    },
    requestBaseUrl,
  );
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

  let ready = false;
  for (let i = 0; i < 30; i += 1) {
    const probe = spawnSync(
      "docker",
      ["exec", postgresContainer, "pg_isready", "-U", "dispatch", "-d", "dispatch"],
      { encoding: "utf8" },
    );
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await sleep(500);
  }

  if (!ready) {
    throw new Error("Postgres container did not become ready");
  }

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
    VALUES ('${accountId}', 'MVP 04 Account');
  `);
  psql(`
    INSERT INTO sites (id, account_id, name, address1, city)
    VALUES ('${siteId}', '${accountId}', 'MVP 04 Site', '104 Main St', 'Springfield');
  `);

  process.env.DISPATCH_DATABASE_URL = `postgres://dispatch:dispatch@127.0.0.1:${postgresPort}/dispatch`;
  app = await startDispatchApi({
    host: "127.0.0.1",
    port: dispatchApiPort,
  });
  strictApp = await startDispatchApi({
    host: "127.0.0.1",
    port: strictDispatchApiPort,
    evidenceHeadValidationEnabled: true,
    evidenceChecksumEnforced: true,
    objectStoreSchemes: "http",
  });
  startStrictObjectStore();
});

test.after(async () => {
  if (app) {
    await app.stop();
  }
  if (strictApp) {
    await strictApp.stop();
  }
  if (objectStoreServer) {
    await new Promise((resolve, reject) => {
      objectStoreServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
  await closePool();
  spawnSync("docker", ["rm", "-f", postgresContainer], { encoding: "utf8" });
});

test("tech.complete fails closed when signature and no-signature reason are both absent", async () => {
  const ticketId = await createInProgressTicket("MVP-04 missing signature gate");

  await addEvidence(
    ticketId,
    "photo_before_door_edge_and_strike",
    `s3://dispatch-mvp04/${ticketId}/photo-before.jpg`,
  );
  await addEvidence(
    ticketId,
    "photo_after_latched_alignment",
    `s3://dispatch-mvp04/${ticketId}/photo-after.jpg`,
  );
  await addEvidence(
    ticketId,
    "note_adjustments_and_test_cycles",
    `s3://dispatch-mvp04/${ticketId}/note.txt`,
    "NOTE",
  );

  const complete = await completeTicket(ticketId);
  assert.equal(complete.status, 409);
  assert.equal(complete.body.error.code, "CLOSEOUT_REQUIREMENTS_INCOMPLETE");
  assert.equal(complete.body.error.requirement_code, "MISSING_SIGNATURE_CONFIRMATION");
  assert.deepEqual(complete.body.error.missing_evidence_keys, ["signature_or_no_signature_reason"]);
});

test("tech.complete accepts explicit no_signature_reason when signature evidence is absent", async () => {
  const ticketId = await createInProgressTicket("MVP-04 no-signature reason path");

  await addEvidence(
    ticketId,
    "photo_before_door_edge_and_strike",
    `s3://dispatch-mvp04/${ticketId}/photo-before.jpg`,
  );
  await addEvidence(
    ticketId,
    "photo_after_latched_alignment",
    `s3://dispatch-mvp04/${ticketId}/photo-after.jpg`,
  );
  await addEvidence(
    ticketId,
    "note_adjustments_and_test_cycles",
    `s3://dispatch-mvp04/${ticketId}/note.txt`,
    "NOTE",
  );

  const complete = await completeTicket(ticketId, {
    noSignatureReason: "Customer unavailable for signature after documented contact attempts",
  });
  assert.equal(complete.status, 200);
  assert.equal(complete.body.state, "COMPLETED_PENDING_VERIFICATION");
});

test("tech.complete fails closed for non-object-store evidence references", async () => {
  const ticketId = await createInProgressTicket("MVP-04 invalid evidence reference on complete");

  await addEvidence(
    ticketId,
    "photo_before_door_edge_and_strike",
    `s3://dispatch-mvp04/${ticketId}/photo-before.jpg`,
  );
  await addEvidence(
    ticketId,
    "photo_after_latched_alignment",
    `s3://dispatch-mvp04/${ticketId}/photo-after.jpg`,
  );
  await addEvidence(
    ticketId,
    "note_adjustments_and_test_cycles",
    "file:///tmp/not-object-store.txt",
    "NOTE",
  );
  await addEvidence(
    ticketId,
    "signature_or_no_signature_reason",
    `s3://dispatch-mvp04/${ticketId}/signature.txt`,
    "SIGNATURE",
  );

  const complete = await completeTicket(ticketId);
  assert.equal(complete.status, 409);
  assert.equal(complete.body.error.code, "CLOSEOUT_REQUIREMENTS_INCOMPLETE");
  assert.equal(complete.body.error.requirement_code, "INVALID_EVIDENCE_REFERENCE");
  assert.deepEqual(complete.body.error.invalid_evidence_refs, ["file:///tmp/not-object-store.txt"]);
});

test("qa.verify re-validates references and fails closed when evidence URI becomes invalid", async () => {
  const ticketId = await createInProgressTicket("MVP-04 invalid evidence reference on verify");

  await addEvidence(
    ticketId,
    "photo_before_door_edge_and_strike",
    `s3://dispatch-mvp04/${ticketId}/photo-before.jpg`,
  );
  await addEvidence(
    ticketId,
    "photo_after_latched_alignment",
    `s3://dispatch-mvp04/${ticketId}/photo-after.jpg`,
  );
  await addEvidence(
    ticketId,
    "note_adjustments_and_test_cycles",
    `s3://dispatch-mvp04/${ticketId}/note.txt`,
    "NOTE",
  );
  await addEvidence(
    ticketId,
    "signature_or_no_signature_reason",
    `s3://dispatch-mvp04/${ticketId}/signature.txt`,
    "SIGNATURE",
  );

  const complete = await completeTicket(ticketId);
  assert.equal(complete.status, 200);
  assert.equal(complete.body.state, "COMPLETED_PENDING_VERIFICATION");

  psql(`
    UPDATE evidence_items
    SET uri = 'https://example.com/not-object-store'
    WHERE ticket_id = '${ticketId}'
      AND metadata->>'evidence_key' = 'note_adjustments_and_test_cycles';
  `);

  const verify = await verifyTicket(ticketId);
  assert.equal(verify.status, 409);
  assert.equal(verify.body.error.code, "CLOSEOUT_REQUIREMENTS_INCOMPLETE");
  assert.equal(verify.body.error.requirement_code, "INVALID_EVIDENCE_REFERENCE");
  assert.deepEqual(verify.body.error.invalid_evidence_refs, [
    "https://example.com/not-object-store",
  ]);
  assert.equal(
    psql(`SELECT state FROM tickets WHERE id = '${ticketId}';`),
    "COMPLETED_PENDING_VERIFICATION",
  );
});

test("close requires strict HEAD verification and persists immutable evidence + artifact", async () => {
  const ticketId = await createInProgressTicket(
    "MVP-04 strict closeout artifact and immutability",
    strictBaseUrl,
  );

  const beforePhoto = registerStrictObjectArtifact(
    ticketId,
    "photo-before",
    "f1d2d2f924e986ac86fdf7b36c94bcdf32beec15c",
  );
  const afterPhoto = registerStrictObjectArtifact(
    ticketId,
    "photo-after",
    "7b8f965ad4bca8648197f7ab2a0a9f0b4f3a6a6b",
  );
  const noteDoc = registerStrictObjectArtifact(
    ticketId,
    "note",
    "4a7d1ed414474e4033ac29ccb1bc4ed4e",
  );
  const signatureDoc = registerStrictObjectArtifact(
    ticketId,
    "signature",
    "3b5d5c3712955042212316173ccf37be8",
    "png",
  );

  await addEvidence(
    ticketId,
    "photo_before_door_edge_and_strike",
    beforePhoto,
    "PHOTO",
    "f1d2d2f924e986ac86fdf7b36c94bcdf32beec15c",
    strictBaseUrl,
  );
  await addEvidence(
    ticketId,
    "photo_after_latched_alignment",
    afterPhoto,
    "PHOTO",
    "7b8f965ad4bca8648197f7ab2a0a9f0b4f3a6a6b",
    strictBaseUrl,
  );
  await addEvidence(
    ticketId,
    "note_adjustments_and_test_cycles",
    noteDoc,
    "NOTE",
    "4a7d1ed414474e4033ac29ccb1bc4ed4e",
    strictBaseUrl,
  );
  await addEvidence(
    ticketId,
    "signature_or_no_signature_reason",
    signatureDoc,
    "SIGNATURE",
    "3b5d5c3712955042212316173ccf37be8",
    strictBaseUrl,
  );

  const complete = await completeTicket(ticketId, {}, strictBaseUrl);
  assert.equal(complete.status, 200);
  assert.equal(complete.body.state, "COMPLETED_PENDING_VERIFICATION");

  const verify = await verifyTicket(ticketId, strictBaseUrl);
  assert.equal(verify.status, 200);
  assert.equal(verify.body.state, "VERIFIED");

  const close = await closeTicket(ticketId, strictBaseUrl);
  assert.equal(close.status, 200);
  assert.equal(close.body.ticket.state, "CLOSED");

  const totalEvidence = queryCount(
    `SELECT count(*) FROM evidence_items WHERE ticket_id = '${ticketId}';`,
  );
  const immutableEvidence = queryCount(
    `SELECT count(*) FROM evidence_items WHERE ticket_id = '${ticketId}' AND is_immutable = true;`,
  );
  const artifacts = queryCount(
    `SELECT count(*) FROM closeout_artifacts WHERE ticket_id = '${ticketId}' AND artifact_type = 'closeout_packet';`,
  );
  assert.equal(immutableEvidence, totalEvidence);
  assert.equal(artifacts, 1);
});

test("close is blocked when HEAD revalidation fails after complete and verify", async () => {
  const ticketId = await createInProgressTicket("MVP-04 strict close HEAD failure", strictBaseUrl);

  const beforePhoto = registerStrictObjectArtifact(
    ticketId,
    "photo-before",
    "5df6e0e276135a5",
    "jpg",
  );
  const afterPhoto = registerStrictObjectArtifact(ticketId, "photo-after", "f8ca888a3d2c3", "jpg");
  const noteDoc = registerStrictObjectArtifact(ticketId, "note", "f7bcf9a1e2d8", "txt");
  const signatureDoc = registerStrictObjectArtifact(ticketId, "signature", "3ff4ac8d9f8c", "png");

  await addEvidence(
    ticketId,
    "photo_before_door_edge_and_strike",
    beforePhoto,
    "PHOTO",
    "5df6e0e276135a5",
    strictBaseUrl,
  );
  await addEvidence(
    ticketId,
    "photo_after_latched_alignment",
    afterPhoto,
    "PHOTO",
    "f8ca888a3d2c3",
    strictBaseUrl,
  );
  await addEvidence(
    ticketId,
    "note_adjustments_and_test_cycles",
    noteDoc,
    "NOTE",
    "f7bcf9a1e2d8",
    strictBaseUrl,
  );
  await addEvidence(
    ticketId,
    "signature_or_no_signature_reason",
    signatureDoc,
    "SIGNATURE",
    "3ff4ac8d9f8c",
    strictBaseUrl,
  );

  const complete = await completeTicket(ticketId, {}, strictBaseUrl);
  assert.equal(complete.status, 200);
  const verify = await verifyTicket(ticketId, strictBaseUrl);
  assert.equal(verify.status, 200);

  psql(`
    UPDATE evidence_items
    SET uri = 'http://127.0.0.1:${objectStorePort + 1}/missing/${ticketId}/note.txt'
    WHERE ticket_id = '${ticketId}'
      AND metadata->>'evidence_key' = 'note_adjustments_and_test_cycles';
  `);

  const close = await closeTicket(ticketId, strictBaseUrl);
  assert.equal(close.status, 409);
  assert.equal(close.body.error.code, "CLOSEOUT_REQUIREMENTS_INCOMPLETE");
  assert.equal(close.body.error.requirement_code, "INVALID_EVIDENCE_REFERENCE");
  assert.deepEqual(close.body.error.invalid_evidence_refs, [
    `http://127.0.0.1:${objectStorePort + 1}/missing/${ticketId}/note.txt`,
  ]);
  assert.equal(getTicketState(ticketId), "VERIFIED");
});

test("close is blocked when evidence checksum no longer matches HEAD etag", async () => {
  const ticketId = await createInProgressTicket("MVP-04 strict checksum failure", strictBaseUrl);

  const beforePhoto = registerStrictObjectArtifact(ticketId, "photo-before", "abc123", "jpg");
  const afterPhoto = registerStrictObjectArtifact(ticketId, "photo-after", "def456", "jpg");
  const noteDoc = registerStrictObjectArtifact(ticketId, "note", "789abc", "txt");
  const signatureDoc = registerStrictObjectArtifact(ticketId, "signature", "cafebabe", "png");

  await addEvidence(
    ticketId,
    "photo_before_door_edge_and_strike",
    beforePhoto,
    "PHOTO",
    "abc123",
    strictBaseUrl,
  );
  await addEvidence(
    ticketId,
    "photo_after_latched_alignment",
    afterPhoto,
    "PHOTO",
    "def456",
    strictBaseUrl,
  );
  await addEvidence(
    ticketId,
    "note_adjustments_and_test_cycles",
    noteDoc,
    "NOTE",
    "789abc",
    strictBaseUrl,
  );
  await addEvidence(
    ticketId,
    "signature_or_no_signature_reason",
    signatureDoc,
    "SIGNATURE",
    "cafebabe",
    strictBaseUrl,
  );

  const complete = await completeTicket(ticketId, {}, strictBaseUrl);
  assert.equal(complete.status, 200);
  const verify = await verifyTicket(ticketId, strictBaseUrl);
  assert.equal(verify.status, 200);

  psql(`
    UPDATE evidence_items
    SET checksum = 'mismatch'
    WHERE ticket_id = '${ticketId}'
      AND metadata->>'evidence_key' = 'photo_before_door_edge_and_strike';
  `);

  const close = await closeTicket(ticketId, strictBaseUrl);
  assert.equal(close.status, 409);
  assert.equal(close.body.error.code, "CLOSEOUT_REQUIREMENTS_INCOMPLETE");
  assert.equal(close.body.error.requirement_code, "INVALID_EVIDENCE_REFERENCE");
  assert.deepEqual(close.body.error.invalid_evidence_refs, [beforePhoto]);
  assert.equal(getTicketState(ticketId), "VERIFIED");
});

test("production profile defaults evidence enforcement to required when flags are unset", async () => {
  await withDispatchHealthServer("production", async (healthBaseUrl) => {
    const response = await fetch(`${healthBaseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");

    const artifactChecks = body?.checks?.artifact_integrity;
    assert.ok(artifactChecks != null, "artifact integrity checks must be present");
    assert.equal(artifactChecks.evidence_head_verification_mode, "required");
    assert.equal(artifactChecks.evidence_checksum_enforcement_mode, "required");
    assert.equal(artifactChecks.evidence_head_verification_enabled, "pass");
    assert.equal(artifactChecks.evidence_checksum_enforcement_enabled, "pass");
  });
});

test("development profile defaults evidence enforcement to relaxed when flags are unset", async () => {
  await withDispatchHealthServer("development", async (healthBaseUrl) => {
    const response = await fetch(`${healthBaseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");

    const artifactChecks = body?.checks?.artifact_integrity;
    assert.ok(artifactChecks != null, "artifact integrity checks must be present");
    assert.equal(artifactChecks.evidence_head_verification_mode, "disabled");
    assert.equal(artifactChecks.evidence_checksum_enforcement_mode, "optional");
    assert.equal(artifactChecks.evidence_head_verification_enabled, "warn");
    assert.equal(artifactChecks.evidence_checksum_enforcement_enabled, "warn");
  });
});
