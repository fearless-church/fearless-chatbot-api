"use strict";
const { createHash, createPublicKey, verify } = require("node:crypto");
const bodyHash = Symbol("fearlessBodyHash");
const identity = Symbol("fearlessRateIdentity");
const headerNames = ["x-fearless-proxy-version", "x-fearless-proxy-key-id", "x-fearless-proxy-timestamp", "x-fearless-proxy-visitor", "x-fearless-proxy-signature"];

/** Hash the parser's original bytes. Never retain the raw body or log its digest. */
function captureBodyHash(req, _res, buffer) {
  req[bodyHash] = createHash("sha256").update(buffer).digest("hex");
}
function rateIdentity(req) {
  return req[identity] ?? { scope: "legacy", key: `legacy:${req.socket?.remoteAddress ?? "unknown"}` };
}
function createProxyAttribution({ keys, onInvalid, now = () => Date.now() }) {
  const publicKeys = new Map();
  for (const record of keys) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(record.id) || publicKeys.has(record.id)) throw new Error("Invalid public proxy key configuration");
    const key = createPublicKey(record.publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("Proxy verification requires an Ed25519 public key");
    publicKeys.set(record.id, key);
  }
  if (!publicKeys.size) throw new Error("A public proxy verification key is required");
  return function attributeRequest(req, res, next) {
    const supplied = Object.entries(req.headers).filter(([name]) => name.toLowerCase().startsWith("x-fearless-proxy-"));
    if (!supplied.length) {
      req[identity] = { scope: "legacy", key: `legacy:${req.socket?.remoteAddress ?? "unknown"}` };
      res.setHeader("X-Fearless-Rate-Scope", "legacy");
      return next();
    }
    const reject = () => onInvalid(req, res);
    if (supplied.length !== headerNames.length) return reject();
    const headers = Object.fromEntries(supplied.map(([name, value]) => [name.toLowerCase(), value]));
    if (headerNames.some(name => typeof headers[name] !== "string")) return reject();
    const version = headers[headerNames[0]], keyId = headers[headerNames[1]], timestamp = headers[headerNames[2]], visitor = headers[headerNames[3]], signature = headers[headerNames[4]];
    if (version !== "1" || !publicKeys.has(keyId) || !/^[1-9]\d{8,11}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(visitor) || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return reject();
    const age = Math.floor(now() / 1000) - Number(timestamp);
    if (age > 120 || age < -15 || req.method !== "POST" || req.originalUrl !== "/api/chat" || !req[bodyHash]) return reject();
    const bytes = Buffer.from(signature, "base64url");
    if (bytes.length !== 64 || bytes.toString("base64url") !== signature) return reject();
    const payload = `fearless-chat-v1\nPOST\n/api/chat\n${keyId}\n${timestamp}\n${visitor}\n${req[bodyHash]}`;
    try { if (!verify(null, Buffer.from(payload, "utf8"), publicKeys.get(keyId), bytes)) return reject(); }
    catch { return reject(); }
    req[identity] = { scope: "website", key: `website:${visitor}` };
    res.setHeader("X-Fearless-Rate-Scope", "website");
    return next();
  };
}

module.exports = { captureBodyHash, createProxyAttribution, rateIdentity };
