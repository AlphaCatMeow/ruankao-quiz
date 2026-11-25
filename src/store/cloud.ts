/**
 * 微信云开发调用封装：wx.cloud.init、统一的 callApi、启动时静默登录。
 * 只在云模式（CLOUD_MODE 为 true）下使用。
 */
import { CLOUD_ENV_ID } from '@/config'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const wx: any

function detectCloudMode(): boolean {
  let on = false
  // #ifdef MP-WEIXIN
  on = CLOUD_ENV_ID !== ''
  // #endif
  return on
}

/** 云模式：环境 ID 非空且运行在微信小程序 */
export const CLOUD_MODE = detectCloudMode()

/** 云函数名 */
const FUNCTION_NAME = 'api'

/** 云函数或网络返回的错误。code 为 NETWORK 时表示没有连上服务 */
export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'NETWORK'
}

/** login 返回的用户信息 */
export interface CloudUser {
  nickname: string
  avatar: string
  points: number
  totalRecharged: number
  createdAt: number
  mastered: string[]
  isNew?: boolean
  serverNow?: number
}

function errMsg(err: unknown): string {
  if (!err) return '未知错误'
  if (typeof err === 'string') return err
  const e = err as { errMsg?: string; message?: string }
  return e.errMsg || e.message || JSON.stringify(err)
}

let cloudReady = false

function ensureCloud(): void {
  if (cloudReady) return
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.init !== 'function') {
    throw new ApiError('UNSUPPORTED', '当前微信版本不支持云开发，请升级微信后重试')
  }
  wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true })
  cloudReady = true
}

function rawCall<T>(action: string, payload?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    wx.cloud.callFunction({
      name: FUNCTION_NAME,
      data: { action, payload: payload === undefined ? {} : payload },
      success: (res: { result?: { ok?: boolean; data?: T; code?: string; message?: string } }) => {
        const r = res ? res.result : undefined
        if (!r || typeof r !== 'object') {
          reject(new ApiError('BAD_RESPONSE', '服务返回格式错误'))
        } else if (r.ok) {
          resolve(r.data as T)
        } else {
          reject(new ApiError(r.code || 'UNKNOWN', r.message || '请求失败'))
        }
      },
      fail: (err: unknown) => {
        reject(new ApiError('NETWORK', `网络连接失败，请稍后重试（${errMsg(err)}）`))
      },
    })
  })
}

let loginTask: Promise<CloudUser> | null = null

/** 静默登录（首次自动建用户）。成功后复用结果，失败后下次调用重试 */
export function login(): Promise<CloudUser> {
  if (!loginTask) {
    loginTask = Promise.resolve()
      .then(() => {
        ensureCloud()
        return rawCall<CloudUser>('login')
      })
      .catch((err) => {
        loginTask = null
        throw err
      })
  }
  return loginTask
}

/** 重新登录，取最新的用户信息（积分等） */
export function relogin(): Promise<CloudUser> {
  loginTask = null
  return login()
}

/** 调用云函数 api 的某个 action。除 login 外都先确保已登录 */
export async function callApi<T>(action: string, payload?: unknown): Promise<T> {
  ensureCloud()
  if (action !== 'login') await login()
  return rawCall<T>(action, payload)
}
