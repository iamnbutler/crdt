/**
 * Core CRDT types for the text buffer.
 *
 * These types define the fundamental data structures used by the CRDT text engine:
 * Locators for ordering, Fragments as atomic text units, OperationIds for identity,
 * VersionVectors for causality tracking, and Operations for collaboration.
 */

import type { Summarizable } from "../sum-tree/index.js";

// ---------------------------------------------------------------------------
// Branded types
// ---------------------------------------------------------------------------

/** Unique identifier for a replica/site in the CRDT system. */
export type ReplicaId = number & { readonly __brand: "ReplicaId" };

/** Unique identifier for a transaction (group of operations). */
export type TransactionId = number & { readonly __brand: "TransactionId" };

/** Create a ReplicaId from a plain number. */
export function replicaId(n: number): ReplicaId {
  // biome-ignore lint/suspicious/noExplicitAny: expect: branded type construction requires cast
  return n as any;
}

/** Create a TransactionId from a plain number. */
export function transactionId(n: number): TransactionId {
  // biome-ignore lint/suspicious/noExplicitAny: expect: branded type construction requires cast
  return n as any;
}

// ---------------------------------------------------------------------------
// OperationId
// ---------------------------------------------------------------------------

/** Unique identifier for an operation. (replicaId, counter) is globally unique. */
export interface OperationId {
  readonly replicaId: ReplicaId;
  readonly counter: number;
}

/** Compare two OperationIds. Returns <0, 0, or >0. */
export function compareOperationIds(a: OperationId, b: OperationId): number {
  if (a.replicaId !== b.replicaId) {
    return a.replicaId - b.replicaId;
  }
  return a.counter - b.counter;
}

/** Check if two OperationIds are equal. */
export function operationIdsEqual(a: OperationId, b: OperationId): boolean {
  return a.replicaId === b.replicaId && a.counter === b.counter;
}

/** The "zero" OperationId, used as a sentinel for the start of the document. */
export const MIN_OPERATION_ID: OperationId = {
  replicaId: replicaId(0),
  counter: 0,
};

/** The "max" OperationId, used as a sentinel for the end of the document. */
export const MAX_OPERATION_ID: OperationId = {
  replicaId: replicaId(0xffffffff),
  counter: 0xffffffff,
};

// ---------------------------------------------------------------------------
// Locator
// ---------------------------------------------------------------------------

/**
 * A Locator is a variable-length position identifier that determines fragment
 * ordering in the document. Locators are compared lexicographically.
 *
 * Each level is a JS `number` (53-bit integer precision). The first element
 * uses a >> 37 shift to leave room for sequential insertions.
 */
export interface Locator {
  readonly levels: ReadonlyArray<number>;
}

// ---------------------------------------------------------------------------
// VersionVector
// ---------------------------------------------------------------------------

/** Tracks the highest counter seen per replica. */
export type VersionVector = Map<ReplicaId, number>;

// ---------------------------------------------------------------------------
// Fragment
// ---------------------------------------------------------------------------

/**
 * A Fragment is the atomic unit of text in the CRDT.
 *
 * Fragments are stored in a SumTree ordered by Locator. The visible document
 * text is the concatenation of all fragments where `visible === true`.
 */
export interface Fragment extends Summarizable<FragmentSummary> {
  readonly insertionId: OperationId;
  readonly insertionOffset: number;
  readonly locator: Locator;
  /**
   * The Locator from the original InsertOperation that created this text.
   * Used to compute deterministic Locators when splitting: a fragment at
   * insertion offset k always gets Locator [...baseLocator, 2*k] regardless
   * of split history.
   */
  readonly baseLocator: Locator;
  readonly length: number;
  readonly visible: boolean;
  readonly deletions: ReadonlyArray<OperationId>;
  /** The actual text content of this fragment. */
  readonly text: string;
}

// ---------------------------------------------------------------------------
// FragmentSummary
// ---------------------------------------------------------------------------

/**
 * Summary for a subtree of fragments. Tracks both visible and deleted
 * text metrics for efficient seeking.
 */
export interface FragmentSummary {
  readonly visibleLen: number;
  readonly visibleLines: number;
  readonly deletedLen: number;
  readonly deletedLines: number;
  readonly maxInsertionId: OperationId;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export interface InsertionRef {
  readonly insertionId: OperationId;
  readonly offset: number;
}

export interface InsertOperation {
  readonly type: "insert";
  readonly id: OperationId;
  readonly text: string;
  readonly after: InsertionRef;
  readonly before: InsertionRef;
  readonly version: VersionVector;
  readonly locator: Locator;
}

export interface DeleteRange {
  readonly insertionId: OperationId;
  readonly offset: number;
  readonly length: number;
}

export interface DeleteOperation {
  readonly type: "delete";
  readonly id: OperationId;
  readonly ranges: ReadonlyArray<DeleteRange>;
  readonly version: VersionVector;
}

export interface UndoOperation {
  readonly type: "undo";
  readonly id: OperationId;
  readonly transactionId: TransactionId;
  readonly counts: ReadonlyArray<{ operationId: OperationId; count: number }>;
  readonly version: VersionVector;
}

export type Operation = InsertOperation | DeleteOperation | UndoOperation;
