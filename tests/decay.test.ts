import { describe, it, expect } from "vitest";
import {
  computeActivation,
  getDecayStatus,
  applyDecayBoost,
} from "../src/cognitive/decay.js";

// ---------------------------------------------------------------------------
// computeActivation
// ---------------------------------------------------------------------------
describe("computeActivation", () => {
  // ---- immunity for core / procedural ----
  it("returns 10.0 for core memory type regardless of inputs", () => {
    expect(computeActivation([], "critical", "core")).toBe(10.0);
    expect(computeActivation([1, 2, 3], "background", "core")).toBe(10.0);
    expect(computeActivation([], "reference", "core", 0)).toBe(10.0);
  });

  it("returns 5.0 for procedural memory type regardless of inputs", () => {
    expect(computeActivation([], "critical", "procedural")).toBe(5.0);
    expect(computeActivation([1000], "important", "procedural")).toBe(5.0);
    expect(computeActivation([], "reference", "procedural", 0)).toBe(5.0);
  });

  it("exempts core and procedural but decays other types", () => {
    const now = Date.now();
    const recent = now - 3_600_000; // 1 hour ago
    const core = computeActivation([recent], "reference", "core");
    const procedural = computeActivation([recent], "reference", "procedural");
    const semantic = computeActivation([recent], "reference", "semantic");
    expect(core).toBe(10.0);
    expect(procedural).toBe(5.0);
    expect(semantic).toBeGreaterThanOrEqual(-2.0); // still "active"
  });

  // ---- empty access times ----
  it("returns 0.0 when accessTimes is empty and no createdAt", () => {
    const result = computeActivation([], "reference", "semantic");
    expect(result).toBe(0.0);
  });

  it("returns 0.0 when accessTimes is empty and createdAt is 0", () => {
    const result = computeActivation([], "reference", "episodic", Date.now(), 0);
    expect(result).toBe(0.0);
  });

  it("returns 0.0 when accessTimes is empty and createdAt is negative", () => {
    const result = computeActivation([], "reference", "episodic", Date.now(), -1);
    expect(result).toBe(0.0);
  });

  it("clamps to >= 0.0 when using synthetic createdAt access", () => {
    // A very old memory with no real accesses → synthetic time produces
    // a negative ln, but clamp should bring it to 0.0
    const veryOldCreatedAt = 1_000_000_000_000; // ~2001
    const result = computeActivation(
      [],
      "reference",
      "semantic",
      Date.now(),
      veryOldCreatedAt,
    );
    expect(result).toBeGreaterThanOrEqual(0.0);
    expect(result).toBe(0.0); // old enough that ln(hours^-d) + beta < 0 → clamped
  });

  it("synthetic createdAt can produce positive activation for very recent memory", () => {
    const justNow = Date.now() - 100; // 100 ms ago
    const result = computeActivation(
      [],
      "critical",
      "episodic",
      Date.now(),
      justNow,
    );
    // critical: d=0.3, beta=2.0, hoursSince ~ 2.78e-5
    // sum = (2.78e-5)^-0.3 ≈ 15.3, ln(15.3) ≈ 2.73, +2.0 ≈ 4.73
    expect(result).toBeGreaterThan(2.0);
  });

  // ---- urgency-based decay ----
  it("decays by urgency: critical retains highest activation", () => {
    const now = Date.now();
    const oldAccess = now - 72 * 3_600_000; // 72 hours ago
    const critical = computeActivation([oldAccess], "critical", "episodic");
    const background = computeActivation([oldAccess], "background", "episodic");
    // Critical (d=0.3, beta=2.0) should be higher than background (d=0.8, beta=-1.0)
    expect(critical).toBeGreaterThan(background);
  });

  it("computes expected value for one access at 1-hour ago (reference)", () => {
    const now = Date.now();
    const oneHourAgo = now - 3_600_000;
    // reference: d=0.6, beta=0.0
    // hoursSince = 1.0
    // sum = 1^-0.6 = 1.0
    // activation = ln(1.0) + 0.0 = 0.0
    const result = computeActivation([oneHourAgo], "reference", "episodic", now);
    expect(result).toBeCloseTo(0.0, 5);
  });

  it("computes expected value for one access at 1-hour ago (critical)", () => {
    const now = Date.now();
    const oneHourAgo = now - 3_600_000;
    // critical: d=0.3, beta=2.0
    // hoursSince = 1.0, sum = 1^-0.3 = 1.0
    // activation = ln(1.0) + 2.0 = 2.0
    const result = computeActivation([oneHourAgo], "critical", "episodic", now);
    expect(result).toBeCloseTo(2.0, 5);
  });

  it("computes expected value for one access at 1-hour ago (background)", () => {
    const now = Date.now();
    const oneHourAgo = now - 3_600_000;
    // background: d=0.8, beta=-1.0
    // hoursSince = 1.0, sum = 1^-0.8 = 1.0
    // activation = ln(1.0) + (-1.0) = -1.0
    const result = computeActivation(
      [oneHourAgo],
      "background",
      "episodic",
      now,
    );
    expect(result).toBeCloseTo(-1.0, 5);
  });

  it("returns higher activation for more recent accesses", () => {
    const now = Date.now();
    const fresh = now - 600_000; // 10 minutes
    const stale = now - 7_200_000; // 2 hours
    const freshAct = computeActivation([fresh], "important", "episodic", now);
    const staleAct = computeActivation([stale], "important", "episodic", now);
    expect(freshAct).toBeGreaterThan(staleAct);
  });

  it("returns higher activation for multiple accesses vs single", () => {
    const now = Date.now();
    const oneAccess = computeActivation(
      [now - 3_600_000],
      "reference",
      "episodic",
      now,
    );
    const twoAccesses = computeActivation(
      [now - 3_600_000, now - 3_600_000],
      "reference",
      "episodic",
      now,
    );
    expect(twoAccesses).toBeGreaterThan(oneAccess);
  });

  it("handles multiple spaced-out accesses", () => {
    const now = Date.now();
    const accesses = [
      now - 1_800_000, // 0.5 h
      now - 14_400_000, // 4 h
      now - 86_400_000, // 24 h
    ];
    const result = computeActivation(accesses, "important", "episodic", now);
    // Should produce a finite number, not NaN or -Infinity
    expect(Number.isFinite(result)).toBe(true);
    // Memory with some recent hits should be active
    expect(result).toBeGreaterThanOrEqual(-2.0);
  });

  it("handles very recent access (sub-second) — floored at 0.001h", () => {
    const now = Date.now();
    const justNow = now - 1; // 1 ms ago
    const result = computeActivation([justNow], "reference", "episodic", now);
    // hoursSince is floored at 0.001 (≈ 3.6s), so result is bounded
    // sum = 0.001^-0.6 ≈ 63.1, ln ≈ 4.14, + 0 = 4.14
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(3.0);
    expect(result).toBeLessThan(6.0);
  });

  it("does not go to -Infinity for very old single access", () => {
    const now = Date.now();
    const veryOld = now - 10 * 365 * 86_400_000; // 10 years ago
    const result = computeActivation([veryOld], "background", "episodic", now);
    // hoursSince huge → sum tiny → ln(very small) ≈ -some big number, + (-1.0) beta
    // but sum should be > 0 so this produces a finite negative value
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeLessThan(0);
  });

  it("uses default nowMs = Date.now() when not provided", () => {
    const result = computeActivation([], "reference", "core");
    expect(result).toBe(10.0);
  });

  it("falls back to reference decay rates for unknown urgency", () => {
    const now = Date.now();
    const access = now - 3_600_000;
    const unknown = computeActivation(
      [access],
      "invalid" as any,
      "episodic",
      now,
    );
    const reference = computeActivation(
      [access],
      "reference",
      "episodic",
      now,
    );
    expect(unknown).toBe(reference);
  });
});

// ---------------------------------------------------------------------------
// getDecayStatus
// ---------------------------------------------------------------------------
describe("getDecayStatus", () => {
  it('returns "active" for activation >= -2.0', () => {
    expect(getDecayStatus(10.0)).toBe("active");
    expect(getDecayStatus(0.0)).toBe("active");
    expect(getDecayStatus(-1.999)).toBe("active");
    expect(getDecayStatus(-2.0)).toBe("active");
  });

  it('returns "forgotten" for activation between -4.0 (inclusive) and -2.0 (exclusive)', () => {
    expect(getDecayStatus(-2.001)).toBe("forgotten");
    expect(getDecayStatus(-3.0)).toBe("forgotten");
    expect(getDecayStatus(-3.999)).toBe("forgotten");
    expect(getDecayStatus(-4.0)).toBe("forgotten");
  });

  it('returns "archive" for activation < -4.0', () => {
    expect(getDecayStatus(-4.001)).toBe("archive");
    expect(getDecayStatus(-5.0)).toBe("archive");
    expect(getDecayStatus(-100.0)).toBe("archive");
  });

  it("distinguishes all three bands correctly", () => {
    expect(getDecayStatus(0.0)).toBe("active");
    expect(getDecayStatus(-2.5)).toBe("forgotten");
    expect(getDecayStatus(-10.0)).toBe("archive");
  });
});

// ---------------------------------------------------------------------------
// applyDecayBoost
// ---------------------------------------------------------------------------
describe("applyDecayBoost", () => {
  it("normalizes activation -4 to 0, +3 to 1", () => {
    // activation = -4 → normalized = 0 → result = score * 0.8 + 0 * 0.2 = 0
    expect(applyDecayBoost(0, -4)).toBeCloseTo(0, 5);
    // activation = +3 → normalized = 1 → result = 1 * 0.8 + 1 * 0.2 = 1
    expect(applyDecayBoost(1, 3)).toBeCloseTo(1, 5);
  });

  it("clamps normalized to [0, 1]", () => {
    const below = applyDecayBoost(0.5, -10); // should clamp to 0
    const above = applyDecayBoost(0.5, 10); // should clamp to 1
    // below: 0.5 * 0.8 + 0 * 0.2 = 0.4
    expect(below).toBeCloseTo(0.4, 5);
    // above: 0.5 * 0.8 + 1 * 0.2 = 0.6
    expect(above).toBeCloseTo(0.6, 5);
  });

  it("blends 80% search score with 20% normalized activation", () => {
    // score = 0.5, activation = -1 (normalized = 3/7 ≈ 0.4286)
    // result = 0.5 * 0.8 + 0.4286 * 0.2 = 0.4 + 0.0857 = 0.4857
    const result = applyDecayBoost(0.5, -1);
    expect(result).toBeCloseTo(0.485714, 4);
  });

  it("gives equal weight to score when activation is at midpoint", () => {
    // activation = -0.5 → normalized = ( -0.5 + 4 ) / 7 = 3.5 / 7 = 0.5
    // score = 0.5 → 0.5 * 0.8 + 0.5 * 0.2 = 0.5
    expect(applyDecayBoost(0.5, -0.5)).toBeCloseTo(0.5, 5);
  });

  it("returns 0.114... when both inputs are 0 (activation=0 → normalized=4/7)", () => {
    // activation=0 maps to normalized=4/7 ≈ 0.5714
    // result = 0 * 0.8 + 0.5714 * 0.2 ≈ 0.1143
    expect(applyDecayBoost(0, 0)).toBeCloseTo(0.114286, 5);
  });
});
