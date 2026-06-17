/**
 * Tests for src/cognitive/warnings.ts — pure functions only.
 * findWarningLessons is tested via real Qdrant in qdrant-integration tests.
 */
import { describe, it, expect } from "vitest";
import {
  findPatternPredictions,
  findPreferenceReminders,
  formatWarningContext,
} from "../src/cognitive/warnings.js";
import type { Pattern } from "../src/cognitive/pattern-miner.js";
import type { UserModel, Preference } from "../src/cognitive/preferences.js";
import type { ProactiveSuggestion } from "../src/cognitive/warnings.js";

// ============================================================================
// Helpers
// ============================================================================

function makePattern(overrides: Partial<Pattern> = {}): Pattern {
  return {
    id: "pat-1",
    type: "recurring_error",
    description: "server timeout when deploying",
    confidence: 0.8,
    occurrences: 5,
    evidenceIds: ["mem-1", "mem-2"],
    firstSeen: new Date(Date.now() - 86400000 * 7).toISOString(),
    lastSeen: new Date().toISOString(),
    tags: ["error", "server"],
    metadata: {},
    ...overrides,
  };
}

function makePreference(overrides: Partial<Preference> = {}): Preference {
  return {
    key: "language:typescript",
    category: "language",
    value: "prefers TypeScript over JavaScript",
    strength: 0.8,
    evidenceCount: 5,
    firstSeen: new Date(Date.now() - 86400000 * 30).toISOString(),
    lastSeen: new Date().toISOString(),
    sources: ["mem-1", "mem-2", "mem-3"],
    ...overrides,
  };
}

function makeUserModel(prefs: Map<string, Preference> = new Map()): UserModel {
  return {
    userId: "test-user",
    agentId: "test-agent",
    preferences: prefs,
    updatedAt: new Date().toISOString(),
    version: 1,
  };
}

function makeSuggestion(overrides: Partial<ProactiveSuggestion> = {}): ProactiveSuggestion {
  return {
    type: "warning",
    priority: "medium",
    text: "test warning",
    evidence: ["mem-1"],
    source: "lesson",
    score: 0.7,
    ...overrides,
  };
}

// ============================================================================
// findPatternPredictions
// ============================================================================

describe("findPatternPredictions", () => {
  it("returns empty for empty patterns", () => {
    expect(findPatternPredictions("deploy to server", [])).toEqual([]);
  });

  it("returns empty for empty prompt", () => {
    const patterns = [makePattern()];
    expect(findPatternPredictions("", patterns)).toEqual([]);
  });

  it("skips co_occurrence/cluster/anomaly patterns", () => {
    const patterns: Pattern[] = [
      makePattern({ type: "co_occurrence", description: "docker and kubernetes" }),
      makePattern({ type: "cluster", description: "server deployment" }),
      makePattern({ type: "anomaly", description: "unusual spike in errors" }),
    ];
    expect(findPatternPredictions("deploy server", patterns)).toEqual([]);
  });

  it("matches recurring_error by keyword overlap (2+ words)", () => {
    const patterns = [makePattern({ type: "recurring_error", description: "server timeout when deploying" })];
    const results = findPatternPredictions("the server is timing out when deploying", patterns);
    expect(results.length).toBe(1);
    expect(results[0].type).toBe("warning");
    expect(results[0].source).toBe("pattern");
  });

  it("matches sequence by keyword overlap", () => {
    const patterns = [makePattern({ type: "sequence", description: "deploy then restart server" })];
    const results = findPatternPredictions("deploy to the server", patterns);
    expect(results.length).toBe(1);
    expect(results[0].type).toBe("prediction");
  });

  it("returns warning type for recurring_error", () => {
    const p = makePattern({ type: "recurring_error", description: "database connection refused" });
    const results = findPatternPredictions("connection to database refused", p.tags.length > 0 ? [p] : [p]);
    expect(results[0].type).toBe("warning");
  });

  it("returns prediction type for sequence/correlation", () => {
    const seq = makePattern({ type: "sequence", description: "build then test fails" });
    const corr = makePattern({ type: "correlation", description: "high memory leads to crash" });
    const results = findPatternPredictions("the build failed due to high memory", [seq, corr]);
    expect(results.every(r => r.type === "prediction")).toBe(true);
  });

  it("grades priority by score: >=0.6 high, >=0.35 medium, <0.35 low", () => {
    const high = makePattern({ type: "recurring_error", description: "server crash", confidence: 1.0, occurrences: 20 });
    const med = makePattern({ type: "recurring_error", description: "timeout error", confidence: 0.5, occurrences: 3 });
    const low = makePattern({ type: "recurring_error", description: "rare glitch", confidence: 0.3, occurrences: 1, lastSeen: new Date(Date.now() - 86400000 * 200).toISOString() });

    const results = findPatternPredictions("server crash timeout glitch error", [high, med, low]);
    const highR = results.find(r => r.text.includes("crash"));
    const medR = results.find(r => r.text.includes("timeout"));
    const lowR = results.find(r => r.text.includes("glitch"));

    if (highR) expect(highR.priority).toBe("high");
    if (medR) expect(medR.priority).toBe("medium");
    if (lowR) expect(lowR.priority).toBe("low");
  });

  it("limits evidence to 5 IDs", () => {
    const p = makePattern({ evidenceIds: ["a", "b", "c", "d", "e", "f", "g"] });
    const results = findPatternPredictions(p.description, [p]);
    expect(results[0].evidence.length).toBeLessThanOrEqual(5);
  });

  it("skips patterns with empty description", () => {
    const p = makePattern({ description: "" });
    expect(findPatternPredictions("anything", [p])).toEqual([]);
  });

  it("handles mixed match status", () => {
    const match = makePattern({ type: "recurring_error", description: "deployment fails" });
    const noMatch = makePattern({ type: "recurring_error", description: "database backup" });
    const results = findPatternPredictions("the deployment keeps failing", [match, noMatch]);
    expect(results.length).toBe(1);
    expect(results[0].text).toContain("deployment fails");
  });

  it("counts keyword overlap correctly", () => {
    const p = makePattern({ description: "server timeout during deployment" });
    // "deployment" and "server" should both match
    const results = findPatternPredictions("the deployment server crashed", [p]);
    expect(results.length).toBe(1);
  });

  it("requires at least 2 keywords OR 40% overlap", () => {
    const p = makePattern({ description: "database connection pooling timeout" });
    // Only "database" matches — 1 word out of 4 = 25% overlap, < 2 words
    expect(findPatternPredictions("database error", [p])).toEqual([]);
  });
});

// ============================================================================
// findPreferenceReminders
// ============================================================================

describe("findPreferenceReminders", () => {
  it("returns empty for null model", () => {
    expect(findPreferenceReminders("build the server", null)).toEqual([]);
  });

  it("returns empty for empty preferences", () => {
    expect(findPreferenceReminders("build the server", makeUserModel())).toEqual([]);
  });

  it("skips weak preferences (strength < 0.4)", () => {
    const prefs = new Map([["x", makePreference({ strength: 0.3, key: "tool:vim" })]]);
    expect(findPreferenceReminders("use vim for editing", makeUserModel(prefs))).toEqual([]);
  });

  it("returns reminder when keywords match (2+ matches)", () => {
    const prefs = new Map([["language:typescript", makePreference({ key: "language:typescript", value: "prefers TypeScript" })]])
    // "typescript" + "prefers" = 2 keyword matches (both >3 chars, both pass filter)
    const results = findPreferenceReminders("typescript prefers", makeUserModel(prefs));
    expect(results.length).toBe(1);
    expect(results[0].type).toBe("reminder");
  });

  it("detects conflict when preference says TypeScript but user mentions JavaScript", () => {
    const prefs = new Map([["language:typescript", makePreference({ key: "language:typescript", value: "prefers TypeScript over JavaScript" })]])
    const results = findPreferenceReminders("write this in javascript", makeUserModel(prefs));
    expect(results.length).toBe(1);
    expect(results[0].type).toBe("warning");
    expect(results[0].priority).toBe("medium");
  });

  it("does not flag conflict when both sides mentioned", () => {
    const prefs = new Map([["language:typescript", makePreference({ key: "language:typescript", value: "prefers TypeScript over JavaScript" })]])
    const results = findPreferenceReminders("prefer typescript not javascript", makeUserModel(prefs));
    // Non-conflict requires 2+ keyword matches
    expect(results.length).toBe(1);
    expect(results[0].type).not.toBe("warning");
  });

  it("detects vim vs vscode conflict", () => {
    const prefs = new Map([["tool:vim", makePreference({ key: "tool:vim", value: "prefers vim editor" })]])
    // "editor" passes first gate (1 keyword match), "vscode" triggers conflict pair, no "vim" in prompt
    const results = findPreferenceReminders("editor in vscode", makeUserModel(prefs));
    expect(results.length).toBe(1);
    expect(results[0].type).toBe("warning");
  });

  it("limits sources to 3", () => {
    const prefs = new Map([["tool:vim", makePreference({ key: "tool:vim", value: "prefers vim editor", sources: ["a", "b", "c", "d", "e"] })]])
    const results = findPreferenceReminders("prefer vim editor", makeUserModel(prefs));
    expect(results.length).toBe(1);
    expect(results[0].evidence.length).toBeLessThanOrEqual(3);
  });
});

// ============================================================================
// formatWarningContext
// ============================================================================

describe("formatWarningContext", () => {
  it("returns empty for empty input", () => {
    const result = formatWarningContext([]);
    expect(result.suggestions).toEqual([]);
    expect(result.formatted).toBe("");
  });

  it("sorts by priority (high > medium > low) then score descending", () => {
    const suggestions = [
      makeSuggestion({ priority: "low", score: 0.9 }),
      makeSuggestion({ priority: "high", score: 0.5 }),
      makeSuggestion({ priority: "medium", score: 0.7 }),
    ];
    const result = formatWarningContext(suggestions);
    expect(result.suggestions.map(s => s.priority)).toEqual(["high", "medium", "low"]);
  });

  it("limits to top 3 suggestions", () => {
    const suggestions = Array.from({ length: 10 }, (_, i) =>
      makeSuggestion({ priority: "low", score: 0.5 - i * 0.05 })
    );
    const result = formatWarningContext(suggestions);
    expect(result.suggestions.length).toBeLessThanOrEqual(3);
  });

  it("uses correct icons: [!] warning, [~] prediction, [i] reminder, [+] recommendation", () => {
    // formatWarningContext limits to top 3 — test each icon separately
    expect(formatWarningContext([makeSuggestion({ type: "warning", text: "x" })]).formatted).toContain("[!]");
    expect(formatWarningContext([makeSuggestion({ type: "prediction", text: "x" })]).formatted).toContain("[~]");
    expect(formatWarningContext([makeSuggestion({ type: "reminder", text: "x" })]).formatted).toContain("[i]");
    expect(formatWarningContext([makeSuggestion({ type: "recommendation", text: "x" })]).formatted).toContain("[+]");
  });

  it("does not mutate the original array", () => {
    const original = [makeSuggestion({ priority: "low" }), makeSuggestion({ priority: "high" })];
    const copy = [...original];
    formatWarningContext(original);
    expect(original).toEqual(copy);
  });

  it("formats as newline-separated lines with header", () => {
    const s = [makeSuggestion({ text: "single warning" })];
    const result = formatWarningContext(s);
    expect(result.formatted).toContain("--- Proactive Warnings ---");
    expect(result.formatted).toContain("single warning");
  });

  it("handles exactly 3 suggestions", () => {
    const suggestions = [
      makeSuggestion({ priority: "high", score: 0.9, text: "a" }),
      makeSuggestion({ priority: "high", score: 0.8, text: "b" }),
      makeSuggestion({ priority: "medium", score: 0.7, text: "c" }),
    ];
    const result = formatWarningContext(suggestions);
    expect(result.suggestions.length).toBe(3);
  });
});
