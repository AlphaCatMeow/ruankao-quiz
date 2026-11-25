'use strict'

/**
 * 作答记录（answer_records）的更新计算。
 * 一条记录对应 用户 × 题目，文档 id 固定为 `${openid}_${questionId}`，重复提交不会产生多份文档。
 */
const { isCorrect, normalizeAnswer } = require('./judge')

function recordId(openid, questionId) {
  return `${openid}_${questionId}`
}

/**
 * 把一批作答按题目汇总，并用题库里的答案重新判对错。
 * items: [{ questionId, answer }]（answer 为空的项跳过，不计作答次数）
 * questionsById: Map 或对象，题目 id -> 含 answer 的题目
 * 返回 { updates, results, unknown }：
 *   updates  每题一条：attempts、corrects、最后一次作答及是否答对、本批是否答错过
 *   results  与 items 一一对应的判定结果（跳过的空作答和未知题不在其中）
 *   unknown  题库里找不到的题目 id
 */
function aggregateAnswers(items, questionsById) {
  const get = (qid) => (questionsById instanceof Map ? questionsById.get(qid) : questionsById[qid])
  const byId = new Map()
  const results = []
  const unknown = []
  for (const item of items) {
    const answer = normalizeAnswer(item.answer)
    if (answer.length === 0) continue
    const q = get(item.questionId)
    if (!q) {
      if (unknown.indexOf(item.questionId) < 0) unknown.push(item.questionId)
      continue
    }
    const correct = isCorrect(answer, q.answer)
    results.push({ questionId: item.questionId, correct })
    let u = byId.get(item.questionId)
    if (!u) {
      u = {
        questionId: item.questionId,
        subjectId: q.subjectId,
        sourceId: q.sourceId,
        attempts: 0,
        corrects: 0,
        lastCorrect: false,
        lastAnswer: [],
        anyWrong: false,
      }
      byId.set(item.questionId, u)
    }
    u.attempts++
    if (correct) u.corrects++
    else u.anyWrong = true
    u.lastCorrect = correct
    u.lastAnswer = answer
  }
  return { updates: Array.from(byId.values()), results, unknown }
}

/**
 * 已有记录的增量更新：次数用自增，其余字段覆盖。
 * 答错把 wrong 置 true；答对不动 wrong（移出错题本只能由用户操作）。
 */
function recordChanges(u, now) {
  const set = {
    subjectId: u.subjectId,
    sourceId: u.sourceId,
    lastCorrect: u.lastCorrect,
    lastAnswer: u.lastAnswer.slice(),
    lastTime: now,
  }
  if (u.anyWrong) {
    set.wrong = true
    set.wrongAt = now
  }
  return { inc: { count: u.attempts, correctCount: u.corrects }, set }
}

/** 记录不存在时新建的完整文档 */
function newRecord(openid, u, now) {
  return {
    _id: recordId(openid, u.questionId),
    openid,
    questionId: u.questionId,
    subjectId: u.subjectId,
    sourceId: u.sourceId,
    count: u.attempts,
    correctCount: u.corrects,
    lastCorrect: u.lastCorrect,
    lastAnswer: u.lastAnswer.slice(),
    lastTime: now,
    wrong: u.anyWrong,
    wrongAt: u.anyWrong ? now : 0,
    favorite: false,
    favoriteAt: 0,
  }
}

/** 只改标记（收藏、移出错题本）时，记录不存在则新建的文档；count 为 0 表示没做过 */
function flagRecord(openid, q, flags, now) {
  return Object.assign(
    {
      _id: recordId(openid, q.id || q._id),
      openid,
      questionId: q.id || q._id,
      subjectId: q.subjectId,
      sourceId: q.sourceId,
      count: 0,
      correctCount: 0,
      lastCorrect: false,
      lastAnswer: [],
      lastTime: 0,
      wrong: false,
      wrongAt: 0,
      favorite: false,
      favoriteAt: now,
    },
    flags,
  )
}

/** 在内存里应用一次 { inc, set }，返回新对象（数据库实现用自增原子操作，语义相同） */
function applyChanges(prev, changes) {
  const next = Object.assign({}, prev)
  const inc = changes.inc || {}
  Object.keys(inc).forEach((k) => {
    next[k] = (Number(next[k]) || 0) + inc[k]
  })
  Object.assign(next, changes.set || {})
  return next
}

module.exports = { recordId, aggregateAnswers, recordChanges, newRecord, flagRecord, applyChanges }
