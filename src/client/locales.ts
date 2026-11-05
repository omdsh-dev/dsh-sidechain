import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { sidechain: SidechainKey }
}

export const NS = 'sidechain'
export const zh = {
  'command.side.label': '侧会话',
  'command.side.description': '开启独立侧会话，可持续追问',
  'command.btw.label': '随问',
  'command.btw.description': '在后台问一个问题，不打断当前对话',
  'view.instructions': '侧链运行说明（展开原文）',
  'view.open': '在侧栏中打开',
  'view.stop': '停止生成',
  'view.retry': '重试',
  'view.readonly': '一次性侧问（不可续聊）',
  'view.loading': '正在确认侧会话类型…',
  'view.error': '操作失败，请重试',
} as const

export const en: Record<SidechainKey, string> = {
  'command.side.label': 'Side conversation',
  'command.side.description': 'Start a separate conversation with follow-ups',
  'command.btw.label': 'Quick question',
  'command.btw.description': 'Ask a question in the background without interrupting this conversation',
  'view.instructions': 'Sidechain instructions (show original)',
  'view.open': 'Open in sidebar',
  'view.stop': 'Stop generating',
  'view.retry': 'Retry',
  'view.readonly': 'One-shot side question (no follow-up)',
  'view.loading': 'Checking side conversation type…',
  'view.error': 'Operation failed. Please retry.',
}
export type SidechainKey = keyof typeof zh
