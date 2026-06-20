# Codex Web

本目录是一个本机浏览器版 Codex 外壳。它不会替换官方 Codex App，而是通过本机 `codex app-server` 提供一个网页入口。

已实现：

- 选择本机工作目录
- 接入目录时优先恢复该目录最近一次 Codex 历史对话，没有历史才新建
- 左侧可收起设置栏，集中放置 API 登录、模型、权限、沙箱和工作目录
- 新建 Codex 线程
- 发送对话消息
- 流式显示助手回复
- 右侧可收起运行反馈栏，显示命令执行、文件改动、计划、状态等实时事件
- 显示常见审批请求并允许批准或拒绝
- 在网页里发起 Codex 登录
- 手机浏览器适配

## 启动

推荐使用 Codex 附带的 Node.js：

```bash
/Users/yangs/Documents/New\ project/codex-web/start.sh
```

然后打开：

```text
http://127.0.0.1:8787
```

同一局域网里的其他电脑可以打开本机局域网 IP，例如：

```text
http://192.168.8.20:8787
```

也可以在本目录运行：

```bash
npm start
```

前提是系统 `node`/`npm` 可用。

`start.sh` 会优先使用 `CODEX_NODE`，其次尝试 Codex 附带的 Node.js，最后回退到系统 `node`。Codex 可执行文件默认使用 macOS App 内置路径；如果另一台电脑只安装了 CLI，可以设置：

```bash
CODEX_BIN="$(command -v codex)" ./start.sh
```

## 后台运行

启动后台服务：

```bash
./start-background.sh
```

停止后台网页：

```bash
./stop.sh
```

## 认证

这个网页会启动自己的 `codex app-server`。如果当前 CLI/app-server 没有认证，页面仍可浏览目录和创建线程，但不能真正发送模型任务。

左侧“API 设置 > 登录 Codex”支持：

- ChatGPT 设备码登录
- 浏览器登录
- API Key 登录

完成登录后刷新状态即可发送任务。

## 安全

默认监听：

```text
0.0.0.0:8787
```

这表示本机和同一局域网设备都可以访问。不要直接暴露到公网。这个网页背后连接的是能读取本机文件、运行命令、修改项目的 Codex。需要远程访问时，优先使用 SSH 隧道、Tailscale、ZeroTier 或 VPN。

如果只想本机访问，可以设置环境变量：

```bash
HOST=127.0.0.1 PORT=8787 ./start.sh
```
