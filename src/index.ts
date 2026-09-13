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
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection' // loads the Context augmentation for `ctx.connection`
import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-restart-button'
/** Both services are resolved lazily through ctx.inject below. */
export const inject: string[] = []

export const CHANNEL = '/_dsh-restart-button'
const BOOT_ID = `${process.pid}-${Date.now()}`
/** Request bodies here are two-field commands; anything larger is rejected. */
const MAX_BODY_BYTES = 64 * 1024
const JSON_CONTENT_TYPE = 'application/json'

/** One endpoint failure, mirroring the Connection RPC failure shape. */
interface RpcFailure {
  code: string
  message: string
  details: Record<string, unknown>
}

/** The `{ ok, value }` / `{ ok: false, error }` pair the browser validates. */
type RpcResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: RpcFailure }

/** Endpoint handler contract shared by both transport arrangements. */
type EndpointHandler = (endpoint: string, payload: unknown) => Promise<RpcResult>

/**
 * Structural types for the two services this half consumes, so the plugin
 * keeps no build-time dependency on their packages: exactly the surface it
 * calls, which is also what makes the mount resilient across DSH versions.
 */
interface WebRouteLike {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

interface WebServerLike {
  register(route: WebRouteLike): () => void
}

interface ConnectionLike {
  requestRejection(request: { headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

interface HostContextLike {
  connection: ConnectionLike
  webServer: WebServerLike
}

/** Whether the host is supervised (systemd sets both markers on its services). */
function supervised(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.INVOCATION_ID ?? '') !== '' || (env.JOURNAL_STREAM ?? '') !== ''
}

/** Port the web server serves on, read off DSH_WEB_URL when available. */
function servingPort(): number | null {
  const url = process.env.DSH_WEB_URL
  if (typeof url === 'string') {
    try {
      const port = Number(new URL(url).port)
      if (Number.isInteger(port) && port > 0 && port < 65536) return port
    } catch {
      /* fall through */
    }
  }
  return 3080
}

/**
 * Supervised restart: exit cleanly after the response has had a chance to
 * flush; the supervisor brings the host back. Equivalent official graceful
 * alternatives (SIGTERM → tree dispose → exit 0 via createProcessShutdown, or
 * ctx.appExit(0)) are noted but not used: a plain exit is deterministic and
 * the supervisor owns restart.
 */
function scheduleExit(delayMs: number): { pid: number; delayMs: number } {
  setTimeout(() => process.exit(0), delayMs)
  return { pid: process.pid, delayMs }
}

/** Source of the detached helper that relaunches the host (supervisor-less). */
function helperSource(logOut: string, logErr: string, port: number | null, extraMs: number): string {
  const file = JSON.stringify(process.execPath)
  const args = JSON.stringify([...process.execArgv, ...process.argv.slice(2)])
  const cwd = JSON.stringify(process.cwd())
  return [
    "const { spawn } = require('node:child_process')",
    "const fs = require('node:fs')",
    "const net = require('node:net')",
    `const file = ${file}`,
    `const args = ${args}`,
    `const cwd = ${cwd}`,
    `const logOut = ${JSON.stringify(logOut)}`,
    `const logErr = ${JSON.stringify(logErr)}`,
    `const port = ${JSON.stringify(port)}`,
    `const extraMs = ${JSON.stringify(extraMs)}`,
    'const sleep = (ms) => new Promise((r) => setTimeout(r, ms))',
    'const note = (line) => { try { fs.appendFileSync(logErr, `[dsh-restart-button] ${line}\\n`) } catch {} }',
    'const listening = () => new Promise((resolve) => {',
    '  const probe = net.connect({ host: "127.0.0.1", port })',
    '  const done = (value) => { probe.destroy(); resolve(value) }',
    '  probe.on("connect", () => done(true))',
    '  probe.on("error", () => done(false))',
    '  setTimeout(() => done(false), 500)',
    '})',
    'const main = async () => {',
    '  if (port) {',
    '    const until = Date.now() + 30000',
    '    while (Date.now() < until && await listening()) await sleep(250)',
    '    await sleep(300)',
    '  } else {',
    '    await sleep(extraMs)',
    '  }',
    '  let child',
    '  try {',
    '    const out = fs.openSync(logOut, "a")',
    '    const err = fs.openSync(logErr, "a")',
    '    child = spawn(file, args, { cwd, detached: true, stdio: ["ignore", out, err], env: process.env })',
    '    child.on("error", (error) => note(`could not start the replacement: ${error?.message ?? String(error)}`))',
    '    child.unref()',
    '  } catch (error) {',
    '    note(`could not start the replacement: ${error instanceof Error ? error.message : String(error)}`)',
    '    return',
    '  }',
    '  if (port) {',
    '    const upBy = Date.now() + 20000',
    '    while (Date.now() < upBy && !(await listening())) await sleep(500)',
    '    if (!(await listening())) note(`the replacement did not bind port ${port} within 20s`)',
    '  }',
    '}',
    'main()',
  ].join('\n')
}

/** Supervisor-less restart: detached helper, then SIGTERM this process. */
function scheduleHelper(delayMs: number, port: number | null): { helperPid: number; logOut: string; logErr: string } {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const logOut = join(tmpdir(), `dsh-restart-button-${stamp}.out.log`)
  const logErr = join(tmpdir(), `dsh-restart-button-${stamp}.err.log`)
  const helper = spawn(process.execPath, ['-e', helperSource(logOut, logErr, port, delayMs + 800)], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
  helper.unref()
  setTimeout(() => process.kill(process.pid, 'SIGTERM'), delayMs)
  return { helperPid: helper.pid ?? 0, logOut, logErr }
}

/**
 * Channel-relative endpoint on the mounted prefix, mirroring the Connection
 * route grammar: one or more non-empty, non-dot segments.
 * @param pathname - request pathname.
 * @returns endpoint, or undefined when the path is not below the channel.
 */
function endpointOf(pathname: string): string | undefined {
  if (!pathname.startsWith(`${CHANNEL}/`)) return undefined
  const endpoint = pathname.slice(CHANNEL.length + 1)
  const segments = endpoint.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return undefined
  if (segments.some((segment) => !/^[A-Za-z0-9_$.-]+$/.test(segment))) return undefined
  return endpoint
}

/** Write one JSON envelope response. */
function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': JSON_CONTENT_TYPE, 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Read a bounded JSON request body. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Serve one decoded request through the endpoint handler, answering in the
 * Connection envelope so the browser half stays transport-agnostic.
 */
async function serveEndpoint(
  req: IncomingMessage,
  res: ServerResponse,
  handler: EndpointHandler,
): Promise<void> {
  const endpoint = endpointOf(new URL(req.url ?? '/', 'http://dsh.invalid').pathname)
  if (req.method !== 'POST' || endpoint === undefined) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  if ((req.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase() !== JSON_CONTENT_TYPE) {
    res.writeHead(415)
    res.end('content type must be application/json')
    return
  }
  let body: unknown
  try {
    body = await readJson(req)
  } catch {
    res.writeHead(400)
    res.end('body is not JSON')
    return
  }
  const envelope = body as { type?: unknown; rpcId?: unknown; method?: unknown; payload?: unknown }
  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    envelope.type !== 'client-request' ||
    typeof envelope.rpcId !== 'string' ||
    typeof envelope.method !== 'string'
  ) {
    respond(res, 200, {
      type: 'server-response',
      rpcId: 'invalid-request',
      result: {
        ok: false,
        error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: {} },
      },
    })
    return
  }
  if (envelope.method !== endpoint) {
    respond(res, 200, {
      type: 'server-response',
      rpcId: envelope.rpcId,
      result: {
        ok: false,
        error: {
          code: 'gateway/bad-request',
          message: `method ${JSON.stringify(envelope.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
          details: {},
        },
      },
    })
    return
  }
  try {
    const result = await handler(endpoint, envelope.payload)
    respond(res, 200, { type: 'server-response', rpcId: envelope.rpcId, result })
  } catch (error) {
    res.writeHead(500)
    res.end(`handler failure: ${String(error)}`)
  }
}

export function apply(ctx: Context): void {
  ctx.inject(['connection', 'webServer'], (hostCtx) => {
    const host = hostCtx as unknown as HostContextLike
    hostCtx.effect(() => {
      const handler: EndpointHandler = (endpoint, payload) => {
        if (endpoint === 'status') {
          return Promise.resolve({ ok: true, value: { boot: BOOT_ID } })
        }
        if (endpoint !== 'restart') {
          return Promise.resolve({
            ok: false,
            error: { code: 'bad-request', message: `unknown endpoint: ${endpoint}`, details: {} },
          })
        }
        const delayMs =
          typeof (payload as { delayMs?: unknown } | undefined)?.delayMs === 'number'
            ? (payload as { delayMs: number }).delayMs
            : 1500
        const result = supervised() ? scheduleExit(delayMs) : scheduleHelper(delayMs, servingPort())
        return Promise.resolve({ ok: true, value: { boot: BOOT_ID, ...result } })
      }
      const route: WebRouteLike = {
        kind: 'prefix',
        path: CHANNEL,
        handler: async (req, res) => {
          // Same fence as the shared `/api` route: trusted Host/Origin
          // authority plus the browser session cookie, applied before any
          // request byte is decoded.
          const rejection = host.connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
            return
          }
          await serveEndpoint(req, res, handler)
        },
      }
      const unregister = host.webServer.register(route)
      return () => {
        unregister()
      }
    }, 'dsh-restart-button: rpc channel')
  })
}
