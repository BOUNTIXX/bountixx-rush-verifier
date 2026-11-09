import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  AttestationRequestError,
  IdempotencyConflictError,
  type AttestResultRequest,
} from "./service.js";

export interface HttpAttestationService {
  attest(request: AttestResultRequest): Promise<{
    attestation: unknown;
    replayed: boolean;
  }>;
}

export interface VerifierHttpOptions {
  /** A high-entropy deployment secret shared only with the trusted app backend. */
  sharedSecret: string;
  service: HttpAttestationService;
  maxBodyBytes?: number;
}

const JSON_CONTENT_TYPE = "application/json";

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": `${JSON_CONTENT_TYPE}; charset=utf-8`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function authorized(request: IncomingMessage, sharedSecret: string): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(sharedSecret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJson(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) {
      throw new RequestTooLargeError();
    }
    chunks.push(buffer);
  }
  if (size === 0) throw new AttestationRequestError("A JSON request body is required.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new AttestationRequestError("Request body must be valid JSON.");
  }
}

class RequestTooLargeError extends Error {}

/**
 * Creates the network boundary around the transport-neutral attestation
 * service. The caller is responsible for supplying a service backed by a
 * trusted manifest reader and a durable, cross-instance idempotency store.
 */
export function createVerifierHttpServer(options: VerifierHttpOptions): Server {
  if (options.sharedSecret.trim().length < 32) {
    throw new Error("Verifier sharedSecret must contain at least 32 characters.");
  }
  const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://verifier.internal");

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, { ok: true });
      return;
    }

    if (request.method !== "POST" || url.pathname !== "/v1/attestations") {
      writeJson(response, 404, { error: "Not found." });
      return;
    }
    if (!authorized(request, options.sharedSecret)) {
      writeJson(response, 401, { error: "Unauthorized." });
      return;
    }
    if (!request.headers["content-type"]?.toLowerCase().startsWith(JSON_CONTENT_TYPE)) {
      writeJson(response, 415, { error: "Content-Type must be application/json." });
      return;
    }

    try {
      const body = await readJson(request, maxBodyBytes);
      const result = await options.service.attest(body as AttestResultRequest);
      writeJson(response, 200, result);
    } catch (error) {
      if (error instanceof RequestTooLargeError) {
        writeJson(response, 413, { error: "Request body is too large." });
        return;
      }
      if (error instanceof IdempotencyConflictError) {
        writeJson(response, 409, { error: error.message });
        return;
      }
      if (error instanceof AttestationRequestError) {
        writeJson(response, 400, { error: error.message });
        return;
      }
      console.error("[verifier/http] unexpected attestation error", error);
      writeJson(response, 500, { error: "The verifier could not attest this result." });
    }
  });
}
