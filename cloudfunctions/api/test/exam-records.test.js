'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../lib/constants')
const E = require('../lib/exam')
const R = require('../lib/records')
const { buildSummary, groupRecords } = require('../lib/summary')

const T0 = 1_700_000_000_000
const session = (over) =>
  Object.assign(
    E.newExamSession({ id: 'e1', openid: 'u', subjectId: 's', mode: 'paper', sourceId: 'p', title: 't', questionIds: ['q1', 'q2', 'q3'], now: T0 }),
    over,
  )

test('考试阶段：截止时刻前后、宽限边界', () => {
  const s = session()
  assert.equal(s.deadline, T0 + C.EXAM_DURATION_MS)
  assert.equal(E.examPhase(s, s.deadline), 'running')
  assert.equal(E.examPhase(s, s.deadline + 1), 'grace')
  assert.equal(E.examPhase(s, s.deadline + C.EXAM_GRACE_MS), 'grace')
  assert.equal(E.examPhase(s, s.deadline + C.EXAM_GRACE_MS + 1), 'expired')
  assert.equal(E.examPhase(session({ status: 'finished' }), T0), 'finished')
  assert.equal(E.canSave(s, s.deadline), true)
  assert.equal(E.canSave(s, s.deadline + 1), false)
})

test('交卷判定：宽限内采纳客户端作答，过了宽限按超时', () => {
  const s = session()
  assert.deepEqual(E.decideSubmit(s, s.deadline + C.EXAM_GRACE_MS), { phase: 'grace', acceptClient: true, timedOut: false })
  assert.deepEqual(E.decideSubmit(s, s.deadline + C.EXAM_GRACE_MS + 1), { phase: 'expired', acceptClient: false, timedOut: true })
})

test('作答合并：提交里有的题以提交为准，没有的用已保存的', () => {
  const merged = E.mergeAnswers(['q1', 'q2', 'q3'], [[0], [1], []], new Map([['q2', [3, 2]]]))
  assert.deepEqual(merged, [[0], [2, 3], []])
  assert.deepEqual(E.mergeAnswers(['q1'], undefined, null), [[]])
})

test('结算：多选顺序无关、未作答不得分、缺题不计入总数、超时用时封顶', () => {
  const questions = [
    { id: 'q1', answer: [0, 2] },
    { id: 'q2', answer: [1] },
  ]
  const r = E.settleExam({
    questionIds: ['q1', 'q2', 'q3'],
    questions,
    answers: [[2, 0], [], [0]],
    startAt: T0,
    deadline: T0 + C.EXAM_DURATION_MS,
    now: T0 + C.EXAM_DURATION_MS + 60_000,
    timedOut: true,
    auto: false,
  })
  assert.equal(r.total, 2)
  assert.equal(r.correctCount, 1)
  assert.equal(r.score, 50)
  assert.deepEqual(r.items[1], { questionId: 'q2', userAnswer: [], correct: false })
  assert.equal(r.durationSec, C.EXAM_DURATION_MS / 1000)
  assert.equal(r.timedOut, true)
  assert.equal(r.autoSubmitted, true)
  assert.deepEqual(E.answeredItems(r.items), [{ questionId: 'q1', answer: [0, 2] }])
})

test('结算：没有题时得 0 分而不是 NaN', () => {
  const r = E.settleExam({ questionIds: [], questions: [], answers: [], startAt: T0, deadline: T0 + 1, now: T0, timedOut: false })
  assert.equal(r.score, 0)
})

test('进行中考试视图不含答案', () => {
  const v = E.runningView(session({ answers: [[1], [], []] }), [{ id: 'q1', stem: 's', options: ['a'], answer: [0], explanation: 'x' }], T0)
  assert.equal('answer' in v.questions[0], false)
  assert.deepEqual(v.answers, { q1: [1], q2: [], q3: [] })
})

test('pickRandom 不放回、不超过总数', () => {
  const picked = E.pickRandom([1, 2, 3, 4, 5], 3, () => 0.99)
  assert.equal(new Set(picked).size, 3)
  assert.equal(E.pickRandom([1, 2], 5).length, 2)
})

const Q = new Map([
  ['a', { id: 'a', subjectId: 's', sourceId: 'p', answer: [0, 1] }],
  ['b', { id: 'b', subjectId: 's', sourceId: 'p', answer: [2] }],
])

test('作答汇总：同题多次按次数累计，最后一次为准；空作答和未知题跳过', () => {
  const agg = R.aggregateAnswers(
    [
      { questionId: 'a', answer: [1] },
      { questionId: 'a', answer: [1, 0] },
      { questionId: 'b', answer: [] },
      { questionId: 'zz', answer: [0] },
    ],
    Q,
  )
  assert.deepEqual(agg.unknown, ['zz'])
  assert.equal(agg.updates.length, 1)
  const u = agg.updates[0]
  assert.equal(u.attempts, 2)
  assert.equal(u.corrects, 1)
  assert.equal(u.lastCorrect, true)
  assert.deepEqual(u.lastAnswer, [0, 1])
  assert.equal(u.anyWrong, true)
  assert.deepEqual(agg.results, [
    { questionId: 'a', correct: false },
    { questionId: 'a', correct: true },
  ])
})

test('作答记录：答错进错题本，之后答对不会自动移出；次数累加', () => {
  const now = T0
  const wrong = R.aggregateAnswers([{ questionId: 'b', answer: [1] }], Q).updates[0]
  let doc = R.newRecord('u', wrong, now)
  assert.equal(doc._id, 'u_b')
  assert.equal(doc.wrong, true)
  const right = R.aggregateAnswers([{ questionId: 'b', answer: [2] }], Q).updates[0]
  const changes = R.recordChanges(right, now + 1)
  assert.equal('wrong' in changes.set, false)
  doc = R.applyChanges(doc, changes)
  assert.equal(doc.count, 2)
  assert.equal(doc.correctCount, 1)
  assert.equal(doc.lastCorrect, true)
  assert.equal(doc.wrong, true)
})

test('统计：已做题数只算 count > 0 的记录，收藏未做的题不算已做', () => {
  const groups = groupRecords([
    { sourceId: 'p', count: 2, correctCount: 1, wrong: true, favorite: false },
    { sourceId: 'p', count: 0, correctCount: 0, wrong: false, favorite: true },
    { sourceId: 'x', count: 1, correctCount: 1, wrong: false, favorite: true },
  ])
  const s = buildSummary('s', groups)
  assert.equal(s.done, 2)
  assert.equal(s.attempts, 3)
  assert.equal(s.correct, 2)
  assert.equal(s.wrongCount, 1)
  assert.equal(s.favoriteCount, 2)
  assert.deepEqual(s.sources.p, { done: 1, attempts: 2, correct: 1, wrong: 1, favorite: 1 })
})
