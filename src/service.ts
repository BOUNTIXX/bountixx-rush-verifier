import type { KeyObject } from "node:crypto";
import { validateRushManifest, type ResultAttestation, type RushManifest } from "@bountixx/rush-sdk";
import { attestResult, sha256, type FinalResult } from "./attestation.js";

/**
 * The request shape for a trusted internal attestation endpoint. The web client
 * must never call this boundary with a signing key, and production callers must
 * be authenticated before their request reaches it.
 */
export interface AttestResultRequest {
  idempotencyKey: string;
  campaignId: string;
  arenaId: string;
  manifestHash: string;
  result: FinalResult;
}

export interface AttestResultResponse {
  attestation: ResultAttestation;
  replayed: boolean;
}

export interface LockedManifestReader {
  find(campaignId: string, arenaId: string): RushManifest | undefined;
}

export interface IdempotencyRecord {
  fingerprint: string;
  attestation: ResultAttestation;
}

/**
 * Implement this with an atomic "insert if absent" operation in production.
 * A durable store is required before this module is exposed through HTTP.
 */
export interface IdempotencyStore {
  get(key: string): IdempotencyRecord | undefined;
  putIfAbsent(key: string, record: IdempotencyRecord): IdempotencyRecord;
}

export interface AttestationServiceOptions {
  manifestReader: LockedManifestReader;
  idempotencyStore: IdempotencyStore;
  verifierKeyId: string;
  privateKey: KeyObject;
}

export class AttestationRequestError extends Error {
  override name = "AttestationRequestError";
}

export class IdempotencyConflictError extends Error {
  override name = "IdempotencyConflictError";
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function requireNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new AttestationRequestError(`${field} must be a non-empty, trimmed string.`);
  }
}

function validateRequestShape(request: AttestResultRequest): void {
  if (!request || typeof request !== "object") {
    throw new AttestationRequestError("An attestation request object is required.");
  }
  if (typeof request.idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(request.idempotencyKey)) {
    throw new AttestationRequestError("idempotencyKey must be 16-200 URL-safe characters.");
  }
  requireNonEmptyString(request.campaignId, "campaignId");
  requireNonEmptyString(request.arenaId, "arenaId");
  if (typeof request.manifestHash !== "string" || !HASH_PATTERN.test(request.manifestHash)) {
    throw new AttestationRequestError("manifestHash must be a lowercase SHA-256 digest.");
  }

  const result = request.result as FinalResult;
  if (!result || typeof result !== "object") {
    throw new AttestationRequestError("result is required.");
  }
  requireNonEmptyString(result.campaignId, "result.campaignId");
  requireNonEmptyString(result.arenaId, "result.arenaId");
  requireNonEmptyString(result.winnerAddress, "result.winnerAddress");
  requireNonEmptyString(result.resolvedAt, "result.resolvedAt");
  if (!Number.isFinite(result.score)) {
    throw new AttestationRequestError("result.score must be a finite number.");
  }
  if (!Array.isArray(result.submissionIds) || result.submissionIds.length === 0) {
    throw new AttestationRequestError("result.submissionIds must contain at least one submission reference.");
  }
  for (const [index, submissionId] of result.submissionIds.entries()) {
    requireNonEmptyString(submissionId, `result.submissionIds[${index}]`);
  }
  if (result.campaignId !== request.campaignId || result.arenaId !== request.arenaId) {
    throw new AttestationRequestError("Request and result campaign/arena identifiers must match.");
  }
}

function requestFingerprint(request: AttestResultRequest): string {
  return sha256({
    campaignId: request.campaignId,
    arenaId: request.arenaId,
    manifestHash: request.manifestHash,
    result: request.result,
  });
}

function matchingRecord(key: string, fingerprint: string, record: IdempotencyRecord): AttestResultResponse {
  if (record.fingerprint !== fingerprint) {
    throw new IdempotencyConflictError(`idempotencyKey ${key} was already used for a different result.`);
  }
  return { attestation: record.attestation, replayed: true };
}

/**
 * Creates a pure service boundary. It intentionally does not create an HTTP
 * server, authenticate callers, or load secrets. Those operational concerns
 * belong to the private deployment layer around this module.
 */
export function createAttestationService(options: AttestationServiceOptions) {
  return {
    attest(request: AttestResultRequest): AttestResultResponse {
      validateRequestShape(request);
      const fingerprint = requestFingerprint(request);
      const existing = options.idempotencyStore.get(request.idempotencyKey);
      if (existing) return matchingRecord(request.idempotencyKey, fingerprint, existing);

      const manifest = options.manifestReader.find(request.campaignId, request.arenaId);
      if (!manifest) {
        throw new AttestationRequestError("No locked manifest exists for this campaign and arena.");
      }
      if (manifest.campaignId !== request.campaignId || manifest.arenaId !== request.arenaId) {
        throw new AttestationRequestError("The locked manifest does not match the requested campaign and arena.");
      }
      const manifestIssues = validateRushManifest(manifest);
      if (manifestIssues.length > 0) {
        throw new AttestationRequestError(`The locked manifest is invalid: ${manifestIssues[0].field}.`);
      }
      if (sha256(manifest) !== request.manifestHash) {
        throw new AttestationRequestError("manifestHash does not match the locked manifest.");
      }

      const attestation = attestResult(manifest, request.result, options.verifierKeyId, options.privateKey);
      const record = { fingerprint, attestation };
      const stored = options.idempotencyStore.putIfAbsent(request.idempotencyKey, record);
      if (stored !== record) return matchingRecord(request.idempotencyKey, fingerprint, stored);
      return { attestation, replayed: false };
    },
  };
}

/** A test/dev-only store. Production deployments must provide durable atomic storage. */
export function createInMemoryIdempotencyStore(): IdempotencyStore {
  const records = new Map<string, IdempotencyRecord>();
  return {
    get(key) {
      return records.get(key);
    },
    putIfAbsent(key, record) {
      const existing = records.get(key);
      if (existing) return existing;
      records.set(key, record);
      return record;
    },
  };
}

export function attestationRequestFingerprint(request: AttestResultRequest): string {
  validateRequestShape(request);
  return requestFingerprint(request);
}
