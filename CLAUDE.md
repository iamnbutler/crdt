# @iamnbutler/crdt

Pure TypeScript CRDT implementation for collaborative text editing.

## Project Philosophy

- **Bun-first**: Use Bun runtime, no Node.js compatibility needed
- **Zero dependencies**: All algorithms implemented from scratch
- **Strict TypeScript**: No `any`, no type assertions, no runtime type errors

## Commands

```bash
bun install          # Install dev dependencies
bun test             # Run tests
bun run typecheck    # TypeScript type checking
bun run lint         # Biome linting
bun run lint:fix     # Auto-fix lint issues
bun run bench        # Run benchmarks
bun run bench:ci     # Benchmarks with JSON output for CI
bun run fixtures:download  # Download Kleppmann editing trace
```

## Code Style

Enforced by Biome and TypeScript strict mode:

- No `any` types - use proper generics or `unknown` with type guards
- No type assertions (`as`) - refactor to make types flow naturally
- No non-null assertions (`!`) - handle null/undefined explicitly
- Use `const` over `let`, never use `var`
- Imports must use `type` keyword for type-only imports
- 2-space indentation, double quotes, semicolons

## Module Structure

```
src/
  arena/       # Arena allocator for CRDT nodes
  sum-tree/    # Sum tree for efficient range queries
  rope/        # Rope data structure for text storage
  text/        # Text CRDT implementation
  protocol/    # Sync protocol for collaboration
```

Each module is exported as a subpath: `@iamnbutler/crdt/rope`, etc.

## Testing

- Tests live alongside source files as `*.test.ts`
- Use Bun's built-in test runner
- Target edge cases: empty documents, single characters, large documents

## Benchmarking

- Uses mitata for microbenchmarks
- Kleppmann editing trace (260K ops) for realistic workloads
- Synthetic documents from 100 lines to 10M lines
- 10% regression threshold blocks merge

Run `bun run fixtures:download` to get the editing trace before benchmarking.

## Performance Considerations

- Minimize allocations in hot paths
- Use arena allocation for CRDT nodes
- Prefer mutable operations internally, immutable APIs externally
- Profile with `bun --inspect` for detailed analysis
