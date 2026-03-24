// Rope data structure for text storage
// SumTree<TextChunk> with TextSummary metadata

export const ROPE_VERSION = "0.1.0";

export { Rope } from "./rope.js";
export { createTextChunk, computeTextSummary } from "./summary.js";
export type { TextChunk } from "./types.js";
export { CHUNK_TARGET, CHUNK_MIN } from "./types.js";
