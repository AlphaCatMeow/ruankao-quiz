/**
 * 题库打包脚本：读取 .import/out 下解析好的数据，生成应用使用的数据文件。
 *
 * 输出：
 * - src/data/bank-index.ts：主包里的小索引（科目、来源、主观题标题、资料目录、数据块位置）
 * - src/bankpkg<N>/static/{q,s,m}/*.json：按来源分块的选择题、按科目的主观题、每份资料一个文件
 *
 * 用法：pnpm pack-bank。可重复运行，每次先清空各分包的 static 目录。
 * 输入数据只读，不做任何修改。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanQuestions, MATERIAL_CATEGORIES, splitParagraphs, SUBJECTS } from './lib/bank-clean.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IN_DIR = process.env.QUIZ_BANK_INPUT || path.join(ROOT, '.import', 'out')
const publicOnly = process.argv.includes('--public')
const SRC_DIR = path.join(ROOT, 'src')
const INDEX_FILE = path.join(SRC_DIR, 'data', 'bank-index.ts')
const PAGES_JSON = path.join(SRC_DIR, 'pages.json')

/** 预留的分包数量，pages.json 里需要注册同样数量的分包 */
const PKG_COUNT = 6
const PKG_PREFIX = 'bankpkg'
/** 每个分包的数据上限（字节），微信分包上限 2 MB，留出余量 */
const PKG_DATA_LIMIT = Math.floor(1.6 * 1024 * 1024)
function fail(msg) {
  console.error(`[pack-bank] 失败：${msg}`)
  process.exit(1)
}

function readJson(name) {
  const file = path.join(IN_DIR, name)
  if (!fs.existsSync(file)) fail(`缺少输入文件 ${file}`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/* ---------- 读取输入 ---------- */

const sources = readJson('sources.json').filter((s) => !publicOnly || s.kind === 'exam')
const includedIds = new Set(sources.map((s) => s.id))
const includeItem = (item) => !publicOnly || includedIds.has(item.sourceId)
const questions = readJson('questions.json').filter(includeItem)
const subjective = readJson('subjective.json').filter(includeItem)
const materials = publicOnly ? [] : readJson('materials.json')

const subjectIds = new Set(SUBJECTS.map((s) => s.id))
const sourceIds = new Set(sources.map((s) => s.id))
for (const s of sources) {
  if (!subjectIds.has(s.subjectId)) fail(`来源 ${s.id} 的科目 ${s.subjectId} 未知`)
}

// 运行时靠“题目 id 以 来源id- 开头（取最长匹配）”定位数据块，这里先校验
const sortedSourceIds = [...sourceIds].sort((a, b) => b.length - a.length)
function sourceOfId(id) {
  return sortedSourceIds.find((sid) => id.startsWith(`${sid}-`))
}
const seenIds = new Set()
for (const q of questions) {
  if (seenIds.has(q.id)) fail(`题目 id 重复：${q.id}`)
  seenIds.add(q.id)
  if (sourceOfId(q.id) !== q.sourceId) fail(`题目 ${q.id} 无法按 id 前缀定位到来源 ${q.sourceId}`)
}

/* ---------- 清洗 ---------- */

const { keptBySource, dropped, headerLines, headerQuestions } = cleanQuestions(
  questions,
  sources.map((s) => s.id),
  fail,
)

/* ---------- 生成数据块 ---------- */

/** @type {{key:string, file:string, data:unknown, json:string, bytes:number, group:'seq'|'fit'}[]} */
const chunks = []
function addChunk(key, file, data, group) {
  const json = JSON.stringify(data)
  chunks.push({ key, file, data, json, bytes: Buffer.byteLength(json, 'utf8'), group })
}

const sourceMetas = []
for (const subject of SUBJECTS) {
  for (const s of sources.filter((x) => x.subjectId === subject.id)) {
    const list = keptBySource.get(s.id)
    const key = list.length > 0 ? `q:${s.id}` : ''
    if (key) addChunk(key, `q/${s.id}.json`, list, 'seq')
    sourceMetas.push({
      id: s.id,
      subjectId: s.subjectId,
      title: s.title,
      kind: s.kind,
      questionCount: list.length,
      subjectiveCount: subjective.filter((x) => x.sourceId === s.id).length,
      chunk: key,
    })
  }
}

const subjectiveMetas = []
const subjectiveChunks = {}
for (const subject of SUBJECTS) {
  const list = subjective.filter((x) => x.subjectId === subject.id)
  for (const item of list) {
    if (!sourceIds.has(item.sourceId)) fail(`主观题 ${item.id} 的来源 ${item.sourceId} 不存在`)
    subjectiveMetas.push({
      id: item.id,
      subjectId: item.subjectId,
      sourceId: item.sourceId,
      kind: item.kind,
      title: item.title,
      hasAnswer: !!(item.answer && String(item.answer).trim()),
    })
  }
  if (list.length > 0) {
    const key = `s:${subject.id}`
    subjectiveChunks[subject.id] = key
    addChunk(
      key,
      `s/${subject.id}.json`,
      list.map((x) => ({
        id: x.id,
        subjectId: x.subjectId,
        sourceId: x.sourceId,
        kind: x.kind,
        title: x.title,
        stem: String(x.stem || '').replace(/\r\n/g, '\n'),
        answer: String(x.answer || '').replace(/\r\n/g, '\n'),
      })),
      'seq',
    )
  }
}

const materialMetas = []
for (const m of materials) {
  if (!subjectIds.has(m.subjectId)) fail(`资料 ${m.id} 的科目 ${m.subjectId} 未知`)
  if (!/^[A-Za-z0-9_-]+$/.test(m.id)) fail(`资料 id 含有不适合做文件名的字符：${m.id}`)
  const file = path.join(IN_DIR, 'materials', `${m.id}.txt`)
  if (!fs.existsSync(file)) fail(`缺少资料正文 ${file}`)
  const paras = splitParagraphs(fs.readFileSync(file, 'utf8'))
  const key = `m:${m.id}`
  addChunk(key, `m/${m.id}.json`, { id: m.id, title: m.title, paras }, 'fit')
  materialMetas.push({
    id: m.id,
    subjectId: m.subjectId,
    category: MATERIAL_CATEGORIES.includes(m.category) ? m.category : '其他',
    title: m.title,
    chars: m.chars,
    chunk: key,
  })
}

/* ---------- 分配到分包 ---------- */

const pkgs = Array.from({ length: PKG_COUNT }, (_, i) => ({ name: `${PKG_PREFIX}${i + 1}`, bytes: 0, files: 0 }))
const placed = {}
function place(chunk, pkg) {
  pkg.bytes += chunk.bytes
  pkg.files++
  placed[chunk.key] = { pkg: pkg.name, path: `${pkg.name}/static/${chunk.file}`, bytes: chunk.bytes }
}
for (const c of chunks) {
  if (c.bytes > PKG_DATA_LIMIT) fail(`数据块 ${c.key} 有 ${c.bytes} 字节，超过单个分包上限 ${PKG_DATA_LIMIT}`)
}
// 题目和主观题按科目顺序连续放，同一科目的题尽量集中在少数分包里
let cursor = 0
for (const c of chunks.filter((x) => x.group === 'seq')) {
  while (cursor < pkgs.length && pkgs[cursor].bytes + c.bytes > PKG_DATA_LIMIT) cursor++
  if (cursor >= pkgs.length) fail(`${PKG_COUNT} 个分包放不下全部数据，请增加 PKG_COUNT 并在 pages.json 注册新分包`)
  place(c, pkgs[cursor])
}
// 资料从大到小，放进第一个装得下的分包
for (const c of chunks.filter((x) => x.group === 'fit').sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key))) {
  const pkg = pkgs.find((p) => p.bytes + c.bytes <= PKG_DATA_LIMIT)
  if (!pkg) fail(`${PKG_COUNT} 个分包放不下全部数据，请增加 PKG_COUNT 并在 pages.json 注册新分包`)
  place(c, pkg)
}

/* ---------- 校验 pages.json ---------- */

const pagesJsonText = fs.readFileSync(PAGES_JSON, 'utf8')
for (const p of pkgs) {
  if (!pagesJsonText.includes(`"root": "${p.name}"`)) fail(`pages.json 的 subPackages 里没有注册 ${p.name}`)
  if (!fs.existsSync(path.join(SRC_DIR, p.name, 'pages', 'index.vue'))) fail(`缺少分包占位页 src/${p.name}/pages/index.vue`)
}

/* ---------- 写文件 ---------- */

for (const p of pkgs) {
  fs.rmSync(path.join(SRC_DIR, p.name, 'static'), { recursive: true, force: true })
}
for (const c of chunks) {
  const out = path.join(SRC_DIR, placed[c.key].path)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, c.json, 'utf8')
}

const index = {
  version: 1,
  subjects: SUBJECTS,
  categories: MATERIAL_CATEGORIES,
  sources: sourceMetas,
  subjective: subjectiveMetas,
  subjectiveChunks,
  materials: materialMetas,
  chunks: placed,
}
const indexTs = `// 由 scripts/pack-bank.mjs 生成，不要手动修改。重新生成：pnpm pack-bank
import type { BankIndex } from '@/types'

export const BANK_INDEX: BankIndex = ${JSON.stringify(index, null, 1)}
`
fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true })
fs.writeFileSync(INDEX_FILE, indexTs, 'utf8')

/* ---------- 报告 ---------- */

const keptCount = sourceMetas.reduce((n, s) => n + s.questionCount, 0)
console.log('[pack-bank] 清洗：')
console.log(`  选择题 输入 ${questions.length}，保留 ${keptCount}`)
console.log(`  (a) 丢弃依赖图表的选择题 ${dropped.length} 道${dropped.length ? `：${dropped.join(', ')}` : ''}`)
console.log(`  (b) 去掉解析末尾页眉 ${headerLines} 行（涉及 ${headerQuestions} 题）`)
console.log(`  主观题 ${subjectiveMetas.length} 道（无参考答案 ${subjectiveMetas.filter((x) => !x.hasAnswer).length} 道），资料 ${materialMetas.length} 份`)
console.log(`[pack-bank] 分包（上限 ${PKG_DATA_LIMIT} 字节/包）：`)
let total = 0
for (const p of pkgs) {
  total += p.bytes
  console.log(`  ${p.name}: ${p.bytes} 字节，${p.files} 个文件`)
}
console.log(`  数据合计 ${total} 字节`)
console.log(`  主包索引 src/data/bank-index.ts：${Buffer.byteLength(indexTs, 'utf8')} 字节`)
