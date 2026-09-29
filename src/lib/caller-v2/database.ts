/** D1 batch is transactional. Every statement must succeed or none is committed. */
export interface CallerStatement {
  bind(...values: unknown[]): CallerStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface CallerDb {
  prepare(sql: string): CallerStatement;
  batch(statements: CallerStatement[]): Promise<unknown[]>;
}
