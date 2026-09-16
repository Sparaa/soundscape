import { describe, expect, it } from "vitest";
import { sidecarLine } from "@/lib/api";

describe("sidecarLine", () => {
  it("summarises health", () => {
    expect(sidecarLine("yue2", { ok: true, url: "u", gpu: "RTX 4090", loaded: false })).toBe("yue2 · RTX 4090 · idle");
    expect(sidecarLine("clipgrab", { ok: false, url: "u", error: "refused" })).toBe("clipgrab · offline");
  });
});
