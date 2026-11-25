<template>
  <view class="page">
    <!-- 选择组卷方式 -->
    <template v-if="stage === 'setup'">
      <view v-if="!hasAny" class="empty">该科目暂无题目</view>
      <view v-else class="card">
        <text class="section-title">随机组卷</text>
        <text class="muted setup-desc">从{{ subjectName }}全部题目中随机抽 {{ EXAM_RANDOM_COUNT }} 题，限时 {{ EXAM_MINUTES }} 分钟。</text>
        <view class="btn btn-primary setup-btn" @tap="start('random')">开始随机组卷</view>
      </view>

      <text v-if="hasAny" class="section-title setup-group">整套卷 · 按原题序作答，限时 {{ EXAM_MINUTES }} 分钟</text>
      <view v-if="hasAny && paperGroups.length === 0" class="empty">当前科目没有整套试卷</view>
      <block v-for="g in paperGroups" :key="g.kind">
        <text class="muted setup-kind">{{ g.label }}</text>
        <view class="card paper-card">
          <view v-for="p in g.papers" :key="p.id" class="paper row-between" @tap="start('paper', p.id)">
            <text class="paper-title">{{ p.title }}</text>
            <text class="muted paper-count">{{ p.questionCount }} 题 ›</text>
          </view>
        </view>
      </block>
    </template>

    <!-- 开考须知：确认后才开始计时 -->
    <template v-else-if="stage === 'notice'">
      <view class="card">
        <text class="section-title">考试须知</text>
        <text class="notice-paper">{{ noticeTitle }}</text>
        <view class="notice-list">
          <text class="notice-item">1. 本次考试限时 {{ EXAM_MINUTES }} 分钟，开始后计时不能暂停，时间到自动交卷。</text>
          <text class="notice-item">2. {{ noticeLeave }}</text>
          <text class="notice-item">3. 请预留足够的时间，在安静、不被打扰的环境下作答。</text>
          <text class="notice-item">4. 作答过程中不显示对错，交卷后可逐题回顾。</text>
        </view>
        <view class="btn btn-primary setup-btn" @tap="begin">我已准备好，开始考试</view>
        <view class="btn notice-cancel" @tap="cancelNotice">现在不方便，稍后再考</view>
      </view>
    </template>

    <LoadState v-else-if="stage === 'loading' || stage === 'error'" :loading="stage === 'loading'" :error="error" :text="loadingText" @retry="retry" />

    <template v-else>
      <view v-if="questions.length === 0" class="empty">没有可用的题目</view>
      <template v-else>
        <view class="card timer-card row-between">
          <text class="secondary">第 {{ index + 1 }} / {{ questions.length }} 题 · 已答 {{ answeredCount }}</text>
          <text :class="['timer', remaining <= 60 ? 'text-wrong' : '']">剩余 {{ formatClock(remaining) }}</text>
        </view>

        <view class="card">
          <view class="q-head">
            <text class="q-type">{{ typeLabel }}</text>
            <TextBlock :text="current.stem" :font-size="32" />
          </view>
          <view
            v-for="(opt, i) in current.options"
            :key="i"
            :class="['option', selected.indexOf(i) >= 0 ? 'option-selected' : '']"
            @tap="onSelect(i)"
          >
            <text class="option-label">{{ current.type === 'judge' ? (i === 0 ? '对' : '错') : optionLabel(i) }}</text>
            <text class="option-text">{{ opt }}</text>
          </view>
        </view>

        <view :class="['btn', 'btn-primary', 'submit-btn', submitting ? 'btn-disabled' : '']" @tap="onSubmit">{{ submitting ? '正在交卷…' : '交卷' }}</view>
        <view class="bottom-space"></view>

        <view class="bottom-bar">
          <view :class="['btn', index === 0 ? 'btn-disabled' : '']" @tap="go(index - 1)">上一题</view>
          <view class="btn" @tap="showCard = true">答题卡</view>
          <view :class="['btn', 'btn-primary', index === questions.length - 1 ? 'btn-disabled' : '']" @tap="go(index + 1)">下一题</view>
        </view>

        <AnswerCard
          :visible="showCard"
          :statuses="cardStatuses"
          :current="index"
          :show-result="false"
          @close="showCard = false"
          @select="onCardSelect"
        />
      </template>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onBackPress, onHide, onLoad, onUnload } from '@dcloudio/uni-app'
import AnswerCard from '@/components/AnswerCard.vue'
import LoadState from '@/components/LoadState.vue'
import TextBlock from '@/components/TextBlock.vue'
import type { CardStatus, ExamMode, ExamSession, Question } from '@/types'
import {
  abandonExam,
  bank,
  currentSubject,
  EXAM_MINUTES,
  EXAM_RANDOM_COUNT,
  EXAM_RESUMABLE,
  finishExam,
  getRunningExam,
  getSource,
  hasQuestions,
  initStore,
  saveExamProgress,
  SOURCE_KIND_LABEL,
  sourcesOf,
  startExam,
} from '@/store'
import { formatClock, optionLabel, TYPE_LABEL } from '@/utils/quiz'

type Stage = 'setup' | 'notice' | 'loading' | 'error' | 'running'

/** 云模式下定时把作答存到服务端的间隔 */
const AUTOSAVE_MS = 30 * 1000

// #ifdef MP-WEIXIN
declare const wx: any
// #endif
const LEAVE_MESSAGE = EXAM_RESUMABLE
  ? '退出后计时不会暂停，可在时限内回来继续作答。确定退出吗？'
  : '考试需要一次完成。现在退出，本次作答不保存，确定退出吗？'

const noticeLeave = EXAM_RESUMABLE
  ? '考试需要一次完成。计时从开始起不会暂停，中途退出后可在时限内回来继续。'
  : '考试需要一次完成。中途退出，本次作答不保存，也不计成绩。'

const stage = ref<Stage>('setup')
const error = ref('')
const loadingText = ref('')
const examMode = ref<ExamMode>('random')
const paperId = ref('')
const session = ref<ExamSession | null>(null)
const answers = reactive<Record<string, number[]>>({})
const index = ref(0)
const remaining = ref(EXAM_MINUTES * 60)
const showCard = ref(false)
const submitting = ref(false)
let timer: ReturnType<typeof setInterval> | null = null
let autosaveTimer: ReturnType<typeof setInterval> | null = null
let submitted = false
let entryDirect = false
/** 有未存到服务端的作答 */
let dirty = false

const subjectName = computed(() => (currentSubject.value ? currentSubject.value.name : ''))
const subjectIdNow = computed(() => (currentSubject.value ? currentSubject.value.id : ''))
/** 索引未加载时先按有题处理，避免闪一下空状态 */
const hasAny = computed(() => !bank.loaded || hasQuestions(subjectIdNow.value))
const paperGroups = computed(() => {
  const sid = subjectIdNow.value
  return (['exam', 'mock'] as const)
    .map((kind) => ({ kind, label: SOURCE_KIND_LABEL[kind], papers: sourcesOf(sid, kind) }))
    .filter((g) => g.papers.length > 0)
})

const questions = computed<Question[]>(() => (session.value ? session.value.questions : []))
const current = computed(() => questions.value[index.value])
const typeLabel = computed(() => (current.value ? TYPE_LABEL[current.value.type] : ''))
const selected = computed<number[]>(() => (current.value && answers[current.value.id]) || [])
const answeredCount = computed(() => questions.value.filter((q) => (answers[q.id] || []).length > 0).length)
const cardStatuses = computed<CardStatus[]>(() =>
  questions.value.map((q) => ((answers[q.id] || []).length > 0 ? 'done' : 'none')),
)

onLoad(async (query) => {
  const q = (query || {}) as Record<string, string | undefined>
  try {
    await initStore()
  } catch (err) {
    showError(err)
    return
  }
  const running = await findRunning()
  if (running) {
    if (q.resume === '1') enter(running)
    else promptResume(running)
    return
  }
  // 带参数进入（如“再考一次”）时跳过选卷，直接到开考须知
  if (q.mode === 'random') {
    entryDirect = true
    start('random')
  } else if (q.mode === 'paper' && q.sourceId) {
    entryDirect = true
    start('paper', q.sourceId)
  }
})

onHide(() => {
  saveNow()
})

onUnload(() => {
  saveNow()
  stopTimer()
  setLeaveGuard(false)
})

// APP 和 H5：考试进行中按返回先确认。小程序拦不了返回键，用 enableAlertBeforeUnload 弹确认框。
onBackPress(() => {
  if (stage.value !== 'running' || submitted || questions.value.length === 0) return false
  uni.showModal({
    title: '退出考试',
    content: LEAVE_MESSAGE,
    confirmText: '退出',
    cancelText: '继续答题',
    success: (res) => {
      if (res.confirm) {
        saveNow()
        if (!EXAM_RESUMABLE) submitted = true
        stopTimer()
        uni.navigateBack()
      }
    },
  })
  return true
})

function setLeaveGuard(on: boolean) {
  // #ifdef MP-WEIXIN
  if (typeof wx === 'undefined') return
  if (on && typeof wx.enableAlertBeforeUnload === 'function') {
    wx.enableAlertBeforeUnload({ message: LEAVE_MESSAGE })
  } else if (!on && typeof wx.disableAlertBeforeUnload === 'function') {
    wx.disableAlertBeforeUnload()
  }
  // #endif
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function showError(err: unknown) {
  console.error('组卷失败', err)
  error.value = `试卷加载失败：${errText(err)}`
  stage.value = 'error'
}

/** 云模式下查进行中的考试；查询失败不影响选卷 */
async function findRunning(): Promise<ExamSession | null> {
  try {
    return await getRunningExam()
  } catch (err) {
    console.error('查询进行中的考试失败', err)
    return null
  }
}

function promptResume(s: ExamSession) {
  const minutes = Math.max(0, Math.ceil((s.deadline - Date.now()) / 60000))
  uni.showModal({
    title: '继续考试',
    content: `你有一场考试还在进行：${s.title}，剩余约 ${minutes} 分钟。`,
    confirmText: '继续考试',
    cancelText: '放弃考试',
    success: (res) => {
      if (res.confirm) {
        enter(s)
        return
      }
      uni.showModal({
        title: '放弃考试',
        content: '放弃后这场考试不计成绩，确定放弃吗？',
        confirmText: '放弃',
        cancelText: '继续考试',
        success: (r2) => {
          if (!r2.confirm) {
            enter(s)
            return
          }
          abandonExam(s).then(
            () => uni.showToast({ title: '已放弃', icon: 'none' }),
            (err) => uni.showToast({ title: `操作失败：${errText(err)}`, icon: 'none' }),
          )
        },
      })
    },
  })
}

const noticeTitle = computed(() => {
  if (examMode.value === 'paper') {
    const source = getSource(paperId.value)
    return source ? `${source.title} · ${source.questionCount} 题` : ''
  }
  return `随机组卷 · ${EXAM_RANDOM_COUNT} 题`
})

/** 选好试卷后先看开考须知，确认后才加载并计时 */
function start(mode: ExamMode, sourceId?: string) {
  examMode.value = mode
  paperId.value = sourceId || ''
  stage.value = 'notice'
}

function begin() {
  load()
}

function cancelNotice() {
  // 带参数直接进入时没有上一步可回，退回上一页
  if (getCurrentPages().length > 1 && entryDirect) uni.navigateBack()
  else stage.value = 'setup'
}

function retry() {
  load()
}

async function load() {
  stage.value = 'loading'
  error.value = ''
  loadingText.value = ''
  try {
    const res = await startExam({
      subjectId: subjectIdNow.value,
      mode: examMode.value,
      sourceId: examMode.value === 'paper' ? paperId.value : undefined,
      onProgress: (done, total) => {
        loadingText.value = total > 0 ? `正在组卷 ${done}/${total}…` : ''
      },
    })
    if (res.resumed) uni.showToast({ title: '你有一场进行中的考试，已为你恢复', icon: 'none', duration: 2500 })
    enter(res.session)
  } catch (err) {
    showError(err)
  }
}

/** 进入作答：新开的考试或恢复的考试 */
function enter(s: ExamSession) {
  session.value = s
  Object.keys(answers).forEach((k) => {
    delete answers[k]
  })
  s.questions.forEach((item) => {
    answers[item.id] = (s.answers[item.id] || []).slice()
  })
  dirty = false
  index.value = 0
  stage.value = 'running'
  uni.setNavigationBarTitle({ title: s.title })
  if (s.questions.length === 0) return
  startTimer()
}

function startTimer() {
  stopTimer()
  tick()
  if (submitted) return
  timer = setInterval(tick, 1000)
  if (EXAM_RESUMABLE) autosaveTimer = setInterval(saveNow, AUTOSAVE_MS)
  setLeaveGuard(true)
}

function stopTimer() {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
  if (autosaveTimer !== null) {
    clearInterval(autosaveTimer)
    autosaveTimer = null
  }
}

function tick() {
  const s = session.value
  if (!s) return
  remaining.value = Math.max(0, Math.ceil((s.deadline - Date.now()) / 1000))
  if (remaining.value <= 0) {
    finish(true)
    uni.showToast({ title: '时间到，已自动交卷', icon: 'none' })
  }
}

/** 云模式：有改动时把作答存到服务端（同时校准倒计时）；本机模式无操作 */
function saveNow() {
  const s = session.value
  if (!EXAM_RESUMABLE || !s || !dirty || submitted || stage.value !== 'running') return
  dirty = false
  s.answers = JSON.parse(JSON.stringify(answers)) as Record<string, number[]>
  saveExamProgress(s).catch((err) => {
    dirty = true
    console.error('保存作答失败', err)
  })
}

function onSelect(i: number) {
  const q = current.value
  if (!q || submitted) return
  const list = answers[q.id] || []
  if (q.type === 'multi') {
    const pos = list.indexOf(i)
    if (pos >= 0) list.splice(pos, 1)
    else list.push(i)
    answers[q.id] = list.slice()
  } else {
    answers[q.id] = [i]
  }
  dirty = true
}

function go(target: number) {
  if (target < 0 || target >= questions.value.length) return
  index.value = target
  saveNow()
}

function onCardSelect(i: number) {
  go(i)
  showCard.value = false
}

function onSubmit() {
  if (submitted) return
  const left = questions.value.length - answeredCount.value
  uni.showModal({
    title: '确认交卷',
    content: left > 0 ? `还有 ${left} 题未作答，未答题不得分。确定交卷吗？` : '已全部作答，确定交卷吗？',
    confirmText: '交卷',
    cancelText: '继续答题',
    success: (res) => {
      if (res.confirm) finish(false)
    },
  })
}

async function finish(auto: boolean) {
  const s = session.value
  if (submitted || !s) return
  submitted = true
  submitting.value = true
  stopTimer()
  setLeaveGuard(false)
  s.answers = answers
  try {
    const id = await finishExam(s, auto)
    uni.redirectTo({ url: `/pages/result/result?id=${id}` })
  } catch (err) {
    console.error('交卷失败', err)
    submitted = false
    submitting.value = false
    dirty = true
    uni.showModal({
      title: '交卷失败',
      content: `${errText(err)}。作答还在本页，请检查网络后重试。`,
      confirmText: '重试',
      cancelText: '稍后',
      success: (res) => {
        if (res.confirm) finish(auto)
        else if (s.deadline > Date.now()) startTimer()
      },
    })
  }
}
</script>

<style scoped>
.setup-desc {
  display: block;
}
.setup-btn {
  margin-top: 24rpx;
}
.notice-paper {
  display: block;
  margin-top: 8rpx;
  color: var(--color-primary);
  font-weight: bold;
}
.notice-list {
  margin-top: 20rpx;
}
.notice-item {
  display: block;
  margin-bottom: 16rpx;
  line-height: 1.7;
}
.notice-cancel {
  margin-top: 20rpx;
}
.setup-group {
  margin: 8rpx 4rpx 12rpx;
}
.setup-kind {
  display: block;
  margin: 0 4rpx 12rpx;
}
.paper-card {
  padding-top: 8rpx;
  padding-bottom: 8rpx;
}
.paper {
  padding: 24rpx 0;
  border-bottom: 2rpx solid var(--color-border);
}
.paper:last-child {
  border-bottom: none;
}
.paper-title {
  flex: 1;
}
.paper-count {
  flex-shrink: 0;
  margin-left: 16rpx;
}
.timer-card {
  padding: 20rpx 28rpx;
}
.timer {
  font-size: 30rpx;
  font-weight: bold;
  color: var(--color-primary);
}
.q-head {
  margin-bottom: 8rpx;
}
.submit-btn {
  margin: 8rpx 24rpx 0;
}
</style>
