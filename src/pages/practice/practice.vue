<template>
  <view class="page">
    <LoadState :loading="loading" :error="error" :text="loadingText" @retry="load" />
    <template v-if="!loading && !error">
      <view v-if="list.length === 0" class="empty">{{ emptyText }}</view>
      <template v-else>
        <view class="row-between top-info">
          <text class="muted top-title">{{ modeTitle }} · 第 {{ index + 1 }} / {{ list.length }} 题</text>
          <text :class="['fav', favorite ? 'fav-on' : '']" @tap="onToggleFavorite">{{ favorite ? '★ 已收藏' : '☆ 收藏' }}</text>
        </view>

        <view class="card">
          <view class="q-head">
            <view class="row q-tags">
              <text class="q-type">{{ typeLabel }}</text>
              <text v-if="sourceTag" class="muted">{{ sourceTag }}</text>
            </view>
            <TextBlock :text="current.stem" :font-size="32" />
          </view>
          <view
            v-for="(opt, i) in current.options"
            :key="i"
            :class="['option', optionClass(i)]"
            @tap="onSelect(i)"
          >
            <text class="option-label">{{ current.type === 'judge' ? (i === 0 ? '对' : '错') : optionLabel(i) }}</text>
            <text class="option-text">{{ opt }}</text>
          </view>

          <view v-if="session.submitted" class="analysis">
            <text :class="['analysis-line', 'result-text', session.correct ? 'text-right' : 'text-wrong']">
              {{ session.correct ? '回答正确' : '回答错误' }}
            </text>
            <text class="analysis-line">你的答案：{{ formatAnswer(current, session.selected) }}</text>
            <text class="analysis-line">正确答案：{{ formatAnswer(current, current.answer) }}</text>
            <text class="analysis-line secondary">解析：</text>
            <TextBlock v-if="current.explanation" :text="current.explanation" />
            <text v-else class="analysis-line muted">暂无解析</text>
            <view v-if="mode === 'wrong' && session.correct" class="remove-row">
              <text v-if="removed[current.id]" class="muted">已移出错题本</text>
              <view v-else class="btn btn-small" @tap="onRemoveWrong">移出错题本</view>
            </view>
          </view>
        </view>
        <view class="bottom-space"></view>

        <view class="bottom-bar">
          <view :class="['btn', index === 0 ? 'btn-disabled' : '']" @tap="go(index - 1)">上一题</view>
          <view class="btn" @tap="showCard = true">答题卡</view>
          <view v-if="!session.submitted" :class="['btn', 'btn-primary', session.selected.length === 0 ? 'btn-disabled' : '']" @tap="onSubmit">提交</view>
          <view v-else class="btn btn-primary" @tap="onNext">{{ index === list.length - 1 ? '完成' : '下一题' }}</view>
        </view>

        <AnswerCard
          :visible="showCard"
          :statuses="cardStatuses"
          :current="index"
          :show-result="true"
          @close="showCard = false"
          @select="onCardSelect"
        />
      </template>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AnswerCard from '@/components/AnswerCard.vue'
import LoadState from '@/components/LoadState.vue'
import TextBlock from '@/components/TextBlock.vue'
import type { CardStatus, PracticeMode, Question } from '@/types'
import {
  currentSubject,
  favoriteIdsOf,
  flushPendingAnswers,
  getSource,
  initStore,
  isFavorite,
  loadQuestionsByIds,
  loadRandomQuestions,
  loadSourceQuestions,
  recordAnswer,
  removeWrong,
  toggleFavorite,
  wrongIdsOf,
} from '@/store'
import { formatAnswer, optionLabel, TYPE_LABEL } from '@/utils/quiz'

interface Session {
  selected: number[]
  submitted: boolean
  correct: boolean
}

/** 随机练习每次抽题数量 */
const RANDOM_COUNT = 30

const MODE_TITLE: Record<PracticeMode, string> = {
  source: '题集练习',
  random: '随机练习',
  wrong: '错题练习',
  favorite: '收藏练习',
}

const loading = ref(true)
const loadingText = ref('')
const error = ref('')
const mode = ref<PracticeMode>('source')
const sourceId = ref('')
const modeTitle = ref('')
const list = ref<Question[]>([])
const index = ref(0)
const sessions = reactive<Record<string, Session>>({})
/** 本次练习中已移出错题本的题 */
const removed = reactive<Record<string, boolean>>({})
const showCard = ref(false)

const EMPTY_SESSION: Session = { selected: [], submitted: false, correct: false }

const current = computed(() => list.value[index.value])
const session = computed<Session>(() => (current.value && sessions[current.value.id]) || EMPTY_SESSION)
const typeLabel = computed(() => (current.value ? TYPE_LABEL[current.value.type] : ''))
const favorite = computed(() => (current.value ? isFavorite(current.value.id) : false))
/** 非整套练习时标出题目出处 */
const sourceTag = computed(() => {
  const q = current.value
  if (!q || mode.value === 'source') return ''
  const s = getSource(q.sourceId)
  return s ? `${s.title} 第 ${q.no} 题` : ''
})

const emptyText = computed(() => {
  if (mode.value === 'wrong') return '错题本是空的，继续保持'
  if (mode.value === 'favorite') return '还没有收藏的题目'
  return '该科目暂无题目'
})

const cardStatuses = computed<CardStatus[]>(() =>
  list.value.map((q) => {
    const s = sessions[q.id]
    if (!s || !s.submitted) return 'none'
    return s.correct ? 'right' : 'wrong'
  }),
)

onLoad((query) => {
  const q = (query || {}) as Record<string, string | undefined>
  const m = q.mode as PracticeMode
  mode.value = MODE_TITLE[m] ? m : 'source'
  sourceId.value = q.sourceId || ''
  const source = sourceId.value ? getSource(sourceId.value) : undefined
  modeTitle.value = source && mode.value === 'source' ? source.title : MODE_TITLE[mode.value]
  if (source && mode.value === 'wrong') modeTitle.value = `错题 · ${source.title}`
  uni.setNavigationBarTitle({ title: MODE_TITLE[mode.value] })
  load()
})

async function fetchQuestions(): Promise<Question[]> {
  const subject = currentSubject.value
  const subjectId = subject ? subject.id : ''
  switch (mode.value) {
    case 'source':
      return sourceId.value ? loadSourceQuestions(sourceId.value) : []
    case 'random':
      return loadRandomQuestions(subjectId, RANDOM_COUNT, (done, total) => {
        loadingText.value = total > 0 ? `正在加载题库 ${done}/${total}…` : ''
      })
    case 'wrong':
      return loadQuestionsByIds(wrongIdsOf(subjectId, sourceId.value || undefined))
    case 'favorite':
      return loadQuestionsByIds(favoriteIdsOf(subjectId))
  }
  return []
}

async function load() {
  loading.value = true
  loadingText.value = ''
  error.value = ''
  try {
    await initStore()
    // 云模式：上次没送达服务端的作答在这里重试
    flushPendingAnswers()
    const questions = await fetchQuestions()
    questions.forEach((item) => {
      sessions[item.id] = { selected: [], submitted: false, correct: false }
    })
    list.value = questions
    index.value = 0
  } catch (err) {
    console.error('加载题目失败', err)
    error.value = `题目加载失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    loading.value = false
  }
}

function optionClass(i: number): string {
  const s = session.value
  const q = current.value
  if (!q) return ''
  if (!s.submitted) return s.selected.indexOf(i) >= 0 ? 'option-selected' : ''
  if (q.answer.indexOf(i) >= 0) return 'option-right'
  if (s.selected.indexOf(i) >= 0) return 'option-wrong'
  return ''
}

function onSelect(i: number) {
  const q = current.value
  if (!q) return
  const s = sessions[q.id]
  if (!s || s.submitted) return
  if (q.type === 'multi') {
    const pos = s.selected.indexOf(i)
    if (pos >= 0) s.selected.splice(pos, 1)
    else s.selected.push(i)
  } else {
    s.selected = [i]
  }
}

function onSubmit() {
  const q = current.value
  if (!q) return
  const s = sessions[q.id]
  if (!s || s.submitted) return
  if (s.selected.length === 0) {
    uni.showToast({ title: '请先选择答案', icon: 'none' })
    return
  }
  s.correct = recordAnswer(q, s.selected)
  s.submitted = true
}

function go(target: number) {
  if (target < 0 || target >= list.value.length) return
  index.value = target
}

function onNext() {
  if (index.value < list.value.length - 1) {
    go(index.value + 1)
    return
  }
  const total = list.value.length
  const done = cardStatuses.value.filter((s) => s !== 'none').length
  const right = cardStatuses.value.filter((s) => s === 'right').length
  uni.showModal({
    title: '本轮练习结束',
    content: `共 ${total} 题，已答 ${done} 题，答对 ${right} 题。`,
    confirmText: '返回',
    cancelText: '留在本页',
    success: (res) => {
      if (res.confirm) uni.navigateBack()
    },
  })
}

function onCardSelect(i: number) {
  go(i)
  showCard.value = false
}

function onToggleFavorite() {
  const q = current.value
  if (!q) return
  const on = toggleFavorite(q.id)
  uni.showToast({ title: on ? '已收藏' : '已取消收藏', icon: 'none' })
}

function onRemoveWrong() {
  const q = current.value
  if (!q) return
  removeWrong(q.id)
  removed[q.id] = true
  uni.showToast({ title: '已移出错题本', icon: 'none' })
}
</script>

<style scoped>
.top-info {
  margin-bottom: 16rpx;
}
.top-title {
  flex: 1;
}
.fav {
  flex-shrink: 0;
  font-size: 26rpx;
  color: var(--color-text-secondary);
  padding: 4rpx 0 4rpx 20rpx;
}
.fav-on {
  color: var(--color-warning);
}
.q-head {
  margin-bottom: 8rpx;
}
.q-tags {
  margin-bottom: 12rpx;
}
.result-text {
  font-weight: bold;
  font-size: 30rpx;
}
.remove-row {
  margin-top: 16rpx;
  display: flex;
  flex-direction: row;
}
</style>
