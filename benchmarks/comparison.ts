/**
 * Competitor Benchmark: @iamnbutler/crdt vs Loro, Yjs, Automerge
 *
 * Compares text CRDT performance across popular libraries using:
 * - Synthetic document operations (insert, delete at various positions)
 * - Kleppmann editing trace (260K realistic operations)
 * - Serialization/deserialization
 */

import { bench, group, run } from "mitata";
import { TextBuffer } from "../src/text/index.js";
import { loadEditingTrace } from "./fixtures.js";
import { generateSyntheticDocument } from "./synthetic.js";

import * as Automerge from "@automerge/automerge";
// Competitor imports
import { LoroDoc } from "loro-crdt";
import * as Y from "yjs";

// ---------------------------------------------------------------------------
// Library Adapters
// ---------------------------------------------------------------------------

/**
 * Adapter interface for normalizing text CRDT operations across libraries.
 */
interface TextCRDTAdapter {
  name: string;
  create(): unknown;
  fromString(content: string): unknown;
  insert(doc: unknown, position: number, text: string): void;
  delete(doc: unknown, position: number, length: number): void;
  getText(doc: unknown): string;
  serialize(doc: unknown): Uint8Array | string;
  deserialize(data: Uint8Array | string): unknown;
}

// --- Our CRDT Adapter ---
const ourAdapter: TextCRDTAdapter = {
  name: "@iamnbutler/crdt",
  create() {
    return TextBuffer.create();
  },
  fromString(content: string) {
    return TextBuffer.fromString(content);
  },
  insert(doc: unknown, position: number, text: string) {
    (doc as TextBuffer).insert(position, text);
  },
  delete(doc: unknown, position: number, length: number) {
    (doc as TextBuffer).delete(position, length);
  },
  getText(doc: unknown) {
    return (doc as TextBuffer).getText();
  },
  serialize(doc: unknown) {
    // Real CRDT serialization that preserves full state
    return (doc as TextBuffer).serialize();
  },
  deserialize(data: Uint8Array | string) {
    return TextBuffer.deserialize(data as Uint8Array);
  },
};

// --- Loro Adapter ---
const loroAdapter: TextCRDTAdapter = {
  name: "Loro",
  create() {
    const doc = new LoroDoc();
    doc.getText("content");
    return doc;
  },
  fromString(content: string) {
    const doc = new LoroDoc();
    const text = doc.getText("content");
    text.insert(0, content);
    return doc;
  },
  insert(doc: unknown, position: number, text: string) {
    const loroDoc = doc as LoroDoc;
    const textContainer = loroDoc.getText("content");
    textContainer.insert(position, text);
  },
  delete(doc: unknown, position: number, length: number) {
    const loroDoc = doc as LoroDoc;
    const textContainer = loroDoc.getText("content");
    textContainer.delete(position, length);
  },
  getText(doc: unknown) {
    const loroDoc = doc as LoroDoc;
    return loroDoc.getText("content").toString();
  },
  serialize(doc: unknown) {
    return (doc as LoroDoc).export({ mode: "snapshot" });
  },
  deserialize(data: Uint8Array | string) {
    const doc = new LoroDoc();
    doc.import(data as Uint8Array);
    return doc;
  },
};

// --- Yjs Adapter ---
const yjsAdapter: TextCRDTAdapter = {
  name: "Yjs",
  create() {
    const doc = new Y.Doc();
    doc.getText("content");
    return doc;
  },
  fromString(content: string) {
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, content);
    return doc;
  },
  insert(doc: unknown, position: number, text: string) {
    const yDoc = doc as Y.Doc;
    const textContainer = yDoc.getText("content");
    textContainer.insert(position, text);
  },
  delete(doc: unknown, position: number, length: number) {
    const yDoc = doc as Y.Doc;
    const textContainer = yDoc.getText("content");
    textContainer.delete(position, length);
  },
  getText(doc: unknown) {
    const yDoc = doc as Y.Doc;
    return yDoc.getText("content").toString();
  },
  serialize(doc: unknown) {
    return Y.encodeStateAsUpdate(doc as Y.Doc);
  },
  deserialize(data: Uint8Array | string) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, data as Uint8Array);
    return doc;
  },
};

// --- Automerge Adapter ---
// Automerge 3.x uses splice on string properties for text operations
interface AutomergeDoc {
  text: string;
}

const automergeAdapter: TextCRDTAdapter = {
  name: "Automerge",
  create() {
    return Automerge.change(Automerge.init<AutomergeDoc>(), (d) => {
      d.text = "";
    });
  },
  fromString(content: string) {
    return Automerge.change(Automerge.init<AutomergeDoc>(), (d) => {
      d.text = content;
    });
  },
  insert(doc: unknown, position: number, text: string) {
    const amDoc = doc as Automerge.Doc<AutomergeDoc>;
    return Automerge.change(amDoc, (d) => {
      Automerge.splice(d, ["text"], position, 0, text);
    });
  },
  delete(doc: unknown, position: number, length: number) {
    const amDoc = doc as Automerge.Doc<AutomergeDoc>;
    return Automerge.change(amDoc, (d) => {
      Automerge.splice(d, ["text"], position, length);
    });
  },
  getText(doc: unknown) {
    const amDoc = doc as Automerge.Doc<AutomergeDoc>;
    return amDoc.text;
  },
  serialize(doc: unknown) {
    return Automerge.save(doc as Automerge.Doc<AutomergeDoc>);
  },
  deserialize(data: Uint8Array | string) {
    return Automerge.load<AutomergeDoc>(data as Uint8Array);
  },
};

// All adapters to benchmark
const adapters: TextCRDTAdapter[] = [ourAdapter, loroAdapter, yjsAdapter, automergeAdapter];

// ---------------------------------------------------------------------------
// Benchmark Configuration
// ---------------------------------------------------------------------------

const isCI = process.argv.includes("--ci");

// Test content sizes
const SMALL_TEXT = "Hello, world!";
const MEDIUM_TEXT = generateSyntheticDocument("tiny"); // ~8KB
const LARGE_TEXT = generateSyntheticDocument("small"); // ~80KB

// Number of operations for sequential benchmarks
const SEQUENTIAL_OPS = 1000;

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

console.log("Competitor Benchmark: @iamnbutler/crdt vs Loro, Yjs, Automerge\n");

// --- Document Creation ---
group("create-empty", () => {
  for (const adapter of adapters) {
    bench(adapter.name, () => {
      return adapter.create();
    });
  }
});

group("create-from-small-string", () => {
  for (const adapter of adapters) {
    bench(adapter.name, () => {
      return adapter.fromString(SMALL_TEXT);
    });
  }
});

group("create-from-medium-string", () => {
  for (const adapter of adapters) {
    bench(adapter.name, () => {
      return adapter.fromString(MEDIUM_TEXT);
    });
  }
});

group("create-from-large-string", () => {
  for (const adapter of adapters) {
    bench(adapter.name, () => {
      return adapter.fromString(LARGE_TEXT);
    });
  }
});

// --- Sequential Insertions ---
group("insert-at-end", () => {
  for (const adapter of adapters) {
    bench(adapter.name, () => {
      let doc = adapter.create();
      for (let i = 0; i < SEQUENTIAL_OPS; i++) {
        const len = adapter.getText(doc).length;
        // Automerge returns new doc on change
        const result = adapter.insert(doc, len, "x");
        if (result !== undefined) doc = result;
      }
      return doc;
    });
  }
});

group("insert-at-start", () => {
  for (const adapter of adapters) {
    bench(adapter.name, () => {
      let doc = adapter.create();
      for (let i = 0; i < SEQUENTIAL_OPS; i++) {
        const result = adapter.insert(doc, 0, "x");
        if (result !== undefined) doc = result;
      }
      return doc;
    });
  }
});

group("insert-at-middle", () => {
  for (const adapter of adapters) {
    bench(adapter.name, () => {
      let doc = adapter.create();
      for (let i = 0; i < SEQUENTIAL_OPS; i++) {
        const len = adapter.getText(doc).length;
        const mid = Math.floor(len / 2);
        const result = adapter.insert(doc, mid, "x");
        if (result !== undefined) doc = result;
      }
      return doc;
    });
  }
});

// --- Sequential Deletions ---
group("delete-from-end", () => {
  for (const adapter of adapters) {
    bench(adapter.name, () => {
      let doc = adapter.fromString("x".repeat(SEQUENTIAL_OPS));
      for (let i = 0; i < SEQUENTIAL_OPS; i++) {
        const len = adapter.getText(doc).length;
        if (len > 0) {
          const result = adapter.delete(doc, len - 1, 1);
          if (result !== undefined) doc = result;
        }
      }
      return doc;
    });
  }
});

group("delete-from-start", () => {
  for (const adapter of adapters) {
    bench(adapter.name, () => {
      let doc = adapter.fromString("x".repeat(SEQUENTIAL_OPS));
      for (let i = 0; i < SEQUENTIAL_OPS; i++) {
        const len = adapter.getText(doc).length;
        if (len > 0) {
          const result = adapter.delete(doc, 0, 1);
          if (result !== undefined) doc = result;
        }
      }
      return doc;
    });
  }
});

// --- Serialization ---
group("serialize-small", () => {
  for (const adapter of adapters) {
    const doc = adapter.fromString(SMALL_TEXT);
    bench(adapter.name, () => {
      return adapter.serialize(doc);
    });
  }
});

group("serialize-medium", () => {
  for (const adapter of adapters) {
    const doc = adapter.fromString(MEDIUM_TEXT);
    bench(adapter.name, () => {
      return adapter.serialize(doc);
    });
  }
});

group("deserialize-small", () => {
  for (const adapter of adapters) {
    const doc = adapter.fromString(SMALL_TEXT);
    const serialized = adapter.serialize(doc);
    bench(adapter.name, () => {
      return adapter.deserialize(serialized);
    });
  }
});

// --- Editing Trace (if available) ---
const editingTrace = await loadEditingTrace();

if (editingTrace) {
  console.log(`\nLoaded editing trace: ${editingTrace.operations.length} operations\n`);

  // Limit operations for reasonable benchmark time
  const MAX_TRACE_OPS = 10000;
  const traceOps = editingTrace.operations.slice(0, MAX_TRACE_OPS);

  group("editing-trace-replay", () => {
    for (const adapter of adapters) {
      bench(`${adapter.name} (${MAX_TRACE_OPS} ops)`, () => {
        let doc = adapter.create();
        for (const op of traceOps) {
          if (op.deleteCount > 0) {
            const result = adapter.delete(doc, op.position, op.deleteCount);
            if (result !== undefined) doc = result;
          }
          if (op.insertText) {
            const result = adapter.insert(doc, op.position, op.insertText);
            if (result !== undefined) doc = result;
          }
        }
        return doc;
      });
    }
  });
} else {
  console.log("\nSkipping editing trace benchmark (run `bun run fixtures:download` first)\n");
}

// --- Run all benchmarks ---
await run({
  format: isCI ? "json" : "mitata",
});
