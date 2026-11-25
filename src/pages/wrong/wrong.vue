<template>
  <view class="page">
    <view class="card summary">
      <view class="row-between">
        <view>
          <text class="summary-num">{{ total }}</text>
          <text class="secondary"> 道错题</text>
        </view>
        <text v-if="total > 0" class="link" @tap="onClear">清空</text>
      </view>
      <text class="muted">{{ subjectName }} · 答错的题会自动收录；错题练习中答对后可移出。</text>
      <view :class="['btn', 'btn-primary', 'summary-btn', total === 0 ? 'btn-disabled' : '']" @tap="start('')">开始错题练习</view>
    </view>

    <template v-if="groups.length > 0">
      <text class="section-title">按题集</text>
      <view class="card group-card">
        <view v-for="g in groups" :key="g.id" class="group row-between" @tap="start(g.id, g.count)">
          <text class="group-name">{{ g.name }}</text>
          <view class="row">
            <text class="text-wrong">{{ g.count }} 题</text>
            <text class="muted group-arrow">›</text>
          </view>
        </view>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { clearWrong, currentSubject, sourceIdOfQuestion, sourcesOf, wrongIdsOf } from '@/store'

const subjectId = computed(() => (currentSubject.value ? currentSubject.value.id : ''))
const subjectName = computed(() => (currentSubject.value ? currentSubject.value.shortName : ''))
const wrongIds = computed(() => wrongIdsOf(subjectId.value))
const total = computed(() => wrongIds.value.length)

const groups = computed(() => {
  const counts: Record<string, number> = {}
  wrongIds.value.forEach((id) => {
    const sid = sourceIdOfQuestion(id)
    counts[sid] = (counts[sid] || 0) + 1
  })
  return sourcesOf(subjectId.value)
    .filter((s) => counts[s.id] > 0)
    .map((s) => ({ id: s.id, name: s.title, count: counts[s.id] }))
})

function start(sourceId: string, count?: number) {
  const n = count === undefined ? total.value : count
  if (n === 0) {
    uni.showToast({ title: '没有错题', icon: 'none' })
    return
  }
  const suffix = sourceId ? `&sourceId=${sourceId}` : ''
  uni.navigateTo({ url: `/pages/practice/practice?mode=wrong${suffix}` })
}

function onClear() {
  uni.showModal({
    title: '清空错题本',
    content: `将移除当前科目的 ${total.value} 道错题，作答记录保留。确定清空吗？`,
    confirmText: '清空',
    confirmColor: '#e5484d',
    success: (res) => {
      if (res.confirm) {
        clearWrong(subjectId.value)
        uni.showToast({ title: '已清空', icon: 'none' })
      }
    },
  })
}
</script>

<style scoped>
.summary-num {
  font-size: 56rpx;
  font-weight: bold;
  color: var(--color-error);
}
.summary-btn {
  margin-top: 24rpx;
}
.group-card {
  padding-top: 8rpx;
  padding-bottom: 8rpx;
}
.group {
  padding: 24rpx 0;
  border-bottom: 2rpx solid var(--color-border);
}
.group:last-child {
  border-bottom: none;
}
.group-name {
  flex: 1;
  margin-right: 16rpx;
}
.group-arrow {
  margin-left: 12rpx;
}
</style>
