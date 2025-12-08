import { TelegramJSBase } from '../telegramBase';
import { TelegramBotBase } from '../telegramBotBase';
import { NewMessageEvent } from 'telegram/events';

/**
 * 在 onMessage handler 中使用 getMessages 的完整示例
 * 展示 TelegramJSBase 和 TelegramBotBase 的同步使用
 */

const config = {
  apiId: 12968078,
  apiHash: 'your_api_hash',
  sessionString: 'your_session_string',
  proxy: 'http://127.0.0.1:7897', // 可选
  botToken: 'your_bot_token', // Bot token for TelegramBotBase
};

/**
 * 示例0：使用 TelegramBotBase 的 onMessage 和 getMessages (Bot API)
 */
async function example0_BotBaseUsage() {
  const bot = new TelegramBotBase(config.botToken);

  console.log('🤖 Bot 已初始化');

  // 使用与 TelegramJSBase 一致的 onMessage 方法
  bot.onMessage(async (ctx) => {
    const messageText = ctx.message?.text || '';
    const chatId = ctx.chat?.id;

    if (!chatId) {
      console.log('❌ 无法获取聊天ID');
      return;
    }

    console.log(`📨 Bot收到消息: ${messageText}`);

    // 根据消息内容触发不同的操作
    if (messageText.includes('历史')) {
      console.log('🔍 用户请求查看历史消息...');

      // 使用 Bot 的 getMessages 方法
      const recentMessages = await bot.getMessages(chatId, {
        limit: 5, // Bot API 限制较多，使用较小的数量
      });

      console.log(`📝 找到 ${recentMessages.length} 条历史消息:`);
      recentMessages.forEach((msg, index) => {
        const date = new Date(msg.date * 1000).toLocaleString();
        const text = 'text' in msg ? msg.text : '[非文本]';
        console.log(`  ${index + 1}. [${date}] ${text}`);
      });

      // 回复用户
      await bot.sendMessage(
        chatId,
        `📋 已为您查找到 ${recentMessages.length} 条历史消息 (Bot API限制)`,
      );
    }

    if (messageText.includes('状态')) {
      console.log('🔧 用户请求查看Bot状态...');

      const isAuth = await bot.isAuthorized();
      const userInfo = bot.getUserInfo();

      await bot.sendMessage(
        chatId,
        `🤖 Bot状态:\n` +
          `✅ 授权状态: ${isAuth ? '已授权' : '未授权'}\n` +
          `📊 会话计数: ${userInfo.messageCount}`,
      );
    }

    if (messageText.includes('文件')) {
      console.log('📎 用户请求发送文件...');

      // 发送一个示例文件
      try {
        await bot.sendFile(chatId, 'https://via.placeholder.com/150.png', {
          caption: '📎 这是一个示例图片文件',
        });
      } catch (error) {
        console.error('发送文件失败:', error);
        await bot.sendMessage(chatId, '❌ 发送文件失败');
      }
    }
  });

  // 启动 Bot
  bot.start();
  console.log(
    '👂 Bot开始监听消息... (发送包含"历史"、"状态"或"文件"的消息来测试)',
  );
}

/**
 * 示例1：在 handler 中直接使用 TelegramJSBase client
 */
async function example1_DirectClientUsage() {
  const client = new TelegramJSBase(
    config.apiId,
    config.apiHash,
    config.sessionString,
    {
      proxy: config.proxy,
    },
  );

  await client.start();
  console.log('✅ 客户端已连接');

  // 直接在 onMessage 中使用 client
  client.onMessage(async (event: NewMessageEvent) => {
    const message = event.message;
    const messageText = message.message || '';
    const peerId = message.peerId;

    console.log(`📨 收到消息: ${messageText}`);

    // 根据消息内容触发不同的操作
    if (messageText.includes('历史')) {
      console.log('🔍 用户请求查看历史消息...');

      // 获取最近10条消息
      const recentMessages = await client.getMessages(peerId, {
        limit: 10,
      });

      console.log(`📝 找到 ${recentMessages.length} 条历史消息:`);
      recentMessages.forEach((msg, index) => {
        const date = new Date(msg.date * 1000).toLocaleString();
        console.log(`  ${index + 1}. [${date}] ${msg.message || '[非文本]'}`);
      });

      // 回复用户
      await client.sendMessage(
        peerId,
        `📋 已为您查找到 ${recentMessages.length} 条历史消息`,
      );
    }

    if (messageText.includes('对话列表')) {
      console.log('📂 用户请求查看对话列表...');

      // 获取对话列表
      const dialogs = await client.getDialogs(20);

      const dialogInfo = dialogs
        .slice(0, 10) // 只显示前10个
        .map((dialog, index) => `${index + 1}. ${dialog.title || dialog.name}`)
        .join('\n');

      await client.sendMessage(peerId, `📋 您的对话列表:\n${dialogInfo}`);
    }

    if (messageText.includes('群组消息')) {
      console.log('👥 用户请求查看群组消息...');

      // 获取当前聊天的信息
      const chat = await message.getChat();
      const isGroup =
        (chat as any).className === 'Chat' ||
        (chat as any).className === 'Channel';

      if (isGroup) {
        // 获取群组最近消息
        const groupMessages = await client.getMessages(peerId, {
          limit: 20,
        });

        // 分析消息
        const messageStats = analyzeMessages(groupMessages);

        await client.sendMessage(
          peerId,
          `📊 群组消息统计:\n` +
            `📨 总消息数: ${messageStats.total}\n` +
            `👥 参与用户: ${messageStats.uniqueUsers}\n` +
            `📎 媒体消息: ${messageStats.mediaCount}\n` +
            `📝 文本消息: ${messageStats.textCount}`,
        );
      } else {
        await client.sendMessage(peerId, '❌ 这不是一个群组聊天');
      }
    }
  });

  console.log(
    '👂 开始监听消息... (发送包含"历史"、"对话列表"或"群组消息"的消息来测试)',
  );
}

/**
 * 示例2：使用封装的消息处理器
 */
class AdvancedMessageHandler {
  private client: TelegramJSBase;

  constructor(client: TelegramJSBase) {
    this.client = client;
  }

  // 创建 handler 函数
  createHandler() {
    return async (event: NewMessageEvent) => {
      const message = event.message;
      const messageText = message.message || '';
      const peerId = message.peerId;

      try {
        // 根据关键词分发到不同的处理方法
        if (messageText.includes('搜索:')) {
          await this.handleSearchMessages(peerId, messageText);
        } else if (messageText.includes('统计')) {
          await this.handleMessageStats(peerId);
        } else if (messageText.includes('备份')) {
          await this.handleBackupMessages(peerId);
        } else if (messageText.includes('最新')) {
          await this.handleLatestMessages(peerId, messageText);
        }
      } catch (error) {
        console.error('❌ 处理消息时出错:', error);
        await this.client.sendMessage(peerId, '❌ 处理请求时出现错误');
      }
    };
  }

  // 搜索包含特定关键词的消息
  private async handleSearchMessages(peerId: any, messageText: string) {
    const keyword = messageText.replace('搜索:', '').trim();
    console.log(`🔍 搜索关键词: ${keyword}`);

    // 获取更多历史消息进行搜索
    const messages = await this.client.getMessages(peerId, {
      limit: 100, // 搜索最近100条消息
    });

    const matchedMessages = messages.filter(
      (msg) =>
        msg.message &&
        msg.message.toLowerCase().includes(keyword.toLowerCase()),
    );

    if (matchedMessages.length > 0) {
      const results = matchedMessages
        .slice(0, 5) // 最多显示5条结果
        .map((msg, index) => {
          const date = new Date(msg.date * 1000).toLocaleString();
          return `${index + 1}. [${date}] ${msg.message}`;
        })
        .join('\n\n');

      await this.client.sendMessage(
        peerId,
        `🔍 搜索结果 (关键词: "${keyword}"):\n\n${results}\n\n共找到 ${matchedMessages.length} 条匹配消息`,
      );
    } else {
      await this.client.sendMessage(
        peerId,
        `❌ 未找到包含 "${keyword}" 的消息`,
      );
    }
  }

  // 统计消息信息
  private async handleMessageStats(peerId: any) {
    console.log('📊 生成消息统计...');

    const messages = await this.client.getMessages(peerId, {
      limit: 50,
    });

    const stats = analyzeMessages(messages);
    const chat = await this.client.getEntity(peerId);
    const chatName =
      (chat as any).title || (chat as any).firstName || '当前聊天';

    await this.client.sendMessage(
      peerId,
      `📊 ${chatName} 消息统计 (最近50条):\n\n` +
        `📨 总消息数: ${stats.total}\n` +
        `👥 参与用户数: ${stats.uniqueUsers}\n` +
        `📝 文本消息: ${stats.textCount}\n` +
        `📎 媒体消息: ${stats.mediaCount}\n` +
        `📅 时间范围: ${stats.timeRange}\n` +
        `💬 平均消息长度: ${stats.avgLength} 字符`,
    );
  }

  // 备份聊天消息
  private async handleBackupMessages(peerId: any) {
    console.log('💾 开始备份消息...');

    const messages = await this.client.getMessages(peerId, {
      limit: 200, // 备份最近200条消息
    });

    // 格式化消息为备份格式
    const backup = messages.map((msg) => {
      const date = new Date(msg.date * 1000).toISOString();
      const senderId = (msg.senderId as any)?.value || msg.senderId;
      return {
        id: msg.id,
        date,
        senderId,
        message: msg.message || '[非文本消息]',
        hasMedia: !!msg.media,
      };
    });

    // 可以保存到文件或发送给用户
    const backupJson = JSON.stringify(backup, null, 2);

    // 这里可以保存到文件
    // require('fs').writeFileSync(`backup_${Date.now()}.json`, backupJson);

    await this.client.sendMessage(
      peerId,
      `💾 已备份 ${messages.length} 条消息\n📊 数据大小: ${Math.round(
        backupJson.length / 1024,
      )} KB`,
    );
  }

  // 获取最新消息
  private async handleLatestMessages(peerId: any, messageText: string) {
    const countMatch = messageText.match(/最新(\d+)/);
    const count = countMatch ? parseInt(countMatch[1]) : 5;

    console.log(`📨 获取最新 ${count} 条消息...`);

    const messages = await this.client.getMessages(peerId, {
      limit: count,
    });

    const formattedMessages = messages
      .reverse() // 按时间顺序显示
      .map((msg, index) => {
        const date = new Date(msg.date * 1000).toLocaleString();
        const content = msg.message || '[非文本消息]';
        return `${index + 1}. [${date}]\n${content}`;
      })
      .join('\n\n');

    await this.client.sendMessage(
      peerId,
      `📨 最新 ${count} 条消息:\n\n${formattedMessages}`,
    );
  }
}

// 消息分析工具函数
function analyzeMessages(messages: any[]) {
  const uniqueUsers = new Set();
  let textCount = 0;
  let mediaCount = 0;
  let totalLength = 0;
  const dates: Date[] = [];

  messages.forEach((msg) => {
    if (msg.senderId) {
      uniqueUsers.add((msg.senderId as any)?.value || msg.senderId);
    }

    if (msg.message) {
      textCount++;
      totalLength += msg.message.length;
    }

    if (msg.media) {
      mediaCount++;
    }

    dates.push(new Date(msg.date * 1000));
  });

  const earliestDate =
    dates.length > 0
      ? new Date(Math.min(...dates.map((d) => d.getTime())))
      : null;
  const latestDate =
    dates.length > 0
      ? new Date(Math.max(...dates.map((d) => d.getTime())))
      : null;

  return {
    total: messages.length,
    uniqueUsers: uniqueUsers.size,
    textCount,
    mediaCount,
    avgLength: textCount > 0 ? Math.round(totalLength / textCount) : 0,
    timeRange:
      earliestDate && latestDate
        ? `${earliestDate.toLocaleDateString()} - ${latestDate.toLocaleDateString()}`
        : '无',
  };
}

/**
 * 示例3：高级用法 - 响应式消息处理
 */
async function example3_ReactiveHandler() {
  const client = new TelegramJSBase(
    config.apiId,
    config.apiHash,
    config.sessionString,
    {
      proxy: config.proxy,
    },
  );

  await client.start();

  // 创建高级处理器
  const handler = new AdvancedMessageHandler(client);
  client.onMessage(handler.createHandler());

  console.log('🤖 高级消息处理器已启动');
  console.log('💡 可用命令:');
  console.log('   "搜索:关键词" - 搜索包含关键词的消息');
  console.log('   "统计" - 获取聊天统计信息');
  console.log('   "备份" - 备份最近200条消息');
  console.log('   "最新5" - 获取最新5条消息');
}

// 主函数
async function main() {
  const mode = process.argv[2] || '1';

  try {
    switch (mode) {
      case '0':
        await example0_BotBaseUsage();
        break;
      case '1':
        await example1_DirectClientUsage();
        break;
      case '2':
      case '3':
        await example3_ReactiveHandler();
        break;
      default:
        console.log(
          'Usage: npx ts-node onMessage-with-getMessages-example.ts [0|1|2|3]',
        );
        console.log('  0: 使用 TelegramBotBase');
        console.log('  1: 基础用法');
        console.log('  2/3: 高级用法');
        break;
    }
  } catch (error) {
    console.error('❌ 示例执行失败:', error);
  }
}

// 保持进程运行
process.on('SIGINT', () => {
  console.log('\n👋 程序退出');
  process.exit(0);
});

if (require.main === module) {
  main().catch(console.error);
}

export { AdvancedMessageHandler, analyzeMessages };
