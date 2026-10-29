import Database from "better-sqlite3";

/**
 * Pins the wall clock for a test file whose fixtures carry real dates (freshness windows,
 * authorization expiry). The clock starts at `startIso` and then moves at the real rate, so two
 * readings still come in order. Returns a function that puts the real clock back.
 */
export function pinClock(startIso: string): () => void {
  const RealDate = globalThis.Date;
  const offset = RealDate.parse(startIso) - RealDate.now();
  class PinnedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as [number]));
    }

    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = PinnedDate as DateConstructor;
  return () => {
    globalThis.Date = RealDate;
  };
}

/**
 * Points a better-sqlite3 database's 'now' (in strftime and julianday) at the current Date clock,
 * so database time and code time agree once the clock is pinned. Every other value is answered by
 * a plain SQLite, unchanged.
 */
export function pinDatabaseClock(database: Database.Database) {
  const plain = new Database(":memory:");
  const call = (name: string, args: unknown[]) =>
    plain.prepare(`SELECT ${name}(${args.map(() => "?").join(", ")})`).pluck().get(...args);
  const pinnedNow = (time: unknown) =>
    typeof time === "string" && time.toLowerCase() === "now" ? new Date().toISOString() : time;
  database.function("strftime", { varargs: true }, (format, time = "now", ...modifiers) =>
    call("strftime", [format, pinnedNow(time), ...modifiers]));
  database.function("julianday", { varargs: true }, (time = "now", ...modifiers) =>
    call("julianday", [pinnedNow(time), ...modifiers]));
}
