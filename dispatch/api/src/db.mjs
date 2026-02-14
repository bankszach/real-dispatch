import pg from "pg";

const { Pool } = pg;

const defaultConnectionString = "postgres://dispatch:dispatch@127.0.0.1:5432/dispatch";

let poolInstance;

export function getPool() {
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: process.env.DISPATCH_DATABASE_URL ?? defaultConnectionString,
      max: Number(process.env.DISPATCH_DB_POOL_MAX ?? "10"),
    });
  }

  return poolInstance;
}

export async function closePool() {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = undefined;
  }
}
