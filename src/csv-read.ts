import { readFileSync } from "node:fs";

// Tiny RFC4180-aware CSV reader. Handles "quoted" fields, "" escapes inside quotes,
// and \r\n line endings. The CsvWriter in this repo writes a strict subset.
export function readCsv(path: string): { headers: string[]; rows: string[][] } {
  const text = readFileSync(path, "utf8");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      record.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      if (text[i + 1] === "\n") i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      i += 1;
      continue;
    }
    if (c === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // Trailing field/record (if no terminal newline).
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const headers = records.shift() ?? [];
  // Drop fully-empty trailing rows.
  while (records.length > 0) {
    const last = records[records.length - 1];
    if (!last || (last.length === 1 && last[0] === "")) records.pop();
    else break;
  }
  return { headers, rows: records };
}
