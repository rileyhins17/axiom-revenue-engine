/** Minimal D1 surface the FCC engine uses (real D1 in Workers, a better-sqlite3 adapter in tests). */
export type ProspectDb = {
  prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null>; run(): Promise<unknown> } };
};
