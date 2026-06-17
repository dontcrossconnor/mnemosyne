/**
 * feedback — Memory-R1 self-improving retrieval.
 *
 * Tracks which recalled memories were actually useful and adjusts
 * importance/confidence scores accordingly.
 */

import type { MemCellSearchResult } from "../core/types.js";
import { DEFAULT_COLLECTIONS } from "../core/types.js";
import {
  memoryFeedback as applyMemoryFeedback,
  type FeedbackResult,
} from "../cognitive/feedback.js";

export interface FeedbackContext {
  qdrantUrl: string;
  /** Optional collection name overrides. Falls back to DEFAULT_COLLECTIONS. */
  collections?: {
    shared?: string;
    private?: string;
  };
}

export async function feedback(
  ctx: FeedbackContext,
  recalledMemories: MemCellSearchResult[],
  userResponse: string,
): Promise<FeedbackResult[]> {
  const shared = ctx.collections?.shared ?? DEFAULT_COLLECTIONS.SHARED;
  return applyMemoryFeedback(
    ctx.qdrantUrl,
    shared,
    recalledMemories,
    userResponse,
  );
}
