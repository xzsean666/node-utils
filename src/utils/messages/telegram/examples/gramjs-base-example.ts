import { TelegramJSBase } from '../telegramBase';
import dotenv from 'dotenv';
dotenv.config();

/**
 * GramJSBase 完整使用示例
 * 展示两步认证、消息发送、文件传输等功能
 */

// 配置信息（请替换为你的实际值）
const config = {
  apiId: 12968078, // 从 https://my.telegram.org/apps 获取
  apiHash: process.env.TELEGRAM_TEST_KEY!, // 从 https://my.telegram.org/apps 获取
  phoneNumber: '+8618111270205', // 你的手机号（带国家代码）
  proxy: 'http://127.0.0.1:7897', // 可选的代理配置
};

async function test1() {
  // 步骤1：发送验证码，现在支持在config中直接包含password
  const authData = await TelegramJSBase.sendPhoneCode({
    ...config,
    password: 'your_2fa_password_if_needed', // 可选的两步验证密码
  });
  console.log('✅ 验证码已发送，authData:', authData);
  return authData;
}

async function test2() {
  // 先发送验证码获取authData
  const authData = await TelegramJSBase.sendPhoneCode(config);

  // 步骤2：提交验证码，直接使用authData
  const sessionString = await TelegramJSBase.submitPhoneCodeAndGetSession(
    authData, // 直接传入第一步返回的对象
    '93585', // 你的验证码
  );
  console.log('🎉 认证成功，sessionString:', sessionString);
  return sessionString;
}

/**
 * 示例1：两步认证获取 session
 * 首次使用时需要通过这个流程获取 sessionString
 */

/**
 * 主函数：运行所有示例
 */
async function main() {
  console.log('🎯 GramJSBase 使用示例开始');
  await test1();

  try {
  } catch (error) {
    console.error('💥 示例执行失败:', error);
  }
}

// 如果直接运行此文件，执行主函数
if (require.main === module) {
  main().catch(console.error);
}
