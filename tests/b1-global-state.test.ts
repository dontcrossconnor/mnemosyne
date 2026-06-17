/**
 * Tests for B1: Global mutable state bug.
 *
 * Problem: configureCollections() mutates DEFAULT_COLLECTIONS at module level.
 * This means call order determines which collections all instances see.
 * The fix: remove configureCollections() entirely; all tools use config
 * passed through their context, not module-level globals.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { configureCollections, DEFAULT_COLLECTIONS } from "../src/core/types.js";

// Save originals, restore after
const ORIGINAL = { ...DEFAULT_COLLECTIONS };

describe("B1 — global mutable state (DEFAULT_COLLECTIONS)", () => {
  beforeEach(() => {
    configureCollections({ shared: ORIGINAL.SHARED, private: ORIGINAL.PRIVATE });
  });

  it("configureCollections mutates the module-level const", () => {
    configureCollections({ shared: "a_different_name" });
    expect(DEFAULT_COLLECTIONS.SHARED).toBe("a_different_name");
    // ^ This is the bug: a side-effect function changes global state.
    // After the fix, configureCollections should be a no-op (or removed),
    // and this test should either be deleted or expect NO change.
  });

  it("tool wrappers import DEFAULT_COLLECTIONS directly", async () => {
    // Check that tool files still import DEFAULT_COLLECTIONS — after the fix
    // they should use context-provided collections instead
    const fs = await import("node:fs");
    const storeSrc = await fs.promises.readFile(
      "/home/turboshark/mnemosyne-rebuild/src/tools/store.ts",
      "utf-8"
    );
    const recallSrc = await fs.promises.readFile(
      "/home/turboshark/mnemosyne-rebuild/src/tools/recall.ts",
      "utf-8"
    );
    const forgetSrc = await fs.promises.readFile(
      "/home/turboshark/mnemosyne-rebuild/src/tools/forget.ts",
      "utf-8"
    );

    // These tools import DEFAULT_COLLECTIONS as a fallback
    // After the fix, they should still reference it BUT also accept ctx.collections
    expect(storeSrc).toContain("DEFAULT_COLLECTIONS");
    expect(recallSrc).toContain("DEFAULT_COLLECTIONS");
    expect(forgetSrc).toContain("DEFAULT_COLLECTIONS");
  });
});
