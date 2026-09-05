import express, { type Express } from "express";
import { agentExecutionsRouter } from "./routes/agent-executions.routes.js";
import { agentsRouter } from "./routes/agents.routes.js";
import { alertsRouter } from "./routes/alerts.routes.js";
import { anomaliesRouter } from "./routes/anomalies.routes.js";
import { auditRouter } from "./routes/audit.routes.js";
import { authorizeRouter } from "./routes/authorize.routes.js";
import { billingAccountsRouter } from "./routes/billing-accounts.routes.js";
import { billingPlansRouter } from "./routes/billing-plans.routes.js";
import { billingWebhooksRouter } from "./routes/billing-webhooks.routes.js";
import { businessHealthsRouter } from "./routes/business-healths.routes.js";
import { businessMetricsRouter } from "./routes/business-metrics.routes.js";
import { businessReviewMemosRouter } from "./routes/business-review-memos.routes.js";
import { ceoRecommendationsRouter } from "./routes/ceo-recommendations.routes.js";
import { cohortsRouter } from "./routes/cohorts.routes.js";
import { companyRouter } from "./routes/company.routes.js";
import { controlPlaneRouter } from "./routes/control-plane.routes.js";
import { claimsRouter } from "./routes/claims.routes.js";
import { competitorsRouter } from "./routes/competitors.routes.js";
import { deploymentPlansRouter } from "./routes/deployment-plans.routes.js";
import { deploymentsRouter } from "./routes/deployments.routes.js";
import { goToMarketPlansRouter } from "./routes/go-to-market-plans.routes.js";
import { growthExperimentsRouter } from "./routes/growth-experiments.routes.js";
import { incidentsRouter } from "./routes/incidents.routes.js";
import { launchReviewMemosRouter } from "./routes/launch-review-memos.routes.js";
import { learningRecordsRouter } from "./routes/learning-records.routes.js";
import { portfolioRouter } from "./routes/portfolio.routes.js";
import { predictionOutcomesRouter } from "./routes/prediction-outcomes.routes.js";
import { pricingModelsRouter } from "./routes/pricing-models.routes.js";
import { supportCasesRouter } from "./routes/support-cases.routes.js";
import { customerDiscoveryMemosRouter } from "./routes/customer-discovery-memos.routes.js";
import { customerResponsesRouter } from "./routes/customer-responses.routes.js";
import { decisionCyclesRouter } from "./routes/decision-cycles.routes.js";
import { decisionQualityRouter } from "./routes/decision-quality.routes.js";
import { decisionRecordsRouter } from "./routes/decision-records.routes.js";
import { decisionsRouter } from "./routes/decisions.routes.js";
import { engineeringTasksRouter } from "./routes/engineering-tasks.routes.js";
import { evidenceRouter } from "./routes/evidence.routes.js";
import { eventsRouter } from "./routes/events.routes.js";
import { founderRouter } from "./routes/founder.routes.js";
import { icpProfilesRouter } from "./routes/icp-profiles.routes.js";
import { identitiesRouter } from "./routes/identities.routes.js";
import { investmentMemosRouter } from "./routes/investment-memos.routes.js";
import { learningRouter } from "./routes/learning.routes.js";
import { operatingCyclesRouter } from "./routes/operating-cycles.routes.js";
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

  // M7 — docs/M7_ARCHITECTURE_PROPOSAL.md §20, §34: the webhook route
  // needs the RAW request bytes for HMAC signature verification, so it
  // is mounted with express.raw() ahead of the global express.json()
  // below — Express applies path-scoped middleware in mount order, so
  // this path never reaches the JSON parser.
  app.use("/api/billing-webhooks", express.raw({ type: "application/json" }), billingWebhooksRouter);
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
  // M7 — docs/M7_ARCHITECTURE_PROPOSAL.md §34 (billing-webhooks mounted above, ahead of express.json()).
  app.use("/api/deployment-plans", deploymentPlansRouter);
  app.use("/api/deployments", deploymentsRouter);
  app.use("/api/pricing-models", pricingModelsRouter);
  app.use("/api/billing-plans", billingPlansRouter);
  app.use("/api/billing-accounts", billingAccountsRouter);
  app.use("/api/go-to-market-plans", goToMarketPlansRouter);
  app.use("/api/business-metrics", businessMetricsRouter);
  app.use("/api/incidents", incidentsRouter);
  app.use("/api/support-cases", supportCasesRouter);
  app.use("/api/launch-review-memos", launchReviewMemosRouter);

  app.use("/api/growth-experiments", growthExperimentsRouter);
  app.use("/api/business-healths", businessHealthsRouter);
  app.use("/api/anomalies", anomaliesRouter);
  app.use("/api/cohorts", cohortsRouter);
  app.use("/api/business-review-memos", businessReviewMemosRouter);
  app.use("/api/portfolio", portfolioRouter);
  app.use("/api/prediction-outcomes", predictionOutcomesRouter);
  app.use("/api/learning-records", learningRecordsRouter);

  // M9 — docs/M9_ARCHITECTURE_PROPOSAL.md §54.
  app.use("/api/control-plane", controlPlaneRouter);
  app.use("/api/company", companyRouter);
  app.use("/api/founder", founderRouter);
  app.use("/api/decision-quality", decisionQualityRouter);
  app.use("/api/learning", learningRouter);
  app.use("/api/operating-cycles", operatingCyclesRouter);
  app.use("/api/alerts", alertsRouter);

  app.use(errorHandler);

  return app;
}
