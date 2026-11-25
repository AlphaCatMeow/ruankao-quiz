<template>
  <view class="page">
    <view v-if="!ready" class="empty">加载中…</view>
    <LoadState v-else-if="!exam && error" :loading="false" :error="error" @retry="load" />
    <view v-else-if="!exam" class="empty">没有找到这次考试记录</view>
    <template v-else>
      <view class="card score-card">
        <text class="muted">{{ exam.title || '模拟考试' }}</text>
        <text class="score">{{ exam.score }}</text>
        <text class="score-unit">分</text>
        <view class="stat-row score-stats">
          <view class="stat">
            <text class="stat-num">{{ exam.correctCount }}/{{ exam.total }}</text>
            <text class="stat-label">答对/总题数</text>
          </view>
          <view class="stat">
            <text class="stat-num">{{ formatDuration(exam.durationSec) }}</text>
            <text class="stat-label">用时</text>
          </view>
        </view>
        <text class="muted score-time">{{ formatDateTime(exam.endTime) }}{{ exam.timedOut ? ' · 超时未交卷，按保存的作答计分' : exam.autoSubmitted ? ' · 时间到自动交卷' : '' }}</text>
      </view>

      <view class="row-between review-head">
        <text class="section-title">逐题回顾</text>
        <text class="link" @tap="onlyWrong = !onlyWrong">{{ onlyWrong ? '显示全部' : '只看错题' }}</text>
      </view>
      <LoadState :loading="loading" :error="error" text="正在加载题目…" @retry="load" />
      <template v-if="!loading && !error">
        <view v-if="reviewRows.length === 0" class="empty">全部答对</view>
        <view v-for="row in reviewRows" :key="row.q.id" class="card">
          <view class="q-head">
            <view class="row q-tags">
              <text :class="['review-no', row.item.correct ? 'text-right' : 'text-wrong']">{{ row.no }}. {{ row.item.correct ? '正确' : row.item.userAnswer.length ? '错误' : '未答' }}</text>
              <text class="q-type">{{ TYPE_LABEL[row.q.type] }}</text>
            </view>
            <TextBlock :text="row.q.stem" :font-size="32" />
          </view>
          <view
            v-for="(opt, i) in row.q.options"
            :key="i"
            :class="['option', optionClass(row.q.answer, row.item.userAnswer, i)]"
          >
            <text class="option-label">{{ row.q.type === 'judge' ? (i === 0 ? '对' : '错') : optionLabel(i) }}</text>
            <text class="option-text">{{ opt }}</text>
          </view>
          <view class="analysis">
            <text class="analysis-line">你的答案：{{ formatAnswer(row.q, row.item.userAnswer) }}</text>
            <text class="analysis-line">正确答案：{{ formatAnswer(row.q, row.q.answer) }}</text>
            <text class="analysis-line secondary">解析：</text>
            <TextBlock v-if="row.q.explanation" :text="row.q.explanation" />
            <text v-else class="analysis-line muted">暂无解析</text>
          </view>
        </view>
        <view v-if="missing > 0" class="muted missing">有 {{ missing }} 道题已不在当前题库中，未显示。</view>
      </template>
      <view class="bottom-space"></view>

      <view class="bottom-bar">
        <view class="btn" @tap="goHome">返回首页</view>
        <view class="btn btn-primary" @tap="again">再考一次</view>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import LoadState from '@/components/LoadState.vue'
import TextBlock from '@/components/TextBlock.vue'
import type { ExamItem, ExamRecord, Question } from '@/types'
import { getExam, initStore, loadExamDetail } from '@/store'
import { formatAnswer, formatDateTime, formatDuration, optionLabel, TYPE_LABEL } from '@/utils/quiz'

const ready = ref(false)
const loading = ref(false)
const error = ref('')
const examId = ref('')
const onlyWrong = ref(false)
const questionMap = ref<Record<string, Question>>({})

const exam = ref<ExamRecord | undefined>(undefined)

const reviewRows = computed(() => {
  const e = exam.value
  if (!e) return []
  const rows: { no: number; q: Question; item: ExamItem }[] = []
  e.items.forEach((item, i) => {
    const q = questionMap.value[item.questionId]
    if (!q) return
    if (onlyWrong.value && item.correct) return
    rows.push({ no: i + 1, q, item })
  })
  return rows
})

const missing = computed(() => {
  const e = exam.value
  if (!e) return 0
  return e.items.filter((item) => !questionMap.value[item.questionId]).length
})

onLoad((query) => {
  const q = (query || {}) as Record<string, string | undefined>
  examId.value = q.id || ''
  load()
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    await initStore()
    // 先显示已有的成绩摘要，逐题详情加载完再补上
    if (!exam.value) exam.value = getExam(examId.value)
    ready.value = true
    const detail = examId.value ? await loadExamDetail(examId.value) : null
    exam.value = detail ? detail.exam : undefined
    questionMap.value = detail ? detail.questions : {}
  } catch (err) {
    console.error('加载成绩失败', err)
    error.value = `加载失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    loading.value = false
    ready.value = true
  }
}

function optionClass(answer: number[], userAnswer: number[], i: number): string {
  if (answer.indexOf(i) >= 0) return 'option-right'
  if (userAnswer.indexOf(i) >= 0) return 'option-wrong'
  return ''
}

function goHome() {
  uni.switchTab({ url: '/pages/index/index' })
}

function again() {
  const e = exam.value
  if (e && e.mode === 'paper' && e.sourceId) {
    uni.redirectTo({ url: `/pages/exam/exam?mode=paper&sourceId=${e.sourceId}` })
  } else {
    uni.redirectTo({ url: '/pages/exam/exam?mode=random' })
  }
}
</script>

<style scoped>
.score-card {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.score {
  font-size: 96rpx;
  font-weight: bold;
  color: var(--color-primary);
  line-height: 1.2;
}
.score-unit {
  color: var(--color-text-muted);
  margin-bottom: 24rpx;
}
.score-stats {
  width: 100%;
}
.score-time {
  margin-top: 20rpx;
}
.review-head {
  margin: 8rpx 4rpx 0;
}
.review-no {
  font-weight: bold;
  margin-right: 12rpx;
}
.q-head {
  margin-bottom: 8rpx;
}
.q-tags {
  margin-bottom: 12rpx;
}
.missing {
  display: block;
  text-align: center;
  margin-bottom: 24rpx;
}
</style>
