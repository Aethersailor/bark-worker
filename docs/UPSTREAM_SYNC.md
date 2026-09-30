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

结果分为三类：

- 提交和内容均未变化：成功退出，保持锁文件不变。
- 语义文件未变化：更新锁文件，可以继续测试和部署。
- 语义文件变化：退出码为 2，禁止自动部署。

语义文件包括路由、认证、数据库接口、APNs、服务初始化和上游凭据。

网络、GitHub API 或锁文件解析错误也会使检查失败，不会视为安全更新。

## 审查后更新锁文件

语义文件变化后，先比较锁定提交与候选提交的完整差异，确认对 Worker 的影响，完成必要的代码适配和回归测试。然后使用已审查的完整 SHA 更新锁文件：

```sh
node scripts/check-upstream.mjs --lock upstream/UPSTREAM.lock.json --write --accept-commit <已审查的完整提交SHA>
pnpm check
```

`--accept-commit` 只下载指定提交，不读取可能继续变化的 `master` 分支，也不会放行后续语义变化。检查通过后，将锁文件、审查结论和必要的实现变更一起提交。不要删除锁文件来绕过检查。

### MCP 空闲会话回收审查

[`5ea5486d8e4fe2fff0b4b170a89b2457e808c9c3`](https://github.com/Finb/bark-server/commit/5ea5486d8e4fe2fff0b4b170a89b2457e808c9c3) 相比此前锁定的 `8eda67fde66c03366ae9d284dd08fcf6ceec3377`，仅在 `route_mcp.go` 为两个 MCP 服务配置 10 分钟空闲会话回收。

Worker 使用无状态 HMAC 签名令牌，不保存服务端会话对象，没有对应的闲置对象需要回收。保留现有 24 小时固定有效期，不新增会话存储或清理任务。会话跨实例验证、到期返回 `404`、设备作用域和签名检查由 MCP 测试覆盖。具体差异见 [MCP 文档](MCP.md)。

## GitHub Actions

`Upstream Sync` 每天检查一次上游：

1. 获取 `master` 最新 SHA。
2. 下载监控文件。
3. 计算 SHA-256 并提取路由、数据库方法和 APNs 契约。
4. 对安全更新运行完整 `pnpm check`。
5. 提交锁文件并按配置部署。
6. 对语义变化创建 Issue 并失败退出。

定时工作流不会自动修改 TypeScript 行为，也不传入 `--accept-commit`。语义变化阻止本次同步提交和部署；普通主分支发布仍基于已审查的锁定提交运行。
