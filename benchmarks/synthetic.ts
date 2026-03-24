export type DocumentSize = "tiny" | "small" | "medium" | "large" | "huge" | "extreme";

interface SizeConfig {
  lines: number;
  avgCharsPerLine: number;
}

const SIZE_CONFIGS: Record<DocumentSize, SizeConfig> = {
  tiny: { lines: 100, avgCharsPerLine: 80 },
  small: { lines: 1_000, avgCharsPerLine: 80 },
  medium: { lines: 10_000, avgCharsPerLine: 80 },
  large: { lines: 100_000, avgCharsPerLine: 80 },
  huge: { lines: 1_000_000, avgCharsPerLine: 80 },
  extreme: { lines: 10_000_000, avgCharsPerLine: 80 },
};

const SAMPLE_WORDS = [
  "const",
  "let",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "class",
  "export",
  "import",
  "from",
  "async",
  "await",
  "new",
  "this",
  "true",
  "false",
  "null",
  "undefined",
];

function generateLine(targetLength: number): string {
  const parts: string[] = [];
  let length = 0;

  while (length < targetLength) {
    const word = SAMPLE_WORDS[Math.floor(Math.random() * SAMPLE_WORDS.length)];
    if (word === undefined) continue;
    parts.push(word);
    length += word.length + 1;
  }

  return parts.join(" ").slice(0, targetLength);
}

export function generateSyntheticDocument(size: DocumentSize): string {
  const config = SIZE_CONFIGS[size];
  const lines: string[] = [];

  for (let i = 0; i < config.lines; i++) {
    const variance = Math.random() * 0.4 - 0.2;
    const lineLength = Math.floor(config.avgCharsPerLine * (1 + variance));
    lines.push(generateLine(lineLength));
  }

  return lines.join("\n");
}

export function getSizeConfig(size: DocumentSize): SizeConfig {
  return SIZE_CONFIGS[size];
}
