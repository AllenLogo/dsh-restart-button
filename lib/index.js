import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export const name = 'dsh-restart-button';
/** Both services are resolved lazily through ctx.inject below. */
export const inject = [];
export const CHANNEL = '/_dsh-restart-button';
const BOOT_ID = `${process.pid}-${Date.now()}`;
/** Request bodies here are two-field commands; anything larger is rejected. */
const MAX_BODY_BYTES = 64 * 1024;
const JSON_CONTENT_TYPE = 'application/json';
/** Whether the host is supervised (systemd sets both markers on its services). */
function supervised(env = process.env) {
    return (env.INVOCATION_ID ?? '') !== '' || (env.JOURNAL_STREAM ?? '') !== '';
}
/** Port the web server serves on, read off DSH_WEB_URL when available. */
function servingPort() {
    const url = process.env.DSH_WEB_URL;
    if (typeof url === 'string') {
        try {
            const port = Number(new URL(url).port);
            if (Number.isInteger(port) && port > 0 && port < 65536)
                return port;
        }
        catch {
            /* fall through */
        }
    }
    return 3080;
}
/**
 * Supervised restart: exit cleanly after the response has had a chance to
 * flush; the supervisor brings the host back. Equivalent official graceful
 * alternatives (SIGTERM → tree dispose → exit 0 via createProcessShutdown, or
 * ctx.appExit(0)) are noted but not used: a plain exit is deterministic and
 * the supervisor owns restart.
 */
function scheduleExit(delayMs) {
    setTimeout(() => process.exit(0), delayMs);
    return { pid: process.pid, delayMs };
}
/** Source of the detached helper that relaunches the host (supervisor-less). */
function helperSource(logOut, logErr, port, extraMs) {
    const file = JSON.stringify(process.execPath);
    const args = JSON.stringify([...process.execArgv, ...process.argv.slice(2)]);
    const cwd = JSON.stringify(process.cwd());
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
    ].join('\n');
}
/** Supervisor-less restart: detached helper, then SIGTERM this process. */
function scheduleHelper(delayMs, port) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const logOut = join(tmpdir(), `dsh-restart-button-${stamp}.out.log`);
    const logErr = join(tmpdir(), `dsh-restart-button-${stamp}.err.log`);
    const helper = spawn(process.execPath, ['-e', helperSource(logOut, logErr, port, delayMs + 800)], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
    });
    helper.unref();
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), delayMs);
    return { helperPid: helper.pid ?? 0, logOut, logErr };
}
/**
 * Channel-relative endpoint on the mounted prefix, mirroring the Connection
 * route grammar: one or more non-empty, non-dot segments.
 * @param pathname - request pathname.
 * @returns endpoint, or undefined when the path is not below the channel.
 */
function endpointOf(pathname) {
    if (!pathname.startsWith(`${CHANNEL}/`))
        return undefined;
    const endpoint = pathname.slice(CHANNEL.length + 1);
    const segments = endpoint.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'))
        return undefined;
    if (segments.some((segment) => !/^[A-Za-z0-9_$.-]+$/.test(segment)))
        return undefined;
    return endpoint;
}
/** Write one JSON envelope response. */
function respond(res, status, body) {
    res.writeHead(status, { 'content-type': JSON_CONTENT_TYPE, 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
}
/** Read a bounded JSON request body. */
async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = chunk;
        size += buffer.length;
        if (size > MAX_BODY_BYTES)
            throw new Error('request body too large');
        chunks.push(buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/**
 * Serve one decoded request through the endpoint handler, answering in the
 * Connection envelope so the browser half stays transport-agnostic.
 */
async function serveEndpoint(req, res, handler) {
    const endpoint = endpointOf(new URL(req.url ?? '/', 'http://dsh.invalid').pathname);
    if (req.method !== 'POST' || endpoint === undefined) {
        res.writeHead(404);
        res.end('not found');
        return;
    }
    if ((req.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase() !== JSON_CONTENT_TYPE) {
        res.writeHead(415);
        res.end('content type must be application/json');
        return;
    }
    let body;
    try {
        body = await readJson(req);
    }
    catch {
        res.writeHead(400);
        res.end('body is not JSON');
        return;
    }
    const envelope = body;
    if (typeof envelope !== 'object' ||
        envelope === null ||
        envelope.type !== 'client-request' ||
        typeof envelope.rpcId !== 'string' ||
        typeof envelope.method !== 'string') {
        respond(res, 200, {
            type: 'server-response',
            rpcId: 'invalid-request',
            result: {
                ok: false,
                error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: {} },
            },
        });
        return;
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
        });
        return;
    }
    try {
        const result = await handler(endpoint, envelope.payload);
        respond(res, 200, { type: 'server-response', rpcId: envelope.rpcId, result });
    }
    catch (error) {
        res.writeHead(500);
        res.end(`handler failure: ${String(error)}`);
    }
}
export function apply(ctx) {
    ctx.inject(['connection', 'webServer'], (hostCtx) => {
        const host = hostCtx;
        hostCtx.effect(() => {
            const handler = (endpoint, payload) => {
                if (endpoint === 'status') {
                    return Promise.resolve({ ok: true, value: { boot: BOOT_ID } });
                }
                if (endpoint !== 'restart') {
                    return Promise.resolve({
                        ok: false,
                        error: { code: 'bad-request', message: `unknown endpoint: ${endpoint}`, details: {} },
                    });
                }
                const delayMs = typeof payload?.delayMs === 'number'
                    ? payload.delayMs
                    : 1500;
                const result = supervised() ? scheduleExit(delayMs) : scheduleHelper(delayMs, servingPort());
                return Promise.resolve({ ok: true, value: { boot: BOOT_ID, ...result } });
            };
            const route = {
                kind: 'prefix',
                path: CHANNEL,
                handler: async (req, res) => {
                    // Same fence as the shared `/api` route: trusted Host/Origin
                    // authority plus the browser session cookie, applied before any
                    // request byte is decoded.
                    const rejection = host.connection.requestRejection(req);
                    if (rejection !== undefined) {
                        res.writeHead(rejection);
                        res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
                        return;
                    }
                    await serveEndpoint(req, res, handler);
                },
            };
            const unregister = host.webServer.register(route);
            return () => {
                unregister();
            };
        }, 'dsh-restart-button: rpc channel');
    });
}
//# sourceMappingURL=index.js.map