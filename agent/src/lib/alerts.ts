import { type Notification, type Notifier, randomId, type TelemetryEvent, type TelemetrySink } from "@agent-starter/core";

/**
 * Operational alerts as telemetry (spec: "webhook to the SaaS" for AGENT_CRITICAL_HALT and budget breaches).
 * An alert is published to every telemetry sink (signed WebhookRelay to PRIMARY_SAAS_WEBHOOK_URL with the
 * durable outbox, Pusher) as a TelemetryEvent with `data.alert = <code>`, and additionally emailed when an
 * ops inbox is configured. Pure module (no bindings): platform.ts supplies the sinks and the email notifier.
 *  - AGENT_CRITICAL_HALT: a run halted for good (VM hard TTL, repeated deadlocks, emergency stop);
 *  - BUDGET_LIMIT_BREACHED: a budget scope's first breach;
 *  - SHADOW_DIVERGENCE: a shadowed background turn regressed or diverged from production (R-EVAL-10).
 */
export type OpsAlertCode = "AGENT_CRITICAL_HALT" | "BUDGET_LIMIT_BREACHED" | "SHADOW_DIVERGENCE";

export interface OpsAlert {
  code: OpsAlertCode;
  tenantId: string;
  runId: string;
  agent: string;
  content: string;
  data?: Record<string, unknown>;
}

export function opsAlertEvent(alert: OpsAlert, now = Date.now()): TelemetryEvent {
  return {
    id: randomId("alert"),
    type: alert.code === "BUDGET_LIMIT_BREACHED" ? "budget" : alert.code === "SHADOW_DIVERGENCE" ? "log" : "error",
    runId: alert.runId,
    tenantId: alert.tenantId,
    senderId: alert.agent,
    senderRole: alert.agent,
    content: `${alert.code}: ${alert.content}`.slice(0, 2000),
    // A shadow divergence is a warning about an experiment: the production run keeps its status.
    ...(alert.code === "SHADOW_DIVERGENCE" ? { logType: "warning" as const } : { logType: "error" as const, status: "HALTED" as const }),
    turnCount: 0,
    accumulatedCost: 0,
    runtimeSeconds: 0,
    timestamp: now,
    data: { ...alert.data, alert: alert.code },
  };
}

/** Publish an alert to every sink; one failing sink never blocks the others or the caller. */
export async function publishOpsAlert(sinks: readonly TelemetrySink[], alert: OpsAlert): Promise<void> {
  const event = opsAlertEvent(alert);
  await Promise.all(sinks.map((sink) => sink.publish(event).catch((error: unknown) => console.warn(`[alert] ${alert.code} sink failed`, error))));
}

/**
 * A Notifier for alerts (e.g. `useAgentStarter({ budgetBreach: { notifier } })`): every notification is
 * published as an `OpsAlert` telemetry event and, when `email()` returns a notifier and the recipient is
 * an email address, also sent by email.
 */
export function alertingNotifier(options: { code: OpsAlertCode; agent: string; sinks: () => readonly TelemetrySink[]; email?: () => Notifier | undefined; runIdOf?: (notification: Notification) => string }): Notifier {
  return {
    async notify(notification) {
      await publishOpsAlert(options.sinks(), {
        code: options.code,
        tenantId: notification.tenantId,
        runId: options.runIdOf?.(notification) ?? notification.threadKey.replace(/^[a-z-]+:/, ""),
        agent: options.agent,
        content: notification.subject,
        data: { text: notification.text.slice(0, 4000), threadKey: notification.threadKey },
      });
      const email = options.email?.();
      if (!email || !notification.to.includes("@")) return { status: "sent" as const };
      return email.notify(notification);
    },
  };
}
