# Private verifier deployment

The verifier is a private service-to-service component. It signs deterministic
results only after reading a locked manifest from the Bountixx app. It does not
hold participant funds, browser credentials, or wallet private keys.

## Required deployment configuration

Store each value in the deployment platform's secret manager:

| Verifier variable | Purpose | Matching app variable |
| --- | --- | --- |
| `RUSH_VERIFIER_SHARED_SECRET` | Bearer credential for the app-to-verifier attestation request | `RUSH_VERIFIER_SHARED_SECRET` |
| `RUSH_VERIFIER_PRIVATE_KEY_PEM` | Ed25519 key used to sign Proof Marks | Derive and configure its public key as `RUSH_VERIFIER_PUBLIC_KEY_PEM` |
| `RUSH_VERIFIER_KEY_ID` | Public rotation label included in each Proof Mark | — |
| `RUSH_VERIFIER_DATABASE_URL` | Dedicated PostgreSQL/Neon connection for durable idempotency | — |
| `RUSH_MANIFEST_READER_URL` | HTTPS base URL of the deployed Bountixx app | — |
| `RUSH_MANIFEST_READER_SECRET` | Credential for the locked-manifest reader | `RUSH_VERIFIER_MANIFEST_SECRET` |

`RUSH_VERIFIER_INGEST_SECRET` belongs to the app only if an independent worker
uses `POST /api/rushes/:slug/attestations`; the standard Arena bridge writes
the verified Proof Mark through the app's database after validating the
signature.

## Start command

Build and launch with:

```text
npm ci
npm run build
npm start
```

The service listens on `PORT` (default `8080`). Restrict it to private
networking or an authenticated service gateway. Expose only the app backend to
`POST /v1/attestations`; `GET /health` can be used by the platform's health
probe.

The idempotency table is created automatically at first use. The database role
needs only the ability to create and read/write `rush_verifier_idempotency`.

## Release checks

1. Generate an Ed25519 signing key in the secret manager and configure the
   public half on the app. Never put either private material or a Bearer secret
   in a browser-visible variable.
2. Configure the matching app and verifier secrets from the table above.
3. Deploy both services privately, then check the verifier's `/health` route
   through the platform's internal health mechanism.
4. Publish one deterministic Testnet Rush linked to a real Arena, play it with
   a participant whose optional Stellar address is set, and verify its Proof
   Mark against the locked manifest before attempting a contract settlement.
5. Have the separate Stellar verifier signer submit the Testnet vault
   settlement and then exercise an independent expiry/refund fixture. The
   verifier's Ed25519 key and a Stellar account signer are distinct credentials.

Do not deploy Mainnet or present any campaign as funded until those Testnet
checks have been independently reviewed.
