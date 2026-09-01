import type { AppConfig, BuildInfo, RegistrationMode, RuntimeEnv } from "@/types";
import { DEFAULT_MAX_REQUEST_BODY_BYTES } from "@/utils/validation";

export const DEFAULT_MAX_BATCH_PUSH_COUNT = 40;
export const DEFAULT_MAX_DEVICES = 16;
export const DEFAULT_APNS_REQUEST_TIMEOUT_MS = 10_000;
export const HARD_MAX_REQUEST_BODY_BYTES = 1024 * 1024;
export const HARD_MAX_APNS_REQUEST_TIMEOUT_MS = 60_000;
export const HARD_MAX_DEVICES = 1000;

function parsePositiveInteger(
  raw: string | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

export function normalizeUrlPrefix(prefix?: string): string {
  if (!prefix || prefix === "/") {
    return "/";
  }

  const normalized = `/${prefix.replace(/^\/+|\/+$/g, "")}`;
  return normalized.length === 0 ? "/" : normalized;
}

export function parseMaxBatchPushCount(raw?: string): number {
  return parsePositiveInteger(raw, DEFAULT_MAX_BATCH_PUSH_COUNT, DEFAULT_MAX_BATCH_PUSH_COUNT);
}

export function parseMaxRequestBodyBytes(raw?: string): number {
  return parsePositiveInteger(raw, DEFAULT_MAX_REQUEST_BODY_BYTES, HARD_MAX_REQUEST_BODY_BYTES);
}

export function parseApnsRequestTimeoutMs(raw?: string): number {
  return parsePositiveInteger(
    raw,
    DEFAULT_APNS_REQUEST_TIMEOUT_MS,
    HARD_MAX_APNS_REQUEST_TIMEOUT_MS,
  );
}

export function parseRegistrationMode(raw?: string): RegistrationMode {
  const normalized = raw?.trim().toLowerCase();
  return normalized === "existing-only" || normalized === "closed" ? normalized : "open";
}

export function parseMaxDevices(raw?: string): number {
  return parsePositiveInteger(raw, DEFAULT_MAX_DEVICES, HARD_MAX_DEVICES);
}

export function createConfigFromEnv(env: RuntimeEnv): AppConfig {
  return {
    urlPrefix: normalizeUrlPrefix(env.URL_PREFIX),
    basicAuthUser: env.BASIC_AUTH_USER,
    basicAuthPassword: env.BASIC_AUTH_PASSWORD,
    maxBatchPushCount: parseMaxBatchPushCount(env.MAX_BATCH_PUSH_COUNT),
    maxRequestBodyBytes: parseMaxRequestBodyBytes(env.MAX_REQUEST_BODY_BYTES),
    apnsRequestTimeoutMs: parseApnsRequestTimeoutMs(env.APNS_REQUEST_TIMEOUT_MS),
    mcpSessionSecret: env.MCP_SESSION_SECRET,
    registrationMode: parseRegistrationMode(env.REGISTRATION_MODE),
    maxDevices: parseMaxDevices(env.MAX_DEVICES),
  };
}

export function createBuildInfoFromEnv(env: RuntimeEnv): BuildInfo {
  return {
    version: env.APP_VERSION ?? "dev",
    build: env.APP_BUILD ?? "dev",
    commit: env.APP_COMMIT ?? "dev",
    arch: "cloudflare/workerd",
    environment: env.ENVIRONMENT ?? "development",
    upstreamCommit: env.UPSTREAM_COMMIT ?? "unknown",
  };
}
