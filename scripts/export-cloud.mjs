/**
 * 云数据库导入文件生成脚本：读取 .import/out，按与 pack-bank 相同的规则清洗，
 * 输出云开发控制台“导入”可用的 JSON Lines 文件（每行一条记录，带固定 _id）到 .import/cloud/。
 *
 * 用法：
 *   pnpm export-cloud          只导出历年真题（kind === 'exam'）的题集、选择题和这些题集的主观题，不导出资料。公开上线用。
 *   pnpm export-cloud --all    导出全部题集、题目、主观题和资料。自用。
 *
 * 输入数据只读。每次运行先清空 .import/cloud/ 下的 .json 文件和 README.md。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanQuestions, MATERIAL_CATEGORIES, paginateParas, splitParagraphs, SUBJECTS } from './lib/bank-clean.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IN_DIR = path.join(ROOT, '.import', 'out')
const OUT_DIR = path.join(ROOT, '.import', 'cloud')

const args = process.argv.slice(2)
const unknownArgs = args.filter((a) => a !== '--all')
if (unknownArgs.length > 0) fail(`不认识的参数：${unknownArgs.join(' ')}（只支持 --all）`)
const ALL = args.includes('--all')

function fail(msg) {
  console.error(`[export-cloud] 失败：${msg}`)
  process.exit(1)
}

function readJson(name) {
  const file = path.join(IN_DIR, name)
  if (!fs.existsSync(file)) fail(`缺少输入文件 ${file}`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/* ---------- 读取与清洗 ---------- */

const sources = readJson('sources.json')
const questions = readJson('questions.json')
const subjective = readJson('subjective.json')
const materials = readJson('materials.json')

const subjectIds = new Set(SUBJECTS.map((s) => s.id))
for (const s of sources) {
  if (!subjectIds.has(s.subjectId)) fail(`来源 ${s.id} 的科目 ${s.subjectId} 未知`)
}
const { keptBySource, dropped, headerLines, headerQuestions } = cleanQuestions(
  questions,
  sources.map((s) => s.id),
  fail,
)

/* ---------- 按导出范围筛选 ---------- */

const includeSource = (s) => ALL || s.kind === 'exam'
const includedSourceIds = new Set(sources.filter(includeSource).map((s) => s.id))
const excluded = {
  sources: sources.length - includedSourceIds.size,
  questions: 0,
  subjective: 0,
  materials: ALL ? 0 : materials.length,
}
for (const s of sources) {
  if (!includedSourceIds.has(s.id)) excluded.questions += keptBySource.get(s.id).length
}

/* ---------- 生成记录 ---------- */

const out = {
  subjects: [],
  sources: [],
  questions: [],
  subjective: [],
  materials: [],
  material_pages: [],
}

SUBJECTS.forEach((s, i) => {
  out.subjects.push({ _id: s.id, id: s.id, name: s.name, shortName: s.shortName, description: s.description, order: i })
})

let order = 0
for (const subject of SUBJECTS) {
  for (const s of sources.filter((x) => x.subjectId === subject.id && includedSourceIds.has(x.id))) {
    const list = keptBySource.get(s.id)
    out.sources.push({
      _id: s.id,
      id: s.id,
      subjectId: s.subjectId,
      title: s.title,
      kind: s.kind,
      questionCount: list.length,
      subjectiveCount: subjective.filter((x) => x.sourceId === s.id).length,
      order: order++,
    })
    for (const q of list) out.questions.push(Object.assign({ _id: q.id }, q))
  }
}

const sourceIds = new Set(sources.map((s) => s.id))
order = 0
for (const subject of SUBJECTS) {
  for (const item of subjective.filter((x) => x.subjectId === subject.id)) {
    if (!sourceIds.has(item.sourceId)) fail(`主观题 ${item.id} 的来源 ${item.sourceId} 不存在`)
    if (!includedSourceIds.has(item.sourceId)) {
      excluded.subjective++
      continue
    }
    const answer = String(item.answer || '').replace(/\r\n/g, '\n')
    out.subjective.push({
      _id: item.id,
      id: item.id,
      subjectId: item.subjectId,
      sourceId: item.sourceId,
      kind: item.kind,
      title: item.title,
      stem: String(item.stem || '').replace(/\r\n/g, '\n'),
      answer,
      hasAnswer: answer.trim() !== '',
      order: order++,
    })
  }
}

if (ALL) {
  materials.forEach((m, i) => {
    if (!subjectIds.has(m.subjectId)) fail(`资料 ${m.id} 的科目 ${m.subjectId} 未知`)
    if (!/^[A-Za-z0-9_-]+$/.test(m.id)) fail(`资料 id 含有不适合做 _id 的字符：${m.id}`)
    const file = path.join(IN_DIR, 'materials', `${m.id}.txt`)
    if (!fs.existsSync(file)) fail(`缺少资料正文 ${file}`)
    const pages = paginateParas(splitParagraphs(fs.readFileSync(file, 'utf8')))
    const category = MATERIAL_CATEGORIES.includes(m.category) ? m.category : '其他'
    out.materials.push({
      _id: m.id,
      id: m.id,
      subjectId: m.subjectId,
      category,
      categoryOrder: MATERIAL_CATEGORIES.indexOf(category),
      title: m.title,
      chars: m.chars,
      pageCount: pages.length,
      order: i,
    })
    pages.forEach((paras, p) => {
      out.material_pages.push({ _id: `${m.id}_p${p + 1}`, materialId: m.id, page: p + 1, paras })
    })
  })
}

/* ---------- 写文件 ---------- */

fs.mkdirSync(OUT_DIR, { recursive: true })
for (const f of fs.readdirSync(OUT_DIR)) {
  if (f.endsWith('.json') || f === 'README.md') fs.rmSync(path.join(OUT_DIR, f))
}
const sizes = {}
for (const [name, rows] of Object.entries(out)) {
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), text, 'utf8')
  sizes[name] = Buffer.byteLength(text, 'utf8')
}

const readme = `# 云数据库导入说明

由 \`scripts/export-cloud.mjs\` 生成，不要手动修改。本次导出范围：${
  ALL ? '**全部内容**（\`--all\`，自用）' : '**只含历年真题**（默认，公开上线用）'
}。

## 本次导出

| 集合 | 文件 | 条数 | 字节 |
|---|---|---|---|
${Object.keys(out)
  .map((k) => `| \`${k}\` | \`${k}.json\` | ${out[k].length} | ${sizes[k]} |`)
  .join('\n')}

${
  ALL
    ? ''
    : `默认导出排除了模拟卷和专题题集 ${excluded.sources} 套（选择题 ${excluded.questions} 道）、这些题集的主观题 ${excluded.subjective} 道，以及全部资料 ${excluded.materials} 份。\`materials.json\`、\`material_pages.json\` 是空文件，不用导入，但两个集合仍要建（小程序读到空目录时显示“暂无资料”）。需要全部内容时运行 \`pnpm export-cloud --all\`。

`
}## 需要建的集合

在云开发控制台 → 数据库里新建下面的集合。**所有集合的权限都设为仅云函数可读写**：控制台里选“所有用户不可读写”（部分版本叫“仅管理端可读写”），或用自定义安全规则 \`{ "read": false, "write": false }\`。
小程序端不直接读写数据库，所有读写都经过云函数 \`api\`；云函数以管理员身份访问，不受这里的权限限制。

| 集合 | 来源 | 用途 |
|---|---|---|
| \`subjects\` | 导入 | 科目 |
| \`sources\` | 导入 | 题集（套卷） |
| \`questions\` | 导入 | 选择题，含答案和解析 |
| \`subjective\` | 导入 | 案例/计算题 |
| \`materials\` | 导入 | 资料目录 |
| \`material_pages\` | 导入 | 资料正文，每页一条，\`_id\` 为 \`资料id_p页码\` |
| \`users\` | 云函数写入 | 用户，\`_id\` 为 openid |
| \`answer_records\` | 云函数写入 | 作答记录，\`_id\` 为 \`openid_题目id\` |
| \`submit_batches\` | 云函数写入 | 练习提交批次，用于离线重试去重 |
| \`exam_sessions\` | 云函数写入 | 考试 |
| \`exam_locks\` | 云函数写入 | 每个用户一条，指向最近一场考试，保证同时只有一场进行中 |

## 需要建的索引

\`_id\` 自带索引，按 \`_id\` 读取的集合（\`users\`、\`subjective\`、\`materials\`、\`material_pages\`、\`submit_batches\`、\`exam_locks\`）不用另建。

| 集合 | 索引字段 | 用途 |
|---|---|---|
| \`questions\` | \`sourceId\` 升序、\`no\` 升序 | 按题集取题 |
| \`questions\` | \`subjectId\` 升序 | 随机抽题 |
| \`answer_records\` | \`openid\` 升序、\`subjectId\` 升序 | 进度统计 |
| \`answer_records\` | \`openid\` 升序、\`subjectId\` 升序、\`wrong\` 升序、\`wrongAt\` 降序 | 错题本分页 |
| \`answer_records\` | \`openid\` 升序、\`subjectId\` 升序、\`favorite\` 升序、\`favoriteAt\` 降序 | 收藏分页 |
| \`exam_sessions\` | \`openid\` 升序、\`status\` 升序、\`endAt\` 降序 | 考试历史 |

## 导入步骤

1. 在微信开发者工具里打开 \`dist/build/mp-weixin\`（先运行 \`pnpm build:mp-weixin\`），开通云开发，记下环境 ID。
2. 按上表建好全部集合并设置权限。
3. 控制台 → 数据库 → 选中集合 → 导入，选择本目录下同名的 \`.json\` 文件，格式选 JSON，冲突处理模式选 **Upsert**（重复导入时按 \`_id\` 覆盖）。
   空文件（0 条）跳过即可。
4. 建索引。
5. 在开发者工具的“云开发”面板里，右键 \`cloudfunctions/api\` → “上传并部署：云端安装依赖”。
6. 把环境 ID 填进 \`src/config.ts\` 的 \`CLOUD_ENV_ID\`，重新构建。

题库更新后重新运行本脚本并用 Upsert 导入。已删除的题目不会因为导入而从集合里消失，需要在控制台手动删除。
`
fs.writeFileSync(path.join(OUT_DIR, 'README.md'), readme, 'utf8')

/* ---------- 报告 ---------- */

console.log(`[export-cloud] 范围：${ALL ? '全部内容（--all）' : '只含历年真题（默认）'}`)
console.log(`  清洗：丢弃依赖图表的选择题 ${dropped.length} 道，去掉解析末尾页眉 ${headerLines} 行（涉及 ${headerQuestions} 题）`)
console.log(
  `  排除：题集 ${excluded.sources} 套，选择题 ${excluded.questions} 道，主观题 ${excluded.subjective} 道，资料 ${excluded.materials} 份`,
)
console.log(`[export-cloud] 输出到 ${path.relative(ROOT, OUT_DIR)}：`)
for (const k of Object.keys(out)) {
  console.log(`  ${k.padEnd(15)} ${String(out[k].length).padStart(5)} 条  ${String(sizes[k]).padStart(9)} 字节`)
}
