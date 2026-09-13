/**
 * RestartRow — one row in the General settings section.
 *
 * Row contract: the slot owner passes no props; `inject` in the slot
 * registration supplies `{ t, call, loopback }`. All copy and controls live
 * here. After a restart is accepted, poll `status` until the boot id changes
 * (the replacement host is up), then reload. The connection fence rejects
 * non-loopback callers anyway; the row just degrades visibly first.
 */
import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './index.ts'

export interface RestartRowProps extends PropsLocale<typeof NS> {
  call: (endpoint: string, payload?: unknown) => Promise<unknown>
  loopback: boolean
}

// Matches the official General "Setting-Cell" row design (cf. dsh-client-locale
// LanguageRow): border-bottom separator, 16px vertical padding, 14px title,
// and a 36px pill control on the right.
const styles: Record<string, React.CSSProperties> = {
  row: {
    borderBottom: '1px solid var(--dsw-alias-border-l2)',
    alignItems: 'center',
    gap: '8px',
    padding: '16px 0',
    display: 'flex',
    width: '100%',
  },
  text: {
    flexDirection: 'column',
    flex: 1,
    gap: '4px',
    minWidth: 0,
    paddingRight: 48,
    display: 'flex',
  },
  title: {
    color: 'var(--dsw-alias-label-primary)',
    fontSize: '14px',
    fontWeight: 400,
    lineHeight: '22px',
  },
  desc: {
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: '12px',
    lineHeight: '18px',
  },
  button: {
    background: 'var(--dsw-alias-bg-module-platform)',
    height: 36,
    font: 'inherit',
    color: 'var(--dsw-alias-label-primary)',
    cursor: 'pointer',
    border: 'none',
    borderRadius: 18,
    alignItems: 'center',
    gap: 12,
    padding: '0 14px',
    fontSize: '14px',
    lineHeight: '22px',
    display: 'inline-flex',
    flexShrink: 0,
  },
  error: {
    color: '#d64545',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  },
}

export function RestartRow({ t, call, loopback }: RestartRowProps) {
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const restart = async () => {
    if (restarting) return
    setRestarting(true)
    setError(null)
    try {
      const result = (await call('restart', {})) as {
        ok?: boolean
        value?: { boot?: string }
        error?: { message?: string }
      }
      if (!result.ok || result.value === undefined) {
        throw new Error(result.error?.message ?? 'restart rejected')
      }
      const previous = result.value.boot
      const deadline = Date.now() + 60_000
      const poll = () => {
        call('status', {})
          .then((raw) => {
            const next = raw as { ok?: boolean; value?: { boot?: string } }
            if (typeof next.value?.boot === 'string' && next.value.boot !== previous) {
              window.location.reload()
              return
            }
            retry()
          })
          .catch(() => retry()) // restart window: transport briefly refuses — keep polling
      }
      const retry = () => {
        if (Date.now() > deadline) {
          setRestarting(false)
          setError(t('timeout'))
        } else {
          setTimeout(poll, 1500)
        }
      }
      poll()
    } catch {
      setRestarting(false)
      setError(t('failed'))
    }
  }

  if (!loopback) {
    return (
      <div style={styles.row}>
        <div style={styles.text}>
          <div style={styles.title}>{t('title')}</div>
          <div style={styles.desc}>{t('localOnly')}</div>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.row}>
      <div style={styles.text}>
        <div style={styles.title}>{t('title')}</div>
        <div style={styles.desc}>{t('hint')}</div>
      </div>
      <button
        type="button"
        style={styles.button}
        disabled={restarting}
        onClick={() => {
          void restart()
        }}
      >
        {restarting ? t('restarting') : t('restart')}
      </button>
      {error ? (
        <span role="status" style={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  )
}
