import type {
  BankIndex,
  ExamMode,
  ExamRecord,
  MaterialDoc,
  MaterialPage,
  Question,
  ReaderPrefs,
  SubjectiveItem,
  SubjectSummary,
  UserData,
  UserProfile,
} from '@/types'
import { BANK_INDEX } from '@/data/bank-index'
import { paginateParas } from '@/utils/text'
import { loadJson } from './loader'
import { readJSON, removeKey, writeJSON } from './storage'

/** 一次作答（练习提交用） */
export interface AnswerItem {
  questionId: string
  answer: number[]
}

/** 服务端下发的进行中考试，deadline、startAt 为服务端时钟 */
export interface RemoteExam {
  id: string
  subjectId: string
  mode: ExamMode
  sourceId: string
  title: string
  questions: Question[]
  answers: Record<string, number[]>
  startAt: number
  deadline: number
  serverNow: number
}

/** 服务端计时的考试（只有云端实现提供）：可中途退出、时限内回来继续 */
export interface RemoteExams {
  start(p: { subjectId: string; mode: ExamMode; sourceId?: string }): Promise<{
    exam: RemoteExam
    resumed: boolean
    settled: ExamRecord | null
  }>
  current(): Promise<{ exam: RemoteExam | null; settled: ExamRecord | null }>
  /** 返回服务端时间和截止时间，用于校准倒计时 */
  save(examId: string, answers: Record<string, number[]>): Promise<{ serverNow: number; deadline: number }>
  submit(examId: string, answers: Record<string, number[]>, auto: boolean): Promise<ExamRecord>
  abandon(examId: string): Promise<void>
  result(examId: string): Promise<{ exam: ExamRecord; questions: Question[] }>
}

/**
 * 数据仓库接口。页面和 store 只通过它取数据，本机实现和云端实现可以互换。
 * 标为可选的方法只有云端实现提供，store 发现没有时走本机逻辑。
 */
export interface QuizRepository {
  /** 数据在服务端（云模式） */
  readonly remote: boolean
  /** 同步可用的索引。本机为主包内的索引；云端在 loadIndex 之前为空索引 */
  getIndex(): BankIndex
  loadIndex(): Promise<BankIndex>
  loadSourceQuestions(sourceId: string): Promise<Question[]>
  /** 按 id 取题，顺序与 ids 一致，不存在的跳过 */
  loadQuestionsByIds?(ids: string[]): Promise<Question[]>
  /** 某科目随机抽题 */
  loadRandomQuestions?(subjectId: string, count: number): Promise<Question[]>
  loadSubjectiveItem(id: string): Promise<SubjectiveItem | undefined>
  /** 资料的第 page 页（从 0 开始） */
  loadMaterialPage(materialId: string, page: number): Promise<MaterialPage>
  loadUserData(): Promise<UserData>
  saveUserData(data: UserData): Promise<void>
  clearUserData(): Promise<void>
  loadReaderPrefs(): ReaderPrefs
  saveReaderPrefs(prefs: ReaderPrefs): void

  /* ---------- 进度同步。本机实现为空操作：本机数据随 saveUserData 一起保存 ---------- */

  /** 服务端汇总的进度；返回 null 表示由 store 用本机作答记录计算 */
  loadSummary(subjectId: string): Promise<SubjectSummary | null>
  /** 提交练习作答。返回是否已送达服务端（未送达的会排队，下次重试，不会丢） */
  submitAnswers(items: AnswerItem[]): Promise<boolean>
  /** 重试之前没送达的作答 */
  flushPendingAnswers(): Promise<boolean>
  setFavorite(questionId: string, favorite: boolean): Promise<void>
  removeWrong(questionId: string): Promise<void>
  clearWrong(subjectId: string): Promise<void>
  setMastered(subjectiveId: string, mastered: boolean): Promise<void>
  /** 用户资料；本机模式返回 null */
  loadProfile(): Promise<UserProfile | null>
  updateNickname(nickname: string): Promise<UserProfile>

  exams?: RemoteExams
}

export const USER_DATA_VERSION = 2
/** 本机存储键名带版本前缀，和旧版示例题库的数据（ruankao_user_data）分开 */
export const KEY_PREFIX = 'rk_v2_'
const USER_DATA_KEY = `${KEY_PREFIX}user_data`
const READER_KEY = `${KEY_PREFIX}reader`

export const DEFAULT_SUBJECT_ID = BANK_INDEX.subjects.length > 0 ? BANK_INDEX.subjects[0].id : ''

export function createDefaultUserData(): UserData {
  return {
    version: USER_DATA_VERSION,
    currentSubjectId: DEFAULT_SUBJECT_ID,
    records: {},
    wrongIds: [],
    favoriteIds: [],
    exams: [],
    masteredIds: [],
  }
}

export function createDefaultReaderPrefs(): ReaderPrefs {
  return { fontSize: 'medium', positions: {} }
}

export function loadReaderPrefsFromStorage(): ReaderPrefs {
  const saved = readJSON<Partial<ReaderPrefs> | null>(READER_KEY, null)
  const base = createDefaultReaderPrefs()
  if (!saved || typeof saved !== 'object') return base
  const size = saved.fontSize
  return {
    fontSize: size === 'small' || size === 'medium' || size === 'large' ? size : base.fontSize,
    positions: saved.positions && typeof saved.positions === 'object' ? saved.positions : {},
  }
}

export function saveReaderPrefsToStorage(prefs: ReaderPrefs): void {
  writeJSON(READER_KEY, prefs)
}

function chunkRef(key: string) {
  const ref = key ? BANK_INDEX.chunks[key] : undefined
  if (!ref) throw new Error(`题库索引里找不到数据块 ${key || '(空)'}`)
  return ref
}

/** 本地实现：题库来自代码包内的分包静态文件，用户数据存本机 */
export class LocalRepository implements QuizRepository {
  readonly remote = false
  private subjectiveCache: Record<string, SubjectiveItem[]> = {}

  getIndex(): BankIndex {
    return BANK_INDEX
  }

  async loadIndex(): Promise<BankIndex> {
    return BANK_INDEX
  }

  async loadSourceQuestions(sourceId: string): Promise<Question[]> {
    const source = BANK_INDEX.sources.find((s) => s.id === sourceId)
    if (!source) throw new Error(`没有找到题集 ${sourceId}`)
    if (!source.chunk) return []
    return loadJson<Question[]>(chunkRef(source.chunk))
  }

  async loadSubjectiveItem(id: string): Promise<SubjectiveItem | undefined> {
    const meta = BANK_INDEX.subjective.find((s) => s.id === id)
    if (!meta) return undefined
    let list = this.subjectiveCache[meta.subjectId]
    if (!list) {
      const key = BANK_INDEX.subjectiveChunks[meta.subjectId]
      list = key ? await loadJson<SubjectiveItem[]>(chunkRef(key)) : []
      this.subjectiveCache[meta.subjectId] = list
    }
    return list.find((x) => x.id === id)
  }

  async loadMaterialPage(materialId: string, page: number): Promise<MaterialPage> {
    const meta = BANK_INDEX.materials.find((m) => m.id === materialId)
    if (!meta) throw new Error(`没有找到资料 ${materialId}`)
    const doc = await loadJson<MaterialDoc>(chunkRef(meta.chunk))
    const ranges = paginateParas(doc.paras)
    const p = Math.min(Math.max(0, page), ranges.length - 1)
    return { title: doc.title, page: p, pageCount: ranges.length, paras: doc.paras.slice(ranges[p][0], ranges[p][1]) }
  }

  async loadUserData(): Promise<UserData> {
    const saved = readJSON<Partial<UserData> | null>(USER_DATA_KEY, null)
    const base = createDefaultUserData()
    if (!saved || typeof saved !== 'object') return base
    // 逐项合并，缺字段时用默认值，防止数据结构不完整
    return {
      version: USER_DATA_VERSION,
      currentSubjectId: saved.currentSubjectId || base.currentSubjectId,
      records: saved.records && typeof saved.records === 'object' ? saved.records : {},
      wrongIds: Array.isArray(saved.wrongIds) ? saved.wrongIds : [],
      favoriteIds: Array.isArray(saved.favoriteIds) ? saved.favoriteIds : [],
      exams: Array.isArray(saved.exams) ? saved.exams : [],
      masteredIds: Array.isArray(saved.masteredIds) ? saved.masteredIds : [],
    }
  }

  async saveUserData(data: UserData): Promise<void> {
    writeJSON(USER_DATA_KEY, data)
  }

  async clearUserData(): Promise<void> {
    removeKey(USER_DATA_KEY)
  }

  loadReaderPrefs(): ReaderPrefs {
    return loadReaderPrefsFromStorage()
  }

  saveReaderPrefs(prefs: ReaderPrefs): void {
    saveReaderPrefsToStorage(prefs)
  }

  async loadSummary(): Promise<SubjectSummary | null> {
    return null
  }

  async submitAnswers(): Promise<boolean> {
    return true
  }

  async flushPendingAnswers(): Promise<boolean> {
    return true
  }

  async setFavorite(): Promise<void> {}

  async removeWrong(): Promise<void> {}

  async clearWrong(): Promise<void> {}

  async setMastered(): Promise<void> {}

  async loadProfile(): Promise<UserProfile | null> {
    return null
  }

  async updateNickname(): Promise<UserProfile> {
    throw new Error('本机模式没有用户资料')
  }
}
