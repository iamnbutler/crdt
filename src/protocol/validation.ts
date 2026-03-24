import type {
  DeleteOperation,
  DeleteRange,
  InsertOperation,
  Operation,
  OperationId,
  ReplicaId,
  UndoOperation,
  VersionVector,
} from "../text/types.js";
import { ValidationError, type ValidationResult } from "./types.js";

// ---------------------------------------------------------------------------
// Validation Context
// ---------------------------------------------------------------------------

/**
 * Context for validating operations.
 */
export interface ValidationContext {
  /** Expected sender replica ID (if known). */
  readonly expectedSender?: ReplicaId;
  /** Highest counter seen per replica. */
  readonly replicaCounters: ReadonlyMap<ReplicaId, number>;
  /** Local version vector. */
  readonly localVersion: VersionVector;
  /** Check if a fragment with the given insertion ID exists. */
  readonly fragmentExists: (insertionId: OperationId) => boolean;
}

// ---------------------------------------------------------------------------
// Validation Functions
// ---------------------------------------------------------------------------

/**
 * Create a successful validation result.
 */
function valid(): ValidationResult {
  return { valid: true, error: ValidationError.None };
}

/**
 * Create a failed validation result.
 */
function invalid(error: ValidationError, message: string): ValidationResult {
  return { valid: false, error, message };
}

/**
 * Validate an operation.
 */
export function validateOperation(
  operation: Operation,
  context: ValidationContext,
): ValidationResult {
  // Check replica ID matches expected sender
  if (context.expectedSender !== undefined) {
    if (operation.id.replicaId !== context.expectedSender) {
      return invalid(
        ValidationError.InvalidReplicaId,
        `Expected replica ${context.expectedSender}, got ${operation.id.replicaId}`,
      );
    }
  }

  // Check counter is sequential
  const lastCounter = context.replicaCounters.get(operation.id.replicaId);
  if (lastCounter !== undefined) {
    // Allow duplicate (idempotency) or next counter
    if (operation.id.counter !== lastCounter + 1 && operation.id.counter <= lastCounter) {
      // If counter is less than or equal, it might be a duplicate (which is OK)
      // Only reject if it's a gap
      if (operation.id.counter > lastCounter + 1) {
        return invalid(
          ValidationError.NonSequentialCounter,
          `Expected counter ${lastCounter + 1} for replica ${operation.id.replicaId}, got ${operation.id.counter}`,
        );
      }
    }
  }

  // Check version vector consistency:
  // The operation's version should include all operations the sender had seen
  // when they created this operation, including their own previous operations.
  const senderVersion = operation.version.get(operation.id.replicaId);
  if (senderVersion !== undefined && senderVersion < operation.id.counter) {
    // The operation claims to have a counter higher than what's in its own version vector
    // This is inconsistent
    return invalid(
      ValidationError.InconsistentVersion,
      `Operation counter ${operation.id.counter} exceeds version vector entry ${senderVersion} for replica ${operation.id.replicaId}`,
    );
  }

  // Type-specific validation
  switch (operation.type) {
    case "insert":
      return validateInsert(operation, context);
    case "delete":
      return validateDelete(operation, context);
    case "undo":
      return validateUndo(operation, context);
  }
}

/**
 * Validate an insert operation.
 */
function validateInsert(operation: InsertOperation, context: ValidationContext): ValidationResult {
  // Empty inserts are valid (they're no-ops)
  // Non-empty inserts should have text
  // (We don't enforce this strictly since empty text might be intentional)

  // Check that referenced fragments exist or are sentinels
  const MIN_REPLICA = 0;
  const MAX_REPLICA = 0xffffffff;

  // Check after reference
  if (
    !(
      operation.after.insertionId.replicaId === MIN_REPLICA &&
      operation.after.insertionId.counter === 0
    )
  ) {
    // Not a sentinel, should exist
    if (!context.fragmentExists(operation.after.insertionId)) {
      return invalid(
        ValidationError.UnknownReference,
        `Insert references unknown after fragment: replica=${operation.after.insertionId.replicaId}, counter=${operation.after.insertionId.counter}`,
      );
    }
  }

  // Check before reference
  if (
    !(
      operation.before.insertionId.replicaId === MAX_REPLICA &&
      operation.before.insertionId.counter === 0xffffffff
    )
  ) {
    // Not a sentinel, should exist
    if (!context.fragmentExists(operation.before.insertionId)) {
      return invalid(
        ValidationError.UnknownReference,
        `Insert references unknown before fragment: replica=${operation.before.insertionId.replicaId}, counter=${operation.before.insertionId.counter}`,
      );
    }
  }

  return valid();
}

/**
 * Validate a delete operation.
 */
function validateDelete(operation: DeleteOperation, context: ValidationContext): ValidationResult {
  // Each range should reference an existing fragment
  for (let i = 0; i < operation.ranges.length; i++) {
    const range = operation.ranges[i] as DeleteRange;

    if (!context.fragmentExists(range.insertionId)) {
      return invalid(
        ValidationError.UnknownReference,
        `Delete range ${i} references unknown fragment: replica=${range.insertionId.replicaId}, counter=${range.insertionId.counter}`,
      );
    }

    // Length should be positive
    if (range.length <= 0) {
      return invalid(
        ValidationError.InvalidDeleteRange,
        `Delete range ${i} has non-positive length: ${range.length}`,
      );
    }
  }

  return valid();
}

/**
 * Validate an undo operation.
 */
function validateUndo(operation: UndoOperation, _context: ValidationContext): ValidationResult {
  // Undo operations are generally always valid
  // The undo counts will merge via max-wins semantics
  // We don't strictly validate that the transaction existed

  // Basic sanity: counts should be non-negative
  for (const entry of operation.counts) {
    if (entry.count < 0) {
      return invalid(
        ValidationError.InconsistentVersion,
        `Undo count for operation ${entry.operationId.replicaId}:${entry.operationId.counter} is negative: ${entry.count}`,
      );
    }
  }

  return valid();
}

/**
 * Validate that an operation's version vector is causally ready.
 * Returns true if all operations in the version vector have been seen locally.
 */
export function isCausallyReady(operation: Operation, localVersion: VersionVector): boolean {
  // For each entry in the operation's version vector (excluding its own),
  // check that we've seen at least that counter
  for (const [rid, counter] of operation.version) {
    // Skip the operation's own replica (we're receiving this operation now)
    if (rid === operation.id.replicaId) {
      continue;
    }

    const localCounter = localVersion.get(rid);
    if (localCounter === undefined || localCounter < counter) {
      return false;
    }
  }

  return true;
}

/**
 * Strict validation that checks both structural validity and causal readiness.
 */
export function validateOperationStrict(
  operation: Operation,
  context: ValidationContext,
): ValidationResult {
  // First, basic structural validation
  const basic = validateOperation(operation, context);
  if (!basic.valid) {
    return basic;
  }

  // Then, causal readiness (optional - can be deferred)
  if (!isCausallyReady(operation, context.localVersion)) {
    return invalid(
      ValidationError.InconsistentVersion,
      "Operation's version vector indicates missing causal dependencies",
    );
  }

  return valid();
}
