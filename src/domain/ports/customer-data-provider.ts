/**
 * Seam for customer-intelligence's feedback/cancellation reads
 * (docs/M8_ARCHITECTURE_PROPOSAL.md §12, §31, §38). Aggregated/redacted
 * by default — `includeRawText` must be explicitly requested, and even
 * then every respondent is an opaque `respondentRef`, never a real
 * identity ("the model rarely needs raw customer PII," M8 brief §38).
 * Only DevCustomerDataProvider exists in M8; the Customer Intelligence
 * Agent separately reads real SupportCase/Incident rows through their
 * own existing repositories — this provider covers feedback that
 * wouldn't naturally already be a SupportCase (e.g. a satisfaction
 * survey excerpt).
 */
export interface FeedbackItem {
  readonly id: string;
  readonly productId: string;
  readonly respondentRef: string;
  readonly excerpt: string;
  readonly sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  readonly collectedAt: Date;
}

export interface CancellationReason {
  readonly id: string;
  readonly productId: string;
  readonly respondentRef: string;
  readonly reason: string;
  readonly cancelledAt: Date;
}

export interface ListFeedbackQuery {
  readonly productId: string;
  /** Defaults false — aggregate/redacted first, raw text only when a specific claim genuinely needs a quote. */
  readonly includeRawText?: boolean;
  readonly limit?: number;
}

export interface CustomerDataProvider {
  readonly id: string;
  listFeedback(query: ListFeedbackQuery): Promise<readonly FeedbackItem[]>;
  listCancellationReasons(productId: string): Promise<readonly CancellationReason[]>;
}
