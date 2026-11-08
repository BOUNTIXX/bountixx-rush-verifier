# Bountixx Rush Verifier

The deterministic scoring and result-attestation service for Community Rush.

## Responsibilities

- Validate a locked challenge manifest.
- Run objective scoring adapters for supported challenge types.
- Produce replay-safe, signed result attestations.
- Expose proof data for the Bountixx app and Rush SDK.

## Current boundary

`src/service.ts` is an internal, transport-agnostic attestation boundary. It
only signs results for a matching locked manifest and requires a durable,
atomic idempotency store before it can be exposed through an authenticated
server. It does not open a network port, load credentials, or place signing
material in a client.

This service does not custody funds. Soroban contracts own the settlement boundary. Read `PROJECT_CONTEXT.md` before contributing.
