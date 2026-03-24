/**
 * Awareness protocol for ephemeral collaborative state.
 *
 * Awareness state (cursors, selections, user info) is:
 * - Ephemeral: not persisted to CRDT state
 * - Periodic: broadcast at regular intervals
 * - Last-write-wins: newer timestamps replace older
 * - Self-expiring: states expire if not refreshed
 */

import { type ReplicaId, replicaId } from "../text/types.js";
import { BinaryReader, BinaryWriter } from "./serialization.js";
import type { AwarenessState, CursorPosition, UserInfo } from "./types.js";
import { BINARY_VERSION, PROTOCOL_MAGIC } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default awareness broadcast interval in milliseconds. */
export const DEFAULT_AWARENESS_INTERVAL = 1000;

/** Default awareness timeout in milliseconds (3x interval). */
export const DEFAULT_AWARENESS_TIMEOUT = 3000;

/** Message type for awareness in binary protocol. */
const AWARENESS_MESSAGE_TYPE = 3;

// ---------------------------------------------------------------------------
// Awareness Manager
// ---------------------------------------------------------------------------

/**
 * Manages awareness state for multiple replicas.
 */
export class AwarenessManager {
  private readonly localReplicaId: ReplicaId;
  private states: Map<ReplicaId, AwarenessState>;
  private _localState: Omit<AwarenessState, "replicaId" | "timestamp">;
  private timeout: number;

  /** Callback invoked when awareness state changes. */
  onUpdate?: (states: ReadonlyMap<ReplicaId, AwarenessState>) => void;

  /** Callback invoked when a replica's awareness expires. */
  onExpire?: (replicaId: ReplicaId) => void;

  constructor(localReplicaId: ReplicaId, timeout = DEFAULT_AWARENESS_TIMEOUT) {
    this.localReplicaId = localReplicaId;
    this.states = new Map();
    this._localState = {};
    this.timeout = timeout;
  }

  /**
   * Update local awareness state.
   */
  setLocalState(state: Partial<Omit<AwarenessState, "replicaId" | "timestamp">>): void {
    this._localState = {
      ...this._localState,
      ...state,
    };
  }

  /**
   * Set local cursor position.
   */
  setCursor(cursor: CursorPosition | undefined): void {
    if (cursor === undefined) {
      const { cursor: _, ...rest } = this._localState;
      this._localState = rest;
    } else {
      this._localState = { ...this._localState, cursor };
    }
  }

  /**
   * Set local user info.
   */
  setUser(user: UserInfo | undefined): void {
    if (user === undefined) {
      const { user: _, ...rest } = this._localState;
      this._localState = rest;
    } else {
      this._localState = { ...this._localState, user };
    }
  }

  /**
   * Set custom application-specific data.
   */
  setCustom(custom: Record<string, unknown> | undefined): void {
    if (custom === undefined) {
      const { custom: _, ...rest } = this._localState;
      this._localState = rest;
    } else {
      this._localState = { ...this._localState, custom };
    }
  }

  /**
   * Get the full local awareness state with current timestamp.
   */
  getLocalState(): AwarenessState {
    return {
      replicaId: this.localReplicaId,
      ...this._localState,
      timestamp: Date.now(),
    };
  }

  /**
   * Apply a remote awareness update.
   */
  applyRemote(state: AwarenessState): void {
    // Ignore updates from self
    if (state.replicaId === this.localReplicaId) {
      return;
    }

    const existing = this.states.get(state.replicaId);

    // Last-write-wins: only apply if newer
    if (existing === undefined || state.timestamp > existing.timestamp) {
      this.states.set(state.replicaId, state);
      this.onUpdate?.(this.states);
    }
  }

  /**
   * Remove expired awareness states.
   * Call this periodically (e.g., every second).
   */
  expireStale(): ReplicaId[] {
    const now = Date.now();
    const expired: ReplicaId[] = [];

    for (const [rid, state] of this.states) {
      if (now - state.timestamp > this.timeout) {
        this.states.delete(rid);
        expired.push(rid);
        this.onExpire?.(rid);
      }
    }

    if (expired.length > 0) {
      this.onUpdate?.(this.states);
    }

    return expired;
  }

  /**
   * Get awareness state for a specific replica.
   */
  getState(rid: ReplicaId): AwarenessState | undefined {
    if (rid === this.localReplicaId) {
      return this.getLocalState();
    }
    return this.states.get(rid);
  }

  /**
   * Get all awareness states (including local).
   */
  getAllStates(): Map<ReplicaId, AwarenessState> {
    const all = new Map(this.states);
    all.set(this.localReplicaId, this.getLocalState());
    return all;
  }

  /**
   * Get only remote awareness states.
   */
  getRemoteStates(): ReadonlyMap<ReplicaId, AwarenessState> {
    return this.states;
  }

  /**
   * Clear all remote awareness states.
   */
  clear(): void {
    this.states.clear();
    this.onUpdate?.(this.states);
  }

  /**
   * Remove awareness state for a specific replica.
   */
  remove(rid: ReplicaId): void {
    if (this.states.delete(rid)) {
      this.onUpdate?.(this.states);
    }
  }

  /**
   * Get the number of remote replicas with awareness state.
   */
  get remoteCount(): number {
    return this.states.size;
  }
}

// ---------------------------------------------------------------------------
// Awareness Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize awareness state to binary format.
 */
export function serializeAwareness(state: AwarenessState): Uint8Array {
  const writer = new BinaryWriter(256);
  writer.writeU32(PROTOCOL_MAGIC);
  writer.writeU8(BINARY_VERSION);
  writer.writeU8(AWARENESS_MESSAGE_TYPE);

  writer.writeVarUint(state.replicaId);
  writer.writeF64(state.timestamp);

  // Flags for optional fields
  let flags = 0;
  if (state.cursor !== undefined) flags |= 0x01;
  if (state.user !== undefined) flags |= 0x02;
  if (state.custom !== undefined) flags |= 0x04;
  writer.writeU8(flags);

  // Cursor
  if (state.cursor !== undefined) {
    writer.writeVarUint(state.cursor.offset);
    const hasAnchor = state.cursor.anchorOffset !== undefined;
    writer.writeBool(hasAnchor);
    if (hasAnchor) {
      writer.writeVarUint(state.cursor.anchorOffset);
    }
  }

  // User
  if (state.user !== undefined) {
    writer.writeString(state.user.name);
    const hasColor = state.user.color !== undefined;
    writer.writeBool(hasColor);
    if (hasColor) {
      writer.writeString(state.user.color);
    }
    const hasAvatar = state.user.avatarUrl !== undefined;
    writer.writeBool(hasAvatar);
    if (hasAvatar) {
      writer.writeString(state.user.avatarUrl);
    }
  }

  // Custom (JSON encoded)
  if (state.custom !== undefined) {
    writer.writeString(JSON.stringify(state.custom));
  }

  return writer.finish();
}

/**
 * Deserialize awareness state from binary format.
 */
export function deserializeAwareness(data: Uint8Array): AwarenessState {
  const reader = new BinaryReader(data);

  const magic = reader.readU32();
  if (magic !== PROTOCOL_MAGIC) {
    throw new Error(`Invalid protocol magic: expected ${PROTOCOL_MAGIC}, got ${magic}`);
  }

  const version = reader.readU8();
  if (version !== BINARY_VERSION) {
    throw new Error(`Unsupported protocol version: ${version}`);
  }

  const messageType = reader.readU8();
  if (messageType !== AWARENESS_MESSAGE_TYPE) {
    throw new Error(
      `Expected awareness message type (${AWARENESS_MESSAGE_TYPE}), got ${messageType}`,
    );
  }

  const rid = replicaId(reader.readVarUint());
  const timestamp = reader.readF64();
  const flags = reader.readU8();

  let cursor: CursorPosition | undefined;
  let user: UserInfo | undefined;
  let custom: Record<string, unknown> | undefined;

  // Cursor
  if (flags & 0x01) {
    const offset = reader.readVarUint();
    const hasAnchor = reader.readBool();
    cursor = hasAnchor ? { offset, anchorOffset: reader.readVarUint() } : { offset };
  }

  // User
  if (flags & 0x02) {
    const name = reader.readString();
    const hasColor = reader.readBool();
    const color = hasColor ? reader.readString() : undefined;
    const hasAvatar = reader.readBool();
    const avatarUrl = hasAvatar ? reader.readString() : undefined;
    // Build user object without undefined properties
    const userObj: UserInfo = { name };
    if (color !== undefined) (userObj as { color?: string }).color = color;
    if (avatarUrl !== undefined) (userObj as { avatarUrl?: string }).avatarUrl = avatarUrl;
    user = userObj;
  }

  // Custom
  if (flags & 0x04) {
    const jsonStr = reader.readString();
    custom = JSON.parse(jsonStr);
  }

  // Build result without undefined properties
  const result: AwarenessState = { replicaId: rid, timestamp };
  if (cursor !== undefined) (result as { cursor?: CursorPosition }).cursor = cursor;
  if (user !== undefined) (result as { user?: UserInfo }).user = user;
  if (custom !== undefined) (result as { custom?: Record<string, unknown> }).custom = custom;
  return result;
}

// ---------------------------------------------------------------------------
// Awareness Broadcaster
// ---------------------------------------------------------------------------

/**
 * Callback type for sending awareness updates.
 */
export type AwarenessSendCallback = (data: Uint8Array) => void;

/**
 * Manages periodic awareness broadcasts.
 */
export class AwarenessBroadcaster {
  private manager: AwarenessManager;
  private send: AwarenessSendCallback;
  private interval: number;
  private timerId: ReturnType<typeof setInterval> | null;
  private expireTimerId: ReturnType<typeof setInterval> | null;

  constructor(
    manager: AwarenessManager,
    send: AwarenessSendCallback,
    interval = DEFAULT_AWARENESS_INTERVAL,
  ) {
    this.manager = manager;
    this.send = send;
    this.interval = interval;
    this.timerId = null;
    this.expireTimerId = null;
  }

  /**
   * Start periodic awareness broadcasts.
   */
  start(): void {
    if (this.timerId !== null) return;

    // Broadcast immediately
    this.broadcast();

    // Then broadcast periodically
    this.timerId = setInterval(() => {
      this.broadcast();
    }, this.interval);

    // Also expire stale states periodically
    this.expireTimerId = setInterval(() => {
      this.manager.expireStale();
    }, this.interval);
  }

  /**
   * Stop periodic awareness broadcasts.
   */
  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.expireTimerId !== null) {
      clearInterval(this.expireTimerId);
      this.expireTimerId = null;
    }
  }

  /**
   * Broadcast local awareness state immediately.
   */
  broadcast(): void {
    const state = this.manager.getLocalState();
    const data = serializeAwareness(state);
    this.send(data);
  }

  /**
   * Handle received awareness data.
   */
  receive(data: Uint8Array): void {
    const state = deserializeAwareness(data);
    this.manager.applyRemote(state);
  }

  /**
   * Check if broadcasting is active.
   */
  get isActive(): boolean {
    return this.timerId !== null;
  }
}
