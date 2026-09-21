---
type: practice-note
title: How a pre-committed acceptance criterion is wrong before anyone runs it
description: Four shapes of defect measured across two issues' pre-committed criteria — a row that grades green on an untouched checkout, a row whose corpus is narrower than the property it protects, a row falsified by a later task in its own plan, and a row whose measurement procedure cannot pass at all, whose correct red then reads as a finding about the code — plus the coverage gap none of them can expose, and which reader catches which.
tags: [acceptance-criteria, verification, practice, plan-task]
status: stable
stale_after: 2027-09-19
generated: { by: process:maintain-wiki, at: 2026-09-19T00:00:00Z }
sources:
  - id: issue77
    resource: https://github.com/GenvidTechnologies/c3-domain-manager/issues/77
    title: "Issue #77 — MCP server multi-project support; carries 62 pre-committed criteria and 8 correction records"
  - id: adr0028
    resource: decisions/0028-mcp-server-multi-project-support.md
    title: "ADR 0028: MCP server multi-project support"
    last_modified: 2026-09-01
  - id: adr0026
    resource: decisions/0026-fs-watch-platform-confound-and-upstream-routing.md
    title: "ADR 0026: fs.watch platform confound and upstream routing"
    last_modified: 2026-08-16
  - id: issue81
    resource: https://github.com/GenvidTechnologies/c3-domain-manager/issues/81
    title: "Issue #81 — generate: add a flag to fail on unclassified files; carries the Shape 4 correction record"
  - id: adr0030
    resource: decisions/0030-classification-coverage-gate.md
    title: "ADR 0030: An opt-in classification-coverage gate on generate"
    last_modified: 2026-09-19
---

# How a pre-committed acceptance criterion is wrong before anyone runs it

Pre-committing acceptance criteria to an issue body before implementation fixes the target so it cannot move under a passing run.[^issue77] That is the property it buys, and it holds. What it does not buy — and what nothing in the practice detects on its own — is that the criteria are *correct*.

Measured on one issue: **62 pre-committed rows, 8 of them defective.**[^issue77] None was caught by lint, typecheck, or a 500-test suite; every one was green-looking prose. They fall into three shapes, and a fourth failure sits outside all three.

## Shape 1 — the row that grades green on an untouched checkout

A count row whose baseline already satisfies its own pass condition. It cannot detect the change it was written for, and it passes identically before and after the work.

The instance: a row asserting a documentation chain gained an entry, written as an unanchored token count with a stated baseline of 2 and a threshold of `>=3`. Re-derivation measured the true baseline at **5** — the extra three were unrelated prose using the same words. The row would have passed on a clean tree.[^issue77]

The repair is not a higher threshold. It is a **narrower anchor**: matching the shape the row actually means (`The <version> floor is load-bearing`) rather than a phrase that also appears elsewhere, which restored a true baseline of 2 and a non-vacuous `>=3`.[^issue77]

**The tell is cheap and specific: run every baseline against the pre-change tree, and treat a baseline that already passes as a defect rather than a convenience.**

## Shape 2 — the corpus narrower than the property

A row states a rule, then names the *files* the rule applies to instead of the rule itself. A file created later escapes it silently, and — this is what makes the shape distinct — **re-running the row cannot find the gap, because the row passes either way.**

The instance: a row forbidding any test from grading a codec with that same codec, which would reduce every assertion to self-consistency. Its corpus named two files. A third test file, created several tasks later, carried the assertions most sensitive to the tautology and sat outside the corpus entirely. It happened not to violate the rule; nothing pinned that it wouldn't.[^issue77]

**Where a corpus must grow with the suite, state the rule and derive the corpus from it.** Naming files freezes a snapshot of a set that is still moving.

## Shape 3 — the row falsified by a later task in its own plan

Distinct from ordinary decay, where the tree moves for unrelated reasons. Here **the plan's own later work invalidates a row the plan's earlier work pledged**, so the failure is fully internal and arrives on a schedule the author could in principle have foreseen.

The instance: a row requiring two invocations to produce byte-identical output. An earlier task had already amended it once — from "twice on one server" to "once each on two servers" — to escape a counter that increments per call. A later task then adopted a composite transaction token embedding the project id[^adr0028] — which derives from each server's randomly-named temporary directory. Two servers could no longer match byte-for-byte however correct the code, and the escape the first amendment bought was gone.[^issue77]

Both easy exits are wrong and worth naming, because each looks like diligence: relaxing the row to "roughly similar" discards the pre-commitment the practice exists for, and dropping the feature to keep the row satisfiable sacrifices the work to its own test. The repair excluded the one field that legitimately varies and **recovered it with a separate assertion**, ending stronger than the whole-text comparison it replaced.[^issue77]

## Shape 4 — the row whose procedure cannot pass, and whose correct red reads as a code finding

The three shapes above are all defects in *what* a row asserts. This one is a defect in *how* it says to measure — and it is the only shape where running the row's own command, faithfully, still cannot produce a pass.

The instance: a row pledged that `npm run verify:behaviour-preservation -- --mutant` must report a difference, as the control proving an empty diff from the plain arm is falsifiable.[^issue81] The flag does not inject the defect it asserts about; it only flips the assertion to expect a difference, leaving the injection to the operator. Run as pledged against an unmutated tree, the control reported that no difference was observed — **the correct answer to the question actually asked**, and one that reads exactly like a broken comparison or a real regression.[^adr0030]

Three things make it worth separating from Shape 1. The row graded **red**, not green, so no "does this pass on an untouched checkout?" screen fires. It was never true, so no staleness check reaches it. And its failure arrives wearing the costume of a finding about the code, which is the expensive direction: the natural responses are to debug a healthy script or to re-run and shrug, and both leave the control unestablished while feeling like diligence.

**The propagation is the reusable part, because the citation was accurate.** The row cited a line range in the script's own header, and that range says the mutation is injected. The sentence withdrawing it — *"This script does not apply the mutation itself"* — sits four lines below the cited range, and the header's opening clause attributes injection to the acceptance *procedure*, not the flag. A project summary had already compressed that into "`--mutant` injects", and the row inherited the compression.[^adr0030] So: **a cited line range can be correctly quoted and still stop short of its own qualifier**, and a summary of a source is not the source even when it cites one.

The repair was to replace the one-step invocation with the four-step control the script actually requires — inject, grep-confirm the injection landed, run, then revert and grep-confirm clean — which is *more* procedure reaching the same protected property, not less.[^issue81] A guard was then added so the mistake costs a second rather than a full dependency install, and it deliberately checks that the operator injected rather than injecting for them: auto-applying would dissolve the grep-confirm step the design rests on.[^adr0030]

## The fourth failure: rules that are real, built, and ungradeable

Not a defective row — an **absent** one. A code review of the finished branch found two defects turning on behaviour that no row covered: a guard that must apply wherever more than one project can be registered, and a uniqueness rule on projects' output directories. Both were designed, both implemented, neither gradeable.[^issue77]

The second is the instructive one. A sibling rule *was* pledged — no two projects may share a configuration file — and the missing rule is its exact analogue over a different field. Separate maps, separate fields, neither implying the other, and output-directory generation wipes and rewrites its target, so two projects converging on one meant regenerating either destroyed the other's index with nothing raised.[^issue77]

**A whole-table screen catches rows that contradict each other; it structurally cannot see a behaviour with no row at all.** The two screens answer different questions and only one of them was being asked.

## Who catches which

The eight defects were found by four different readers, and the distribution is the argument against relying on any one of them:[^issue77]

| Reader | Finds | Why |
|---|---|---|
| Orchestrator, before execution | Vacuous baselines, wrong counts | Re-derives every figure against the live tree |
| Planner, at transcription | Figures that decayed since authoring | Compares the table against the tree a second time |
| Implementer, during the task | Rows that cannot be satisfied as written | Is the first to *try*, and discovers unimplementable or unfalsifiable ones |
| Code review, after completion | Behaviours with no row | Reads the code rather than the checklist, so absence is visible |

Two of the eight were found only because implementers tried to satisfy rows literally and could not — one row asserted a mechanism that could not be built, another was unsatisfiable for two tools whose output carries an incrementing counter.[^issue77] Neither is reachable by re-reading the checklist; both required an attempt.

## What this does not argue

It does not argue against pre-commitment. A 13% defect rate is the measurement that *pre-commitment made available*: the rows were written down, so they could be checked, corrected in the open, and counted. Criteria invented after the fact have no such rate because nothing compares them to anything.[^issue77]

It argues that a pledged criterion is an **artifact under review like any other** — and that the checks it needs (a measured baseline, a corpus derived from its own rule, and a coverage pass asking what has no row) are cheap next to the cost of a checklist that grades green against work it never tested.

The same asymmetry ADR 0026 records for observation-gated tests applies here: a passing check whose subject may be dead is the weakest evidence available, and it keeps passing either way.[^adr0026] A vacuous criterion is that failure moved one level up, from the test to the thing that judges it.

[^issue77]: Issue #77 — the pledged checklist, its eight inline correction records, each naming the failure mode and the evidence that established it, and the three rows added after code review.
[^adr0028]: ADR 0028 — the decision record produced by the same work; its declines section records the reasoning the criteria were written against.
[^adr0026]: ADR 0026 — establishes that an assertion which fires only when a defect appears is indistinguishable from one that never fires because its subject is dead.
[^issue81]: Issue #81 — the pledged checklist carrying two inline correction records, one written before execution and one during it; the second is the Shape 4 instance, recorded with its original wording, the defect, and the evidence that settled it.
[^adr0030]: ADR 0030 — the decision record produced by the same work; the branch that produced it also corrected the project summary whose compression of the script header seeded the defective row, and added the fail-fast guard.
