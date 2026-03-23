/**
 * Arena Allocator Module
 *
 * Provides TypedArray-backed arena allocators for SumTree nodes.
 * All nodes are integer indices into the arena - zero GC pressure on hot paths.
 */

export * from "./types.ts";
export { AosArena, createAosArena } from "./aos-arena.ts";
export { SoaArena, createSoaArena } from "./soa-arena.ts";

export const ARENA_VERSION = "0.1.0";
