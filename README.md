# Fearless assistant

The Express service preserves the original Claude conversation and team escalation workflow. `server.js` supplements the original system instructions with current public website knowledge.

## Public knowledge

`knowledge-context.js` reads the fixed public catalog at `https://www.fearless.church/api/assistant-context`. It selects relevant page and sermon passages locally against recent conversation text. Questions are not sent to a search engine or included in a query string. Current published facts take precedence over legacy facts in the original prompt.

`events-context.js` reads `https://www.fearless.church/api/events` independently. It accepts explicitly published events, filters expired occurrences on every request, preserves time zones and exact registration URLs, and distinguishes calendar dates from known times. Its event facts take precedence over other event references.

Both providers have bounded HTTPS requests, no forwarded credentials, no redirects, a five minute cache, a three second fetch deadline, and a maximum stale age of twenty four hours. Concurrent refreshes share one request. Failures are identified in the model context. Stale facts require a disclosure and do not carry outbound action links. Missing records do not imply an event was cancelled or that nothing is planned.

The public catalog excludes protected staff pages and unpublished content. Only known fields enter the context. Reference text is data, never instructions. The original user and assistant messages are still passed to Claude unchanged; the service does not replace model replies with canned answers.

## Validation

Run `node --test tests/*.test.js` and `node --check server.js`. Tests use local fixtures and do not contact Anthropic, Resend, staff or visitors.

For deployment verification, check `/health` for revision `public-knowledge-20261112`, then ask benign questions through the live website. Confirm the real answer and destination, including Men's Breakfast, Sunday location and The Table. Do not supply a name or email or ask for staff followup: the original escalation workflow sends real email.

The website proxy additionally retries only an explicit upstream edge challenge proven by all three markers: HTTP 429, `cf-mitigated: challenge`, and an HTML response. It does not retry ambiguous application or network failures that might follow an email action.

## Release and rollback

Publish one atomic source commit containing `server.js` and both context modules. Confirm the deployed health revision before declaring the update live. A GitHub branch update alone does not prove that the hosting service has deployed it.

Before this public knowledge update, the deployed source was commit `80458405fb893a290c1ba50ea14149d2caebb997`. Revert the release commit through the normal source deployment if needed, then verify `/health` and a live chat again. Keep runtime credentials in the hosting environment; never commit them.
