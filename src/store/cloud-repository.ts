/**
 * 云端实现：题库、进度、考试都通过云函数 api 读写。
 * 本机只保存当前科目、阅读设置和没送达的作答队列。
 */
import type {
  BankIndex,
  ExamRecord,
  MaterialMeta,
  MaterialPage,
  Question,
  ReaderPrefs,
  SourceMeta,
  Subject,
  SubjectiveItem,
  SubjectiveMeta,
  SubjectSummary,
  UserData,
  UserProfile,
} from '@/types'
import { callApi, login, relogin } from './cloud'
import {
  createDefaultUserData,
  KEY_PREFIX,
  loadReaderPrefsFromStorage,
  saveReaderPrefsToStorage,
  USER_DATA_VERSION,
  type AnswerItem,
  type QuizRepository,
  type RemoteExam,
  type RemoteExams,
} from './repository'
import { readJSON, writeJSON } from './storage'

const PREFS_KEY = `${KEY_PREFIX}cloud_prefs`
const PENDING_KEY = `${KEY_PREFIX}cloud_pending`
/** 服务端单次提交上限 */
const SUBMIT_BATCH = 100
/** 错题、收藏列表一页条数（服务端上限 200） */
const LIST_PAGE = 200
/** 错题、收藏最多取回的页数 */
const LIST_MAX_PAGES = 20
/** 进来时取回的考试历史条数 */
const HISTORY_SIZE = 50
/** 作答攒一会儿再提交，减少调用次数 */
const FLUSH_DELAY_MS = 800

interface CloudIndex {
  subjects: Subject[]
  categories: string[]
  sources: Omit<SourceMeta, 'chunk'>[]
  subjective: SubjectiveMeta[]
  materials: (Omit<MaterialMeta, 'chunk'> & { pageCount: number })[]
}

interface ListPage {
  items: { questionId: string; sourceId: string; subjectId: string }[]
  total: number
  hasMore: boolean
}

interface PendingBatch {
  batchId: string
  items: AnswerItem[]
}

interface PendingQueue {
  /** 还没分批的作答 */
  loose: AnswerItem[]
  /** 已分好批、带固定 batchId 的作答（重试时服务端按 batchId 去重） */
  batches: PendingBatch[]
}

function emptyIndex(): BankIndex {
  return {
    version: 0,
    subjects: [],
    categories: [],
    sources: [],
    subjective: [],
    subjectiveChunks: {},
    materials: [],
    chunks: {},
  }
}

function newBatchId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `b${Date.now().toString(36)}${rand}`.replace(/[^A-Za-z0-9]/g, '')
}

function readQueue(): PendingQueue {
  const q = readJSON<Partial<PendingQueue> | null>(PENDING_KEY, null)
  return {
    loose: q && Array.isArray(q.loose) ? q.loose : [],
    batches: q && Array.isArray(q.batches) ? q.batches : [],
  }
}

function writeQueue(q: PendingQueue): void {
  writeJSON(PENDING_KEY, q)
}

/** 服务端考试摘要 -> 本地考试记录（逐题结果另取） */
function toExamRecord(e: ExamRecord): ExamRecord {
  return {
    id: e.id,
    subjectId: e.subjectId,
    mode: e.mode,
    sourceId: e.sourceId || undefined,
    title: e.title,
    startTime: e.startTime,
    endTime: e.endTime,
    durationSec: e.durationSec,
    autoSubmitted: e.autoSubmitted,
    timedOut: !!e.timedOut,
    total: e.total,
    correctCount: e.correctCount,
    score: e.score,
    items: Array.isArray(e.items) ? e.items : [],
  }
}

/** 考试题目没有答案，补上空字段以符合 Question 类型 */
function examQuestion(q: Partial<Question>): Question {
  return {
    id: q.id || '',
    subjectId: q.subjectId || '',
    sourceId: q.sourceId || '',
    no: q.no || 0,
    type: q.type || 'single',
    stem: q.stem || '',
    options: q.options || [],
    answer: [],
    explanation: '',
  }
}

function toRemoteExam(e: RemoteExam): RemoteExam {
  return Object.assign({}, e, { questions: e.questions.map(examQuestion) })
}

export class CloudRepository implements QuizRepository {
  readonly remote = true
  private sourceQuestions: Record<string, Promise<Question[]> | undefined> = {}
  private subjectiveCache: Record<string, SubjectiveItem | undefined> = {}
  private materialPages: Record<string, MaterialPage | undefined> = {}
  private materialMeta: Record<string, { title: string; pageCount: number }> = {}
  private flushing: Promise<boolean> | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushWaiters: ((ok: boolean) => void)[] = []

  getIndex(): BankIndex {
    return emptyIndex()
  }

  async loadIndex(): Promise<BankIndex> {
    const idx = await callApi<CloudIndex>('bank.index')
    const index = emptyIndex()
    index.version = 1
    index.subjects = idx.subjects
    index.categories = idx.categories
    index.sources = idx.sources.map((s) => Object.assign({ chunk: '' }, s))
    index.subjective = idx.subjective
    index.materials = idx.materials.map((m) => {
      this.materialMeta[m.id] = { title: m.title, pageCount: m.pageCount }
      return {
        id: m.id,
        subjectId: m.subjectId,
        category: m.category,
        title: m.title,
        chars: m.chars,
        chunk: '',
      }
    })
    return index
  }

  loadSourceQuestions(sourceId: string): Promise<Question[]> {
    let task = this.sourceQuestions[sourceId]
    if (!task) {
      task = callApi<Question[]>('bank.questions', { sourceId })
      this.sourceQuestions[sourceId] = task
      task.catch(() => {
        this.sourceQuestions[sourceId] = undefined
      })
    }
    return task
  }

  async loadQuestionsByIds(ids: string[]): Promise<Question[]> {
    const unique = ids.filter((id, i) => ids.indexOf(id) === i)
    const parts: Promise<Question[]>[] = []
    for (let i = 0; i < unique.length; i += 100) {
      parts.push(callApi<Question[]>('bank.questionsByIds', { ids: unique.slice(i, i + 100) }))
    }
    const map: Record<string, Question> = {}
    ;(await Promise.all(parts)).forEach((list) =>
      list.forEach((q) => {
        map[q.id] = q
      }),
    )
    return ids.map((id) => map[id]).filter((q): q is Question => !!q)
  }

  loadRandomQuestions(subjectId: string, count: number): Promise<Question[]> {
    return callApi<Question[]>('bank.random', { subjectId, count })
  }

  async loadSubjectiveItem(id: string): Promise<SubjectiveItem | undefined> {
    const hit = this.subjectiveCache[id]
    if (hit) return hit
    const item = await callApi<SubjectiveItem>('bank.subjective', { id })
    this.subjectiveCache[id] = item
    return item
  }

  async loadMaterialPage(materialId: string, page: number): Promise<MaterialPage> {
    const meta = this.materialMeta[materialId]
    const p = meta ? Math.min(Math.max(0, page), Math.max(0, meta.pageCount - 1)) : Math.max(0, page)
    const key = `${materialId}#${p}`
    const hit = this.materialPages[key]
    if (hit) return hit
    const res = await callApi<{ title: string; page: number; pageCount: number; paras: string[] }>('bank.materialPage', {
      materialId,
      page: p + 1,
    })
    const out: MaterialPage = { title: res.title, page: res.page - 1, pageCount: res.pageCount, paras: res.paras }
    this.materialPages[key] = out
    return out
  }

  private async listAll(action: string): Promise<string[]> {
    const ids: string[] = []
    for (let page = 1; page <= LIST_MAX_PAGES; page++) {
      const res = await callApi<ListPage>(action, { page, pageSize: LIST_PAGE })
      res.items.forEach((x) => ids.push(x.questionId))
      if (!res.hasMore) break
    }
    return ids
  }

  async loadUserData(): Promise<UserData> {
    const base = createDefaultUserData()
    const prefs = readJSON<{ currentSubjectId?: string } | null>(PREFS_KEY, null)
    const [user, wrongIds, favoriteIds, history] = await Promise.all([
      login(),
      this.listAll('progress.wrongList'),
      this.listAll('progress.favoriteList'),
      callApi<{ items: ExamRecord[] }>('exam.history', { page: 1, pageSize: HISTORY_SIZE }),
    ])
    // 启动时顺带重试上次没送达的作答
    this.flushPendingAnswers()
    return {
      version: USER_DATA_VERSION,
      currentSubjectId: (prefs && prefs.currentSubjectId) || base.currentSubjectId,
      records: {},
      // 服务端按加入时间倒序返回，本机列表按加入顺序存
      wrongIds: wrongIds.reverse(),
      favoriteIds: favoriteIds.reverse(),
      exams: history.items.map(toExamRecord),
      masteredIds: user.mastered,
    }
  }

  async saveUserData(data: UserData): Promise<void> {
    // 用户数据以服务端为准，本机只记当前科目
    writeJSON(PREFS_KEY, { currentSubjectId: data.currentSubjectId })
  }

  async clearUserData(): Promise<void> {
    throw new Error('云模式不支持清除全部数据')
  }

  loadReaderPrefs(): ReaderPrefs {
    return loadReaderPrefsFromStorage()
  }

  saveReaderPrefs(prefs: ReaderPrefs): void {
    saveReaderPrefsToStorage(prefs)
  }

  loadSummary(subjectId: string): Promise<SubjectSummary> {
    return callApi<SubjectSummary>('progress.summary', { subjectId })
  }

  /** 作答先进本机队列（持久化），稍后批量提交 */
  submitAnswers(items: AnswerItem[]): Promise<boolean> {
    const q = readQueue()
    items.forEach((it) => q.loose.push({ questionId: it.questionId, answer: it.answer.slice() }))
    writeQueue(q)
    return new Promise<boolean>((resolve) => {
      this.flushWaiters.push(resolve)
      if (this.flushTimer !== null) clearTimeout(this.flushTimer)
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null
        const waiters = this.flushWaiters
        this.flushWaiters = []
        this.flushPendingAnswers().then((ok) => waiters.forEach((w) => w(ok)))
      }, FLUSH_DELAY_MS)
    })
  }

  flushPendingAnswers(): Promise<boolean> {
    if (this.flushing) {
      // 正在提交时，等它结束后再跑一轮，把新进队列的也带上
      return this.flushing.then(() => this.flushPendingAnswers())
    }
    const task = this.doFlush().finally(() => {
      this.flushing = null
    })
    this.flushing = task
    return task
  }

  private async doFlush(): Promise<boolean> {
    const q = readQueue()
    while (q.loose.length > 0) {
      q.batches.push({ batchId: newBatchId(), items: q.loose.splice(0, SUBMIT_BATCH) })
    }
    writeQueue(q)
    while (q.batches.length > 0) {
      const batch = q.batches[0]
      try {
        await callApi('progress.submit', batch)
      } catch (err) {
        console.error('提交作答失败，下次重试', err)
        return false
      }
      // 期间可能有新作答进了 loose，重新读一次再删已送达的批次
      const latest = readQueue()
      latest.batches = latest.batches.filter((b) => b.batchId !== batch.batchId)
      writeQueue(latest)
      q.batches.shift()
    }
    return true
  }

  async setFavorite(questionId: string, favorite: boolean): Promise<void> {
    await callApi('progress.setFavorite', { questionId, favorite })
  }

  async removeWrong(questionId: string): Promise<void> {
    await callApi('progress.removeWrong', { questionId })
  }

  async clearWrong(subjectId: string): Promise<void> {
    await callApi('progress.clearWrong', { subjectId })
  }

  async setMastered(subjectiveId: string, mastered: boolean): Promise<void> {
    await callApi('progress.setMastered', { subjectiveId, mastered })
  }

  async loadProfile(): Promise<UserProfile> {
    const u = await relogin()
    return { nickname: u.nickname, points: u.points }
  }

  async updateNickname(nickname: string): Promise<UserProfile> {
    const u = await callApi<{ nickname: string; points: number }>('updateProfile', { nickname })
    return { nickname: u.nickname, points: u.points }
  }

  exams: RemoteExams = {
    async start(p) {
      const res = await callApi<{ exam: RemoteExam; resumed: boolean; settled: ExamRecord | null }>('exam.start', p)
      return { exam: toRemoteExam(res.exam), resumed: res.resumed, settled: res.settled ? toExamRecord(res.settled) : null }
    },
    async current() {
      const res = await callApi<{ exam: RemoteExam | null; settled: ExamRecord | null }>('exam.current')
      return { exam: res.exam ? toRemoteExam(res.exam) : null, settled: res.settled ? toExamRecord(res.settled) : null }
    },
    save(examId, answers) {
      return callApi<{ serverNow: number; deadline: number }>('exam.save', { examId, answers })
    },
    async submit(examId, answers, auto) {
      return toExamRecord(await callApi<ExamRecord>('exam.submit', { examId, answers, auto }))
    },
    async abandon(examId) {
      await callApi('exam.abandon', { examId })
    },
    async result(examId) {
      const res = await callApi<ExamRecord & { questions: Question[] }>('exam.result', { examId })
      return { exam: toExamRecord(res), questions: res.questions }
    },
  }
}
