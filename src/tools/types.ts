/**
 * Shared option types for memory tools.
 */

import type { MemoryType, UrgencyLevel, Domain, Classification } from "../core/types.js";

export type StoreOptions = {
  importance?: number;
  memoryType?: MemoryType;
  urgency?: UrgencyLevel;
  domain?: Domain;
  classification?: Classification;
  userId?: string;
  metadata?: Record<string, unknown>;
  /** Override default max store length for this call. */
  maxStoreLength?: number;
};

export interface RecallOptions {
  limit?: number;
  minScore?: number;
  userId?: string;
  includeChains?: boolean;
  filters?: Record<string, unknown>;
  /** Override default max recall results for this call. */
  maxRecallResults?: number;
}

export interface ForgetOptions {
  query?: string;
  memoryId?: string;
  collection?: string;
}
