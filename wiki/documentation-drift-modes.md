---
type: practice-note
title: How a summary silently diverges from the record it summarizes
description: Three distinct shapes of documentation drift measured in this repo's ADR history — a gloss that inverts a decision, a sibling ADR misattributing a mechanism, and a framing sentence that sends work down a premise the records themselves deny — and what checkable action closes each.
tags: [documentation, adr, drift, practice]
status: stable
stale_after: 2027-08-16
generated: { by: process:maintain-wiki, at: 2026-08-16T00:00:00Z }
sources:
  - id: adr0022
    resource: ../docs/decisions/0022-section-extension-provenance.md
    title: "ADR 0022: Section-extension provenance split"
    last_modified: 2026-08-13
  - id: adr0022-issue
    resource: https://github.com/GenvidTechnologies/c3-domain-manager/issues/60
    title: "Issue #60 — re-examine SECTION_SOURCE_EXTENSIONS now that c3source 2.0.0 unifies section finders"
  - id: adr0023
    resource: ../docs/decisions/0023-decline-stray-file-diagnostic.md
    title: "ADR 0023: Decline a stray-file diagnostic"
    last_modified: 2026-08-14
  - id: adr0023-issue
    resource: https://github.com/GenvidTechnologies/c3-domain-manager/issues/62
    title: "Issue #62 — decide whether to report stray files in C3 section directories"
  - id: adr0024
    resource: ../docs/decisions/0024-editor-validation-single-enumeration.md
    title: "ADR 0024: editorValidation.ts routes through the single eventSheets/ enumeration"
    last_modified: 2026-08-15
  - id: adr0024-issue
    resource: https://github.com/GenvidTechnologies/c3-domain-manager/issues/37
    title: "Issue #37 — unify the relative-POSIX path normalization idiom"
---

# How a summary silently diverges from the record it summarizes

Three shapes of the same underlying failure, each measured against this
repo's own ADR history rather than described in the abstract. What makes all
three worth separating is a shared structural property: a citing sentence
reads with the authority of the thing it cites, whether or not it actually
matches it, and **nothing compares the two automatically** — no lint rule,
no type check, no test reads prose. ADR 0024 states the general form of this
directly, while correcting an instance of it: "two records reaching the same
conclusion by different routes is the common case, and citing a sibling's
*conclusion* is safe while restating *which record reached it* is not,
without checking"[^adr0024].

## Shape 1 — a gloss that inverts the decision it summarizes

`SECTION_SOURCE_EXTENSIONS` (`src/domain/classification.ts`) had been
described, in a summary living outside the ADR itself, as "product policy,
local by decision." Issue #60 opened by weighing that framing as a live
argument for *keeping* the local rule: "It is **product policy, local by
decision**, explicitly contrasted... against `SCRIPT_SOURCE_EXTENSIONS`,
which was a platform fact held locally only until upstream exported
it"[^adr0022-issue]. That framing shaped the issue's own problem statement —
it is the "Keep" side of the question the issue set out to answer.

The correction happened by grepping the record the framing claimed to
summarize. ADR 0022 records the check and its result plainly: "Grepping that
record for 'product policy' or 'local by decision' returns zero hits. The
phrase originated as a... gloss... summarizing ADR 0020 — and the gloss
drifted from the record it was summarizing"[^adr0022]. ADR 0020's own
Decision text said the opposite: "adopting c3source's own documented
convention, not inventing a new one"[^adr0022] — upstream's convention, not
local policy. Issue #60's own Acceptance Criteria records the same
correction from the other side, after the fact: "the phrase 'product policy,
local by decision' is **not in ADR 0020** (0 grep hits)... So ADR 0022
vindicates ADR 0020 rather than overturning it"[^adr0022-issue].

**Countermeasure:** before relying on a paraphrase of what a record decided,
grep the record itself for the paraphrase's own language, or read its
Decision section directly. A paraphrase that turns out to assert the
opposite of the source is not a rare failure — it is exactly what happened
here, and it was caught by the cheapest possible check.

## Shape 2 — a sibling ADR crediting the wrong record

The same failure recurs between ADRs, not just between a summary and an ADR.
ADR 0022 quoted a holding — "it walks `eventSheets/`, which has no
suppression rule to contradict, so it re-walks the *same* set" — and
attributed it to ADR 0017.
ADR 0024 checked that attribution directly and found it wrong: "`grep -cF
'editorValidation' docs/decisions/0017-script-surface-unification.md` → **0**.
ADR 0017 never mentions `editorValidation.ts`"[^adr0024]. The quoted sentence
in fact originates in ADR 0021, at the location ADR 0024 pins directly:
"`grep -cF 'editorValidation' docs/decisions/0021-decline-drift-diagnostic.md`
→ **1**, at line 186, and the quoted sentence appears there
verbatim"[^adr0024].

ADR 0024 is also explicit that the error did not propagate further than the
one record that made it: "the misattribution is confined to ADR 0022 —
[ADR 0023] is clean"[^adr0024], because ADR 0023's own citations "credits
[ADR 0022] with the reasoning that record *recorded* — which ADR 0022 did,
by restating it"[^adr0024]. ADR 0023's own text, read directly, shows the
careful form this takes when done correctly: crediting two records with two
*different* arguments for the same conclusion rather than collapsing them —
"[ADR 0020] reached the same conclusion by a different route: nothing
downstream can represent the file, so no `overrides` entry could usefully
change anything. Two arguments, one answer — do not read either as the
other's"[^adr0023].

**Countermeasure:** `grep -cF` the sibling record for the substring being
attributed to it before citing it, the same check ADR 0024 ran on itself.
Two records reaching the same conclusion by different arguments is the
common case in this project's ADR history, not the exception, which is
precisely what makes the paraphrase that "feels safest" — the conclusions
match, after all — the one most likely to silently swap which record
actually made the argument.

## Shape 3 — a framing sentence that sends work down a denied premise

The third shape is not a misquote but a claim strong enough to set an
issue's whole direction, standing on nothing. Issue #37 opened around the
idea that `editorValidation.ts` was "the last `eventSheets/` reader outside
the single enumeration" — implying its independent walk was a gap to close
for correctness. Planning re-verification on that same issue found the
premise unsupported: "'The last `eventSheets/` reader outside the single
enumeration' traces to one sentence in `CLAUDE.md`, not to any ADR — ADR
0021/0022/0023 hold `editorValidation.ts`'s independent walk as *acceptable
precedent*, and ADR 0023 relies on it"[^adr0024-issue]. Three already-accepted
records held the opposite of what the framing sentence assumed, and nothing
had checked the framing against them before the issue was opened on its
strength.

ADR 0024 records the resolution: the walk was unified anyway, but "for
**idiom locality**, not because it was unsafe"[^adr0024-issue] — a
different, narrower justification than the one that opened the work. The ADR
is explicit that this does not overturn the three records the framing
denied: "this work does not overturn ADR 0021's principle... `eventSheets/`
loses its status as the one `src/` exemplar of 'a second read-side walk with
no suppression rule to contradict is acceptable precedent' — but the
precedent itself is not repudiated, only unexemplified"[^adr0024]. A future
reader who only sees the *outcome* (the walk consolidated) could easily
misread that as confirming the framing that opened the issue; the ADR states
directly why that inference would be wrong.

**Countermeasure:** a claim strong enough to set an issue's direction —
"the last X outside Y," "the only remaining Z" — is exactly the kind of
sentence that most needs checking against the records it implies, precisely
because its consequences (a whole issue's scope) are larger than a misquoted
detail. Read the records it would have to be consistent with before treating
it as the reason to act.

[^adr0022]: ADR 0022 — Section-extension provenance split.
[^adr0022-issue]: Issue #60 — re-examine `SECTION_SOURCE_EXTENSIONS` now that
    c3source 2.0.0 unifies all four section finders to `.json`.
[^adr0023]: ADR 0023 — Decline a stray-file diagnostic.
[^adr0024]: ADR 0024 — `editorValidation.ts` routes through the single
    `eventSheets/` enumeration.
[^adr0024-issue]: Issue #37 — unify the relative-POSIX path normalization
    idiom.

## Related

- [Upstream dependency routing](/upstream-dependency-routing.md) — a
  different domain, same discipline: trust the artifact you can inspect
  (a packed `.d.ts`, a re-run grep) over a description of it (release notes,
  a gloss).
