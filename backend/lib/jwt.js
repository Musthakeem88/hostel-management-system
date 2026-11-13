/* JSON Web Tokens (RFC 7519) signed with HMAC-SHA256 (JWS "HS256", RFC 7515).
   Written with Node's built-in crypto so the project needs no extra package, and the
   tokens are standard: any JWT library or jwt.io can read them.

   Security rules enforced here:
   - the algorithm is fixed to HS256 — a token that says "none" or any other algorithm is rejected
   - the signature is compared in constant time
   - exp (expiry), nbf (not before), iss (issuer) and aud (audience) are all checked
   - every token has a unique id (jti) so a single token can be revoked (see lib/auth.js)
*/
const crypto = require("crypto");

const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
const ALLOWED_CLOCK_SKEW = 5; // seconds

const b64json = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function hmac(data, secret) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

/* Creates a token. `claims` are extra data (for example { role }); `sub` is the user id. */
function sign(claims, { secret, issuer, audience, expiresInSeconds, subject }) {
  if (!secret) throw new Error("JWT secret is missing.");
  const now = Math.floor(Date.now() / 1000);

  const payload = {
    ...claims,
    iss: issuer,
    aud: audience,
    sub: String(subject),
    iat: now,
    nbf: now,
    exp: now + expiresInSeconds,
    jti: crypto.randomUUID()
  };

  const body = `${HEADER}.${b64json(payload)}`;
  return `${body}.${hmac(body, secret)}`;
}

/* Returns the payload of a valid token, or null. Never throws on bad input. */
function verify(token, { secret, issuer, audience }) {
  if (typeof token !== "string" || token.length > 4096) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signature] = parts;

  // 1. header must be exactly HS256 / JWT (blocks the "alg: none" and algorithm-swap attacks)
  let header;
  try { header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")); } catch { return null; }
  if (!header || header.alg !== "HS256" || (header.typ && header.typ !== "JWT")) return null;

  // 2. signature, compared in constant time
  const expected = Buffer.from(hmac(`${headerPart}.${payloadPart}`, secret));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  // 3. claims
  let payload;
  try { payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")); } catch { return null; }
  if (!payload || typeof payload !== "object") return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp + ALLOWED_CLOCK_SKEW < now) return null;
  if (typeof payload.nbf === "number" && payload.nbf - ALLOWED_CLOCK_SKEW > now) return null;
  if (payload.iss !== issuer) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(audience)) return null;
  if (!payload.sub || !payload.jti) return null;

  return payload;
}

module.exports = { sign, verify };
