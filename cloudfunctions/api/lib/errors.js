'use strict'

/** 业务错误：code 返回给前端，message 可直接展示 */
class AppError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AppError'
    this.code = code
  }
}

const CODES = {
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  NOT_FOUND: 'NOT_FOUND',
  EXAM_CLOSED: 'EXAM_CLOSED',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL',
}

function invalid(message) {
  return new AppError(CODES.INVALID_ARGUMENT, message)
}

function notFound(message) {
  return new AppError(CODES.NOT_FOUND, message)
}

function ok(data) {
  return { ok: true, data: data === undefined ? null : data }
}

function fail(code, message) {
  return { ok: false, code, message }
}

module.exports = { AppError, CODES, invalid, notFound, ok, fail }
