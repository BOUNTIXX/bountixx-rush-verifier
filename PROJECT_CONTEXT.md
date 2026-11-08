# Bountixx Shared Project Context

## Why this project exists

Bountixx is a social competitive arena. Community Rush is its optional community-program layer. The platform lets communities sponsor skill challenges while preserving the ordinary, wallet-free Bountixx Arena experience.

## Brand vocabulary

- **Crowns:** non-transferable internal Bountixx points.
- **Community Rush:** a branded program of arenas, quests, and sponsor activity.
- **Rush Vault:** a Stellar/Soroban escrow funded by a sponsor.
- **Lumen Reward:** an actual XLM reward; use `XLM` in technical interfaces.
- **Proof Mark:** public proof of a verified outcome.

## Repository responsibilities

`bountixx-app` owns the product UX; `bountixx-rush-contracts` owns fund custody and settlement; `bountixx-rush-verifier` owns deterministic scoring and signatures; `bountixx-rush-sdk` exposes shared interfaces. These boundaries are intentional. Avoid redundant implementations.

## Verified Rush flow

An organizer locks a manifest, a sponsor funds a vault, players compete in the app, this verifier signs the result, and the contract settles or refunds according to explicit rules. Arbitrary task evaluation stays off-chain. The contract verifies authorized attestations; it does not claim to independently judge code, writing, or design.

## Non-negotiables

- No private-key custody.
- No transferable Bountixx token.
- No paid-entry, winner-takes-all crypto mechanics.
- No untested mainnet claims.
- The first target is an auditable Stellar Testnet integration for a Stellar Builder Rush.
