<template>
  <view class="tb">
    <block v-for="(b, i) in blocks" :key="i">
      <text v-if="b.type === 'text'" class="tb-text" :style="textStyle" user-select>{{ b.content }}</text>
      <scroll-view v-else scroll-x class="tb-table">
        <view class="tb-table-inner">
          <text v-for="(line, j) in b.lines" :key="j" class="tb-row" :style="rowStyle" space="nbsp" user-select>{{ line }}</text>
        </view>
      </scroll-view>
    </block>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { splitTextBlocks } from '@/utils/text'

const props = defineProps<{
  text: string
  /** 正文字号（rpx），不传用默认 */
  fontSize?: number
}>()

const blocks = computed(() => splitTextBlocks(props.text || ''))

const textStyle = computed(() => (props.fontSize ? `font-size:${props.fontSize}rpx;` : ''))
const rowStyle = computed(() => (props.fontSize ? `font-size:${Math.round(props.fontSize * 0.85)}rpx;` : ''))
</script>

<style scoped>
.tb-text {
  display: block;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.75;
  margin-bottom: 12rpx;
}
.tb-table {
  width: 100%;
  margin: 8rpx 0 20rpx;
  background-color: var(--color-bg);
  border-radius: 8rpx;
}
.tb-table-inner {
  display: inline-block;
  padding: 16rpx 20rpx;
  white-space: nowrap;
}
.tb-row {
  display: block;
  white-space: pre;
  font-family: Menlo, Consolas, 'Courier New', monospace;
  font-size: 24rpx;
  line-height: 1.6;
}
</style>
