'use strict'

const C = require('./constants')
const { invalid } = require('./errors')

/** 题目、题集、资料等 id：字母数字、下划线、连字符 */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** 考试 id、批次 id */
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** 入参必须是对象；缺省视为空对象 */
function payloadObject(payload) {
  if (payload === undefined || payload === null) return {}
  if (!isPlainObject(payload)) throw invalid('参数格式错误')
  return payload
}

function id(v, name, optional) {
  if (optional && (v === undefined || v === null || v === '')) return ''
  if (typeof v !== 'string' || !ID_RE.test(v)) throw invalid(`${name} 格式错误`)
  return v
}

function token(v, name, optional) {
  if (optional && (v === undefined || v === null || v === '')) return ''
  if (typeof v !== 'string' || !TOKEN_RE.test(v)) throw invalid(`${name} 格式错误`)
  return v
}

function int(v, name, opts) {
  const o = opts || {}
  if (v === undefined || v === null) {
    if (o.default !== undefined) return o.default
    throw invalid(`缺少 ${name}`)
  }
  if (!Number.isInteger(v)) throw invalid(`${name} 必须是整数`)
  if (o.min !== undefined && v < o.min) throw invalid(`${name} 不能小于 ${o.min}`)
  if (o.max !== undefined && v > o.max) throw invalid(`${name} 不能大于 ${o.max}`)
  return v
}

function bool(v, name) {
  if (typeof v !== 'boolean') throw invalid(`${name} 必须是 true 或 false`)
  return v
}

function oneOf(v, name, list) {
  if (list.indexOf(v) < 0) throw invalid(`${name} 取值错误`)
  return v
}

/**
 * 作答：选项下标数组，整数、不重复、在 [0, OPTION_MAX) 内。
 * allowEmpty 为 true 时允许空数组（考试中未作答）。
 */
function answer(v, name, allowEmpty) {
  if (!Array.isArray(v)) throw invalid(`${name} 必须是数组`)
  if (v.length === 0 && !allowEmpty) throw invalid(`${name} 不能为空`)
  if (v.length > C.OPTION_MAX) throw invalid(`${name} 选项过多`)
  const seen = new Set()
  for (const x of v) {
    if (!Number.isInteger(x) || x < 0 || x >= C.OPTION_MAX) throw invalid(`${name} 含有非法选项`)
    if (seen.has(x)) throw invalid(`${name} 含有重复选项`)
    seen.add(x)
  }
  return v.slice().sort((a, b) => a - b)
}

/** id 列表：非空、去重后不超过 max 条 */
function idList(v, name, max) {
  if (!Array.isArray(v) || v.length === 0) throw invalid(`${name} 必须是非空数组`)
  if (v.length > max) throw invalid(`${name} 一次最多 ${max} 条`)
  const out = []
  const seen = new Set()
  for (const x of v) {
    const s = id(x, name)
    if (!seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

/** 练习批量提交：[{ questionId, answer }]，1..SUBMIT_MAX 条，作答不能为空 */
function submitItems(v) {
  if (!Array.isArray(v) || v.length === 0) throw invalid('items 必须是非空数组')
  if (v.length > C.SUBMIT_MAX) throw invalid(`items 一次最多 ${C.SUBMIT_MAX} 条`)
  return v.map((item, i) => {
    if (!isPlainObject(item)) throw invalid(`items[${i}] 格式错误`)
    return {
      questionId: id(item.questionId, `items[${i}].questionId`),
      answer: answer(item.answer, `items[${i}].answer`, false),
    }
  })
}

/**
 * 考试作答：{ 题目id: 选项数组 }。只保留 allowedIds 里的题，未知题 id 忽略。
 * 返回 Map(questionId -> answer)。
 */
function answerMap(v, allowedIds) {
  if (v === undefined || v === null) return new Map()
  if (!isPlainObject(v)) throw invalid('answers 格式错误')
  const allowed = new Set(allowedIds)
  const keys = Object.keys(v)
  if (keys.length > allowed.size + 20) throw invalid('answers 条数过多')
  const out = new Map()
  for (const k of keys) {
    if (!allowed.has(k)) continue
    out.set(k, answer(v[k], `answers.${k}`, true))
  }
  return out
}

/** 昵称：去首尾空白，1..NICKNAME_MAX 个字符，不含控制字符 */
function nickname(v) {
  if (typeof v !== 'string') throw invalid('昵称必须是文字')
  const s = v.trim()
  const len = Array.from(s).length
  if (len === 0) throw invalid('昵称不能为空')
  if (len > C.NICKNAME_MAX) throw invalid(`昵称最多 ${C.NICKNAME_MAX} 个字`)
  if (CONTROL_RE.test(s)) throw invalid('昵称含有不支持的字符')
  return s
}

/** 分页：page 从 1 开始，pageSize 默认 20，上限 PAGE_SIZE_MAX */
function paging(p) {
  const page = int(p.page, 'page', { min: 1, max: 100000, default: 1 })
  const pageSize = int(p.pageSize, 'pageSize', { min: 1, max: C.PAGE_SIZE_MAX, default: 20 })
  return { page, pageSize, skip: (page - 1) * pageSize }
}

module.exports = {
  ID_RE,
  payloadObject,
  id,
  token,
  int,
  bool,
  oneOf,
  answer,
  idList,
  submitItems,
  answerMap,
  nickname,
  paging,
}
