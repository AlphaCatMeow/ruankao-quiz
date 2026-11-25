'use strict'

/**
 * 按 action 分发。不依赖 wx-server-sdk，测试里注入内存版数据层即可运行。
 * 统一返回 { ok: true, data } 或 { ok: false, code, message }。
 */
const { AppError, CODES, ok, fail } = require('./lib/errors')
const user = require('./handlers/user')
const bank = require('./handlers/bank')
const progress = require('./handlers/progress')
const exam = require('./handlers/exam')

const ACTIONS = {
  login: user.login,
  updateProfile: user.updateProfile,

  'bank.index': bank.index,
  'bank.questions': bank.questions,
  'bank.questionsByIds': bank.questionsByIds,
  'bank.random': bank.random,
  'bank.subjective': bank.subjective,
  'bank.materialPage': bank.materialPage,

  'progress.submit': progress.submit,
  'progress.summary': progress.summary,
  'progress.wrongList': progress.wrongList,
  'progress.favoriteList': progress.favoriteList,
  'progress.setFavorite': progress.setFavorite,
  'progress.removeWrong': progress.removeWrong,
  'progress.clearWrong': progress.clearWrong,
  'progress.setMastered': progress.setMastered,

  'exam.start': exam.start,
  'exam.current': exam.current,
  'exam.save': exam.save,
  'exam.submit': exam.submit,
  'exam.abandon': exam.abandon,
  'exam.history': exam.history,
  'exam.result': exam.result,
}

/**
 * @param {{ action: unknown, payload: unknown, openid: string, store: object, now?: number, newId?: () => string, logger?: Console }} input
 */
async function dispatch(input) {
  const action = input.action
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
    return fail(CODES.UNKNOWN_ACTION, `未知操作：${typeof action === 'string' ? action.slice(0, 40) : String(action)}`)
  }
  if (!input.openid) return fail(CODES.UNAUTHENTICATED, '无法识别用户身份，请在微信内打开')
  const ctx = {
    openid: input.openid,
    payload: input.payload,
    store: input.store,
    now: input.now || Date.now(),
    newId: input.newId,
  }
  try {
    return ok(await ACTIONS[action](ctx))
  } catch (err) {
    if (err instanceof AppError) return fail(err.code, err.message)
    const logger = input.logger || console
    logger.error(`[api] ${action} 失败`, err)
    return fail(CODES.INTERNAL, '服务暂时不可用，请稍后重试')
  }
}

module.exports = { dispatch, ACTIONS }
