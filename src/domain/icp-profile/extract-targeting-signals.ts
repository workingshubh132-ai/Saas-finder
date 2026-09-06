import type { EvidenceTargetingSignal } from "./targeting-signal.js";

/**
 * General, reusable vocabulary — common small-business software
 * categories VentureForge's own discovery pipeline already targets
 * (accounting, payments, CRM, e-commerce), not anything specific to
 * one opportunity. Adding a future opportunity's own relevant platform
 * here (if genuinely recurring across discoveries) is the intended way
 * this capability grows — this file is the one place to extend it,
 * never a per-opportunity special case in icpAnalystService itself.
 */
interface PlatformVocabularyEntry {
  readonly matchTerms: readonly string[];
  readonly label: string;
  readonly categoryLabel: string;
}

const PLATFORM_VOCABULARY: readonly PlatformVocabularyEntry[] = [
  { matchTerms: ["xero"], label: "Xero", categoryLabel: "Accounting/bookkeeping software with automated payment matching" },
  { matchTerms: ["quickbooks"], label: "QuickBooks", categoryLabel: "Accounting/bookkeeping software with automated payment matching" },
  { matchTerms: ["freshbooks"], label: "FreshBooks", categoryLabel: "Accounting/bookkeeping software with automated payment matching" },
  { matchTerms: ["wave accounting", "waveapps"], label: "Wave", categoryLabel: "Accounting/bookkeeping software with automated payment matching" },
  { matchTerms: ["netsuite"], label: "NetSuite", categoryLabel: "Accounting/bookkeeping software with automated payment matching" },
  { matchTerms: ["sage intacct", "sage accounting", "sage 50", "sage 200"], label: "Sage", categoryLabel: "Accounting/bookkeeping software with automated payment matching" },
  { matchTerms: ["stripe"], label: "Stripe", categoryLabel: "Payment processing software" },
  { matchTerms: ["square"], label: "Square", categoryLabel: "Payment processing software" },
  { matchTerms: ["paypal"], label: "PayPal", categoryLabel: "Payment processing software" },
  { matchTerms: ["hubspot"], label: "HubSpot", categoryLabel: "CRM software" },
  { matchTerms: ["salesforce"], label: "Salesforce", categoryLabel: "CRM software" },
  { matchTerms: ["zoho"], label: "Zoho", categoryLabel: "CRM software" },
  { matchTerms: ["shopify"], label: "Shopify", categoryLabel: "E-commerce software" },
  { matchTerms: ["woocommerce"], label: "WooCommerce", categoryLabel: "E-commerce software" },
];

interface WorkflowVocabularyEntry {
  readonly category: "WORKFLOW" | "OPERATIONAL";
  readonly matchTerms: readonly string[];
  /** When set, a match ALSO requires one of these terms present — avoids over-matching a bare word like "invoice" alone. */
  readonly coOccursWith?: readonly string[];
  readonly label: string;
}

const WORKFLOW_VOCABULARY: readonly WorkflowVocabularyEntry[] = [
  { category: "WORKFLOW", matchTerms: ["reconcil"], label: "Payment/account reconciliation workflow" },
  { category: "OPERATIONAL", matchTerms: ["invoice", "invoices", "invoicing"], coOccursWith: ["customer", "customers"], label: "Businesses with multiple invoices/customers to track" },
  { category: "OPERATIONAL", matchTerms: ["bank payment", "bank transfer", "bank deposit"], label: "Businesses receiving bank payments/transfers directly" },
  { category: "OPERATIONAL", matchTerms: ["bookkeep"], label: "Bookkeeping/accounting operations" },
];

interface EvidenceTextItem {
  readonly id: string;
  readonly text: string;
}

/**
 * Deterministic, general-purpose evidence-to-targeting-signal
 * extraction (Design Requirements A, B, D) — no model call, reusable
 * for any future opportunity's Evidence, never hardcoded to one.
 *
 * A directly-matched platform name is EVIDENCED. Generalizing it to a
 * broader technology category is INFERRED unless a second, distinct
 * platform in the SAME category is also directly matched — two
 * independently-named platforms are themselves direct evidence for
 * the category, not a generalization from either one. An INFERRED
 * generalization always carries an explicit UNKNOWN sibling signal
 * naming exactly what remains unresolved (Design Requirement B: a
 * single observed platform must never silently become a universal
 * requirement).
 */
export function extractTargetingSignals(evidenceItems: readonly EvidenceTextItem[]): EvidenceTargetingSignal[] {
  const signals: EvidenceTargetingSignal[] = [];
  const categoryMatches = new Map<string, { evidenceIds: Set<string>; platformLabels: Set<string> }>();

  for (const platform of PLATFORM_VOCABULARY) {
    const matches = evidenceItems.filter((e) => platform.matchTerms.some((term) => e.text.toLowerCase().includes(term)));
    if (matches.length === 0) continue;

    const evidenceIds = matches.map((m) => m.id);
    signals.push({
      category: "PLATFORM",
      label: platform.label,
      provenance: "EVIDENCED",
      groundedEvidenceIds: evidenceIds,
      groundedClaimIds: [],
      reasoning: `"${platform.label}" is named directly in ${evidenceIds.length} real evidence record(s).`,
      matchTerms: [...platform.matchTerms],
      isTechnologyRelevant: true,
    });

    const bucket = categoryMatches.get(platform.categoryLabel) ?? { evidenceIds: new Set<string>(), platformLabels: new Set<string>() };
    for (const id of evidenceIds) bucket.evidenceIds.add(id);
    bucket.platformLabels.add(platform.label);
    categoryMatches.set(platform.categoryLabel, bucket);
  }

  for (const [categoryLabel, bucket] of categoryMatches) {
    const platformLabels = [...bucket.platformLabels];
    const evidenceIds = [...bucket.evidenceIds];

    if (platformLabels.length >= 2) {
      signals.push({
        category: "WORKFLOW",
        label: categoryLabel,
        provenance: "EVIDENCED",
        groundedEvidenceIds: evidenceIds,
        groundedClaimIds: [],
        reasoning: `Independently named across ${platformLabels.length} distinct platforms (${platformLabels.join(", ")}) — the category itself is directly evidenced, not merely generalized from one.`,
        matchTerms: [],
        isTechnologyRelevant: true,
      });
      continue;
    }

    const onlyPlatform = platformLabels[0]!;
    signals.push({
      category: "WORKFLOW",
      label: categoryLabel,
      provenance: "INFERRED",
      groundedEvidenceIds: evidenceIds,
      groundedClaimIds: [],
      reasoning: `Generalized from the one specific observed platform (${onlyPlatform}) — not itself independently confirmed as a category-wide pattern.`,
      matchTerms: [],
      isTechnologyRelevant: true,
    });
    signals.push({
      category: "PLATFORM",
      label: `Whether this problem recurs on platforms other than ${onlyPlatform}`,
      provenance: "UNKNOWN",
      groundedEvidenceIds: [],
      groundedClaimIds: [],
      reasoning: `Only ${onlyPlatform} is named in the gathered evidence; other platforms in the same category are neither confirmed nor ruled out.`,
      matchTerms: [],
      isTechnologyRelevant: false,
    });
  }

  for (const workflow of WORKFLOW_VOCABULARY) {
    const matches = evidenceItems.filter((e) => {
      const text = e.text.toLowerCase();
      if (!workflow.matchTerms.some((term) => text.includes(term))) return false;
      return !workflow.coOccursWith || workflow.coOccursWith.some((term) => text.includes(term));
    });
    if (matches.length === 0) continue;

    const evidenceIds = matches.map((m) => m.id);
    signals.push({
      category: workflow.category,
      label: workflow.label,
      provenance: "EVIDENCED",
      groundedEvidenceIds: evidenceIds,
      groundedClaimIds: [],
      reasoning: `Directly described in ${evidenceIds.length} real evidence record(s).`,
      matchTerms: workflow.coOccursWith ? [...workflow.matchTerms, ...workflow.coOccursWith] : [...workflow.matchTerms],
      isTechnologyRelevant: false,
    });
  }

  return signals;
}

/**
 * The single best signal to represent the ICP's own `technology`
 * field, or null when nothing was evidenced/inferred — never
 * fabricated when the vocabulary found nothing. Prefers a category-level
 * WORKFLOW signal ("Accounting/bookkeeping software...") over a bare
 * PLATFORM name: writing the literal observed platform name into the
 * `technology` field would itself BE the anti-pattern Design
 * Requirement B forbids — treating one named platform as the ICP's
 * technology requirement. The specific platform stays fully available,
 * with its own provenance, in `evidenceTargetingSignals` — just not as
 * this field's headline value. Among same-tier candidates, EVIDENCED
 * beats INFERRED, then more grounding evidence.
 */
export function selectTechnologySignal(signals: readonly EvidenceTargetingSignal[]): EvidenceTargetingSignal | null {
  const candidates = signals.filter((s) => s.isTechnologyRelevant && (s.provenance === "EVIDENCED" || s.provenance === "INFERRED"));
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    if (a.category !== b.category) return a.category === "WORKFLOW" ? -1 : 1;
    if (a.provenance !== b.provenance) return a.provenance === "EVIDENCED" ? -1 : 1;
    return b.groundedEvidenceIds.length - a.groundedEvidenceIds.length;
  })[0]!;
}
