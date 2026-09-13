# dsh-restart-button

English | [中文](README.zh.md)

A **restart row in Settings → General** for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI: one click restarts the host process that serves the page, then the tab reloads itself once the replacement host answers. No terminal, no `systemctl`, no hunting for the window that started `dsh web`.

Sessions are persisted per event under `~/.dsh/sessions`, so a restart does not lose them; a running turn is interrupted, and in-flight approval questions do not survive (the row's hint says so).

## Features

- One row in Settings → General, next to the shipped rows: title, hint, and a 36px pill button (`Restart now` / `Restarting…`).
- Restart semantics that fit how the host is actually supervised:
  - **Under systemd** (the unit sets `INVOCATION_ID`/`JOURNAL_STREAM`): exit cleanly after the response has flushed, and let `Restart=always` bring the host back. The plugin never spawns a replacement here — a detached child would race the supervisor for the port and escape its cgroup.
  - **Without a supervisor** (a bare terminal, `pnpm dev`): a detached node helper waits for the port to free, relaunches the exact same command line, and logs to `/tmp/dsh-restart-button-*.{out,err}.log`.
- The row polls the boot id after the restart and reloads the page when the replacement host is up (60s budget).
- Degrades visibly: on a non-loopback client the row renders read-only instead of a button that cannot work.

## Compatibility

| DSH | Status |
| --- | --- |
| `>=0.1.5-rc.1` | ✅ supported (declared in `engines.dsh`) |
| `<=0.1.4` | ❌ not supported — the channel mount below relies on the 0.1.5 Web-route/`requestRejection` shape |

The row talks to the host over one fenced HTTP channel, `/_dsh-restart-button`, carrying the Connection RPC envelope (`{type:'client-request',rpcId,method,payload}` → `{type:'server-response',rpcId,result}`) that the browser half already speaks. Endpoints: `status` (boot id) and `restart`.

**Why the route is mounted by the plugin instead of `ctx.connection.rpc.handle()`:** on 0.1.5 that registry mounts through `owner.webServer.register(...)`, where `owner` is the Connection *service's own* context (inject: `credentials` only). Service access is inject-gated by cordis 4, so the call throws `cannot get property "webServer" without inject`; raised inside the `ctx.inject()` child fiber this plugin needs, that error only fails the child fiber — the plugin entry still reports `active` and the channel is silently missing. Passing `webServer` in the caller's inject list does not help, because the gated context is the service's, not the caller's.

So the plugin uses the two public pieces that exist for exactly this:

- `webServer.register({ kind: 'prefix', path: '/_dsh-restart-button', handler })` — a feature-owned Web route;
- `connection.requestRejection(req)` — "apply Connection's Host/Origin checks and browser authentication to another Web route": the same fence `/api` uses (trusted authority plus the browser session cookie), applied before a single request byte is decoded (401 unauthenticated, 403 cross-site).

Both are consumed structurally (no SDK import at runtime), which is also why the host half keeps working across DSH minor versions.

## Install

```sh
# into the web profile, as a local checkout:
#   "dsh-restart-button": "file:/path/to/dsh-restart-button"
cd ~/.dsh/profiles/web && pnpm install
# then restart dsh once so the plugin tree picks it up
```

The plugin registers the channel itself; it needs the `connection` and `webServer` services, i.e. the Web profile.

## Development

```sh
pnpm install
pnpm typecheck   # host + client
pnpm build       # lib/index.js, lib/client.js, lib/types/**
```

- Host half: `src/index.ts` (TypeScript → `lib/index.js`, declarations to `lib/types/`).
- Browser half: `src/client/*` (tsdown → `lib/client.js`, one CJS bundle in the client module table; only `react`/`react-dom` stay external).
- `cordis.patch.yml` is the loader row (`dsh.bundle.patch`) that mounts the host half.

## License

MIT © 2026 allenlogo
