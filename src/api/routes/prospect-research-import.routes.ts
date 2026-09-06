import { Router } from "express";
import { realProspectImportSchema, type RealProspectImportInput } from "../../domain/prospect-research/real-prospect-import.js";
import { realProspectImportService } from "../../services/real-prospect-import.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireHuman } from "../middleware/authenticate.js";
import { validateBody } from "../middleware/validate.js";

export const prospectResearchImportRouter = Router();

/**
 * The operator-fed REAL prospect-research ingestion boundary (Part 47)
 * — human-gated (requireHuman): this request itself asserts "a human
 * operator verified this real public business," so the caller must be
 * a verified HUMAN identity, not merely any authenticated actor.
 * Ends at a `Prospect` in status DISCOVERED — the existing, unmodified
 * qualification/drafting/approval pipeline takes over from there.
 */
prospectResearchImportRouter.post(
  "/import",
  requireHuman(),
  validateBody(realProspectImportSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as RealProspectImportInput;
    const result = await realProspectImportService.import(body);
    res.status(201).json(result);
  }),
);
