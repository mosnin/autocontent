/*
 * Group-chat room engine.
 *
 * Flood control (per-participant rate, duplicate window, A→B→C→A ring detection, breaker that never counts refusals)
 * is adapted from OpenMausBot server/room-post-budget.ts (`decideRoomPost`), and the fast "who speaks" decider with a
 * 0.6 confidence threshold that fails open to the room lead from server/decider/room-routing.ts
 * (`decideRoomResponder`, `ROOM_ROUTING_MIN_PROBABILITY`), both at commit 542f8e55f3f9c5be5550aac0e99fcec050308d69
 * (https://github.com/milind-soni/openmausbot). Copyright 2026 Milind Soni and OpenMausBot contributors. Licensed under
 * the Apache License, Version 2.0 (see third_party/templates/openmausbot/LICENSE and NOTICE).
 * The NO_RESPONSE silence sentinel follows elie222/rakazo packages/adapters/src/silent-reply.ts @ c76070c8
 * (Copyright 2026 Rakazo contributors, Apache-2.0), and the one-prompt-in-flight-per-participant batching plus the
 * reply guard follow block/buzz crates/buzz-acp/README.md and crates/buzz-agent/README.md @ 402bd189 (Copyright 2026
 * Block, Inc., Apache-2.0); see third_party/templates/{rakazo,buzz}/LICENSE.
 *
 * MODIFIED for Agent Starter (Apache-2.0 section 4(b)): reimplemented over Durable Object SQLite (tables below) inside
 * the existing moderated RoomEngine; ring detection counts only unsummoned posts (or every post in self-selection
 * mode) because moderator-driven turns legitimately cycle; the decider is a ModelProvider prompted for JSON; the reply
 * guard re-summons a silent participant once before skipping it; self-selection rooms reset ring detection at every
 * round; posts from senders outside the room are refused. All prompt text is our own.
 */
import { completeText, extractJsonBlock, type ModelProvider, randomId, safeJsonParse, type SqlStore, type TelemetryEvent } from "@agent-starter/core";

export interface RoomParticipant {
  id: string;
  role: string;
  description: string;
}

export interface RoomFloodLimits {
  /** Accepted posts per participant per minute. */
  perParticipantPerMinute: number;
  /** Same participant, same (normalized) text inside this window is refused as a duplicate. */
  duplicateWindowMs: number;
  /** A→B→C→A (or A→B→A→B) among counted posts inside this window trips the breaker. */
  ringWindowMs: number;
  /** While tripped, counted posts are refused. */
  breakerCooldownMs: number;
  /** Times a participant that let its turn time out is re-summoned with a reminder before it is skipped. */
  replyGuardRetries: number;
  /** Consecutive rounds where everyone stayed silent before the room halts as stuck. */
  maxSilentRounds: number;
}

export const DEFAULT_ROOM_FLOOD_LIMITS: RoomFloodLimits = {
  perParticipantPerMinute: 10,
  duplicateWindowMs: 60_000,
  ringWindowMs: 120_000,
  breakerCooldownMs: 5 * 60_000,
  replyGuardRetries: 1,
  maxSilentRounds: 2,
};

export interface RoomConfig {
  roomId: string;
  tenantId: string;
  objective: string;
  participants: RoomParticipant[];
  maxTurns: number;
  budgetUsd: number;
  /** How long a summoned participant may take before the room reminds it, then skips it. */
  speakerTimeoutMs: number;
  /** Allow the moderator/decider to summon several participants in parallel. */
  allowFanOut: boolean;
  /** Participant the decider falls back to when unsure (default: the first participant). */
  leadId?: string;
  /** Who opened the room; the outcome is reported back to this conversation (R-MA-08). */
  requester?: { agent: string; conversationId: string };
  /** "moderator" (default): moderator/decider picks speakers. "self": everyone may answer; `NO_RESPONSE` is silence. */
  selection?: "moderator" | "self";
  flood?: Partial<RoomFloodLimits>;
}

export interface RoomMessage {
  id: number;
  senderId: string;
  senderRole: string;
  content: string;
  costUsd: number;
  createdAt: number;
}

export type RoomStatus = "OPEN" | "WAITING" | "HALTED" | "COMPLETED";

/** `not_participant`: the sender is neither a room participant nor the room's staff ("system", "orchestrator"). */
export type RoomPostRefusal = "duplicate" | "ring" | "breaker" | "rate" | "not_participant";

export interface RoomDecision {
  speakers: string[];
  halt: boolean;
  reason: string;
  /** Set when the post was refused by flood control (nothing was recorded). */
  refused?: RoomPostRefusal;
}

/** Everything a summoned participant needs beyond the transcript window. */
export interface RoomSummonContext {
  /** Monotonic per room: use it in the summon idempotency key (never the transcript length). */
  seq: number;
  /** Messages from others since this participant's previous summon (arrived while it was working or away). */
  batch: RoomMessage[];
  /** True when this is the reply-guard re-summon after a turn ended without a post. */
  reminder: boolean;
  /** Why the moderator/decider picked it. */
  reason: string;
}

export interface RoomOutcome {
  roomId: string;
  tenantId: string;
  status: Extract<RoomStatus, "COMPLETED" | "HALTED">;
  reason: string;
  /** The final `DONE:` synthesis if a participant wrote one, else the last participant message. */
  synthesis: RoomMessage | null;
  transcript: RoomMessage[];
  stats: { turns: number; costUsd: number };
  requester?: { agent: string; conversationId: string };
}

export interface RoomEffects {
  /** Ask a participant agent to take its turn (e.g. Flue `dispatch`). Must be non-blocking. */
  summon(participant: RoomParticipant, transcript: RoomMessage[], config: RoomConfig, context: RoomSummonContext): Promise<void>;
  broadcast(event: TelemetryEvent): Promise<void>;
  /**
   * Ask to be woken (DO alarm) at `at` to run `checkTimeouts()` / `reportOutcome()`. The engine calls it for every new
   * deadline, after each timeout sweep with the next pending deadline, and with the retry time of a failed completion
   * hook, so an implementation that keeps only the earliest alarm is enough as long as the alarm handler re-arms with
   * `nextWakeAt()` (`AgentGroupChatRoom` does).
   */
  scheduleTimeout(at: number): Promise<void>;
  /** Completion hook: called when the room settles until it succeeds once (retried with backoff from the alarm). */
  onSettled?(outcome: RoomOutcome): Promise<void>;
}

export interface RoomEngineOptions {
  /** Classic moderator ("NEXT: id — reason" / "HALT: reason"). */
  moderator?: ModelProvider;
  /** Fast decider prompted for `{ speaker, confidence }`; below the threshold the room falls back to the lead. */
  decider?: ModelProvider;
  /** Default 0.6 (calibrated upstream: answers at ≥ 0.6 were right 92–99 % of the time). */
  deciderThreshold?: number;
  /** Default 2 000 ms; a slow decider falls back to the lead. */
  deciderTimeoutMs?: number;
  clock?: () => number;
}

/** Exact silence sentinel: a participant that has nothing to add posts this and the room records nothing. */
export const NO_RESPONSE = "NO_RESPONSE";
const EVERYONE = "__everyone__";
const STAFF = new Set(["system", "orchestrator"]);
/** First retry of a failed completion hook; doubles per failure up to `REPORT_RETRY_MAX_MS`. */
export const REPORT_RETRY_BASE_MS = 30_000;
export const REPORT_RETRY_MAX_MS = 15 * 60_000;

export const ROOM_MIGRATIONS = {
  namespace: "agent-starter-room",
  migrations: [
    {
      version: 1,
      name: "room",
      up: [
        `CREATE TABLE IF NOT EXISTS as_room_config (id INTEGER PRIMARY KEY CHECK (id = 1), config_json TEXT NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS as_room_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id TEXT NOT NULL, sender_role TEXT NOT NULL, content TEXT NOT NULL, cost_usd REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS as_room_pending (participant_id TEXT PRIMARY KEY, summoned_at INTEGER NOT NULL, deadline INTEGER NOT NULL)`,
      ],
      down: [`DROP TABLE IF EXISTS as_room_pending`, `DROP TABLE IF EXISTS as_room_messages`, `DROP TABLE IF EXISTS as_room_config`],
    },
    {
      version: 2,
      name: "room-flood-control-summons",
      up: [
        `CREATE TABLE IF NOT EXISTS as_room_summons (seq INTEGER PRIMARY KEY AUTOINCREMENT, participant_id TEXT NOT NULL, reminder INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS as_room_participants (participant_id TEXT PRIMARY KEY, last_seen_id INTEGER NOT NULL DEFAULT 0, reminders INTEGER NOT NULL DEFAULT 0, silent_count INTEGER NOT NULL DEFAULT 0)`,
        `CREATE TABLE IF NOT EXISTS as_room_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, participant_id TEXT NOT NULL, content_hash TEXT NOT NULL, counted INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS as_room_state (id INTEGER PRIMARY KEY CHECK (id = 1), tripped_at INTEGER, trips INTEGER NOT NULL DEFAULT 0, ring_reset_post_id INTEGER NOT NULL DEFAULT 0, round_start_id INTEGER NOT NULL DEFAULT 0, silent_rounds INTEGER NOT NULL DEFAULT 0, settled_at INTEGER, reported_at INTEGER)`,
        `CREATE TABLE IF NOT EXISTS as_room_costs (key TEXT PRIMARY KEY, participant_id TEXT NOT NULL, cost_usd REAL NOT NULL, created_at INTEGER NOT NULL)`,
        `ALTER TABLE as_room_pending ADD COLUMN seq INTEGER NOT NULL DEFAULT 0`,
      ],
      down: [`DROP TABLE IF EXISTS as_room_costs`, `DROP TABLE IF EXISTS as_room_state`, `DROP TABLE IF EXISTS as_room_posts`, `DROP TABLE IF EXISTS as_room_participants`, `DROP TABLE IF EXISTS as_room_summons`],
    },
    {
      version: 3,
      name: "room-report-retry",
      up: [`ALTER TABLE as_room_state ADD COLUMN report_attempts INTEGER NOT NULL DEFAULT 0`, `ALTER TABLE as_room_state ADD COLUMN report_retry_at INTEGER`],
      down: [],
    },
  ],
};

type RoomStateRow = {
  tripped_at: number | null;
  trips: number;
  ring_reset_post_id: number;
  round_start_id: number;
  silent_rounds: number;
  settled_at: number | null;
  reported_at: number | null;
  report_attempts: number;
  report_retry_at: number | null;
};

type MessageRow = { id: number; sender_id: string; sender_role: string; content: string; cost_usd: number; created_at: number };
const toMessage = (r: MessageRow): RoomMessage => ({ id: Number(r.id), senderId: r.sender_id, senderRole: r.sender_role, content: r.content, costUsd: Number(r.cost_usd), createdAt: Number(r.created_at) });

function contentHash(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${normalized.length}:${(hash >>> 0).toString(16)}`;
}

/** A→B→C→A (three distinct, closing back) or A→B→A→B (ping-pong) at the tail of the sender sequence. */
export function closesRing(senders: readonly string[], candidate: string): boolean {
  const tail = [...senders.slice(-3), candidate];
  if (tail.length < 4) return false;
  const [a, b, c, d] = tail as [string, string, string, string];
  const threeRing = a === d && new Set([a, b, c]).size === 3;
  const pingPong = a === c && b === d && a !== b;
  return threeRing || pingPong;
}

/**
 * Group-chat orchestration (distributed agent bus pattern). Every agent is its own Durable Object; the room is a
 * coordinator that records the transcript in SQLite, picks who speaks (decider → lead fallback, moderator, or
 * round-robin; or self-selection with a `NO_RESPONSE` sentinel), summons participants asynchronously with one turn in
 * flight per participant and a batch of what they missed, applies flood control (rate, duplicate, ring, breaker),
 * enforces turn and budget ceilings, re-summons a silent participant once (reply guard) before skipping it, and calls a
 * completion hook so the outcome returns to whoever opened the room.
 */
export class RoomEngine {
  constructor(
    private readonly sql: SqlStore,
    private readonly effects: RoomEffects,
    private readonly options: RoomEngineOptions = {},
  ) {}

  private now(): number {
    return (this.options.clock ?? Date.now)();
  }

  configure(config: RoomConfig): void {
    this.sql.exec(
      `INSERT INTO as_room_config (id, config_json, status, updated_at) VALUES (1, ?, 'OPEN', ?) ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`,
      JSON.stringify(config),
      this.now(),
    );
    this.sql.exec(`INSERT OR IGNORE INTO as_room_state (id) VALUES (1)`);
  }

  config(): RoomConfig | null {
    const row = this.sql.exec<{ config_json: string }>(`SELECT config_json FROM as_room_config WHERE id = 1`)[0];
    return row ? (JSON.parse(row.config_json) as RoomConfig) : null;
  }

  status(): RoomStatus {
    return (this.sql.exec<{ status: string }>(`SELECT status FROM as_room_config WHERE id = 1`)[0]?.status as RoomStatus) ?? "OPEN";
  }

  transcript(limit = 50): RoomMessage[] {
    return this.sql.exec<MessageRow>(`SELECT * FROM (SELECT * FROM as_room_messages ORDER BY id DESC LIMIT ?) ORDER BY id`, limit).map(toMessage);
  }

  stats(): { turns: number; costUsd: number } {
    const row = this.sql.exec<{ turns: number; cost: number | null }>(`SELECT COUNT(*) AS turns, SUM(cost_usd) AS cost FROM as_room_messages WHERE sender_id NOT IN ('system', 'orchestrator')`)[0];
    const extra = this.sql.exec<{ cost: number | null }>(`SELECT SUM(cost_usd) AS cost FROM as_room_costs`)[0];
    return { turns: Number(row?.turns ?? 0), costUsd: Number(row?.cost ?? 0) + Number(extra?.cost ?? 0) };
  }

  pending(): string[] {
    return this.sql.exec<{ participant_id: string }>(`SELECT participant_id FROM as_room_pending`).map((r) => r.participant_id);
  }

  private limits(config: RoomConfig): RoomFloodLimits {
    return { ...DEFAULT_ROOM_FLOOD_LIMITS, ...config.flood };
  }

  private state(): RoomStateRow {
    this.sql.exec(`INSERT OR IGNORE INTO as_room_state (id) VALUES (1)`);
    const row = this.sql.exec<{ [K in keyof RoomStateRow]: RoomStateRow[K] | undefined }>(`SELECT * FROM as_room_state WHERE id = 1`)[0];
    const nullable = (value: number | null | undefined) => (value === null || value === undefined ? null : Number(value));
    return {
      tripped_at: nullable(row?.tripped_at),
      trips: Number(row?.trips ?? 0),
      ring_reset_post_id: Number(row?.ring_reset_post_id ?? 0),
      round_start_id: Number(row?.round_start_id ?? 0),
      silent_rounds: Number(row?.silent_rounds ?? 0),
      settled_at: nullable(row?.settled_at),
      reported_at: nullable(row?.reported_at),
      report_attempts: Number(row?.report_attempts ?? 0),
      report_retry_at: nullable(row?.report_retry_at),
    };
  }

  private maxMessageId(): number {
    return Number(this.sql.exec<{ m: number | null }>(`SELECT MAX(id) AS m FROM as_room_messages`)[0]?.m ?? 0);
  }

  /**
   * Flood control for one participant post. Returns a refusal or null (allowed). Refusals are never recorded, so a
   * blocked participant cannot deepen its own block. Ring/breaker rules apply to counted posts only: unsummoned posts,
   * or every post in self-selection mode (moderated turns cycle by design).
   */
  private flood(config: RoomConfig, participantId: string, hash: string, counted: boolean): { refusal: RoomPostRefusal; message: string } | null {
    const limits = this.limits(config);
    const now = this.now();
    const state = this.state();
    const tripped = state.tripped_at !== null && now - state.tripped_at < limits.breakerCooldownMs;
    if (counted && tripped) {
      return { refusal: "breaker", message: "Posting into this room is paused: its agents were answering each other in a loop. Do not retry; put what you wanted to say in your final report instead." };
    }
    const duplicate = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM as_room_posts WHERE participant_id = ? AND content_hash = ? AND created_at > ?`, participantId, hash, now - limits.duplicateWindowMs)[0];
    if (Number(duplicate?.n ?? 0) > 0) {
      return { refusal: "duplicate", message: "You already posted that exact message here a moment ago and it is in the transcript. Treat it as delivered; do not post it again." };
    }
    if (counted) {
      const senders = this.sql
        .exec<{ participant_id: string }>(`SELECT participant_id FROM as_room_posts WHERE counted = 1 AND id > ? AND created_at > ? ORDER BY id`, state.ring_reset_post_id, now - limits.ringWindowMs)
        .map((r) => r.participant_id);
      if (closesRing(senders, participantId)) {
        this.sql.exec(`UPDATE as_room_state SET tripped_at = ?, trips = trips + 1 WHERE id = 1`, now);
        return { refusal: "ring", message: `Posting is now paused: ${participantId} would close a loop the room's agents have been passing between themselves. Do not retry or move to another room; report what is going round instead.` };
      }
    }
    const recent = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM as_room_posts WHERE participant_id = ? AND created_at > ?`, participantId, now - 60_000)[0];
    if (Number(recent?.n ?? 0) >= limits.perParticipantPerMinute) {
      return { refusal: "rate", message: `You posted ${limits.perParticipantPerMinute} times in the last minute, which is the limit. Do not retry; finish your turn.` };
    }
    return null;
  }

  /** Record a message, broadcast it, and (unless still waiting on others) orchestrate the next turn. */
  async post(message: { senderId: string; senderRole: string; content: string; costUsd?: number }): Promise<RoomDecision | null> {
    const config = this.config();
    if (!config) throw new Error("Room is not configured");
    const status = this.status();
    if (status === "HALTED" || status === "COMPLETED") return null;
    const isParticipant = config.participants.some((p) => p.id === message.senderId);
    if (!isParticipant && !STAFF.has(message.senderId)) {
      // Only the room's participants and its staff speak here (an agent summoned elsewhere cannot inject text).
      await this.emitLog(config, "system", "Room", `Refused a post from ${message.senderId.slice(0, 80)} (not_participant).`, "warning");
      return { speakers: [], halt: false, reason: "You are not a participant of this room; nothing was posted. Report through your own task instead.", refused: "not_participant" };
    }
    const summoned = this.pending().includes(message.senderId);
    const now = this.now();

    if (isParticipant && message.content.trim() === NO_RESPONSE) {
      // Silence: nothing is recorded in the transcript; spend still counts against the ceiling.
      this.sql.exec(`DELETE FROM as_room_pending WHERE participant_id = ?`, message.senderId);
      this.sql.exec(`INSERT INTO as_room_participants (participant_id, silent_count, reminders) VALUES (?, 1, 0) ON CONFLICT(participant_id) DO UPDATE SET silent_count = silent_count + 1, reminders = 0`, message.senderId);
      if (message.costUsd) this.sql.exec(`INSERT OR IGNORE INTO as_room_costs (key, participant_id, cost_usd, created_at) VALUES (?, ?, ?, ?)`, randomId("silence"), message.senderId, message.costUsd, now);
      if (this.pending().length > 0) return null;
      return this.orchestrate(config, message.senderId);
    }

    if (isParticipant) {
      const hash = contentHash(message.content);
      const counted = !summoned || config.selection === "self";
      const refused = this.flood(config, message.senderId, hash, counted);
      if (refused) {
        await this.emitLog(config, "system", "Room", `Refused a post from ${message.senderId} (${refused.refusal}).`, refused.refusal === "ring" ? "error" : "warning");
        if (summoned) {
          // The turn is over either way; never let a refused post stall the room.
          this.sql.exec(`DELETE FROM as_room_pending WHERE participant_id = ?`, message.senderId);
          if (this.pending().length === 0) {
            const next = await this.orchestrate(config, message.senderId);
            return { ...next, refused: refused.refusal, reason: refused.message };
          }
        }
        return { speakers: [], halt: false, reason: refused.message, refused: refused.refusal };
      }
      this.sql.exec(`INSERT INTO as_room_posts (participant_id, content_hash, counted, created_at) VALUES (?, ?, ?, ?)`, message.senderId, hash, counted ? 1 : 0, now);
      this.sql.exec(`INSERT INTO as_room_participants (participant_id, reminders) VALUES (?, 0) ON CONFLICT(participant_id) DO UPDATE SET reminders = 0`, message.senderId);
    } else {
      // A person or the orchestrator spoke: rings restart from here.
      this.sql.exec(`INSERT OR IGNORE INTO as_room_state (id) VALUES (1)`);
      this.sql.exec(`UPDATE as_room_state SET ring_reset_post_id = (SELECT COALESCE(MAX(id), 0) FROM as_room_posts) WHERE id = 1`);
    }

    const id = this.insertMessage(message.senderId, message.senderRole, message.content, message.costUsd ?? 0);
    this.sql.exec(`DELETE FROM as_room_pending WHERE participant_id = ?`, message.senderId);
    await this.emitMessage(config, id);
    if (this.pending().length > 0) return null;
    return this.orchestrate(config, message.senderId);
  }

  /** Spend reported outside a post (e.g. a turn's final usage). Idempotent per key; the highest value wins. */
  async recordCost(entry: { key: string; participantId: string; costUsd: number }): Promise<{ turns: number; costUsd: number }> {
    if (!(entry.costUsd > 0)) return this.stats();
    this.sql.exec(
      `INSERT INTO as_room_costs (key, participant_id, cost_usd, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET cost_usd = MAX(as_room_costs.cost_usd, excluded.cost_usd)`,
      entry.key.slice(0, 200),
      entry.participantId,
      entry.costUsd,
      this.now(),
    );
    const config = this.config();
    const stats = this.stats();
    const status = this.status();
    if (config && status !== "HALTED" && status !== "COMPLETED" && stats.costUsd >= config.budgetUsd) {
      await this.halt(config, `Room ceiling reached (cost $${stats.costUsd.toFixed(4)}/$${config.budgetUsd}).`);
    }
    return stats;
  }

  /** Called from the DO alarm: remind (reply guard) or skip overdue participants, then continue. */
  async checkTimeouts(): Promise<string[]> {
    const config = this.config();
    if (!config) return [];
    const limits = this.limits(config);
    const overdue = this.sql.exec<{ participant_id: string }>(`SELECT participant_id FROM as_room_pending WHERE deadline <= ?`, this.now()).map((r) => r.participant_id);
    for (const id of overdue) {
      const participant = config.participants.find((p) => p.id === id);
      const reminders = Number(this.sql.exec<{ reminders: number }>(`SELECT reminders FROM as_room_participants WHERE participant_id = ?`, id)[0]?.reminders ?? 0);
      if (participant && reminders < limits.replyGuardRetries && this.status() === "WAITING") {
        this.sql.exec(`INSERT INTO as_room_participants (participant_id, reminders) VALUES (?, 1) ON CONFLICT(participant_id) DO UPDATE SET reminders = reminders + 1`, id);
        await this.emitLog(config, "system", "Room", `${id} ended its turn without posting; reminding it once.`, "warning");
        await this.summonOne(config, participant, { reminder: true, reason: "reply guard: your turn ended without a post" });
        continue;
      }
      this.sql.exec(`DELETE FROM as_room_pending WHERE participant_id = ?`, id);
      this.sql.exec(`UPDATE as_room_participants SET reminders = 0 WHERE participant_id = ?`, id);
      const status = this.status();
      if (status === "HALTED" || status === "COMPLETED") continue;
      const messageId = this.insertMessage("system", "Room", `Participant "${id}" timed out after ${config.speakerTimeoutMs}ms and was skipped. Another agent should continue or correct the issue.`, 0);
      await this.emitMessage(config, messageId);
      // Continue from the skipped participant (round-robin moves past it; self-selection leaves it out of the round).
      if (this.pending().length === 0) await this.orchestrate(config, id);
    }
    // Re-arm for the deadlines still ahead: an alarm that keeps only the earliest time must not strand a later speaker.
    const next = this.nextDeadline();
    if (next !== null) await this.effects.scheduleTimeout(next);
    return overdue;
  }

  /** Earliest pending speaker deadline, or null when nobody is summoned. */
  nextDeadline(): number | null {
    const row = this.sql.exec<{ d: number | null }>(`SELECT MIN(deadline) AS d FROM as_room_pending`)[0];
    return row?.d === null || row?.d === undefined ? null : Number(row.d);
  }

  /**
   * When the room next needs its alarm: the earliest pending deadline, or the retry time of a completion hook that
   * has not been delivered yet. Null when there is nothing left to wait for.
   */
  nextWakeAt(): number | null {
    const state = this.state();
    const retry = state.settled_at !== null && state.reported_at === null && this.effects.onSettled ? (state.report_retry_at ?? this.now()) : null;
    const times = [this.nextDeadline(), retry].filter((t): t is number => t !== null);
    return times.length ? Math.min(...times) : null;
  }

  /** The DO alarm: remind/skip overdue speakers, retry an undelivered outcome, and return when to wake next. */
  async onAlarm(): Promise<number | null> {
    await this.checkTimeouts();
    await this.reportOutcome();
    return this.nextWakeAt();
  }

  /**
   * Who speaks next. Self-selection: everyone but the last speaker. Decider: JSON `{speaker, confidence}`; below the
   * threshold, malformed, slow or failing → the lead. Moderator: "NEXT:"/"HALT:" lines. Otherwise round-robin.
   */
  async decide(config: RoomConfig, lastSenderId: string): Promise<RoomDecision> {
    const ids = config.participants.map((p) => p.id);
    const roundRobin = (): RoomDecision => {
      const next = config.participants[(ids.indexOf(lastSenderId) + 1) % ids.length] ?? config.participants[0];
      return { speakers: next ? [next.id] : [], halt: false, reason: "round-robin fallback" };
    };
    if (config.selection === "self") {
      const speakers = ids.filter((id) => id !== lastSenderId);
      return { speakers: speakers.length ? speakers : ids, halt: false, reason: "self-selection: each participant answers or stays silent with NO_RESPONSE" };
    }
    const history = this.transcript(12).map((m) => `${m.senderRole} (${m.senderId}): ${m.content.slice(0, 600)}`).join("\n");
    const roster = config.participants.map((p) => `- ${p.id}: ${p.role} — ${p.description}`).join("\n");
    if (this.options.decider) {
      const lead = (): RoomDecision => {
        const leadId = config.leadId && ids.includes(config.leadId) ? config.leadId : ids[0];
        if (!leadId) return { speakers: [], halt: true, reason: "no participants" };
        if (leadId === lastSenderId && ids.length > 1) return { ...roundRobin(), reason: "decider unsure; lead just spoke, next in turn" };
        return { speakers: [leadId], halt: false, reason: "decider unsure; falling back to the lead" };
      };
      try {
        const timeoutMs = this.options.deciderTimeoutMs ?? 2_000;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const { text } = await Promise.race([
          completeText(this.options.decider, {
            system: `You route turns in a multi-agent working session. Objective: ${config.objective}\nParticipants:\n${roster}\nReply with JSON only: {"speaker": "<participant id>" | "${EVERYONE}" | "HALT", "confidence": <number 0..1>, "reason": "<short>"}. Use "${EVERYONE}" only when the last message needs several participants. Use "HALT" only when a participant has written a final "DONE:" synthesis that meets the objective, or the group is stuck. Do not pick the participant who just spoke unless it was asked a direct question.`,
            prompt: `Transcript (most recent last):\n${history}\n\nLast speaker: ${lastSenderId}`,
            temperature: 0,
            maxOutputTokens: 80,
            signal: controller.signal,
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error("decider timeout"));
            }, timeoutMs);
          }),
        ]).finally(() => clearTimeout(timer));
        const block = extractJsonBlock(text);
        const parsed = block ? safeJsonParse<{ speaker?: unknown; confidence?: unknown; reason?: unknown }>(block) : { ok: false as const, error: "no json" };
        if (!parsed.ok) return lead();
        const speaker = String(parsed.value.speaker ?? "");
        const confidence = Number(parsed.value.confidence);
        const reason = String(parsed.value.reason ?? "").slice(0, 300) || `decider picked ${speaker}`;
        if (!Number.isFinite(confidence) || confidence < (this.options.deciderThreshold ?? 0.6)) return lead();
        if (speaker === "HALT") return { speakers: [], halt: true, reason };
        if (speaker === EVERYONE) return config.allowFanOut ? { speakers: ids.filter((id) => id !== lastSenderId), halt: false, reason } : lead();
        if (!ids.includes(speaker)) return lead();
        return { speakers: [speaker], halt: false, reason };
      } catch {
        return lead();
      }
    }
    if (!this.options.moderator) return roundRobin();
    try {
      const { text } = await completeText(this.options.moderator, {
        system: `You are the moderator of a multi-agent working session. Objective: ${config.objective}\nParticipants:\n${roster}\nReply with ONE line: either "HALT: <reason>" when the objective is achieved or the group is stuck, or "NEXT: <id>${config.allowFanOut ? "[,<id>...]" : ""} — <reason>". Never pick the agent who just spoke unless it was asked a direct question.`,
        prompt: `Transcript (most recent last):\n${history}\n\nLast speaker: ${lastSenderId}`,
        temperature: 0,
        maxOutputTokens: 60,
      });
      if (/^\s*HALT/i.test(text)) return { speakers: [], halt: true, reason: text.replace(/^\s*HALT:?\s*/i, "").slice(0, 300) };
      const listed = (text.match(/NEXT:\s*([^—\-\n]+)/i)?.[1] ?? "").split(",").map((s) => s.trim()).filter((s) => ids.includes(s));
      const speakers = (config.allowFanOut ? listed : listed.slice(0, 1)).filter((s) => s !== lastSenderId || listed.length === 1);
      return speakers.length ? { speakers, halt: false, reason: text.slice(0, 300) } : roundRobin();
    } catch {
      return roundRobin();
    }
  }

  private async orchestrate(config: RoomConfig, lastSenderId: string): Promise<RoomDecision> {
    const stats = this.stats();
    if (stats.turns >= config.maxTurns || stats.costUsd >= config.budgetUsd) {
      return this.halt(config, `Room ceiling reached (turns ${stats.turns}/${config.maxTurns}, cost $${stats.costUsd.toFixed(4)}/$${config.budgetUsd}).`);
    }
    // Self-selection: every post counts, so ring detection restarts each round (A, B, C then A again is a new round,
    // not a loop); loops inside one round (A, B, A, B) still trip the breaker.
    if (config.selection === "self") this.sql.exec(`UPDATE as_room_state SET ring_reset_post_id = (SELECT COALESCE(MAX(id), 0) FROM as_room_posts) WHERE id = 1`);
    // A round where nobody posted anything (everyone answered NO_RESPONSE or was skipped: the room's own "skipped"
    // notices do not count as content) counts towards "stuck", so a room whose speakers keep dying silently settles.
    const state = this.state();
    if (state.round_start_id > 0) {
      const fresh = Number(this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM as_room_messages WHERE id > ? AND sender_id <> 'system'`, state.round_start_id)[0]?.n ?? 0);
      const silent = fresh === 0 ? state.silent_rounds + 1 : 0;
      this.sql.exec(`UPDATE as_room_state SET silent_rounds = ? WHERE id = 1`, silent);
      if (silent >= this.limits(config).maxSilentRounds) return this.halt(config, `Session stuck: ${silent} rounds with nothing new to add.`);
    }
    const decision = await this.decide(config, lastSenderId);
    if (decision.halt || decision.speakers.length === 0) return this.halt(config, decision.reason || "Moderator halted the session.", decision);
    const busy = new Set(this.pending());
    const speakers = decision.speakers.filter((id) => !busy.has(id)); // one turn in flight per participant
    this.sql.exec(`UPDATE as_room_state SET round_start_id = ? WHERE id = 1`, this.maxMessageId());
    this.sql.exec(`UPDATE as_room_config SET status = 'WAITING', updated_at = ? WHERE id = 1`, this.now());
    await Promise.all(
      speakers.map(async (id) => {
        const participant = config.participants.find((p) => p.id === id) as RoomParticipant;
        await this.summonOne(config, participant, { reminder: false, reason: decision.reason });
      }),
    );
    return { ...decision, speakers };
  }

  private async summonOne(config: RoomConfig, participant: RoomParticipant, options: { reminder: boolean; reason: string }): Promise<void> {
    const now = this.now();
    const deadline = now + config.speakerTimeoutMs;
    const seq = Number(this.sql.exec<{ seq: number }>(`INSERT INTO as_room_summons (participant_id, reminder, created_at) VALUES (?, ?, ?) RETURNING seq`, participant.id, options.reminder ? 1 : 0, now)[0]?.seq ?? 0);
    const lastSeen = Number(this.sql.exec<{ last_seen_id: number }>(`SELECT last_seen_id FROM as_room_participants WHERE participant_id = ?`, participant.id)[0]?.last_seen_id ?? 0);
    const batch = this.sql.exec<MessageRow>(`SELECT * FROM as_room_messages WHERE id > ? AND sender_id <> ? ORDER BY id LIMIT 50`, lastSeen, participant.id).map(toMessage);
    this.sql.exec(
      `INSERT INTO as_room_participants (participant_id, last_seen_id) VALUES (?, ?) ON CONFLICT(participant_id) DO UPDATE SET last_seen_id = excluded.last_seen_id`,
      participant.id,
      this.maxMessageId(),
    );
    this.sql.exec(
      `INSERT INTO as_room_pending (participant_id, summoned_at, deadline, seq) VALUES (?, ?, ?, ?) ON CONFLICT(participant_id) DO UPDATE SET summoned_at = excluded.summoned_at, deadline = excluded.deadline, seq = excluded.seq`,
      participant.id,
      now,
      deadline,
      seq,
    );
    await this.effects.scheduleTimeout(deadline);
    try {
      await this.effects.summon(participant, this.transcript(30), config, { seq, batch, reminder: options.reminder, reason: options.reason });
    } catch (error) {
      this.sql.exec(`DELETE FROM as_room_pending WHERE participant_id = ?`, participant.id);
      await this.post({ senderId: "system", senderRole: "Room", content: `Failed to summon "${participant.id}": ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  private async halt(config: RoomConfig, reason: string, decision?: RoomDecision): Promise<RoomDecision> {
    const status: Extract<RoomStatus, "COMPLETED" | "HALTED"> = /ceiling|budget|stuck|fail|loop/i.test(reason) ? "HALTED" : "COMPLETED";
    this.sql.exec(`UPDATE as_room_config SET status = ?, updated_at = ? WHERE id = 1`, status, this.now());
    this.sql.exec(`DELETE FROM as_room_pending`);
    const id = this.insertMessage("system", "Room", `Session ${status.toLowerCase()}: ${reason}`, 0);
    await this.emitMessage(config, id, status === "COMPLETED" ? "success" : "error", status === "COMPLETED" ? "COMPLETED" : "HALTED");
    this.sql.exec(`INSERT OR IGNORE INTO as_room_state (id) VALUES (1)`);
    this.sql.exec(`UPDATE as_room_state SET settled_at = COALESCE(settled_at, ?) WHERE id = 1`, this.now());
    await this.reportOutcome(); // on failure it schedules its own retry
    return decision ? { ...decision, halt: true } : { speakers: [], halt: true, reason };
  }

  /** The settled room's outcome, or null while it is still running. */
  outcome(): RoomOutcome | null {
    const config = this.config();
    const status = this.status();
    if (!config || (status !== "COMPLETED" && status !== "HALTED")) return null;
    const transcript = this.transcript(40);
    const ids = new Set(config.participants.map((p) => p.id));
    const fromParticipants = transcript.filter((m) => ids.has(m.senderId));
    const synthesis = [...fromParticipants].reverse().find((m) => /(^|\n)\s*DONE:/.test(m.content)) ?? fromParticipants[fromParticipants.length - 1] ?? null;
    const last = transcript[transcript.length - 1];
    const reason = last?.senderId === "system" ? last.content.replace(/^Session (completed|halted):\s*/, "") : status.toLowerCase();
    return { roomId: config.roomId, tenantId: config.tenantId, status, reason, synthesis, transcript, stats: this.stats(), ...(config.requester ? { requester: config.requester } : {}) };
  }

  /**
   * Completion hook delivery: calls `effects.onSettled` until it succeeds once. Returns true when the outcome is
   * reported (or there is nothing to report). A failure schedules its own retry (`scheduleTimeout`, backoff from
   * 30 s doubling to 15 min), whichever path settled the room, so the outcome is never stranded.
   */
  async reportOutcome(): Promise<boolean> {
    const state = this.state();
    if (state.reported_at !== null) return true;
    const outcome = this.outcome();
    if (!outcome) return true;
    if (!this.effects.onSettled) return true;
    try {
      await this.effects.onSettled(outcome);
      this.sql.exec(`UPDATE as_room_state SET reported_at = ?, report_retry_at = NULL WHERE id = 1`, this.now());
      return true;
    } catch (error) {
      const attempts = state.report_attempts + 1;
      const retryAt = this.now() + Math.min(REPORT_RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 20), REPORT_RETRY_MAX_MS);
      this.sql.exec(`UPDATE as_room_state SET report_attempts = ?, report_retry_at = ? WHERE id = 1`, attempts, retryAt);
      const config = this.config();
      if (config) await this.emitLog(config, "system", "Room", `Reporting the outcome failed (attempt ${attempts}) and will be retried: ${error instanceof Error ? error.message : String(error)}`, "warning");
      await this.effects.scheduleTimeout(retryAt);
      return false;
    }
  }

  /** Transcript as `TelemetryEvent`s with stable ids (`<roomId>:m<id>`), so live events and history replays dedupe. */
  historyEvents(limit = 50): TelemetryEvent[] {
    const config = this.config();
    if (!config) return [];
    return this.transcript(limit).map((m) => this.messageEvent(config, m));
  }

  private insertMessage(senderId: string, senderRole: string, content: string, costUsd: number): number {
    const row = this.sql.exec<{ id: number }>(
      `INSERT INTO as_room_messages (sender_id, sender_role, content, cost_usd, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id`,
      senderId,
      senderRole,
      content.slice(0, 20_000),
      costUsd,
      this.now(),
    )[0];
    return Number(row?.id ?? this.maxMessageId());
  }

  private messageEvent(config: RoomConfig, m: RoomMessage, logType?: TelemetryEvent["logType"], status?: TelemetryEvent["status"]): TelemetryEvent {
    const counters = this.sql.exec<{ turns: number; cost: number | null; first: number | null }>(
      `SELECT (SELECT COUNT(*) FROM as_room_messages WHERE id <= ? AND sender_id NOT IN ('system', 'orchestrator')) AS turns,
              (SELECT SUM(cost_usd) FROM as_room_messages WHERE id <= ?) + COALESCE((SELECT SUM(cost_usd) FROM as_room_costs WHERE created_at <= ?), 0) AS cost,
              (SELECT MIN(created_at) FROM as_room_messages) AS first`,
      m.id,
      m.id,
      m.createdAt,
    )[0];
    const terminal = /^Session (completed|halted):/.exec(m.senderId === "system" ? m.content : "");
    const inferredStatus = status ?? (terminal ? (terminal[1] === "completed" ? "COMPLETED" : "HALTED") : undefined);
    return {
      id: `${config.roomId}:m${m.id}`,
      type: "message",
      runId: config.roomId,
      roomId: config.roomId,
      tenantId: config.tenantId,
      senderId: m.senderId,
      senderRole: m.senderRole,
      content: m.content.slice(0, 8000),
      logType: logType ?? (inferredStatus === "COMPLETED" ? "success" : inferredStatus === "HALTED" ? "error" : m.senderId === "system" ? "warning" : "info"),
      ...(inferredStatus ? { status: inferredStatus } : {}),
      turnCount: Number(counters?.turns ?? 0),
      accumulatedCost: Number(Number(counters?.cost ?? 0).toFixed(6)),
      runtimeSeconds: Math.max(0, Math.round((m.createdAt - Number(counters?.first ?? m.createdAt)) / 1000)),
      timestamp: m.createdAt,
    };
  }

  private async emitMessage(config: RoomConfig, id: number, logType?: TelemetryEvent["logType"], status?: TelemetryEvent["status"]): Promise<void> {
    const row = this.sql.exec<MessageRow>(`SELECT * FROM as_room_messages WHERE id = ?`, id)[0];
    if (!row) return;
    await this.effects.broadcast(this.messageEvent(config, toMessage(row), logType, status));
  }

  private async emitLog(config: RoomConfig, senderId: string, senderRole: string, content: string, logType: TelemetryEvent["logType"]): Promise<void> {
    const stats = this.stats();
    const first = this.sql.exec<{ t: number | null }>(`SELECT MIN(created_at) AS t FROM as_room_messages`)[0]?.t ?? this.now();
    await this.effects.broadcast({
      id: randomId("evt"),
      type: "log",
      runId: config.roomId,
      roomId: config.roomId,
      tenantId: config.tenantId,
      senderId,
      senderRole,
      content: content.slice(0, 8000),
      logType,
      turnCount: stats.turns,
      accumulatedCost: Number(stats.costUsd.toFixed(6)),
      runtimeSeconds: Math.max(0, Math.round((this.now() - Number(first)) / 1000)),
      timestamp: this.now(),
    });
  }
}
