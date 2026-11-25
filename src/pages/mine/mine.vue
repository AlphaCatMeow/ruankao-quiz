<template>
  <view class="page">
    <view v-if="profile.enabled" class="card">
      <view class="row-between">
        <view class="profile-info">
          <text class="profile-name">{{ profile.nickname || '未设置昵称' }}</text>
          <text class="link profile-edit" @tap="onEditNickname">修改昵称</text>
        </view>
        <view class="stat profile-points">
          <text class="stat-num">{{ profile.points }}</text>
          <text class="stat-label">积分</text>
        </view>
      </view>
    </view>

    <view class="card">
      <text class="section-title">学习统计 · {{ subjectName }}</text>
      <view class="stat-row">
        <view class="stat">
          <text class="stat-num">{{ stats.done }}</text>
          <text class="stat-label">已做题数</text>
        </view>
        <view class="stat">
          <text class="stat-num">{{ stats.attempts }}</text>
          <text class="stat-label">作答次数</text>
        </view>
        <view class="stat">
          <text class="stat-num">{{ stats.rate }}%</text>
          <text class="stat-label">正确率</text>
        </view>
        <view class="stat">
          <text class="stat-num">{{ favoriteCount }}</text>
          <text class="stat-label">收藏</text>
        </view>
      </view>
    </view>

    <view class="card">
      <text class="section-title">各题集进度</text>
      <view v-if="sourceRows.length === 0" class="muted">还没有做过题</view>
      <view v-for="r in sourceRows" :key="r.id" class="source-row">
        <view class="row-between">
          <text class="source-name">{{ r.name }}</text>
          <text class="muted source-num">{{ r.done }}/{{ r.total }} · 正确率 {{ r.rate }}%</text>
        </view>
        <view class="progress">
          <view class="progress-bar" :style="{ width: r.percent + '%' }"></view>
        </view>
      </view>
      <text v-if="untouched > 0" class="muted">另有 {{ untouched }} 套题集尚未开始</text>
    </view>

    <view class="card">
      <text class="section-title">考试历史</text>
      <view v-if="exams.length === 0" class="muted">还没有参加过模拟考试</view>
      <view v-for="e in exams" :key="e.id" class="exam-row row-between" @tap="openExam(e.id)">
        <view class="exam-info">
          <text class="exam-time">{{ e.title || '模拟考试' }}</text>
          <text class="muted">{{ formatDateTime(e.endTime) }} · 答对 {{ e.correctCount }}/{{ e.total }} · 用时 {{ formatDuration(e.durationSec) }}</text>
        </view>
        <text class="exam-score">{{ e.score }} 分</text>
      </view>
    </view>

    <view v-if="!profile.enabled" class="btn btn-danger" @tap="onClearAll">清除全部数据</view>
    <text class="muted footer">题库与资料仅供个人学习参考。</text>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import {
  clearAllData,
  currentSubject,
  favoriteIdsOf,
  profile,
  refreshProfile,
  SOURCE_KIND_LABEL,
  sourcesOf,
  statsOfSource,
  statsOfSubject,
  updateNickname,
  user,
} from '@/store'
import { formatDateTime, formatDuration } from '@/utils/quiz'

const subjectId = computed(() => (currentSubject.value ? currentSubject.value.id : ''))
const subjectName = computed(() => (currentSubject.value ? currentSubject.value.shortName : ''))
const stats = computed(() => statsOfSubject(subjectId.value))
const favoriteCount = computed(() => favoriteIdsOf(subjectId.value).length)
const exams = computed(() => user.exams.filter((e) => e.subjectId === subjectId.value))

const allSources = computed(() => sourcesOf(subjectId.value))

/** 只列出做过的题集，按真题、模拟卷、专题的顺序 */
const sourceRows = computed(() =>
  allSources.value
    .map((src) => {
      const s = statsOfSource(src.id)
      return {
        id: src.id,
        name: `${SOURCE_KIND_LABEL[src.kind]} · ${src.title}`,
        done: s.done,
        total: s.total,
        rate: s.rate,
        percent: s.total > 0 ? Math.round((s.done / s.total) * 100) : 0,
      }
    })
    .filter((r) => r.done > 0),
)

const untouched = computed(() => allSources.value.length - sourceRows.value.length)

onShow(() => {
  // 云模式：积分可能在别处变动，每次进入刷新
  if (profile.enabled) refreshProfile()
})

function onEditNickname() {
  uni.showModal({
    title: '修改昵称',
    editable: true,
    placeholderText: '最多 20 个字',
    content: profile.nickname,
    confirmText: '保存',
    success: (res) => {
      if (!res.confirm) return
      const name = String(res.content || '').trim()
      if (!name) {
        uni.showToast({ title: '昵称不能为空', icon: 'none' })
        return
      }
      updateNickname(name).then(
        () => uni.showToast({ title: '已保存', icon: 'none' }),
        (err) => uni.showToast({ title: `保存失败：${err instanceof Error ? err.message : String(err)}`, icon: 'none' }),
      )
    },
  })
}

function openExam(id: string) {
  uni.navigateTo({ url: `/pages/result/result?id=${id}` })
}

function onClearAll() {
  uni.showModal({
    title: '清除全部数据',
    content: '将删除所有作答记录、错题、收藏、考试历史、已掌握标记和阅读位置，且无法恢复。确定清除吗？',
    confirmText: '清除',
    confirmColor: '#e5484d',
    success: (res) => {
      if (res.confirm) {
        clearAllData()
        uni.showToast({ title: '已清除', icon: 'none' })
      }
    },
  })
}
</script>

<style scoped>
.profile-info {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.profile-name {
  font-size: 34rpx;
  font-weight: bold;
}
.profile-edit {
  font-size: 24rpx;
  margin-top: 8rpx;
}
.profile-points {
  flex: none;
  min-width: 140rpx;
}
.source-row {
  margin-bottom: 24rpx;
}
.source-name {
  flex: 1;
  font-size: 28rpx;
  margin-right: 16rpx;
}
.source-num {
  flex-shrink: 0;
}
.source-row .row-between {
  margin-bottom: 10rpx;
}
.exam-row {
  padding: 20rpx 0;
  border-bottom: 2rpx solid var(--color-border);
}
.exam-row:last-child {
  border-bottom: none;
}
.exam-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  margin-right: 16rpx;
}
.exam-time {
  font-size: 28rpx;
}
.exam-score {
  flex-shrink: 0;
  font-size: 34rpx;
  font-weight: bold;
  color: var(--color-primary);
}
.footer {
  display: block;
  text-align: center;
  margin: 24rpx 0;
}
</style>
