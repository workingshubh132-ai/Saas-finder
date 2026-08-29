import { Router } from "express";
import { eventRepository } from "../../db/repositories/event.repository.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireHuman } from "../middleware/authenticate.js";

export const eventsRouter = Router();

eventsRouter.get(
  "/",
  requireHuman(),
  asyncHandler(async (req, res) => {
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    res.json(await eventRepository.list({ type, limit: Number.isFinite(limit) ? limit : undefined }));
  }),
);
