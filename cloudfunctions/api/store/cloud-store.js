'use strict'

/**
 * 数据层：云数据库的薄封装。业务代码只通过这里的方法读写数据库。
 * 测试用的内存实现在 test/memory-store.js，两者方法签名保持一致。
 *
 * 读单条一律用 where({ _id }) 而不是 doc().get()，因为后者在文档不存在时会抛错。
 * 更新对象、数组字段时用 _.set() 整体替换（云数据库对嵌套对象的 update 默认是合并）。
 */

const COL = {
  users: 'users',
  subjects: 'subjects',
  sources: 'sources',
  questions: 'questions',
  subjective: 'subjective',
  materials: 'materials',
  materialPages: 'material_pages',
  records: 'answer_records',
  batches: 'submit_batches',
  exams: 'exam_sessions',
  locks: 'exam_locks',
}

/** 服务端单次查询上限 */
const MAX_LIMIT = 1000
/** _.in 一次带的 id 数 */
const IN_CHUNK = 100

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function createCloudStore(db) {
  const _ = db.command
  const $ = _.aggregate

  const col = (name) => db.collection(name)

  async function findById(name, id) {
    const res = await col(name).where({ _id: id }).limit(1).get()
    return res.data[0] || null
  }

  /** 取满足条件的全部文档（题库目录这类小集合） */
  async function fetchAll(name, where, field) {
    const out = []
    for (let skip = 0; ; skip += MAX_LIMIT) {
      let q = col(name).where(where || {})
      if (field) q = q.field(field)
      const res = await q.skip(skip).limit(MAX_LIMIT).get()
      out.push(...res.data)
      if (res.data.length < MAX_LIMIT) return out
    }
  }

  /** add 失败时判断是否因为 _id 已存在：重新读一次，存在则返回 false，否则继续抛错 */
  async function addOnce(name, doc) {
    try {
      await col(name).add({ data: doc })
      return true
    } catch (err) {
      const exists = await findById(name, doc._id)
      if (exists) return false
      throw err
    }
  }

  /** 把 patch 里的对象、数组值包成 _.set，避免被合并更新 */
  function wrapSet(patch) {
    const out = {}
    Object.keys(patch).forEach((k) => {
      const v = patch[k]
      out[k] = v !== null && typeof v === 'object' ? _.set(v) : v
    })
    return out
  }

  async function updateWhere(name, where, patch) {
    const res = await col(name).where(where).update({ data: wrapSet(patch) })
    return (res && res.stats && res.stats.updated) || 0
  }

  return {
    /* ---------- users ---------- */
    getUser: (openid) => findById(COL.users, openid),
    createUser: (doc) => addOnce(COL.users, doc),
    updateUser: (openid, patch) => updateWhere(COL.users, { _id: openid }, patch),
    addMastered: (openid, id) => col(COL.users).where({ _id: openid }).update({ data: { mastered: _.addToSet(id) } }),
    removeMastered: (openid, id) => col(COL.users).where({ _id: openid }).update({ data: { mastered: _.pull(id) } }),

    /* ---------- 题库 ---------- */
    listSubjects: () => fetchAll(COL.subjects),
    listSources: () => fetchAll(COL.sources),
    listSubjectiveMeta: () =>
      fetchAll(COL.subjective, {}, { id: true, subjectId: true, sourceId: true, kind: true, title: true, hasAnswer: true, order: true }),
    listMaterials: () => fetchAll(COL.materials),
    getSource: (id) => findById(COL.sources, id),
    getQuestion: (id) => findById(COL.questions, id),
    getQuestionsBySource: (sourceId) => fetchAll(COL.questions, { sourceId }),
    async getQuestionsByIds(ids) {
      const parts = await Promise.all(
        chunk(ids, IN_CHUNK).map((part) => col(COL.questions).where({ _id: _.in(part) }).limit(IN_CHUNK).get()),
      )
      const out = []
      parts.forEach((r) => out.push(...r.data))
      return out
    },
    async sampleQuestions(subjectId, size) {
      const res = await col(COL.questions).aggregate().match({ subjectId }).sample({ size }).end()
      return res.list
    },
    getSubjective: (id) => findById(COL.subjective, id),
    getMaterial: (id) => findById(COL.materials, id),
    getMaterialPage: (materialId, page) => findById(COL.materialPages, `${materialId}_p${page}`),

    /* ---------- 作答记录 ---------- */
    /**
     * 有则按 changes 更新（inc 自增、set 覆盖），无则用 createDoc 新建。
     * createDoc 为 null 时记录不存在就什么都不做。
     * 并发新建时 add 会因 _id 重复失败，此时改为再更新一次。
     */
    async upsertRecord(id, changes, createDoc) {
      const data = {}
      const inc = changes.inc || {}
      Object.keys(inc).forEach((k) => {
        if (inc[k]) data[k] = _.inc(inc[k])
      })
      Object.assign(data, wrapSet(changes.set || {}))
      const update = () => col(COL.records).where({ _id: id }).update({ data })
      const res = await update()
      if (res.stats.updated > 0 || !createDoc) return
      // updated 为 0 可能是记录不存在，也可能是值没有变化
      const exists = await findById(COL.records, id)
      if (exists) return
      const created = await addOnce(COL.records, createDoc)
      if (!created) await update()
    },
    async listRecords(openid, filter, skip, limit) {
      const where = { openid }
      if (filter.subjectId) where.subjectId = filter.subjectId
      if (filter.sourceId) where.sourceId = filter.sourceId
      where[filter.flag] = true
      const orderField = filter.flag === 'wrong' ? 'wrongAt' : 'favoriteAt'
      const [list, count] = await Promise.all([
        col(COL.records)
          .where(where)
          .orderBy(orderField, 'desc')
          .skip(skip)
          .limit(limit)
          .field({ questionId: true, sourceId: true, subjectId: true })
          .get(),
        col(COL.records).where(where).count(),
      ])
      return { items: list.data, total: count.total }
    },
    clearWrongFlags: async (openid, subjectId, sourceId) => {
      const where = { openid, subjectId, wrong: true }
      if (sourceId) where.sourceId = sourceId
      return updateWhere(COL.records, where, { wrong: false })
    },
    async summaryGroups(openid, subjectId) {
      const flag = (field) => $.sum($.cond({ if: $.eq([field, true]), then: 1, else: 0 }))
      const res = await col(COL.records)
        .aggregate()
        .match({ openid, subjectId })
        .group({
          _id: '$sourceId',
          done: $.sum($.cond({ if: $.gt(['$count', 0]), then: 1, else: 0 })),
          attempts: $.sum('$count'),
          correct: $.sum('$correctCount'),
          wrong: flag('$wrong'),
          favorite: flag('$favorite'),
        })
        .limit(MAX_LIMIT)
        .end()
      return res.list
    },

    /* ---------- 提交批次（离线重试去重） ---------- */
    hasBatch: async (openid, batchId) => !!(await findById(COL.batches, `${openid}_${batchId}`)),
    addBatch: (openid, batchId, now) => addOnce(COL.batches, { _id: `${openid}_${batchId}`, openid, createdAt: now }),

    /* ---------- 考试 ---------- */
    createExam: (doc) => col(COL.exams).add({ data: doc }),
    getExam: (id) => findById(COL.exams, id),
    /**
     * 条件更新，返回更新条数。cond.status 必须相等；cond.deadlineAtLeast 表示 deadline >= 该值。
     */
    updateExamIf(id, cond, patch) {
      const where = { _id: id, status: cond.status }
      if (cond.deadlineAtLeast !== undefined) where.deadline = _.gte(cond.deadlineAtLeast)
      return updateWhere(COL.exams, where, patch)
    },
    async listExams(openid, filter, skip, limit) {
      const where = { openid, status: 'finished' }
      if (filter.subjectId) where.subjectId = filter.subjectId
      const [list, count] = await Promise.all([
        col(COL.exams)
          .where(where)
          .orderBy('endAt', 'desc')
          .skip(skip)
          .limit(limit)
          .field({ items: false, answers: false, questionIds: false })
          .get(),
        col(COL.exams).where(where).count(),
      ])
      return { items: list.data, total: count.total }
    },
    getLock: (openid) => findById(COL.locks, openid),
    createLock: (openid, examId, now) => addOnce(COL.locks, { _id: openid, examId, updatedAt: now }),
    async swapLock(openid, fromExamId, toExamId, now) {
      const n = await updateWhere(COL.locks, { _id: openid, examId: fromExamId }, { examId: toExamId, updatedAt: now })
      return n === 1
    },
  }
}

module.exports = { createCloudStore, COL }
