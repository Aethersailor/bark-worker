import { normalizeUrlPrefix } from "@/config";
import type { RuntimeEnv } from "@/types";

const HEALTH_PATHS = new Set(["/", "/ping", "/healthz"]);

export async function protectRequest(request: Request, env: RuntimeEnv): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const prefix = normalizeUrlPrefix(env.URL_PREFIX);
  const relativePath =
    prefix === "/"
      ? pathname
      : pathname.startsWith(`${prefix}/`)
        ? pathname.slice(prefix.length)
        : pathname;
  if (request.method === "GET" && HEALTH_PATHS.has(relativePath)) {
    return null;
  }

  const unavailable = () =>
    Response.json(
      {
        code: 503,
        message: "request protection unavailable",
        timestamp: Math.floor(Date.now() / 1000),
      },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  if (!env.REQUEST_LIMITER || typeof env.REQUEST_LIMITER.limit !== "function") {
    return unavailable();
  }
  try {
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const { success } = await env.REQUEST_LIMITER.limit({ key: `bark:${ip}` });
    if (!success) {
      return Response.json(
        { code: 429, message: "too many requests", timestamp: Math.floor(Date.now() / 1000) },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    return null;
  } catch {
    return unavailable();
  }
}
