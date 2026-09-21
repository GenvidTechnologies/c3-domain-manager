---
type: decision-record
---

# ADR 0030: An opt-in classification-coverage gate on `generate`

**Status:** Accepted
**Date:** 2026-09-19
**Issue:** #81 — give `generate` a way to fail a CI run when too many files are
unclassified, and decide the exit-code, ordering and error-semantics questions
that follow from it

---

## Context

### The analysis already knew; nothing could act on it

`computeDomainData` has always returned `{ domains, unclassified }`, and
`generate` has always printed the count (`N unclassified files!`) and one
`Unclassified: <path>` line per file. Every one of those runs exits **0**. So a
project can lose its classification coverage — a new `eventSheets/` folder, a
renamed directory, a `scriptDirs` entry that stopped matching — and a CI step
running `generate` reports success while the generated index quietly drops the
work from every domain page, every coupling edge and every health metric.

The cost is measurable, not theoretical. Against a large domain-foldered C3
project (~1,700 object types), `generate` under
that project's pre-rules config reported **1759** unclassified files and
resolved **0** cross-domain expression-reference edges; under its current
config, **1** unclassified file and **271** edges. The analysis is a different
analysis at the two ends of that range. **Both runs exited 0**, as did every
other run measured against it — and that project carries a live stray today,
invisible to any automated check.

### Nothing in `src/` could report the count to a caller anyway

`generateDomainIndex` returned `Promise<void>`. A CLI handler wanting to act on
the unclassified count had two options: re-run `computeDomainData` (a second
full walk of the project, and a second chance for the two results to disagree),
or scrape the count back out of the `log` callback's text. Widening the return
to the `ComputeDomainDataResult` the pure core already produced was the
precondition for everything below, and is a published API change in its own
right.

### This CLI has no recorded exit-code convention

`grep` over `wiki/decisions/` finds exactly one mention of an exit code across
the 29 records preceding this one, and it is about a *different* program — ADR
[[0027-retire-docs-tier-into-the-wiki-bundle]] noting that the `gvt-dev`
plugin's `audit-conventions` Practice Coverage report "carries no findings and
cannot affect the audit's exit code". No record speaks to *this* CLI's exit
codes at all. The convention below is therefore established here rather than
followed from somewhere.

## Decision

### Exit code 2 for a tripped gate; 1 stays "the command failed"

`UNCLASSIFIED_GATE_EXIT_CODE` (`src/adapters/unclassifiedGate.ts`) is **2**.

This CLI already exits 1 for a failed invocation — an unresolvable project
root, a bad `--config` path, a config that fails schema validation. A tripped
coverage gate is a *successful* analysis reporting a policy breach, and the two
call for opposite remedies: "your project has more unclassified files than you
allow" means editing `domain-config.json`, while "the tool could not run" means
fixing the invocation. Collapsing both onto 1 makes a broken pipeline step
indistinguishable from a real finding — the exact confusion a CI consumer buys
this flag to avoid.

A bad *threshold* is therefore an invocation error and exits **1**, not 2:
`--max-unclassified abc` never reaches the analysis, so it cannot be reporting
one.

**This inverts `audit-conventions`' polarity, deliberately.** `CONVENTIONS.md`
documents that tool as exiting "`0` if satisfied, `1` if any required
expectation is unmet, and `2` if the audit itself hits an unexpected error — a
broken tool, not a failed check." Here 2 *is* the failed check and 1 is closer
to the broken tool. The divergence is real and worth naming, because a reader
who knows one convention will read the other backwards. The only way to match
it would be to move **every** existing error path in this CLI from 1 to 2 — a
breaking change to every consumer's error handling, delivering nothing this
issue needs. Matching a sibling tool's numbering is not worth that; being
internally consistent with this CLI's own established 1 is.

### The index is written first, and the gate applied afterwards

`generateDomainIndex` **wipes** `<extracted>/domain-index/` before rewriting
it. Applying the gate earlier — refusing to generate at all when coverage is
short — would therefore leave the consumer with *no* index rather than a stale
one, on exactly the runs where they most need to look at something. And the
thing they need to look at is the failure's own instructions: the unclassified
paths are printed on stdout and listed under `## Unclassified Files` in the
generated `domain-index/index.md`. Suppressing the index to signal a problem
would delete the answer along with the question.

This was confirmed against the downstream consumer's own freshness check, which
regenerates the index and then diffs `extracted/`: a `generate` that failed
without writing would make that check and this gate **mutually unsatisfiable**
— every gated run would fail the freshness diff, and the only way to pass both
would be to stop using one of them.

### The CLI gate sits outside the `try`/`finally`, because `process.exit` skips `finally`

`process.exit()` does not run pending `finally` blocks. The `generate` handler's
`finally` is what removes the ephemeral temp directory created by
`--extracted none`, so a gate exit raised *inside* the `try` would leak a
directory on every tripped run — which is to say, on exactly the runs a CI
consumer schedules repeatedly.

This was established by **mutation, not by reading**: moving the `process.exit`
inside the `try` makes exactly one test fail — the ephemeral-cleanup case in
`test/cli/generateGate.test.ts` — and only that one. That test counts
`c3dm-extracted-*` survivors in a fresh, empty temp root, and carries a
positive control asserting the generator logged its output path *under* that
root first; without the control, a zero count would be equally consistent with
the directory never having been created there, and the assertion would pass
while proving nothing.

### Two yargs coercion holes, both closed — both were false greens

The flag is declared `type: "number"`, and yargs' coercion has two behaviours
that each **silently disable** the gate:

| invocation | what the handler receives | ungated outcome |
|---|---|---|
| `--max-unclassified` (bare, no value) | `undefined` — indistinguishable from the flag being absent | gate off, run exits 0 |
| `--max-unclassified abc` | the **number** `NaN` (`typeof` `"number"`) | `count > NaN` is `false`, so the gate never trips; run exits 0 |

Both are closed. `requiresArg: true` makes yargs refuse the bare form outright
(`Not enough arguments following: max-unclassified`), and `parseMaxUnclassified`
validates the value explicitly, rejecting `NaN`, infinities, negatives,
non-integers and any non-number while accepting `0`.

Their shape is why they are recorded rather than treated as routine input
validation: **both fail green**, in the one feature whose entire purpose is to
stop a green run from hiding a problem. A consumer who fat-fingers the flag
would get precisely the reassuring exit 0 they added the flag to eliminate. The
second hole also dictates a signature: `parseMaxUnclassified` takes `unknown`,
not `string`, because a parameter typed `string` would never see the failing
case at all — yargs has already turned it into a number.

`parseMaxUnclassified` also rejects `undefined` rather than reading it as "gate
off". Telling an absent flag from a present one is the caller's job precisely
because it is ambiguous on the CLI, and a guard written as `raw !== undefined`
is what turns a bare flag into no flag.

### `max` is an allowance (`>`), not a presence check (`>=`)

`unclassifiedGateTripped(count, max)` is `max !== undefined && count > max`.
`max: 0` permits zero and trips at one; `max: 1` permits one and trips at two.
A `>=` would make `max: 1` reject the very count it names.

### The failure message is one line and reprints nothing

`formatUnclassifiedGateFailure` renders a single newline-free line naming the
count, the threshold, and *where the paths already are*. At the measured 1759
baseline an exhaustive message would add 1759 lines to stderr and bury the
verdict it exists to deliver.

The option's name is injected by the caller rather than hardcoded, so the CLI
line names `--max-unclassified` and the MCP line names `maxUnclassified`. This
is not cosmetic: the `isError` bend below is licensed by the caller having
asked for failure semantics, and a response naming a CLI flag an MCP client
cannot pass would not be reflecting that request back. Raised in review on the
first version of this branch, which hardcoded the flag in both transports.

### On the MCP side, `regenerate` gains an optional `maxUnclassified` — and a scoped `isError` bend

`regenerate` accepts `maxUnclassified: z.number().int().min(0).optional()`.
When given and breached, it returns `isError: true` with the generator log and
the gate line as its content.

**This bends the repo's convention that findings are content and `isError` is
reserved for genuine failures.** The bend is scoped to this one tool and is
explicitly not a precedent for the four findings tools, which are untouched:
`list-uncategorized`, `list-stale-overrides`, `validate-editor` and
`addon-inventory` all continue to return their findings as plain text. What
distinguishes `regenerate` is that it is a `REGENERATE`-annotated **action**,
not a findings tool, and a caller passing `maxUnclassified` has explicitly
asked for "treat exceeding n as a failure". Reporting success would discard
that request.

Two ordering details carry weight:

- The gate is applied **after** `markRegenerated`. The index genuinely was
  regenerated, so `domainDirty` must clear even on a trip — otherwise a project
  permanently over threshold would carry the stale-index warning forever, and
  the warning would stop meaning anything.
- Startup auto-generation never consults the gate. A server that refused to
  start on a project with unclassified files would be unable to host the very
  tools a user needs to classify them.

Omitting the parameter leaves the response byte-identical to what it has always
been — and that claim sits **inside** `verify:behaviour-preservation`'s scope
rather than needing an exemption from it. That harness drives `regenerate` with
`{}`, which is exactly the default path; an optional `inputSchema` key changes
no output it compares. (Per `CLAUDE.md`, re-run it on demand rather than citing
a stale record of its result.)

### A threshold, not a boolean

The flag takes a number. At the measured 1759 baseline, a boolean
`--fail-on-unclassified` would have been unusable: that consumer could not
enable it at all without first classifying 1759 files, so the gate would be
adopted by nobody who needs it and by everybody who already has coverage. A
threshold lets a project pin today's count and ratchet it down, which is the
only adoption path that starts where real projects are.

The boolean is not lost — `--max-unclassified 0` *is* it.

## Alternatives Considered

**Ship both flags — a boolean `--fail-on-unclassified` alongside the
threshold.** Rejected. There is no coherent answer to
`--fail-on-unclassified --max-unclassified 5`: either the boolean wins and the
threshold the user typed is ignored, or the threshold wins and the boolean is a
no-op, and both are surprising. One flag with `0` as its strict setting has no
such interaction, and nothing the two-flag design expresses is inexpressible in
it.

**Give `list-uncategorized` the same flag.** Rejected, with a stated escape
hatch. The two sets are provably identical — [[0017-script-surface-unification]]
defines the command derivatively:

> `list-uncategorized` is the worklist for the domain index. A path is reportable
> exactly when assigning it to a domain would change what the generated index contains.

Under that definition a gate on `generate` and a gate on `list-uncategorized`
are the *same gate* over the same set, so a consumer already running `generate`
in CI gains nothing from a second invocation that re-walks the project to reach
the same number. The escape hatch: a consumer with no `generate` step at all is
a real possibility, and adding the flag there later is a small, additive change
— the predicate, the parser, the exit code and the message all already live in
a shared adapter module with no CLI or MCP dependency, precisely so a second
call site costs a wiring change and no new rule.

**Fail before generating.** Rejected — see "written first, gated afterwards"
above. It deletes the index that explains the failure and makes the downstream
freshness check mutually unsatisfiable with this one.

**Gate on by default (a non-zero count fails the run).** Rejected without much
weighing. Every existing caller's build would turn red on upgrade, for an
analysis whose output they may be reading exactly as intended. The flag is
opt-in, and the no-flag path — report the count, exit 0 — is locked by a test
captured *before* the gate had any CLI surface, so the behaviour the gate must
leave alone is pinned by a measurement rather than by intent.

**Exit 1 for a tripped gate.** Rejected — see the exit-code section. It is the
smaller diff and it costs the distinction the feature exists to provide.

## Compromise

**What was accepted.**

- **A divergence from `audit-conventions`' 0/1/2 polarity**, permanently. A
  reader fluent in one tool's numbering will misread the other's until they
  check. Accepted because the alternative renumbers every existing error path
  in this CLI.
- **`isError: true` from a tool whose work succeeded.** An MCP client with a
  generic "tool errored, so nothing happened" assumption will be wrong about
  `regenerate` with a breached `maxUnclassified`: the index *was* written and
  `domainDirty` *was* cleared. The tool description says so explicitly ("the
  index is regenerated and `domainDirty` cleared either way"), which is a
  weaker guarantee than a type but is the only channel the protocol offers.
- **A widened published return.** `generateDomainIndex` now resolves to
  `ComputeDomainDataResult` rather than `void`. Additive for every existing
  caller, but it is a public API surface change and is recorded in the
  CHANGELOG as one.
- **The gate's evidence is black-box, per [[0025-mcp-server-stdio-test-harness]].**
  The CLI cases spawn a real child process, because the process exit code is
  the thing under contract and only a real child has one; the MCP cases drive
  `regenerate` over stdio. Neither asserts against the handler directly.

**What was rejected.** Every alternative above. Beyond those: no attempt was
made to make the gate configurable from `domain-config.json`. A threshold is CI
policy, not a property of the domain model, and putting it in the config would
put the project's own quality bar inside the file the gate exists to make
someone edit.

## Consequences

- `generate` gains `--max-unclassified <n>`; omitted, its behaviour is
  unchanged and it still exits 0 at any count.
- Exit code **2** now has a meaning in this CLI, and this record is the
  convention for it: a successful analysis reporting a policy breach. A future
  gate should reuse 2 rather than inventing 3.
- `generateDomainIndex` resolves to `ComputeDomainDataResult`. The `README.md`
  Library API table records the new signature.
- The MCP tool count is unchanged at 15, but `regenerate`'s `inputSchema` gains
  an optional key — so a `c3-explorer` allow-list reconciliation in
  `GenvidTechnologies/claude-code-plugin-gvt-construct3` should confirm the new
  parameter passes through when a release carrying it ships.
- `test/cliHarness.ts` is new: a spawning CLI harness (`runCli`), the first in
  this repo. Exit codes are now testable, which they were not before; a spawn
  measured ~1.9s, so its suites set an explicit 30s timeout rather than living
  under mocha's 5000ms default.
- Suite at the close of this issue: **527 passing, 0 failing.**
