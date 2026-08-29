/** Institutional Memory (Constitution §27) — kept minimal per M1 scope: a
 *  typed, queryable record. No retrieval ranking or embeddings yet. */
export const MEMORY_TYPES = ["WORKING", "EPISODIC", "STRATEGIC"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export function isMemoryType(value: string): value is MemoryType {
  return (MEMORY_TYPES as readonly string[]).includes(value);
}
