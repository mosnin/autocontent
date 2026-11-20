import { AgentError } from "../errors.ts";
import type { SqlStore } from "./ports.ts";

export interface Migration {
  version: number;
  name: string;
  up: string[];
  down: string[];
}

export interface MigrationSet {
  /** Namespaces let several packages version their tables independently in one database. */
  namespace: string;
  migrations: Migration[];
}

export interface MigrationLogger {
  info(message: string): void;
  error(message: string): void;
}

/**
 * Transactional, namespaced schema migrations for Durable Object SQLite (or any
 * SqlStore). Each migration's `up` runs atomically: if any statement fails the
 * transaction rolls back, the version is not recorded and MIGRATION_RUNNER_ABORTED
 * is thrown. `rollbackTo` replays `down` scripts in reverse for deliberate
 * rollbacks (blue/green reverts, deadlock recovery).
 */
export class MigrationRunner {
  constructor(
    private readonly sql: SqlStore,
    private readonly logger: MigrationLogger = { info: () => {}, error: (m) => console.error(m) },
  ) {
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS as_schema_version (
        namespace TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, version)
      )`,
    );
  }

  currentVersion(namespace: string): number {
    const row = this.sql.exec<{ v: number | null }>(`SELECT MAX(version) AS v FROM as_schema_version WHERE namespace = ?`, namespace)[0];
    return Number(row?.v ?? 0);
  }

  migrateUp(set: MigrationSet): { applied: number[]; version: number } {
    validate(set);
    const current = this.currentVersion(set.namespace);
    const applied: number[] = [];
    for (const migration of [...set.migrations].sort((a, b) => a.version - b.version)) {
      if (migration.version <= current) continue;
      try {
        this.sql.transaction(() => {
          for (const statement of migration.up) this.sql.exec(statement);
          this.sql.exec(
            `INSERT INTO as_schema_version (namespace, version, name, applied_at) VALUES (?, ?, ?, ?)`,
            set.namespace,
            migration.version,
            migration.name,
            Date.now(),
          );
        });
        applied.push(migration.version);
        this.logger.info(`[migration] ${set.namespace}@${migration.version} ${migration.name} applied`);
      } catch (error) {
        this.logger.error(`[migration] ${set.namespace}@${migration.version} failed; transaction rolled back: ${String(error)}`);
        throw new AgentError("MIGRATION_RUNNER_ABORTED", `Migration ${set.namespace}@${migration.version} (${migration.name}) failed`, {
          cause: error,
          details: { namespace: set.namespace, version: migration.version },
        });
      }
    }
    return { applied, version: this.currentVersion(set.namespace) };
  }

  rollbackTo(set: MigrationSet, targetVersion: number): { reverted: number[] } {
    const current = this.currentVersion(set.namespace);
    const reverted: number[] = [];
    const descending = [...set.migrations].filter((m) => m.version > targetVersion && m.version <= current).sort((a, b) => b.version - a.version);
    for (const migration of descending) {
      this.sql.transaction(() => {
        for (const statement of migration.down) this.sql.exec(statement);
        this.sql.exec(`DELETE FROM as_schema_version WHERE namespace = ? AND version = ?`, set.namespace, migration.version);
      });
      reverted.push(migration.version);
      this.logger.info(`[migration] ${set.namespace}@${migration.version} reverted`);
    }
    return { reverted };
  }
}

function validate(set: MigrationSet): void {
  const seen = new Set<number>();
  for (const m of set.migrations) {
    if (!Number.isInteger(m.version) || m.version < 1) throw new AgentError("CONFIG_INVALID", `Invalid migration version ${m.version}`);
    if (seen.has(m.version)) throw new AgentError("CONFIG_INVALID", `Duplicate migration version ${m.version} in ${set.namespace}`);
    seen.add(m.version);
  }
}
