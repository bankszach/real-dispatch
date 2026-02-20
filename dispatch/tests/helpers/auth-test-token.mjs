import { createHmac } from "node:crypto";

/*
Required claims for Dispatch API auth:
- sub: actor identifier
- role: dispatch role
- scope.account_ids / scope.site_ids (or equivalent top-level scope claims)
- iat: issued-at time in epoch seconds
- exp: expiry time in epoch seconds
*/
export function makeTestToken({
  actor_id,
  role,
  scope = {},
  secret = process.env.DISPATCH_AUTH_JWT_SECRET ?? "dispatch-test-secret",
  tokenTtlSeconds = 600,
  now = Math.floor(Date.now() / 1000),
  actor_type = "AGENT",
  issuer,
  audience,
}) {
  if (typeof actor_id !== "string" || actor_id.trim() === "") {
    throw new Error("actor_id is required for test JWT generation");
  }
  if (typeof role !== "string" || role.trim() === "") {
    throw new Error("role is required for test JWT generation");
  }
  if (typeof secret !== "string" || secret.trim() === "") {
    throw new Error("DISPATCH_AUTH_JWT_SECRET must be configured for test JWT generation");
  }

  const claims = {
    sub: actor_id,
    role,
    actor_type,
    iat: now,
    exp: now + tokenTtlSeconds,
    scope: {
      account_ids: Array.isArray(scope.account_ids) ? scope.account_ids : [],
      site_ids: Array.isArray(scope.site_ids) ? scope.site_ids : [],
    },
  };

  if (issuer) {
    claims.iss = issuer;
  }
  if (audience) {
    claims.aud = audience;
  }

  const encodedHeader = Buffer.from(
    JSON.stringify({
      alg: "HS256",
      typ: "JWT",
    }),
  ).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}
