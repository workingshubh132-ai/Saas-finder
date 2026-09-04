import { randomUUID } from "node:crypto";
import type {
  CancellationReason,
  CustomerDataProvider,
  FeedbackItem,
  ListFeedbackQuery,
} from "../domain/ports/customer-data-provider.js";

/**
 * DEV_FIXTURE only (docs/M8_ARCHITECTURE_PROPOSAL.md §12, §31) —
 * in-memory, explicitly seeded (test/demo-only `addFeedback`/
 * `addCancellationReason`), never a static stub. Every respondent is
 * an opaque respondentRef, matching the port's own privacy contract.
 */
export class DevCustomerDataProvider implements CustomerDataProvider {
  readonly id = "DEV_FIXTURE";
  private readonly feedback: FeedbackItem[] = [];
  private readonly cancellationReasons: CancellationReason[] = [];

  addFeedback(input: Omit<FeedbackItem, "id">): FeedbackItem {
    const item: FeedbackItem = { id: `dev-feedback-${randomUUID()}`, ...input };
    this.feedback.push(item);
    return item;
  }

  addCancellationReason(input: Omit<CancellationReason, "id">): CancellationReason {
    const item: CancellationReason = { id: `dev-cancel-${randomUUID()}`, ...input };
    this.cancellationReasons.push(item);
    return item;
  }

  async listFeedback(query: ListFeedbackQuery): Promise<readonly FeedbackItem[]> {
    const matching = this.feedback.filter((f) => f.productId === query.productId);
    const limited = matching.slice(0, query.limit ?? matching.length);
    if (query.includeRawText) return limited;
    return limited.map((f) => ({ ...f, excerpt: f.excerpt.length > 80 ? `${f.excerpt.slice(0, 80)}…` : f.excerpt }));
  }

  async listCancellationReasons(productId: string): Promise<readonly CancellationReason[]> {
    return this.cancellationReasons.filter((c) => c.productId === productId);
  }
}
