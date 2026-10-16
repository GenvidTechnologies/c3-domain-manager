---
type: decision-record
---

# ADR 0031: Fall back to stderr for log lines emitted before the transport connects

**Status:** Accepted
**Date:** 2026-10-16
**Issue:** #86 — surface watcher log lines emitted before the MCP transport
connects, which `emitLog` silently dropped

---

## Context

`emitLog` in `src/mcp/server.ts` sends a log line with
`server.sendLoggingMessage(...).catch(() => {})`. Before `server.connect` there
is no transport, so the SDK's `notification()` rejects with `Not connected` and
the `.catch` swallows it, with no stderr fallback.

`startServer` starts every registered project's context before it connects.
Since issue #85 each context's `OptimisticWatcher` is given a `logger`, so its
`started` and `baseline` debug lines are emitted in that window and lost on
every start. The same would happen to a `baseline incomplete` line, the one
startup line that signals a real problem. A real `server` run on the pre-change
tree printed no `OptimisticWatcher` line on stderr, although the startup banner
and the auto-generation lines were present, because those two already write to
`console.error` for exactly this reason.

## Decision

### A. Fall back to stderr before connect, branching on `server.isConnected()`

`emitLog` writes `console.error` when the server is not connected, using the
existing `[c3-domain-manager]` prefix plus the level. When connected it calls
`sendLoggingMessage` only, so a line never appears in both places.

The branch reads the SDK's own `isConnected()` rather than a locally tracked
"`connect` resolved" flag. In SDK 1.29.0 it is `this.server.transport !==
undefined`; `Protocol.connect()` assigns the transport synchronously, and
`_onclose()` clears it. So it is false for every emit before `connect` is
called, and false again after the transport closes, a case a local flag would
need extra code to cover. The server keeps no state of its own for this.

## Alternatives Considered

**B. Start the watchers after `connect`.** Rejected. It widens the window in
which a write between startup index generation and `start()` becomes part of the
baseline and is not reported. `@genvidtech/mcp-utils` 0.12.0's
`OptimisticWatcher` JSDoc says to start the watcher before reading the tree, so
this works against upstream guidance to save a log line.

**C. Buffer and flush on connect.** Rejected. Clients would receive the lines,
but the server would hold state to do it, and no upstream buffer preserves the
level: mcp-utils' `bufferingLogger` records joined strings with no level, so a
flush could not replay `debug` versus `warning` faithfully.

## Compromise

Pre-connect lines reach the client's server log (stderr), not the client as
logging notifications. That is the same channel the banner already uses, and it
is the only one that exists before a transport does. They also bypass the
client's log level: a client can call `logging/setLevel` only once connected,
so every pre-connect line, `debug` included, reaches stderr, while
post-connect lines are filtered by the SDK against the level the session set.

## Consequences

Two changes at the same seam ship with it.

- **Rendering moves into an exported pure `renderLogArgs`.** The watcher
  logger rendered arrays with `JSON.stringify`, which doubles Windows
  backslashes. That was invisible while the `started` line was dropped and is
  visible now that it reaches stderr, so arrays render as joined text. The
  whole render is wrapped so an argument that cannot be rendered (a cyclic
  null-prototype object, on which `String()` throws) yields a constant fallback
  instead of throwing.
- **Per-event watcher lines name the config file by basename.** The
  suppression lines, the external-change line and the threw-lines used the
  absolute watch key; the `[id]` prefix already identifies the project, so they
  now carry the basename. The once-per-start `started` line keeps the full path.
  This is a visible change to notification text that clients already receive.

The issue's claim that the server has no `logging/setLevel` handler was false
when written: the SDK `Server` registers one whenever the `logging` capability
is declared, and `sendLoggingMessage` filters against the level a session set.
Nothing was built for it, and the issue body is annotated.
