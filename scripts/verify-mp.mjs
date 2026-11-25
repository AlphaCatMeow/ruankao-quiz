// 通过微信开发者工具的自动化端口，实测小程序能否读到分包里的题库数据。
// 前提：开发者工具已登录，并在 设置 → 安全设置 中开启"服务端口"。
// 用法：
//   1) pnpm build:mp-weixin
//   2) "<开发者工具目录>\cli.bat" auto --project <项目>\dist\build\mp-weixin --auto-port 9420
//   3) node scripts/verify-mp.mjs [截图输出目录]
import { readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PORT = process.env.AUTO_PORT || '9420'
const DIST = resolve('dist/build/mp-weixin')
const SHOTS = resolve(process.argv[2] || '.import/mp-verify')
mkdirSync(SHOTS, { recursive: true })

const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
const pending = new Map()
const logs = []
let seq = 0

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { ok, fail } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? fail(new Error(msg.error.message || JSON.stringify(msg.error))) : ok(msg.result)
  } else if (msg.method === 'App.logAdded' || msg.method === 'App.exceptionThrown') {
    logs.push({ type: msg.method, ...msg.params })
  }
})

function call(method, params = {}) {
  const id = `v${++seq}`
  return new Promise((ok, fail) => {
    pending.set(id, { ok, fail })
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        fail(new Error(`超时: ${method}`))
      }
    }, 30000)
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(name) {
  const { data } = await call('App.captureScreenshot')
  const file = join(SHOTS, `${name}.png`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}

async function go(url, name, waitMs = 3000) {
  await call('App.callWxMethod', { method: 'reLaunch', args: [{ url }] })
  await sleep(waitMs)
  const page = await call('App.getCurrentPage')
  const file = await shot(name)
  console.log(`页面 ${page.path} -> ${file}`)
}

// 在小程序里直接读一个分包数据文件，返回字符数和能否解析
function readInApp(pkg, filePath) {
  return new Promise((done) => {
    const read = () => {
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: 'utf8',
        success: (r) => {
          let parsed = false
          try {
            JSON.parse(r.data)
            parsed = true
          } catch (e) {}
          done({ ok: true, chars: r.data.length, parsed })
        },
        fail: (e) => done({ ok: false, step: 'readFile', err: e.errMsg }),
      })
    }
    wx.loadSubpackage({
      name: pkg,
      success: read,
      fail: (e) => done({ ok: false, step: 'loadSubpackage', err: e.errMsg }),
    })
  })
}

function firstJson(dir, base = dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name)
    if (name.isDirectory()) {
      const hit = firstJson(p, base)
      if (hit) return hit
    } else if (name.name.endsWith('.json')) {
      return p
    }
  }
  return null
}

ws.addEventListener('error', () => {
  console.error(`连不上自动化端口 ${PORT}。请先运行 cli auto，并确认开发者工具已开启服务端口。`)
  process.exit(2)
})

ws.addEventListener('open', async () => {
  let failed = 0
  try {
    await call('App.enableLog').catch(() => {})
    const info = await call('App.callWxMethod', { method: 'getSystemInfoSync', args: [] })
    console.log(`基础库 ${info.result?.SDKVersion}，平台 ${info.result?.platform}`)

    for (const pkg of readdirSync(DIST).filter((n) => /^bankpkg\d+$/.test(n))) {
      const staticDir = join(DIST, pkg, 'static')
      const abs = existsSync(staticDir) ? firstJson(staticDir) : null
      if (!abs) {
        console.log(`${pkg}: 无数据文件，跳过`)
        continue
      }
      const rel = abs.slice(DIST.length + 1).replace(/\\/g, '/')
      const r = await call('App.callFunction', {
        functionDeclaration: readInApp.toString(),
        args: [pkg, rel],
      })
      const res = r.result
      console.log(`${pkg}: ${rel} -> ${JSON.stringify(res)}`)
      if (!res?.ok || !res.parsed) failed++
    }

    await go('/pages/index/index', '1-home')
    await go('/pages/practice/practice?mode=source&sourceId=zhong-51cto', '2-practice', 5000)
    await go('/pages/practice/practice?mode=source&sourceId=gao-2021b', '3-practice-gao', 5000)
    await go('/pages/subjective/list', '4-subjective')
    await go('/pages/reader/reader?id=zhong-m-notes-2021', '5-reader', 5000)
    await go('/pages/materials/materials', '6-materials')

    const bad = logs.filter((l) => l.type === 'App.exceptionThrown' || l.type === 'error' || l.level === 'error')
    console.log(`控制台错误 ${bad.length} 条`)
    for (const l of bad.slice(0, 10)) console.log('  ', JSON.stringify(l).slice(0, 300))
    if (bad.length) failed++
  } catch (e) {
    console.error('验证中断：', e.message)
    failed++
  }
  ws.close()
  console.log(failed ? `结果：有 ${failed} 项失败` : '结果：全部通过')
  process.exit(failed ? 1 : 0)
})
