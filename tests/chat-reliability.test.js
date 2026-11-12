"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../server"), "utf8");
const marker = '[ESCALATE: name="Fixture Visitor" email="fixture@example.test" question="A private fixture inquiry"]';

function harness(options = {}) {
  let handler, limiter, sequence = 0;
  const sends = [], modelCalls = [], logs = [];
  const app = { use() {}, post(_path, _limiter, fn) { handler = fn; }, get() {}, listen() {} };
  const express = () => app; express.json = () => () => {};
  const state = { reply: options.reply ?? "The unchanged original reply.", send: options.send ?? (async () => ({ data: { id: "private-provider-id" }, error: null })) };
  const deps = {
    express, cors: () => () => {}, "express-rate-limit": (value) => { limiter = value; return () => {}; },
    "node:crypto": { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` },
    "@anthropic-ai/sdk": { default: class { constructor() { this.messages = { create: async request => { modelCalls.push(request); if (options.modelFailure) throw new Error("PRIVATE_PROVIDER_SECRET"); return { content: [{ type: "text", text: state.reply }] }; } }; } } },
    resend: { Resend: class { constructor() { this.emails = { send: async (...args) => { sends.push(args); return state.send(...args); } }; } } },
    "./events-context": { createEventContextProvider: () => async () => "Verified public events." },
    "./knowledge-context": { createKnowledgeContextProvider: () => async () => "Verified public website." },
  };
  vm.runInNewContext(source, { require(name) { if (!deps[name]) throw Error(`Unexpected dependency ${name}`); return deps[name]; }, process: { env: {} }, Date, console: { log(value) { logs.push(value); }, error(value) { logs.push(value); } } });
  function response() { return { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } }; }
  return { sends, modelCalls, logs, limiter, state,
    async post(messages = [{ role: "user", content: "PRIVATE_CONVERSATION_SENTINEL" }]) { const res = response(); await handler({ body: { messages }, headers: { "x-fearless-request-id": "PRIVATE_HEADER_SENTINEL" } }, res); return res; },
    rateLimit(resetTime) { const res = response(); limiter.handler({ rateLimit: { resetTime } }, res); return res; },
  };
}

test("a marker-only escalation returns a nonempty confirmation only after provider acceptance", async () => {
  const h = harness({ reply: marker });
  const response = await h.post();
  assert.equal(response.statusCode, 200);assert.match(response.body.message, /submitted your question/);assert.doesNotMatch(response.body.message, /delivered|ESCALATE/);
  assert.equal(h.sends.length, 1);assert.equal(h.sends[0][0].to[0], "info@fearless.church");assert.equal(h.sends[0][0].cc[0], "fixture@example.test");assert.equal(h.sends[0][0].replyTo, "fixture@example.test");
  assert.equal(h.modelCalls.length, 1);assert.ok(h.logs.some(log => log.stage === "escalation_accepted"));
  const requestId = response.headers["x-fearless-request-id"];assert.match(requestId, /^[0-9a-f-]{36}$/);assert.ok(h.logs.every(log => log.requestId === requestId));
  assert.doesNotMatch(JSON.stringify(h.logs), /Fixture Visitor|fixture@example|private fixture inquiry|private-provider-id|PRIVATE_/);
});

test("normal replies retain original wording while escalation confirmation cannot claim delivery or guaranteed followup", async () => {
  const normal = "**The original reply**\nhttps://www.fearless.church/events";
  const h = harness({ reply: normal });assert.equal((await h.post()).body.message, normal);assert.equal(h.sends.length, 0);
  h.state.reply = `Your email has been delivered. Our team will reply in five minutes.\n${marker}`;
  const response = await h.post();assert.match(response.body.message, /submitted your question/);assert.doesNotMatch(response.body.message, /delivered|five minutes|will reply/);assert.equal(h.sends.length, 1);
});

test("escalation confirmation waits for the provider acceptance result", async () => {
  let accept, started;
  const sending = new Promise(resolve => { started = resolve; });
  const h = harness({ reply: marker, send: () => { started(); return new Promise(resolve => { accept = resolve; }); } });
  const pending = h.post();await sending;
  assert.ok(!h.logs.some(log => log.stage === "escalation_accepted"));
  assert.equal(await Promise.race([pending.then(() => "completed"), Promise.resolve("waiting")]), "waiting");
  accept({ data: { id: "accepted-fixture-id" }, error: null });
  assert.match((await pending).body.message, /submitted your question/);assert.equal(h.sends.length, 1);
});

test("returned provider errors never become a false email success and are not retried", async () => {
  for (const delivery of [{ data: null, error: { message: "PRIVATE_RESEND_ERROR" } }, { data: { id: "not-accepted" }, error: { message: "PRIVATE_RESEND_ERROR" } }, { data: null, error: null }, { data: { id: "" }, error: null }, undefined]) {
    const h = harness({ reply: `I've sent your question.\n${marker}`, send: async () => delivery });
    const response = await h.post();assert.equal(response.statusCode, 200);assert.equal(response.body.code, "ESCALATION_UNCONFIRMED");
    assert.match(response.body.message, /couldn't confirm/);assert.match(response.body.message, /info@fearless\.church/);assert.doesNotMatch(response.body.message, /I've sent|delivered|ESCALATE/);
    assert.equal(h.sends.length, 1);assert.equal(h.modelCalls.length, 1);assert.ok(!h.logs.some(log => log.stage === "escalation_accepted"));
    assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_|Fixture Visitor|fixture@example/);
  }
});

test("thrown email failures acknowledge uncertainty without retrying or claiming delivery", async () => {
  const h = harness({ reply: marker, send: async () => { throw new Error("PRIVATE_NETWORK_DETAILS"); } });
  const response = await h.post();assert.equal(response.body.code, "ESCALATION_UNCONFIRMED");assert.match(response.body.message, /couldn't confirm/);
  assert.equal(h.sends.length, 1);assert.equal(h.modelCalls.length, 1);assert.equal(h.logs[0].stage, "escalation_unconfirmed");assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_NETWORK_DETAILS/);
});

test("separate inquiries retain their own email action and generated correlation identity", async () => {
  const h = harness({ reply: marker });const first = await h.post();
  h.state.reply = marker.replace("A private fixture inquiry", "A different fixture inquiry");
  const second = await h.post([{ role: "user", content: "A separate inquiry" }]);
  assert.equal(h.sends.length, 2);assert.notEqual(h.sends[0][0].html, h.sends[1][0].html);assert.notEqual(first.headers["x-fearless-request-id"], second.headers["x-fearless-request-id"]);
});

test("application rate limits carry an explicit marker and matching bounded retry delay", () => {
  const h = harness();assert.equal(h.limiter.max, 30);assert.equal(h.limiter.windowMs, 60000);assert.equal(h.limiter.standardHeaders, true);assert.equal(h.limiter.legacyHeaders, false);
  for (const [reset, expected] of [[undefined, 60], [new Date(Date.now() - 1000), 1], [new Date(Date.now() + 120000), 60]]) {
    const res = h.rateLimit(reset);assert.equal(res.statusCode, 429);assert.equal(res.headers["x-fearless-error"], "CHAT_RATE_LIMITED");assert.equal(res.body.code, "CHAT_RATE_LIMITED");assert.equal(res.body.retryAfterSeconds, expected);assert.equal(res.headers["retry-after"], String(expected));assert.ok(res.headers["x-fearless-request-id"]);
  }
  assert.equal(h.modelCalls.length, 0);assert.equal(h.sends.length, 0);assert.ok(h.logs.every(log => log.stage === "rate_limit" && log.status === 429));
});

test("model failures remain errors and diagnostics exclude raw provider details", async () => {
  const h = harness({ modelFailure: true });const res = await h.post();
  assert.equal(res.statusCode, 500);assert.equal(h.sends.length, 0);assert.equal(h.logs[0].stage, "model");assert.doesNotMatch(JSON.stringify([res.body, h.logs]), /PRIVATE_PROVIDER_SECRET|PRIVATE_CONVERSATION_SENTINEL/);
});
