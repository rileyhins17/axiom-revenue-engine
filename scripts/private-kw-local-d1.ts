import type Database from "better-sqlite3";

import type { D1DatabaseLike, D1PreparedStatementLike } from "../src/lib/cloudflare";

export type PrivateKwLocalSqlValue = string | number | null;

export type PrivateKwLocalD1Statement = Readonly<{
  statementId?: string;
  sql: string;
  bindings: readonly PrivateKwLocalSqlValue[];
}>;

export type PrivateKwLocalD1BatchResult = Readonly<{
  success: true;
  results: Array<Record<string, unknown>>;
  changes: number;
}>;

function assertSupportedBindings(values: readonly unknown[]) {
  for (const value of values) {
    if (
      value !== null
      && typeof value !== "string"
      && (typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new TypeError("Unsupported SQLite binding; use a string, finite number, or null.");
    }
  }
}

function assertOpen(database: Database.Database) {
  if (!database.open) {
    throw new Error("The supplied local SQLite database handle is closed.");
  }
}

function lastRowId(value: number | bigint) {
  return typeof value === "bigint" ? value.toString() : value;
}

let savepointCounter = 0;

function executeBatchStatement(
  database: Database.Database,
  statement: PrivateKwLocalD1Statement,
): PrivateKwLocalD1BatchResult {
  assertSupportedBindings(statement.bindings);
  const prepared = database.prepare(statement.sql);
  if (prepared.reader) {
    return {
      success: true,
      results: prepared.all(...statement.bindings) as Array<Record<string, unknown>>,
      changes: 0,
    };
  }
  const mutation = prepared.run(...statement.bindings);
  return {
    success: true,
    results: [],
    changes: mutation.changes,
  };
}

class PrivateKwLocalD1PreparedStatement implements D1PreparedStatementLike {
  private readonly values: readonly PrivateKwLocalSqlValue[];

  constructor(
    private readonly database: Database.Database,
    private readonly sql: string,
    values: readonly PrivateKwLocalSqlValue[] = [],
  ) {
    assertSupportedBindings(values);
    this.values = values;
  }

  bind(...values: unknown[]): D1PreparedStatementLike {
    assertSupportedBindings(values);
    return new PrivateKwLocalD1PreparedStatement(
      this.database,
      this.sql,
      values as PrivateKwLocalSqlValue[],
    );
  }

  async all<T = Record<string, unknown>>(): Promise<{ results?: T[] }> {
    assertOpen(this.database);
    const prepared = this.database.prepare(this.sql);
    if (!prepared.reader) {
      throw new Error("D1 all() requires a reader statement.");
    }
    return { results: prepared.all(...this.values) as T[] };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    assertOpen(this.database);
    const prepared = this.database.prepare(this.sql);
    if (!prepared.reader) {
      throw new Error("D1 first() requires a reader statement.");
    }
    const row = prepared.get(...this.values) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column === undefined ? row : row[column]) as T;
  }

  async run(): Promise<{
    meta?: {
      changes?: number;
      last_row_id?: number | string;
    };
  }> {
    assertOpen(this.database);
    const mutation = this.database.prepare(this.sql).run(...this.values);
    return {
      meta: {
        changes: mutation.changes,
        last_row_id: lastRowId(mutation.lastInsertRowid),
      },
    };
  }
}

export interface PrivateKwLocalD1Database extends D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: readonly PrivateKwLocalD1Statement[]): Promise<readonly PrivateKwLocalD1BatchResult[]>;
}

export function createPrivateKwLocalD1Adapter(database: Database.Database): PrivateKwLocalD1Database {
  assertOpen(database);
  return {
    prepare(query) {
      assertOpen(database);
      return new PrivateKwLocalD1PreparedStatement(database, query);
    },
    async batch(statements) {
      assertOpen(database);
      const execute = () => statements.map((statement) => executeBatchStatement(database, statement));
      if (!database.inTransaction) {
        return database.transaction(execute).immediate();
      }
      const savepoint = `private_kw_d1_batch_${++savepointCounter}`;
      database.exec(`SAVEPOINT "${savepoint}"`);
      try {
        const result = execute();
        database.exec(`RELEASE SAVEPOINT "${savepoint}"`);
        return result;
      } catch (error) {
        database.exec(`ROLLBACK TO SAVEPOINT "${savepoint}"`);
        database.exec(`RELEASE SAVEPOINT "${savepoint}"`);
        throw error;
      }
    },
  };
}
