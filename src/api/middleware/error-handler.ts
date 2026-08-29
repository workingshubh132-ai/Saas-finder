import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { DomainError } from "../../domain/shared/errors.js";

/**
 * Every response follows { error, errorCode, message } — errorCode is
 * the shared taxonomy from domain/shared/error-codes.ts (M2 brief
 * Part 25). Never includes a stack trace or any secret value; internal
 * errors are logged server-side but returned to the caller as a
 * generic message.
 */
// Express identifies error-handling middleware by arity (4 params) — all four must stay even though two are unused.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "ValidationError", errorCode: "VALIDATION_ERROR", message: "Invalid request body", issues: err.issues });
    return;
  }
  if (err instanceof DomainError) {
    res.status(err.statusCode).json({ error: err.name, errorCode: err.errorCode, message: err.message });
    return;
  }
  // Only unexpected, non-domain errors reach here — logged for operators, never detailed to the caller.
  console.error(err);
  res.status(500).json({ error: "InternalError", errorCode: "INTERNAL_ERROR", message: "Unexpected server error" });
}
