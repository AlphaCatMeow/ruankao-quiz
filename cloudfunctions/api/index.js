'use strict'

/**
 * 云函数 api：login、bank.*、progress.*、exam.* 的统一入口。
 * 调用方式：wx.cloud.callFunction({ name: 'api', data: { action, payload } })
 * 用户身份只取 cloud.getWXContext().OPENID，前端传入的任何用户标识都不使用。
 */
const cloud = require('wx-server-sdk')
const { createCloudStore } = require('./store/cloud-store')
const { dispatch } = require('./router')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const store = createCloudStore(cloud.database())

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const e = event || {}
  return dispatch({ action: e.action, payload: e.payload, openid: OPENID, store })
}
