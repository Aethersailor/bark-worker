# Bark Worker

`bark-worker` 是 [`Finb/bark-server`](https://github.com/Finb/bark-server) 的 Cloudflare Workers 独立实现。项目使用 TypeScript、Hono 和 Cloudflare D1，面向个人 Bark 服务，在免费套餐限制内保持 Bark HTTP API、APNs 推送和 MCP `notify` 工具兼容。

设备数据存储在 D1 中，无需配置 Workers KV、Durable Objects、R2、Queues 或 Containers。首次部署请参阅 [部署手册](docs/DEPLOYMENT.md)。

## 主要能力

- 支持 Bark App 使用的旧版注册和推送 URL。
- 支持 `POST /register`、`POST /push` 和批量推送。
- 支持 `/mcp` 与 `/mcp/:device_key`。
- 使用 D1 保存 `device_key → device_token`。
- 使用 Web Crypto 生成 APNs ES256 JWT。
- 自动限制请求体、批量并发和设备数量。
- 自动同步上游版本和文件记录。
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

## 请求保护与费用边界

注册、推送、MCP 和 `/info` 等接口在访问数据库或 APNs 前调用 `REQUEST_LIMITER`。默认限制同一 IP 在单个 Cloudflare 节点每分钟最多 120 次请求；本地、staging 和 production 环境使用独立计数器。绑定缺失或限流服务出错时返回 `503`，超限时返回 `429` 并附带 `Retry-After: 60`。`GET /`、`GET /ping` 和 `GET /healthz` 不访问数据库，仍可用于健康检查。

限流用于降低滥用风险，不能作为全账户费用上限。需要阻止 Workers 和 D1 超额计费时，应保留 Workers Free 套餐；额度耗尽后操作会失败。付费套餐按超额用量计费，预算告警只通知、不停止用量。不要为此项目启用独立计费产品。

版本预览 URL 默认禁用，避免历史实现绕过当前入口保护。正式 Worker 地址仍用于 Bark App 和部署验收。

## 部署

部署前需要 Cloudflare 账户、D1 数据库和已认证的 Wrangler。按照 [部署手册](docs/DEPLOYMENT.md) 创建资源、配置 APNs secret、运行迁移并验证公开端点。

```sh
pnpm install
pnpm build
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

## 本地开发

```sh
pnpm install
pnpm dev
pnpm build
```

功能由维护者人工验证。

## 上游同步

`upstream/UPSTREAM.lock.json` 记录上游仓库、精确 SHA、同步时间和文件哈希。定时工作流直接更新记录。

上游自带的测试文件和 API 文档继续纳入追踪。同步不会自动将 Go 代码移植到 TypeScript；Worker 的功能调整由维护者处理。

维护规则见 [上游同步说明](docs/UPSTREAM_SYNC.md)。

## 依赖自动维护

Dependabot 每天检查 npm、Go module 和 GitHub Actions 依赖。自动合并使用维护 App 为本仓库签发的短期令牌，只处理同仓库、非草稿的 Dependabot PR，并核对依赖文件范围、签名与当前 head SHA。

更新无需人工批准或等待检查结果。存在合并冲突时，由 Dependabot 自动重整分支，更新后继续自动合并。每小时自动核对开放 PR，补偿遗漏事件。依赖合并和上游同步均不会部署 Worker；部署需手动执行。

其他已授权仓库的工作流依赖由 `Dependabot workflow maintenance` 每 30 分钟自动处理，已归档仓库自动跳过，普通依赖继续由各仓库的事件工作流合并。仓库清单保存在 `DEPENDABOT_MERGE_REPOSITORIES` secret，私钥仅保存在本仓库。该任务只读取 GitHub 元数据，不检出或执行 PR 源码；合并后由目标仓库的 push 事件触发扫描和构建。

## 安全

- `APNS_PRIVATE_KEY` 只存放在 Cloudflare secret 或临时部署文件中。
- 日志不记录完整 URL、device key、device token、Authorization 或通知正文。
- Basic Auth 用户名、密码和 `MCP_SESSION_SECRET` 必须使用 Worker secret。
- 仓库使用 Dependabot 自动维护依赖。

安全问题请按照 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证与归属

项目采用 [MIT License](LICENSE)。Bark API 行为和 APNs 配置以 `Finb/bark-server` 为兼容目标；初始 TypeScript 兼容层源自 MIT 项目 `frankwei98/bark-serverless`。代码来源与归属见 [NOTICE](NOTICE.md)，上游跟踪范围见 [UPSTREAM](UPSTREAM.md)。
