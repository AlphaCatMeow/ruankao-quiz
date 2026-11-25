<template>
  <view class="page reader">
    <LoadState :loading="loading" :error="error" text="正在打开资料…" @retry="load" />
    <template v-if="!loading && !error && cur">
      <view class="row-between toolbar">
        <text class="muted toolbar-info">第 {{ page + 1 }} / {{ pageCount }} 页</text>
        <view class="row">
          <text class="muted">字号</text>
          <text
            v-for="f in FONT_OPTIONS"
            :key="f.key"
            :class="['font-btn', reader.fontSize === f.key ? 'font-btn-on' : '']"
            @tap="onFont(f.key)"
          >{{ f.label }}</text>
        </view>
      </view>

      <view class="card content">
        <text v-if="page === 0" class="doc-title">{{ cur.title }}</text>
        <text
          v-for="(p, i) in pageParas"
          :key="page + '-' + i"
          class="para"
          :style="paraStyle"
          user-select
        >{{ p }}</text>
        <view v-if="page === pageCount - 1" class="muted doc-end">— 全文完 —</view>
      </view>
      <view class="bottom-space"></view>

      <view class="bottom-bar">
        <view :class="['btn', page === 0 ? 'btn-disabled' : '']" @tap="goPage(page - 1)">上一页</view>
        <picker class="picker" mode="selector" :range="pageLabels" :value="page" @change="onPick">
          <view class="btn">跳页</view>
        </picker>
        <view :class="['btn', 'btn-primary', page >= pageCount - 1 ? 'btn-disabled' : '']" @tap="goPage(page + 1)">下一页</view>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { onHide, onLoad, onPageScroll, onUnload } from '@dcloudio/uni-app'
import LoadState from '@/components/LoadState.vue'
import type { FontSizeLevel, MaterialPage } from '@/types'
import { getMaterialMeta, initStore, loadMaterialPage, reader, saveReadPosition, setFontSize } from '@/store'

const FONT_OPTIONS: { key: FontSizeLevel; label: string; rpx: number }[] = [
  { key: 'small', label: '小', rpx: 28 },
  { key: 'medium', label: '中', rpx: 32 },
  { key: 'large', label: '大', rpx: 38 },
]

const loading = ref(true)
const error = ref('')
const materialId = ref('')
/** 当前页。长文按页渲染（每页约 3000 字），避免一次渲染几十万字；云模式按页从服务端取 */
const cur = ref<MaterialPage | null>(null)
const page = ref(0)
let scrollTop = 0
let saveTimer: ReturnType<typeof setTimeout> | null = null
let turning = false

const pageCount = computed(() => (cur.value ? Math.max(1, cur.value.pageCount) : 1))
const pageParas = computed(() => (cur.value ? cur.value.paras : []))

const pageLabels = computed(() => Array.from({ length: pageCount.value }, (_, i) => `第 ${i + 1} 页`))

const paraStyle = computed(() => {
  const f = FONT_OPTIONS.find((x) => x.key === reader.fontSize) || FONT_OPTIONS[1]
  return `font-size:${f.rpx}rpx;`
})

onLoad((query) => {
  const q = (query || {}) as Record<string, string | undefined>
  materialId.value = q.id || ''
  load()
})

onPageScroll((e) => {
  scrollTop = e.scrollTop
  scheduleSave()
})

onHide(() => {
  flushSave()
})

onUnload(() => {
  flushSave()
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    await initStore()
    const meta = getMaterialMeta(materialId.value)
    if (meta) uni.setNavigationBarTitle({ title: meta.title })
    const saved = reader.positions[materialId.value]
    cur.value = await loadMaterialPage(materialId.value, saved ? Math.max(0, saved.page) : 0)
    page.value = cur.value.page
    loading.value = false
    if (saved && saved.page === page.value && saved.scrollTop > 0) {
      await nextTick()
      // 等渲染完成后再滚到上次位置
      setTimeout(() => {
        uni.pageScrollTo({ scrollTop: saved.scrollTop, duration: 0 })
      }, 80)
    }
  } catch (err) {
    console.error('加载资料失败', err)
    error.value = `资料加载失败：${err instanceof Error ? err.message : String(err)}`
    loading.value = false
  }
}

async function goPage(target: number) {
  if (turning || target < 0 || target >= pageCount.value || target === page.value) return
  turning = true
  let shown = false
  // 本机模式读缓存，几乎立即返回；云模式稍慢时显示加载提示
  const hint = setTimeout(() => {
    shown = true
    uni.showLoading({ title: '加载中' })
  }, 200)
  try {
    cur.value = await loadMaterialPage(materialId.value, target)
    page.value = cur.value.page
    scrollTop = 0
    uni.pageScrollTo({ scrollTop: 0, duration: 0 })
    flushSave()
  } catch (err) {
    console.error('翻页失败', err)
    uni.showToast({ title: `加载失败：${err instanceof Error ? err.message : String(err)}`, icon: 'none' })
  } finally {
    clearTimeout(hint)
    if (shown) uni.hideLoading()
    turning = false
  }
}

function onPick(e: { detail: { value: number | string } }) {
  goPage(Number(e.detail.value))
}

function onFont(key: FontSizeLevel) {
  setFontSize(key)
}

function scheduleSave() {
  if (saveTimer !== null) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (cur.value) saveReadPosition(materialId.value, page.value, scrollTop)
  }, 1000)
}

function flushSave() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (cur.value) saveReadPosition(materialId.value, page.value, scrollTop)
}
</script>

<style scoped>
.toolbar {
  margin-bottom: 16rpx;
}
.toolbar-info {
  flex: 1;
}
.font-btn {
  font-size: 26rpx;
  padding: 4rpx 18rpx;
  margin-left: 12rpx;
  border-radius: 20rpx;
  border: 2rpx solid var(--color-border);
  background-color: var(--color-card);
  color: var(--color-text-secondary);
}
.font-btn-on {
  border-color: var(--color-primary);
  background-color: var(--color-primary);
  color: #ffffff;
}
.doc-title {
  display: block;
  font-size: 34rpx;
  font-weight: bold;
  margin-bottom: 24rpx;
}
.para {
  display: block;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.8;
  margin-bottom: 24rpx;
}
.doc-end {
  text-align: center;
  padding: 16rpx 0;
}
.picker {
  flex: 1;
  margin: 0 8rpx;
}
.picker .btn {
  margin: 0;
}
</style>
