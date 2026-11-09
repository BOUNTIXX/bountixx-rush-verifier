import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import type { RushManifest } from "@bountixx/rush-sdk";
import { sha256, verifyAttestation } from "./attestation.js";
import {
  AttestationRequestError,
  createAttestationService,
  createInMemoryIdempotencyStore,
  IdempotencyConflictError,
} from "./service.js";

const manifest: RushManifest = {
  campaignId: "stellar-builder-rush",
  arenaId: "soroban-debug-001",
  title: "Soroban Debug Arena",
  challengeType: "coding",
  rulesVersion: 1,
  scoringMethod: "all-tests-pass-then-fastest",
  startsAt: "2026-11-08T12:00:00.000Z",
  endsAt: "2026-11-08T13:00:00.000Z",
  prize: { asset: "XLM", amount: "250", network: "TESTNET" },
  payout: "winner-takes-all",
  resultPolicy: "deterministic",
};

function createService() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    publicKey,
    service: createAttestationService({
      privateKey,
      verifierKeyId: "test-verifier-1",
      idempotencyStore: createInMemoryIdempotencyStore(),
      manifestReader: {
        find: (campaignId, arenaId) =>
          campaignId === manifest.campaignId && arenaId === manifest.arenaId ? manifest : undefined,
      },
    }),
  };
}

function request() {
  return {
    idempotencyKey: "attest-stellar-builder-rush-0001",
    campaignId: manifest.campaignId,
    arenaId: manifest.arenaId,
    manifestHash: sha256(manifest),
    result: {
      campaignId: manifest.campaignId,
      arenaId: manifest.arenaId,
      winnerAddress: "GWINNER",
      score: 100,
      submissionIds: ["submission-01"],
      resolvedAt: "2026-11-08T13:00:00.000Z",
    },
  };
}

test("attests against a locked manifest and replays an identical idempotent request", async () => {
  const { service, publicKey } = createService();
  const first = await service.attest(request());
  const retried = await service.attest(request());

  assert.equal(first.replayed, false);
  assert.equal(retried.replayed, true);
  assert.deepEqual(retried.attestation, first.attestation);
  assert.equal(verifyAttestation(first.attestation, publicKey), true);
});

test("refuses reused idempotency keys and mismatched locked manifest hashes", async () => {
  const { service } = createService();
  const initial = request();
  await service.attest(initial);

  await assert.rejects(
    service.attest({ ...initial, result: { ...initial.result, score: 99 } }),
    IdempotencyConflictError,
  );
  await assert.rejects(
    service.attest({
      ...request(),
      idempotencyKey: "attest-stellar-builder-rush-0002",
      manifestHash: "a".repeat(64),
    }),
    AttestationRequestError,
  );
});

test("rejects malformed request data before any signing operation", async () => {
  const { service } = createService();
  const invalid = request();

  await assert.rejects(service.attest({ ...invalid, idempotencyKey: "too-short" }), AttestationRequestError);
  await assert.rejects(
    service.attest({ ...invalid, result: { ...invalid.result, submissionIds: ["submission-01", ""] } }),
    AttestationRequestError,
  );
  await assert.rejects(
    service.attest({ ...invalid, result: { ...invalid.result, campaignId: "other-rush" } }),
    AttestationRequestError,
  );
});
