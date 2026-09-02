import { decisionRecordRepository } from "../db/repositories/decision-record.repository.js";
import { customerDiscoveryMemoRepository } from "../db/repositories/customer-discovery-memo.repository.js";
import { summarizeCalibration, type CalibrationSummary } from "../domain/decision/calibration.js";

/**
 * Read-only calibration reporting over historical DecisionRecords
 * (docs/M4_ARCHITECTURE_PROPOSAL.md §28, §39) and, since M5,
 * CustomerDiscoveryMemos (docs/M5_ARCHITECTURE_PROPOSAL.md §32) —
 * never mutates anything, never feeds back into any scoring formula
 * automatically.
 */
export const calibrationService = {
  async summarize(): Promise<CalibrationSummary> {
    const records = await decisionRecordRepository.list();
    return summarizeCalibration(
      records.map((r) => ({ confidenceAtDecision: r.confidenceAtDecision, humanDecision: r.humanDecision })),
      "APPROVED",
    );
  },

  /**
   * Same mechanism, M5's own data (§32: "extends `calibrationService`'s
   * pattern... not a new mechanism"): `CustomerDiscoveryMemo.confidence`
   * (the CEO's customer-discovery recommendation confidence at compile
   * time) against `CustomerDiscoveryMemo.humanDecision`. A memo the
   * Human Owner hasn't decided yet has `humanDecision: null` — excluded
   * here rather than treated as "not approved," since undecided is not
   * the same honest fact as decided-and-rejected.
   */
  async summarizeCustomerDiscovery(): Promise<CalibrationSummary> {
    const memos = await customerDiscoveryMemoRepository.list();
    const decided = memos.filter((m): m is typeof m & { humanDecision: string } => m.humanDecision !== null);
    return summarizeCalibration(
      decided.map((m) => ({ confidenceAtDecision: m.confidence, humanDecision: m.humanDecision })),
      "APPROVE",
    );
  },
};
