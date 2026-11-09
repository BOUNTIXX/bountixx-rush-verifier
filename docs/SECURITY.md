# Result Attestation Security

The verifier's signing key is an operational secret. Store it in a deployment secret manager, rotate it through the contract admin process, and never expose it to the Bountixx web client. Verifier rotation changes the default for future campaigns only: each funded vault campaign stores its verifier address at funding time.

Each attestation contains the manifest hash, campaign ID, arena ID, winner address, result hash, key ID, and issue timestamp. Clients must verify the signature and ensure the manifest hash matches the rules they display.

The verifier only supports deterministic scoring adapters in the first release. It rejects results whose campaign or arena does not match the manifest, results with duplicate or missing submission references, non-finite scores, and organizer-reviewed outcomes. Organizer-reviewed outcomes must be separately labeled and should not auto-settle funds until a reviewed policy is implemented.

## Attestation request boundary

`src/service.ts` defines the verifier's internal request boundary. It resolves a
locked manifest through a trusted reader, verifies the caller-supplied manifest
hash against that record, validates request/result consistency, and only then
signs a deterministic result. It is deliberately not an HTTP server and does
not load a key from environment variables. A deployment layer must authenticate
the caller before invoking it and supply the signing key from its secret manager.

Every request must include a unique idempotency key. The verifier stores a hash
of the immutable request payload alongside the issued attestation. A retry with
the same payload returns the original signature; reusing a key for a different
payload fails. The production `IdempotencyStore` implementation must be durable
and make `putIfAbsent` atomic across all service instances. The in-memory store
exists only for tests and local development.

## HTTP boundary

`createVerifierHttpServer()` exposes only `GET /health` and
`POST /v1/attestations`. The attestation endpoint requires an exact Bearer
secret supplied by the private app backend, requires JSON, limits request size,
and returns `Cache-Control: no-store`. It is not a public browser endpoint.

`src/runtime.ts` is the default production composition. It reads an Ed25519 key
from `RUSH_VERIFIER_PRIVATE_KEY_PEM`, fetches an immutable manifest through the
app's secret-protected internal endpoint, and persists idempotency records in
PostgreSQL/Neon with an atomic unique-key insert. Configure every value through
a deployment secret manager; do not use the in-memory store outside tests.
Run the service on private networking or behind an authenticated
service-to-service gateway, rotate `RUSH_VERIFIER_SHARED_SECRET` separately
from the verifier signing key and `RUSH_MANIFEST_READER_SECRET`, and log request
IDs without logging signatures, winner addresses, or Bearer secrets.
