# 部署手册

本手册部署两个相互隔离的环境：`bark-worker-staging` 和 `bark-worker`。两个环境使用独立 D1 数据库。

## 前置条件

- Node.js 24。
- pnpm 11。
- 已启用 Workers 和 D1 的 Cloudflare 账户。
- Wrangler 4。
- 可以访问 `Finb/bark-server` 和 `api.push.apple.com`。

## 1. 安装并验证源码

```sh
pnpm install --frozen-lockfile
pnpm check
```

预期结果：格式、lint、类型、D1 迁移、测试、构建和上游锁检查全部通过。

## 2. 登录 Cloudflare

```sh
pnpm exec wrangler login
pnpm exec wrangler whoami
```

`whoami` 必须显示预期 Cloudflare 账户。不要在身份不明确时创建数据库或 Worker。

## 3. 创建 D1 数据库

```sh
pnpm exec wrangler d1 create bark-worker-staging-db
pnpm exec wrangler d1 create bark-worker-db
```

将命令返回的两个 `database_id` 分别写入 `wrangler.jsonc` 的 `staging` 和 `production` 环境。重新生成类型并验证配置：

```sh
pnpm types
pnpm typecheck
```

## 4. 配置 APNs secret

以下命令从锁定的官方上游 SHA 提取 APNs 私钥，校验 SHA-256 指纹后直接写入 Cloudflare。命令不会在终端打印私钥。

```sh
node scripts/print-upstream-apns-key.mjs | pnpm exec wrangler secret put APNS_PRIVATE_KEY --env staging
node scripts/print-upstream-apns-key.mjs | pnpm exec wrangler secret put APNS_PRIVATE_KEY --env production
```

Basic Auth 和 MCP session secret 也使用 `wrangler secret put`。不要写入 `wrangler.jsonc`。

## 5. 应用迁移

```sh
pnpm exec wrangler d1 migrations apply DB --env staging --remote
pnpm exec wrangler d1 migrations apply DB --env production --remote
```

迁移失败时停止部署。不要跳过失败迁移或手工修改 `d1_migrations`。

## 6. 部署 staging

```sh
pnpm exec wrangler deploy --env staging --strict --minify
```

使用部署输出中的 URL 验证：

```sh
curl https://<staging-worker>/healthz
curl https://<staging-worker>/ping
curl https://<staging-worker>/info
```

## 7. 部署 production

staging 全部通过后执行：

```sh
pnpm exec wrangler deploy --env production --strict --minify
```

运行公开验证：

```sh
node scripts/smoke.mjs https://<production-worker> <git-sha> <upstream-sha>
```

## 8. 首次注册后的保护

完成 Bark App 注册或旧数据导入后，将 production 的 `REGISTRATION_MODE` 改为 `existing-only`。重新运行 `pnpm types`、测试和部署。

## GitHub Actions 自动部署

GitHub `staging` 和 `production` Environment 需要以下 secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

仓库 variables：

- `AUTO_DEPLOY_ENABLED=true`
- `STAGING_BASE_URL`
- `PRODUCTION_BASE_URL`

Cloudflare API Token 只授予目标账户的 Workers Scripts 和 D1 必要权限。自动部署启用前，先手工运行一次 `Deploy` 工作流。

## 回滚

Worker 代码回滚：

```sh
pnpm exec wrangler rollback --env production
```

D1 数据恢复使用 Time Travel。Worker 回滚不会回滚 D1，因此数据库迁移必须保持向后兼容。
