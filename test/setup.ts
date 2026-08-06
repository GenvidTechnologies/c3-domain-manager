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
  // `beforeAll`, not `before`: mocha's root-hook plugin API only recognises
  // beforeAll/beforeEach/afterAll/afterEach. A `before` key here is silently
  // ignored — the hook simply never runs, and the only symptom is that a
  // missing fixture surfaces as a pile of raw ENOENTs instead of one actionable
  // message. Verified by deleting the fixture and running mocha directly.
  beforeAll() {
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
