/**
 * dsh-restart-button — host half.
 *
 * Serves one fenced HTTP channel (`/_dsh-restart-button`, prefix-mounted on the
 * web server) with two endpoints:
 *   - `status`  → `{ ok: true, value: { boot } }` (the boot id changes after a
 *     restart; the row polls it to know when the replacement host is up)
 *   - `restart` → `{ ok: true, value: { boot, ... } }` then restarts the host
 *
 * Transport is the Connection unary-RPC envelope the browser half already
 * speaks: `{ type: 'client-request', rpcId, method, payload }` answered with
 * `{ type: 'server-response', rpcId, result }`, where `result` is the
 * `{ ok, value }` / `{ ok: false, error }` pair validated on the client.
 *
 * Why this half mounts the route itself instead of calling
 * `ctx.connection.rpc.handle(channel, handler)`:
 * on 0.1.5 that registry registers through `owner.webServer.register(...)`,
 * where `owner` is the Connection *service's own* context — the one whose
 * inject map holds only `credentials`. Service access is inject-gated, so the
 * call throws `cannot get property "webServer" without inject`; inside the
 * `ctx.inject()` child fiber this plugin needs (it must wait for `connection`)
 * that throw only fails the child fiber, leaving the plugin entry `active`
 * while the channel is silently absent. Passing `webServer` in the caller's
 * inject list does not help: the gated context is the service's, not the
 * caller's. `connection.requestRejection()` plus a `webServer` route is the
 * documented arrangement for a feature-owned Web route ("Apply Connection's
 * Host/Origin checks and browser authentication to another Web route") and the
 * fence it applies is the same one `/api` uses: trusted Host/Origin authority
 * plus the browser session cookie, so a non-loopback or cookie-less caller is
 * rejected before the handler runs.
 *
 * Restart semantics:
 *   - Under a supervisor (systemd sets INVOCATION_ID/JOURNAL_STREAM): plain
 *     `process.exit(0)` and let the supervisor relaunch (this host: the
 *     dsh-web systemd user unit, Restart=always, RestartSec=5). Never spawn a
 *     detached replacement here — it races the supervisor for the port and
 *     escapes its supervision.
 *   - Without a supervisor (bare terminal / `pnpm dev`): detached node helper
 *     waits for the port to free, then spawns the same invocation (pattern
 *     ported from dshmarket/lib/restart.js).
 *
 * Sessions are persisted per-event under ~/.dsh/sessions; a restart does not
 * lose them. A running turn is interrupted, and in-flight approval questions
 * do not survive (stated in the row's UI copy).
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-restart-button";
/** Both services are resolved lazily through ctx.inject below. */
export declare const inject: string[];
export declare const CHANNEL = "/_dsh-restart-button";
export declare function apply(ctx: Context): void;
