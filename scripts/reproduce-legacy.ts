import { loadEditingTrace } from "../benchmarks/fixtures.js";
import { TextBuffer } from "../src/text/index.js";

const trace = await loadEditingTrace();
if (!trace) throw new Error("Run bun run fixtures:download");
const doc = TextBuffer.create();
let expected = "";
for (let i = 0; i < trace.operations.length; i++) {
  const op = trace.operations[i];
  if (op === undefined) break;
  if (op.deleteCount) doc.delete(op.position, op.position + op.deleteCount);
  if (op.insertText) doc.insert(op.position, op.insertText);
  expected =
    expected.slice(0, op.position) + op.insertText + expected.slice(op.position + op.deleteCount);
  const actual = doc.getText();
  if (actual !== expected) {
    let offset = 0;
    while (actual[offset] === expected[offset]) offset++;
    console.error(
      JSON.stringify(
        {
          edit: i + 1,
          op,
          firstDifferentOffset: offset,
          expected: expected.slice(Math.max(0, offset - 15), offset + 30),
          actual: actual.slice(Math.max(0, offset - 15), offset + 30),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
}
console.log("The original engine now matches the complete trace.");
