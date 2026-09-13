/**
 * dsh-restart-button — client half.
 *
 * Registers one row in the General settings section
 * (`settings.general.item` slot): a title, a hint, and a "Restart now"
 * button. Clicking it calls the host RPC channel over the connection fence
 * (loopback authority), then polls `status` until the boot id changes and
 * reloads the page. On a non-loopback client the row renders disabled.
 */
import type { Context, ConnectionLike, RestartResult } from './context-types.ts'
import { RestartRow } from './RestartRow.tsx'
import { en, zh } from './locales.ts'

export const name = 'dsh-restart-button-client'
export const inject = ['slots', 'locale', 'connection']
export const NS = 'restart.button'
export const CHANNEL = '/_dsh-restart-button'

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-restart-button: dictionaries')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register(
    {
      name: 'settings.general.item',
      id: 'restart',
      order: 30,
      locale: NS, // the framework injects the typed `t` seat into the row props
      inject: () => {
        const connection = ctx.get('connection') as ConnectionLike
        return {
          call: (endpoint: string, payload?: unknown): Promise<unknown> =>
            connection.rpc.call(CHANNEL, endpoint, payload),
          loopback: connection.isLoopback,
        }
      },
    },
    RestartRow,
  ))
}
