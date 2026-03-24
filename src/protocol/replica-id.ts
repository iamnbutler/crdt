/**
 * Replica ID assignment strategies.
 *
 * Provides both server-assigned sequential IDs (recommended for production)
 * and client-generated random IDs (for peer-to-peer or testing).
 */

import { type ReplicaId, replicaId } from "../text/types.js";

// ---------------------------------------------------------------------------
// Sequential ID Assigner (Server-Assigned)
// ---------------------------------------------------------------------------

/**
 * Server-side sequential replica ID assigner.
 *
 * Assigns replica IDs starting from 1, incrementing for each new client.
 * This strategy is recommended for production use because:
 * - Compact IDs (smaller wire size)
 * - Deterministic and debuggable
 * - No collision risk
 * - Easy to track active replicas
 */
export class SequentialReplicaIdAssigner {
  private nextId: number;
  private assignedIds: Map<string, ReplicaId>;
  private activeReplicas: Set<ReplicaId>;

  constructor(startId = 1) {
    this.nextId = startId;
    this.assignedIds = new Map();
    this.activeReplicas = new Set();
  }

  /**
   * Assign a replica ID to a client.
   *
   * @param clientId Unique client identifier (e.g., session token, connection ID)
   * @returns Assigned replica ID
   */
  assign(clientId: string): ReplicaId {
    // Check if client already has an ID
    const existing = this.assignedIds.get(clientId);
    if (existing !== undefined) {
      this.activeReplicas.add(existing);
      return existing;
    }

    // Assign new ID
    const id = replicaId(this.nextId++);
    this.assignedIds.set(clientId, id);
    this.activeReplicas.add(id);
    return id;
  }

  /**
   * Release a replica ID when a client disconnects.
   */
  release(rid: ReplicaId): void {
    this.activeReplicas.delete(rid);
    // Note: we don't reuse IDs to avoid confusion in operation history
  }

  /**
   * Release a replica ID by client ID.
   */
  releaseByClientId(clientId: string): void {
    const rid = this.assignedIds.get(clientId);
    if (rid !== undefined) {
      this.activeReplicas.delete(rid);
    }
  }

  /**
   * Get the replica ID for a client, if assigned.
   */
  getReplicaId(clientId: string): ReplicaId | undefined {
    return this.assignedIds.get(clientId);
  }

  /**
   * Check if a replica ID is currently active.
   */
  isActive(rid: ReplicaId): boolean {
    return this.activeReplicas.has(rid);
  }

  /**
   * Get all active replica IDs.
   */
  getActiveReplicas(): ReadonlySet<ReplicaId> {
    return this.activeReplicas;
  }

  /**
   * Get the total number of assigned IDs (including inactive).
   */
  get totalAssigned(): number {
    return this.assignedIds.size;
  }

  /**
   * Get the number of currently active replicas.
   */
  get activeCount(): number {
    return this.activeReplicas.size;
  }

  /**
   * Export state for persistence.
   */
  exportState(): { nextId: number; assignments: Array<[string, number]> } {
    return {
      nextId: this.nextId,
      assignments: Array.from(this.assignedIds.entries()).map(([k, v]) => [k, v]),
    };
  }

  /**
   * Import state from persistence.
   */
  static fromState(state: {
    nextId: number;
    assignments: Array<[string, number]>;
  }): SequentialReplicaIdAssigner {
    const assigner = new SequentialReplicaIdAssigner(state.nextId);
    for (const [clientId, id] of state.assignments) {
      assigner.assignedIds.set(clientId, replicaId(id));
    }
    return assigner;
  }
}

// ---------------------------------------------------------------------------
// Random ID Generator (Client-Side)
// ---------------------------------------------------------------------------

/**
 * Generate a random replica ID for client-side use.
 *
 * Uses 30 bits of randomness to stay within safe integer range.
 * Collision probability is ~1 in 1 billion for two clients.
 *
 * Use this for:
 * - Peer-to-peer scenarios without a central server
 * - Testing and development
 * - Temporary/anonymous clients
 */
export function generateRandomReplicaId(): ReplicaId {
  // 30 bits = ~1 billion unique IDs
  // Start from 1 to avoid 0 (reserved for sentinels)
  return replicaId(Math.floor(Math.random() * 0x3fffffff) + 1);
}

/**
 * Generate a replica ID from a cryptographically secure source.
 * Preferred for production peer-to-peer use.
 */
export function generateSecureReplicaId(): ReplicaId {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    // Use 30 bits, avoid 0
    const value = array[0] ?? 0;
    return replicaId(value & 0x3fffffff || 1);
  }
  // Fallback to Math.random
  return generateRandomReplicaId();
}

// ---------------------------------------------------------------------------
// ID Validation
// ---------------------------------------------------------------------------

/**
 * Check if a replica ID is valid.
 * Valid IDs are positive integers within the safe range.
 */
export function isValidReplicaId(id: number): boolean {
  return Number.isInteger(id) && id > 0 && id <= 0x3fffffff;
}

/**
 * Reserved replica IDs used for sentinels.
 */
export const RESERVED_REPLICA_IDS = {
  /** Start-of-document sentinel. */
  MIN: 0,
  /** End-of-document sentinel. */
  MAX: 0xffffffff,
} as const;
