import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { RushManifest } from "@bountixx/rush-sdk";
import { sha256 } from "./attestation.js";
import { createVerifierHttpServer } from "./http.js";
import { createAttestationService, createInMemoryIdempotencyStore } from "./service.js";

const secret = "local-test-secret-that-is-long-enough-for-authentication";
const manifest: RushManifest = {
  campaignId: "http-rush", arenaId: "http-arena", title: "HTTP Rush", challengeType: "coding", rulesVersion: 1,
  scoringMethod: "published-tests", startsAt: "2026-11-08T12:00:00.000Z", endsAt: "2026-11-08T13:00:00.000Z",
  prize: { asset: "XLM", amount: "10", network: "TESTNET" }, payout: "ranked", resultPolicy: "deterministic",
};

function serverForTest() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const service = createAttestationService({
    privateKey, verifierKeyId: "http-test-key", idempotencyStore: createInMemoryIdempotencyStore(),
    manifestReader: { find: (campaignId, arenaId) => campaignId === manifest.campaignId && arenaId === manifest.arenaId ? manifest : undefined },
  });
  return createVerifierHttpServer({ sharedSecret: secret, service });
}

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = serverForTest();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try { await run(`http://127.0.0.1:${address.port}`); } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function requestBody() {
  return {
    idempotencyKey: "http-attestation-request-0001", campaignId: manifest.campaignId, arenaId: manifest.arenaId, manifestHash: sha256(manifest),
    result: { campaignId: manifest.campaignId, arenaId: manifest.arenaId, winnerAddress: "GHTTPWINNER", score: 42, submissionIds: ["http-submission-1"], resolvedAt: "2026-11-08T13:00:00.000Z" },
  };
}

test("protects the attestation endpoint and returns no-store JSON", async () => {
  await withServer(async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    const denied = await fetch(`${baseUrl}/v1/attestations`, { method: "POST" });
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("cache-control"), "no-store");
  });
});

test("attests authenticated requests and preserves idempotent replay semantics", async () => {
  await withServer(async (baseUrl) => {
    const init = { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(requestBody()) };
    const first = await fetch(`${baseUrl}/v1/attestations`, init);
    const firstBody = await first.json() as { replayed: boolean; attestation: { signature: string } };
    assert.equal(first.status, 200);
    assert.equal(firstBody.replayed, false);
    assert.ok(firstBody.attestation.signature);
    const replay = await fetch(`${baseUrl}/v1/attestations`, init);
    const replayBody = await replay.json() as { replayed: boolean };
    assert.equal(replay.status, 200);
    assert.equal(replayBody.replayed, true);
  });
});
