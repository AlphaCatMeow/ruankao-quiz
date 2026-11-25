/**
 * 全局状态：题库索引、题目缓存（按需异步加载）和用户数据。
 * 所有写操作通过本文件的函数完成，并同步保存到仓库。
 *
 * 本机模式和云模式的差别都收在这里和仓库实现里，页面不区分模式：
 * - 本机：索引在主包里同步可用，统计由本机作答记录计算，考试在本机计时。
 * - 云端：索引、统计从云函数取；写操作先改本机状态再同步到服务端，失败时撤回；考试由服务端计时，可续考。
 */
import { computed, reactive } from 'vue'
import type {
  AnswerRecord,
  BankIndex,
  ExamItem,
  ExamMode,
  ExamRecord,
  ExamSession,
  FontSizeLevel,
  MaterialMeta,
  MaterialPage,
  Question,
  ReaderPrefs,
  SourceKind,
  SourceMeta,
  Subject,
  SubjectiveItem,
  SubjectiveMeta,
  SubjectSummary,
  UserData,
} from '@/types'
import { isSameAnswer, shuffle } from '@/utils/quiz'
import { CLOUD_MODE } from './cloud'
import { CloudRepository } from './cloud-repository'
import { createDefaultUserData, LocalRepository, type QuizRepository, type RemoteExam } from './repository'

/** 考试历史最多保留条数 */
const MAX_EXAMS = 50
/** 阅读位置最多保留条数 */
const MAX_READ_POSITIONS = 100
/** 随机组卷题数 */
export const EXAM_RANDOM_COUNT = 75
/** 考试时长（分钟） */
export const EXAM_MINUTES = 150

const repo: QuizRepository = CLOUD_MODE ? new CloudRepository() : new LocalRepository()
const index = repo.getIndex()

/** 云模式：考试由服务端计时，中途退出后可在时限内回来继续 */
export const EXAM_RESUMABLE = !!repo.exams

interface BankState {
  /** 用户数据已读入 */
  loaded: boolean
  subjects: Subject[]
  sources: SourceMeta[]
  subjective: SubjectiveMeta[]
  materials: MaterialMeta[]
  categories: string[]
}

/** 题库索引（只含目录和数量，题目正文按需加载） */
export const bank = reactive<BankState>({
  loaded: false,
  subjects: index.subjects,
  sources: index.sources,
  subjective: index.subjective,
  materials: index.materials,
  categories: index.categories,
})

/** 用户数据 */
export const user = reactive<UserData>(createDefaultUserData())

/** 阅读设置与位置 */
export const reader = reactive<ReaderPrefs>(repo.loadReaderPrefs())

/** 用户资料。enabled 为 false 表示本机模式，没有昵称和积分 */
export const profile = reactive({ enabled: repo.remote, loaded: false, nickname: '', points: 0 })

/** 云模式下服务端汇总的进度，科目 id -> 汇总 */
const summaries = reactive<Record<string, SubjectSummary>>({})

let readyPromise: Promise<void> | null = null

/** 加载题库索引和用户数据，多次调用只执行一次（失败后下次调用重试） */
export function initStore(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      if (repo.remote) applyIndex(await repo.loadIndex())
      const data = await repo.loadUserData()
      Object.assign(user, data)
      if (!bank.subjects.some((s) => s.id === user.currentSubjectId) && bank.subjects.length > 0) {
        user.currentSubjectId = bank.subjects[0].id
      }
      if (repo.remote) {
        await Promise.all(bank.subjects.map((s) => refreshSummary(s.id)))
        refreshProfile()
      }
      bank.loaded = true
    })()
    readyPromise.catch((err) => {
      console.error('初始化数据失败', err)
      readyPromise = null
    })
  }
  return readyPromise
}

function persist(): void {
  // 去掉响应式代理，保存纯数据
  const snapshot = JSON.parse(JSON.stringify(user)) as UserData
  repo.saveUserData(snapshot).catch((err) => console.error('保存数据失败', err))
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 同步到服务端失败时提示 */
function syncFailed(what: string, err: unknown): void {
  console.error(`${what}失败`, err)
  uni.showToast({ title: `${what}失败：${errText(err)}`, icon: 'none' })
}

/* ---------- 索引查询（同步） ---------- */

let sourceById: Record<string, SourceMeta> = {}
/** 按长度倒序，按 id 前缀匹配时取最长的来源 id */
let sourceIdsByLength: string[] = []
let sourceOfIdCache: Record<string, string> = {}

function buildSourceLookup(sources: SourceMeta[]): void {
  sourceById = {}
  sources.forEach((s) => {
    sourceById[s.id] = s
  })
  sourceIdsByLength = sources.map((s) => s.id).sort((a, b) => b.length - a.length)
  sourceOfIdCache = {}
}
buildSourceLookup(index.sources)

function applyIndex(idx: BankIndex): void {
  buildSourceLookup(idx.sources)
  bank.subjects = idx.subjects
  bank.sources = idx.sources
  bank.subjective = idx.subjective
  bank.materials = idx.materials
  bank.categories = idx.categories
}

/** 根据题目 id 找到所在来源（题目 id 形如 “来源id-题号”） */
export function sourceIdOfQuestion(questionId: string): string {
  const hit = sourceOfIdCache[questionId]
  if (hit !== undefined) return hit
  const sid = sourceIdsByLength.find((id) => questionId.startsWith(`${id}-`)) || ''
  sourceOfIdCache[questionId] = sid
  return sid
}

export function subjectIdOfQuestion(questionId: string): string {
  const s = sourceById[sourceIdOfQuestion(questionId)]
  return s ? s.subjectId : ''
}

export const currentSubject = computed<Subject | undefined>(
  () => bank.subjects.find((s) => s.id === user.currentSubjectId) || bank.subjects[0],
)

export function getSource(id: string): SourceMeta | undefined {
  return sourceById[id]
}

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  exam: '历年真题',
  mock: '模拟卷',
  drill: '专题题集',
}

export const SOURCE_KIND_ORDER: SourceKind[] = ['exam', 'mock', 'drill']

export function sourcesOf(subjectId: string, kind?: SourceKind): SourceMeta[] {
  return bank.sources.filter(
    (s) => s.subjectId === subjectId && (!kind || s.kind === kind) && s.questionCount > 0,
  )
}

/** 某科目是否有可练习的选择题 */
export function hasQuestions(subjectId: string): boolean {
  return sourcesOf(subjectId).length > 0
}

export function subjectiveOf(subjectId: string): SubjectiveMeta[] {
  return bank.subjective.filter((s) => s.subjectId === subjectId)
}

export function getSubjectiveMeta(id: string): SubjectiveMeta | undefined {
  return bank.subjective.find((s) => s.id === id)
}

export function materialsOf(subjectId: string): MaterialMeta[] {
  return bank.materials.filter((m) => m.subjectId === subjectId)
}

export function getMaterialMeta(id: string): MaterialMeta | undefined {
  return bank.materials.find((m) => m.id === id)
}

/** 某科目（可选某来源）下错题 id，按加入顺序 */
export function wrongIdsOf(subjectId: string, sourceId?: string): string[] {
  return user.wrongIds.filter((id) =>
    sourceId ? sourceIdOfQuestion(id) === sourceId : subjectIdOfQuestion(id) === subjectId,
  )
}

export function favoriteIdsOf(subjectId: string): string[] {
  return user.favoriteIds.filter((id) => subjectIdOfQuestion(id) === subjectId)
}

export function isFavorite(id: string): boolean {
  return user.favoriteIds.indexOf(id) >= 0
}

export function isWrong(id: string): boolean {
  return user.wrongIds.indexOf(id) >= 0
}

export function isMastered(id: string): boolean {
  return user.masteredIds.indexOf(id) >= 0
}

/* ---------- 统计（只用索引和作答记录，不需要加载题目） ---------- */

export interface Stats {
  /** 题目总数 */
  total: number
  /** 做过的题目数（去重） */
  done: number
  /** 累计作答次数 */
  attempts: number
  /** 累计答对次数 */
  correct: number
  /** 正确率（百分比整数），按作答次数计算 */
  rate: number
}

interface Tally {
  done: number
  attempts: number
  correct: number
}

/** 来源 id -> 作答汇总。云模式用服务端汇总，本机模式由作答记录计算 */
const tallyBySource = computed(() => {
  const map: Record<string, Tally> = {}
  if (repo.remote) {
    Object.keys(summaries).forEach((subjectId) => {
      const s = summaries[subjectId].sources
      Object.keys(s).forEach((sid) => {
        map[sid] = { done: s[sid].done, attempts: s[sid].attempts, correct: s[sid].correct }
      })
    })
    return map
  }
  Object.keys(user.records).forEach((qid) => {
    const r = user.records[qid]
    if (!r || r.count <= 0) return
    const sid = sourceIdOfQuestion(qid)
    if (!sid) return
    const t = map[sid] || (map[sid] = { done: 0, attempts: 0, correct: 0 })
    t.done++
    t.attempts += r.count
    t.correct += r.correctCount
  })
  return map
})

function toStats(total: number, t: Tally): Stats {
  return {
    total,
    // 旧数据里可能有已被清洗掉的题，做题数不超过总数
    done: Math.min(total, t.done),
    attempts: t.attempts,
    correct: t.correct,
    rate: t.attempts > 0 ? Math.round((t.correct / t.attempts) * 100) : 0,
  }
}

export function statsOfSource(sourceId: string): Stats {
  const s = sourceById[sourceId]
  const t = tallyBySource.value[sourceId] || { done: 0, attempts: 0, correct: 0 }
  return toStats(s ? s.questionCount : 0, t)
}

export function statsOfSubject(subjectId: string): Stats {
  let total = 0
  const sum: Tally = { done: 0, attempts: 0, correct: 0 }
  bank.sources.forEach((s) => {
    if (s.subjectId !== subjectId) return
    total += s.questionCount
    const t = tallyBySource.value[s.id]
    if (t) {
      sum.done += Math.min(t.done, s.questionCount)
      sum.attempts += t.attempts
      sum.correct += t.correct
    }
  })
  return toStats(total, sum)
}

/** 云模式：重新取某科目的服务端统计 */
async function refreshSummary(subjectId: string): Promise<void> {
  const s = await repo.loadSummary(subjectId)
  if (s) summaries[subjectId] = s
}

const summaryTimers: Record<string, ReturnType<typeof setTimeout> | undefined> = {}

function scheduleSummaryRefresh(subjectId: string): void {
  if (!repo.remote || !subjectId) return
  const t = summaryTimers[subjectId]
  if (t !== undefined) clearTimeout(t)
  summaryTimers[subjectId] = setTimeout(() => {
    summaryTimers[subjectId] = undefined
    refreshSummary(subjectId).catch((err) => console.error('刷新统计失败', err))
  }, 300)
}

/** 云模式下作答后先在本机统计上加上，等服务端汇总回来再校正 */
function bumpSummary(q: Question, correct: boolean): void {
  if (!repo.remote) return
  const s = summaries[q.subjectId]
  if (!s) return
  const t = s.sources[q.sourceId] || (s.sources[q.sourceId] = { done: 0, attempts: 0, correct: 0 })
  t.attempts++
  if (correct) t.correct++
}

/* ---------- 用户资料（云模式） ---------- */

export function refreshProfile(): Promise<void> {
  return repo
    .loadProfile()
    .then((p) => {
      if (p) {
        profile.nickname = p.nickname
        profile.points = p.points
        profile.loaded = true
      }
    })
    .catch((err) => console.error('读取用户资料失败', err))
}

export async function updateNickname(nickname: string): Promise<void> {
  const p = await repo.updateNickname(nickname)
  profile.nickname = p.nickname
  profile.points = p.points
}

/* ---------- 题目加载（异步，带缓存） ---------- */

/** 已加载题目的缓存，不做响应式，避免大数组被深度代理 */
const questionCache: Record<string, Question> = {}
const loadedSources: Record<string, Question[]> = {}

function remember(list: Question[]): void {
  list.forEach((q) => {
    questionCache[q.id] = q
  })
}

/** 已加载过的题目，同步读取 */
export function getQuestion(id: string): Question | undefined {
  return questionCache[id]
}

/** 加载一个来源的全部题目，按原卷题序 */
export async function loadSourceQuestions(sourceId: string): Promise<Question[]> {
  const hit = loadedSources[sourceId]
  if (hit) return hit
  const list = await repo.loadSourceQuestions(sourceId)
  remember(list)
  loadedSources[sourceId] = list
  return list
}

/**
 * 加载某科目全部题目（本机模式）。onProgress(已完成来源数, 来源总数) 用于显示进度。
 * 小程序里数据块分布在几个分包里，并发读取。
 */
export async function loadSubjectQuestions(
  subjectId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Question[]> {
  const list = sourcesOf(subjectId)
  let done = 0
  if (onProgress) onProgress(0, list.length)
  const parts = await Promise.all(
    list.map((s) =>
      loadSourceQuestions(s.id).then((qs) => {
        done++
        if (onProgress) onProgress(done, list.length)
        return qs
      }),
    ),
  )
  const all: Question[] = []
  parts.forEach((p) => all.push(...p))
  return all
}

/** 某科目随机抽 count 题。云模式由服务端抽，本机模式加载全科目后打乱 */
export async function loadRandomQuestions(
  subjectId: string,
  count: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Question[]> {
  if (repo.loadRandomQuestions) {
    if (!hasQuestions(subjectId)) return []
    const list = await repo.loadRandomQuestions(subjectId, count)
    remember(list)
    return list
  }
  const all = await loadSubjectQuestions(subjectId, onProgress)
  // 题不足时取全部
  return shuffle(all).slice(0, count)
}

/** 按 id 加载题目，只加载涉及的来源。返回顺序与 ids 一致，已不存在的题跳过 */
export async function loadQuestionsByIds(ids: string[]): Promise<Question[]> {
  if (repo.loadQuestionsByIds) {
    const missing = ids.filter((id) => !questionCache[id])
    if (missing.length > 0) remember(await repo.loadQuestionsByIds(missing))
    return ids.map((id) => questionCache[id]).filter((q): q is Question => !!q)
  }
  const needed: string[] = []
  ids.forEach((id) => {
    const sid = sourceIdOfQuestion(id)
    if (sid && !loadedSources[sid] && needed.indexOf(sid) < 0) needed.push(sid)
  })
  await Promise.all(needed.map((sid) => loadSourceQuestions(sid)))
  return ids.map((id) => questionCache[id]).filter((q): q is Question => !!q)
}

export function loadSubjectiveItem(id: string): Promise<SubjectiveItem | undefined> {
  if (!getSubjectiveMeta(id)) return Promise.resolve(undefined)
  return repo.loadSubjectiveItem(id)
}

/** 资料的第 page 页（从 0 开始，越界时取最近的一页） */
export function loadMaterialPage(id: string, page: number): Promise<MaterialPage> {
  return repo.loadMaterialPage(id, page)
}

/* ---------- 写操作 ---------- */

function addWrongId(id: string): void {
  if (!isWrong(id)) user.wrongIds.push(id)
}

function writeRecord(q: Question, answer: number[]): boolean {
  const correct = isSameAnswer(answer, q.answer)
  const prev: AnswerRecord | undefined = user.records[q.id]
  user.records[q.id] = {
    count: (prev ? prev.count : 0) + 1,
    correctCount: (prev ? prev.correctCount : 0) + (correct ? 1 : 0),
    lastCorrect: correct,
    lastAnswer: answer.slice(),
    lastTime: Date.now(),
  }
  if (!correct) addWrongId(q.id)
  return correct
}

/** 记录一次练习作答，答错自动进错题本。返回是否答对（云模式由服务端再判一次） */
export function recordAnswer(q: Question, answer: number[]): boolean {
  const correct = writeRecord(q, answer)
  persist()
  if (repo.remote) {
    bumpSummary(q, correct)
    repo.submitAnswers([{ questionId: q.id, answer: answer.slice() }]).then((sent) => {
      if (sent) scheduleSummaryRefresh(q.subjectId)
    })
  }
  return correct
}

/** 重试之前没送达服务端的作答（本机模式无操作） */
export function flushPendingAnswers(): void {
  repo.flushPendingAnswers().then((sent) => {
    if (sent && repo.remote) bank.subjects.forEach((s) => scheduleSummaryRefresh(s.id))
  })
}

export function removeWrong(id: string): void {
  const i = user.wrongIds.indexOf(id)
  if (i >= 0) {
    user.wrongIds.splice(i, 1)
    persist()
    repo.removeWrong(id).then(
      () => scheduleSummaryRefresh(subjectIdOfQuestion(id)),
      (err) => {
        addWrongId(id)
        syncFailed('移出错题本', err)
      },
    )
  }
}

/** 清空某科目的错题 */
export function clearWrong(subjectId: string): void {
  const before = user.wrongIds.slice()
  user.wrongIds = user.wrongIds.filter((id) => subjectIdOfQuestion(id) !== subjectId)
  persist()
  repo.clearWrong(subjectId).then(
    () => scheduleSummaryRefresh(subjectId),
    (err) => {
      user.wrongIds = before
      syncFailed('清空错题本', err)
    },
  )
}

/** 切换收藏，返回切换后的状态 */
export function toggleFavorite(id: string): boolean {
  const i = user.favoriteIds.indexOf(id)
  if (i >= 0) {
    user.favoriteIds.splice(i, 1)
  } else {
    user.favoriteIds.push(id)
  }
  const on = i < 0
  persist()
  repo.setFavorite(id, on).catch((err) => {
    const j = user.favoriteIds.indexOf(id)
    if (on && j >= 0) user.favoriteIds.splice(j, 1)
    if (!on && j < 0) user.favoriteIds.push(id)
    syncFailed(on ? '收藏' : '取消收藏', err)
  })
  return on
}

/** 切换主观题“已掌握”，返回切换后的状态 */
export function toggleMastered(id: string): boolean {
  const i = user.masteredIds.indexOf(id)
  if (i >= 0) {
    user.masteredIds.splice(i, 1)
  } else {
    user.masteredIds.push(id)
  }
  const on = i < 0
  persist()
  repo.setMastered(id, on).catch((err) => {
    const j = user.masteredIds.indexOf(id)
    if (on && j >= 0) user.masteredIds.splice(j, 1)
    if (!on && j < 0) user.masteredIds.push(id)
    syncFailed('标记已掌握', err)
  })
  return on
}

export function setCurrentSubject(id: string): void {
  if (bank.subjects.some((s) => s.id === id) && user.currentSubjectId !== id) {
    user.currentSubjectId = id
    persist()
    scheduleSummaryRefresh(id)
  }
}

/**
 * 保存一次本机模拟考试：已作答的题写入作答记录，答错的题进错题本；未作答的题只计为不得分，不进错题本。
 * answers 为题目 id -> 作答。返回考试记录。
 */
export function submitExam(params: {
  subjectId: string
  mode: ExamMode
  sourceId?: string
  title: string
  questions: Question[]
  answers: Record<string, number[]>
  startTime: number
  autoSubmitted: boolean
}): ExamRecord {
  const endTime = Date.now()
  const items: ExamItem[] = []
  let correctCount = 0
  params.questions.forEach((q) => {
    const userAnswer = (params.answers[q.id] || []).slice()
    let correct = false
    if (userAnswer.length > 0) {
      correct = writeRecord(q, userAnswer)
    }
    if (correct) correctCount++
    items.push({ questionId: q.id, userAnswer, correct })
  })
  const total = items.length
  const record: ExamRecord = {
    id: `exam-${endTime}`,
    subjectId: params.subjectId,
    mode: params.mode,
    sourceId: params.sourceId,
    title: params.title,
    startTime: params.startTime,
    endTime,
    durationSec: Math.round((endTime - params.startTime) / 1000),
    autoSubmitted: params.autoSubmitted,
    total,
    correctCount,
    score: total > 0 ? Math.round((correctCount / total) * 100) : 0,
    items,
  }
  addExamRecord(record)
  persist()
  return record
}

function addExamRecord(record: ExamRecord): void {
  user.exams = user.exams.filter((e) => e.id !== record.id)
  user.exams.unshift(record)
  if (user.exams.length > MAX_EXAMS) user.exams.splice(MAX_EXAMS)
}

export function getExam(id: string): ExamRecord | undefined {
  return user.exams.find((e) => e.id === id)
}

/* ---------- 考试流程（本机计时或服务端计时） ---------- */

/** 服务端考试 -> 页面用的考试，截止时间换算成本机时钟 */
function fromRemoteExam(e: RemoteExam): ExamSession {
  const offset = e.serverNow - Date.now()
  remember(e.questions)
  return {
    id: e.id,
    subjectId: e.subjectId,
    mode: e.mode,
    sourceId: e.sourceId || undefined,
    title: e.title,
    questions: e.questions,
    answers: e.answers,
    startTime: e.startAt - offset,
    deadline: e.deadline - offset,
  }
}

/** 服务端在读取时自动结算了过期考试，放进历史并提示 */
function noteSettled(settled: ExamRecord | null): void {
  if (!settled) return
  addExamRecord(settled)
  scheduleSummaryRefresh(settled.subjectId)
  uni.showToast({ title: '上次的考试已超时，已按保存的作答交卷', icon: 'none', duration: 3000 })
}

/** 进行中的考试（只有云模式可能有）；没有时返回 null */
export async function getRunningExam(): Promise<ExamSession | null> {
  if (!repo.exams) return null
  await initStore()
  const res = await repo.exams.current()
  noteSettled(res.settled)
  return res.exam ? fromRemoteExam(res.exam) : null
}

/**
 * 开考。本机模式在本机组卷计时；云模式由服务端组卷，
 * 已有进行中的考试时服务端返回那一场（resumed 为 true）。
 */
export async function startExam(p: {
  subjectId: string
  mode: ExamMode
  sourceId?: string
  onProgress?: (done: number, total: number) => void
}): Promise<{ session: ExamSession; resumed: boolean }> {
  if (repo.exams) {
    const res = await repo.exams.start({ subjectId: p.subjectId, mode: p.mode, sourceId: p.sourceId })
    noteSettled(res.settled)
    return { session: fromRemoteExam(res.exam), resumed: res.resumed }
  }
  let list: Question[]
  let title: string
  if (p.mode === 'paper') {
    const source = getSource(p.sourceId || '')
    if (!source) throw new Error('没有找到这套试卷')
    title = source.title
    list = (await loadSourceQuestions(source.id)).slice()
  } else {
    title = '随机组卷'
    list = await loadRandomQuestions(p.subjectId, EXAM_RANDOM_COUNT, p.onProgress)
  }
  const answers: Record<string, number[]> = {}
  list.forEach((q) => {
    answers[q.id] = []
  })
  const now = Date.now()
  return {
    session: {
      id: '',
      subjectId: p.subjectId,
      mode: p.mode,
      sourceId: p.mode === 'paper' ? p.sourceId : undefined,
      title,
      questions: list,
      answers,
      startTime: now,
      deadline: now + EXAM_MINUTES * 60 * 1000,
    },
    resumed: false,
  }
}

function plainAnswers(answers: Record<string, number[]>): Record<string, number[]> {
  return JSON.parse(JSON.stringify(answers)) as Record<string, number[]>
}

/** 把作答存到服务端，并按服务端时间校准截止时间（本机模式无操作） */
export async function saveExamProgress(session: ExamSession): Promise<void> {
  if (!repo.exams || !session.id) return
  const res = await repo.exams.save(session.id, plainAnswers(session.answers))
  session.deadline = res.deadline - (res.serverNow - Date.now())
}

/** 交卷，返回考试记录 id（成绩页用） */
export async function finishExam(session: ExamSession, auto: boolean): Promise<string> {
  if (!repo.exams) {
    return submitExam({
      subjectId: session.subjectId,
      mode: session.mode,
      sourceId: session.sourceId,
      title: session.title,
      questions: session.questions,
      answers: session.answers,
      startTime: session.startTime,
      autoSubmitted: auto,
    }).id
  }
  const record = await repo.exams.submit(session.id, plainAnswers(session.answers), auto)
  addExamRecord(record)
  scheduleSummaryRefresh(session.subjectId)
  // 交卷后答错的题进了服务端错题本，重新取一次
  refreshWrongIds()
  return record.id
}

/** 放弃考试，不计成绩（本机模式无操作） */
export async function abandonExam(session: ExamSession): Promise<void> {
  if (repo.exams && session.id) await repo.exams.abandon(session.id)
}

function refreshWrongIds(): void {
  repo
    .loadUserData()
    .then((d) => {
      user.wrongIds = d.wrongIds
    })
    .catch((err) => console.error('刷新错题本失败', err))
}

/** 成绩详情：考试记录和涉及的题目（含答案和解析） */
export async function loadExamDetail(id: string): Promise<{ exam: ExamRecord; questions: Record<string, Question> } | null> {
  const map: Record<string, Question> = {}
  if (repo.exams) {
    const res = await repo.exams.result(id)
    res.questions.forEach((q) => {
      map[q.id] = q
    })
    return { exam: res.exam, questions: map }
  }
  const exam = getExam(id)
  if (!exam) return null
  const list = await loadQuestionsByIds(exam.items.map((item) => item.questionId))
  list.forEach((q) => {
    map[q.id] = q
  })
  return { exam, questions: map }
}

/** 清除全部用户数据（保留当前科目和字号）。只在本机模式提供 */
export function clearAllData(): void {
  const subjectId = user.currentSubjectId
  Object.assign(user, createDefaultUserData(), { currentSubjectId: subjectId })
  reader.positions = {}
  saveReader()
  repo.clearUserData().catch((err) => console.error('清除数据失败', err))
  persist()
}

/* ---------- 阅读 ---------- */

function saveReader(): void {
  repo.saveReaderPrefs(JSON.parse(JSON.stringify(reader)) as ReaderPrefs)
}

export function setFontSize(size: FontSizeLevel): void {
  reader.fontSize = size
  saveReader()
}

export function saveReadPosition(materialId: string, page: number, scrollTop: number): void {
  reader.positions[materialId] = { page, scrollTop: Math.max(0, Math.round(scrollTop)), time: Date.now() }
  const keys = Object.keys(reader.positions)
  if (keys.length > MAX_READ_POSITIONS) {
    keys
      .sort((a, b) => reader.positions[a].time - reader.positions[b].time)
      .slice(0, keys.length - MAX_READ_POSITIONS)
      .forEach((k) => {
        delete reader.positions[k]
      })
  }
  saveReader()
}
