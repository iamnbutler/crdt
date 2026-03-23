// Core types for the Rope data structure

import type { Summarizable, TextSummary } from "../sum-tree/index.js";

/**
 * A chunk of text stored in a rope leaf.
 * Implements Summarizable so it can be stored in a SumTree.
 */
export interface TextChunk extends Summarizable<TextSummary> {
  readonly text: string;
}

/**
 * Target chunk size in UTF-16 code units.
 * At 2048 avg chunk size, a 1M-line file (~40M chars) has ~20K chunks.
 */
export const CHUNK_TARGET = 2048;

/**
 * Minimum chunk size (half target) to avoid tiny fragments.
 */
export const CHUNK_MIN = Math.floor(CHUNK_TARGET / 2);
