import express, { type Express } from "express";
import { agentExecutionsRouter } from "./routes/agent-executions.routes.js";
import { agentsRouter } from "./routes/agents.routes.js";
import { auditRouter } from "./routes/audit.routes.js";
import { authorizeRouter } from "./routes/authorize.routes.js";
import { decisionsRouter } from "./routes/decisions.routes.js";
import { evidenceRouter } from "./routes/evidence.routes.js";
import { eventsRouter } from "./routes/events.routes.js";
import { identitiesRouter } from "./routes/identities.routes.js";
import { opportunitiesRouter } from "./routes/opportunities.routes.js";
import { researchRouter } from "./routes/research.routes.js";
import { researchSignalsRouter } from "./routes/research-signals.routes.js";
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

  app.use(errorHandler);

  return app;
}
