import { Router } from "express";
import { learningRecordRepository } from "../../db/repositories/learning-record.repository.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";

export const learningRecordsRouter = Router();

/** Constitution §22's pipeline, stored (docs/M8_ARCHITECTURE_PROPOSAL.md §38). Never auto-applied anywhere — a human reads these. */
learningRecordsRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await learningRecordRepository.list());
  }),
);
