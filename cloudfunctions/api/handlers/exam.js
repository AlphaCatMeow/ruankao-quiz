'use strict'

/**
 * 考试。
 *
 * 同一用户只能有一场进行中的考试，做法是"锁文档 + 条件更新"：
 *   exam_locks 集合里每个用户一条文档，_id = openid，examId 指向该用户最近一场考试。
 *   开考时先读锁；锁指向的考试仍在进行就直接返回它。否则新建考试文档，再用
 *   where({ _id: openid, examId: 读到的旧值 }).update() 把锁换成新考试（比较并交换）。
 *   锁不存在时用 add({ _id: openid }) 创建，_id 重复会失败。
 *   并发开考时只有一个请求能换锁成功，失败方把自己刚建的考试标为 discarded，再返回胜出的那场。
 * 交卷、超时结算、放弃都用 where({ _id, status: 'running' }).update() 改状态，
 * 只有改成功的那一次才写作答记录，重复交卷不会重复计数。
 */
const crypto = require('crypto')
const C = require('../lib/constants')
const V = require('../lib/validate')
const { AppError, CODES, invalid, notFound } = require('../lib/errors')
const { orderByIds } = require('../lib/sanitize')
const E = require('../lib/exam')
const { writeAnswers } = require('./progress')

function newExamId() {
  return crypto.randomBytes(12).toString('hex')
}

function closed(message) {
  return new AppError(CODES.EXAM_CLOSED, message)
}

async function questionsOf(ctx, session) {
  const list = await ctx.store.getQuestionsByIds(session.questionIds)
  return orderByIds(session.questionIds, list)
}

async function ownExam(ctx, examId) {
  const s = await ctx.store.getExam(examId)
  if (!s || s.openid !== ctx.openid || s.status === 'discarded') throw notFound('没有找到这场考试')
  return s
}

/**
 * 结算一场 running 的考试。submitted 为本次交卷的作答 Map（超时结算时为 null）。
 * 返回结算后的考试文档；并发下另一请求先结算时返回那次的结果。
 */
async function settle(ctx, session, submitted, auto) {
  const decision = E.decideSubmit(session, ctx.now)
  const answers =
    decision.acceptClient && submitted ? E.mergeAnswers(session.questionIds, session.answers, submitted) : session.answers
  const questions = await questionsOf(ctx, session)
  const result = E.settleExam({
    questionIds: session.questionIds,
    questions,
    answers,
    startAt: session.startAt,
    deadline: session.deadline,
    now: ctx.now,
    timedOut: decision.timedOut,
    auto,
  })
  const patch = Object.assign({ status: 'finished', answers }, result)
  const updated = await ctx.store.updateExamIf(session._id, { status: 'running' }, patch)
  if (updated !== 1) {
    const latest = await ctx.store.getExam(session._id)
    if (latest && latest.status === 'finished') return Object.assign(latest, { alreadySettled: true })
    throw closed('这场考试已经结束')
  }
  const answered = E.answeredItems(result.items)
  if (answered.length > 0) await writeAnswers(ctx, answered, questions)
  return Object.assign({}, session, patch)
}

/**
 * 读锁指向的考试：仍在作答期或宽限期则返回；已过宽限的先按保存的作答结算，返回 null。
 * settledOut 用于把"刚被自动结算的考试"带回给前端。
 */
async function activeFromLock(ctx, lock, settledOut) {
  if (!lock || !lock.examId) return null
  const s = await ctx.store.getExam(lock.examId)
  if (!s || s.openid !== ctx.openid || s.status !== 'running') return null
  if (E.examPhase(s, ctx.now) === 'expired') {
    const done = await settle(ctx, s, null, true)
    if (settledOut) settledOut.push(E.summaryView(done))
    return null
  }
  return s
}

async function present(ctx, session) {
  return E.runningView(session, await questionsOf(ctx, session), ctx.now)
}

async function start(ctx) {
  const p = V.payloadObject(ctx.payload)
  const subjectId = V.id(p.subjectId, 'subjectId')
  const mode = V.oneOf(p.mode, 'mode', ['paper', 'random'])
  const sourceId = mode === 'paper' ? V.id(p.sourceId, 'sourceId') : ''

  // 只读一次锁；后面换锁时以这次读到的值为准，避免覆盖别人刚开的考试
  const lock = await ctx.store.getLock(ctx.openid)
  const settled = []
  const active = await activeFromLock(ctx, lock, settled)
  if (active) return { exam: await present(ctx, active), resumed: true, settled: settled[0] || null }

  let questions
  let title
  if (mode === 'paper') {
    const source = await ctx.store.getSource(sourceId)
    if (!source || source.subjectId !== subjectId) throw notFound('没有找到这套试卷')
    questions = (await ctx.store.getQuestionsBySource(sourceId)).sort((a, b) => a.no - b.no)
    title = source.title
  } else {
    questions = await ctx.store.sampleQuestions(subjectId, C.EXAM_RANDOM_COUNT)
    title = '随机组卷'
  }
  if (questions.length === 0) throw notFound('该科目暂无题目')

  const id = (ctx.newId || newExamId)()
  const doc = E.newExamSession({
    id,
    openid: ctx.openid,
    subjectId,
    mode,
    sourceId,
    title,
    questionIds: questions.map((q) => q.id || q._id),
    now: ctx.now,
  })
  await ctx.store.createExam(doc)
  const won = lock
    ? await ctx.store.swapLock(ctx.openid, lock.examId, id, ctx.now)
    : await ctx.store.createLock(ctx.openid, id, ctx.now)
  if (!won) {
    await ctx.store.updateExamIf(id, { status: 'running' }, { status: 'discarded' })
    const other = await activeFromLock(ctx, await ctx.store.getLock(ctx.openid), settled)
    if (other) return { exam: await present(ctx, other), resumed: true, settled: settled[0] || null }
    throw new AppError(CODES.CONFLICT, '开考冲突，请重试')
  }
  return { exam: E.runningView(doc, questions, ctx.now), resumed: false, settled: settled[0] || null }
}

async function current(ctx) {
  const lock = await ctx.store.getLock(ctx.openid)
  const settled = []
  const active = await activeFromLock(ctx, lock, settled)
  return { exam: active ? await present(ctx, active) : null, settled: settled[0] || null, serverNow: ctx.now }
}

async function save(ctx) {
  const p = V.payloadObject(ctx.payload)
  const examId = V.token(p.examId, 'examId')
  const s = await ownExam(ctx, examId)
  if (s.status !== 'running') throw closed('这场考试已经结束')
  if (!E.canSave(s, ctx.now)) throw closed('考试时间已到，请交卷')
  const submitted = V.answerMap(p.answers, s.questionIds)
  const answers = E.mergeAnswers(s.questionIds, s.answers, submitted)
  const updated = await ctx.store.updateExamIf(
    examId,
    { status: 'running', deadlineAtLeast: ctx.now },
    { answers, savedAt: ctx.now },
  )
  if (updated !== 1) throw closed('考试已结束或时间已到')
  return { savedAt: ctx.now, serverNow: ctx.now, deadline: s.deadline }
}

async function submit(ctx) {
  const p = V.payloadObject(ctx.payload)
  const examId = V.token(p.examId, 'examId')
  const auto = p.auto === undefined ? false : V.bool(p.auto, 'auto')
  const s = await ownExam(ctx, examId)
  if (s.status === 'finished') return Object.assign(E.summaryView(s), { duplicate: true })
  if (s.status !== 'running') throw closed('这场考试已放弃，不能交卷')
  const submitted = V.answerMap(p.answers, s.questionIds)
  const done = await settle(ctx, s, submitted, auto)
  return Object.assign(E.summaryView(done), { duplicate: !!done.alreadySettled })
}

async function abandon(ctx) {
  const p = V.payloadObject(ctx.payload)
  const examId = V.token(p.examId, 'examId')
  const s = await ownExam(ctx, examId)
  if (s.status === 'abandoned') return { id: examId, status: 'abandoned' }
  if (s.status !== 'running') throw closed('这场考试已经结束')
  const updated = await ctx.store.updateExamIf(examId, { status: 'running' }, { status: 'abandoned', endAt: ctx.now })
  if (updated !== 1) {
    const latest = await ctx.store.getExam(examId)
    if (!latest || latest.status !== 'abandoned') throw closed('这场考试已经结束')
  }
  return { id: examId, status: 'abandoned' }
}

async function history(ctx) {
  const p = V.payloadObject(ctx.payload)
  const subjectId = V.id(p.subjectId, 'subjectId', true)
  const { page, pageSize, skip } = V.paging(p)
  const res = await ctx.store.listExams(ctx.openid, { subjectId }, skip, pageSize)
  return {
    items: res.items.map(E.summaryView),
    total: res.total,
    page,
    pageSize,
    hasMore: skip + res.items.length < res.total,
  }
}

async function result(ctx) {
  const p = V.payloadObject(ctx.payload)
  const examId = V.token(p.examId, 'examId')
  const s = await ownExam(ctx, examId)
  if (s.status !== 'finished') throw invalid('考试尚未结束，不能查看答案')
  return E.resultView(s, await questionsOf(ctx, s))
}

module.exports = { start, current, save, submit, abandon, history, result }
