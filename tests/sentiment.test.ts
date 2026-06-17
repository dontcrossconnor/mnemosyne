import { describe, it, expect, vi } from "vitest";
import {
  analyzeSentiment,
  newFrustrationState,
  updateFrustration,
  computeAdaptation,
  formatFrustrationContext,
  type SentimentSignal,
  type FrustrationState,
} from "../src/cognitive/sentiment.js";

// ───────── analyzeSentiment ────────────────────────────────────────────────

describe("analyzeSentiment", () => {
  // Neutral for empty / short text
  it("returns neutral for empty string", () => {
    const result = analyzeSentiment("");
    expect(result.sentiment).toBe("neutral");
    expect(result.intensity).toBe(0.3);
    expect(result.indicators).toEqual([]);
  });

  it("returns neutral for very short text (<2 chars)", () => {
    expect(analyzeSentiment("a").sentiment).toBe("neutral");
    expect(analyzeSentiment("🤔").sentiment).toBe("neutral");
  });

  it("returns neutral for text with no known patterns", () => {
    const result = analyzeSentiment("the sky is blue");
    expect(result.sentiment).toBe("neutral");
    expect(result.intensity).toBe(0.3);
    expect(result.indicators).toEqual([]);
  });

  // Positive
  it("detects strong positive sentiment (thanks/great/perfect)", () => {
    const result = analyzeSentiment("thanks, that works perfectly!");
    expect(result.sentiment).toBe("positive");
    expect(result.intensity).toBeGreaterThan(0);
    expect(result.indicators).toContain("strong positive");
  });

  it("detects exclamation amplifier on positive messages", () => {
    const result = analyzeSentiment("great!");
    expect(result.sentiment).toBe("positive");
    expect(result.indicators).toContain("exclamation amplifier");
  });

  it("detects mild positive (good/nice/cool/ok)", () => {
    const result = analyzeSentiment("that looks good");
    expect(result.sentiment).toBe("positive");
    expect(result.indicators).toContain("mild positive");
  });

  it("detects positive from 'this solved the issue'", () => {
    expect(analyzeSentiment("this solved the issue").sentiment).toBe("positive");
  });

  it("detects positive from 'awesome work'", () => {
    expect(analyzeSentiment("awesome work, thanks!").sentiment).toBe("positive");
  });

  // Negative
  it("detects negative sentiment (wrong/incorrect/broken)", () => {
    const result = analyzeSentiment("this answer is wrong");
    expect(result.sentiment).toBe("negative");
    expect(result.indicators).toContain("negative");
  });

  it("detects negative with negation patterns (no/not)", () => {
    const result = analyzeSentiment("that is not what I asked for");
    expect(result.sentiment).toBe("negative");
    expect(result.indicators).toContain("negation");
  });

  it("detects strong negative (frustrated/annoying/terrible)", () => {
    const result = analyzeSentiment("this is terrible and useless");
    expect(result.sentiment).toBe("negative");
    expect(result.indicators).toContain("strong negative");
  });

  it("detects negative via expletives (ugh/wtf)", () => {
    expect(analyzeSentiment("ugh, this doesn't work").sentiment).toBe(
      "negative",
    );
    expect(analyzeSentiment("wtf is this").sentiment).toBe("negative");
  });

  it("detects repetition frustration patterns (again/still)", () => {
    const result = analyzeSentiment("it's broken again?");
    expect(result.sentiment).toBe("negative");
    expect(result.indicators).toContain("repetition frustration");
  });

  it("detects 'still' as repetition frustration", () => {
    expect(analyzeSentiment("still broken").sentiment).toBe("negative");
  });

  // Frustrated
  it("detects frustrated from repeated instruction pattern", () => {
    const result = analyzeSentiment("I already told you the answer");
    expect(result.sentiment).toBe("frustrated");
    expect(result.indicators).toContain("repeated instruction");
  });

  it("detects frustrated from same problem pattern", () => {
    const result = analyzeSentiment("same error as before");
    expect(result.sentiment).toBe("frustrated");
    expect(result.indicators).toContain("same problem");
  });

  it("detects frustrated from persistent issue pattern", () => {
    const result = analyzeSentiment("why does this still fail?");
    expect(result.sentiment).toBe("frustrated");
    expect(result.indicators).toContain("persistent issue");
  });

  it("detects frustrated from exasperation (how many times)", () => {
    const result = analyzeSentiment("how many times do I have to explain");
    expect(result.sentiment).toBe("frustrated");
    expect(result.indicators).toContain("exasperation");
  });

  it("detects frustrated with multi-question-mark amplifier", () => {
    const result = analyzeSentiment("why is this still broken???");
    expect(result.sentiment).toBe("frustrated");
    expect(result.indicators).toContain("persistent issue");
    expect(result.indicators).toContain("multi-question-mark");
  });

  // Priority ordering: frustrated > negative > positive > neutral
  it("returns frustrated over negative when both match", () => {
    // "why does this still not work" — has "persistent issue" (frustrated, score 0.7) AND "not" (negative, score 0.5)
    // frustScore = 0.7 > 0.5 → frustrated
    const result = analyzeSentiment("why does this still not work");
    expect(result.sentiment).toBe("frustrated");
  });

  it("returns negative when frustScore is weak but negative dominates positive", () => {
    // "this is wrong" — negative (0.5) > positive (0) + 0.2 → negative
    expect(analyzeSentiment("this is wrong").sentiment).toBe("negative");
  });

  it("returns positive when posScore dominates negative", () => {
    // "great thanks" — positive (0.7+0.4=1.1) > negative (0) + 0.2 → positive
    expect(analyzeSentiment("great thanks").sentiment).toBe("positive");
  });

  it("returns neutral when scores are too close", () => {
    // "not good" — negative: "not" (0.5), positive: "good" (0.4)
    // negScore=0.5, posScore=0.4 → posScore(0.4) < negScore(0.5)+0.2=0.7 AND
    // negScore(0.5) < posScore(0.4)+0.2=0.6 → neutral
    expect(analyzeSentiment("not good").sentiment).toBe("neutral");
  });

  // Intensity clamping
  it("clamps intensity to 1.0", () => {
    // Strong frustration + negative — frustScore > 0.5 → frustrated, intensity clamped
    const result = analyzeSentiment(
      "how many times do I have to say this is wrong and broken and terrible",
    );
    expect(result.intensity).toBeLessThanOrEqual(1.0);
    expect(result.sentiment).toBe("frustrated");
  });

  // Case insensitivity
  it("is case-insensitive", () => {
    expect(analyzeSentiment("THANKS FOR THE HELP").sentiment).toBe("positive");
    expect(analyzeSentiment("I ALREADY TOLD YOU").sentiment).toBe("frustrated");
  });
});

// ───────── newFrustrationState ─────────────────────────────────────────────

describe("newFrustrationState", () => {
  it("creates a zeroed frustration state", () => {
    const state = newFrustrationState();
    expect(state.level).toBe(0);
    expect(state.consecutiveNegative).toBe(0);
    expect(state.lastSignal).toBe("neutral");
    expect(state.lastUpdated).toBeGreaterThan(0);
    expect(state.history).toEqual([]);
  });
});

// ───────── updateFrustration ───────────────────────────────────────────────

describe("updateFrustration", () => {
  const t0 = 1_000_000_000_000; // fixed timestamp for deterministic tests

  function makeBaseState(overrides: Partial<FrustrationState> = {}): FrustrationState {
    return {
      level: 0,
      consecutiveNegative: 0,
      lastSignal: "neutral",
      lastUpdated: t0,
      history: [],
      ...overrides,
    };
  }

  function signal(sentiment: SentimentSignal["sentiment"], intensity = 0.5): SentimentSignal {
    return { sentiment, intensity, indicators: [] };
  }

  // Frustrated signal transitions
  it("increases level by 0.3 on frustrated signal", () => {
    const state = makeBaseState();
    const next = updateFrustration(state, signal("frustrated"), t0 + 1000);
    expect(next.level).toBeCloseTo(0.3);
    expect(next.consecutiveNegative).toBe(1);
    expect(next.lastSignal).toBe("frustrated");
  });

  it("increments consecutiveNegative on frustrated signal", () => {
    const state = makeBaseState({ consecutiveNegative: 2 });
    const next = updateFrustration(state, signal("frustrated"), t0 + 1000);
    expect(next.consecutiveNegative).toBe(3);
    // Level: 0 + 0.3 (frustrated) + 0.1 (escalation: 3 - 2) = 0.4
    expect(next.level).toBe(0.4);
  });

  // Negative signal transitions
  it("increases level by 0.15 on negative signal", () => {
    const state = makeBaseState();
    const next = updateFrustration(state, signal("negative"), t0 + 1000);
    expect(next.level).toBeCloseTo(0.15);
    expect(next.consecutiveNegative).toBe(1);
    expect(next.lastSignal).toBe("negative");
  });

  // Positive signal transitions
  it("decreases level by 0.2 on positive signal", () => {
    const state = makeBaseState({ level: 0.5 });
    const next = updateFrustration(state, signal("positive"), t0 + 1000);
    expect(next.level).toBeCloseTo(0.3);
    expect(next.consecutiveNegative).toBe(0);
    expect(next.lastSignal).toBe("positive");
  });

  it("clamps level to 0 on positive signal when level < 0.2", () => {
    const state = makeBaseState({ level: 0.1 });
    const next = updateFrustration(state, signal("positive"), t0 + 1000);
    expect(next.level).toBe(0);
  });

  // Neutral signal transitions
  it("resets consecutiveNegative on neutral signal", () => {
    const state = makeBaseState({ consecutiveNegative: 3, level: 0.5 });
    const next = updateFrustration(state, signal("neutral"), t0 + 1000);
    expect(next.consecutiveNegative).toBe(0);
    // level unchanged (no level change on neutral aside from time decay)
  });

  // Escalation: 3+ consecutive negatives compound
  it("escalates level on 3 consecutive negatives", () => {
    const state = makeBaseState({ consecutiveNegative: 2, level: 0.3 });
    // 3rd negative triggers escalation: level + 0.1 * (3 - 2) = 0.3 + 0.15 + 0.1 = 0.55
    const next = updateFrustration(state, signal("negative"), t0 + 1000);
    expect(next.level).toBeCloseTo(0.55); // +0.15 from negative + 0.1 from escalation
    expect(next.consecutiveNegative).toBe(3);
  });

  it("escalates further on 4 consecutive negatives", () => {
    const state = makeBaseState({ consecutiveNegative: 3, level: 0.55 });
    // 4th negative: +0.15 + 0.1 * (4 - 2) = 0.55 + 0.15 + 0.2 = 0.9
    const next = updateFrustration(state, signal("negative"), t0 + 1000);
    expect(next.level).toBeCloseTo(0.9);
    expect(next.consecutiveNegative).toBe(4);
  });

  it("clamps escalation level to 1.0", () => {
    const state = makeBaseState({ consecutiveNegative: 6, level: 0.8 });
    const next = updateFrustration(state, signal("frustrated"), t0 + 1000);
    // +0.3 from frustrated + 0.1 * (7 - 2) = 0.3 + 0.5 = 0.8 → 0.8 + 0.8 = 1.6 → clamped to 1.0
    expect(next.level).toBe(1.0);
  });

  // Time decay
  it("decays level by 0.1 per 5 minutes of elapsed time", () => {
    const state = makeBaseState({ level: 0.5 });
    // 10 minutes later → decay: 0.1 * (10/5) = 0.2
    const next = updateFrustration(state, signal("neutral"), t0 + 10 * 60 * 1000);
    expect(next.level).toBeCloseTo(0.3);
  });

  it("decays level by partial increments for partial 5-min periods", () => {
    const state = makeBaseState({ level: 0.5 });
    // 2.5 minutes later → decay: 0.1 * (2.5/5) = 0.05
    const next = updateFrustration(state, signal("neutral"), t0 + 2.5 * 60 * 1000);
    expect(next.level).toBeCloseTo(0.45);
  });

  it("clamps decayed level to 0", () => {
    const state = makeBaseState({ level: 0.05 });
    // 5 minutes later → decay 0.1 → would go to -0.05, clamped to 0
    const next = updateFrustration(state, signal("neutral"), t0 + 5 * 60 * 1000);
    expect(next.level).toBe(0);
  });

  // Decay applies before signal adjustment
  it("applies decay before signal-based adjustment", () => {
    const state = makeBaseState({ level: 0.5 });
    // 5 min decay → 0.4, then +0.3 from frustrated → 0.7
    const next = updateFrustration(state, signal("frustrated"), t0 + 5 * 60 * 1000);
    expect(next.level).toBeCloseTo(0.7);
  });

  // History tracking
  it("appends to history on each update", () => {
    const state = makeBaseState();
    const next = updateFrustration(state, signal("positive"), t0 + 1000);
    expect(next.history).toHaveLength(1);
    expect(next.history[0].sentiment).toBe("positive");
    expect(next.history[0].timestamp).toBe(t0 + 1000);
  });

  it("limits history to 20 entries", () => {
    const manyHistory = Array.from({ length: 20 }, (_, i) => ({
      sentiment: "neutral" as const,
      timestamp: t0 + i * 1000,
    }));
    const state = makeBaseState({ history: manyHistory });
    const next = updateFrustration(state, signal("positive"), t0 + 100_000);
    expect(next.history).toHaveLength(20);
    // Oldest entry (index 0) should have been shifted out
    expect(next.history[0].sentiment).toBe("neutral"); // used to be index 1
    expect(next.history[19].sentiment).toBe("positive");
  });

  // lastUpdated tracking
  it("updates lastUpdated to now", () => {
    const state = makeBaseState();
    const next = updateFrustration(state, signal("neutral"), t0 + 5000);
    expect(next.lastUpdated).toBe(t0 + 5000);
  });

  // Uses Date.now() when nowMs is omitted
  it("uses Date.now() when nowMs is not provided", () => {
    const before = Date.now();
    const state = makeBaseState();
    const next = updateFrustration(state, signal("neutral"));
    expect(next.lastUpdated).toBeGreaterThanOrEqual(before);
    expect(next.lastUpdated).toBeLessThanOrEqual(Date.now());
  });

  // Immutability: does not mutate the original state
  it("does not mutate the original state object", () => {
    const state = makeBaseState({ level: 0.5, consecutiveNegative: 2 });
    const originalLevel = state.level;
    const originalNeg = state.consecutiveNegative;
    const originalHistoryLength = state.history.length;

    updateFrustration(state, signal("frustrated"), t0 + 1000);

    expect(state.level).toBe(originalLevel);
    expect(state.consecutiveNegative).toBe(originalNeg);
    expect(state.history.length).toBe(originalHistoryLength);
  });
});

// ───────── computeAdaptation ───────────────────────────────────────────────

describe("computeAdaptation", () => {
  function makeState(level: number): FrustrationState {
    return {
      level,
      consecutiveNegative: 0,
      lastSignal: "neutral",
      lastUpdated: Date.now(),
      history: [],
    };
  }

  it("returns relaxed defaults for level < 0.4", () => {
    const adapt = computeAdaptation(makeState(0));
    expect(adapt).toEqual({
      resultLimit: 10,
      minScore: 0.3,
      includeExplanation: false,
      urgencyBoost: 0.0,
    });
  });

  it("returns relaxed defaults for level = 0.3", () => {
    const adapt = computeAdaptation(makeState(0.3));
    expect(adapt.resultLimit).toBe(10);
    expect(adapt.minScore).toBe(0.3);
    expect(adapt.includeExplanation).toBe(false);
    expect(adapt.urgencyBoost).toBe(0.0);
  });

  it("returns moderate adaptation for level >= 0.4", () => {
    const adapt = computeAdaptation(makeState(0.4));
    expect(adapt).toEqual({
      resultLimit: 8,
      minScore: 0.4,
      includeExplanation: false,
      urgencyBoost: 0.1,
    });
  });

  it("returns moderate adaptation for level = 0.5", () => {
    const adapt = computeAdaptation(makeState(0.5));
    expect(adapt.resultLimit).toBe(8);
    expect(adapt.minScore).toBe(0.4);
    expect(adapt.urgencyBoost).toBe(0.1);
  });

  it("returns moderate adaptation for level = 0.69 (below 0.7)", () => {
    const adapt = computeAdaptation(makeState(0.69));
    expect(adapt.resultLimit).toBe(8);
  });

  it("returns full adaptation for level >= 0.7", () => {
    const adapt = computeAdaptation(makeState(0.7));
    expect(adapt).toEqual({
      resultLimit: 5,
      minScore: 0.5,
      includeExplanation: true,
      urgencyBoost: 0.2,
    });
  });

  it("returns full adaptation for level = 1.0", () => {
    const adapt = computeAdaptation(makeState(1.0));
    expect(adapt.resultLimit).toBe(5);
    expect(adapt.minScore).toBe(0.5);
    expect(adapt.includeExplanation).toBe(true);
    expect(adapt.urgencyBoost).toBe(0.2);
  });
});

// ───────── formatFrustrationContext ────────────────────────────────────────

describe("formatFrustrationContext", () => {
  function makeState(overrides: Partial<FrustrationState> = {}): FrustrationState {
    return {
      level: 0,
      consecutiveNegative: 0,
      lastSignal: "neutral",
      lastUpdated: Date.now(),
      history: [],
      ...overrides,
    };
  }

  it("formats zero frustration state", () => {
    const out = formatFrustrationContext(makeState({ level: 0 }));
    expect(out).toContain("level=0%");
    expect(out).toContain("last=neutral");
    expect(out).toContain("consecutive_neg=0");
    expect(out).toContain("trend=stable");
  });

  it("includes level as percentage", () => {
    const out = formatFrustrationContext(makeState({ level: 0.75 }));
    expect(out).toContain("level=75%");
  });

  it("rounds level percentage to nearest integer", () => {
    const out = formatFrustrationContext(makeState({ level: 0.333 }));
    expect(out).toContain("level=33%");
  });

  it("detects declining trend when last 3 have >=2 negatives", () => {
    const state = makeState({
      history: [
        { sentiment: "positive", timestamp: 1000 },
        { sentiment: "negative", timestamp: 2000 },
        { sentiment: "negative", timestamp: 3000 },
        { sentiment: "frustrated", timestamp: 4000 },
      ],
    });
    const out = formatFrustrationContext(state);
    expect(out).toContain("trend=declining");
  });

  it("detects improving trend when last 3 have >=2 positives", () => {
    const state = makeState({
      history: [
        { sentiment: "negative", timestamp: 1000 },
        { sentiment: "positive", timestamp: 2000 },
        { sentiment: "positive", timestamp: 3000 },
        { sentiment: "positive", timestamp: 4000 },
      ],
    });
    const out = formatFrustrationContext(state);
    expect(out).toContain("trend=improving");
  });

  it("detects stable trend for mixed last 3", () => {
    const state = makeState({
      history: [
        { sentiment: "positive", timestamp: 1000 },
        { sentiment: "negative", timestamp: 2000 },
        { sentiment: "neutral", timestamp: 3000 },
      ],
    });
    const out = formatFrustrationContext(state);
    expect(out).toContain("trend=stable");
  });

  it("defaults to stable when history has fewer than 3 entries", () => {
    const state = makeState({
      history: [
        { sentiment: "negative", timestamp: 1000 },
        { sentiment: "negative", timestamp: 2000 },
      ],
    });
    const out = formatFrustrationContext(state);
    expect(out).toContain("trend=stable");
  });

  it("includes consecutiveNegative count", () => {
    const out = formatFrustrationContext(makeState({ consecutiveNegative: 3 }));
    expect(out).toContain("consecutive_neg=3");
  });
});
