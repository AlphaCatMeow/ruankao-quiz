<template>
  <view class="page">
    <view v-if="groups.length === 0" class="empty">该科目暂无题目</view>
    <block v-for="g in groups" :key="g.kind">
      <text class="section-title group-title">{{ g.label }} · {{ g.rows.length }} 套</text>
      <view v-for="r in g.rows" :key="r.source.id" class="card source" @tap="open(r.source.id)">
        <view class="row-between">
          <text class="source-name">{{ r.source.title }}</text>
          <text class="link source-go">练习 ›</text>
        </view>
        <view class="row-between source-meta">
          <text class="muted">共 {{ r.stats.total }} 题 · 已做 {{ r.stats.done }} 题</text>
          <text class="muted">正确率 {{ r.stats.rate }}%</text>
        </view>
        <view class="progress">
          <view class="progress-bar" :style="{ width: r.percent + '%' }"></view>
        </view>
      </view>
    </block>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { currentSubject, initStore, SOURCE_KIND_LABEL, SOURCE_KIND_ORDER, sourcesOf, statsOfSource } from '@/store'

const groups = computed(() => {
  const subject = currentSubject.value
  if (!subject) return []
  return SOURCE_KIND_ORDER.map((kind) => ({
    kind,
    label: SOURCE_KIND_LABEL[kind],
    rows: sourcesOf(subject.id, kind).map((source) => {
      const stats = statsOfSource(source.id)
      const percent = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0
      return { source, stats, percent }
    }),
  })).filter((g) => g.rows.length > 0)
})

onLoad(() => {
  initStore()
})

function open(sourceId: string) {
  uni.navigateTo({ url: `/pages/practice/practice?mode=source&sourceId=${sourceId}` })
}
</script>

<style scoped>
.group-title {
  margin: 8rpx 4rpx 16rpx;
}
.source-name {
  flex: 1;
  font-size: 30rpx;
  font-weight: bold;
}
.source-go {
  flex-shrink: 0;
  margin-left: 16rpx;
}
.source-meta {
  margin: 12rpx 0 16rpx;
}
</style>
