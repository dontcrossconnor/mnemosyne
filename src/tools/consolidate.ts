/**
 * consolidate — Run memory consolidation pipeline.
 *
 * Finds contradictions, merges near-duplicates, promotes popular
 * memories, and demotes stale ones.
 */

import { DEFAULT_COLLECTIONS } from "../core/types.js";
import {
  runConsolidation,
  type ConsolidationReport,
} from "../cognitive/consolidation.js";

export interface ConsolidateContext {
  qdrantUrl: string;
  /** Optional collection name overrides. Falls back to DEFAULT_COLLECTIONS. */
  collections?: {
    shared?: string;
    private?: string;
  };
}

export interface ConsolidateOptions {
  collection?: string;
  batchSize?: number;
}

export async function consolidate(
  ctx: ConsolidateContext,
  options: ConsolidateOptions = {},
): Promise<ConsolidationReport> {
  const shared = ctx.collections?.shared ?? DEFAULT_COLLECTIONS.SHARED;
  return runConsolidation(
    ctx.qdrantUrl,
    options.collection || shared,
    options.batchSize || 200,
  );
}
