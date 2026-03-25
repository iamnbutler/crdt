/**
 * WebAssembly (WAT) implementations for performance-critical CRDT operations.
 *
 * This module provides hand-written WebAssembly Text (WAT) implementations
 * of hot paths in the CRDT, starting with compareLocators as a spike.
 *
 * Reference: GitHub issue #113 (moonshot: Hand-written WebAssembly for tree operations)
 */

export {
  loadWasmModule,
  compareLocatorsWasm,
  encodeLocatorPair,
  type WasmExports,
} from "./compare-locators.js";
