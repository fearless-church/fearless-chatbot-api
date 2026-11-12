"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, createHash, sign, createPublicKey } = require("node:crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { captureBodyHash, createProxyAttribution, rateIdentity } = require("../proxy-attribution");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const keys = [{ id: "test-key", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) }];
const now = Date.parse("2026-11-12T18:00:00Z"), second = now / 1000;
const body = JSON.stringify({ messages: [{ role: "user", content: "Public fixture question" }] });
function signedHeaders({ visitor = "a".repeat(64), timestamp = second, signedBody = body, keyId = "test-key", method = "POST", path = "/api/chat" } = {}) {
  const digest = createHash("sha256").update(signedBody).digest("hex");
  const payload = `fearless-chat-v1\n${method}\n${path}\n${keyId}\n${timestamp}\n${visitor}\n${digest}`;
  return { "X-Fearless-Proxy-Version": "1", "X-Fearless-Proxy-Key-Id": keyId, "X-Fearless-Proxy-Timestamp": String(timestamp), "X-Fearless-Proxy-Visitor": visitor, "X-Fearless-Proxy-Signature": sign(null, Buffer.from(payload), privateKey).toString("base64url") };
}
async function fixture(run) {
  const app = express();let accepted = 0, rejected = 0;
  app.use(express.json({ verify: captureBodyHash }));
  const attribution = createProxyAttribution({ keys, now: () => now, onInvalid(_req, res) { rejected++;return res.status(401).json({ code: "PROXY_AUTH_INVALID" }); } });
  const limiter = rateLimit({ windowMs: 60000, max: 2, standardHeaders: true, legacyHeaders: false, keyGenerator: req => rateIdentity(req).key });
  app.post("/api/chat", attribution, limiter, (req, res) => { accepted++;res.json({ scope: rateIdentity(req).scope }); });
  const server = await new Promise(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  const url = `http://127.0.0.1:${server.address().port}/api/chat`;
  try { await run({
    send: (headers = {}, value = body, suffix = "") => fetch(url + suffix, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: value }),
    counts: () => ({ accepted, rejected }),
  }); } finally { server.closeAllConnections();await new Promise(resolve => server.close(resolve)); }
}

test("real Express limiter isolates two signed network pseudonyms behind the same socket", async () => {
  await fixture(async ({ send }) => {
    const a = signedHeaders(), b = signedHeaders({ visitor: "b".repeat(64) });
    assert.equal((await send(a)).status, 200);assert.equal((await send(a)).status, 200);
    const limited = await send(a);assert.equal(limited.status, 429);assert.equal(limited.headers.get("x-fearless-rate-scope"), "website");
    const independent = await send(b);assert.equal(independent.status, 200);assert.equal(independent.headers.get("x-fearless-rate-scope"), "website");assert.deepEqual(await independent.json(), { scope: "website" });
  });
});

test("unsigned legacy requests keep their socket quota and cannot select a bucket with forwarded headers", async () => {
  await fixture(async ({ send }) => {
    assert.equal((await send({ "X-Forwarded-For": "192.0.2.1" })).status, 200);
    assert.equal((await send({ "X-Forwarded-For": "192.0.2.2" })).status, 200);
    const legacy = await send({ "X-Forwarded-For": "192.0.2.3" });assert.equal(legacy.status, 429);assert.equal(legacy.headers.get("x-fearless-rate-scope"), "legacy");
    assert.equal((await send(signedHeaders())).status, 200);
  });
});

test("partial, malformed and forged claims return401 before quota or application work", async () => {
  await fixture(async ({ send, counts }) => {
    const valid = signedHeaders();
    const invalid = [
      { "X-Fearless-Proxy-Visitor": "a".repeat(64) }, { "X-Fearless-Proxy-Unknown": "claimed" },
      { ...valid, "X-Fearless-Proxy-Version": "2" }, { ...valid, "X-Fearless-Proxy-Key-Id": "unknown" },
      { ...valid, "X-Fearless-Proxy-Timestamp": "01700000000" }, { ...valid, "X-Fearless-Proxy-Visitor": "raw-client-address" },
      { ...valid, "X-Fearless-Proxy-Visitor": "b".repeat(64) }, { ...valid, "X-Fearless-Proxy-Signature": "A".repeat(86) },
      { ...valid, "X-Fearless-Proxy-Signature": valid["X-Fearless-Proxy-Signature"] + "=" },
      { ...valid, "X-Fearless-Proxy-Visitor": ["a".repeat(64), "b".repeat(64)].join(", ") },
    ];
    for (const headers of invalid) { const response = await send(headers);assert.equal(response.status, 401);assert.equal(response.headers.get("x-fearless-rate-scope"), null);assert.deepEqual(await response.json(), { code: "PROXY_AUTH_INVALID" }); }
    assert.deepEqual(counts(), { accepted: 0, rejected: invalid.length });
    assert.equal((await send()).status, 200);assert.equal((await send(valid)).status, 200);
  });
});

test("signatures bind the exact JSON bytes, method and endpoint rather than parsed messages", async () => {
  await fixture(async ({ send }) => {
    assert.equal((await send(signedHeaders(), " " + body)).status, 401);
    assert.equal((await send(signedHeaders(), body.replace("Public fixture", "Modified fixture"))).status, 401);
    assert.equal((await send(signedHeaders({ method: "GET" }))).status, 401);
    assert.equal((await send(signedHeaders({ path: "/other" }))).status, 401);
    assert.equal((await send(signedHeaders(), body, "?extra=1")).status, 401);
    assert.equal((await send(signedHeaders())).status, 200);
  });
});

test("expired and excessive future timestamps reject while exact clock bounds remain valid", async () => {
  await fixture(async ({ send }) => {
    assert.equal((await send(signedHeaders({ timestamp: second - 121 }))).status, 401);
    assert.equal((await send(signedHeaders({ timestamp: second + 16 }))).status, 401);
    assert.equal((await send(signedHeaders({ timestamp: second - 120 }))).status, 200);
    assert.equal((await send(signedHeaders({ timestamp: second + 15 }))).status, 200);
  });
});

test("committed verification material is public Ed25519 and no invalid key configuration silently disables verification", () => {
  const config = require("../website-proxy-public-key.json");
  assert.ok(config.keys.some(key => key.id === "website20261112"));
  for (const key of config.keys) { assert.equal(createPublicKey(key.publicKeyPem).asymmetricKeyType, "ed25519");assert.doesNotMatch(key.publicKeyPem, /PRIVATE KEY/); }
  assert.throws(() => createProxyAttribution({ keys: [], onInvalid() {} }), /required/);
  assert.throws(() => createProxyAttribution({ keys: [...keys, ...keys], onInvalid() {} }), /configuration/);
});
