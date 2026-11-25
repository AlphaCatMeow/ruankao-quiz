/** 题型：单选、多选、判断 */
export type QuestionType = 'single' | 'multi' | 'judge'

/** 题集类型：历年真题、模拟卷、专题题集 */
export type SourceKind = 'exam' | 'mock' | 'drill'

/** 主观题类型：案例、计算 */
export type SubjectiveKind = 'case' | 'calc'

/** 考试科目 */
export interface Subject {
  id: string
  name: string
  shortName: string
  description: string
}

/** 数据块位置：pkg 为分包名，path 为相对代码包根目录的路径 */
export interface ChunkRef {
  pkg: string
  path: string
  bytes: number
}

/** 题目来源（一套卷或一个题集） */
export interface SourceMeta {
  id: string
  subjectId: string
  title: string
  kind: SourceKind
  /** 清洗后的选择题数量 */
  questionCount: number
  subjectiveCount: number
  /** 选择题数据块的 key，没有选择题时为空串 */
  chunk: string
}

/** 主观题索引（不含正文） */
export interface SubjectiveMeta {
  id: string
  subjectId: string
  sourceId: string
  kind: SubjectiveKind
  title: string
  hasAnswer: boolean
}

/** 资料目录 */
export interface MaterialMeta {
  id: string
  subjectId: string
  category: string
  title: string
  chars: number
  /** 本机模式的数据块 key；云模式为空串 */
  chunk: string
}

/** 资料的一页（阅读页按页显示） */
export interface MaterialPage {
  title: string
  /** 从 0 开始 */
  page: number
  pageCount: number
  paras: string[]
}

/** 某科目的进度统计（云模式由服务端汇总） */
export interface SubjectSummary {
  subjectId: string
  done: number
  attempts: number
  correct: number
  wrongCount: number
  favoriteCount: number
  /** 题集 id -> 汇总 */
  sources: Record<string, { done: number; attempts: number; correct: number }>
}

/** 进行中的考试（题目不带答案）。deadline 已换算成本机时钟 */
export interface ExamSession {
  /** 本机模式为空串 */
  id: string
  subjectId: string
  mode: ExamMode
  sourceId?: string
  title: string
  questions: Question[]
  answers: Record<string, number[]>
  startTime: number
  deadline: number
}

/** 用户资料（云模式） */
export interface UserProfile {
  nickname: string
  points: number
}

/** 主包内的题库索引，由 scripts/pack-bank.mjs 生成 */
export interface BankIndex {
  version: number
  subjects: Subject[]
  categories: string[]
  sources: SourceMeta[]
  subjective: SubjectiveMeta[]
  /** 科目 id -> 主观题数据块 key */
  subjectiveChunks: Record<string, string>
  materials: MaterialMeta[]
  /** 数据块 key -> 位置 */
  chunks: Record<string, ChunkRef>
}

/** 选择题 */
export interface Question {
  id: string
  subjectId: string
  sourceId: string
  /** 原卷题号 */
  no: number
  type: QuestionType
  stem: string
  options: string[]
  /** 正确答案，存选项下标 */
  answer: number[]
  explanation: string
}

/** 主观题全文 */
export interface SubjectiveItem {
  id: string
  subjectId: string
  sourceId: string
  kind: SubjectiveKind
  title: string
  stem: string
  answer: string
}

/** 资料正文，按段落存放 */
export interface MaterialDoc {
  id: string
  title: string
  paras: string[]
}

/** 单题作答记录 */
export interface AnswerRecord {
  /** 累计作答次数 */
  count: number
  /** 累计答对次数 */
  correctCount: number
  /** 最近一次是否答对 */
  lastCorrect: boolean
  /** 最近一次的作答 */
  lastAnswer: number[]
  /** 最近一次作答时间（毫秒时间戳） */
  lastTime: number
}

/** 模拟考试中单题的结果 */
export interface ExamItem {
  questionId: string
  /** 空数组表示未作答 */
  userAnswer: number[]
  correct: boolean
}

/** 组卷方式：整套卷、随机组卷 */
export type ExamMode = 'paper' | 'random'

/** 一次模拟考试的记录 */
export interface ExamRecord {
  id: string
  subjectId: string
  mode: ExamMode
  /** 整套卷的来源 id */
  sourceId?: string
  title: string
  startTime: number
  endTime: number
  /** 实际用时（秒） */
  durationSec: number
  /** 时间到自动交卷 */
  autoSubmitted: boolean
  /** 云模式：超过截止时间和宽限后才交卷，按服务端保存的作答结算 */
  timedOut?: boolean
  total: number
  correctCount: number
  /** 百分制得分 */
  score: number
  items: ExamItem[]
}

/** 本机保存的全部用户数据 */
export interface UserData {
  version: number
  currentSubjectId: string
  /** 题目 id -> 作答记录 */
  records: Record<string, AnswerRecord>
  wrongIds: string[]
  favoriteIds: string[]
  /** 最近的考试排在前面 */
  exams: ExamRecord[]
  /** 标记为已掌握的主观题 id */
  masteredIds: string[]
}

export type FontSizeLevel = 'small' | 'medium' | 'large'

/** 资料阅读位置 */
export interface ReadPosition {
  page: number
  scrollTop: number
  time: number
}

/** 阅读设置与位置，单独存放，避免滚动时反复写整份用户数据 */
export interface ReaderPrefs {
  fontSize: FontSizeLevel
  positions: Record<string, ReadPosition>
}

/** 练习模式 */
export type PracticeMode = 'source' | 'random' | 'wrong' | 'favorite'

/** 答题卡格子状态：none 未作答，done 已作答（不显示对错），right 答对，wrong 答错 */
export type CardStatus = 'none' | 'done' | 'right' | 'wrong'
