/**
 * CSV reading for campaign lists (RFC 4180): quoted fields, doubled quotes, commas and line
 * breaks inside quotes, CRLF or LF, and a leading byte-order mark. Column names are normalised
 * (trimmed, lower case, spaces and dashes to underscores) so "First Name" and first_name match
 * the {first_name} blank in the email words.
 */
export type CsvTable = { columns: string[]; rows: Array<Record<string, string>> };

export const normaliseColumn = (name: string) => name.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");

export function parseCsvRecords(text: string): string[][] {
  const input = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  let started = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') { field += '"'; index += 1; } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === "") { quoted = true; started = true; continue; }
    if (char === ",") { record.push(field); field = ""; started = true; continue; }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      record.push(field);
      if (record.length > 1 || record[0] !== "" || started) records.push(record);
      record = []; field = ""; started = false;
      continue;
    }
    field += char;
    started = true;
  }
  if (quoted) throw new Error("The CSV ends inside a quoted field.");
  if (field !== "" || record.length > 0 || started) { record.push(field); records.push(record); }
  return records.filter((row) => row.some((value) => value.trim() !== ""));
}

/** The table, keyed by normalised column names. Throws on a missing header, a duplicate column or a row with too many fields. */
export function parseCsv(text: string): CsvTable {
  const [header, ...body] = parseCsvRecords(text);
  if (!header) throw new Error("The CSV is empty.");
  const columns = header.map(normaliseColumn);
  if (columns.some((column) => !column)) throw new Error("A column in the CSV has no name.");
  const duplicate = columns.find((column, index) => columns.indexOf(column) !== index);
  if (duplicate) throw new Error(`The CSV has the column "${duplicate}" twice.`);
  const rows = body.map((values, index) => {
    if (values.length > columns.length && values.slice(columns.length).some((value) => value.trim() !== "")) {
      throw new Error(`Row ${index + 2} has more values than the header has columns.`);
    }
    return Object.fromEntries(columns.map((column, position) => [column, (values[position] ?? "").trim()]));
  });
  return { columns, rows };
}
