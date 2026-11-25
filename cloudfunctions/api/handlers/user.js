'use strict'

const V = require('../lib/validate')
const { newUser, publicUser } = require('../lib/user')

/** 取用户文档，不存在就建（并发首登时只会有一份，因为 _id 就是 openid） */
async function ensureUser(ctx) {
  const { store, openid, now } = ctx
  const found = await store.getUser(openid)
  if (found) return { user: found, created: false }
  const doc = newUser(openid, now)
  const created = await store.createUser(doc)
  if (created) return { user: doc, created: true }
  const again = await store.getUser(openid)
  if (!again) throw new Error('创建用户失败')
  return { user: again, created: false }
}

async function login(ctx) {
  const { user, created } = await ensureUser(ctx)
  if (!created) {
    await ctx.store.updateUser(ctx.openid, { lastLoginAt: ctx.now })
    user.lastLoginAt = ctx.now
  }
  return Object.assign(publicUser(user), { isNew: created, serverNow: ctx.now })
}

async function updateProfile(ctx) {
  const p = V.payloadObject(ctx.payload)
  const nickname = V.nickname(p.nickname)
  const { user } = await ensureUser(ctx)
  await ctx.store.updateUser(ctx.openid, { nickname })
  user.nickname = nickname
  return publicUser(user)
}

module.exports = { ensureUser, login, updateProfile }
