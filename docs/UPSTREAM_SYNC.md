# 上游同步说明

`upstream/UPSTREAM.lock.json` 记录 `Finb/bark-server` 的仓库、分支、精确提交、同步时间和追踪文件的 SHA-256。

## 手动同步

```sh
pnpm upstream:sync
```

命令读取上游 `master` 最新提交，下载追踪文件并更新锁文件。提交未变化时，保持锁文件不变。上游自带的 `push_test.go` 和 API 文档继续纳入记录。

同步不会自动将 Go 代码移植到 TypeScript。Worker 的功能调整由维护者处理。

## GitHub Actions

`Upstream Sync` 每天执行一次，也可以手动触发：

1. 获取上游最新提交并更新锁文件。
2. 提交有变化的锁文件到 `main`。
3. `AUTO_DEPLOY_ENABLED=true` 时，直接部署 production。

没有上游变化时，不创建提交或部署。网络请求、文件读取或部署出错时，工作流报告实际错误。
