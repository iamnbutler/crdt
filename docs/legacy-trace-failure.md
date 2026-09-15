# Original engine: real-trace failure

The original `TextBuffer` at commit `9ffb0f3` first disagrees with an ordinary string-splice oracle on **edit 493** of the Kleppmann trace (one-based index):

```json
{ "position": 450, "deleteCount": 0, "insertText": "\n" }
```

Both strings still have length 467. The newline is placed at the wrong location near the document's end, so a length-only benchmark misses the failure. The old comparison benchmark also did not validate the final text before accepting timings.

The old implementation has been removed from the active source tree. Reproduce at the recorded historical revision in a separate worktree:

```sh
git worktree add --detach /tmp/crdt-legacy-repro ec19ea9
cd /tmp/crdt-legacy-repro
bun install --frozen-lockfile
bun run fixtures:download
bun run scripts/reproduce-legacy.ts
```

The historical script exits with status 1 at the first mismatch and prints a small context around it. That revision benchmarks the previous engine and RunText separately, excludes incorrect timings, and records the failure. Current measurements run only RunText and the external competitors.

This observation was the reason to redesign the ordering/storage relationship instead of continuing the disabled run-extension experiment. The original checkout and its uncommitted work were preserved.
