# CRDT SumTree - TypedArray Arena Allocator

A high-performance TypedArray arena allocator for tree-based data structures. All tree nodes are integer indices into the arena, eliminating GC pressure on hot paths.

## Features

- **Zero GC pressure**: Nodes are integer indices, not object references
- **O(1) allocation**: Bitfield free-list with `x & -x` first-free-bit trick
- **Two memory layouts**: AoS (Array of Structs) and SoA (Struct of Arrays) for benchmarking
- **Efficient growth**: Uses `ArrayBuffer.transfer()` for zero-copy reallocation
- **Epoch-based reclamation**: Snapshot-aware garbage collection
- **Mark-sweep GC**: Built-in mark-sweep within the arena
- **Leak detection**: `FinalizationRegistry` backstop for snapshot leaks

## Installation

```bash
bun install
```

## Usage

```typescript
import { AosArena, SoaArena, NULL_NODE } from "./src/arena";

// Create an arena with estimated capacity
const arena = new AosArena(1024);

// Allocate nodes
const root = arena.allocNode();
const left = arena.allocNode();
const right = arena.allocNode();

// Set node fields
arena.setLeft(root, left);
arena.setRight(root, right);
arena.setSum(root, 100.0);

// Read node fields
console.log(arena.getSum(root)); // 100.0

// Free nodes
arena.freeNode(left);
arena.freeNode(right);

// Check stats
console.log(arena.getStats());
// { capacity: 1024, liveNodes: 1, freeNodes: 1023, utilization: 0.001, ... }
```

## Running Tests

```bash
bun test
```

## Running Benchmarks

```bash
bun run benchmarks/arena-bench.ts
```

## Benchmark Results

Benchmarks run on Bun v1.3.11:

### Allocation Throughput

| Arena | Ops/sec | Notes |
|-------|---------|-------|
| AosArena | ~600K | Pre-allocated capacity |
| SoaArena | ~630K | Pre-allocated capacity |
| AosArena | ~840K | With growth from 64 |
| SoaArena | ~1.3M | With growth from 64 |

### Tree Traversal (multi-field access per node)

| Arena | Ops/sec | Relative |
|-------|---------|----------|
| AosArena | ~578K | 1.00x |
| SoaArena | ~1.04M | 1.79x faster |

### Bulk Iteration (single-field access)

| Arena | Ops/sec | Relative |
|-------|---------|----------|
| AosArena | ~38M | 1.00x |
| SoaArena | ~327M | 8.6x faster |

### Key Finding

**Contrary to initial hypothesis**, SoA (Struct of Arrays) performed better than AoS for tree traversal in this benchmark environment. This may be due to:

1. JSC/Bun optimizing TypedArray access patterns
2. Modern CPU prefetchers handling multiple memory streams efficiently
3. The specific access pattern in the benchmark

**Recommendation**: Both implementations are provided. For the SumTree use case:
- **SoA is recommended** as it shows better performance across all measured workloads
- AoS may still be preferable in other environments or access patterns - benchmark in your target environment

## Architecture

### Node Layout (32 bytes per node)

```
Field     | Offset | Size | Type
----------|--------|------|------
left      | 0      | 4    | u32 (node index)
right     | 4      | 4    | u32 (node index)
parent    | 8      | 4    | u32 (node index)
flags     | 12     | 4    | u32 (bitfield)
sum       | 16     | 8    | f64
payload   | 24     | 8    | f64
```

### Free-List Implementation

Uses a Uint32Array bitfield where each bit represents a node slot:
- 1 = free
- 0 = allocated

First free bit found using `x & -x` (isolates lowest set bit), giving O(1) allocation.

### Epoch-Based Reclamation

Snapshots track which epoch they were created at. Nodes can only be reclaimed if no live snapshot references their epoch.

```typescript
const arena = new AosArena(1024);
const snapshot = arena.createSnapshot();

// Nodes allocated before snapshot can't be reclaimed
// until snapshot.release() is called

arena.advanceEpoch();
// Nodes allocated after this can be reclaimed independently
```

## API Reference

### Arena Interface

```typescript
interface Arena {
  allocNode(): NodeIndex;
  freeNode(index: NodeIndex): void;
  readonly nodeCount: number;
  readonly capacity: number;
  getStats(): ArenaStats;

  // Field accessors
  getLeft(index: NodeIndex): NodeIndex;
  setLeft(index: NodeIndex, value: NodeIndex): void;
  // ... similar for right, parent, sum, payload, flags

  // Epoch management
  getCurrentEpoch(): number;
  advanceEpoch(): number;

  // Mark-sweep GC
  markNode(index: NodeIndex): void;
  sweep(): number;

  // Lifecycle
  release(): void;
}
```

## License

MIT
