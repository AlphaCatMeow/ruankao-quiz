'use strict'

/**
 * 进度统计。数据库实现用聚合按题集分组得到 groups，
 * 内存实现和测试用 groupRecords 从记录列表算出同样的 groups。
 * group: { _id: sourceId, done, attempts, correct, wrong, favorite }
 */
function groupRecords(records) {
  const map = new Map()
  for (const r of records) {
    let g = map.get(r.sourceId)
    if (!g) {
      g = { _id: r.sourceId, done: 0, attempts: 0, correct: 0, wrong: 0, favorite: 0 }
      map.set(r.sourceId, g)
    }
    if (r.count > 0) g.done++
    g.attempts += r.count || 0
    g.correct += r.correctCount || 0
    if (r.wrong) g.wrong++
    if (r.favorite) g.favorite++
  }
  return Array.from(map.values())
}

function buildSummary(subjectId, groups) {
  const out = { subjectId, done: 0, attempts: 0, correct: 0, wrongCount: 0, favoriteCount: 0, sources: {} }
  for (const g of groups) {
    const t = {
      done: g.done || 0,
      attempts: g.attempts || 0,
      correct: g.correct || 0,
      wrong: g.wrong || 0,
      favorite: g.favorite || 0,
    }
    out.sources[g._id] = t
    out.done += t.done
    out.attempts += t.attempts
    out.correct += t.correct
    out.wrongCount += t.wrong
    out.favoriteCount += t.favorite
  }
  return out
}

module.exports = { groupRecords, buildSummary }
