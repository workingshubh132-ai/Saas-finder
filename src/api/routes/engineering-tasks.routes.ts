import { Router } from "express";
import { codeReviewRepository } from "../../db/repositories/code-review.repository.js";
import { qaReportRepository } from "../../db/repositories/qa-report.repository.js";
import { securityReviewRepository } from "../../db/repositories/security-review.repository.js";
import { engineeringTaskService } from "../../services/engineering-task.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";

export const engineeringTasksRouter = Router();

engineeringTasksRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await engineeringTaskService.getOrThrow(requireParam(req, "id")));
  }),
);

engineeringTasksRouter.get(
  "/:id/code-reviews",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await codeReviewRepository.listForTask(requireParam(req, "id")));
  }),
);

engineeringTasksRouter.get(
  "/:id/qa-reports",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await qaReportRepository.listForTask(requireParam(req, "id")));
  }),
);

engineeringTasksRouter.get(
  "/:id/security-reviews",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await securityReviewRepository.listForTask(requireParam(req, "id")));
  }),
);
