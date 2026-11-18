import { describe, expect, it } from "vitest";
import { parseDigestNote } from "@/lib/finance/digest-note";

describe("parseDigestNote", () => {
  it("reads the short format", () => {
    const n = parseDigestNote("# Spend nothing until payday\n\n- Hold the **$65** save\n- Skip car\n- Skip shopping\n- extra");
    expect(n.verdict).toBe("Spend nothing until payday");
    expect(n.actions).toEqual(["Hold the $65 save", "Skip car", "Skip shopping"]);
  });

  it("falls back to the first sentence and last list of a long digest", () => {
    const md = "# Digest for 2026-11-18\n\nSafe to spend is -$23.21 today. Spend nothing.\n\n- a\n\n## Do today\n\n- one\n- two";
    const n = parseDigestNote(md);
    expect(n.verdict).toBe("Safe to spend is -$23.21 today.");
    expect(n.actions).toEqual(["one", "two"]);
  });

  it("handles empty input", () => {
    expect(parseDigestNote("")).toEqual({ verdict: null, actions: [] });
  });
});
