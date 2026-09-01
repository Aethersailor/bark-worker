# Bark Worker

`bark-worker` 是 [`Finb/bark-server`](https://github.com/Finb/bark-server) 的 Cloudflare Workers 独立实现。项目使用 TypeScript、Hono 和 Cloudflare D1，面向个人 Bark 服务，在免费套餐限制内保持 Bark HTTP API、APNs 推送和 MCP `notify` 工具兼容。

项目不依赖 Workers KV、Durable Objects、R2、Queues 或 Containers。唯一主要上游是 `Finb/bark-server`。

## 主要能力

- 支持 Bark App 使用的旧版注册和推送 URL。
- 支持 `POST /register`、`POST /push` 和批量推送。
- 支持 `/mcp` 与 `/mcp/:device_key`。
- 使用 D1 保存 `device_key → device_token`。
- 使用 Web Crypto 生成 APNs ES256 JWT。
- 自动限制请求体、批量并发和设备数量。
- 自动监测上游；语义文件变化时停止部署并创建 Issue。
- 提供 Bbolt 导出、恢复和 D1 导入工具。

## API

| 方法          | 路径                       | 用途                                     |
| ------------- | -------------------------- | ---------------------------------------- |
| `GET`         | `/`                        | 返回 `ok`。                              |
| `GET`         | `/ping`                    | 返回 Bark 兼容的 `pong` JSON。           |
| `GET`         | `/healthz`                 | 运行状态检查。                           |
| `GET`         | `/info`                    | 返回版本、Git SHA、上游 SHA 和设备数量。 |
| `GET`、`POST` | `/register`                | 注册或更新设备。                         |
| `GET`         | `/register/:device_key`    | 检查设备 key。                           |
| `POST`        | `/push`                    | Bark V2 单设备或批量推送。               |
| `GET`、`POST` | `/:device_key/...`         | Bark 旧版路径推送。                      |
| `POST`        | `/mcp`、`/mcp/:device_key` | MCP Streamable HTTP JSON 响应。          |

完整参数见 [API V2](docs/API_V2.md) 和 [MCP](docs/MCP.md)。

## 免费额度设计

- 每次普通推送执行一次 D1 主键读取和一次 APNs 请求。
- 批量推送默认最多 40 个设备，同时最多建立 6 个 APNs 请求。
- 请求正文默认最多 64 KiB；APNs payload 严格限制为 4096 字节。
- 新安装默认最多注册 16 个设备。已有 key 不受该数量限制，可以继续更新 token。
- APNs JWT 在 Worker isolate 中复用 50 分钟，不占用 D1 或 KV 配额。

## 注册模式

`REGISTRATION_MODE` 支持以下值：

- `open`：允许已有 key 更新 token，也允许新设备注册。
- `existing-only`：只允许已有 key 更新 token。
- `closed`：禁止所有注册写入；`GET /register/:device_key` 仍可检查 key。

首次配置 Bark App 时使用 `open`。完成设备注册或旧数据导入后，生产环境建议改为 `existing-only`。

## 部署

部署前需要 Cloudflare 账户、两个 D1 数据库和已认证的 Wrangler。按照 [部署手册](docs/DEPLOYMENT.md) 创建资源、配置 APNs secret、运行迁移并验证公开端点。

```sh
pnpm install
pnpm check
pnpm exec wrangler deploy --env staging
pnpm exec wrangler deploy --env production
```

`wrangler.jsonc` 是 Worker 配置的唯一事实来源。不要在 Cloudflare Dashboard 中长期维护与仓库不同的变量或绑定。

## 从原版 Bark 迁移

项目提供只读 Bbolt 导出工具。工具不会覆盖已有输出文件，也不会在日志中打印 device token。

```sh
go -C tools/bark-db run . export -input /path/to/bark.db -output devices.bark-export.json
node scripts/device-export-to-d1.mjs devices.bark-export.json devices.bark-backup.sql
pnpm exec wrangler d1 execute DB --env production --remote --file devices.bark-backup.sql
```

详细停止条件、校验和回滚步骤见 [迁移手册](docs/MIGRATION.md)。

## 开发与验证

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm migrate:local
pnpm test
pnpm build
pnpm upstream:check
```

`pnpm check` 依次执行全部检查。单元测试在 Node.js 中运行；D1 集成测试在真实 `workerd` 测试运行时中执行。

## 上游同步

`upstream/UPSTREAM.lock.json` 固定上游仓库、精确 SHA、受监控文件哈希和提取后的接口契约。

- 文档或测试变化且语义文件未变化时，定时工作流可以安全更新锁文件。
- 路由、数据库接口、APNs 或服务启动逻辑变化时，工作流创建 Issue 并停止自动部署。
- 项目不会尝试自动把任意 Go 代码翻译为 TypeScript。

维护规则见 [上游同步说明](docs/UPSTREAM_SYNC.md)。

## 安全

- `APNS_PRIVATE_KEY` 只存放在 Cloudflare secret 或临时部署文件中。
- 日志不记录完整 URL、device key、device token、Authorization 或通知正文。
- Basic Auth 用户名、密码和 `MCP_SESSION_SECRET` 必须使用 Worker secret。
- 仓库启用 CI、CodeQL、Dependabot 和 GitHub Secret Scanning。

安全问题请按照 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证与归属

项目使用 MIT License。`Finb/bark-server` 是行为和 APNs 配置的主要上游。初始 TypeScript 兼容层参考了 MIT 项目 `frankwei98/bark-serverless`；本项目不跟踪该项目，也未使用 `cwxiaos/bark-worker` 的 GPL 代码。详见 [NOTICE](NOTICE.md) 和 [UPSTREAM](UPSTREAM.md)。
