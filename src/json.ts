export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Parses a JSON API body, throwing a provider-friendly error on non-JSON text. */
export function parseJsonRecord(body: string, apiLabel: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  if (!isRecord(parsed)) {
    throw new Error(`unexpected non-JSON ${apiLabel} response: ${body.slice(0, 120)}`);
  }
  return parsed;
}

export function recordArray(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function stringArrayField(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}
