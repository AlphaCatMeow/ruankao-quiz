'use strict'

/**
 * 考试的纯计算：状态判定、作答合并、结算、对外视图。
 *
 * session（exam_sessions 文档）字段：
 *   _id, openid, subjectId, mode('paper'|'random'), sourceId, title,
 *   questionIds[], answers[][]（与 questionIds 对齐，空数组为未作答），
 *   status('running'|'finished'|'abandoned'|'discarded'),
 *   startAt, deadline, savedAt, endAt, submittedAt,
 *   items[], total, correctCount, score, timedOut, autoSubmitted, durationSec
 */
const C = require('./constants')
const { isCorrect, normalizeAnswer } = require('./judge')
const { stripAnswer, publicQuestion } = require('./sanitize')

/**
 * 考试阶段：
 *   非 running 状态原样返回；
 *   running 且 now <= deadline         -> 'running'（可保存、可交卷）
 *   deadline < now <= deadline + 宽限   -> 'grace'（不能保存，交卷仍接受客户端作答）
 *   之后                                -> 'expired'（按已保存作答结算，标记超时）
 */
function examPhase(session, now) {
  if (session.status !== 'running') return session.status
  if (now <= session.deadline) return 'running'
  if (now <= session.deadline + C.EXAM_GRACE_MS) return 'grace'
  return 'expired'
}

function canSave(session, now) {
  return examPhase(session, now) === 'running'
}

/** 交卷时是否采纳客户端作答、是否算超时。只对 running 状态的考试调用 */
function decideSubmit(session, now) {
  const phase = examPhase(session, now)
  if (phase === 'running' || phase === 'grace') return { phase, acceptClient: true, timedOut: false }
  if (phase === 'expired') return { phase, acceptClient: false, timedOut: true }
  return { phase, acceptClient: false, timedOut: false }
}

/** 已保存作答（数组）和本次提交（Map）合并：提交里有的题以提交为准 */
function mergeAnswers(questionIds, saved, submitted) {
  return questionIds.map((qid, i) => {
    if (submitted && submitted.has(qid)) return normalizeAnswer(submitted.get(qid))
    return normalizeAnswer(saved && saved[i])
  })
}

function answersToMap(questionIds, answers) {
  const out = {}
  questionIds.forEach((qid, i) => {
    out[qid] = normalizeAnswer(answers && answers[i])
  })
  return out
}

/**
 * 结算：questions 为带答案的题目（按 questionIds 顺序，题库里已删除的题会缺失），
 * answers 与 questionIds 对齐。未作答的题不得分。
 */
function settleExam(params) {
  const { questionIds, questions, answers, startAt, deadline, now, timedOut, auto } = params
  const byId = new Map()
  questions.forEach((q) => byId.set(q.id || q._id, q))
  const items = []
  let correctCount = 0
  questionIds.forEach((qid, i) => {
    const q = byId.get(qid)
    if (!q) return
    const userAnswer = normalizeAnswer(answers && answers[i])
    const correct = userAnswer.length > 0 && isCorrect(userAnswer, q.answer)
    if (correct) correctCount++
    items.push({ questionId: qid, userAnswer, correct })
  })
  const total = items.length
  const endAt = Math.min(now, deadline)
  return {
    items,
    total,
    correctCount,
    score: total > 0 ? Math.round((correctCount / total) * 100) : 0,
    endAt,
    submittedAt: now,
    durationSec: Math.max(0, Math.round((endAt - startAt) / 1000)),
    timedOut: !!timedOut,
    autoSubmitted: !!auto || !!timedOut,
  }
}

/** 结算结果里已作答的题，转成作答记录的输入（未作答的不计作答次数、不进错题本） */
function answeredItems(items) {
  return items.filter((it) => it.userAnswer.length > 0).map((it) => ({ questionId: it.questionId, answer: it.userAnswer }))
}

function newExamSession(p) {
  return {
    _id: p.id,
    openid: p.openid,
    subjectId: p.subjectId,
    mode: p.mode,
    sourceId: p.sourceId || '',
    title: p.title,
    questionIds: p.questionIds.slice(),
    answers: p.questionIds.map(() => []),
    status: 'running',
    startAt: p.now,
    deadline: p.now + C.EXAM_DURATION_MS,
    savedAt: 0,
    endAt: 0,
    submittedAt: 0,
  }
}

/** 进行中考试的对外视图：题目不带答案和解析 */
function runningView(session, questions, now) {
  return {
    id: session._id,
    subjectId: session.subjectId,
    mode: session.mode,
    sourceId: session.sourceId || '',
    title: session.title,
    questions: questions.map(stripAnswer),
    answers: answersToMap(session.questionIds, session.answers),
    startAt: session.startAt,
    deadline: session.deadline,
    serverNow: now,
  }
}

/** 已结束考试的摘要（历史列表用，不含逐题） */
function summaryView(session) {
  return {
    id: session._id,
    subjectId: session.subjectId,
    mode: session.mode,
    sourceId: session.sourceId || '',
    title: session.title,
    startTime: session.startAt,
    endTime: session.endAt,
    durationSec: session.durationSec || 0,
    autoSubmitted: !!session.autoSubmitted,
    timedOut: !!session.timedOut,
    total: session.total || 0,
    correctCount: session.correctCount || 0,
    score: session.score || 0,
  }
}

/** 成绩详情：逐题结果 + 带答案和解析的题目 */
function resultView(session, questions) {
  return Object.assign(summaryView(session), {
    items: (session.items || []).map((it) => ({
      questionId: it.questionId,
      userAnswer: normalizeAnswer(it.userAnswer),
      correct: !!it.correct,
    })),
    questions: questions.map(publicQuestion),
  })
}

/** 从列表里不放回地随机取 n 个 */
function pickRandom(list, n, rng) {
  const r = rng || Math.random
  const a = list.slice()
  const k = Math.min(n, a.length)
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(r() * (a.length - i))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a.slice(0, k)
}

module.exports = {
  examPhase,
  canSave,
  decideSubmit,
  mergeAnswers,
  answersToMap,
  settleExam,
  answeredItems,
  newExamSession,
  runningView,
  summaryView,
  resultView,
  pickRandom,
}
