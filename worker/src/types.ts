export interface CommonResp {
  code: number;
  message: string;
  data?: unknown;
  timestamp: number;
}

export interface BuildInfo {
  version: string;
  build: string;
  commit: string;
  arch: string;
  environment: string;
  upstreamCommit: string;
}

export type RegistrationMode = "open" | "existing-only" | "closed";

export interface AppConfig {
  urlPrefix: string;
  basicAuthUser?: string;
  basicAuthPassword?: string;
  maxBatchPushCount: number;
  maxRequestBodyBytes: number;
  apnsRequestTimeoutMs: number;
  mcpSessionSecret?: string;
  registrationMode: RegistrationMode;
  maxDevices: number;
}

export interface SecretBindings {
  BASIC_AUTH_USER?: string;
  BASIC_AUTH_PASSWORD?: string;
  MCP_SESSION_SECRET?: string;
  APNS_PRIVATE_KEY?: string;
}

export type RuntimeEnv = Env & SecretBindings;

export type ParamValue = string | number | boolean | null | undefined | ParamMap | ParamValue[];

export type ParamMap = Record<string, unknown>;

export interface DeviceRegistry {
  countAll(): Promise<number>;
  deviceTokenByKey(key: string): Promise<string>;
  saveDeviceTokenByKey(
    key: string,
    token: string,
    policy: { allowNew: boolean; maxDevices: number },
  ): Promise<string>;
  deleteDeviceByKey(key: string, expectedToken?: string): Promise<boolean>;
}

export interface PushMessage {
  id?: string;
  deviceKey: string;
  deviceToken: string;
  title: string;
  subtitle: string;
  body: string;
  sound: string;
  extParams: Record<string, unknown>;
}

export interface ApnsSendError extends Error {
  statusCode?: number;
  reason?: string;
}

export interface PushSender {
  send(message: PushMessage): Promise<void>;
}

export interface RuntimeDeps {
  registry: DeviceRegistry;
  pushSender: PushSender;
  now(): number;
  buildInfo: BuildInfo;
}
