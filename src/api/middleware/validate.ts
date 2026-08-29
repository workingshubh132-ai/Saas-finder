import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny, z } from "zod";

/** Parses+replaces req.body with the schema's output. Zod throws synchronously on failure, which Express 4 forwards to error-handler.ts on its own (no async involved). */
export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.body = schema.parse(req.body) as z.infer<T>;
    next();
  };
}
