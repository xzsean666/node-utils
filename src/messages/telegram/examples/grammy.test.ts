import { Bot, Context } from 'grammy';
import { HttpsProxyAgent } from 'https-proxy-agent';

// 设置代理（根据您的实际代理地址修改）
const proxyUrl = 'http://127.0.0.1:7897'; // 请替换为您的代理地址和端口
const agent = new HttpsProxyAgent(proxyUrl);

const token = '8187983534:AAFoGynqcfxx5mLkmqRncmAI6UsDOnHqzFs';
// 创建bot时使用代理
const bot = new Bot(token, {
  client: {
    apiRoot: 'https://api.telegram.org',
    baseFetchConfig: {
      agent,
      compress: true,
    },
  },
});

// Add error handling
bot.catch((err) => {
  console.error('Bot error:', err);
});

console.log('Bot starting up...');
bot.command('check', async (ctx) => {
  // Get the text after the command using ctx.match
  const commandParameter = ctx.match || '';

  if (commandParameter) {
    await ctx.reply(`You said: ${commandParameter}`);
  } else {
    await ctx.reply('Please provide some text after the /check command');
  }
});
bot.on('message:text', async (ctx) => {
  //   console.log("Received message:", ctx.message);
  await ctx.reply('Hello, world!');
});

// Log when bot is ready
bot.start({
  onStart: (botInfo) => {
    console.log(`Bot @${botInfo.username} started successfully!`);
    console.log('Waiting for messages...');
  },
});
