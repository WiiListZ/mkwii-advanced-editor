import { test, expect } from "bun:test";
import { clampTyped, clampValue } from "../web/src/app/number-field";

test("number boxes cannot hold values outside their limits", () => {
  expect(clampTyped("300", 0, 255, true)).toBe("255");      // past the maximum: stops at the maximum
  expect(clampTyped("-5", 0, 255, true)).toBe("5");         // no minus sign where negatives are not allowed
  expect(clampTyped("12.", 0, 255, true)).toBe("12");       // whole numbers only
  expect(clampTyped("5", 20, 2000, true)).toBe("5");        // may still become 50: raised when the box is left
  expect(clampTyped("-200", -128, 127, true)).toBe("-128"); // below a negative minimum
  expect(clampTyped("-", -128, 127)).toBe("-");
  expect(clampTyped("1.5", undefined, undefined)).toBe("1.5");
  expect(clampValue(5, 20, 2000, true)).toBe(20);
  expect(clampValue(7.6, 0, 7, true)).toBe(7);
});
