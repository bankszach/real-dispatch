import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envTemplatePath = path.join(rootDir, ".env.demo");
const envPath = path.join(rootDir, ".env");
const stackComposeDir = path.join(rootDir, "dispatch", "ops", "docker");
const demoSmokeScript = path.join(rootDir, "dispatch", "ops", "demo-smoke.mjs");
const defaultStackEnvPath = path.join(rootDir, "dispatch", "reports", "bootstrap-evidence.json");

const CI_MODE = ["1", "true"].includes((process.env.CI ?? "").toLowerCase());
const KEEP_STACK_BY_DEFAULT = !CI_MODE;
const KEEP_STACK = process.env.DISPATCH_DEMO_KEEP_STACK !== "0" ? KEEP_STACK_BY_DEFAULT : false;

function parseDotenv(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const raw = readFileSync(filePath, "utf8");
  const entries = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const cleanLine = trimmed.replace(/^export\s+/, "");
    const equalsIndex = cleanLine.indexOf("=");
    if (equalsIndex < 0) {
      continue;
    }

    const key = cleanLine.slice(0, equalsIndex).trim();
    let value = cleanLine.slice(equalsIndex + 1).trim();

    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }

    if (key) {
      entries[key] = value;
    }
  }

  return entries;
}

function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
  });

  if (result.error) {
    throw new Error(`${command} ${args.join(" ")} failed to start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }

  return result;
}

function ensureEnvFile() {
  if (existsSync(envPath)) {
    return;
  }

  if (!existsSync(envTemplatePath)) {
    throw new Error(`Demo env template is missing at ${envTemplatePath}`);
  }

  copyFileSync(envTemplatePath, envPath);
  console.log(`Created ${envPath} from ${envTemplatePath}`);
}

function ensureCommand(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`Missing required command: ${command}`);
  }
}

async function ensureComposeReady() {
  const composePath = path.join(stackComposeDir, "docker-compose.dispatch.yml");
  if (!existsSync(composePath)) {
    throw new Error(`Dispatch compose file not found: ${composePath}`);
  }

  runCommand("docker", ["compose", "version"], { stdio: "pipe" });
}

async function downStack(env) {
  runCommand("pnpm", ["dispatch:stack:down"], {
    cwd: rootDir,
    env,
  });
}

async function upStack(env) {
  mkdirSync(path.join(rootDir, ".openclaw/workspace"), { recursive: true });
  runCommand("pnpm", ["dispatch:stack:up"], {
    cwd: rootDir,
    env,
  });
}

async function bootstrapStack(env) {
  runCommand("pnpm", ["dispatch:bootstrap:stack"], {
    cwd: rootDir,
    env,
  });
}

function parseBoolean(value, fallback = false) {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

async function main() {
  ensureCommand("docker");
  ensureCommand("pnpm");
  ensureCommand("node");
  await ensureComposeReady();
  ensureEnvFile();

  const envFromFile = parseDotenv(envPath);
  const env = {
    ...process.env,
    ...envFromFile,
  };

  const apiPort = env.DISPATCH_API_PORT || "8080";
  const keepStackOverride = parseBoolean(process.env.DISPATCH_DEMO_KEEP_STACK, KEEP_STACK);
  const keepStack = keepStackOverride;
  const bootstrapEvidencePath =
    env.DISPATCH_BOOTSTRAP_EVIDENCE_PATH ||
    process.env.DISPATCH_BOOTSTRAP_EVIDENCE_PATH ||
    defaultStackEnvPath;
  const dispatchApiUrl =
    env.DISPATCH_API_URL || process.env.DISPATCH_API_URL || `http://127.0.0.1:${apiPort}`;

  let stackStarted = false;

  const runtimeEnv = {
    ...env,
    DISPATCH_BOOTSTRAP_EVIDENCE_PATH: bootstrapEvidencePath,
    DISPATCH_API_URL: dispatchApiUrl,
  };

  try {
    mkdirSync(path.dirname(bootstrapEvidencePath), { recursive: true });
    await downStack(runtimeEnv);
    await upStack(runtimeEnv);
    stackStarted = true;

    console.log("Bootstrapping demo fixtures");
    await bootstrapStack(runtimeEnv);

    console.log("Running canonical smoke scenario");
    runCommand("node", [demoSmokeScript], {
      cwd: rootDir,
      env: runtimeEnv,
    });

    console.log("Demo stack and smoke scenario completed successfully");
    console.log(`OpenClaw dashboard: http://127.0.0.1:${env.OPENCLAW_GATEWAY_PORT || "18789"}`);
    console.log(`Dispatch API: ${dispatchApiUrl}`);
    console.log(`Bootstrap evidence: ${bootstrapEvidencePath}`);

    if (keepStack) {
      console.log(
        "Demo stack was kept running for inspection. Set DISPATCH_DEMO_KEEP_STACK=0 to auto-teardown.",
      );
      return;
    }

    console.log("Cleaning up demo stack");
    await downStack(runtimeEnv);
    stackStarted = false;
  } finally {
    if (!keepStack && stackStarted) {
      await downStack(runtimeEnv);
    }
  }
}

main().catch((error) => {
  console.error("dispatch demo failed:", error.message);
  process.exitCode = 1;
});
