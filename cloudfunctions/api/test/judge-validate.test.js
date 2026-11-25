'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { isCorrect, normalizeAnswer } = require('../lib/judge')
const V = require('../lib/validate')
const { stripAnswer, publicQuestion } = require('../lib/sanitize')
const { AppError } = require('../lib/errors')

const isInvalid = (fn) => assert.throws(fn, (e) => e instanceof AppError && e.code === 'INVALID_ARGUMENT')

test('判对错：多选顺序无关，漏选、多选、空作答都算错', () => {
  assert.equal(isCorrect([2, 0], [0, 2]), true)
  assert.equal(isCorrect([0], [0, 2]), false)
  assert.equal(isCorrect([0, 1, 2], [0, 2]), false)
  assert.equal(isCorrect([], [0]), false)
  assert.equal(isCorrect(undefined, [0]), false)
  assert.equal(isCorrect([1], [1]), true)
  // 重复选项按集合处理
  assert.equal(isCorrect([2, 2, 0], [0, 2]), true)
})

test('normalizeAnswer 丢弃非整数和负数', () => {
  assert.deepEqual(normalizeAnswer([3, '1', -1, 1.5, 0, 3]), [0, 3])
  assert.deepEqual(normalizeAnswer('0'), [])
})

test('submitItems：类型、数量上限、作答合法性', () => {
  assert.deepEqual(V.submitItems([{ questionId: 'gao-2018a-1', answer: [2, 0] }]), [
    { questionId: 'gao-2018a-1', answer: [0, 2] },
  ])
  isInvalid(() => V.submitItems([]))
  isInvalid(() => V.submitItems('x'))
  isInvalid(() => V.submitItems(Array.from({ length: 101 }, () => ({ questionId: 'a', answer: [0] }))))
  isInvalid(() => V.submitItems([{ questionId: 'a', answer: [] }]))
  isInvalid(() => V.submitItems([{ questionId: 'a', answer: [0, 0] }]))
  isInvalid(() => V.submitItems([{ questionId: 'a', answer: [10] }]))
  isInvalid(() => V.submitItems([{ questionId: 'a', answer: ['0'] }]))
  isInvalid(() => V.submitItems([{ questionId: 'a/../b', answer: [0] }]))
  isInvalid(() => V.submitItems([{ questionId: { $gt: '' }, answer: [0] }]))
})

test('answerMap 忽略不在考试里的题，允许空作答', () => {
  const m = V.answerMap({ a: [1], b: [], zzz: [0] }, ['a', 'b'])
  assert.deepEqual(Array.from(m.entries()), [
    ['a', [1]],
    ['b', []],
  ])
  isInvalid(() => V.answerMap([], ['a']))
  isInvalid(() => V.answerMap({ a: [99] }, ['a']))
})

test('昵称：去首尾空白，按字符计长度，拒绝空、超长、控制字符', () => {
  assert.equal(V.nickname('  小明 '), '小明')
  assert.equal(V.nickname('😀'.repeat(20)), '😀'.repeat(20))
  isInvalid(() => V.nickname('   '))
  isInvalid(() => V.nickname('a'.repeat(21)))
  isInvalid(() => V.nickname('a\nb'))
  isInvalid(() => V.nickname(123))
})

test('分页和 id 列表边界', () => {
  assert.deepEqual(V.paging({}), { page: 1, pageSize: 20, skip: 0 })
  assert.deepEqual(V.paging({ page: 3, pageSize: 200 }), { page: 3, pageSize: 200, skip: 400 })
  isInvalid(() => V.paging({ pageSize: 201 }))
  isInvalid(() => V.paging({ page: 0 }))
  isInvalid(() => V.paging({ page: 1.5 }))
  assert.deepEqual(V.idList(['a', 'b', 'a'], 'ids', 3), ['a', 'b'])
  isInvalid(() => V.idList(['a', 'b', 'c'], 'ids', 2))
  isInvalid(() => V.payloadObject([1]))
})

test('考试下发的题目不带答案和解析，且不修改原对象', () => {
  const q = { _id: 'x-1', id: 'x-1', subjectId: 's', sourceId: 'x', no: 1, type: 'single', stem: '?', options: ['a', 'b'], answer: [1], explanation: 'e', _openid: 'o' }
  const s = stripAnswer(q)
  assert.equal('answer' in s, false)
  assert.equal('explanation' in s, false)
  assert.deepEqual(q.answer, [1])
  const p = publicQuestion(q)
  assert.equal('_openid' in p, false)
  assert.deepEqual(p.answer, [1])
})
