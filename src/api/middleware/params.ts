import type { Request } from "express";
import { ValidationError } from "../../domain/shared/errors.js";

/**
 * `req.params[name]` types as `string | undefined` under
 * noUncheckedIndexedAccess even though Express guarantees a value for
 * a matched `:name` segment. Route handlers should never assume that
 * holds — go through this instead of `req.params.x` directly, so a
 * genuinely missing param fails with a clear 400 rather than an
 * undefined slipping into a service call.
 */
export function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (!value) {
    throw new ValidationError(`Missing required route parameter: ${name}`);
  }
  return value;
}
