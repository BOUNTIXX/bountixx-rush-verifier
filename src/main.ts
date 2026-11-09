import { createVerifierRuntimeFromEnvironment } from "./runtime.js";

const port = Number(process.env.PORT ?? "8080");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port.");
}

const runtime = createVerifierRuntimeFromEnvironment();
runtime.server.listen(port, "0.0.0.0", () => {
  console.info(`[rush-verifier] listening on port ${port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.info(`[rush-verifier] received ${signal}; closing server.`);
  await runtime.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
