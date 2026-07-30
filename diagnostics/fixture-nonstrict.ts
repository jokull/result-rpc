/**
 * The same `$satisfies` diagnostic, compiled without `strictNullChecks`.
 *
 * A separate fixture because most diagnostics in `fixture.ts` depend on strict
 * mode, and this one is about what happens when the consumer has it off — a
 * config the library still has to behave in, and the one where the message
 * printer used to recurse until the compiler gave up with TS2589.
 */
import { defineModel, wire } from "../src/index.js";

const User = defineModel("diagnostic-nonstrict-user", {
  key: "id",
  shape: { id: wire.string, name: wire.string },
});

// Not a nullability mismatch: without strictNullChecks the compiler cannot see
// one, so the case that still has to report is a plain scalar difference.
User.$satisfies<{ readonly id: string; readonly name: number }>(); // diagnostic-text: field 'name': the model declares string, the source has number (strictNullChecks is off, so nullability was not compared)
