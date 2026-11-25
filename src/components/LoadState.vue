<template>
  <view v-if="loading" class="ls-box">
    <text class="ls-text">{{ text || '加载中…' }}</text>
  </view>
  <view v-else-if="error" class="ls-box">
    <text class="ls-error">{{ error }}</text>
    <view class="btn btn-small ls-retry" @tap="emit('retry')">重试</view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  loading: boolean
  /** 有值时显示失败提示和重试按钮 */
  error: string
  /** 加载中显示的文字 */
  text?: string
}>()

const emit = defineEmits<{
  (e: 'retry'): void
}>()
</script>

<style scoped>
.ls-box {
  padding: 80rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.ls-text {
  color: var(--color-text-muted);
}
.ls-error {
  color: var(--color-error);
  text-align: center;
  margin-bottom: 28rpx;
  word-break: break-all;
}
.ls-retry {
  min-width: 200rpx;
}
</style>
