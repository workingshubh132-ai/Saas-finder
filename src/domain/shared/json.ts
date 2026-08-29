/**
 * SQLite (M1's connector — see prisma/schema.prisma) stores every
 * JSON-shaped column as a plain TEXT column. These helpers keep the
 * encode/decode boundary in one place instead of scattered JSON.parse
 * calls that could throw on malformed data written outside the app.
 */

export function toJsonString(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function fromJsonString<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
