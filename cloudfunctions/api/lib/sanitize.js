'use strict'

/** 练习用：题目全文（含答案和解析），去掉数据库内部字段 */
function publicQuestion(q) {
  return {
    id: q.id || q._id,
    subjectId: q.subjectId,
    sourceId: q.sourceId,
    no: q.no,
    type: q.type,
    stem: q.stem,
    options: Array.isArray(q.options) ? q.options.slice() : [],
    answer: Array.isArray(q.answer) ? q.answer.slice() : [],
    explanation: q.explanation || '',
  }
}

/** 考试下发用：不带答案和解析 */
function stripAnswer(q) {
  return {
    id: q.id || q._id,
    subjectId: q.subjectId,
    sourceId: q.sourceId,
    no: q.no,
    type: q.type,
    stem: q.stem,
    options: Array.isArray(q.options) ? q.options.slice() : [],
  }
}

/** 按 ids 的顺序排列文档，找不到的跳过 */
function orderByIds(ids, docs) {
  const map = new Map()
  for (const d of docs) map.set(d.id || d._id, d)
  const out = []
  for (const id of ids) {
    const d = map.get(id)
    if (d) out.push(d)
  }
  return out
}

module.exports = { publicQuestion, stripAnswer, orderByIds }
