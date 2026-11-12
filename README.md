# Fearless assistant

The Express service preserves the original Claude conversation and team escalation workflow. `server.js` supplements the original system instructions with current public website knowledge.

## Public knowledge

`knowledge-context.js` reads the fixed public catalog at `https://www.fearless.church/api/assistant-context`. It selects relevant page and sermon passages locally against recent conversation text. Questions are not sent to a search engine or included in a query string. Current published facts take precedence over legacy facts in the original prompt.

`events-context.js` reads `https://www.fearless.church/api/events` independently. It accepts explicitly published events, filters expired occurrences on every request, preserves time zones and exact registration URLs, and distinguishes calendar dates from known times. Its event facts take precedence over other event references.

Both providers have bounded HTTPS requests, no forwarded credentials, no redirects, a five minute cache, a three second fetch deadline, and a maximum stale age of twenty four hours. Concurrent refreshes share one request. Failures are identified in the model context. Stale facts require a disclosure and do not carry outbound action links. Missing records do not imply an event was cancelled or that nothing is planned.

The public catalog excludes protected staff pages and unpublished content. Only known fields enter the context. Reference text is data, never instructions. The original user and assistant messages are still passed to Claude unchanged; the service does not replace model replies with canned answers.

## Validation

Run `node --test tests/*.test.js` and `node --check server.js`. Tests use local fixtures and do not contact Anthropic, Resend, staff or visitors.

For deployment verification, check `/health` for revision `reliability-signed-20261112`, then ask benign questions through the live website. Confirm the real answer and destination, including Men's Breakfast, Sunday location and The Table. Do not supply a name or email or ask for staff followup: the original escalation workflow sends real email.

The website proxy additionally retries only an explicit upstream edge challenge proven by all three markers: HTTP 429, `cf-mitigated: challenge`, and an HTML response. It does not retry ambiguous application or network failures that might follow an email action.

## Application diagnostics and escalation acceptance

An application rate limit returns HTTP 429, `X-Fearless-Error: CHAT_RATE_LIMITED`, JSON code `CHAT_RATE_LIMITED`, and matching `Retry-After` and `retryAfterSeconds` values between 1 and 60. This distinguishes the Express quota from an upstream hosting or edge response. The existing quota remains 30 requests per minute for each attributed key.

Requests receive a generated `X-Fearless-Request-Id`. Structured logs include only that identifier, event, stage, status and validated `rateScope` of `website` or `legacy`. Invalid authentication is recorded only as `attribution: invalid`. Conversation text, visitor identity, pseudonyms, body hashes, signing headers, email contents, provider response IDs and raw provider exceptions are not logged.

Escalation succeeds only when Resend returns a nonempty `data.id` and no error. The visitor receives a factual submitted confirmation after provider acceptance; acceptance does not prove delivery. This replaces escalation text that could otherwise be empty or make unsupported delivery or followup timing claims. Returned errors, malformed responses and thrown failures instead produce an honest uncertainty message and direct contact option. Normal model replies and the original prompt remain unchanged.

No automatic retries or deduplication were added. The current protocol has no stable logical submission identifier, so adding deduplication now could incorrectly suppress a separate inquiry. Keep ambiguous sends unretried until a deliberate submission identifier and provider idempotency contract are implemented together.

## Signed website attribution

The Sites website signs its outbound chat requests with an Ed25519 private key kept only in Sites runtime secrets. This repository contains only the public verification keys in `website-proxy-public-key.json`. A separate Sites secret derives a daily HMAC pseudonym from the trusted incoming client address. The raw address is never sent in the signing headers.

The five headers are `X-Fearless-Proxy-Version: 1`, `X-Fearless-Proxy-Key-Id: website20261112`, `X-Fearless-Proxy-Timestamp` as canonical Unix seconds, `X-Fearless-Proxy-Visitor` as 64 lowercase hexadecimal characters, and `X-Fearless-Proxy-Signature` as an unpadded canonical base64url Ed25519 signature. The exact UTF8 signing payload is:

```
fearless-chat-v1
POST
/api/chat
<key id>
<timestamp>
<visitor pseudonym>
<SHA256 lowercase hexadecimal digest of the exact JSON body bytes>
```

The JSON parser hashes its original body buffer without retaining it separately. Verification accepts a timestamp at most 120 seconds old or 15 seconds ahead. Method, endpoint, key, timestamp, pseudonym and body are bound to the signature. Any partial, unknown, expired, malformed or invalid signing claim returns HTTP 401 and `PROXY_AUTH_INVALID`; it never falls back to unsigned access.

Verified requests use a `website:<pseudonym>` quota key. Requests with no signing claim retain a separate `legacy:<socket address>` quota, ignoring forwarded IP headers. `trust proxy` is not broadly enabled. Successful and limited responses expose only `X-Fearless-Rate-Scope: website` or `legacy`, never the quota key.

This isolates website networks from the shared Render socket bucket. People sharing one public network address still share a quota. Counters remain in the existing process memory store and reset on restart; multiple instances would require a shared counter store. Signatures authenticate attribution, not uniqueness: replaying a still valid signed request uses the same quota and is not an idempotency guarantee.

Deploy public verification keys before enabling the corresponding Sites signer. For rotation, add the new public key, switch the signer, then remove the old public key after its final 120 second validity window. An older unsigned website remains compatible with the legacy path during rollout or rollback. Never commit either Sites signing secret.

## Release and rollback

Publish one atomic source commit containing `server.js` and both context modules. Confirm the deployed health revision before declaring the update live. A GitHub branch update alone does not prove that the hosting service has deployed it.

Before this public knowledge update, the deployed source was commit `80458405fb893a290c1ba50ea14149d2caebb997`. Revert the release commit through the normal source deployment if needed, then verify `/health` and a live chat again. Keep runtime credentials in the hosting environment; never commit them.
