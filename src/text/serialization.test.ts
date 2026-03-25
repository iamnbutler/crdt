/**
 * Tests for CRDT serialization.
 *
 * These tests verify that serialization and deserialization preserve
 * all CRDT state correctly, including:
 * - Text content
 * - Fragment structure (insertionIds, locators, visibility)
 * - Undo/redo state
 * - Version vectors
 * - Applied operations set
 */

import { describe, expect, it } from "bun:test";
import {
  SERIALIZATION_VERSION,
  decodeBinary,
  deserializeLocator,
  deserializeOperationId,
  deserializeVersionVector,
  serializeLocator,
  serializeOperationId,
  serializeVersionVector,
} from "./serialization.js";
import { TextBuffer } from "./text-buffer.js";
import { replicaId } from "./types.js";

describe("serialization", () => {
  describe("helper functions", () => {
    it("serializes and deserializes OperationId", () => {
      const opId = { replicaId: replicaId(123), counter: 456 };
      const serialized = serializeOperationId(opId);
      const deserialized = deserializeOperationId(serialized);

      expect(deserialized.replicaId).toBe(replicaId(123));
      expect(deserialized.counter).toBe(456);
    });

    it("serializes and deserializes Locator", () => {
      const locator = { levels: [1.5, 2.5, 3.5] };
      const serialized = serializeLocator(locator);
      const deserialized = deserializeLocator(serialized);

      expect(deserialized.levels).toEqual([1.5, 2.5, 3.5]);
    });

    it("serializes and deserializes VersionVector", () => {
      const vv = new Map<number, number>();
      vv.set(replicaId(1), 10);
      vv.set(replicaId(2), 20);
      vv.set(replicaId(3), 30);

      const serialized = serializeVersionVector(
        vv as Map<typeof replicaId extends (n: number) => infer R ? R : never, number>,
      );
      const deserialized = deserializeVersionVector(serialized);

      expect(deserialized.get(replicaId(1))).toBe(10);
      expect(deserialized.get(replicaId(2))).toBe(20);
      expect(deserialized.get(replicaId(3))).toBe(30);
    });
  });

  describe("TextBuffer binary serialization", () => {
    it("serializes and deserializes empty buffer", () => {
      const original = TextBuffer.create(replicaId(42));
      const serialized = original.serialize();
      const restored = TextBuffer.deserialize(serialized);

      expect(restored.getText()).toBe("");
      expect(restored.replicaId).toBe(replicaId(42));
    });

    it("serializes and deserializes buffer with text", () => {
      const original = TextBuffer.fromString("Hello, world!", replicaId(100));
      const serialized = original.serialize();
      const restored = TextBuffer.deserialize(serialized);

      expect(restored.getText()).toBe("Hello, world!");
      expect(restored.replicaId).toBe(replicaId(100));
    });

    it("preserves text after insertions", () => {
      const original = TextBuffer.fromString("Hello world", replicaId(1));
      original.insert(5, ",");
      original.insert(12, "!");

      const serialized = original.serialize();
      const restored = TextBuffer.deserialize(serialized);

      expect(restored.getText()).toBe("Hello, world!");
    });

    it("preserves text after deletions", () => {
      const original = TextBuffer.fromString("Hello, cruel world!", replicaId(1));
      original.delete(7, 13); // Delete "cruel "

      const serialized = original.serialize();
      const restored = TextBuffer.deserialize(serialized);

      expect(restored.getText()).toBe("Hello, world!");
    });

    it("preserves undo/redo state", () => {
      const original = TextBuffer.create(replicaId(1));
      original.setGroupDelay(0); // Disable grouping for predictable undo
      original.insert(0, "Hello");
      original.insert(5, " world");
      original.undo();

      expect(original.getText()).toBe("Hello");

      const serialized = original.serialize();
      const restored = TextBuffer.deserialize(serialized);

      expect(restored.getText()).toBe("Hello");

      // Should be able to redo
      restored.redo();
      expect(restored.getText()).toBe("Hello world");

      // Should be able to undo again
      restored.undo();
      expect(restored.getText()).toBe("Hello");
    });

    it("preserves version vector", () => {
      const original = TextBuffer.fromString("test", replicaId(42));
      original.insert(4, "!");

      const serialized = original.serialize();
      const restored = TextBuffer.deserialize(serialized);

      // Version should include operations from replica 42
      expect(restored.version.get(replicaId(42))).toBeDefined();
    });

    it("handles large documents", () => {
      const text = "x".repeat(10000);
      const original = TextBuffer.fromString(text, replicaId(1));

      const serialized = original.serialize();
      const restored = TextBuffer.deserialize(serialized);

      expect(restored.getText()).toBe(text);
      expect(restored.length).toBe(10000);
    });

    it("handles unicode text", () => {
      const original = TextBuffer.fromString("Hello 世界 🌍!", replicaId(1));

      const serialized = original.serialize();
      const restored = TextBuffer.deserialize(serialized);

      expect(restored.getText()).toBe("Hello 世界 🌍!");
    });

    it("handles newlines", () => {
      const original = TextBuffer.fromString("line1\nline2\nline3", replicaId(1));

      const serialized = original.serialize();
      const restored = TextBuffer.deserialize(serialized);

      expect(restored.getText()).toBe("line1\nline2\nline3");
    });

    it("preserves deleted fragments (tombstones)", () => {
      const original = TextBuffer.fromString("Hello world", replicaId(1));

      // Use explicit transaction to ensure delete is on undo stack before serialization
      original.startTransaction();
      original.delete(5, 11); // Delete " world"
      original.endTransaction();

      expect(original.getText()).toBe("Hello");

      const serialized = original.serialize();
      const restored = TextBuffer.deserialize(serialized);

      expect(restored.getText()).toBe("Hello");

      // The deleted fragments should still exist as tombstones
      // This is verified by undo working correctly
      original.undo();
      expect(original.getText()).toBe("Hello world");

      // The restored buffer should have the undo stack preserved
      restored.undo();
      expect(restored.getText()).toBe("Hello world");
    });
  });

  describe("TextBuffer JSON serialization", () => {
    it("serializes and deserializes buffer with text", () => {
      const original = TextBuffer.fromString("Hello, JSON!", replicaId(200));
      const json = original.serializeJSON();
      const restored = TextBuffer.deserializeJSON(json);

      expect(restored.getText()).toBe("Hello, JSON!");
      expect(restored.replicaId).toBe(replicaId(200));
    });

    it("produces valid JSON", () => {
      const original = TextBuffer.fromString("Test", replicaId(1));
      const json = original.serializeJSON();

      // Should parse without error
      const parsed = JSON.parse(json);
      expect(parsed.version).toBe(SERIALIZATION_VERSION);
      expect(parsed.fragments).toBeDefined();
      expect(Array.isArray(parsed.fragments)).toBe(true);
    });

    it("preserves all state like binary serialization", () => {
      const original = TextBuffer.create(replicaId(1));
      original.setGroupDelay(0);
      original.insert(0, "Hello");
      original.insert(5, " world");
      original.undo();

      const json = original.serializeJSON();
      const restored = TextBuffer.deserializeJSON(json);

      expect(restored.getText()).toBe("Hello");
      restored.redo();
      expect(restored.getText()).toBe("Hello world");
    });
  });

  describe("binary format", () => {
    it("has correct magic bytes", () => {
      const buffer = TextBuffer.fromString("test", replicaId(1));
      const serialized = buffer.serialize();

      // Check magic bytes "CRDT"
      expect(serialized[0]).toBe(0x43); // 'C'
      expect(serialized[1]).toBe(0x52); // 'R'
      expect(serialized[2]).toBe(0x44); // 'D'
      expect(serialized[3]).toBe(0x54); // 'T'
    });

    it("includes version number", () => {
      const buffer = TextBuffer.fromString("test", replicaId(1));
      const serialized = buffer.serialize();

      // Version is at bytes 4-7 (little endian uint32)
      const view = new DataView(serialized.buffer);
      const version = view.getUint32(4, true);
      expect(version).toBe(SERIALIZATION_VERSION);
    });

    it("rejects invalid magic bytes", () => {
      const invalidData = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);

      expect(() => decodeBinary(invalidData)).toThrow("Invalid CRDT binary format");
    });

    it("rejects unsupported version", () => {
      // Create valid header with wrong version
      const data = new Uint8Array(16);
      data[0] = 0x43; // 'C'
      data[1] = 0x52; // 'R'
      data[2] = 0x44; // 'D'
      data[3] = 0x54; // 'T'
      // Set version to 999
      const view = new DataView(data.buffer);
      view.setUint32(4, 999, true);

      expect(() => decodeBinary(data)).toThrow("Unsupported serialization version");
    });
  });

  describe("snapshot integrity", () => {
    it("toSerializedSnapshot includes all fields", () => {
      const buffer = TextBuffer.fromString("test", replicaId(42));
      buffer.insert(4, "!");
      const snapshot = buffer.toSerializedSnapshot();

      expect(snapshot.version).toBe(SERIALIZATION_VERSION);
      expect(snapshot.replicaId).toBe(42);
      expect(snapshot.clockCounter).toBeGreaterThan(0);
      expect(snapshot.versionVector.length).toBeGreaterThan(0);
      expect(snapshot.fragments.length).toBeGreaterThan(0);
      expect(Array.isArray(snapshot.undoMap)).toBe(true);
      expect(Array.isArray(snapshot.undoStack)).toBe(true);
      expect(Array.isArray(snapshot.redoStack)).toBe(true);
      expect(Array.isArray(snapshot.appliedOps)).toBe(true);
      expect(typeof snapshot.nextTransactionId).toBe("number");
      expect(typeof snapshot.groupDelay).toBe("number");
    });

    it("fragment serialization includes all fields", () => {
      const buffer = TextBuffer.fromString("test", replicaId(1));
      const snapshot = buffer.toSerializedSnapshot();
      const frag = snapshot.fragments[0];

      expect(frag).toBeDefined();
      if (frag) {
        expect(frag.id).toBeDefined();
        expect(frag.id.r).toBeDefined();
        expect(frag.id.c).toBeDefined();
        expect(typeof frag.io).toBe("number");
        expect(frag.loc).toBeDefined();
        expect(Array.isArray(frag.loc.l)).toBe(true);
        expect(frag.base).toBeDefined();
        expect(Array.isArray(frag.base.l)).toBe(true);
        expect(typeof frag.t).toBe("string");
        expect(typeof frag.v).toBe("boolean");
        expect(Array.isArray(frag.del)).toBe(true);
      }
    });
  });

  describe("round-trip consistency", () => {
    it("binary round-trip preserves exact state", () => {
      const original = TextBuffer.create(replicaId(1));
      original.setGroupDelay(0);
      original.insert(0, "Hello");
      original.insert(5, " world");
      original.delete(0, 5);
      original.undo();

      const binary = original.serialize();
      const restored1 = TextBuffer.deserialize(binary);
      const binary2 = restored1.serialize();
      const restored2 = TextBuffer.deserialize(binary2);

      expect(restored2.getText()).toBe(original.getText());
      expect(restored2.replicaId).toBe(original.replicaId);
    });

    it("JSON round-trip preserves exact state", () => {
      const original = TextBuffer.create(replicaId(1));
      original.setGroupDelay(0);
      original.insert(0, "Hello");
      original.insert(5, " world");
      original.delete(0, 5);
      original.undo();

      const json = original.serializeJSON();
      const restored1 = TextBuffer.deserializeJSON(json);
      const json2 = restored1.serializeJSON();
      const restored2 = TextBuffer.deserializeJSON(json2);

      expect(restored2.getText()).toBe(original.getText());
      expect(restored2.replicaId).toBe(original.replicaId);
    });

    it("binary and JSON produce equivalent results", () => {
      const original = TextBuffer.fromString("Test content", replicaId(42));
      original.insert(12, " here");

      const fromBinary = TextBuffer.deserialize(original.serialize());
      const fromJSON = TextBuffer.deserializeJSON(original.serializeJSON());

      expect(fromBinary.getText()).toBe(fromJSON.getText());
      expect(fromBinary.replicaId).toBe(fromJSON.replicaId);
    });
  });

  describe("editing after deserialization", () => {
    it("can insert text after deserialization", () => {
      const original = TextBuffer.fromString("Hello", replicaId(1));
      const restored = TextBuffer.deserialize(original.serialize());

      restored.insert(5, " world!");
      expect(restored.getText()).toBe("Hello world!");
    });

    it("can delete text after deserialization", () => {
      const original = TextBuffer.fromString("Hello world!", replicaId(1));
      const restored = TextBuffer.deserialize(original.serialize());

      restored.delete(5, 11);
      expect(restored.getText()).toBe("Hello!");
    });

    it("can undo/redo after deserialization", () => {
      const original = TextBuffer.fromString("Hello", replicaId(1));
      original.setGroupDelay(0);

      const restored = TextBuffer.deserialize(original.serialize());
      restored.setGroupDelay(0);

      restored.insert(5, " world");
      expect(restored.getText()).toBe("Hello world");

      restored.undo();
      expect(restored.getText()).toBe("Hello");

      restored.redo();
      expect(restored.getText()).toBe("Hello world");
    });

    it("generates valid operations after deserialization", () => {
      const original = TextBuffer.fromString("Test", replicaId(1));
      const restored = TextBuffer.deserialize(original.serialize());

      const op = restored.insert(4, "!");
      expect(op.type).toBe("insert");
      expect(op.id.replicaId).toBe(replicaId(1));
      // Counter should continue from where we left off
      expect(op.id.counter).toBeGreaterThan(0);
    });
  });
});
