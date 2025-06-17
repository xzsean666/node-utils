import { TelegramJSBase } from '../telegramBase';

/**
 * 简单使用示例 - 展示优化后的两步认证API
 */

// 配置信息
const config = {
  apiId: 12345,
  apiHash: 'your_api_hash',
  phoneNumber: '+1234567890',
  proxy: 'http://127.0.0.1:7987', // 可选代理
  password: 'your_2fa_password', // 可选的两步验证密码
};

/**
 * 完整的两步认证流程示例
 */
async function twoStepAuthExample() {
  try {
    console.log('🚀 开始两步认证流程...');

    // 步骤1：发送验证码
    console.log('📱 发送验证码到手机...');
    const authData = await TelegramJSBase.sendPhoneCode(config);
    console.log('✅ 验证码已发送！');

    // 在实际应用中，这里需要从用户输入获取验证码
    const phoneCode = '12345'; // 替换为实际的验证码

    // 步骤2：提交验证码获取session - 注意新的简化API
    console.log('🔐 验证验证码...');
    const sessionString = await TelegramJSBase.submitPhoneCodeAndGetSession(
      authData, // 直接传入第一步返回的完整对象
      phoneCode, // 只需要额外传入验证码
    );

    console.log('🎉 认证成功！');
    console.log('💾 Session String:', sessionString);
    return sessionString;
  } catch (error) {
    console.error('❌ 认证失败:', error);
    throw error;
  }
}

/**
 * 使用已有session创建客户端
 */
async function useExistingSession(sessionString: string) {
  console.log('🔗 使用已有session连接...');

  const client = new TelegramJSBase(
    config.apiId,
    config.apiHash,
    sessionString,
    { proxy: config.proxy },
  );

  await client.start(); // 无需认证配置，因为已有session

  // 发送测试消息
  await client.sendMessage('me', '✅ 使用优化后的API连接成功！');

  await client.disconnect();
  console.log('👋 客户端已断开');
}

/**
 * 主函数 - 演示优化后的API使用
 */
async function main() {
  console.log('🎯 优化后的TelegramJSBase API使用示例');
  console.log('\n📋 API优化点：');
  console.log('1. sendPhoneCode 支持直接在config中传入password');
  console.log('2. sendPhoneCode 返回完整的AuthData对象');
  console.log(
    '3. submitPhoneCodeAndGetSession 只需要authData + phoneCode两个参数',
  );
  console.log('4. 参数传递更简洁，减少了重复输入\n');

  try {
    // 示例：两步认证
    const sessionString = await twoStepAuthExample();

    // 示例：使用已有session
    if (sessionString) {
      await useExistingSession(sessionString);
    }

    console.log('\n🎉 所有示例执行完成！');
  } catch (error) {
    console.error('💥 示例执行失败:', error);
  }
}

// 运行示例（取消注释以执行）
// main().catch(console.error);

export { twoStepAuthExample, useExistingSession, main };
