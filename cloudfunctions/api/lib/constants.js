'use strict'

/** 考试时长 150 分钟 */
const EXAM_DURATION_MS = 150 * 60 * 1000
/** 截止后接受交卷的宽限（网络延迟用） */
const EXAM_GRACE_MS = 30 * 1000
/** 随机组卷题数 */
const EXAM_RANDOM_COUNT = 75

/** 随机练习一次最多抽题数 */
const RANDOM_MAX = 100
/** 按 id 取题一次最多条数 */
const BY_IDS_MAX = 100
/** 批量提交作答一次最多条数 */
const SUBMIT_MAX = 100
/** 分页一页最多条数 */
const PAGE_SIZE_MAX = 200
/** 昵称最多字符数（按 Unicode 字符计） */
const NICKNAME_MAX = 20
/** 选项下标上限（不含） */
const OPTION_MAX = 10
/** 资料页码上限 */
const MATERIAL_PAGE_MAX = 10000

module.exports = {
  EXAM_DURATION_MS,
  EXAM_GRACE_MS,
  EXAM_RANDOM_COUNT,
  RANDOM_MAX,
  BY_IDS_MAX,
  SUBMIT_MAX,
  PAGE_SIZE_MAX,
  NICKNAME_MAX,
  OPTION_MAX,
  MATERIAL_PAGE_MAX,
}
