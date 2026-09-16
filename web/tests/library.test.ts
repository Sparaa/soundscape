import { describe, expect, it } from "vitest";
import { moveItem } from "@/lib/api";
describe("moveItem", () => {
  it("reorders without mutating", () => {
    const a = ["a", "b", "c"];
    expect(moveItem(a, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(a, 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(a, 1, 1)).toBe(a);
    expect(moveItem(a, 5, 0)).toBe(a);
    expect(a).toEqual(["a", "b", "c"]);
  });
});
