import type { Question, QuestionType, SubjectiveKind } from '@/types'

export const TYPE_LABEL: Record<QuestionType, string> = {
  single: '单选题',
  multi: '多选题',
  judge: '判断题',
}

export const SUBJECTIVE_KIND_LABEL: Record<SubjectiveKind, string> = {
  case: '案例',
  calc: '计算',
}

/** 返回打乱顺序的新数组 */
export function shuffle<T>(list: T[]): T[] {
  const arr = list.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

/** 选项下标转字母：0 -> A */
export function optionLabel(index: number): string {
  return String.fromCharCode(65 + index)
}

function sortNum(list: number[]): number[] {
  return list.slice().sort((a, b) => a - b)
}

/** 两个答案是否一致（不计顺序） */
export function isSameAnswer(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const x = sortNum(a)
  const y = sortNum(b)
  return x.every((v, i) => v === y[i])
}

/** 把答案格式化为界面文字 */
export function formatAnswer(q: Question, answer: number[]): string {
  if (!answer || answer.length === 0) return '未作答'
  if (q.type === 'judge') return answer.map((i) => q.options[i]).join('')
  return sortNum(answer).map(optionLabel).join('、')
}

/** 秒数格式化为 mm:ss */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m < 10 ? '0' : ''}${m}:${r < 10 ? '0' : ''}${r}`
}

/** 秒数格式化为“x 分 y 秒” */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m} 分 ${r} 秒` : `${r} 秒`
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** 时间戳格式化为 YYYY-MM-DD HH:mm */
export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
