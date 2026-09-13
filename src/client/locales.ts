/** zh/en dictionaries for the restart row. */
export const zh = {
  title: '重启 DeepSeek Harness',
  hint: '重启进程以重载插件与配置,约 5 秒,会话保留。运行中的轮次会中断。',
  restarting: '重启中…',
  restart: '立即重启',
  localOnly: '仅本机可用',
  failed: '重启失败',
  timeout: '重启超时,请手动重启',
} as const

export const en = {
  title: 'Restart DeepSeek Harness',
  hint: 'Reload plugins and configuration (~5s). Sessions are kept; a running turn is interrupted.',
  restarting: 'Restarting…',
  restart: 'Restart now',
  localOnly: 'Available on this machine only',
  failed: 'Restart failed',
  timeout: 'Restart timed out — restart manually',
} as const
