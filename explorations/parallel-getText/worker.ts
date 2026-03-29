// Worker script for parallel getText() prototype
// Receives a chunk of fragment data and returns the visible text

declare const self: Worker;

self.onmessage = (event: MessageEvent) => {
  const fragments: Array<{ text: string; visible: boolean }> = event.data;
  const parts: string[] = [];
  for (const frag of fragments) {
    if (frag.visible) {
      parts.push(frag.text);
    }
  }
  self.postMessage(parts.join(""));
};
