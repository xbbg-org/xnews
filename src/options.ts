export function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError("limit must be a non-negative integer");
  }
  return limit;
}

export interface DateWindow {
  readonly sinceMs?: number;
  readonly untilMs?: number;
}

export function normalizeDateWindow(options: {
  readonly since?: string | Date;
  readonly until?: string | Date;
}): DateWindow {
  const sinceMs = normalizeDateBound(options.since, "since");
  const untilMs = normalizeDateBound(options.until, "until");
  if (sinceMs !== undefined && untilMs !== undefined && sinceMs > untilMs) {
    throw new RangeError("since must be before or equal to until");
  }
  return {
    ...(sinceMs !== undefined ? { sinceMs } : {}),
    ...(untilMs !== undefined ? { untilMs } : {}),
  };
}

export function hasDateWindow(options: {
  readonly since?: string | Date;
  readonly until?: string | Date;
}): boolean {
  return options.since !== undefined || options.until !== undefined;
}

function normalizeDateBound(
  value: string | Date | undefined,
  name: "since" | "until",
): number | undefined {
  if (value === undefined) return undefined;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new RangeError(`${name} must be a valid date`);
  }
  return timestamp;
}
