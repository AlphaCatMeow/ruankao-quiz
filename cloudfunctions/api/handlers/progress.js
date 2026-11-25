'use strict'

const C = require('../lib/constants')
const V = require('../lib/validate')
const { notFound } = require('../lib/errors')
const { aggregateAnswers, recordChanges, newRecord, recordId, flagRecord } = require('../lib/records')
const { buildSummary } = require('../lib/summary')
const { ensureUser } = require('./user')

/**
 * 把作答写入 answer_records（服务端重新判对错）。练习提交和考试交卷共用。
 * questions 可传入已取到的带答案题目，省一次查询。
 */
async function writeAnswers(ctx, items, questions) {
  let list = questions
  if (!list) {
    const ids = Array.from(new Set(items.map((x) => x.questionId)))
    list = ids.length > 0 ? await ctx.store.getQuestionsByIds(ids) : []
  }
  const byId = new Map(list.map((q) => [q.id || q._id, q]))
  const agg = aggregateAnswers(items, byId)
  await Promise.all(
    agg.updates.map((u) =>
      ctx.store.upsertRecord(recordId(ctx.openid, u.questionId), recordChanges(u, ctx.now), newRecord(ctx.openid, u, ctx.now)),
    ),
  )
  return agg
}

async function submit(ctx) {
  const p = V.payloadObject(ctx.payload)
  const batchId = V.token(p.batchId, 'batchId', true)
  const items = V.submitItems(p.items)
  // 客户端离线重试时带同一个 batchId，已处理过的批次直接返回
  if (batchId && (await ctx.store.hasBatch(ctx.openid, batchId))) {
    return { duplicate: true, results: [], unknown: [] }
  }
  const agg = await writeAnswers(ctx, items)
  if (batchId) await ctx.store.addBatch(ctx.openid, batchId, ctx.now)
  return { duplicate: false, results: agg.results, unknown: agg.unknown }
}

async function summary(ctx) {
  const p = V.payloadObject(ctx.payload)
  const subjectId = V.id(p.subjectId, 'subjectId')
  const groups = await ctx.store.summaryGroups(ctx.openid, subjectId)
  return buildSummary(subjectId, groups)
}

function listOf(flag) {
  return async (ctx) => {
    const p = V.payloadObject(ctx.payload)
    const subjectId = V.id(p.subjectId, 'subjectId', true)
    const sourceId = V.id(p.sourceId, 'sourceId', true)
    const { page, pageSize, skip } = V.paging(p)
    const res = await ctx.store.listRecords(ctx.openid, { flag, subjectId, sourceId }, skip, pageSize)
    return {
      items: res.items.map((r) => ({ questionId: r.questionId, sourceId: r.sourceId, subjectId: r.subjectId })),
      total: res.total,
      page,
      pageSize,
      hasMore: skip + res.items.length < res.total,
    }
  }
}

async function setFavorite(ctx) {
  const p = V.payloadObject(ctx.payload)
  const questionId = V.id(p.questionId, 'questionId')
  const favorite = V.bool(p.favorite, 'favorite')
  const q = await ctx.store.getQuestion(questionId)
  if (!q) throw notFound('没有找到这道题')
  const set = { favorite, favoriteAt: ctx.now }
  await ctx.store.upsertRecord(
    recordId(ctx.openid, questionId),
    { inc: {}, set },
    favorite ? flagRecord(ctx.openid, q, set, ctx.now) : null,
  )
  return { questionId, favorite }
}

async function removeWrong(ctx) {
  const p = V.payloadObject(ctx.payload)
  const questionId = V.id(p.questionId, 'questionId')
  await ctx.store.upsertRecord(recordId(ctx.openid, questionId), { inc: {}, set: { wrong: false } }, null)
  return { questionId }
}

async function clearWrong(ctx) {
  const p = V.payloadObject(ctx.payload)
  const subjectId = V.id(p.subjectId, 'subjectId')
  const sourceId = V.id(p.sourceId, 'sourceId', true)
  const cleared = await ctx.store.clearWrongFlags(ctx.openid, subjectId, sourceId)
  return { cleared }
}

async function setMastered(ctx) {
  const p = V.payloadObject(ctx.payload)
  const id = V.id(p.subjectiveId, 'subjectiveId')
  const mastered = V.bool(p.mastered, 'mastered')
  const item = await ctx.store.getSubjective(id)
  if (!item) throw notFound('没有找到这道主观题')
  await ensureUser(ctx)
  if (mastered) await ctx.store.addMastered(ctx.openid, id)
  else await ctx.store.removeMastered(ctx.openid, id)
  return { subjectiveId: id, mastered }
}

module.exports = {
  writeAnswers,
  submit,
  summary,
  wrongList: listOf('wrong'),
  favoriteList: listOf('favorite'),
  setFavorite,
  removeWrong,
  clearWrong,
  setMastered,
  SUBMIT_MAX: C.SUBMIT_MAX,
}
