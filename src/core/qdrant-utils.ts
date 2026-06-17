/**
 * Shared Qdrant utility functions used across multiple cognitive modules.
 * Consolidates duplicated implementations of cosineSimilarity, scrollBatch,
 * and setPayload that were previously copied across consolidation.ts,
 * dream.ts, and pattern-miner.ts.
 */

// ============================================================================
// Vector Math
// ============================================================================

/** Compute cosine similarity between two vectors of equal dimension. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ============================================================================
// Batch Scroll
// ============================================================================

export interface ScrollPoint {
  id: string;
  payload: Record<string, unknown>;
  vector?: number[];
}

/**
 * Scroll a Qdrant collection in batches.
 * Only returns non-deleted points.
 */
export async function scrollBatch(
  qdrantUrl: string,
  collection: string,
  limit: number,
  offset?: string | number | null,
): Promise<{ points: ScrollPoint[]; nextOffset: string | number | null }> {
  const body: Record<string, unknown> = {
    limit,
    filter: { must: [{ key: "deleted", match: { value: false } }] },
    with_payload: true,
    with_vector: true,
  };
  if (offset !== undefined && offset !== null) {
    body.offset = offset;
  }

  const res = await fetch(`${qdrantUrl}/collections/${collection}/points/scroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) return { points: [], nextOffset: null };
  const data = (await res.json()) as {
    result: { points: ScrollPoint[]; next_page_offset?: string | number | null };
  };
  return {
    points: data.result.points || [],
    nextOffset: data.result.next_page_offset ?? null,
  };
}

// ============================================================================
// Set Payload
// ============================================================================

/** Set payload fields on a Qdrant point via set_payload API. */
export async function setPayload(
  qdrantUrl: string,
  collection: string,
  pointId: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${qdrantUrl}/collections/${collection}/points/payload`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wait: true, points: [pointId], payload }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
