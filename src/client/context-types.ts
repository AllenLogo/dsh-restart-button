/** DSH client contracts consumed by the browser half. */
// 0.1.5: `@deepseek-ai/dsh-client-runtime` no longer ships a 0.1.5 line; client
// plugins type their context as cordis' Context, augmented by the client
// packages they inject (official pattern, cf. dsh-client-ui-settings-general).
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// 0.1.5: `ctx.slots` is declared by the UI renderer's client half.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'restart.button': keyof typeof zh
  }
}

/** Minimal shape of the client-side connection service we consume. */
export interface ConnectionLike {
  isLoopback: boolean
  rpc: {
    call: (channel: string, endpoint: string, payload?: unknown) => Promise<unknown>
  }
}

/** rpcResultSchema envelope-inner shape the client validates against. */
export interface RestartResult {
  ok?: boolean
  value?: { boot?: string; pid?: number; delayMs?: number; helperPid?: number }
  error?: { code?: string; message?: string }
}

export type Context = ClientContext
