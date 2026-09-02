import { decisionRecordRepository } from "../db/repositories/decision-record.repository.js";
import { summarizeCalibration, type CalibrationSummary } from "../domain/decision/calibration.js";

/**
 * Read-only calibration reporting over historical DecisionRecords
 * (docs/M4_ARCHITECTURE_PROPOSAL.md §28, §39) — never mutates
 * anything, never feeds back into any scoring formula automatically.
 */
export const calibrationService = {
  async summarize(): Promise<CalibrationSummary> {
    const records = await decisionRecordRepository.list();
    return summarizeCalibration(records.map((r) => ({ confidenceAtDecision: r.confidenceAtDecision, humanDecision: r.humanDecision })));
  },
};
