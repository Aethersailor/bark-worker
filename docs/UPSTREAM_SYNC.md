# 上游同步说明

`upstream/UPSTREAM.lock.json` 固定 `Finb/bark-server` 的精确提交和文件哈希。

## 本地检查

```sh
pnpm upstream:check
```

该命令只读取锁定提交。文件、哈希或提取契约不一致时返回失败。

## 检查最新提交

```sh
pnpm upstream:sync
```

结果分为两类：

- 语义文件未变化：更新锁文件，可以继续测试和部署。
- 语义文件变化：退出码为 2，禁止自动部署。

语义文件包括路由、认证、数据库接口、APNs、服务初始化和上游凭据。

## GitHub Actions

`Upstream Sync` 每天检查一次上游：

1. 获取 `master` 最新 SHA。
2. 下载监控文件。
3. 计算 SHA-256 并提取路由、数据库方法和 APNs 契约。
4. 对安全更新运行完整 `pnpm check`。
5. 提交锁文件并按配置部署。
6. 对语义变化创建 Issue 并失败退出。

定时工作流不会自动修改 TypeScript 行为。维护者审查语义变化、更新实现和测试后，手工刷新锁文件。
