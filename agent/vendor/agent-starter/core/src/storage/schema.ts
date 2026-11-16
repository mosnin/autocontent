import type { MigrationSet } from "./migrations.ts";

/**
 * Every table the core engine uses, versioned. Tables are prefixed `as_` so they
 * never collide with Flue's or the Cloudflare Agents SDK's own tables when they
 * share a Durable Object database.
 */
export const CORE_MIGRATIONS: MigrationSet = {
  namespace: "agent-starter-core",
  migrations: [
    {
      version: 1,
      name: "runs-ledger-idempotency",
      up: [
        `CREATE TABLE IF NOT EXISTS as_runtime_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS as_runs (
          run_id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          agent TEXT NOT NULL,
          objective TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL,
          turn_count INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          code_version TEXT NOT NULL DEFAULT '',
          error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_heartbeat_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS as_runs_status ON as_runs(status, last_heartbeat_at)`,
        `CREATE TABLE IF NOT EXISTS as_budget_ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          model TEXT,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          reasoning_tokens INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          vm_seconds REAL NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS as_budget_ledger_run ON as_budget_ledger(run_id)`,
        `CREATE TABLE IF NOT EXISTS as_idempotency (
          key TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          tool TEXT NOT NULL,
          status TEXT NOT NULL,
          result TEXT,
          error TEXT,
          created_at INTEGER NOT NULL,
          completed_at INTEGER
        )`,
        `CREATE TABLE IF NOT EXISTS as_steps (
          run_id TEXT NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          result TEXT,
          error TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          PRIMARY KEY (run_id, name)
        )`,
        `CREATE TABLE IF NOT EXISTS as_checkpoints (
          run_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          label TEXT NOT NULL,
          state_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (run_id, seq)
        )`,
        `CREATE TABLE IF NOT EXISTS as_audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT,
          tenant_id TEXT NOT NULL,
          actor TEXT NOT NULL,
          action TEXT NOT NULL,
          target TEXT,
          detail_json TEXT,
          created_at INTEGER NOT NULL
        )`,
      ],
      down: [
        `DROP TABLE IF EXISTS as_audit_log`,
        `DROP TABLE IF EXISTS as_checkpoints`,
        `DROP TABLE IF EXISTS as_steps`,
        `DROP TABLE IF EXISTS as_idempotency`,
        `DROP TABLE IF EXISTS as_budget_ledger`,
        `DROP TABLE IF EXISTS as_runs`,
        `DROP TABLE IF EXISTS as_runtime_meta`,
      ],
    },
    {
      version: 2,
      name: "approvals-recovery",
      up: [
        `CREATE TABLE IF NOT EXISTS as_approvals (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          tool TEXT NOT NULL,
          tool_call_id TEXT NOT NULL,
          args_json TEXT NOT NULL,
          args_hash TEXT NOT NULL,
          risk_tier TEXT NOT NULL,
          reason TEXT NOT NULL,
          status TEXT NOT NULL,
          nonce TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          decided_at INTEGER,
          decided_by TEXT,
          decision_note TEXT
        )`,
        `CREATE INDEX IF NOT EXISTS as_approvals_run ON as_approvals(run_id, status)`,
        `CREATE TABLE IF NOT EXISTS as_recovery_state (
          scope TEXT PRIMARY KEY,
          state TEXT NOT NULL,
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          updated_at INTEGER NOT NULL
        )`,
      ],
      down: [`DROP TABLE IF EXISTS as_recovery_state`, `DROP TABLE IF EXISTS as_approvals`],
    },
    {
      version: 3,
      name: "cognition",
      up: [
        `CREATE TABLE IF NOT EXISTS as_scratchpad (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL,
          current_focus TEXT NOT NULL,
          facts_established TEXT NOT NULL,
          failed_attempts TEXT NOT NULL,
          next_planned_action TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS as_scratchpad_run ON as_scratchpad(run_id, id)`,
        `CREATE TABLE IF NOT EXISTS as_reflections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL,
          step_name TEXT NOT NULL,
          executed_action TEXT NOT NULL,
          observed_error TEXT NOT NULL,
          critic_evaluation TEXT,
          pivoted_strategy TEXT,
          fingerprint TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS as_goal_tree (
          run_id TEXT NOT NULL,
          id TEXT NOT NULL,
          parent_id TEXT,
          tenant_id TEXT NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          risk_tier TEXT NOT NULL,
          retry_count INTEGER NOT NULL DEFAULT 0,
          depends_on TEXT NOT NULL DEFAULT '[]',
          allowed_tools TEXT NOT NULL DEFAULT '[]',
          result TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (run_id, id)
        )`,
        `CREATE TABLE IF NOT EXISTS as_fsm (
          machine_id TEXT PRIMARY KEY,
          state TEXT NOT NULL,
          context_json TEXT NOT NULL,
          history_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
      ],
      down: [`DROP TABLE IF EXISTS as_fsm`, `DROP TABLE IF EXISTS as_goal_tree`, `DROP TABLE IF EXISTS as_reflections`, `DROP TABLE IF EXISTS as_scratchpad`],
    },
    {
      version: 4,
      name: "entity-graph-memory",
      up: [
        `CREATE TABLE IF NOT EXISTS as_memory_entities (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS as_memory_entities_tenant ON as_memory_entities(tenant_id, type)`,
        `CREATE TABLE IF NOT EXISTS as_memory_attributes (
          entity_id TEXT NOT NULL REFERENCES as_memory_entities(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 1.0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (entity_id, key)
        )`,
        `CREATE TABLE IF NOT EXISTS as_memory_relationships (
          source_id TEXT NOT NULL REFERENCES as_memory_entities(id) ON DELETE CASCADE,
          target_id TEXT NOT NULL REFERENCES as_memory_entities(id) ON DELETE CASCADE,
          relationship_type TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 1.0,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (source_id, target_id, relationship_type)
        )`,
      ],
      down: [`DROP TABLE IF EXISTS as_memory_relationships`, `DROP TABLE IF EXISTS as_memory_attributes`, `DROP TABLE IF EXISTS as_memory_entities`],
    },
    {
      version: 5,
      name: "messaging-sync-routing",
      up: [
        `CREATE TABLE IF NOT EXISTS as_inbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_key TEXT NOT NULL,
          event_id TEXT NOT NULL UNIQUE,
          payload TEXT NOT NULL,
          received_at INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING'
        )`,
        `CREATE TABLE IF NOT EXISTS as_outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          destination TEXT NOT NULL,
          payload TEXT NOT NULL,
          headers_json TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          last_error TEXT,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS as_sync_ledger (ledger_id INTEGER PRIMARY KEY, synced_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS as_router_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT,
          tenant_id TEXT,
          routed_to TEXT NOT NULL,
          profile TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
      ],
      down: [`DROP TABLE IF EXISTS as_router_log`, `DROP TABLE IF EXISTS as_sync_ledger`, `DROP TABLE IF EXISTS as_outbox`, `DROP TABLE IF EXISTS as_inbox`],
    },
    {
      version: 6,
      name: "agent-git",
      up: [
        `CREATE TABLE IF NOT EXISTS as_git_commits (
          id TEXT PRIMARY KEY,
          workspace TEXT NOT NULL,
          branch TEXT NOT NULL,
          parent_ids TEXT NOT NULL,
          author TEXT NOT NULL,
          message TEXT NOT NULL,
          tree_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS as_git_refs (
          workspace TEXT NOT NULL,
          branch TEXT NOT NULL,
          head TEXT,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (workspace, branch)
        )`,
      ],
      down: [`DROP TABLE IF EXISTS as_git_refs`, `DROP TABLE IF EXISTS as_git_commits`],
    },
  ],
};
