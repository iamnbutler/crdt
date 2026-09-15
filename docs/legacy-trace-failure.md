# Original engine: real-trace failure

The original `TextBuffer` at commit `9ffb0f3` first disagrees with an ordinary string-splice oracle on **edit 493** of the Kleppmann trace (one-based index):

```json
{ "position": 450, "deleteCount": 0, "insertText": "\n" }
```

Both strings still have length 467. The newline is placed at the wrong location near the document's end, so a length-only benchmark misses the failure. The old comparison benchmark also did not validate the final text before accepting timings.

Reproduce from this repository:

```sh
bun run fixtures:download
bun run scripts/reproduce-legacy.ts
```

The script exits with status 1 at the first mismatch and prints a small context around it. It uses the retained original source, not the new RunText core. The benchmark harness excludes this trace timing and displays the correctness failure. It also checks the original engine's synthetic workloads independently.

This observation was the reason to redesign the ordering/storage relationship instead of continuing the disabled run-extension experiment. The original checkout and its uncommitted work were preserved.
