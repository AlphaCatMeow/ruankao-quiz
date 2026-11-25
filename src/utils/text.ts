/** 文本显示辅助：把含 | 表格行的多行文本拆成普通段落和表格块 */

export type TextBlockItem = { type: 'text'; content: string } | { type: 'table'; lines: string[] }

/** 以 | 开头且至少含两个 | 的行视为表格行 */
const TABLE_LINE_RE = /^\s*\|[^\n]*\|/

/** 显示宽度：全角字符按 2 计 */
function displayWidth(s: string): number {
  let w = 0
  for (let i = 0; i < s.length; i++) {
    w += s.charCodeAt(i) > 0xff ? 2 : 1
  }
  return w
}

/** 把一组 |a|b| 行按列补齐空格，等宽字体下列能对齐 */
function alignTable(lines: string[]): string[] {
  const rows = lines.map((line) => {
    let t = line.trim().slice(1)
    if (t.endsWith('|')) t = t.slice(0, -1)
    return t
      .split('|')
      .map((c) => c.trim())
  })
  const widths: number[] = []
  rows.forEach((cells) => {
    cells.forEach((c, i) => {
      widths[i] = Math.max(widths[i] || 0, displayWidth(c))
    })
  })
  return rows.map((cells) => {
    const padded = widths.map((w, i) => {
      const c = cells[i] || ''
      return c + ' '.repeat(Math.max(0, w - displayWidth(c)))
    })
    return `| ${padded.join(' | ')} |`
  })
}

export function splitTextBlocks(text: string): TextBlockItem[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: TextBlockItem[] = []
  let textBuf: string[] = []
  let tableBuf: string[] = []
  const flushText = () => {
    if (textBuf.length > 0) {
      const content = textBuf.join('\n').replace(/^\n+|\n+$/g, '')
      if (content) blocks.push({ type: 'text', content })
      textBuf = []
    }
  }
  const flushTable = () => {
    if (tableBuf.length > 0) {
      blocks.push({ type: 'table', lines: alignTable(tableBuf) })
      tableBuf = []
    }
  }
  lines.forEach((line) => {
    if (TABLE_LINE_RE.test(line)) {
      flushText()
      tableBuf.push(line)
    } else {
      flushTable()
      textBuf.push(line)
    }
  })
  flushText()
  flushTable()
  return blocks
}

/** 阅读页每页大约字数 */
export const READER_PAGE_CHARS = 3000

/**
 * 段落按约 READER_PAGE_CHARS 字分页，返回每页的段落下标范围 [start, end)，至少一页。
 * 与 scripts/lib/bank-clean.mjs 的 paginateParas 规则相同（云端资料按同样规则预先分页）。
 */
export function paginateParas(paras: string[]): [number, number][] {
  if (paras.length === 0) return [[0, 0]]
  const out: [number, number][] = []
  let start = 0
  let size = 0
  paras.forEach((p, i) => {
    if (size > 0 && size + p.length > READER_PAGE_CHARS) {
      out.push([start, i])
      start = i
      size = 0
    }
    size += p.length
  })
  out.push([start, paras.length])
  return out
}
