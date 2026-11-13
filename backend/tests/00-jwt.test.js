const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const jwt = require("../lib/jwt");

const opts = { secret: "x".repeat(48), issuer: "hostel", audience: "web" };
const make = (extra = {}) => jwt.sign({ role: "student" }, { ...opts, subject: 7, expiresInSeconds: 60, ...extra });
const part = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

describe("JWT (HS256)", () => {
  test("a fresh token is a standard three-part JWT and verifies", () => {
    const token = make();
    const [h, p] = token.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "HS256", typ: "JWT" });
    const payload = jwt.verify(token, opts);
    assert.equal(payload.sub, "7");
    assert.equal(payload.role, "student");
    assert.ok(payload.jti && payload.iat && payload.exp && payload.nbf);
    assert.equal(JSON.parse(Buffer.from(p, "base64url")).iss, "hostel");
  });

  test("tampering with the payload or signature is rejected", () => {
    const [h, , s] = make().split(".");
    const forged = `${h}.${part({ sub: "1", role: "administrator", iss: "hostel", aud: "web", exp: 9999999999, jti: "a" })}.${s}`;
    assert.equal(jwt.verify(forged, opts), null);
    const t = make();
    assert.equal(jwt.verify(t.slice(0, -2) + "xx", opts), null);
  });

  test('"alg: none" and other algorithms are rejected', () => {
    const body = part({ sub: "1", iss: "hostel", aud: "web", exp: 9999999999, jti: "a" });
    assert.equal(jwt.verify(`${part({ alg: "none", typ: "JWT" })}.${body}.`, opts), null);
    const h = part({ alg: "HS512", typ: "JWT" });
    const sig = crypto.createHmac("sha512", opts.secret).update(`${h}.${body}`).digest("base64url");
    assert.equal(jwt.verify(`${h}.${body}.${sig}`, opts), null);
  });

  test("expired, wrong issuer, wrong audience and wrong secret are rejected", () => {
    assert.equal(jwt.verify(make({ expiresInSeconds: -60 }), opts), null);
    assert.equal(jwt.verify(make(), { ...opts, issuer: "other" }), null);
    assert.equal(jwt.verify(make(), { ...opts, audience: "other" }), null);
    assert.equal(jwt.verify(make(), { ...opts, secret: "y".repeat(48) }), null);
  });

  test("garbage input never throws", () => {
    for (const bad of [undefined, null, "", "a.b", "a.b.c.d", "....", 42, "x".repeat(5000)]) {
      assert.equal(jwt.verify(bad, opts), null);
    }
  });
});
