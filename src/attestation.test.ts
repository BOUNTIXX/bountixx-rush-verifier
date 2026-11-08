import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import type { RushManifest } from "@bountixx/rush-sdk";
import { attestResult, ResultValidationError, verifyAttestation } from "./attestation.js";

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

test("signs and verifies a result attestation", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const attestation = attestResult(
    manifest,
    {
      campaignId: manifest.campaignId,
      arenaId: manifest.arenaId,
      winnerAddress: "GWINNER",
      score: 100,
      submissionIds: ["submission-01"],
      resolvedAt: "2026-11-08T13:00:00.000Z",
    },
    "test-verifier-1",
    privateKey,
  );

  assert.equal(verifyAttestation(attestation, publicKey), true);
  assert.equal(verifyAttestation({ ...attestation, resultHash: "tampered" }, publicKey), false);
});

test("refuses to attest a reviewed or mismatched result", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const result = {
    campaignId: manifest.campaignId,
    arenaId: manifest.arenaId,
    winnerAddress: "GWINNER",
    score: 100,
    submissionIds: ["submission-01"],
    resolvedAt: "2026-11-08T13:00:00.000Z",
  };

  assert.throws(
    () => attestResult({ ...manifest, resultPolicy: "organizer-reviewed" }, result, "test-verifier-1", privateKey),
    ResultValidationError,
  );
  assert.throws(
    () => attestResult(manifest, { ...result, arenaId: "other-arena" }, "test-verifier-1", privateKey),
    ResultValidationError,
  );
});
