import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Express 4 does not catch rejected promises from async handlers — this forwards them to error-handler.ts. */
export function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
