/**
 * 题库清洗规则，pack-bank（本机分包）和 export-cloud（云数据库导入）共用。
 * 两边的数据必须经过同样的清洗，所以规则只在这里写一份。
 */

export const SUBJECTS = [
  {
    id: 'zhong',
    name: '中级·系统集成项目管理工程师',
    shortName: '中项',
    description: '中级资格',
  },
  {
    id: 'gao',
    name: '高级·信息系统项目管理师',
    shortName: '高项',
    description: '高级资格',
  },
]

export const MATERIAL_CATEGORIES = ['笔记', '背诵', '公式与ITTO', '论文', '其他']

/** 资料段落过长时再切分，避免单个 text 节点过大 */
export const MAX_PARA_CHARS = 1500
/** 阅读页每页大约字数，与 src/pages/reader 的分页一致 */
export const PAGE_CHARS = 3000

/**
 * 题干引用了图或表。宽泛的“图中/网络图”会误伤概念题（如“UML 顺序图中”“关于项目进度网络图的描述”），
 * 所以只认明确指向某张图表的说法。
 */
const FIGURE_RES = [
  /下图|如图|上图|下表|上表|如下表|表中所示|图中所示|见图|见表/,
  /(?:如下|以下是|以下|下面的|下面)(?:所示的)?[^，。；？！\n（）关对的]{0,8}(?:网络图|模型图|箭线图|示意图|流程图|结构图|状态图|单代号图|双代号图)/,
  /表示图中/,
]

/** 题干里是否带着表格内容：有 | 画的表格行，或者有多行数据 */
function stemHasTable(stem) {
  return stem.includes('|') || stem.split('\n').length >= 5
}

/** 清洗 (a)：题目依赖图表但题干里没有表格内容，应丢弃 */
export function dependsOnFigure(stem) {
  return FIGURE_RES.some((re) => re.test(stem)) && !stemHasTable(stem)
}

/** 解析末尾残留的页眉，如单独一行的“2019年上半年信息系统项目管理师” */
const HEADER_LINE_RE =
  /^\s*20\d{2}\s*年.{0,16}(?:信息系统项目管理师|系统集成项目管理工程师|中项模拟题(?:（[一二三四五六七八九十\d]+）)?)\s*$/

/** 清洗 (b)：去掉解析末尾的页眉行，返回 { text, removed } */
export function cleanExplanation(text) {
  let lines = String(text || '').replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n')
  let removed = 0
  while (lines.length > 1 && HEADER_LINE_RE.test(lines[lines.length - 1])) {
    lines.pop()
    removed++
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  }
  return { text: lines.join('\n').replace(/\s+$/, ''), removed }
}

/**
 * 对全部选择题做 (a)(b) 两项清洗，按来源分组。
 * 返回 { keptBySource: Map(sourceId -> 题目[]), dropped: 题目id[], headerLines, headerQuestions }。
 * 题目的来源不在 sourceIds 里时调用 onError。
 */
export function cleanQuestions(questions, sourceIds, onError) {
  const keptBySource = new Map(sourceIds.map((id) => [id, []]))
  const dropped = []
  let headerLines = 0
  let headerQuestions = 0
  for (const q of questions) {
    if (!keptBySource.has(q.sourceId)) onError(`题目 ${q.id} 的来源 ${q.sourceId} 不在 sources.json 中`)
    if (dependsOnFigure(q.stem)) {
      dropped.push(q.id)
      continue
    }
    const { text, removed } = cleanExplanation(q.explanation)
    if (removed > 0) {
      headerLines += removed
      headerQuestions++
    }
    keptBySource.get(q.sourceId).push({
      id: q.id,
      subjectId: q.subjectId,
      sourceId: q.sourceId,
      no: q.no,
      type: q.type,
      stem: q.stem,
      options: q.options,
      answer: q.answer,
      explanation: text,
    })
  }
  return { keptBySource, dropped, headerLines, headerQuestions }
}

/** 资料正文按空行分段，过长的段再按行、按标点切开 */
export function splitParagraphs(text) {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.replace(/\s+$/, '').replace(/^\n+/, ''))
    .filter((b) => b.trim() !== '')
  const out = []
  for (const block of blocks) {
    if (block.length <= MAX_PARA_CHARS) {
      out.push(block)
      continue
    }
    let buf = ''
    for (const line of block.split('\n')) {
      for (const piece of cutLine(line)) {
        if (buf && buf.length + piece.length + 1 > MAX_PARA_CHARS) {
          out.push(buf)
          buf = ''
        }
        buf = buf ? `${buf}\n${piece}` : piece
      }
    }
    if (buf) out.push(buf)
  }
  return out
}

function cutLine(line) {
  if (line.length <= MAX_PARA_CHARS) return [line]
  const pieces = []
  let rest = line
  while (rest.length > MAX_PARA_CHARS) {
    const window = rest.slice(0, MAX_PARA_CHARS)
    let at = Math.max(window.lastIndexOf('。'), window.lastIndexOf('；'), window.lastIndexOf('！'), window.lastIndexOf('？'))
    if (at < MAX_PARA_CHARS / 2) at = MAX_PARA_CHARS - 1
    pieces.push(rest.slice(0, at + 1))
    rest = rest.slice(at + 1)
  }
  if (rest) pieces.push(rest)
  return pieces
}

/** 段落按约 PAGE_CHARS 字分页，规则与阅读页相同。返回段落数组的数组，至少一页 */
export function paginateParas(paras) {
  if (paras.length === 0) return [[]]
  const pages = []
  let cur = []
  let size = 0
  for (const p of paras) {
    if (size > 0 && size + p.length > PAGE_CHARS) {
      pages.push(cur)
      cur = []
      size = 0
    }
    cur.push(p)
    size += p.length
  }
  pages.push(cur)
  return pages
}
