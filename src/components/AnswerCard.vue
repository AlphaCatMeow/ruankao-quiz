<template>
  <view v-if="visible" class="ac-mask" @tap="emit('close')">
    <view class="ac-panel" @tap.stop="noop">
      <view class="ac-header">
        <text class="ac-title">答题卡</text>
        <text class="ac-close" @tap="emit('close')">关闭</text>
      </view>
      <view class="ac-legend">
        <view v-for="l in legends" :key="l.status" class="ac-legend-item">
          <view :class="['ac-dot', 'ac-' + l.status]"></view>
          <text class="ac-legend-text">{{ l.text }}</text>
        </view>
      </view>
      <scroll-view scroll-y class="ac-scroll">
        <view class="ac-grid">
          <view
            v-for="(s, i) in statuses"
            :key="i"
            :class="['ac-item', 'ac-' + s, i === current ? 'ac-current' : '']"
            @tap="emit('select', i)"
          >
            <text>{{ i + 1 }}</text>
          </view>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CardStatus } from '@/types'

const props = defineProps<{
  visible: boolean
  statuses: CardStatus[]
  current: number
  /** 是否显示对错图例（考试中不显示） */
  showResult: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', index: number): void
}>()

const legends = computed(() =>
  props.showResult
    ? [
        { status: 'none', text: '未做' },
        { status: 'right', text: '答对' },
        { status: 'wrong', text: '答错' },
      ]
    : [
        { status: 'none', text: '未答' },
        { status: 'done', text: '已答' },
      ],
)

function noop() {
  // 阻止点击面板时关闭
}
</script>

<style scoped>
.ac-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.45);
  z-index: 100;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.ac-panel {
  background-color: #ffffff;
  border-top-left-radius: 24rpx;
  border-top-right-radius: 24rpx;
  padding: 28rpx 28rpx calc(28rpx + env(safe-area-inset-bottom));
}
.ac-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}
.ac-title {
  font-size: 32rpx;
  font-weight: bold;
}
.ac-close {
  color: var(--color-text-muted);
  font-size: 28rpx;
}
.ac-legend {
  display: flex;
  flex-direction: row;
  margin: 20rpx 0;
}
.ac-legend-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-right: 32rpx;
}
.ac-legend-text {
  font-size: 24rpx;
  color: var(--color-text-secondary);
}
.ac-dot {
  width: 24rpx;
  height: 24rpx;
  border-radius: 12rpx;
  margin-right: 8rpx;
  border: 2rpx solid var(--color-border);
  box-sizing: border-box;
}
.ac-scroll {
  max-height: 600rpx;
}
.ac-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}
.ac-item {
  width: 80rpx;
  height: 80rpx;
  line-height: 80rpx;
  margin: 12rpx;
  text-align: center;
  border-radius: 40rpx;
  border: 2rpx solid var(--color-border);
  box-sizing: border-box;
  font-size: 28rpx;
}
.ac-none {
  background-color: #ffffff;
}
.ac-done {
  background-color: var(--color-primary-light);
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.ac-right {
  background-color: var(--color-success);
  border-color: var(--color-success);
  color: #ffffff;
}
.ac-wrong {
  background-color: var(--color-error);
  border-color: var(--color-error);
  color: #ffffff;
}
.ac-current {
  border: 4rpx solid var(--color-text);
}
</style>
