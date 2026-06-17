import { describe, it, expect } from "vitest";
import { computeConfidence, confidenceLabel } from "../src/cognitive/confidence.js";

// ── Formula reminder ──────────────────────────────────────────────
// score = 0.50 × retrievalScore + 0.30 × agentAgreement + 0.20 × sourceTrust
// Clamped to [0.0, 1.0]
//
// Tier boundaries (from source):
//   score >= 0.85  → "verified"
//   score >= 0.60  → "grounded"
//   score >= 0.40  → "inferred"
//   score <  0.40  → "uncertain"
// ──────────────────────────────────────────────────────────────────

describe("computeConfidence", () => {
  // ── Verified tier (score >= 0.85) ─────────────────────────────
  describe("verified tier", () => {
    it("returns verified at the exact boundary (0.85)", () => {
      const result = computeConfidence(0.85, 0.85, 0.85);
      expect(result.score).toBeCloseTo(0.85);
      expect(result.tag).toBe("verified");
    });

    it("returns verified above the boundary", () => {
      const result = computeConfidence(1.0, 1.0, 1.0);
      expect(result.score).toBe(1.0);
      expect(result.tag).toBe("verified");
    });

    it("returns verified when barely above the boundary via mixed inputs", () => {
      // 0.50*1.0 + 0.30*1.0 + 0.20*0.25 = 0.50+0.30+0.05 = 0.85
      const result = computeConfidence(1.0, 1.0, 0.25);
      expect(result.score).toBeCloseTo(0.85);
      expect(result.tag).toBe("verified");
    });
  });

  // ── Grounded tier (0.60 <= score < 0.85) ──────────────────────
  describe("grounded tier", () => {
    it("returns grounded at the upper boundary (0.84)", () => {
      const result = computeConfidence(0.84, 0.84, 0.84);
      expect(result.score).toBeCloseTo(0.84);
      expect(result.tag).toBe("grounded");
    });

    it("returns grounded at the lower boundary (0.60)", () => {
      const result = computeConfidence(0.60, 0.60, 0.60);
      expect(result.score).toBeCloseTo(0.60);
      expect(result.tag).toBe("grounded");
    });

    it("returns grounded in the middle of the tier", () => {
      const result = computeConfidence(0.70, 0.80, 0.75);
      // 0.50*0.70 + 0.30*0.80 + 0.20*0.75 = 0.35+0.24+0.15 = 0.74
      expect(result.score).toBeCloseTo(0.74);
      expect(result.tag).toBe("grounded");
    });
  });

  // ── Inferred tier (0.40 <= score < 0.60) ──────────────────────
  describe("inferred tier", () => {
    it("returns inferred at the upper boundary (0.59)", () => {
      const result = computeConfidence(0.59, 0.59, 0.59);
      expect(result.score).toBeCloseTo(0.59);
      expect(result.tag).toBe("inferred");
    });

    it("returns inferred at the lower boundary (0.40)", () => {
      const result = computeConfidence(0.40, 0.40, 0.40);
      expect(result.score).toBeCloseTo(0.40);
      expect(result.tag).toBe("inferred");
    });

    it("returns inferred in the middle of the tier", () => {
      const result = computeConfidence(0.50, 0.50, 0.50);
      // 0.50*0.50 + 0.30*0.50 + 0.20*0.50 = 0.25+0.15+0.10 = 0.50
      expect(result.score).toBeCloseTo(0.50);
      expect(result.tag).toBe("inferred");
    });
  });

  // ── Uncertain tier (score < 0.40) ─────────────────────────────
  describe("uncertain tier", () => {
    it("returns uncertain just below the boundary (0.39)", () => {
      const result = computeConfidence(0.39, 0.39, 0.39);
      expect(result.score).toBeCloseTo(0.39);
      expect(result.tag).toBe("uncertain");
    });

    it("returns uncertain at zero", () => {
      const result = computeConfidence(0, 0, 0);
      expect(result.score).toBe(0);
      expect(result.tag).toBe("uncertain");
    });

    it("returns uncertain at very low values", () => {
      const result = computeConfidence(0.1, 0.1, 0.1);
      // 0.50*0.1 + 0.30*0.1 + 0.20*0.1 = 0.05+0.03+0.02 = 0.10
      expect(result.score).toBeCloseTo(0.10);
      expect(result.tag).toBe("uncertain");
    });
  });

  // ── Combined scoring / formula correctness ────────────────────
  describe("combined scoring", () => {
    it("applies the 50/30/20 weight formula correctly", () => {
      // retrieval has the heaviest weight
      const highRetrieval = computeConfidence(1.0, 0.0, 0.0);
      expect(highRetrieval.score).toBeCloseTo(0.50);
      expect(highRetrieval.tag).toBe("inferred");

      // agent agreement is medium weight
      const highAgreement = computeConfidence(0.0, 1.0, 0.0);
      expect(highAgreement.score).toBeCloseTo(0.30);
      expect(highAgreement.tag).toBe("uncertain");

      // source trust is lightest weight
      const highTrust = computeConfidence(0.0, 0.0, 1.0);
      expect(highTrust.score).toBeCloseTo(0.20);
      expect(highTrust.tag).toBe("uncertain");
    });

    it("weighs retrieval more than agreement more than trust", () => {
      // Same value for all three → each contributes proportionally
      const balanced = computeConfidence(0.75, 0.75, 0.75);
      expect(balanced.score).toBeCloseTo(0.75);
      expect(balanced.tag).toBe("grounded");

      // retrieval dominates — high retrieval pulls score up even with low others
      const retrievalHeavy = computeConfidence(1.0, 0.2, 0.2);
      // 0.50*1.0 + 0.30*0.2 + 0.20*0.2 = 0.50+0.06+0.04 = 0.60
      expect(retrievalHeavy.score).toBeCloseTo(0.60);
      expect(retrievalHeavy.tag).toBe("grounded");

      // low retrieval drags score down even with high others
      const retrievalLight = computeConfidence(0.3, 1.0, 1.0);
      // 0.50*0.3 + 0.30*1.0 + 0.20*1.0 = 0.15+0.30+0.20 = 0.65
      expect(retrievalLight.score).toBeCloseTo(0.65);
      expect(retrievalLight.tag).toBe("grounded");
    });

    it("handles fractional inputs correctly", () => {
      // Edge of grounded/inferred boundary
      const atBoundary = computeConfidence(1.0, 0.0, 0.0);
      expect(atBoundary.score).toBeCloseTo(0.50);
      expect(atBoundary.tag).toBe("inferred");

      const justAbove = computeConfidence(1.0, 0.5, 0.0);
      // 0.50*1.0 + 0.30*0.5 + 0.20*0.0 = 0.50+0.15+0.00 = 0.65
      expect(justAbove.score).toBeCloseTo(0.65);
      expect(justAbove.tag).toBe("grounded");
    });
  });

  // ── Score clamping ────────────────────────────────────────────
  describe("score clamping", () => {
    it("clamps values above 1.0 to 1.0", () => {
      const result = computeConfidence(2.0, 2.0, 2.0);
      expect(result.score).toBe(1.0);
      expect(result.tag).toBe("verified");
    });

    it("clamps values below 0.0 to 0.0", () => {
      const result = computeConfidence(-0.5, -0.5, -0.5);
      expect(result.score).toBe(0.0);
      expect(result.tag).toBe("uncertain");
    });

    it("clamps partially above-range inputs", () => {
      // 0.50*1.5 + 0.30*1.0 + 0.20*1.0 = 0.75+0.30+0.20 = 1.25 → clamped to 1.0
      const result = computeConfidence(1.5, 1.0, 1.0);
      expect(result.score).toBe(1.0);
      expect(result.tag).toBe("verified");
    });

    it("clamps partially below-range inputs", () => {
      // 0.50*(-0.2) + 0.30*0.5 + 0.20*0.5 = -0.10+0.15+0.10 = 0.15 → no clamp needed
      // But test truly negative sum:
      // 0.50*(-1.0) + 0.30*(-1.0) + 0.20*(-1.0) = -0.50-0.30-0.20 = -1.0 → clamped to 0.0
      const result = computeConfidence(-1.0, -1.0, -1.0);
      expect(result.score).toBe(0.0);
      expect(result.tag).toBe("uncertain");
    });
  });

  // ── Edge cases ────────────────────────────────────────────────
  describe("edge cases", () => {
    it("handles all zeros", () => {
      const result = computeConfidence(0, 0, 0);
      expect(result.score).toBe(0);
      expect(result.tag).toBe("uncertain");
    });

    it("handles all ones", () => {
      const result = computeConfidence(1, 1, 1);
      expect(result.score).toBe(1);
      expect(result.tag).toBe("verified");
    });

    it("handles floating point precision near boundaries", () => {
      // score = 0.849999... should be grounded, not verified
      const justBelow = computeConfidence(0.849999, 0.849999, 0.849999);
      expect(justBelow.score).toBeLessThan(0.85);
      expect(justBelow.tag).toBe("grounded");

      // score = 0.599999... should be inferred, not grounded
      const belowGrounded = computeConfidence(0.599999, 0.599999, 0.599999);
      expect(belowGrounded.score).toBeLessThan(0.60);
      expect(belowGrounded.tag).toBe("inferred");

      // score = 0.399999... should be uncertain, not inferred
      const belowInferred = computeConfidence(0.399999, 0.399999, 0.399999);
      expect(belowInferred.score).toBeLessThan(0.40);
      expect(belowInferred.tag).toBe("uncertain");
    });
  });
});

// ── confidenceLabel ──────────────────────────────────────────────
describe("confidenceLabel", () => {
  it('returns "VERIFIED" for the verified tag', () => {
    expect(confidenceLabel("verified")).toBe("VERIFIED");
  });

  it('returns "GROUNDED" for the grounded tag', () => {
    expect(confidenceLabel("grounded")).toBe("GROUNDED");
  });

  it('returns "INFERRED" for the inferred tag', () => {
    expect(confidenceLabel("inferred")).toBe("INFERRED");
  });

  it('returns "UNCERTAIN" for the uncertain tag', () => {
    expect(confidenceLabel("uncertain")).toBe("UNCERTAIN");
  });
});
