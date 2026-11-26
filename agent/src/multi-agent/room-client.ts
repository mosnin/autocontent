import type { RoomStub } from "@agent-starter/flue";
import { bindings } from "../lib/platform.ts";

/** Typed RPC stub for a group-chat room (rooms are named by their tenant-scoped id). */
export function roomStub(roomId: string): RoomStub {
  const ns = bindings().GROUP_CHAT_ROOM;
  if (!ns) throw new Error("GROUP_CHAT_ROOM binding is not configured");
  return ns.get(ns.idFromName(roomId)) as unknown as RoomStub;
}
