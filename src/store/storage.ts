/**
 * 本机存储封装：基于 uni.getStorageSync / setStorageSync，小程序和 APP 通用。
 * 统一以 JSON 字符串保存，读取失败时返回默认值。
 */

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = uni.getStorageSync(key)
    if (raw === '' || raw === null || raw === undefined) return fallback
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T
  } catch (err) {
    console.error('读取本机存储失败', key, err)
    return fallback
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    uni.setStorageSync(key, JSON.stringify(value))
  } catch (err) {
    console.error('写入本机存储失败', key, err)
  }
}

export function removeKey(key: string): void {
  try {
    uni.removeStorageSync(key)
  } catch (err) {
    console.error('删除本机存储失败', key, err)
  }
}
