import type { Product } from "@prisma/client";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { productRepository, type CreateProductInput } from "../db/repositories/product.repository.js";
import { PRODUCT_STATUS_TRANSITIONS, isProductStatus } from "../domain/product/product.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { assertHumanActor, type Actor } from "./agent.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";

export interface ApproveProductParams {
  id: string;
  actor: Actor;
}

/**
 * The first hard human gate of the SaaS Factory
 * (docs/M6_ARCHITECTURE_PROPOSAL.md §23) — a Product is created
 * PROPOSED; only a verified HUMAN actor may move it to APPROVED. No
 * ProductSpec/MvpArchitecture/EngineeringTask may exist for a Product
 * that isn't APPROVED (every downstream service checks this). Mirrors
 * outreachExperimentService.approve's own simple-direct-transition
 * shape exactly — no full ApprovalRequest object, since no agent is
 * proposing this for adversarial scrutiny; a human is directly
 * deciding whether to open a build attempt at all.
 */
export const productService = {
  async create(params: CreateProductInput): Promise<Product> {
    const opportunity = await opportunityRepository.findById(params.opportunityId);
    if (!opportunity) throw new NotFoundError("Opportunity", params.opportunityId);
    const existing = await productRepository.findByOpportunityId(params.opportunityId);
    if (existing) {
      throw new ValidationError(`Opportunity ${params.opportunityId} already has a Product (${existing.id}, status ${existing.status}) — a new attempt requires a new opportunity reference, never overwriting the prior one.`);
    }

    const product = await productRepository.create(params);

    await auditService.record({
      actorType: "SYSTEM",
      actorId: params.createdByIdentityId,
      action: "CREATE_PRODUCT",
      resourceType: "PRODUCT",
      resourceId: product.id,
      result: "SUCCESS",
      metadata: { opportunityId: params.opportunityId },
    });

    return product;
  },

  async getOrThrow(id: string): Promise<Product> {
    const product = await productRepository.findById(id);
    if (!product) throw new NotFoundError("Product", id);
    return product;
  },

  findByOpportunityId: productRepository.findByOpportunityId,
  list: productRepository.list,

  async approve(params: ApproveProductParams): Promise<Product> {
    assertHumanActor(params.actor);

    const product = await productService.getOrThrow(params.id);
    if (!isProductStatus(product.status)) {
      throw new ValidationError(`Corrupt stored status on product ${product.id}: ${product.status}`);
    }
    assertTransition("Product", PRODUCT_STATUS_TRANSITIONS, product.status, "APPROVED");

    const approved = await productRepository.approve(params.id, params.actor.actorId ?? "unknown");

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: "APPROVE_PRODUCT",
      resourceType: "PRODUCT",
      resourceId: params.id,
      result: "SUCCESS",
      metadata: { opportunityId: approved.opportunityId },
    });
    await eventBus.publish({ type: "PRODUCT_APPROVED", payload: { productId: approved.id, opportunityId: approved.opportunityId, approvedByIdentityId: approved.approvedByIdentityId } });

    return approved;
  },

  async setStatus(id: string, toStatus: string, actor: { actorType: Actor["actorType"]; actorId: string | null }): Promise<Product> {
    if (!isProductStatus(toStatus)) {
      throw new ValidationError(`Unknown product status: ${toStatus}`);
    }
    const product = await productService.getOrThrow(id);
    if (!isProductStatus(product.status)) {
      throw new ValidationError(`Corrupt stored status on product ${product.id}: ${product.status}`);
    }
    assertTransition("Product", PRODUCT_STATUS_TRANSITIONS, product.status, toStatus);

    const updated = await productRepository.updateStatus(id, toStatus);

    await auditService.record({
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: `PRODUCT_STATUS_${product.status}_TO_${toStatus}`,
      resourceType: "PRODUCT",
      resourceId: id,
      result: "SUCCESS",
    });
    if (toStatus === "READY_FOR_DEPLOYMENT") {
      await eventBus.publish({ type: "PRODUCT_READY_FOR_DEPLOYMENT", payload: { productId: id, opportunityId: updated.opportunityId } });
    }

    return updated;
  },

  setWorkspacePath: productRepository.setWorkspacePath,
  setCostEstimates: productRepository.setCostEstimates,
  setDeploymentArtifacts: productRepository.setDeploymentArtifacts,
};
