/**
 * Mocha root hook plugin — silences console.log and console.debug during test
 * runs so production diagnostic logging doesn't pollute test output.
 * console.warn and console.error are left intact to surface real problems.
 *
 * Also asserts, once per run, that the canonical fixture has been materialized.
 * Failing here rather than skipping per-test is deliberate: see
 * assertFixtureMaterialized.
 */

import { assertFixtureMaterialized } from "./fixtureHelpers.js";

const originalLog = console.log;
const originalDebug = console.debug;

export const mochaHooks = {
  // Note this is `before`, not `beforeEach` — the console stubs below are
  // per-test, so anything logged from here still reaches stdout.
  before() {
    assertFixtureMaterialized();
  },
  beforeEach() {
    console.log = () => {};
    console.debug = () => {};
  },
  afterEach() {
    console.log = originalLog;
    console.debug = originalDebug;
  },
};
