'use strict'

/**
 * 通过 dispatch + 内存数据层跑完整流程，验证处理函数之间的配合
 * （真实云数据库的行为差异见 store/cloud-store.js 顶部说明，这里覆盖不到）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../lib/constants')
const { dispatch } = require('../router')
const { createMemoryStore } = require('./memory-store')

const T0 = 1_700_000_000_000

function seed() {
  const questions = []
  for (let i = 1; i <= 4; i++) {
    questions.push({ id: `p1-${i}`, subjectId: 's1', sourceId: 'p1', no: i, type: i === 4 ? 'multi' : 'single', stem: `题${i}`, options: ['A', 'B', 'C', 'D'], answer: i === 4 ? [0, 2] : [i % 4], explanation: `解析${i}` })
  }
  return {
    subjects: [{ id: 's1', name: '科目一', shortName: '一', order: 1 }, { id: 's2', name: '科目二', shortName: '二', order: 2 }],
    sources: [{ id: 'p1', subjectId: 's1', title: '2020 真题', kind: 'exam', questionCount: 4, subjectiveCount: 1, order: 1 }],
    questions,
    subjective: [{ id: 'p1-s1', subjectId: 's1', sourceId: 'p1', kind: 'case', title: '案例一', stem: '题干', answer: '答案', hasAnswer: true, order: 1 }],
    materials: [{ id: 'm1', subjectId: 's1', category: '笔记', categoryOrder: 0, title: '笔记一', chars: 10, pageCount: 2, order: 1 }],
    materialPages: [
      { _id: 'm1_p1', materialId: 'm1', page: 1, paras: ['第一页'] },
      { _id: 'm1_p2', materialId: 'm1', page: 2, paras: ['第二页'] },
    ],
  }
}

function client(store, openid) {
  let now = T0
  let seq = 0
  const call = (action, payload) =>
    dispatch({ action, payload, openid, store, now, newId: () => `exam${String(++seq).padStart(6, '0')}`, logger: { error() {} } })
  return {
    call,
    async ok(action, payload) {
      const r = await call(action, payload)
      assert.equal(r.ok, true, `${action} 失败：${r.code} ${r.message}`)
      return r.data
    },
    setNow(t) {
      now = t
    },
  }
}

test('未知 action、缺身份、非法参数、内部异常都返回 ok:false', async () => {
  const store = createMemoryStore(seed())
  const c = client(store, 'u1')
  assert.deepEqual((await c.call('nope')).code, 'UNKNOWN_ACTION')
  assert.deepEqual((await c.call('__proto__')).code, 'UNKNOWN_ACTION')
  assert.equal((await dispatch({ action: 'login', openid: '', store })).code, 'UNAUTHENTICATED')
  assert.equal((await c.call('bank.random', { subjectId: 's1', count: 1000 })).code, 'INVALID_ARGUMENT')
  const broken = Object.assign({}, store, {
    getUser: async () => {
      throw new Error('db down')
    },
  })
  const r = await dispatch({ action: 'login', openid: 'u1', store: broken, logger: { error() {} } })
  assert.deepEqual(r, { ok: false, code: 'INTERNAL', message: '服务暂时不可用，请稍后重试' })
})

test('登录：并发首登只建一个用户，积分为 0；改昵称会去空白', async () => {
  const store = createMemoryStore(seed())
  const c = client(store, 'u1')
  const [a, b] = await Promise.all([c.ok('login'), c.ok('login')])
  assert.equal(store.tables.users.size, 1)
  assert.equal(a.points, 0)
  assert.equal(a.isNew !== b.isNew, true)
  const u = await c.ok('updateProfile', { nickname: '  学员 ' })
  assert.equal(u.nickname, '学员')
})

test('题库：索引、资料分页、页码越界', async () => {
  const c = client(createMemoryStore(seed()), 'u1')
  const idx = await c.ok('bank.index')
  assert.equal(idx.subjects.length, 2)
  assert.deepEqual(idx.categories, ['笔记'])
  assert.equal(idx.materials[0].pageCount, 2)
  const p2 = await c.ok('bank.materialPage', { materialId: 'm1', page: 2 })
  assert.deepEqual(p2.paras, ['第二页'])
  assert.equal((await c.call('bank.materialPage', { materialId: 'm1', page: 3 })).code, 'NOT_FOUND')
  const qs = await c.ok('bank.questionsByIds', { ids: ['p1-2', 'p1-1', 'missing'] })
  assert.deepEqual(qs.map((q) => q.id), ['p1-2', 'p1-1'])
})

test('练习提交：服务端判分、错题本、批次去重、统计、收藏', async () => {
  const store = createMemoryStore(seed())
  const c = client(store, 'u1')
  // p1-1 正确答案 [1]，p1-4 正确答案 [0,2]
  const r = await c.ok('progress.submit', {
    batchId: 'batch0001',
    items: [
      { questionId: 'p1-1', answer: [0] },
      { questionId: 'p1-4', answer: [2, 0] },
    ],
  })
  assert.deepEqual(r.results, [
    { questionId: 'p1-1', correct: false },
    { questionId: 'p1-4', correct: true },
  ])
  const again = await c.ok('progress.submit', { batchId: 'batch0001', items: [{ questionId: 'p1-1', answer: [0] }] })
  assert.equal(again.duplicate, true)
  assert.equal(store.tables.records.get('u1_p1-1').count, 1)

  await c.ok('progress.setFavorite', { questionId: 'p1-3', favorite: true })
  const sum = await c.ok('progress.summary', { subjectId: 's1' })
  assert.equal(sum.done, 2)
  assert.equal(sum.attempts, 2)
  assert.equal(sum.correct, 1)
  assert.equal(sum.wrongCount, 1)
  assert.equal(sum.favoriteCount, 1)

  const wrong = await c.ok('progress.wrongList', { subjectId: 's1' })
  assert.deepEqual(wrong.items, [{ questionId: 'p1-1', sourceId: 'p1', subjectId: 's1' }])
  await c.ok('progress.removeWrong', { questionId: 'p1-1' })
  assert.equal((await c.ok('progress.wrongList', { subjectId: 's1' })).total, 0)
  // 取消一道从没收藏过、也没做过的题，不会新建记录
  await c.ok('progress.setFavorite', { questionId: 'p1-2', favorite: false })
  assert.equal(store.tables.records.has('u1_p1-2'), false)

  // 别的用户看不到这些记录
  const other = client(store, 'u2')
  assert.equal((await other.ok('progress.summary', { subjectId: 's1' })).attempts, 0)

  await c.ok('progress.setMastered', { subjectiveId: 'p1-s1', mastered: true })
  assert.deepEqual((await c.ok('login')).mastered, ['p1-s1'])
})

test('考试：下发不带答案；重复开考返回同一场；并发开考只有一场 running', async () => {
  const store = createMemoryStore(seed())
  const c = client(store, 'u1')
  const results = await Promise.all([
    c.ok('exam.start', { subjectId: 's1', mode: 'paper', sourceId: 'p1' }),
    c.ok('exam.start', { subjectId: 's1', mode: 'paper', sourceId: 'p1' }),
    c.ok('exam.start', { subjectId: 's1', mode: 'random' }),
  ])
  const ids = new Set(results.map((r) => r.exam.id))
  assert.equal(ids.size, 1)
  const running = Array.from(store.tables.exams.values()).filter((e) => e.status === 'running')
  assert.equal(running.length, 1)
  const exam = results[0].exam
  assert.equal(exam.questions.length, 4)
  exam.questions.forEach((q) => {
    assert.equal('answer' in q, false)
    assert.equal('explanation' in q, false)
  })
  const again = await c.ok('exam.start', { subjectId: 's1', mode: 'random' })
  assert.equal(again.resumed, true)
  assert.equal(again.exam.id, exam.id)
  // 进行中不能看答案
  assert.equal((await c.call('exam.result', { examId: exam.id })).code, 'INVALID_ARGUMENT')
  // 别人拿不到这场考试
  assert.equal((await client(store, 'u2').call('exam.save', { examId: exam.id, answers: {} })).code, 'NOT_FOUND')
})

test('考试：保存后中途退出再回来能取回作答；截止后不能保存；宽限内交卷有效；重复交卷不重复计数', async () => {
  const store = createMemoryStore(seed())
  const c = client(store, 'u1')
  const { exam } = await c.ok('exam.start', { subjectId: 's1', mode: 'paper', sourceId: 'p1' })
  c.setNow(T0 + 60_000)
  await c.ok('exam.save', { examId: exam.id, answers: { 'p1-1': [1], 'p1-2': [0] } })
  const cur = await c.ok('exam.current')
  assert.deepEqual(cur.exam.answers, { 'p1-1': [1], 'p1-2': [0], 'p1-3': [], 'p1-4': [] })

  c.setNow(exam.deadline + 1)
  assert.equal((await c.call('exam.save', { examId: exam.id, answers: { 'p1-3': [3] } })).code, 'EXAM_CLOSED')

  c.setNow(exam.deadline + C.EXAM_GRACE_MS)
  const [r1, r2] = await Promise.all([
    c.ok('exam.submit', { examId: exam.id, answers: { 'p1-3': [3], 'p1-4': [2, 0] }, auto: true }),
    c.ok('exam.submit', { examId: exam.id, answers: { 'p1-3': [3], 'p1-4': [2, 0] }, auto: true }),
  ])
  assert.equal(r1.correctCount, 3) // p1-1、p1-3、p1-4 对，p1-2 错
  assert.equal(r1.timedOut, false)
  assert.equal(r1.score, r2.score)
  assert.equal([r1.duplicate, r2.duplicate].filter(Boolean).length, 1)
  assert.equal(store.tables.records.get('u1_p1-1').count, 1)
  assert.equal(store.tables.records.get('u1_p1-2').wrong, true)

  const detail = await c.ok('exam.result', { examId: exam.id })
  assert.deepEqual(detail.questions[0].answer, [1])
  assert.equal(detail.items.length, 4)
  const hist = await c.ok('exam.history', {})
  assert.equal(hist.total, 1)
  assert.equal('items' in hist.items[0], false)
  // 交卷后可以开新考试
  const next = await c.ok('exam.start', { subjectId: 's1', mode: 'random' })
  assert.equal(next.resumed, false)
  assert.notEqual(next.exam.id, exam.id)
})

test('考试：过了宽限再交卷按已保存作答结算并标记超时；未作答的题不进错题本', async () => {
  const store = createMemoryStore(seed())
  const c = client(store, 'u1')
  const { exam } = await c.ok('exam.start', { subjectId: 's1', mode: 'paper', sourceId: 'p1' })
  await c.ok('exam.save', { examId: exam.id, answers: { 'p1-1': [0] } })
  c.setNow(exam.deadline + C.EXAM_GRACE_MS + 1)
  const r = await c.ok('exam.submit', { examId: exam.id, answers: { 'p1-1': [1], 'p1-2': [2] } })
  assert.equal(r.timedOut, true)
  assert.equal(r.correctCount, 0)
  assert.equal(store.tables.records.get('u1_p1-1').wrong, true)
  assert.equal(store.tables.records.has('u1_p1-2'), false)
})

test('考试：过期未交卷的考试在 exam.current 时自动结算；放弃的考试不计成绩', async () => {
  const store = createMemoryStore(seed())
  const c = client(store, 'u1')
  const { exam } = await c.ok('exam.start', { subjectId: 's1', mode: 'paper', sourceId: 'p1' })
  c.setNow(exam.deadline + C.EXAM_GRACE_MS + 10)
  const cur = await c.ok('exam.current')
  assert.equal(cur.exam, null)
  assert.equal(cur.settled.id, exam.id)
  assert.equal(cur.settled.timedOut, true)

  const second = (await c.ok('exam.start', { subjectId: 's1', mode: 'random' })).exam
  await c.ok('exam.abandon', { examId: second.id })
  assert.equal((await c.call('exam.submit', { examId: second.id })).code, 'EXAM_CLOSED')
  assert.equal((await c.ok('exam.history', {})).total, 1)
  assert.equal((await c.ok('exam.current')).exam, null)
})
