# 部署手册

本项目通过本地 Wrangler 手动部署。production 使用 `bark-worker`；可选的 staging 使用 `bark-worker-staging` 和独立 D1 数据库。

以下步骤默认只部署 production。命令采用 POSIX shell 语法；Windows 可使用 Git Bash。部署不需要配置 GitHub Environment、secrets 或 variables。

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
pnpm exec wrangler d1 create bark-worker-db
```

将命令返回的 `database_id` 写入 `wrangler.jsonc` 的 `env.production.d1_databases`，替换示例 ID，再生成类型：

```sh
pnpm types
```

## 4. 配置 APNs secret

以下命令从锁定的官方上游 SHA 提取 APNs 私钥，并直接写入 Cloudflare。命令不会在终端打印私钥。

```sh
node scripts/print-upstream-apns-key.mjs | pnpm exec wrangler secret put APNS_PRIVATE_KEY --env production
```

Basic Auth 和 MCP session secret 也使用 `wrangler secret put`。不要写入 `wrangler.jsonc`。

## 5. 应用迁移

```sh
pnpm exec wrangler d1 migrations apply DB --env production --remote
```

迁移失败时停止部署。不要跳过失败迁移或手工修改 `d1_migrations`。

## 6. 部署 production

从需要部署的 Git 提交运行以下命令，将版本、构建时间、当前提交和锁定的上游提交写入 `/info`：

```sh
pnpm exec wrangler deploy --env production --strict --minify \
  --var "APP_VERSION:$(node -p 'require("./package.json").version')" \
  --var "APP_BUILD:$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --var "APP_COMMIT:$(git rev-parse HEAD)" \
  --var "UPSTREAM_COMMIT:$(node -p 'require("./upstream/UPSTREAM.lock.json").commit')"
```

`wrangler.jsonc` 中的版本信息用于本地开发，未指定上游提交时显示 `unknown`。上游同步只更新锁文件；手动部署时以上述命令读取当前记录。

使用部署输出中的 URL 验证：

```sh
curl https://<production-worker>/healthz
curl https://<production-worker>/ping
curl https://<production-worker>/info
```

## 7. 可选的 staging 部署

需要 staging 时，单独创建数据库，将返回的 ID 写入 `env.staging.d1_databases`，再配置密钥并应用迁移：

```sh
pnpm exec wrangler d1 create bark-worker-staging-db
pnpm types
node scripts/print-upstream-apns-key.mjs | pnpm exec wrangler secret put APNS_PRIVATE_KEY --env staging
pnpm exec wrangler d1 migrations apply DB --env staging --remote
```

部署时使用第 6 步的命令，将 `--env production` 改为 `--env staging`。staging 不作为 production 部署的前置步骤。

## 8. 首次注册后的保护

完成 Bark App 注册或旧数据导入后，将 production 的 `REGISTRATION_MODE` 改为 `existing-only`。重新运行 `pnpm types` 并部署。

## 回滚

Worker 代码回滚：

```sh
pnpm exec wrangler rollback --env production
```

D1 数据恢复使用 Time Travel。Worker 回滚不会回滚 D1，因此数据库迁移必须保持向后兼容。
