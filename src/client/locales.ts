import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { sidechain: SidechainKey }
}

export const NS = 'sidechain'
export const zh = {
  'view.instructions': '侧链运行说明（展开原文）',
  'view.open': '在侧栏中打开',
  'view.stop': '停止生成',
  'view.retry': '重试',
  'view.readonly': '一次性侧问（不可续聊）',
  'view.loading': '正在确认侧会话类型…',
  'view.error': '操作失败，请重试',
} as const

export const en: Record<SidechainKey, string> = {
  'view.instructions': 'Sidechain instructions (show original)',
  'view.open': 'Open in sidebar',
  'view.stop': 'Stop generating',
  'view.retry': 'Retry',
  'view.readonly': 'One-shot side question (no follow-up)',
  'view.loading': 'Checking side conversation type…',
  'view.error': 'Operation failed. Please retry.',
}
export type SidechainKey = keyof typeof zh
