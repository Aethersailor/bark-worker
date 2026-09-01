import { createApp } from "@/app";
import { createBuildInfoFromEnv, createConfigFromEnv } from "@/config";
import { CloudflareApnsClient } from "@/services/cloudflare-apns-client";
import { D1DeviceRegistry } from "@/services/d1-device-registry";
import type { RuntimeEnv } from "@/types";

const appCache = new WeakMap<RuntimeEnv, ReturnType<typeof createApp>>();

function buildApp(env: RuntimeEnv) {
  const cached = appCache.get(env);
  if (cached) {
    return cached;
  }

  const config = createConfigFromEnv(env);
  const app = createApp({
    config,
    deps: {
      registry: new D1DeviceRegistry(env.DB),
      pushSender: new CloudflareApnsClient({
        privateKey: env.APNS_PRIVATE_KEY,
        keyId: env.APNS_KEY_ID,
        teamId: env.APNS_TEAM_ID,
        topic: env.APNS_TOPIC,
        timeoutMs: config.apnsRequestTimeoutMs,
      }),
      now: () => Math.floor(Date.now() / 1000),
      buildInfo: createBuildInfoFromEnv(env),
    },
  });

  appCache.set(env, app);
  return app;
}

export default {
  fetch(request: Request, env: RuntimeEnv, executionContext: ExecutionContext) {
    return buildApp(env).fetch(request, env, executionContext);
  },
} satisfies ExportedHandler<RuntimeEnv>;
