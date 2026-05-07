# Folder Delta Sync

Folder Delta Sync 是一个面向局域网 Windows 机器的差异文件夹传输工具。

目标机器运行 Go server 并指定写入目录，源机器用 Chrome 打开 Web 页面选择本地文件夹。程序会先比较目标目录中已有文件，只上传缺失或内容不同的文件。

## 特性

- 目标端写入，源端浏览器上传
- 支持 Chrome File System Access API，非安全上下文自动降级到 `webkitdirectory`
- SHA-256 强校验，只传差异文件
- 保留上传文件的修改时间
- Go 后端内嵌 React 前端，发布时一个 exe
- 可选 API token

## 开发环境

- Go 1.24+
- Node.js 20+
- npm 10+

## 开发运行

安装前端依赖：

```powershell
cd web
npm install
```

启动前端开发服务器：

```powershell
cd web
npm run dev
```

另开一个终端启动后端：

```powershell
go run ./cmd/folder-delta-sync -dir D:\TargetFolder -http
```

开发时 Vite 会把 `/api` 代理到 `http://localhost:8787`。

## 构建单文件 exe

```powershell
.\scripts\build.ps1
```

输出文件：

```text
dist\folder-delta-sync.exe
```

## 使用

在目标机器上：

```powershell
folder-delta-sync.exe -dir D:\TargetFolder -listen :8787 -gen-token
```

终端会打印可访问 URL。源机器用 Chrome 打开对应地址，选择源文件夹后会自动开始比较和上传。

如果 Chrome 对自签名 HTTPS 证书弹出提示，需要先允许访问；如果使用 `-http`，页面会自动使用兼容的文件夹选择方案。

## 命令行参数

| 参数 | 说明 |
| --- | --- |
| `-dir` | 目标机器上的写入目录，必填 |
| `-listen` | 监听地址，默认 `:8787` |
| `-http` | 使用 HTTP，不启用自签名 HTTPS |
| `-token` | 手动指定 API token |
| `-gen-token` | 启动时生成临时 API token |
| `-cert` / `-key` | 使用指定 TLS 证书和私钥 |

## 安全说明

这个程序会写入 `-dir` 指定的目录。跨机器使用时建议加 `-gen-token` 或 `-token`，并只在可信局域网中开放端口。

