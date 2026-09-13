# dsh-restart-button

[English](README.md) | 中文

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 界面的**设置 → General** 里加一行「重启」:点一下就重启正在服务这个页面的宿主进程,新宿主起来后页面自动刷新。不用开终端、不用 `systemctl`、不用去找当初敲 `dsh web` 的那个窗口。

会话是按事件持久化在 `~/.dsh/sessions` 的,重启不会丢;正在跑的轮次会被中断,挂起的审批问题不会保留(行内提示里已写明)。

## 功能

- 设置 → General 一行,与官方那几行同款:标题 + 说明 + 右侧 36px 胶囊按钮(`立即重启` / `重启中…`)。
- 重启语义贴合宿主真实的监管方式:
  - **systemd 监管下**(单元里设置了 `INVOCATION_ID`/`JOURNAL_STREAM`):响应刷出后干净退出,交给 `Restart=always` 拉起。此路径**绝不**自己 spawn 替代进程 —— 那样会和监管者抢端口、并逃出它的 cgroup。
  - **无监管**(裸终端、`pnpm dev`):detached node 助手等端口释放后用**完全相同的命令行**重启,日志写 `/tmp/dsh-restart-button-*.{out,err}.log`。
- 重启后该行轮询 boot id,新宿主就绪即自动刷新页面(60 秒预算)。
- 非环回客户端上该行退化为只读文案,而不是给一个按不动的按钮。

## 兼容性

| DSH | 状态 |
| --- | --- |
| `>=0.1.5-rc.1` | ✅ 支持(声明在 `engines.dsh`) |
| `<=0.1.4` | ❌ 不支持 —— 下面的通道挂载依赖 0.1.5 的 Web 路由 / `requestRejection` 形态 |

浏览器半与宿主半之间只有一条带栅栏的 HTTP 通道 `/_dsh-restart-button`,载荷就是浏览器半本来就在说的 Connection RPC 信封(`{type:'client-request',rpcId,method,payload}` → `{type:'server-response',rpcId,result}`)。端点:`status`(boot id)与 `restart`。

**为什么路由由插件自己挂,而不是 `ctx.connection.rpc.handle()`:** 0.1.5 的这个注册表走的是 `owner.webServer.register(...)`,而 `owner` 是 Connection **服务自身**的 context(其 inject 只有 `credentials`)。cordis 4 对服务属性读取做 inject 门禁,于是调用抛 `cannot get property "webServer" without inject`;这个异常发生在插件 `ctx.inject()` 的子纤维里,只会让子纤维失败 —— 插件条目依旧显示 `active`,通道**静默消失**。在调用方的 inject 列表里加 `webServer` 也没用:被门禁的是服务自身的 context,不是调用方的。

所以插件改用官方为这件事准备的两块公开能力:

- `webServer.register({ kind: 'prefix', path: '/_dsh-restart-button', handler })` —— 由功能自有的 Web 路由;
- `connection.requestRejection(req)` —— 官方描述为「把 Connection 的 Host/Origin 检查与浏览器认证施加到另一条 Web 路由」,也就是 `/api` 用的同一道栅栏(可信 authority + 浏览器会话 cookie),并且**先于任何请求字节解析**执行(未认证 401、跨站 403)。

两者都以结构化类型消费(运行时**不 import** 任何 SDK 包),这也是宿主半能跨 DSH 小版本继续工作的原因。

## 安装

```sh
# 装进 web profile(本地检出方式):
#   "dsh-restart-button": "file:/path/to/dsh-restart-button"
cd ~/.dsh/profiles/web && pnpm install
# 然后重启一次 dsh,让插件树加载它
```

插件自己注册通道;它需要 `connection` 与 `webServer` 两个服务,即 Web profile。

## 开发

```sh
pnpm install
pnpm typecheck   # 宿主半 + 浏览器半
pnpm build       # lib/index.js、lib/client.js、lib/types/**
```

- 宿主半:`src/index.ts`(TypeScript → `lib/index.js`,声明文件到 `lib/types/`)。
- 浏览器半:`src/client/*`(tsdown → `lib/client.js`,一个 CJS 包进客户端模块表;只有 `react`/`react-dom` 保持 external)。
- `cordis.patch.yml` 是加载器入口行(`dsh.bundle.patch`),用来挂载宿主半。

## 许可

MIT © 2026 allenlogo
