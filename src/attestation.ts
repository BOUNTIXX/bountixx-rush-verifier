import { createHash, sign, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { canonicalize, unsignedAttestation, type ResultAttestation, type RushManifest } from "@bountixx/rush-sdk";

export interface FinalResult {
  campaignId: string;
  arenaId: string;
  winnerAddress: string;
  score: number;
  submissionIds: string[];
  resolvedAt: string;
}

export class ResultValidationError extends Error {
  override name = "ResultValidationError";
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function validateResult(manifest: RushManifest, result: FinalResult): void {
  if (manifest.resultPolicy !== "deterministic") {
    throw new ResultValidationError("Only deterministic Rush manifests can be attested automatically.");
  }
  if (result.campaignId !== manifest.campaignId || result.arenaId !== manifest.arenaId) {
    throw new ResultValidationError("Result does not belong to the supplied Rush manifest.");
  }
  if (!result.winnerAddress.trim()) {
    throw new ResultValidationError("A winner address is required for a settlement attestation.");
  }
  if (!Number.isFinite(result.score)) {
    throw new ResultValidationError("Result score must be a finite number.");
  }
  if (result.submissionIds.length === 0) {
    throw new ResultValidationError("A result needs at least one submission reference.");
  }
  if (new Set(result.submissionIds).size !== result.submissionIds.length) {
    throw new ResultValidationError("Submission references must be unique.");
  }
}

export function attestResult(
  manifest: RushManifest,
  result: FinalResult,
  verifierKeyId: string,
  privateKey: KeyObject,
): ResultAttestation {
  validateResult(manifest, result);
  const unsigned = {
    version: 1 as const,
    manifestHash: sha256(manifest),
    campaignId: result.campaignId,
    arenaId: result.arenaId,
    winnerAddress: result.winnerAddress,
    resultHash: sha256(result),
    issuedAt: new Date().toISOString(),
    verifierKeyId,
  };

  return {
    ...unsigned,
    signature: sign(null, Buffer.from(unsignedAttestation(unsigned)), privateKey).toString("base64url"),
  };
}

export function verifyAttestation(attestation: ResultAttestation, publicKey: KeyObject): boolean {
  const { signature, ...unsigned } = attestation;
  return verify(null, Buffer.from(unsignedAttestation(unsigned)), publicKey, Buffer.from(signature, "base64url"));
}
