<template>
  <view class="page">
    <view class="card summary row-between">
      <text class="secondary">{{ subjectName }} · 共 {{ total }} 题</text>
      <text class="muted">已掌握 {{ masteredCount }} 题</text>
    </view>
    <view v-if="groups.length === 0" class="empty">当前科目没有主观题</view>
    <block v-for="g in groups" :key="g.sourceId">
      <text class="muted group-title">{{ g.title }}</text>
      <view class="card group-card">
        <view v-for="item in g.items" :key="item.id" class="item row" @tap="open(item.id)">
          <text :class="['kind-tag', item.kind === 'calc' ? 'kind-calc' : '']">{{ KIND_LABEL[item.kind] }}</text>
          <text class="item-title">{{ item.title }}</text>
          <text v-if="isMastered(item.id)" class="text-right item-mark">已掌握</text>
          <text v-else-if="!item.hasAnswer" class="muted item-mark">无答案</text>
          <text class="muted item-arrow">›</text>
        </view>
      </view>
    </block>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { SubjectiveMeta } from '@/types'
import { currentSubject, getSource, initStore, isMastered, subjectiveOf } from '@/store'
import { SUBJECTIVE_KIND_LABEL as KIND_LABEL } from '@/utils/quiz'

const subjectId = computed(() => (currentSubject.value ? currentSubject.value.id : ''))
const subjectName = computed(() => (currentSubject.value ? currentSubject.value.shortName : ''))
const list = computed(() => subjectiveOf(subjectId.value))
const total = computed(() => list.value.length)
const masteredCount = computed(() => list.value.filter((x) => isMastered(x.id)).length)

const groups = computed(() => {
  const out: { sourceId: string; title: string; items: SubjectiveMeta[] }[] = []
  list.value.forEach((item) => {
    let g = out.find((x) => x.sourceId === item.sourceId)
    if (!g) {
      const s = getSource(item.sourceId)
      g = { sourceId: item.sourceId, title: s ? s.title : item.sourceId, items: [] }
      out.push(g)
    }
    g.items.push(item)
  })
  return out
})

onLoad(() => {
  initStore()
})

function open(id: string) {
  uni.navigateTo({ url: `/pages/subjective/detail?id=${id}` })
}
</script>

<style scoped>
.summary {
  padding: 20rpx 28rpx;
}
.group-title {
  display: block;
  margin: 0 4rpx 12rpx;
}
.group-card {
  padding-top: 8rpx;
  padding-bottom: 8rpx;
}
.item {
  padding: 24rpx 0;
  border-bottom: 2rpx solid var(--color-border);
}
.item:last-child {
  border-bottom: none;
}
.kind-tag {
  flex-shrink: 0;
  font-size: 22rpx;
  color: var(--color-primary);
  background-color: var(--color-primary-light);
  border-radius: 6rpx;
  padding: 2rpx 12rpx;
  margin-right: 16rpx;
}
.kind-calc {
  color: var(--color-warning);
  background-color: #fdf3e1;
}
.item-title {
  flex: 1;
  font-size: 28rpx;
}
.item-mark {
  flex-shrink: 0;
  font-size: 24rpx;
  margin-left: 12rpx;
}
.item-arrow {
  margin-left: 12rpx;
}
</style>
