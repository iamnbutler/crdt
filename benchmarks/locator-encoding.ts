/**
 * Locator Encoding Benchmark
 *
 * Tests different strategies for encoding Locators to speed up comparisons:
 * 1. Current: Object with levels array
 * 2. Float64: Pack into single number (limited precision)
 * 3. BigInt: Pack all levels into single BigInt
 * 4. TypedArray: Use Float64Array for levels
 * 5. Tuple: Use fixed-size array [l0, l1, l2, l3] with sentinel values
 */

import { bench, group, run } from "mitata";

// ---------------------------------------------------------------------------
// Current Implementation (baseline)
// ---------------------------------------------------------------------------

interface Locator {
  readonly levels: ReadonlyArray<number>;
}

function compareLocators(a: Locator, b: Locator): number {
  const minLen = Math.min(a.levels.length, b.levels.length);
  for (let i = 0; i < minLen; i++) {
    const aLevel = a.levels[i];
    const bLevel = b.levels[i];
    if (aLevel !== undefined && bLevel !== undefined && aLevel !== bLevel) {
      return aLevel - bLevel;
    }
  }
  return a.levels.length - b.levels.length;
}

// ---------------------------------------------------------------------------
// Strategy 1: Float64 Sort Key
// ---------------------------------------------------------------------------

// Encode Locator as single float64 for fast comparison
// Limited to ~4 levels with reduced precision per level
function locatorToFloat64(loc: Locator): number {
  // Pack up to 4 levels into 52 bits of mantissa
  // 13 bits per level = max value 8191 per level
  const BITS_PER_LEVEL = 13;
  const MAX_LEVEL_VALUE = (1 << BITS_PER_LEVEL) - 1;

  let result = 0;
  for (let i = 0; i < Math.min(loc.levels.length, 4); i++) {
    const level = Math.min(loc.levels[i] ?? 0, MAX_LEVEL_VALUE);
    result = result * (MAX_LEVEL_VALUE + 1) + level;
  }
  // Encode length in remaining bits
  result = result * 16 + loc.levels.length;
  return result;
}

function compareFloat64(a: number, b: number): number {
  return a - b;
}

// ---------------------------------------------------------------------------
// Strategy 2: BigInt Encoding
// ---------------------------------------------------------------------------

// Encode entire Locator as BigInt - unlimited precision
function locatorToBigInt(loc: Locator): bigint {
  // 54 bits per level (slightly more than JS number precision)
  // Plus 4 bits for length prefix
  const BITS_PER_LEVEL = 54n;
  const LEVEL_MASK = (1n << BITS_PER_LEVEL) - 1n;

  let result = BigInt(loc.levels.length);
  for (let i = 0; i < loc.levels.length; i++) {
    result = (result << BITS_PER_LEVEL) | (BigInt(loc.levels[i] ?? 0) & LEVEL_MASK);
  }
  return result;
}

function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Strategy 3: TypedArray Levels
// ---------------------------------------------------------------------------

// Use Float64Array instead of number[] for levels
type TypedLocator = Float64Array;

function createTypedLocator(levels: number[]): TypedLocator {
  const arr = new Float64Array(levels.length);
  for (let i = 0; i < levels.length; i++) {
    arr[i] = levels[i];
  }
  return arr;
}

function compareTypedLocators(a: TypedLocator, b: TypedLocator): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return a.length - b.length;
}

// ---------------------------------------------------------------------------
// Strategy 4: Fixed-Size Tuple with Sentinel
// ---------------------------------------------------------------------------

// Always 4 elements, use -1 as sentinel for "no more levels"
type TupleLocator = [number, number, number, number];
const SENTINEL = -1;

function createTupleLocator(levels: number[]): TupleLocator {
  return [
    levels[0] ?? SENTINEL,
    levels[1] ?? SENTINEL,
    levels[2] ?? SENTINEL,
    levels[3] ?? SENTINEL,
  ];
}

function compareTupleLocators(a: TupleLocator, b: TupleLocator): number {
  // Unrolled comparison - no loop overhead
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  if (a[2] !== b[2]) return a[2] - b[2];
  if (a[3] !== b[3]) return a[3] - b[3];
  return 0;
}

// ---------------------------------------------------------------------------
// Strategy 5: Inline Array (no object wrapper)
// ---------------------------------------------------------------------------

// Just use number[] directly without the { levels: } wrapper
type InlineLocator = number[];

function compareInlineLocators(a: InlineLocator, b: InlineLocator): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return a.length - b.length;
}

// ---------------------------------------------------------------------------
// Strategy 6: Two-Number Encoding (for depth <= 2)
// ---------------------------------------------------------------------------

// Most locators have depth 1-2. Encode as two numbers for common case.
type TwoNumLocator = { n0: number; n1: number; len: number };

function createTwoNumLocator(levels: number[]): TwoNumLocator {
  return {
    n0: levels[0] ?? 0,
    n1: levels[1] ?? 0,
    len: levels.length,
  };
}

function compareTwoNumLocators(a: TwoNumLocator, b: TwoNumLocator): number {
  if (a.n0 !== b.n0) return a.n0 - b.n0;
  if (a.len === 1 && b.len === 1) return 0;
  if (a.len === 1) return -1;
  if (b.len === 1) return 1;
  if (a.n1 !== b.n1) return a.n1 - b.n1;
  return a.len - b.len;
}

// ---------------------------------------------------------------------------
// Test Data Generation
// ---------------------------------------------------------------------------

function generateLocators(count: number, maxDepth: number): Locator[] {
  const locators: Locator[] = [];
  for (let i = 0; i < count; i++) {
    const depth = 1 + Math.floor(Math.random() * maxDepth);
    const levels: number[] = [];
    for (let d = 0; d < depth; d++) {
      // Use realistic values - first level smaller, deeper levels larger
      const maxVal = d === 0 ? 100000 : Number.MAX_SAFE_INTEGER;
      levels.push(Math.floor(Math.random() * maxVal));
    }
    locators.push({ levels });
  }
  return locators;
}

// Generate sequential locators (realistic editing pattern)
function generateSequentialLocators(count: number): Locator[] {
  const locators: Locator[] = [];
  let base = 1000;
  for (let i = 0; i < count; i++) {
    // Mostly depth 1, occasionally depth 2
    if (Math.random() < 0.9) {
      locators.push({ levels: [base++] });
    } else {
      locators.push({ levels: [base, Math.floor(Math.random() * 1000000)] });
    }
  }
  return locators;
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

const LOCATOR_COUNT = 10000;

// Test with random locators (worst case)
const randomLocators = generateLocators(LOCATOR_COUNT, 4);
const randomFloat64s = randomLocators.map(locatorToFloat64);
const randomBigInts = randomLocators.map(locatorToBigInt);
const randomTyped = randomLocators.map(l => createTypedLocator([...l.levels]));
const randomTuples = randomLocators.map(l => createTupleLocator([...l.levels]));
const randomInline = randomLocators.map(l => [...l.levels]);
const randomTwoNum = randomLocators.map(l => createTwoNumLocator([...l.levels]));

// Test with sequential locators (realistic case)
const seqLocators = generateSequentialLocators(LOCATOR_COUNT);
const seqFloat64s = seqLocators.map(locatorToFloat64);
const seqBigInts = seqLocators.map(locatorToBigInt);
const seqTyped = seqLocators.map(l => createTypedLocator([...l.levels]));
const seqTuples = seqLocators.map(l => createTupleLocator([...l.levels]));
const seqInline = seqLocators.map(l => [...l.levels]);
const seqTwoNum = seqLocators.map(l => createTwoNumLocator([...l.levels]));

console.log("Locator Encoding Benchmark\n");
console.log(`Testing ${LOCATOR_COUNT} locators\n`);

// Measure depth distribution
const depthDist = new Map<number, number>();
for (const loc of randomLocators) {
  const d = loc.levels.length;
  depthDist.set(d, (depthDist.get(d) ?? 0) + 1);
}
console.log("Random locator depth distribution:");
for (const [depth, count] of [...depthDist.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  Depth ${depth}: ${count} (${(count / LOCATOR_COUNT * 100).toFixed(1)}%)`);
}

const seqDepthDist = new Map<number, number>();
for (const loc of seqLocators) {
  const d = loc.levels.length;
  seqDepthDist.set(d, (seqDepthDist.get(d) ?? 0) + 1);
}
console.log("\nSequential locator depth distribution:");
for (const [depth, count] of [...seqDepthDist.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  Depth ${depth}: ${count} (${(count / LOCATOR_COUNT * 100).toFixed(1)}%)`);
}
console.log("");

// --- Comparison Benchmarks (Random) ---
group("compare-random-locators", () => {
  bench("Current (object.levels)", () => {
    let sum = 0;
    for (let i = 0; i < LOCATOR_COUNT - 1; i++) {
      sum += compareLocators(randomLocators[i], randomLocators[i + 1]);
    }
    return sum;
  });

  bench("Float64 sort key", () => {
    let sum = 0;
    for (let i = 0; i < LOCATOR_COUNT - 1; i++) {
      sum += compareFloat64(randomFloat64s[i], randomFloat64s[i + 1]);
    }
    return sum;
  });

  bench("BigInt encoding", () => {
    let sum = 0;
    for (let i = 0; i < LOCATOR_COUNT - 1; i++) {
      sum += compareBigInt(randomBigInts[i], randomBigInts[i + 1]);
    }
    return sum;
  });

  bench("TypedArray levels", () => {
    let sum = 0;
    for (let i = 0; i < LOCATOR_COUNT - 1; i++) {
      sum += compareTypedLocators(randomTyped[i], randomTyped[i + 1]);
    }
    return sum;
  });

  bench("Fixed tuple (unrolled)", () => {
    let sum = 0;
    for (let i = 0; i < LOCATOR_COUNT - 1; i++) {
      sum += compareTupleLocators(randomTuples[i], randomTuples[i + 1]);
    }
    return sum;
  });

  bench("Inline array (no wrapper)", () => {
    let sum = 0;
    for (let i = 0; i < LOCATOR_COUNT - 1; i++) {
      sum += compareInlineLocators(randomInline[i], randomInline[i + 1]);
    }
    return sum;
  });

  bench("Two-number (depth <= 2)", () => {
    let sum = 0;
    for (let i = 0; i < LOCATOR_COUNT - 1; i++) {
      sum += compareTwoNumLocators(randomTwoNum[i], randomTwoNum[i + 1]);
    }
    return sum;
  });
});

// --- Comparison Benchmarks (Sequential) ---
group("compare-sequential-locators", () => {
  bench("Current (object.levels)", () => {
    let sum = 0;
    for (let i = 0; i < LOCATOR_COUNT - 1; i++) {
      sum += compareLocators(seqLocators[i], seqLocators[i + 1]);
    }
    return sum;
  });

  bench("Float64 sort key", () => {
    let sum = 0;
    for (let i = 0; i < LOCATOR_COUNT - 1; i++) {
      sum += compareFloat64(seqFloat64s[i], seqFloat64s[i + 1]);
    }
    return sum;
  });

  bench("BigInt encoding", () => {
    let sum = 0;
    for (let i = 0; i < LOCATOR_COUNT - 1; i++) {
      sum += compareBigInt(seqBigInts[i], seqBigInts[i + 1]);
    }
    return sum;
  });

  bench("TypedArray levels", () => {
    let sum = 0;
    for (let i = 0; i < LOCATOR_COUNT - 1; i++) {
      sum += compareTypedLocators(seqTyped[i], seqTyped[i + 1]);
    }
    return sum;
  });

  bench("Fixed tuple (unrolled)", () => {
    let sum = 0;
    for (let i = 0; i < LOCATOR_COUNT - 1; i++) {
      sum += compareTupleLocators(seqTuples[i], seqTuples[i + 1]);
    }
    return sum;
  });

  bench("Inline array (no wrapper)", () => {
    let sum = 0;
    for (let i = 0; i < LOCATOR_COUNT - 1; i++) {
      sum += compareInlineLocators(seqInline[i], seqInline[i + 1]);
    }
    return sum;
  });

  bench("Two-number (depth <= 2)", () => {
    let sum = 0;
    for (let i = 0; i < LOCATOR_COUNT - 1; i++) {
      sum += compareTwoNumLocators(seqTwoNum[i], seqTwoNum[i + 1]);
    }
    return sum;
  });
});

// --- Sorting Benchmarks ---
group("sort-10k-locators", () => {
  bench("Current (object.levels)", () => {
    const copy = [...randomLocators];
    copy.sort(compareLocators);
    return copy;
  });

  bench("Float64 sort key", () => {
    const copy = [...randomFloat64s];
    copy.sort((a, b) => a - b);
    return copy;
  });

  bench("BigInt encoding", () => {
    const copy = [...randomBigInts];
    copy.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return copy;
  });

  bench("Fixed tuple (unrolled)", () => {
    const copy = [...randomTuples];
    copy.sort(compareTupleLocators);
    return copy;
  });

  bench("Inline array (no wrapper)", () => {
    const copy = [...randomInline];
    copy.sort(compareInlineLocators);
    return copy;
  });
});

// --- Encoding Cost Benchmarks ---
group("encoding-cost", () => {
  bench("Create object Locator", () => {
    const locators: Locator[] = [];
    for (let i = 0; i < 1000; i++) {
      locators.push({ levels: [i, i * 2] });
    }
    return locators;
  });

  bench("Create + encode Float64", () => {
    const keys: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const loc: Locator = { levels: [i, i * 2] };
      keys.push(locatorToFloat64(loc));
    }
    return keys;
  });

  bench("Create + encode BigInt", () => {
    const keys: bigint[] = [];
    for (let i = 0; i < 1000; i++) {
      const loc: Locator = { levels: [i, i * 2] };
      keys.push(locatorToBigInt(loc));
    }
    return keys;
  });

  bench("Create tuple directly", () => {
    const tuples: TupleLocator[] = [];
    for (let i = 0; i < 1000; i++) {
      tuples.push([i, i * 2, SENTINEL, SENTINEL]);
    }
    return tuples;
  });

  bench("Create inline array", () => {
    const arrays: number[][] = [];
    for (let i = 0; i < 1000; i++) {
      arrays.push([i, i * 2]);
    }
    return arrays;
  });
});

// --- Memory Layout Test ---
console.log("\n--- Memory Size Estimates ---");
console.log("Object Locator { levels: [n, n] }:  ~64 bytes (object + array + numbers)");
console.log("Float64 sort key:                   8 bytes");
console.log("BigInt (2 levels):                  ~24 bytes");
console.log("TupleLocator [n, n, n, n]:          ~48 bytes (array + 4 numbers)");
console.log("Inline array [n, n]:                ~32 bytes (array + 2 numbers)");
console.log("TwoNumLocator { n0, n1, len }:      ~40 bytes (object + 3 numbers)");
console.log("");

await run();
