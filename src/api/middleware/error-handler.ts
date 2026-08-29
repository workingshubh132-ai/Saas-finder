import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { DomainError } from "../../domain/shared/errors.js";

// Express identifies error-handling middleware by arity (4 params) — all four must stay even though two are unused.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "ValidationError", message: "Invalid request body", issues: err.issues });
    return;
  }
  if (err instanceof DomainError) {
    res.status(err.statusCode).json({ error: err.name, message: err.message });
    return;
  }
  // Only unexpected, non-domain errors reach here.
  console.error(err);
  res.status(500).json({ error: "InternalError", message: "Unexpected server error" });
}
