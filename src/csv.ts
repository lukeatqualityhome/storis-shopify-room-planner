import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class CsvWriter {
  private stream;

  constructor(filePath: string, headers: readonly string[]) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.stream = createWriteStream(filePath, { encoding: "utf8" });
    this.stream.write(headers.map(escapeField).join(",") + "\n");
  }

  writeRow(row: readonly (string | number | null | undefined)[]): void {
    this.stream.write(row.map(escapeField).join(",") + "\n");
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stream.end((err: unknown) => (err ? reject(err) : resolve()));
    });
  }
}

function escapeField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
