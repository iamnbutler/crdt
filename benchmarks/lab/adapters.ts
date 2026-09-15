export interface Editor {
  readonly length: number;
  insert(position: number, text: string): void;
  delete(position: number, count: number): void;
  text(): string;
  batch(edit: () => void): void;
  encode(): Uint8Array;
  merge(bytes: Uint8Array): void;
  dispose(): void;
}

export interface Adapter {
  readonly name: string;
  readonly version: string;
  create(): Editor;
  decode(bytes: Uint8Array): Editor;
}

async function installedVersion(name: string): Promise<string> {
  const value: unknown = await Bun.file(
    new URL(`../../node_modules/${name}/package.json`, import.meta.url),
  ).json();
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    typeof value.version !== "string"
  ) {
    throw new Error(`Missing version for ${name}`);
  }
  return value.version;
}

export async function adapter(name: string): Promise<Adapter> {
  if (name === "run") {
    const { RunText } = await import("../../src/run/index.js");
    const wrap = (doc: InstanceType<typeof RunText>): Editor => ({
      get length() {
        return doc.length;
      },
      insert: (position, text) => {
        doc.insert(position, text);
      },
      delete: (position, count) => {
        doc.delete(position, count);
      },
      text: () => doc.getText(),
      batch: (edit) => edit(),
      encode: () => doc.encode(),
      merge: (bytes) => doc.merge(bytes),
      dispose: () => undefined,
    });
    return {
      name: "RunText",
      version: "0.1.0-experimental",
      create: () => wrap(new RunText()),
      decode: (bytes) => wrap(RunText.decode(bytes)),
    };
  }
  if (name === "yjs") {
    const Y = await import("yjs");
    const wrap = (doc: InstanceType<typeof Y.Doc>): Editor => {
      const text = doc.getText("text");
      return {
        get length() {
          return text.length;
        },
        insert: (position, value) => text.insert(position, value),
        delete: (position, count) => text.delete(position, count),
        text: () => text.toString(),
        batch: (edit) => doc.transact(edit),
        encode: () => Y.encodeStateAsUpdateV2(doc),
        merge: (bytes) => Y.applyUpdateV2(doc, bytes),
        dispose: () => doc.destroy(),
      };
    };
    return {
      name: "Yjs",
      version: await installedVersion("yjs"),
      create: () => wrap(new Y.Doc()),
      decode: (bytes) => {
        const doc = wrap(new Y.Doc());
        doc.merge(bytes);
        return doc;
      },
    };
  }
  if (name === "loro") {
    const { LoroDoc } = await import("loro-crdt");
    const wrap = (doc: InstanceType<typeof LoroDoc>): Editor => {
      const text = doc.getText("text");
      let batching = false;
      return {
        get length() {
          return text.length;
        },
        insert: (position, value) => {
          text.insert(position, value);
          if (!batching) doc.commit();
        },
        delete: (position, count) => {
          text.delete(position, count);
          if (!batching) doc.commit();
        },
        text: () => text.toString(),
        batch: (edit) => {
          batching = true;
          try {
            edit();
          } finally {
            batching = false;
            doc.commit();
          }
        },
        encode: () => doc.export({ mode: "snapshot" }),
        merge: (bytes) => {
          doc.import(bytes);
        },
        dispose: () => doc.free(),
      };
    };
    return {
      name: "Loro",
      version: await installedVersion("loro-crdt"),
      create: () => wrap(new LoroDoc()),
      decode: (bytes) => {
        const doc = wrap(new LoroDoc());
        doc.merge(bytes);
        return doc;
      },
    };
  }
  if (name === "automerge") {
    const A = await import("@automerge/automerge");
    interface Content {
      text: string;
    }
    const wrap = (initial: import("@automerge/automerge").Doc<Content>): Editor => {
      let doc = initial;
      let draft: Content | null = null;
      const splice = (position: number, count: number, text: string): void => {
        if (draft !== null) A.splice(draft, ["text"], position, count, text);
        else
          doc = A.change(doc, (d) => {
            A.splice(d, ["text"], position, count, text);
          });
      };
      return {
        get length() {
          return (draft ?? doc).text.length;
        },
        insert: (position, text) => splice(position, 0, text),
        delete: (position, count) => splice(position, count, ""),
        text: () => doc.text,
        batch: (edit) => {
          doc = A.change(doc, (d) => {
            draft = d;
            try {
              edit();
            } finally {
              draft = null;
            }
          });
        },
        encode: () => A.save(doc),
        merge: (bytes) => {
          const peer = A.load<Content>(bytes);
          doc = A.merge(doc, peer);
          A.free(peer);
        },
        dispose: () => A.free(doc),
      };
    };
    return {
      name: "Automerge",
      version: await installedVersion("@automerge/automerge"),
      create: () => wrap(A.from({ text: "" })),
      decode: (bytes) => wrap(A.load<Content>(bytes)),
    };
  }
  if (name === "legacy") {
    const { TextBuffer } = await import("../../src/text/index.js");
    const wrap = (doc: ReturnType<typeof TextBuffer.create>): Editor => ({
      get length() {
        return doc.length;
      },
      insert: (position, text) => {
        doc.insert(position, text);
      },
      delete: (position, count) => {
        doc.delete(position, position + count);
      },
      text: () => doc.getText(),
      batch: (edit) => edit(),
      encode: () => doc.serialize(),
      merge: () => {
        throw new Error("Original snapshot merge is not supported by this adapter");
      },
      dispose: () => undefined,
    });
    return {
      name: "Original",
      version: "9ffb0f3",
      create: () => wrap(TextBuffer.create()),
      decode: (bytes) => wrap(TextBuffer.deserialize(bytes)),
    };
  }
  throw new Error(`Unknown adapter ${name}`);
}
