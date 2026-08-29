import { PrismaClient } from "@prisma/client";

/**
 * Single Prisma client for the process. Prisma's SQLite connector
 * enables `PRAGMA foreign_keys = ON` automatically, so the foreign-key
 * and CHECK constraints in prisma/migrations are actually enforced.
 */
export const prisma = new PrismaClient();
