<template>
  <view class="page">
    <LoadState :loading="loading" :error="error" @retry="load" />
    <template v-if="!loading && !error">
      <view v-if="!item" class="empty">没有找到这道题</view>
      <template v-else>
        <view class="row-between top-info">
          <text class="muted">第 {{ position + 1 }} / {{ siblings.length }} 题</text>
          <text :class="['mastered', mastered ? 'text-right' : 'secondary']" @tap="onToggleMastered">{{ mastered ? '✓ 已掌握' : '标记已掌握' }}</text>
        </view>

        <view class="card">
          <view class="row title-row">
            <text :class="['kind-tag', item.kind === 'calc' ? 'kind-calc' : '']">{{ KIND_LABEL[item.kind] }}</text>
            <text class="title">{{ item.title }}</text>
          </view>
          <TextBlock :text="item.stem" :font-size="30" />
        </view>

        <view v-if="!hasAnswer" class="card">
          <text class="muted">这道题没有参考答案，可以对照资料栏目里的笔记或教材自行作答。</text>
        </view>
        <view v-else-if="!showAnswer" class="btn btn-primary answer-btn" @tap="showAnswer = true">查看参考答案</view>
        <view v-else class="card">
          <view class="row-between answer-head">
            <text class="section-title answer-title">参考答案</text>
            <text class="link" @tap="showAnswer = false">收起</text>
          </view>
          <TextBlock :text="item.answer" :font-size="30" />
        </view>
        <view class="bottom-space"></view>

        <view class="bottom-bar">
          <view :class="['btn', position <= 0 ? 'btn-disabled' : '']" @tap="go(position - 1)">上一题</view>
          <view :class="['btn', mastered ? '' : 'btn-primary']" @tap="onToggleMastered">{{ mastered ? '取消掌握' : '已掌握' }}</view>
          <view :class="['btn', position >= siblings.length - 1 ? 'btn-disabled' : '']" @tap="go(position + 1)">下一题</view>
        </view>
      </template>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import LoadState from '@/components/LoadState.vue'
import TextBlock from '@/components/TextBlock.vue'
import type { SubjectiveItem } from '@/types'
import { getSubjectiveMeta, initStore, isMastered, loadSubjectiveItem, subjectiveOf, toggleMastered } from '@/store'
import { SUBJECTIVE_KIND_LABEL as KIND_LABEL } from '@/utils/quiz'

const loading = ref(true)
const error = ref('')
const currentId = ref('')
const item = ref<SubjectiveItem | undefined>(undefined)
const showAnswer = ref(false)

/** 同科目的主观题，用于上一题/下一题 */
const siblings = computed(() => {
  const meta = getSubjectiveMeta(currentId.value)
  return meta ? subjectiveOf(meta.subjectId) : []
})
const position = computed(() => siblings.value.findIndex((x) => x.id === currentId.value))
const mastered = computed(() => (currentId.value ? isMastered(currentId.value) : false))
const hasAnswer = computed(() => !!(item.value && item.value.answer && item.value.answer.trim()))

onLoad((query) => {
  const q = (query || {}) as Record<string, string | undefined>
  currentId.value = q.id || ''
  load()
})

async function load() {
  loading.value = true
  error.value = ''
  showAnswer.value = false
  try {
    await initStore()
    item.value = await loadSubjectiveItem(currentId.value)
  } catch (err) {
    console.error('加载主观题失败', err)
    error.value = `加载失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    loading.value = false
  }
}

function go(target: number) {
  const next = siblings.value[target]
  if (!next) return
  currentId.value = next.id
  load().then(() => {
    uni.pageScrollTo({ scrollTop: 0, duration: 0 })
  })
}

function onToggleMastered() {
  if (!currentId.value) return
  const on = toggleMastered(currentId.value)
  uni.showToast({ title: on ? '已标记为掌握' : '已取消标记', icon: 'none' })
}
</script>

<style scoped>
.top-info {
  margin-bottom: 16rpx;
}
.mastered {
  font-size: 26rpx;
}
.title-row {
  align-items: flex-start;
  margin-bottom: 16rpx;
}
.kind-tag {
  flex-shrink: 0;
  font-size: 22rpx;
  color: var(--color-primary);
  background-color: var(--color-primary-light);
  border-radius: 6rpx;
  padding: 2rpx 12rpx;
  margin-right: 16rpx;
  margin-top: 6rpx;
}
.kind-calc {
  color: var(--color-warning);
  background-color: #fdf3e1;
}
.title {
  flex: 1;
  font-size: 30rpx;
  font-weight: bold;
}
.answer-btn {
  margin: 0 24rpx 24rpx;
}
.answer-head {
  margin-bottom: 8rpx;
}
.answer-title {
  margin-bottom: 0;
}
</style>
