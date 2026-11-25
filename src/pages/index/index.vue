<template>
  <view class="page">
    <view class="subject-tabs">
      <view
        v-for="s in bank.subjects"
        :key="s.id"
        :class="['subject-tab', s.id === subjectId ? 'subject-tab-on' : '']"
        @tap="onSwitch(s.id)"
      >
        <text>{{ s.shortName }}</text>
      </view>
    </view>

    <view class="card subject-card">
      <text class="subject-tip">当前科目</text>
      <text class="subject-name">{{ subjectName }}</text>
      <text v-if="noQuestions" class="subject-empty">该科目暂无题目</text>
      <view v-else class="stat-row subject-stats">
        <view class="stat">
          <text class="stat-num">{{ stats.done }}/{{ stats.total }}</text>
          <text class="stat-label">已做/总题数</text>
        </view>
        <view class="stat">
          <text class="stat-num">{{ stats.rate }}%</text>
          <text class="stat-label">正确率</text>
        </view>
        <view class="stat">
          <text class="stat-num">{{ wrongCount }}</text>
          <text class="stat-label">错题</text>
        </view>
      </view>
    </view>

    <view class="entry-grid">
      <view v-for="e in entries" :key="e.key" class="entry" @tap="onEntry(e.key)">
        <view class="entry-icon" :style="{ backgroundColor: e.color }">
          <text class="entry-icon-text">{{ e.icon }}</text>
        </view>
        <text class="entry-title">{{ e.title }}</text>
        <text class="entry-desc">{{ e.desc }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import {
  bank,
  currentSubject,
  favoriteIdsOf,
  getRunningExam,
  hasQuestions,
  setCurrentSubject,
  sourcesOf,
  statsOfSubject,
  subjectiveOf,
  user,
  wrongIdsOf,
} from '@/store'

type EntryKey = 'source' | 'random' | 'exam' | 'subjective' | 'favorite'

const subjectId = computed(() => (currentSubject.value ? currentSubject.value.id : ''))
const subjectName = computed(() => (currentSubject.value ? currentSubject.value.name : '加载中…'))
const stats = computed(() => statsOfSubject(subjectId.value))
const wrongCount = computed(() => wrongIdsOf(subjectId.value).length)
const favoriteCount = computed(() => favoriteIdsOf(subjectId.value).length)
const sourceCount = computed(() => sourcesOf(subjectId.value).length)
const subjectiveList = computed(() => subjectiveOf(subjectId.value))
const noQuestions = computed(() => bank.loaded && !hasQuestions(subjectId.value))
const masteredCount = computed(() => subjectiveList.value.filter((s) => user.masteredIds.indexOf(s.id) >= 0).length)

const entries = computed<{ key: EntryKey; title: string; desc: string; icon: string; color: string }[]>(() => [
  { key: 'source', title: '题集练习', desc: `真题、模拟卷、专题 ${sourceCount.value} 套`, icon: '集', color: '#2f6fed' },
  { key: 'random', title: '随机练习', desc: '每次随机抽 30 题', icon: '随', color: '#19a35b' },
  { key: 'exam', title: '模拟考试', desc: '整套卷或随机组卷', icon: '考', color: '#f0a020' },
  {
    key: 'subjective',
    title: '主观题',
    desc: `案例/计算 ${subjectiveList.value.length} 题，已掌握 ${masteredCount.value}`,
    icon: '案',
    color: '#7a5af8',
  },
  { key: 'favorite', title: '我的收藏', desc: `已收藏 ${favoriteCount.value} 题`, icon: '藏', color: '#e5484d' },
])

/** 每次启动只提示一次“继续考试”，用户选了稍后就不再打扰 */
let resumePrompted = false

onShow(() => {
  if (resumePrompted) return
  getRunningExam()
    .then((s) => {
      if (!s || resumePrompted) return
      resumePrompted = true
      const minutes = Math.max(0, Math.ceil((s.deadline - Date.now()) / 60000))
      uni.showModal({
        title: '继续考试',
        content: `你有一场考试还在进行：${s.title}，剩余约 ${minutes} 分钟。`,
        confirmText: '继续考试',
        cancelText: '稍后',
        success: (res) => {
          if (res.confirm) uni.navigateTo({ url: '/pages/exam/exam?resume=1' })
        },
      })
    })
    .catch((err) => console.error('查询进行中的考试失败', err))
})

function onEntry(key: EntryKey) {
  if (!bank.loaded) return
  if ((key === 'source' || key === 'random' || key === 'exam') && noQuestions.value) {
    uni.showToast({ title: '该科目暂无题目', icon: 'none' })
    return
  }
  switch (key) {
    case 'source':
      uni.navigateTo({ url: '/pages/sources/sources' })
      break
    case 'random':
      uni.navigateTo({ url: '/pages/practice/practice?mode=random' })
      break
    case 'exam':
      uni.navigateTo({ url: '/pages/exam/exam' })
      break
    case 'subjective':
      if (subjectiveList.value.length === 0) {
        uni.showToast({ title: '当前科目没有主观题', icon: 'none' })
        return
      }
      uni.navigateTo({ url: '/pages/subjective/list' })
      break
    case 'favorite':
      if (favoriteCount.value === 0) {
        uni.showToast({ title: '还没有收藏的题目', icon: 'none' })
        return
      }
      uni.navigateTo({ url: '/pages/practice/practice?mode=favorite' })
      break
  }
}

function onSwitch(id: string) {
  setCurrentSubject(id)
}
</script>

<style scoped>
.subject-tabs {
  display: flex;
  flex-direction: row;
  background-color: var(--color-card);
  border-radius: 40rpx;
  padding: 6rpx;
  margin-bottom: 24rpx;
}
.subject-tab {
  flex: 1;
  height: 64rpx;
  line-height: 64rpx;
  text-align: center;
  border-radius: 32rpx;
  font-size: 28rpx;
  color: var(--color-text-secondary);
}
.subject-tab-on {
  background-color: var(--color-primary);
  color: #ffffff;
  font-weight: bold;
}
.subject-card {
  background-color: var(--color-primary);
  color: #ffffff;
}
.subject-tip {
  display: block;
  font-size: 24rpx;
  opacity: 0.8;
}
.subject-name {
  display: block;
  font-size: 36rpx;
  font-weight: bold;
  margin: 8rpx 0 28rpx;
}
.subject-empty {
  display: block;
  font-size: 28rpx;
  opacity: 0.9;
}
.subject-stats .stat-label {
  color: rgba(255, 255, 255, 0.8);
}
.entry-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
}
.entry {
  width: 48.5%;
  box-sizing: border-box;
  background-color: var(--color-card);
  border-radius: 16rpx;
  padding: 32rpx 28rpx;
  margin-bottom: 20rpx;
  display: flex;
  flex-direction: column;
}
.entry-icon {
  width: 72rpx;
  height: 72rpx;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20rpx;
}
.entry-icon-text {
  color: #ffffff;
  font-size: 32rpx;
  font-weight: bold;
}
.entry-title {
  font-size: 32rpx;
  font-weight: bold;
}
.entry-desc {
  font-size: 24rpx;
  color: var(--color-text-muted);
  margin-top: 6rpx;
}
</style>
