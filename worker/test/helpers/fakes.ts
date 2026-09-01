import { createApp } from "@/app";
import { RegistrationRejectedError } from "@/services/d1-device-registry";
import { DEFAULT_APNS_REQUEST_TIMEOUT_MS, DEFAULT_MAX_BATCH_PUSH_COUNT } from "@/config";
import type {
  ApnsSendError,
  AppConfig,
  BuildInfo,
  DeviceRegistry,
  PushMessage,
  PushSender,
  RuntimeDeps,
} from "@/types";

export class InMemoryDeviceRegistry implements DeviceRegistry {
  private readonly store = new Map<string, string>();
  private generatedKeys = ["generated-device-key"];

  constructor(seed: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(seed)) {
      this.store.set(key, value);
    }
  }

  setGeneratedKeys(keys: string[]) {
    this.generatedKeys = [...keys];
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.store.entries());
  }

  async countAll(): Promise<number> {
    return this.store.size;
  }

  async deviceTokenByKey(key: string): Promise<string> {
    const token = this.store.get(key);
    if (token === undefined) {
      throw new Error(`failed to get [${key}] device token from database`);
    }
    if (token.length === 0) {
      throw new Error("device token invalid");
    }
    return token;
  }

  async saveDeviceTokenByKey(
    key: string,
    token: string,
    policy = { allowNew: true, maxDevices: 16 },
  ): Promise<string> {
    if (key.length > 0 && this.store.has(key)) {
      this.store.set(key, token);
      return key;
    }

    if (!policy.allowNew) {
      throw new RegistrationRejectedError("new device registration is disabled");
    }
    if (this.store.size >= policy.maxDevices) {
      throw new RegistrationRejectedError(`device limit reached: ${policy.maxDevices}`);
    }

    const nextKey = this.generatedKeys.shift() || "generated-device-key";
    this.store.set(nextKey, token);
    return nextKey;
  }

  async deleteDeviceByKey(key: string, expectedToken?: string): Promise<boolean> {
    if (expectedToken !== undefined && this.store.get(key) !== expectedToken) {
      return false;
    }

    this.store.set(key, "");
    return true;
  }
}

export class RecordingPushSender implements PushSender {
  readonly messages: PushMessage[] = [];
  private readonly failuresByDeviceToken = new Map<string, ApnsSendError>();

  failForDeviceToken(deviceToken: string, error: ApnsSendError) {
    this.failuresByDeviceToken.set(deviceToken, error);
  }

  async send(message: PushMessage): Promise<void> {
    this.messages.push(structuredClone(message));

    const failure = this.failuresByDeviceToken.get(message.deviceToken);
    if (failure) {
      throw failure;
    }
  }
}

export interface TestHarnessOptions {
  config?: Partial<AppConfig>;
  buildInfo?: Partial<BuildInfo>;
  registrySeed?: Record<string, string>;
  now?: () => number;
}

export interface TestHarness {
  app: ReturnType<typeof createApp>;
  config: AppConfig;
  deps: RuntimeDeps;
  registry: InMemoryDeviceRegistry;
  sender: RecordingPushSender;
}

export function createApnsError(message: string, statusCode: number): ApnsSendError {
  const error = new Error(message) as ApnsSendError;
  error.statusCode = statusCode;
  error.reason = message;
  return error;
}

export function createHarness(options: TestHarnessOptions = {}): TestHarness {
  const registry = new InMemoryDeviceRegistry(options.registrySeed);
  const sender = new RecordingPushSender();

  const config: AppConfig = {
    urlPrefix: "/",
    basicAuthUser: undefined,
    basicAuthPassword: undefined,
    maxBatchPushCount: DEFAULT_MAX_BATCH_PUSH_COUNT,
    maxRequestBodyBytes: 64 * 1024,
    apnsRequestTimeoutMs: DEFAULT_APNS_REQUEST_TIMEOUT_MS,
    mcpSessionSecret: undefined,
    registrationMode: "open",
    maxDevices: 16,
    ...options.config,
  };

  const buildInfo: BuildInfo = {
    version: "test-version",
    build: "test-build",
    commit: "test-commit",
    arch: "cloudflare/workerd",
    environment: "test",
    upstreamCommit: "test-upstream-commit",
    ...options.buildInfo,
  };

  const deps: RuntimeDeps = {
    registry,
    pushSender: sender,
    now: options.now ?? (() => 1_717_900_000),
    buildInfo,
  };

  return {
    app: createApp({ config, deps }),
    config,
    deps,
    registry,
    sender,
  };
}

export function createBasicAuthHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}
