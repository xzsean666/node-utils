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
  const authData = {
    tempSessionString:
      '1BQANOTEuMTA4LjU2LjE0NQG7qHhdLqIZ1WQGldH9pOuwK9Zw3veo+co+JQEPPVSRdRVJqN4Kfx4YDcgp6MzOb9t5GZ91xZ53L291qtV/ZYUBMbbggegsZq287U6TICs9CwZcSinIfKZZE43d5IMtf2K5j+y9y350VFKpjzx4iudq0YzdCd5yfEpvlgnh3onur9wskh20kV67VUJBgQT3PjOn82RdpWYjmfIARxELkL4vNwEdLhJ6Bm0OSqQRW7ZSM3tyG09K7SUi8x/IrhqvWVcrWfSzQjh6V5oC5cseJdffPkVJ/4tu08Xtwkir5IHTwbMZiBddiDs2tPcCsbqi8fbd7QZYxwxpr2Q9Z0sezLbrhw==',
    phoneCodeHash: '74636a1895a97feb9a',
    apiId: 12968078,
    apiHash: config.apiHash,
    phoneNumber: '+8618111270205',
    proxy: 'http://127.0.0.1:7897',
    password: 'your_2fa_password_if_needed',
  };

  // 步骤2：提交验证码，直接使用authData
  const sessionString = await TelegramJSBase.submitPhoneCodeAndGetSession(
    authData, // 直接传入第一步返回的对象
    '43002', // 你的验证码
  );
  const session =
    '1BQANOTEuMTA4LjU2LjE0NQG7qHhdLqIZ1WQGldH9pOuwK9Zw3veo+co+JQEPPVSRdRVJqN4Kfx4YDcgp6MzOb9t5GZ91xZ53L291qtV/ZYUBMbbggegsZq287U6TICs9CwZcSinIfKZZE43d5IMtf2K5j+y9y350VFKpjzx4iudq0YzdCd5yfEpvlgnh3onur9wskh20kV67VUJBgQT3PjOn82RdpWYjmfIARxELkL4vNwEdLhJ6Bm0OSqQRW7ZSM3tyG09K7SUi8x/IrhqvWVcrWfSzQjh6V5oC5cseJdffPkVJ/4tu08Xtwkir5IHTwbMZiBddiDs2tPcCsbqi8fbd7QZYxwxpr2Q9Z0sezLbrhw==';
  console.log('🎉 认证成功，sessionString:', sessionString);
  return sessionString;
}
async function test3() {
  const session =
    '1BQANOTEuMTA4LjU2LjE0NQG7qHhdLqIZ1WQGldH9pOuwK9Zw3veo+co+JQEPPVSRdRVJqN4Kfx4YDcgp6MzOb9t5GZ91xZ53L291qtV/ZYUBMbbggegsZq287U6TICs9CwZcSinIfKZZE43d5IMtf2K5j+y9y350VFKpjzx4iudq0YzdCd5yfEpvlgnh3onur9wskh20kV67VUJBgQT3PjOn82RdpWYjmfIARxELkL4vNwEdLhJ6Bm0OSqQRW7ZSM3tyG09K7SUi8x/IrhqvWVcrWfSzQjh6V5oC5cseJdffPkVJ/4tu08Xtwkir5IHTwbMZiBddiDs2tPcCsbqi8fbd7QZYxwxpr2Q9Z0sezLbrhw==';
  const client = new TelegramJSBase(config.apiId, config.apiHash, session, {
    proxy: config.proxy, // 添加代理配置
  });
  await client.start();
  console.log('🎉 认证成功，sessionString:', session);
  client.sendMessage('@xz_sean', 'Hello, world!');
  return session;
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

  // 从命令行参数获取要执行的操作
  const operation = process.argv[2];

  try {
    switch (operation) {
      case 'send':
        console.log('📤 执行消息发送示例...');
        await test4_sendMessages();
        break;
      case 'dialogs':
        console.log('📂 获取对话列表...');
        await test5_getDialogs();
        break;
      case 'listen':
        console.log('👂 开始监听消息...');
        await test6_listenMessages();
        break;
      case 'file':
        console.log('📄 发送文件示例...');
        await test7_sendFile();
        break;
      case 'auth':
        console.log('🔐 认证流程示例...');
        await test1();
        break;
      case 'group':
        console.log('👥 监听群组消息示例...');
        await test8_listenGroupMessages();
        break;
      case 'groupInfo':
        console.log('📋 获取群组信息示例...');
        await test9_getGroupInfo();
        break;
      case 'groupMessages':
        console.log('📨 获取群组最近消息示例...');
        await test10_getGroupMessages();
        break;
      case 'groupCompare':
        console.log('📊 对比群组消息示例...');
        await test11_compareGroupMessages();
        break;
      default:
        console.log('🚀 执行基础连接测试...');
        await test3();
        console.log('\n📖 可用的操作命令:');
        console.log('  npx ts-node [文件路径] send     - 发送消息示例');
        console.log('  npx ts-node [文件路径] dialogs  - 获取对话列表');
        console.log('  npx ts-node [文件路径] listen   - 监听新消息');
        console.log('  npx ts-node [文件路径] file     - 发送文件');
        console.log('  npx ts-node [文件路径] auth     - 认证流程');
        console.log('  npx ts-node [文件路径] group    - 监听群组消息');
        console.log('  npx ts-node [文件路径] groupInfo - 获取群组信息');
        console.log(
          '  npx ts-node [文件路径] groupMessages - 获取群组最近消息',
        );
        console.log('  npx ts-node [文件路径] groupCompare - 对比群组消息');
        break;
    }
  } catch (error) {
    console.error('💥 示例执行失败:', error);
  }
}

// 如果直接运行此文件，执行主函数
if (require.main === module) {
  main().catch(console.error);
}

/**
 * 示例4：发送消息到多个目标
 */
async function test4_sendMessages() {
  const session =
    '1BQANOTEuMTA4LjU2LjE0NQG7qHhdLqIZ1WQGldH9pOuwK9Zw3veo+co+JQEPPVSRdRVJqN4Kfx4YDcgp6MzOb9t5GZ91xZ53L291qtV/ZYUBMbbggegsZq287U6TICs9CwZcSinIfKZZE43d5IMtf2K5j+y9y350VFKpjzx4iudq0YzdCd5yfEpvlgnh3onur9wskh20kV67VUJBgQT3PjOn82RdpWYjmfIARxELkL4vNwEdLhJ6Bm0OSqQRW7ZSM3tyG09K7SUi8x/IrhqvWVcrWfSzQjh6V5oC5cseJdffPkVJ/4tu08Xtwkir5IHTwbMZiBddiDs2tPcCsbqi8fbd7QZYxwxpr2Q9Z0sezLbrhw==';

  const client = new TelegramJSBase(config.apiId, config.apiHash, session, {
    proxy: config.proxy,
  });

  await client.start();
  console.log('✅ 客户端已连接');

  // 发送普通消息
  await client.sendMessage('@xz_sean', '你好！这是一条测试消息 🚀');

  // 发送带格式的消息
  await client.sendMessage('@xz_sean', '**粗体文本** 和 *斜体文本*', {
    parseMode: 'md',
  });

  // 发送HTML格式消息
  await client.sendMessage(
    '@xz_sean',
    '<b>粗体</b> 和 <i>斜体</i> 和 <code>代码</code>',
    {
      parseMode: 'html',
    },
  );

  await client.disconnect();
  console.log('✅ 消息发送完成');
}

/**
 * 示例5：获取对话列表和消息
 */
async function test5_getDialogs() {
  const session =
    '1BQANOTEuMTA4LjU2LjE0NQG7qHhdLqIZ1WQGldH9pOuwK9Zw3veo+co+JQEPPVSRdRVJqN4Kfx4YDcgp6MzOb9t5GZ91xZ53L291qtV/ZYUBMbbggegsZq287U6TICs9CwZcSinIfKZZE43d5IMtf2K5j+y9y350VFKpjzx4iudq0YzdCd5yfEpvlgnh3onur9wskh20kV67VUJBgQT3PjOn82RdpWYjmfIARxELkL4vNwEdLhJ6Bm0OSqQRW7ZSM3tyG09K7SUi8x/IrhqvWVcrWfSzQjh6V5oC5cseJdffPkVJ/4tu08Xtwkir5IHTwbMZiBddiDs2tPcCsbqi8fbd7QZYxwxpr2Q9Z0sezLbrhw==';

  const client = new TelegramJSBase(config.apiId, config.apiHash, session, {
    proxy: config.proxy,
  });

  await client.start();

  // 获取对话列表
  console.log('📂 获取对话列表...');
  const dialogs = await client.getDialogs(10); // 获取前10个对话

  dialogs.forEach((dialog, index) => {
    console.log(
      `${index + 1}. ${dialog.title || dialog.name} (ID: ${dialog.id})`,
    );
  });

  // 获取特定对话的消息
  console.log('\n📨 获取 @xz_sean 的最近消息...');
  const messages = await client.getMessages('@xz_sean', { limit: 5 });

  messages.forEach((msg, index) => {
    console.log(`${index + 1}. ${msg.message} (${msg.date})`);
  });

  await client.disconnect();
  console.log('✅ 对话信息获取完成');
}

/**
 * 示例6：监听新消息
 */
async function test6_listenMessages() {
  const session =
    '1BQANOTEuMTA4LjU2LjE0NQG7qHhdLqIZ1WQGldH9pOuwK9Zw3veo+co+JQEPPVSRdRVJqN4Kfx4YDcgp6MzOb9t5GZ91xZ53L291qtV/ZYUBMbbggegsZq287U6TICs9CwZcSinIfKZZE43d5IMtf2K5j+y9y350VFKpjzx4iudq0YzdCd5yfEpvlgnh3onur9wskh20kV67VUJBgQT3PjOn82RdpWYjmfIARxELkL4vNwEdLhJ6Bm0OSqQRW7ZSM3tyG09K7SUi8x/IrhqvWVcrWfSzQjh6V5oC5cseJdffPkVJ/4tu08Xtwkir5IHTwbMZiBddiDs2tPcCsbqi8fbd7QZYxwxpr2Q9Z0sezLbrhw==';

  const client = new TelegramJSBase(config.apiId, config.apiHash, session, {
    proxy: config.proxy,
  });

  await client.start();
  console.log('👂 开始监听新消息...');

  // 设置消息监听器
  client.onMessage(async (event) => {
    const message = event.message;
    const sender = await message.getSender();

    // 安全地获取发送者名称
    const senderName =
      (sender as any)?.firstName || (sender as any)?.title || '未知';
    console.log(`📨 新消息来自 ${senderName}: ${message.message}`);

    // 自动回复示例
    if (message.message?.toLowerCase().includes('hello')) {
      await client.sendMessage(message.peerId, '你好！我收到了你的消息 👋');
    }
  });

  // 保持连接30秒，然后断开
  console.log('⏰ 将监听30秒...');
  setTimeout(async () => {
    await client.disconnect();
    console.log('✅ 监听结束');
    process.exit(0);
  }, 30000);
}

/**
 * 示例7：发送文件
 */
async function test7_sendFile() {
  const session =
    '1BQANOTEuMTA4LjU2LjE0NQG7qHhdLqIZ1WQGldH9pOuwK9Zw3veo+co+JQEPPVSRdRVJqN4Kfx4YDcgp6MzOb9t5GZ91xZ53L291qtV/ZYUBMbbggegsZq287U6TICs9CwZcSinIfKZZE43d5IMtf2K5j+y9y350VFKpjzx4iudq0YzdCd5yfEpvlgnh3onur9wskh20kV67VUJBgQT3PjOn82RdpWYjmfIARxELkL4vNwEdLhJ6Bm0OSqQRW7ZSM3tyG09K7SUi8x/IrhqvWVcrWfSzQjh6V5oC5cseJdffPkVJ/4tu08Xtwkir5IHTwbMZiBddiDs2tPcCsbqi8fbd7QZYxwxpr2Q9Z0sezLbrhw==';

  const client = new TelegramJSBase(config.apiId, config.apiHash, session, {
    proxy: config.proxy,
  });

  await client.start();

  // 发送文本文件
  const textContent = Buffer.from(
    '这是一个测试文件的内容\n包含一些中文字符 🚀',
    'utf-8',
  );
  await client.sendFile('@xz_sean', textContent, {
    caption: '📄 这是一个测试文件',
  });

  await client.disconnect();
  console.log('✅ 文件发送完成');
}

/**
 * 示例8：监听指定群组消息并做判断
 */
async function test8_listenGroupMessages() {
  const session =
    '1BQANOTEuMTA4LjU2LjE0NQG7qHhdLqIZ1WQGldH9pOuwK9Zw3veo+co+JQEPPVSRdRVJqN4Kfx4YDcgp6MzOb9t5GZ91xZ53L291qtV/ZYUBMbbggegsZq287U6TICs9CwZcSinIfKZZE43d5IMtf2K5j+y9y350VFKpjzx4iudq0YzdCd5yfEpvlgnh3onur9wskh20kV67VUJBgQT3PjOn82RdpWYjmfIARxELkL4vNwEdLhJ6Bm0OSqQRW7ZSM3tyG09K7SUi8x/IrhqvWVcrWfSzQjh6V5oC5cseJdffPkVJ/4tu08Xtwkir5IHTwbMZiBddiDs2tPcCsbqi8fbd7QZYxwxpr2Q9Z0sezLbrhw==';

  const client = new TelegramJSBase(config.apiId, config.apiHash, session, {
    proxy: config.proxy,
  });

  await client.start();
  console.log('👂 开始监听指定群组消息...');

  // 配置要监听的群组 (可以是群组用户名、ID或邀请链接)
  const targetGroups = [
    // '@your_group_username',  // 群组用户名
    // -1001234567890,          // 群组ID (负数)
    // 'https://t.me/your_group', // 邀请链接
  ];

  // 设置消息监听器
  client.onMessage(async (event) => {
    const message = event.message;
    const chat = await message.getChat();
    const sender = await message.getSender();

    // 检查是否来自目标群组
    const isTargetGroup =
      targetGroups.length === 0 || // 如果没有指定群组，监听所有
      targetGroups.some((target) => {
        if (typeof target === 'string') {
          const targetStr = target as string;
          return (
            (chat as any)?.username === targetStr.replace('@', '') ||
            (chat as any)?.title?.includes(targetStr)
          );
        }
        return (chat as any)?.id?.toString() === (target as number).toString();
      });

    if (!isTargetGroup && targetGroups.length > 0) {
      return; // 不是目标群组，跳过
    }

    // 获取发送者和群组信息
    const senderName =
      (sender as any)?.firstName || (sender as any)?.username || '未知用户';
    const groupName = (chat as any)?.title || (chat as any)?.username || '私聊';
    const messageText = message.message || '';

    console.log(`\n📨 [${groupName}] ${senderName}: ${messageText}`);

    // 根据消息内容做不同的判断和操作
    await handleMessage(client, message, messageText, groupName, senderName);
  });

  console.log('⏰ 开始监听群组消息... (按 Ctrl+C 停止)');
  console.log(
    '📋 配置的监听群组:',
    targetGroups.length > 0 ? targetGroups : '所有群组',
  );

  // 保持监听状态
  process.on('SIGINT', async () => {
    console.log('\n⏹️  停止监听...');
    await client.disconnect();
    process.exit(0);
  });
}

/**
 * 处理接收到的消息 - 根据内容做不同判断
 */
async function handleMessage(
  client: TelegramJSBase,
  message: any,
  messageText: string,
  groupName: string,
  senderName: string,
) {
  try {
    const lowerText = messageText.toLowerCase();

    // 1. 关键词监控
    const keywords = ['价格', 'price', '买入', 'buy', '卖出', 'sell'];
    const hasKeyword = keywords.some((keyword) =>
      lowerText.includes(keyword.toLowerCase()),
    );

    if (hasKeyword) {
      console.log('🔍 检测到关键词消息!');
      // 可以发送到特定频道或用户
      // await client.sendMessage('@your_alert_channel',
      //   `🚨 关键词监控\n群组: ${groupName}\n用户: ${senderName}\n消息: ${messageText}`);
    }

    // 2. 链接检测
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = messageText.match(urlRegex);
    if (urls && urls.length > 0) {
      console.log('🔗 检测到链接:', urls);
      // 可以进一步检查链接安全性
    }

    // 3. 数字/价格检测
    const priceRegex = /[\$¥€£]\s*[\d,]+\.?\d*/g;
    const prices = messageText.match(priceRegex);
    if (prices && prices.length > 0) {
      console.log('💰 检测到价格信息:', prices);
    }

    // 4. 特定用户消息
    const vipUsers = ['admin', 'moderator']; // 重要用户列表
    if (vipUsers.some((user) => senderName.toLowerCase().includes(user))) {
      console.log('👑 VIP用户发言!');
      // 特殊处理VIP用户消息
    }

    // 5. 消息长度检测
    if (messageText.length > 500) {
      console.log('📝 检测到长消息 (>500字符)');
    }

    // 6. 表情符号检测
    const emojiRegex =
      /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu;
    const emojis = messageText.match(emojiRegex);
    if (emojis && emojis.length > 5) {
      console.log('😀 表情符号丰富的消息!');
    }

    // 7. 时间敏感消息
    const urgentKeywords = ['urgent', '紧急', 'asap', '立即'];
    if (urgentKeywords.some((keyword) => lowerText.includes(keyword))) {
      console.log('⚡ 紧急消息检测!');
      // 立即通知
    }

    // 8. 投票/调查消息
    if (
      lowerText.includes('投票') ||
      lowerText.includes('poll') ||
      lowerText.includes('调查')
    ) {
      console.log('🗳️  检测到投票/调查消息');
    }

    // 9. 文件/媒体检测
    if (message.media) {
      console.log('📎 检测到媒体文件');
      // 可以下载或分析文件
    }

    // 10. 自定义回复逻辑
    if (lowerText.includes('机器人') || lowerText.includes('bot')) {
      // 注意：频繁回复可能被认为是垃圾信息
      // await client.sendMessage(message.peerId, '🤖 我是监听机器人，正在工作中...');
      console.log('🤖 检测到机器人相关消息');
    }
  } catch (error) {
    console.error('❌ 处理消息时出错:', error);
  }
}

/**
 * 示例9：获取群组信息和成员
 */
async function test9_getGroupInfo() {
  const session =
    '1BQANOTEuMTA4LjU2LjE0NQG7qHhdLqIZ1WQGldH9pOuwK9Zw3veo+co+JQEPPVSRdRVJqN4Kfx4YDcgp6MzOb9t5GZ91xZ53L291qtV/ZYUBMbbggegsZq287U6TICs9CwZcSinIfKZZE43d5IMtf2K5j+y9y350VFKpjzx4iudq0YzdCd5yfEpvlgnh3onur9wskh20kV67VUJBgQT3PjOn82RdpWYjmfIARxELkL4vNwEdLhJ6Bm0OSqQRW7ZSM3tyG09K7SUi8x/IrhqvWVcrWfSzQjh6V5oC5cseJdffPkVJ/4tu08Xtwkir5IHTwbMZiBddiDs2tPcCsbqi8fbd7QZYxwxpr2Q9Z0sezLbrhw==';

  const client = new TelegramJSBase(config.apiId, config.apiHash, session, {
    proxy: config.proxy,
  });

  await client.start();
  console.log('📂 获取群组信息...');

  // 获取所有对话，筛选群组
  const dialogs = await client.getDialogs(50);
  const groups = dialogs.filter(
    (dialog) =>
      (dialog.entity as any).className === 'Chat' ||
      (dialog.entity as any).className === 'Channel',
  );

  console.log(`\n找到 ${groups.length} 个群组/频道:`);
  groups.forEach((group, index) => {
    const entity = group.entity as any;
    console.log(`${index + 1}. ${group.title}`);
    console.log(`   ID: ${entity.id}`);
    console.log(`   用户名: ${entity.username || '无'}`);
    console.log(`   类型: ${entity.className}`);
    console.log(`   成员数: ${entity.participantsCount || '未知'}\n`);
  });

  await client.disconnect();
  console.log('✅ 群组信息获取完成');
}

/**
 * 示例10：获取指定群组的最近消息
 */
async function test10_getGroupMessages() {
  const session =
    '1BQANOTEuMTA4LjU2LjE0NQG7qHhdLqIZ1WQGldH9pOuwK9Zw3veo+co+JQEPPVSRdRVJqN4Kfx4YDcgp6MzOb9t5GZ91xZ53L291qtV/ZYUBMbbggegsZq287U6TICs9CwZcSinIfKZZE43d5IMtf2K5j+y9y350VFKpjzx4iudq0YzdCd5yfEpvlgnh3onur9wskh20kV67VUJBgQT3PjOn82RdpWYjmfIARxELkL4vNwEdLhJ6Bm0OSqQRW7ZSM3tyG09K7SUi8x/IrhqvWVcrWfSzQjh6V5oC5cseJdffPkVJ/4tu08Xtwkir5IHTwbMZiBddiDs2tPcCsbqi8fbd7QZYxwxpr2Q9Z0sezLbrhw==';

  const client = new TelegramJSBase(config.apiId, config.apiHash, session, {
    proxy: config.proxy,
  });

  await client.start();
  console.log('📨 获取群组最近消息...');

  // 配置要获取消息的群组 (修改这里指定群组)
  const targetGroup = '@your_group_username'; // 或者使用群组ID: -1001234567890
  const messageLimit = 10; // 获取最近的消息数量

  try {
    console.log(
      `\n🔍 正在获取群组 "${targetGroup}" 的最近 ${messageLimit} 条消息...\n`,
    );

    const messages = await client.getMessages(targetGroup, {
      limit: messageLimit,
    });

    if (messages.length === 0) {
      console.log('❌ 没有找到消息，请检查群组名称或权限');
      await client.disconnect();
      return;
    }

    console.log(`✅ 成功获取到 ${messages.length} 条消息:\n`);
    console.log('='.repeat(80));

    // 按时间顺序显示消息 (最新的在下面)
    messages.reverse().forEach((msg, index) => {
      const messageText = msg.message || '[非文本消息]';
      const date = new Date(msg.date * 1000).toLocaleString('zh-CN');
      const senderId = (msg.senderId as any)?.value || msg.senderId;

      console.log(`\n📨 消息 ${index + 1}:`);
      console.log(`📅 时间: ${date}`);
      console.log(`👤 发送者ID: ${senderId}`);
      console.log(`💬 内容: ${messageText}`);

      // 检查是否有媒体文件
      if (msg.media) {
        console.log(`📎 媒体类型: ${(msg.media as any).className || '未知'}`);
      }

      // 检查是否是回复消息
      if (msg.replyTo) {
        console.log(`↩️  回复消息ID: ${(msg.replyTo as any).replyToMsgId}`);
      }

      console.log('-'.repeat(60));
    });

    console.log('\n🔍 消息分析:');
    await analyzeGroupMessages(messages);
  } catch (error) {
    console.error('❌ 获取群组消息失败:', error);
    console.log('\n💡 常见问题:');
    console.log('   1. 检查群组用户名是否正确 (以@开头)');
    console.log('   2. 确认你已加入该群组');
    console.log('   3. 检查是否有查看消息的权限');
    console.log('   4. 尝试使用群组ID代替用户名');
  }

  await client.disconnect();
  console.log('\n✅ 获取群组消息完成');
}

/**
 * 分析群组消息的统计信息
 */
async function analyzeGroupMessages(messages: any[]) {
  const analysis = {
    totalMessages: messages.length,
    textMessages: 0,
    mediaMessages: 0,
    uniqueSenders: new Set(),
    messagesByHour: {} as Record<string, number>,
    commonWords: {} as Record<string, number>,
    avgMessageLength: 0,
    totalLength: 0,
  };

  messages.forEach((msg) => {
    const senderId = (msg.senderId as any)?.value || msg.senderId;
    analysis.uniqueSenders.add(senderId?.toString());

    // 统计文本和媒体消息
    if (msg.message) {
      analysis.textMessages++;
      analysis.totalLength += msg.message.length;

      // 统计常用词汇 (简单示例)
      const words = msg.message.toLowerCase().split(/\s+/);
      words.forEach((word) => {
        if (word.length > 2) {
          // 忽略过短的词
          analysis.commonWords[word] = (analysis.commonWords[word] || 0) + 1;
        }
      });
    }

    if (msg.media) {
      analysis.mediaMessages++;
    }

    // 按小时统计消息分布
    const hour = new Date(msg.date * 1000).getHours();
    const hourKey = `${hour}:00`;
    analysis.messagesByHour[hourKey] =
      (analysis.messagesByHour[hourKey] || 0) + 1;
  });

  analysis.avgMessageLength =
    analysis.textMessages > 0
      ? Math.round(analysis.totalLength / analysis.textMessages)
      : 0;

  // 显示分析结果
  console.log(`📊 消息总数: ${analysis.totalMessages}`);
  console.log(`💬 文本消息: ${analysis.textMessages}`);
  console.log(`📎 媒体消息: ${analysis.mediaMessages}`);
  console.log(`👥 参与用户数: ${analysis.uniqueSenders.size}`);
  console.log(`📏 平均消息长度: ${analysis.avgMessageLength} 字符`);

  // 显示最活跃的时间段
  const sortedHours = Object.entries(analysis.messagesByHour)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  if (sortedHours.length > 0) {
    console.log('\n⏰ 最活跃时间段:');
    sortedHours.forEach(([hour, count], index) => {
      console.log(`   ${index + 1}. ${hour} (${count} 条消息)`);
    });
  }

  // 显示最常用词汇
  const commonWords = Object.entries(analysis.commonWords)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  if (commonWords.length > 0) {
    console.log('\n🔤 常用词汇:');
    commonWords.forEach(([word, count], index) => {
      console.log(`   ${index + 1}. "${word}" (${count} 次)`);
    });
  }
}

/**
 * 示例11：获取多个群组的最近消息对比
 */
async function test11_compareGroupMessages() {
  const session =
    '1BQANOTEuMTA4LjU2LjE0NQG7qHhdLqIZ1WQGldH9pOuwK9Zw3veo+co+JQEPPVSRdRVJqN4Kfx4YDcgp6MzOb9t5GZ91xZ53L291qtV/ZYUBMbbggegsZq287U6TICs9CwZcSinIfKZZE43d5IMtf2K5j+y9y350VFKpjzx4iudq0YzdCd5yfEpvlgnh3onur9wskh20kV67VUJBgQT3PjOn82RdpWYjmfIARxELkL4vNwEdLhJ6Bm0OSqQRW7ZSM3tyG09K7SUi8x/IrhqvWVcrWfSzQjh6V5oC5cseJdffPkVJ/4tu08Xtwkir5IHTwbMZiBddiDs2tPcCsbqi8fbd7QZYxwxpr2Q9Z0sezLbrhw==';

  const client = new TelegramJSBase(config.apiId, config.apiHash, session, {
    proxy: config.proxy,
  });

  await client.start();
  console.log('📊 对比多个群组的消息活跃度...');

  // 配置要对比的群组列表
  const groupsToCompare = [
    // '@group1_username',
    // '@group2_username',
    // -1001234567890,
  ];

  const messageLimit = 5; // 每个群组获取的消息数

  console.log(
    `\n🔍 正在分析 ${groupsToCompare.length} 个群组的最近活跃度...\n`,
  );

  for (const group of groupsToCompare) {
    try {
      console.log(`\n📂 分析群组: ${group}`);
      console.log('='.repeat(50));

      const messages = await client.getMessages(group, { limit: messageLimit });

      if (messages.length === 0) {
        console.log('❌ 无法获取消息');
        continue;
      }

      // 计算活跃度指标
      const now = Date.now();
      const lastMessageTime = messages[0].date * 1000;
      const timeSinceLastMessage = Math.floor(
        (now - lastMessageTime) / (1000 * 60),
      ); // 分钟

      const uniqueSenders = new Set(
        messages.map((msg) => (msg.senderId as any)?.value || msg.senderId),
      );

      console.log(`📨 最近${messageLimit}条消息:`);
      console.log(`⏰ 最后消息: ${timeSinceLastMessage} 分钟前`);
      console.log(`👥 参与用户: ${uniqueSenders.size} 人`);
      console.log(
        `📊 消息频率: ${(
          messages.length / Math.max(1, timeSinceLastMessage / 60)
        ).toFixed(1)} 条/小时`,
      );

      // 显示最近几条消息的简要信息
      console.log('\n最近消息预览:');
      messages.slice(0, 3).forEach((msg, index) => {
        const preview = msg.message
          ? msg.message.length > 30
            ? msg.message.substring(0, 30) + '...'
            : msg.message
          : '[媒体消息]';
        const timeAgo = Math.floor((now - msg.date * 1000) / (1000 * 60));
        console.log(`   ${index + 1}. ${preview} (${timeAgo}分钟前)`);
      });
    } catch (error) {
      console.log(`❌ 获取群组 ${group} 失败:`, (error as Error).message);
    }
  }

  await client.disconnect();
  console.log('\n✅ 群组对比分析完成');
}

// 导出所有测试函数，方便单独调用
export {
  test1,
  test2,
  test3,
  test4_sendMessages,
  test5_getDialogs,
  test6_listenMessages,
  test7_sendFile,
  test8_listenGroupMessages,
  test9_getGroupInfo,
  test10_getGroupMessages,
  test11_compareGroupMessages,
};
