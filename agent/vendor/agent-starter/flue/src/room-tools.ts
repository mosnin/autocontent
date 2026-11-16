import { type AnyAgentTool, CORE_MIGRATIONS, defineAgentTool, escapeProvenance, MigrationRunner, type SqlStore, type ToolExecutionContext } from "@agent-starter/core";
import { useAgentFinish, useDelivery, usePersistentState } from "@flue/runtime";
import * as v from "valibot";
import { resolveSql } from "./runtime.ts";
import { ALWAYS_MOUNTED_TAG } from "./safety.ts";

/** Minimal RPC surface of the AgentGroupChatRoom Durable Object stub. */
export interface RoomStub {
  open(
    config: {
      roomId: string;
      tenantId: string;
      objective: string;
      participants: Array<{ id: string; role: string; description: string }>;
      maxTurns: number;
      budgetUsd: number;
      speakerTimeoutMs: number;
      allowFanOut: boolean;
      leadId?: string;
      requester?: { agent: string; conversationId: string };
      selection?: "moderator" | "self";
    },
    kickoff: { senderId: string; senderRole: string; content: string },
  ): Promise<{ roomId: string }>;
  post(message: { senderId: string; senderRole: string; content: string; costUsd?: number }): Promise<unknown>;
  /** Spend reported outside a post (idempotent per key). Optional for older room classes. */
  recordCost?(entry: { key: string; participantId: string; costUsd: number }): Promise<unknown>;
}

export interface RoomToolOptions {
  room: (roomId: string) => RoomStub;
  /** Specialist roster the orchestrator may summon. */
  participants: Array<{ id: string; role: string; description: string }>;
  tenantId: () => string;
  /** The current agent's participant id when it is itself a room member. */
  selfId?: string;
  selfRole?: string;
  /** Agent name of the opener; the room reports its outcome back to this agent's conversation. Default "orchestrator". */
  agentName?: string;
  /** Participant the room's decider falls back to (default: the first chosen specialist). */
  leadId?: string;
  defaults?: { maxTurns?: number; budgetUsd?: number; speakerTimeoutMs?: number };
  /**
   * Cumulative USD this run has spent (e.g. the hook context's budget usage). Default: the run's cost ledger in the
   * agent's SQLite. `post_to_room` reports the delta since its last report, so every turn's cost reaches the room.
   */
  spentUsd?: (ctx: ToolExecutionContext) => number;
  sql?: () => SqlStore;
}

const migrated = new WeakSet<object>();
function sqlFor(override?: () => SqlStore): SqlStore {
  const store = resolveSql(override);
  if (!migrated.has(store)) {
    new MigrationRunner(store).migrateUp(CORE_MIGRATIONS);
    migrated.add(store);
  }
  return store;
}

/** Cumulative spend of a conversation, including budget-scoped rows (`<runId>#<scope>`). */
function runSpend(sql: SqlStore, runId: string): number {
  return Number(sql.exec<{ c: number | null }>(`SELECT SUM(cost_usd) AS c FROM as_budget_ledger WHERE run_id = ? OR substr(run_id, 1, ?) = ?`, runId, runId.length + 1, `${runId}#`)[0]?.c ?? 0);
}

function readMeta(sql: SqlStore, key: string): number {
  return Number(sql.exec<{ value: string }>(`SELECT value FROM as_runtime_meta WHERE key = ?`, key)[0]?.value ?? 0);
}

function writeMeta(sql: SqlStore, key: string, value: number): void {
  sql.exec(`INSERT INTO as_runtime_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, key, String(value), Date.now());
}

/**
 * Cost of this run not yet reported to the room: cumulative spend minus what earlier posts (and the turn guard)
 * already reported. Advances the marker, so each dollar is reported once.
 */
export function unreportedRoomCost(sql: SqlStore, runId: string, roomId: string, spent = runSpend(sql, runId)): number {
  const key = `room-cost:${roomId}`;
  const reported = readMeta(sql, key);
  const delta = Math.max(0, spent - reported);
  if (spent > reported) writeMeta(sql, key, spent);
  return Number(delta.toFixed(6));
}

/**
 * Multi-agent collaboration tools.
 *  - `spawn_collaboration_room` (orchestrator): open an isolated group-chat room with chosen specialists when a
 *    sub-task is too complex for one loop. Requires the tenant feature flag `features.multiAgentGroupChat`.
 *  - `post_to_room` (specialists): contribute a turn back to the room, reporting the turn's cost.
 */
export function createRoomTools(options: RoomToolOptions): AnyAgentTool[] {
  const ids = options.participants.map((p) => p.id) as [string, ...string[]];
  const tools: AnyAgentTool[] = [
    defineAgentTool({
      name: "spawn_collaboration_room",
      description: `Spawn an isolated group-chat room and summon specialist agents (${options.participants.map((p) => `${p.id}: ${p.role}`).join("; ")}) to solve a complex sub-task. Returns the room id; results stream to the dashboard and the room reports its outcome back to this conversation as a room-result signal.`,
      input: v.object({
        subTaskObjective: v.pipe(v.string(), v.minLength(10), v.maxLength(1000)),
        agents: v.pipe(v.array(v.picklist(ids)), v.minLength(1), v.maxLength(ids.length)),
        contextPayload: v.pipe(v.string(), v.maxLength(8000)),
      }),
      risk: "MEDIUM",
      sideEffect: "write",
      outputTrust: "trusted",
      tags: [ALWAYS_MOUNTED_TAG],
      execute: async ({ subTaskObjective, agents, contextPayload }, ctx) => {
        if (ctx.tenantConfig.features?.multiAgentGroupChat !== true) {
          return { status: "MULTI_AGENT_DISABLED", message: "Collaboration rooms are not enabled for this workspace (tenant feature multiAgentGroupChat). Do the work yourself or with subagents, and tell the user an admin can enable it." };
        }
        const tenantId = options.tenantId();
        const roomId = `room--${tenantId}--${ctx.idempotencyKey.slice(5, 29)}`;
        const chosen = options.participants.filter((p) => agents.includes(p.id));
        const leadId = options.leadId && agents.includes(options.leadId) ? options.leadId : chosen[0]?.id;
        await options.room(roomId).open(
          {
            roomId,
            tenantId,
            objective: subTaskObjective,
            participants: chosen,
            maxTurns: options.defaults?.maxTurns ?? 12,
            budgetUsd: options.defaults?.budgetUsd ?? 1,
            speakerTimeoutMs: options.defaults?.speakerTimeoutMs ?? 120_000,
            allowFanOut: true,
            ...(leadId ? { leadId } : {}),
            requester: { agent: options.agentName ?? "orchestrator", conversationId: ctx.runId },
          },
          { senderId: "orchestrator", senderRole: "Orchestrator", content: `Task objective: ${subTaskObjective}\n\nContext:\n${escapeProvenance(contextPayload)}` },
        );
        return { status: "COLLABORATION_ROOM_SPAWNED", roomId, agents, note: "The room reports back to this conversation with a room-result signal when it completes or halts; do not poll it." };
      },
    }),
  ];
  if (options.selfId) {
    const selfId = options.selfId;
    tools.push(
      defineAgentTool({
        name: "post_to_room",
        description: `Post your contribution to the group-chat room you were summoned into. Be concise and factual; include numbers and sources. Post exactly "NO_RESPONSE" if you have nothing new to add. The final synthesis must start with "DONE:".`,
        input: v.object({ roomId: v.pipe(v.string(), v.regex(/^room--/)), content: v.pipe(v.string(), v.minLength(1), v.maxLength(8000)) }),
        risk: "LOW",
        sideEffect: "write",
        idempotent: true,
        outputTrust: "trusted",
        tags: [ALWAYS_MOUNTED_TAG],
        execute: async ({ roomId, content }, ctx) => {
          if (!roomId.startsWith(`room--${options.tenantId()}--`)) throw new Error("Room belongs to another tenant");
          let costUsd: number;
          try {
            const sql = sqlFor(options.sql);
            costUsd = unreportedRoomCost(sql, ctx.runId, roomId, options.spentUsd ? options.spentUsd(ctx) : undefined);
          } catch {
            costUsd = 0; // no SQL (unusual host): the room still counts turns
          }
          const result = (await options.room(roomId).post({ senderId: selfId, senderRole: options.selfRole ?? selfId, content: escapeProvenance(content), costUsd })) as { refused?: string; reason?: string } | null;
          if (result?.refused) return { posted: false, refused: result.refused, message: result.reason ?? "The room refused this post." };
          return { posted: true, costUsd };
        },
      }),
    );
  }
  return tools;
}

export interface RoomTurnGuardOptions {
  room: (roomId: string) => RoomStub;
  /** This specialist's participant id. */
  selfId: string;
  /** Reminders before the turn is left to the room's own reply guard / timeout. Default 2. */
  maxReminders?: number;
  sql?: () => SqlStore;
}

/**
 * Reply guard for room specialists (call it in the agent function next to `useAgentStarter`). When a response to a
 * `room-turn` signal is about to end without a `post_to_room` call, it appends one reminder (at most `maxReminders`).
 * It also reports the response's usage to the room (`recordCost`, idempotent per summon) so the room's budget counts
 * the turn that is still running; `post_to_room` then skips what was already reported.
 */
export function useRoomTurnGuard(options: RoomTurnGuardOptions): void {
  const delivery = useDelivery();
  const [guard, setGuard] = usePersistentState<{ seq: string; reminders: number; reportedUsd: number }>("as:roomTurnGuard", { seq: "", reminders: 0, reportedUsd: 0 });
  const isRoomTurn = delivery.kind === "signal" && delivery.type === "room-turn";
  const roomId = isRoomTurn ? (delivery.attributes?.roomId ?? "") : "";
  const seq = isRoomTurn ? (delivery.attributes?.seq ?? "0") : "";
  useAgentFinish(async ({ response, append }) => {
    if (!isRoomTurn || !roomId.startsWith("room--")) return;
    const current = guard.seq === seq ? guard : { seq, reminders: 0, reportedUsd: 0 };
    const total = Number(response.usage.cost.total ?? 0);
    let reportedUsd = current.reportedUsd;
    if (total > current.reportedUsd && options.room(roomId).recordCost) {
      try {
        await options.room(roomId).recordCost?.({ key: `${roomId}:${options.selfId}:${seq}`, participantId: options.selfId, costUsd: total });
        const sql = sqlFor(options.sql);
        const key = `room-cost:${roomId}`;
        writeMeta(sql, key, readMeta(sql, key) + (total - current.reportedUsd));
        reportedUsd = total;
      } catch {
        // Best effort: post_to_room reports the ledger delta later.
      }
    }
    const posted = response.toolCalls.some((call) => call.tool === "post_to_room" && !call.isError);
    if (!posted && current.reminders < (options.maxReminders ?? 2)) {
      setGuard({ seq, reminders: current.reminders + 1, reportedUsd });
      append({ kind: "signal", type: "room-turn-reminder", body: `You were summoned into room ${roomId} but your turn is ending without a post. Call post_to_room once with your contribution (end with "DONE:" if it is the final synthesis), or post exactly "NO_RESPONSE" if you have nothing new to add.` });
      return;
    }
    if (reportedUsd !== current.reportedUsd || guard.seq !== seq) setGuard({ seq, reminders: current.reminders, reportedUsd });
  });
}
