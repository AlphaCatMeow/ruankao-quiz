/**
 * 按需读取分包 static 目录下的题库 JSON，带内存缓存。
 *
 * - H5：uni.request 取静态文件。构建后访问路径为 BASE_URL + chunk.path；开发时为 /src/ + chunk.path（见 h5DataUrl）。
 * - 微信小程序：先 wx.loadSubpackage 加载数据所在分包，再用文件系统管理器读代码包内文件。
 * - APP：读安装包内 _www 目录下的文件。
 */
import type { ChunkRef } from '@/types'

const cache: Record<string, unknown> = {}
const pending: Record<string, Promise<unknown> | undefined> = {}

/** 读取一个数据块，同一块只读一次 */
export function loadJson<T>(chunk: ChunkRef): Promise<T> {
  const key = chunk.path
  if (Object.prototype.hasOwnProperty.call(cache, key)) return Promise.resolve(cache[key] as T)
  const running = pending[key]
  if (running) return running as Promise<T>
  const task = readChunk(chunk).then(
    (data) => {
      cache[key] = data
      pending[key] = undefined
      return data
    },
    (err) => {
      pending[key] = undefined
      throw err
    },
  )
  pending[key] = task
  return task as Promise<T>
}

/** 数据块是否已在内存中 */
export function isChunkCached(chunk: ChunkRef): boolean {
  return Object.prototype.hasOwnProperty.call(cache, chunk.path)
}

function parse(raw: unknown, path: string): unknown {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch (err) {
      throw new Error(`数据文件格式错误：${path}`)
    }
  }
  throw new Error(`数据文件为空：${path}`)
}

function errMsg(err: unknown): string {
  if (!err) return '未知错误'
  if (typeof err === 'string') return err
  const e = err as { errMsg?: string; message?: string; code?: number }
  return e.errMsg || e.message || (e.code !== undefined ? `code ${e.code}` : JSON.stringify(err))
}

function readChunk(chunk: ChunkRef): Promise<unknown> {
  // #ifdef H5
  return readByRequest(chunk)
  // #endif
  // #ifdef MP-WEIXIN
  return readMpWeixin(chunk)
  // #endif
  // #ifdef APP-PLUS
  return readAppPlus(chunk)
  // #endif
  // #ifndef H5 || MP-WEIXIN || APP-PLUS
  return Promise.reject(new Error('当前平台暂不支持读取题库数据'))
  // #endif
}

/* ---------- H5 ---------- */

// #ifdef H5
/**
 * 构建产物里分包 static 被复制到 <BASE_URL><root>/static/。
 * dev server 的 uni 静态中间件只处理 /static/**，不处理分包 static；
 * 但 Vite 的根目录是项目根，src 下的文件可按 /src/... 原样取到，所以开发时走 /src/ 前缀。
 */
function h5DataUrl(chunk: ChunkRef): string {
  if (import.meta.env.DEV) return `/src/${chunk.path}`
  let base = import.meta.env.BASE_URL || '/'
  if (!base.endsWith('/')) base += '/'
  return base + chunk.path
}

function readByRequest(chunk: ChunkRef): Promise<unknown> {
  const url = h5DataUrl(chunk)
  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method: 'GET',
      dataType: 'json',
      success: (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`读取数据失败（HTTP ${res.statusCode}）：${url}`))
          return
        }
        try {
          resolve(parse(res.data, url))
        } catch (err) {
          reject(err)
        }
      },
      fail: (err) => reject(new Error(`读取数据失败：${errMsg(err)}`)),
    })
  })
}
// #endif

/* ---------- 微信小程序 ---------- */

// #ifdef MP-WEIXIN
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const wx: any

const subpackageTasks: Record<string, Promise<void> | undefined> = {}

function ensureSubpackage(name: string): Promise<void> {
  const existing = subpackageTasks[name]
  if (existing) return existing
  const task = new Promise<void>((resolve, reject) => {
    if (typeof wx === 'undefined' || typeof wx.loadSubpackage !== 'function') {
      // 基础库过低时没有该接口，分包会在进入其页面时才可用
      reject(new Error('当前微信版本不支持按需加载分包，请升级微信后重试'))
      return
    }
    wx.loadSubpackage({
      name,
      success: () => resolve(),
      fail: (err: unknown) => reject(new Error(`加载数据分包 ${name} 失败：${errMsg(err)}`)),
    })
  })
  subpackageTasks[name] = task
  // 失败后允许重试
  task.catch(() => {
    subpackageTasks[name] = undefined
  })
  return task
}

function readPackageFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'utf8',
      success: (res: { data: string }) => resolve(res.data),
      fail: (err: unknown) => reject(err),
    })
  })
}

async function readMpWeixin(chunk: ChunkRef): Promise<unknown> {
  await ensureSubpackage(chunk.pkg)
  let text: string
  try {
    // 代码包文件用以 / 开头的绝对路径访问
    text = await readPackageFile(`/${chunk.path}`)
  } catch (first) {
    try {
      text = await readPackageFile(chunk.path)
    } catch (second) {
      throw new Error(`读取数据失败：${errMsg(first)}`)
    }
  }
  return parse(text, chunk.path)
}
// #endif

/* ---------- APP ---------- */

// #ifdef APP-PLUS
function readAppPlus(chunk: ChunkRef): Promise<unknown> {
  const url = `_www/${chunk.path}`
  return new Promise((resolve, reject) => {
    const onError = (err: unknown) => reject(new Error(`读取数据失败：${errMsg(err)}`))
    plus.io.resolveLocalFileSystemURL(
      url,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (entry: any) => {
        entry.file(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (file: any) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const reader: any = new plus.io.FileReader()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            reader.onloadend = (e: any) => {
              try {
                resolve(parse(e && e.target ? e.target.result : reader.result, url))
              } catch (err) {
                reject(err)
              }
            }
            reader.onerror = onError
            reader.readAsText(file, 'utf-8')
          },
          onError,
        )
      },
      onError,
    )
  })
}
// #endif
