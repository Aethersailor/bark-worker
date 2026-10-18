# 部署手册

正式服务使用 `bark-worker`。可选的 `bark-worker-staging` 使用独立 D1 数据库，通过手动部署维护。

## 前置条件

- Node.js 24。
- pnpm 11。
- 已启用 Workers 和 D1 的 Cloudflare 账户。
- Wrangler 4。
- 可以访问 `Finb/bark-server` 和 `api.push.apple.com`。

## 1. 安装依赖并构建

```sh
pnpm install --frozen-lockfile
pnpm build
```

预期结果：生成 Worker 部署包。功能由维护者人工验证。

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

只部署 production 时，仅创建 `bark-worker-db`。将命令返回的 `database_id` 写入 `wrangler.jsonc` 的对应环境，再生成类型：

```sh
pnpm types
```

## 4. 配置 APNs secret

以下命令从锁定的官方上游 SHA 提取 APNs 私钥，并直接写入 Cloudflare。命令不会在终端打印私钥。

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

## 6. 部署 production

```sh
pnpm exec wrangler deploy --env production --strict --minify
```

使用部署输出中的 URL 验证：

```sh
curl https://<production-worker>/healthz
curl https://<production-worker>/ping
curl https://<production-worker>/info
```

## 7. 可选的 staging 部署

```sh
pnpm exec wrangler deploy --env staging --strict --minify
```

## 8. 首次注册后的保护

完成 Bark App 注册或旧数据导入后，将 production 的 `REGISTRATION_MODE` 改为 `existing-only`。重新运行 `pnpm types` 并部署。

## GitHub Actions 手动部署

GitHub `staging` 和 `production` Environment 需要以下 secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

`Deploy` 工作流仅支持手动触发或显式调用。主分支 push、依赖合并和上游同步均不会自动部署。`AUTO_DEPLOY_ENABLED` 变量不再控制部署。

在 Actions 页面启用 `Deploy` 工作流后，手动选择 staging 或 production 执行部署。

Cloudflare API Token 只授予目标账户的 Workers Scripts 和 D1 必要权限。

## 回滚

Worker 代码回滚：

```sh
pnpm exec wrangler rollback --env production
```

D1 数据恢复使用 Time Travel。Worker 回滚不会回滚 D1，因此数据库迁移必须保持向后兼容。
