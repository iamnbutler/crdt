import { RunText, type Operation } from "../src/run/index.js";

const leftInput = document.getElementById("replica-a");
const rightInput = document.getElementById("replica-b");
const toggle = document.getElementById("connection");
const status = document.getElementById("demo-status");
const reset = document.getElementById("reset-demo");
if (!(leftInput instanceof HTMLTextAreaElement) || !(rightInput instanceof HTMLTextAreaElement) ||
  !(toggle instanceof HTMLButtonElement) || status === null || reset === null) {
  throw new Error("Missing playground controls");
}

function playground(left: HTMLTextAreaElement, right: HTMLTextAreaElement, button: HTMLButtonElement, label: HTMLElement, resetButton: HTMLElement): void {
  let a = new RunText(1);
  let b = new RunText(2);
  let connected = true;
  const fromA: Operation[] = [];
  const fromB: Operation[] = [];

  function refresh(): void {
    left.value = a.getText();
    right.value = b.getText();
    button.textContent = connected ? "Disconnect replicas" : "Reconnect & merge";
    const pending = fromA.length + fromB.length;
    label.textContent = connected ? (a.getText() === b.getText() ? `● Connected · documents match · ${a.stats.runs} / ${b.stats.runs} stored runs` : "Merge error: replicas differ")
      : `○ Disconnected · ${pending} local ${pending === 1 ? "operation" : "operations"} waiting to sync`;
  }

  function initialize(): void {
    a = new RunText(1); b = new RunText(2);
    b.apply(a.insert(0, "Hello, collaborator.\n\nTry editing this text on either side."));
    connected = true; fromA.length = 0; fromB.length = 0;
    refresh();
  }

  function edit(doc: RunText, peer: RunText, input: HTMLTextAreaElement, queue: Operation[]): void {
    const before = doc.getText();
    const after = input.value;
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let end = 0;
    while (end < before.length - start && end < after.length - start && before[before.length - end - 1] === after[after.length - end - 1]) end++;
    const ops: Operation[] = [];
    const removed = before.length - start - end;
    if (removed > 0) ops.push(doc.delete(start, removed));
    const inserted = after.slice(start, after.length - end);
    if (inserted) ops.push(doc.insert(start, inserted));
    const selectionStart = input.selectionStart;
    const selectionEnd = input.selectionEnd;
    for (const op of ops) {
      if (connected) peer.apply(op);
      else queue.push(op);
    }
    refresh();
    input.setSelectionRange(selectionStart, selectionEnd);
  }

  left.addEventListener("input", (event) => { if (!(event instanceof InputEvent) || !event.isComposing) edit(a, b, left, fromA); });
  right.addEventListener("input", (event) => { if (!(event instanceof InputEvent) || !event.isComposing) edit(b, a, right, fromB); });
  left.addEventListener("compositionend", () => edit(a, b, left, fromA));
  right.addEventListener("compositionend", () => edit(b, a, right, fromB));
  button.addEventListener("click", () => {
    connected = !connected;
    if (connected) {
      // Deliberately reverse delivery: dependency queues must recover the order.
      for (const op of fromA.toReversed()) b.apply(op);
      for (const op of fromB.toReversed()) a.apply(op);
      fromA.length = 0; fromB.length = 0;
    }
    refresh();
  });
  resetButton.addEventListener("click", initialize);
  initialize();
}

playground(leftInput, rightInput, toggle, status, reset);
