import { createPrivateKey, type KeyObject } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { ResultAttestation, RushManifest } from "@bountixx/rush-sdk";
import { createVerifierHttpServer, type VerifierHttpOptions } from "./http.js";
import {
  createAttestationService,
  type IdempotencyStore,
  type LockedManifestReader,
} from "./service.js";

type StoredRow = {
  fingerprint: string;
  attestation_json: ResultAttestation | string;
};

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
}

function readAttestation(value: ResultAttestation | string): ResultAttestation {
  if (typeof value === "string") return JSON.parse(value) as ResultAttestation;
  return value;
}

/**
 * A durable PostgreSQL/Neon idempotency store. The unique primary key and
 * INSERT ... ON CONFLICT guarantee a single signed result across instances.
 */
export function createNeonIdempotencyStore(databaseUrl: string): IdempotencyStore {
  const sql = neon(databaseUrl);
  const ready = sql`
    CREATE TABLE IF NOT EXISTS rush_verifier_idempotency (
      idempotency_key varchar(200) PRIMARY KEY,
      fingerprint char(64) NOT NULL,
      attestation_json jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  return {
    async get(key) {
      await ready;
      const rows = await sql`SELECT fingerprint, attestation_json FROM rush_verifier_idempotency WHERE idempotency_key = ${key} LIMIT 1`;
      const row = rows[0] as StoredRow | undefined;
      return row ? { fingerprint: row.fingerprint, attestation: readAttestation(row.attestation_json) } : undefined;
    },
    async putIfAbsent(key, record) {
      await ready;
      const inserted = await sql`
        INSERT INTO rush_verifier_idempotency (idempotency_key, fingerprint, attestation_json)
        VALUES (${key}, ${record.fingerprint}, ${JSON.stringify(record.attestation)}::jsonb)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING fingerprint, attestation_json
      `;
      const created = inserted[0] as StoredRow | undefined;
      if (created) return { fingerprint: created.fingerprint, attestation: readAttestation(created.attestation_json) };

      const existing = await sql`SELECT fingerprint, attestation_json FROM rush_verifier_idempotency WHERE idempotency_key = ${key} LIMIT 1`;
      const row = existing[0] as StoredRow | undefined;
      if (!row) throw new Error("Idempotency record was not available after a write conflict.");
      return { fingerprint: row.fingerprint, attestation: readAttestation(row.attestation_json) };
    },
  };
}

/** Reads an immutable, published Verified Rush only through the private app API. */
export function createRemoteManifestReader(options: {
  baseUrl: string;
  sharedSecret: string;
  fetcher?: typeof fetch;
}): LockedManifestReader {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetcher = options.fetcher ?? fetch;
  return {
    async find(campaignId, arenaId) {
      const url = new URL(`${baseUrl}/api/internal/rush-manifests/${encodeURIComponent(campaignId)}`);
      url.searchParams.set("arenaId", arenaId);
      let response: Response;
      try {
        response = await fetcher(url, {
          headers: { authorization: `Bearer ${options.sharedSecret}`, accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new Error("Locked manifest reader is unavailable.");
      }
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`Locked manifest reader returned HTTP ${response.status}.`);
      const body = await response.json() as { manifest?: unknown };
      if (!body.manifest || typeof body.manifest !== "object" || Array.isArray(body.manifest)) {
        throw new Error("Locked manifest reader returned an invalid payload.");
      }
      return body.manifest as RushManifest;
    },
  };
}

export type VerifierRuntime = {
  server: ReturnType<typeof createVerifierHttpServer>;
  close(): Promise<void>;
};

/** Creates the production adapter with deployment-managed secrets and durable storage. */
export function createVerifierRuntimeFromEnvironment(): VerifierRuntime {
  const privateKey: KeyObject = createPrivateKey(requireEnvironment("RUSH_VERIFIER_PRIVATE_KEY_PEM"));
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("RUSH_VERIFIER_PRIVATE_KEY_PEM must be an Ed25519 private key.");
  }
  const service = createAttestationService({
    privateKey,
    verifierKeyId: requireEnvironment("RUSH_VERIFIER_KEY_ID"),
    idempotencyStore: createNeonIdempotencyStore(requireEnvironment("RUSH_VERIFIER_DATABASE_URL")),
    manifestReader: createRemoteManifestReader({
      baseUrl: requireEnvironment("RUSH_MANIFEST_READER_URL"),
      sharedSecret: requireEnvironment("RUSH_MANIFEST_READER_SECRET"),
    }),
  });
  const httpOptions: VerifierHttpOptions = {
    sharedSecret: requireEnvironment("RUSH_VERIFIER_SHARED_SECRET"),
    service,
  };
  const server = createVerifierHttpServer(httpOptions);
  return {
    server,
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
