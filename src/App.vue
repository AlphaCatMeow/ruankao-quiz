<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { initStore } from '@/store'

onLaunch(() => {
  initStore().catch(() => {
    uni.showToast({ title: '数据加载失败', icon: 'none' })
  })
})
</script>

<style>
/* 主题色与 src/uni.scss 中的 $app-color-* 保持一致 */
page {
  --color-primary: #2f6fed;
  --color-primary-light: #e8f0fe;
  --color-success: #19a35b;
  --color-success-light: #e6f6ed;
  --color-error: #e5484d;
  --color-error-light: #fdecec;
  --color-warning: #f0a020;
  --color-text: #1f2329;
  --color-text-secondary: #646a73;
  --color-text-muted: #8f959e;
  --color-border: #e5e6eb;
  --color-bg: #f5f6f8;
  --color-card: #ffffff;
  background-color: var(--color-bg);
  color: var(--color-text);
  font-size: 28rpx;
  line-height: 1.6;
}

/* ---------- 通用布局 ---------- */
.page {
  padding: 24rpx;
  box-sizing: border-box;
}
.card {
  background-color: var(--color-card);
  border-radius: 16rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
}
.row {
  display: flex;
  flex-direction: row;
  align-items: center;
}
.row-between {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.section-title {
  font-size: 30rpx;
  font-weight: bold;
  margin-bottom: 20rpx;
  display: block;
}
.muted {
  color: var(--color-text-muted);
  font-size: 24rpx;
}
.secondary {
  color: var(--color-text-secondary);
}
.link {
  color: var(--color-primary);
}
.empty {
  padding: 80rpx 0;
  text-align: center;
  color: var(--color-text-muted);
}

/* ---------- 按钮（用 view 实现，跨端样式一致） ---------- */
.btn {
  height: 84rpx;
  line-height: 84rpx;
  border-radius: 42rpx;
  text-align: center;
  font-size: 30rpx;
  background-color: var(--color-card);
  color: var(--color-text);
  border: 2rpx solid var(--color-border);
  box-sizing: border-box;
}
.btn-primary {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
  color: #ffffff;
}
.btn-danger {
  color: var(--color-error);
  border-color: var(--color-error);
}
.btn-disabled {
  opacity: 0.4;
}
.btn-small {
  height: 60rpx;
  line-height: 60rpx;
  border-radius: 30rpx;
  font-size: 26rpx;
  padding: 0 28rpx;
}

/* ---------- 统计 ---------- */
.stat-row {
  display: flex;
  flex-direction: row;
}
.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.stat-num {
  font-size: 40rpx;
  font-weight: bold;
}
.stat-label {
  font-size: 24rpx;
  color: var(--color-text-muted);
}

/* ---------- 进度条 ---------- */
.progress {
  height: 12rpx;
  border-radius: 6rpx;
  background-color: var(--color-border);
  overflow: hidden;
}
.progress-bar {
  height: 12rpx;
  border-radius: 6rpx;
  background-color: var(--color-primary);
}

/* ---------- 题目与选项 ---------- */
.q-type {
  display: inline-block;
  font-size: 22rpx;
  color: var(--color-primary);
  background-color: var(--color-primary-light);
  border-radius: 6rpx;
  padding: 2rpx 12rpx;
  margin-right: 12rpx;
}
.q-stem {
  font-size: 32rpx;
  line-height: 1.7;
}
.option {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  padding: 24rpx;
  margin-top: 20rpx;
  border-radius: 12rpx;
  border: 2rpx solid var(--color-border);
  background-color: var(--color-card);
}
.option-label {
  width: 48rpx;
  height: 48rpx;
  line-height: 48rpx;
  flex-shrink: 0;
  text-align: center;
  border-radius: 24rpx;
  border: 2rpx solid var(--color-border);
  font-size: 26rpx;
  margin-right: 20rpx;
  box-sizing: border-box;
}
.option-text {
  flex: 1;
  line-height: 48rpx;
}
.option-selected {
  border-color: var(--color-primary);
  background-color: var(--color-primary-light);
}
.option-selected .option-label {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
  color: #ffffff;
}
.option-right {
  border-color: var(--color-success);
  background-color: var(--color-success-light);
}
.option-right .option-label {
  background-color: var(--color-success);
  border-color: var(--color-success);
  color: #ffffff;
}
.option-wrong {
  border-color: var(--color-error);
  background-color: var(--color-error-light);
}
.option-wrong .option-label {
  background-color: var(--color-error);
  border-color: var(--color-error);
  color: #ffffff;
}
.text-right {
  color: var(--color-success);
}
.text-wrong {
  color: var(--color-error);
}
.analysis {
  margin-top: 28rpx;
  padding: 24rpx;
  border-radius: 12rpx;
  background-color: var(--color-bg);
}
.analysis-line {
  display: block;
  margin-bottom: 8rpx;
}

/* ---------- 底部操作栏 ---------- */
.bottom-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 16rpx 24rpx;
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
  background-color: var(--color-card);
  border-top: 2rpx solid var(--color-border);
  z-index: 10;
}
.bottom-bar .btn {
  flex: 1;
  margin: 0 8rpx;
}
.bottom-space {
  height: 160rpx;
}
</style>
