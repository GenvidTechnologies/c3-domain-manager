---
type: decision-record
---

# ADR 0029: Adopt `parseTxToken` for `txId` rejection diagnostics

**Status:** Accepted
**Date:** 2026-09-11
**Issue:** #79 — bump `@genvidtech/mcp-utils` to `^0.10.0` and decide whether to
adopt its discriminated `parseTxToken`; the consumer-side counterpart of
`GenvidTechnologies/mcp-utils#25`

---

## Context

### One message stood for two different failures

[[0028-mcp-server-multi-project-support]] moved `txId` from a bare integer to a
composite `<projectId>:<n>` string and routed both minting and comparison
through `@genvidtech/mcp-utils`'s shared codec. `compareTxToken` answers a
plain `boolean`, so the optimistic-concurrency guard behind `set-overrides` and
`remove-overrides` collapsed every rejection into a single rendering:

> `State changed: expected txId <sent>, got <current>. Re-read state and retry.`

That sentence is correct for a **stale** counter. For an **unparseable** token
— `alpha:03`, `garbage`, a bare integer left over from a pre-0.10.0 client — it
is false twice over. The state did not change, and the remedy it prescribes can
never work: the caller's token generator is producing something the wire format
does not admit, so re-reading state and retrying fails identically every time.
A client is sent into a loop by a message that names the wrong subsystem.

### 0.10.0 makes the distinction available without re-deriving anything

`parseTxToken`'s return type changed from `{ projectId; n } | null` to a
discriminated `{ ok: true; projectId; n } | { ok: false; reason:
TxTokenParseFailure }`, where `TxTokenParseFailure` has five members. Why five
rather than the three the request was filed with, and which alternative shapes
were rejected upstream, is recorded in that package's own
`wiki/decisions/0007-tx-token-parse-failure-reason.md`
(`GenvidTechnologies/mcp-utils`) — cited here rather than restated, since it is
upstream's decision about upstream's surface and a second copy would drift from
it.

### The argument that justified the upstream feature does not apply here

`GenvidTechnologies/mcp-utils#25`'s case rests on duplication and drift: a
consumer that wants a specific diagnostic must reimplement the accept set, and
a local classifier keeps emitting the old reason after an upstream release
moves that set. The issue's **corrected** text records that this repo is not
that consumer — it "maintains no local classifier and re-derives nothing."

So the upstream rationale cannot simply be inherited. The case for adopting
here is narrower and independent: the message this server renders for a
malformed token is **false**, and prescribes a remedy that cannot work. That
defect exists whether or not any duplication is in play, and it is the whole of
the argument below.

## Decision

### Adopt `parseTxToken` in `checkTxToken`, three-way and prefix-preserving

`src/mcp/server.ts`'s `checkTxToken` — the single guard
[[0028-mcp-server-multi-project-support]]'s `registerProjectTool` discipline
funnels both mutate tools through, extracted from its two copies earlier in
this issue — now parses before it compares and renders three distinguishable
outcomes:

| input class | rendering |
|---|---|
| malformed | `Invalid txId '<sent>' — <reason text>. Call get-state for the current txId.` |
| wrong project | the stale line, with ` That token names project '<a>', but this call targets '<b>'.` appended after `got <token>.` |
| stale counter | the existing stale line, unchanged |

### What adoption buys, stated precisely

Exactly **one genuinely new signal** and **one relabel**:

- **New:** the malformed class, which previously had no rendering of its own at
  all, now names what is wrong with the token.
- **Relabel, not new information:** the wrong-project case was already
  *inferable* from the existing message, because it renders both tokens and
  their project halves visibly differ (`expected txId beta:0, got alpha:1`).
  The appended clause states that explicitly rather than leaving a reader to
  notice it.

That accounting is deliberate. Overstating the second as a new capability would
misprice the change and, worse, would have made the issue's own sketch (which
*replaces* the message, see below) look like a fair trade.

### The wrong-project clause is appended, never substituted

`test/mcp/multiProjectIsolation.test.ts`'s cross-project row asserts the stale
message through the harness's `assertToolError`, whose comparison is
`assert.include` — a substring match — and whose needle ends immediately before
the `.` that closes `got <token>`. An appended clause therefore leaves that
needle contiguous, and a replacing one does not.

This was checked twice, by two different methods: simulated across all three
candidate wordings at design time (today's message passes, the appended variant
passes, the replacing variant fails), and then executed at implementation time.
That suite file is untouched by this issue and its assertions still pass.

### `compareTxToken` stays the sole authority on accept/reject

`parseTxToken`'s result is used **only to diagnose**. The accept decision is
still `compareTxToken`'s alone, and no second comparison was hand-rolled beside
the shared codec — reconstructing `parsed.projectId === ctx.id && parsed.n ===
ctx.watcher.txId` locally would reintroduce exactly the divergence
[[0028-mcp-server-multi-project-support]] extracted the codec upstream to
prevent.

That split is what makes this **provably** a rendering change and nothing more.
`compareTxToken`'s body is `parsed.ok && …`, so every input newly routed to the
malformed branch had already compared `false` under the old code. Which writes
are accepted cannot move.

### Exhaustiveness over the reason union is a `tsc`-only guarantee

The reason-to-text table is annotated `Record<TxTokenParseFailure, string>`, so
an upstream addition to the union becomes a compile error here rather than a
silently missing message. The enforcement was **measured, not assumed** —
deleting one key yields:

```
error TS2741: Property '"counter-out-of-range"' is missing in type
'{ ... }' but required in type 'Record<TxTokenParseFailure, string>'.
```

Note where that guarantee lives, because it is easy to assume the suite carries
it: `npm test` runs through `tsx`, which strips types without checking them. A
green suite says nothing whatever about exhaustiveness — only `npm run
typecheck` does. This is the same gates-disagree property the bump commit
recorded in the other direction, where four assertions type-checked cleanly and
failed only at runtime.

### `"not-a-string"` is unreachable here yet keeps a key

`txId` is `z.string().optional()` on both mutate tools, so zod rejects a
non-string with its own validation error before the handler runs. The key is
kept because the `Record` annotation requires one per union member, and it
carries a comment saying so, so that a later reader does not delete it as dead
code and reopen the exhaustiveness hole the annotation exists to close.

### How "the accept set did not move" was established here

The claim that 0.10.0 rejects and accepts exactly what 0.9.0 did is
load-bearing — it is the reason this adoption cannot change behaviour — so it
was established against the artifacts rather than carried over from upstream's
own measurement of its own code:

- **A guard-by-guard correspondence** between the packed `dist/txToken.js` of
  both releases. 0.9.0's four `return null` sites map onto 0.10.0's five
  `{ ok: false, reason }` sites over the same predicates in the same order; the
  one-to-many step is 0.9.0's third guard, the disjunction
  `!isValidProjectId(projectId) || !TX_N.test(rest)`, split into two sequential
  early returns so each half can name itself. A disjunction and two sequential
  early returns over the same two predicates reject exactly the same inputs, so
  the split cannot move the accept set. No predicate was added, removed or
  altered, and `TX_N` is byte-identical.
- **An executed truth-table comparison of `compareTxToken`** across both
  versions over a matrix covering the empty string, a trailing colon, a wrong
  project, a wrong counter and an over-large counter, with zero disagreements.
  Its body differs by one token (`parsed !== null` → `parsed.ok`); the matrix
  is what makes that a measurement rather than a reading.

## Alternatives Considered

**Decline — keep the single generic message.** Rejected. This was a real
option, and the issue filed it as the default: the generic message has caused
no reported problem and `compareTxToken` alone is the simpler call. What
settles it is not polish but correctness — for malformed input the message
states something untrue about the server's state *and* directs the caller to a
recovery procedure that is guaranteed to fail. Declining would have been
recording that a false message is deliberate.

**Split out the malformed case only, leaving wrong-project on the stale
message.** Rejected. It fixes the new-information half and leaves the remaining
message literally false in the wrong-project case: the state did not change
there either. The marginal cost of the appended clause over the malformed-only
split is one conditional string.

**The issue's own sketch — three branches, each with its own message,
replacing the stale line for the wrong-project case.** Rejected. It renders no
information the chosen shape does not, and it breaks the cross-project
assertion written deliberately for issue #77's rows (see "appended, never
substituted" above), so the trade is a retired test for a wording preference.
Recording this explicitly because the sketch is the shape a reader arrives with
from the issue body, and its defect is not visible from the issue body alone.

**Classify the failure locally rather than importing the upstream result.**
Rejected without much weighing: it is precisely the local-classifier drift trap
`GenvidTechnologies/mcp-utils#25` argues against, and this repo is the consumer
that repo's corrected text credits with having no such classifier. Adopting one
now to render a nicer message would create the problem the upstream release
exists to remove.

**Sweep `@genvidtech/c3source` along with the lockfile refresh.** Rejected. Its
declared `^2.0.0` already permits the published 2.0.1, so a plain `npm install`
would have moved a second `@genvidtech/*` resolution inside a commit whose
subject is mcp-utils. It is held at 2.0.0 and its stated floor does not move,
because the *declared range* — which is what the two-place rule governs — is
unchanged.

## Compromise

**What was accepted.** The malformed rendering is a **user-visible output
change**: a client that today parses or matches on `State changed:` for a
malformed token will see `Invalid txId '…'` instead. That is the point of the
change rather than a side effect, but it is a behavioural change to an error
surface and is called out as such in the CHANGELOG. The reason *vocabulary* is
now this server's observable contract too — an upstream relabel of which reason
a given input yields would change this server's rendered output — which is why
`test/adapters/txToken.test.ts` pins the mapping at values measured by
executing the packed build rather than inferred from guard order.

Evidence for the new branch stays black-box, per
[[0025-mcp-server-stdio-test-harness]]: the tool-level case drives
`set-overrides` over stdio with a malformed token and asserts on the rendered
text, never against `checkTxToken` directly. It builds its token as a literal
rather than importing the codec, so the test grades the server's output against
an independently written expectation instead of asserting the codec's
self-consistency.

**What was rejected.** Every item above. Beyond those: no attempt was made to
cover the two reasons this repo never observes (`invalid-project-id`,
`counter-out-of-range`) with synthesized inputs at the tool level. Vocabulary
completeness is the `Record<TxTokenParseFailure, string>` annotation's job;
asserting reasons this server does not produce would be a second copy of an
upstream contract we do not consume.

## Consequences

- The `@genvidtech/mcp-utils` floor moves to `^0.10.0`. A caret below 1.0.0
  admits patch updates only, so `^0.9.0` excluded this minor and it could not
  arrive from a plain `npm install`.
- The floor is load-bearing **in `src/`** only because of this adoption. `src/`
  imports `formatTxToken` and `compareTxToken`, and neither changed in 0.10.0 —
  `formatTxToken` is byte-identical and `compareTxToken` differs by one token
  with an unchanged truth table. Without adopting `parseTxToken`, the new floor
  would have been load-bearing in `test/` alone.
- `@genvidtech/c3source` stays resolved at 2.0.0 and its stated `^2.0.0` floor
  does not move.
- The tool surface is unchanged — the same 14 project-scoped tools, no
  `inputSchema` key added — so this needs no `c3-explorer` allow-list
  reconciliation in `GenvidTechnologies/claude-code-plugin-gvt-construct3`
  beyond the routine exact-pin bump when a release carrying it ships.
- `test/adapters/txToken.test.ts` now pins the discriminated result and four
  measured reason values, so an upstream change to either the shape or the
  reason mapping surfaces in this repo's suite rather than at a client holding
  an incompatible token.
