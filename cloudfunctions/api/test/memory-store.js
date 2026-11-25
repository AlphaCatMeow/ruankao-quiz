'use strict'

/**
 * 测试用内存数据层，方法签名与 store/cloud-store.js 一致。
 * 每个方法开头 await 一次，让并发请求真正交错执行；
 * 单个方法内部的"比较并更新"是同步完成的，对应数据库单文档条件更新的原子性。
 */
const { applyChanges } = require('../lib/records')
const { groupRecords } = require('../lib/summary')

const tick = () => new Promise((r) => setImmediate(r))
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

function createMemoryStore(seed) {
  const s = seed || {}
  const t = {
    users: new Map(),
    subjects: new Map(),
    sources: new Map(),
    questions: new Map(),
    subjective: new Map(),
    materials: new Map(),
    materialPages: new Map(),
    records: new Map(),
    batches: new Map(),
    exams: new Map(),
    locks: new Map(),
  }
  Object.keys(t).forEach((k) => {
    ;(s[k] || []).forEach((d) => t[k].set(d._id || d.id, clone(Object.assign({ _id: d._id || d.id }, d))))
  })
  const all = (k) => Array.from(t[k].values()).map(clone)
  const get = (k, id) => (t[k].has(id) ? clone(t[k].get(id)) : null)
  const add = (k, doc) => {
    if (t[k].has(doc._id)) return false
    t[k].set(doc._id, clone(doc))
    return true
  }

  return {
    tables: t,

    async getUser(openid) {
      await tick()
      return get('users', openid)
    },
    async createUser(doc) {
      await tick()
      return add('users', doc)
    },
    async updateUser(openid, patch) {
      await tick()
      const u = t.users.get(openid)
      if (!u) return 0
      Object.assign(u, clone(patch))
      return 1
    },
    async addMastered(openid, id) {
      await tick()
      const u = t.users.get(openid)
      if (u && u.mastered.indexOf(id) < 0) u.mastered.push(id)
    },
    async removeMastered(openid, id) {
      await tick()
      const u = t.users.get(openid)
      if (u) u.mastered = u.mastered.filter((x) => x !== id)
    },

    listSubjects: async () => all('subjects'),
    listSources: async () => all('sources'),
    listSubjectiveMeta: async () => all('subjective'),
    listMaterials: async () => all('materials'),
    getSource: async (id) => get('sources', id),
    getQuestion: async (id) => get('questions', id),
    getQuestionsBySource: async (sourceId) => all('questions').filter((q) => q.sourceId === sourceId),
    getQuestionsByIds: async (ids) => ids.map((id) => get('questions', id)).filter(Boolean),
    async sampleQuestions(subjectId, size) {
      await tick()
      return all('questions')
        .filter((q) => q.subjectId === subjectId)
        .slice(0, size)
    },
    getSubjective: async (id) => get('subjective', id),
    getMaterial: async (id) => get('materials', id),
    getMaterialPage: async (materialId, page) => get('materialPages', `${materialId}_p${page}`),

    async upsertRecord(id, changes, createDoc) {
      await tick()
      const prev = t.records.get(id)
      if (prev) {
        t.records.set(id, applyChanges(prev, clone(changes)))
        return
      }
      if (createDoc) add('records', createDoc)
    },
    async listRecords(openid, filter, skip, limit) {
      await tick()
      const orderField = filter.flag === 'wrong' ? 'wrongAt' : 'favoriteAt'
      const list = all('records')
        .filter(
          (r) =>
            r.openid === openid &&
            r[filter.flag] === true &&
            (!filter.subjectId || r.subjectId === filter.subjectId) &&
            (!filter.sourceId || r.sourceId === filter.sourceId),
        )
        .sort((a, b) => b[orderField] - a[orderField])
      return { items: list.slice(skip, skip + limit), total: list.length }
    },
    async clearWrongFlags(openid, subjectId, sourceId) {
      await tick()
      let n = 0
      t.records.forEach((r) => {
        if (r.openid === openid && r.subjectId === subjectId && r.wrong && (!sourceId || r.sourceId === sourceId)) {
          r.wrong = false
          n++
        }
      })
      return n
    },
    async summaryGroups(openid, subjectId) {
      await tick()
      return groupRecords(all('records').filter((r) => r.openid === openid && r.subjectId === subjectId))
    },

    hasBatch: async (openid, batchId) => t.batches.has(`${openid}_${batchId}`),
    addBatch: async (openid, batchId, now) => add('batches', { _id: `${openid}_${batchId}`, openid, createdAt: now }),

    async createExam(doc) {
      await tick()
      if (!add('exams', doc)) throw new Error('duplicate exam id')
    },
    async getExam(id) {
      await tick()
      return get('exams', id)
    },
    async updateExamIf(id, cond, patch) {
      await tick()
      const e = t.exams.get(id)
      if (!e || e.status !== cond.status) return 0
      if (cond.deadlineAtLeast !== undefined && !(e.deadline >= cond.deadlineAtLeast)) return 0
      Object.assign(e, clone(patch))
      return 1
    },
    async listExams(openid, filter, skip, limit) {
      await tick()
      const list = all('exams')
        .filter((e) => e.openid === openid && e.status === 'finished' && (!filter.subjectId || e.subjectId === filter.subjectId))
        .sort((a, b) => b.endAt - a.endAt)
      return { items: list.slice(skip, skip + limit), total: list.length }
    },
    async getLock(openid) {
      await tick()
      return get('locks', openid)
    },
    async createLock(openid, examId, now) {
      await tick()
      return add('locks', { _id: openid, examId, updatedAt: now })
    },
    async swapLock(openid, fromExamId, toExamId, now) {
      await tick()
      const l = t.locks.get(openid)
      if (!l || l.examId !== fromExamId) return false
      l.examId = toExamId
      l.updatedAt = now
      return true
    },
  }
}

module.exports = { createMemoryStore }
