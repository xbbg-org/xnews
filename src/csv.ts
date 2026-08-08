/**
 * RFC 4180 CSV parsing for provider payloads: quoted fields, escaped
 * quotes, embedded commas and newlines, CRLF and LF records, and a UTF-8
 * BOM. Pure — text in, records out — and fails closed on a quoted field
 * that never closes, because that is a truncated payload and a silently
 * shortened last row would read as data.
 */

/** Parses CSV text into raw records; fully empty records are dropped. */
export function parseCsvRecords(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let cellQuoted = false;
  let inQuotes = false;

  const endRecord = (): void => {
    record.push(cell);
    // A record whose only cell is an unquoted empty string is a blank
    // line (or the trailing-newline artifact), not data.
    if (record.length > 1 || cell.length > 0 || cellQuoted) records.push(record);
    record = [];
    cell = "";
    cellQuoted = false;
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
      cellQuoted = true;
    } else if (ch === ",") {
      record.push(cell);
      cell = "";
      cellQuoted = false;
    } else if (ch === "\n") {
      endRecord();
    } else if (ch === "\r") {
      if (source[i + 1] === "\n") i += 1;
      endRecord();
    } else {
      cell += ch;
    }
  }
  if (inQuotes) {
    throw new Error("CSV ends inside a quoted field; the payload is truncated");
  }
  if (cell.length > 0 || cellQuoted || record.length > 0) endRecord();
  return records;
}

/**
 * Parses CSV text whose first record is a header into one string record per
 * data row. Cells beyond the header are dropped; missing cells are `""`.
 */
export function parseCsvTable(text: string): Record<string, string>[] {
  const records = parseCsvRecords(text);
  const header = records[0];
  if (header === undefined) return [];
  return records.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i += 1) {
      const key = header[i];
      if (key === undefined) continue;
      row[key] = cells[i] ?? "";
    }
    return row;
  });
}
