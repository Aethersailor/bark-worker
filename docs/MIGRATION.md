# Bbolt 到 D1 迁移手册

迁移目标是保留现有 `device_key`。保留 key 后，已有 webhook、脚本和通知 URL 不需要修改。

## 风险

- 导出文件包含 device key 和 APNs device token。按凭据文件保护。
- 切换后如果 Bark App 更新 token，旧 Bbolt 会过期。
- 回滚前必须把最新 D1 数据同步回 Bbolt，或重新注册设备。

## 1. 停止写入并备份

在旧 Bark 服务所在主机停止入口写入。复制 `bark.db` 到只读备份位置。不要直接操作唯一数据库文件。

## 2. 导出 Bbolt

```sh
go -C tools/bark-db run . export \
  -input /path/to/backup/bark.db \
  -output devices.bark-export.json
```

工具输出记录数量和 SHA-256，不打印 token。输出文件已存在时，工具停止并保持原文件不变。

## 3. 生成 D1 SQL

```sh
node scripts/device-export-to-d1.mjs \
  devices.bark-export.json \
  devices.bark-backup.sql
```

脚本重新计算导出校验和。校验失败时不生成 SQL。

## 4. 导入 D1

```sh
pnpm exec wrangler d1 execute DB \
  --env production \
  --remote \
  --file devices.bark-backup.sql
```

## 5. 验证

```sh
pnpm exec wrangler d1 execute DB \
  --env production \
  --remote \
  --command "SELECT COUNT(*) AS count FROM devices"
```

数量必须与导出工具输出一致。随后使用一个既有 key 完成真实推送。

## 6. 切换

将 production 的 `REGISTRATION_MODE` 设置为 `existing-only`。部署 Worker 后切换域名或在 Bark App 中添加新服务器。

旧服务和备份至少保留到公网推送、加密通知和 token 更新全部通过。

## 回滚到 Bbolt

如果 D1 仍未接收新写入，可以直接恢复旧入口。

如果 D1 已接收新写入：

1. 从 D1 导出最新设备数据。
2. 转换为 `devices.bark-export.json`。
3. 使用 `bark-db import` 生成新的 Bbolt 文件。
4. 验证记录数量和 SHA-256。
5. 停止 Worker 写入。
6. 用新文件替换旧服务数据并启动旧服务。

`bark-db import` 不覆盖已有文件：

```sh
go -C tools/bark-db run . import \
  -input devices.bark-export.json \
  -output restored.bark.db
```
