import { PersistentAgentControl as BasePersistentAgentControl } from "@agent-starter/cloudflare";
import type { PersistentTrigger, TelemetrySink } from "@agent-starter/core";
import { telemetrySinks } from "../lib/platform.ts";
import { dispatchPersistentTurn } from "./dispatch.ts";
import type { PersistentEnv } from "./env.ts";

/**
 * Trusted control plane of ONE persistent agent (instance `<tenantId>/<agentId>`): versioned config and proposals,
 * the heartbeat / schedule alarm (quiet hours, single flight, skip records), the kill switch, the append-only audit
 * log, turn summaries, provenance-tagged memory with snapshots. The agent never writes here directly: its tools can
 * only propose changes and write untrusted memory through the RPC port.
 */
export class PersistentAgentControl extends BasePersistentAgentControl<PersistentEnv> {
  protected override async dispatch(trigger: PersistentTrigger): Promise<void> {
    await dispatchPersistentTurn(this.env, trigger);
  }

  protected override telemetrySinks(): TelemetrySink[] {
    return telemetrySinks();
  }
}
