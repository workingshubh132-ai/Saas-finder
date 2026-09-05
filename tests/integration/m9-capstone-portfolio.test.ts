import { describe, expect, it } from "vitest";
import { businessHealthRepository } from "../../src/db/repositories/business-health.repository.js";
import { toJsonString } from "../../src/domain/shared/json.js";
import { controlPlaneService } from "../../src/services/control-plane.service.js";
import { makeLiveProduct } from "../helpers.js";

/**
 * M9 capstone: the Portfolio Control view correctly buckets a real,
 * multi-product portfolio across all six PORTFOLIO_BUCKETS
 * (docs/M9_ARCHITECTURE_PROPOSAL.md §22) — Constitution §19's own
 * vocabulary restated for a company-wide read, never a new scoring
 * system, and never silently omitting a bucket nobody's product
 * happens to be in this run.
 */
describe("M9 capstone: Portfolio Control buckets a real, multi-product portfolio across all six buckets, with none silently dropped", () => {
  it("three real LIVE products with distinct BusinessHealth states land in exactly the buckets their state maps to; every other bucket is a real, empty array", async () => {
    const healthy = await makeLiveProduct();
    await businessHealthRepository.create({
      productId: healthy.product.id,
      productHealth: 0.85,
      customerHealth: 0.85,
      revenueHealth: 0.85,
      growthHealth: 0.85,
      marginHealth: 0.85,
      operationalHealth: 0.85,
      risk: 0.1,
      evidenceConfidence: 0.85,
      compositeScore: 0.85,
      state: "HEALTHY",
      reasons: toJsonString(["[TEST] Strong across every dimension."]),
    });

    const stagnating = await makeLiveProduct();
    await businessHealthRepository.create({
      productId: stagnating.product.id,
      productHealth: 0.45,
      customerHealth: 0.45,
      revenueHealth: 0.45,
      growthHealth: 0.2,
      marginHealth: 0.45,
      operationalHealth: 0.45,
      risk: 0.4,
      evidenceConfidence: 0.5,
      compositeScore: 0.45,
      state: "STAGNATING",
      reasons: toJsonString(["[TEST] Flat growth, otherwise unremarkable."]),
    });

    const critical = await makeLiveProduct();
    await businessHealthRepository.create({
      productId: critical.product.id,
      productHealth: 0.1,
      customerHealth: 0.1,
      revenueHealth: 0.1,
      growthHealth: 0.1,
      marginHealth: 0.1,
      operationalHealth: 0.1,
      risk: 0.9,
      evidenceConfidence: 0.5,
      compositeScore: 0.1,
      state: "CRITICAL",
      reasons: toJsonString(["[TEST] Weak across every dimension — a real kill candidate."]),
    });

    const portfolio = await controlPlaneService.getPortfolio();

    expect(portfolio.totalProducts).toBe(3);
    expect(portfolio.WINNERS.map((e) => e.productId)).toEqual([healthy.product.id]);
    expect(portfolio.STAGNATING.map((e) => e.productId)).toEqual([stagnating.product.id]);
    expect(portfolio.KILL_CANDIDATES.map((e) => e.productId)).toEqual([critical.product.id]);

    // Every bucket is a real key on the response, empty or not — never omitted just because nothing landed there.
    expect(portfolio.PROMISING).toEqual([]);
    expect(portfolio.UNCERTAIN).toEqual([]);
    expect(portfolio.DECLINING).toEqual([]);

    // Every product appears in exactly one bucket — never double-counted, never dropped.
    const allBucketedIds = [...portfolio.WINNERS, ...portfolio.PROMISING, ...portfolio.UNCERTAIN, ...portfolio.STAGNATING, ...portfolio.DECLINING, ...portfolio.KILL_CANDIDATES].map((e) => e.productId);
    expect(new Set(allBucketedIds).size).toBe(allBucketedIds.length);
    expect(allBucketedIds).toEqual(expect.arrayContaining([healthy.product.id, stagnating.product.id, critical.product.id]));
  });
});
