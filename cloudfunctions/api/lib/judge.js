'use strict'

/** 把作答整理成去重、升序的整数数组；非数组视为未作答 */
function normalizeAnswer(answer) {
  if (!Array.isArray(answer)) return []
  const set = new Set()
  for (const v of answer) {
    if (Number.isInteger(v) && v >= 0) set.add(v)
  }
  return Array.from(set).sort((a, b) => a - b)
}

/** 判对错：单选、多选一律按集合比较，顺序无关；空作答算错 */
function isCorrect(userAnswer, correctAnswer) {
  const u = normalizeAnswer(userAnswer)
  const c = normalizeAnswer(correctAnswer)
  if (u.length === 0 || u.length !== c.length) return false
  return u.every((v, i) => v === c[i])
}

module.exports = { normalizeAnswer, isCorrect }
