<template>
  <view class="page">
    <view class="card summary row-between">
      <text class="secondary">{{ subjectName }} · 共 {{ list.length }} 份资料</text>
      <text class="muted">切换科目请到首页</text>
    </view>
    <view v-if="bank.loaded && bank.materials.length === 0" class="empty">暂无资料</view>
    <view v-else-if="groups.length === 0" class="empty">当前科目没有资料</view>
    <block v-for="g in groups" :key="g.category">
      <text class="section-title group-title">{{ g.category }} · {{ g.items.length }}</text>
      <view class="card group-card">
        <view v-for="m in g.items" :key="m.id" class="item" @tap="open(m.id)">
          <view class="row-between">
            <text class="item-title">{{ m.title }}</text>
            <text class="muted item-arrow">›</text>
          </view>
          <text class="muted">约 {{ formatChars(m.chars) }} 字{{ progressText(m.id) }}</text>
        </view>
      </view>
    </block>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MaterialMeta } from '@/types'
import { bank, currentSubject, materialsOf, reader } from '@/store'

const subjectId = computed(() => (currentSubject.value ? currentSubject.value.id : ''))
const subjectName = computed(() => (currentSubject.value ? currentSubject.value.shortName : ''))
const list = computed(() => materialsOf(subjectId.value))

/** 按固定分类顺序分组，空分类不显示 */
const groups = computed(() => {
  const out: { category: string; items: MaterialMeta[] }[] = []
  const order = bank.categories.slice()
  list.value.forEach((m) => {
    if (order.indexOf(m.category) < 0) order.push(m.category)
  })
  order.forEach((category) => {
    const items = list.value.filter((m) => m.category === category)
    if (items.length > 0) out.push({ category, items })
  })
  return out
})

function formatChars(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : `${n}`
}

function progressText(id: string): string {
  const pos = reader.positions[id]
  return pos ? ` · 上次读到第 ${pos.page + 1} 页` : ''
}

function open(id: string) {
  uni.navigateTo({ url: `/pages/reader/reader?id=${id}` })
}
</script>

<style scoped>
.summary {
  padding: 20rpx 28rpx;
}
.group-title {
  margin: 8rpx 4rpx 12rpx;
}
.group-card {
  padding-top: 8rpx;
  padding-bottom: 8rpx;
}
.item {
  padding: 22rpx 0;
  border-bottom: 2rpx solid var(--color-border);
  display: flex;
  flex-direction: column;
}
.item:last-child {
  border-bottom: none;
}
.item-title {
  flex: 1;
  font-size: 28rpx;
}
.item-arrow {
  margin-left: 12rpx;
}
</style>
