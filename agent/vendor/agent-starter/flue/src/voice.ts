/**
 * Voice channel mode (contract shared with @agent-starter/livekit and the
 * agentAuth middleware in http.ts).
 *
 * The channel is decided PER DELIVERY. `agentAuth` stamps server-trusted
 * attributes on every agent POST (`channel`: "voice" for the voice agent's
 * token, else "chat"; optionally `route`: "SIMPLE" | "COMPLEX") and strips any
 * client-supplied value. Flue 2.3.0 keeps attributes only on `kind: "signal"`
 * deliveries (its `kind: "user"` schema strips unknown keys), so a voice turn
 * is delivered as a `voice-utterance` signal and a `kind: "user"` message is a
 * chat turn. `useAgentStarter` reads the delivery at render (`deliveryChannel`
 * in http.ts), so the model and voice mode follow the caller, not the
 * conversation's creation data. Server signals without a stamp (approvals,
 * lifecycle appends) keep the channel of the delivery that started the
 * response; the creation-time `initialData.scopes` is the last fallback.
 *
 * In voice mode `useAgentStarter` switches the primary model to `model.voice`
 * (or `model.firstLine`), keeps the fallbacks, turns reasoning off, adds
 * VOICE_INSTRUCTION and never uses generative UI.
 */
export const VOICE_SCOPE = "channel:voice";

export const VOICE_INSTRUCTION =
  "VOICE CHANNEL: reply in short spoken sentences; no markdown, lists, tables or URLs; confirm actions verbally; when something is pending approval say so plainly.";

/** True when the conversation was opened on the voice channel (`initialData.scopes` includes "channel:voice"). */
export function isVoiceChannel(initialData: { scopes?: readonly string[] | undefined } | null | undefined): boolean {
  return Array.isArray(initialData?.scopes) && initialData.scopes.includes(VOICE_SCOPE);
}
