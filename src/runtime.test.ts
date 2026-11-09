import assert from "node:assert/strict";
import test from "node:test";
import type { RushManifest } from "@bountixx/rush-sdk";
import { createRemoteManifestReader } from "./runtime.js";

const manifest: RushManifest = {
  campaignId: "runtime-rush",
  arenaId: "runtime-arena",
  title: "Runtime Rush",
  challengeType: "coding",
  rulesVersion: 1,
  scoringMethod: "published-tests",
  startsAt: "2026-11-08T12:00:00.000Z",
  endsAt: "2026-11-08T13:00:00.000Z",
  prize: { asset: "XLM", amount: "10", network: "TESTNET" },
  payout: "ranked",
  resultPolicy: "deterministic",
};

test("reads a locked manifest through the private endpoint with no-store credentials", async () => {
  let requestUrl = "";
  let authorization = "";
  const fetcher: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return Response.json({ manifest });
  };
  const reader = createRemoteManifestReader({
    baseUrl: "https://app.example/",
    sharedSecret: "manifest-reader-secret",
    fetcher,
  });

  assert.deepEqual(await reader.find(manifest.campaignId, manifest.arenaId), manifest);
  assert.equal(requestUrl, "https://app.example/api/internal/rush-manifests/runtime-rush?arenaId=runtime-arena");
  assert.equal(authorization, "Bearer manifest-reader-secret");
});

test("treats a missing locked manifest as unavailable for attestation", async () => {
  const reader = createRemoteManifestReader({
    baseUrl: "https://app.example",
    sharedSecret: "manifest-reader-secret",
    fetcher: async () => new Response(null, { status: 404 }),
  });
  assert.equal(await reader.find("missing", "arena"), undefined);
});
