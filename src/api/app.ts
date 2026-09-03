import express, { type Express } from "express";
import { agentExecutionsRouter } from "./routes/agent-executions.routes.js";
import { agentsRouter } from "./routes/agents.routes.js";
import { auditRouter } from "./routes/audit.routes.js";
import { authorizeRouter } from "./routes/authorize.routes.js";
import { ceoRecommendationsRouter } from "./routes/ceo-recommendations.routes.js";
import { claimsRouter } from "./routes/claims.routes.js";
import { competitorsRouter } from "./routes/competitors.routes.js";
import { customerDiscoveryMemosRouter } from "./routes/customer-discovery-memos.routes.js";
import { customerResponsesRouter } from "./routes/customer-responses.routes.js";
import { decisionCyclesRouter } from "./routes/decision-cycles.routes.js";
import { decisionRecordsRouter } from "./routes/decision-records.routes.js";
import { decisionsRouter } from "./routes/decisions.routes.js";
import { engineeringTasksRouter } from "./routes/engineering-tasks.routes.js";
import { evidenceRouter } from "./routes/evidence.routes.js";
import { eventsRouter } from "./routes/events.routes.js";
import { icpProfilesRouter } from "./routes/icp-profiles.routes.js";
import { identitiesRouter } from "./routes/identities.routes.js";
import { investmentMemosRouter } from "./routes/investment-memos.routes.js";
import { opportunitiesRouter } from "./routes/opportunities.routes.js";
import { outreachExperimentsRouter } from "./routes/outreach-experiments.routes.js";
import { outreachMessagesRouter } from "./routes/outreach-messages.routes.js";
import { problemsRouter } from "./routes/problems.routes.js";
import { productReviewMemosRouter } from "./routes/product-review-memos.routes.js";
import { productsRouter } from "./routes/products.routes.js";
import { prospectsRouter } from "./routes/prospects.routes.js";
import { researchCyclesRouter } from "./routes/research-cycles.routes.js";
import { researchQueueRouter } from "./routes/research-queue.routes.js";
import { researchRouter } from "./routes/research.routes.js";
import { researchSignalsRouter } from "./routes/research-signals.routes.js";
import { signalClustersRouter } from "./routes/signal-clusters.routes.js";
import { signalsRouter } from "./routes/signals.routes.js";
import { tasksRouter } from "./routes/tasks.routes.js";
import { errorHandler } from "./middleware/error-handler.js";

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/identities", identitiesRouter);
  app.use("/api/agents", agentsRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/evidence", evidenceRouter);
  app.use("/api/opportunities", opportunitiesRouter);
  app.use("/api/authorize", authorizeRouter);
  app.use("/api/decisions", decisionsRouter);
  app.use("/api/audit-logs", auditRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/research-signals", researchSignalsRouter);
  app.use("/api/research", researchRouter);
  app.use("/api/agent-executions", agentExecutionsRouter);
  // M3 — docs/M3_ARCHITECTURE_PROPOSAL.md §17.
  app.use("/api/signals", signalsRouter);
  app.use("/api/signal-clusters", signalClustersRouter);
  app.use("/api/problems", problemsRouter);
  app.use("/api/competitors", competitorsRouter);
  app.use("/api/research-cycles", researchCyclesRouter);
  app.use("/api/research-queue", researchQueueRouter);
  // M4 — docs/M4_ARCHITECTURE_PROPOSAL.md §22.
  app.use("/api/claims", claimsRouter);
  app.use("/api/decision-cycles", decisionCyclesRouter);
  app.use("/api/ceo-recommendations", ceoRecommendationsRouter);
  app.use("/api/investment-memos", investmentMemosRouter);
  app.use("/api/decision-records", decisionRecordsRouter);
  // M5 — docs/M5_ARCHITECTURE_PROPOSAL.md §23.
  app.use("/api/icp-profiles", icpProfilesRouter);
  app.use("/api/prospects", prospectsRouter);
  app.use("/api/outreach-experiments", outreachExperimentsRouter);
  app.use("/api/outreach-messages", outreachMessagesRouter);
  app.use("/api/customer-responses", customerResponsesRouter);
  app.use("/api/customer-discovery-memos", customerDiscoveryMemosRouter);
  // M6 — docs/M6_ARCHITECTURE_PROPOSAL.md §21.
  app.use("/api/products", productsRouter);
  app.use("/api/engineering-tasks", engineeringTasksRouter);
  app.use("/api/product-review-memos", productReviewMemosRouter);

  app.use(errorHandler);

  return app;
}
