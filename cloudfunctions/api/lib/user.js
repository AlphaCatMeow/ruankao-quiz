'use strict'

function newUser(openid, now) {
  return {
    _id: openid,
    openid,
    nickname: '',
    avatar: '',
    createdAt: now,
    lastLoginAt: now,
    points: 0,
    totalRecharged: 0,
    status: 'active',
    mastered: [],
  }
}

/** 返回给前端的用户信息，不含 openid */
function publicUser(u) {
  return {
    nickname: u.nickname || '',
    avatar: u.avatar || '',
    points: u.points || 0,
    totalRecharged: u.totalRecharged || 0,
    createdAt: u.createdAt || 0,
    mastered: Array.isArray(u.mastered) ? u.mastered.slice() : [],
  }
}

module.exports = { newUser, publicUser }
