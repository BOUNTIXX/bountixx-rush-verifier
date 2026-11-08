# Bountixx Rush Verifier

The deterministic scoring and result-attestation service for Community Rush.

## Responsibilities

- Validate a locked challenge manifest.
- Run objective scoring adapters for supported challenge types.
- Produce replay-safe, signed result attestations.
- Expose proof data for the Bountixx app and Rush SDK.

## Current boundary

`src/service.ts` is the transport-agnostic attestation boundary. `src/http.ts`
adds a deliberately small HTTP adapter: `GET /health` and authenticated
`POST /v1/attestations`. It only signs results for a matching locked manifest.
It does not load credentials, open a port by itself, or place signing material
in a client.

The HTTP adapter takes an injected service. A deployment must provide a trusted
manifest reader and durable, atomic idempotency storage before exposing it.
`createInMemoryIdempotencyStore()` is only for tests/local development.

This service does not custody funds. Soroban contracts own the settlement boundary. Read `PROJECT_CONTEXT.md` before contributing.
