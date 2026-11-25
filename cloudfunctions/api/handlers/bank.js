'use strict'

const C = require('../lib/constants')
const V = require('../lib/validate')
const { notFound } = require('../lib/errors')
const { publicQuestion, orderByIds } = require('../lib/sanitize')

/** 题库目录变化很少，在函数实例里缓存 5 分钟 */
const INDEX_TTL_MS = 5 * 60 * 1000
const indexCache = new WeakMap()

function byOrder(a, b) {
  return (a.order || 0) - (b.order || 0)
}

async function index(ctx) {
  const hit = indexCache.get(ctx.store)
  if (hit && ctx.now - hit.at < INDEX_TTL_MS) return hit.data
  const [subjects, sources, subjective, materials] = await Promise.all([
    ctx.store.listSubjects(),
    ctx.store.listSources(),
    ctx.store.listSubjectiveMeta(),
    ctx.store.listMaterials(),
  ])
  const sortedMaterials = materials.slice().sort(byOrder)
  const categories = []
  sortedMaterials
    .slice()
    .sort((a, b) => (a.categoryOrder || 0) - (b.categoryOrder || 0))
    .forEach((m) => {
      if (categories.indexOf(m.category) < 0) categories.push(m.category)
    })
  const data = {
    subjects: subjects.sort(byOrder).map((s) => ({
      id: s.id,
      name: s.name,
      shortName: s.shortName,
      description: s.description || '',
    })),
    categories,
    sources: sources.sort(byOrder).map((s) => ({
      id: s.id,
      subjectId: s.subjectId,
      title: s.title,
      kind: s.kind,
      questionCount: s.questionCount || 0,
      subjectiveCount: s.subjectiveCount || 0,
    })),
    subjective: subjective.sort(byOrder).map((s) => ({
      id: s.id,
      subjectId: s.subjectId,
      sourceId: s.sourceId,
      kind: s.kind,
      title: s.title,
      hasAnswer: !!s.hasAnswer,
    })),
    materials: sortedMaterials.map((m) => ({
      id: m.id,
      subjectId: m.subjectId,
      category: m.category,
      title: m.title,
      chars: m.chars || 0,
      pageCount: m.pageCount || 0,
    })),
  }
  indexCache.set(ctx.store, { at: ctx.now, data })
  return data
}

async function questions(ctx) {
  const p = V.payloadObject(ctx.payload)
  const sourceId = V.id(p.sourceId, 'sourceId')
  const list = await ctx.store.getQuestionsBySource(sourceId)
  return list.sort((a, b) => a.no - b.no).map(publicQuestion)
}

async function questionsByIds(ctx) {
  const p = V.payloadObject(ctx.payload)
  const ids = V.idList(p.ids, 'ids', C.BY_IDS_MAX)
  const list = await ctx.store.getQuestionsByIds(ids)
  return orderByIds(ids, list).map(publicQuestion)
}

async function random(ctx) {
  const p = V.payloadObject(ctx.payload)
  const subjectId = V.id(p.subjectId, 'subjectId')
  const count = V.int(p.count, 'count', { min: 1, max: C.RANDOM_MAX, default: 30 })
  const list = await ctx.store.sampleQuestions(subjectId, count)
  return list.map(publicQuestion)
}

async function subjective(ctx) {
  const p = V.payloadObject(ctx.payload)
  const id = V.id(p.id, 'id')
  const item = await ctx.store.getSubjective(id)
  if (!item) throw notFound('没有找到这道主观题')
  return {
    id: item.id,
    subjectId: item.subjectId,
    sourceId: item.sourceId,
    kind: item.kind,
    title: item.title,
    stem: item.stem || '',
    answer: item.answer || '',
  }
}

async function materialPage(ctx) {
  const p = V.payloadObject(ctx.payload)
  const materialId = V.id(p.materialId, 'materialId')
  const page = V.int(p.page, 'page', { min: 1, max: C.MATERIAL_PAGE_MAX })
  const meta = await ctx.store.getMaterial(materialId)
  if (!meta) throw notFound('没有找到这份资料')
  if (page > (meta.pageCount || 0)) throw notFound('页码超出范围')
  const doc = await ctx.store.getMaterialPage(materialId, page)
  if (!doc) throw notFound('没有找到这一页')
  return {
    materialId,
    title: meta.title,
    page,
    pageCount: meta.pageCount || 0,
    paras: Array.isArray(doc.paras) ? doc.paras : [],
  }
}

module.exports = { index, questions, questionsByIds, random, subjective, materialPage }
