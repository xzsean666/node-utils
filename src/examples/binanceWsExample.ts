import { BinanceWssHelper } from '../web3/binance/BinancewssHelper';

/**
 * Example demonstrating how to use BinanceWssHelper to get data from
 * Binance WebSocket streams
 */

// 尝试多种不同的 URL 格式，因为 Binance API 可能会有变化
const urls = [
  // 1. 合约行情地址 (正常格式)
  'wss://fstream.binance.com/stream?streams=bnbusdt@aggTrade/btcusdt@markPrice',

  // 2. 尝试普通行情地址 (替代格式)
  'wss://stream.binance.com:9443/stream?streams=bnbusdt@aggTrade/btcusdt@markPrice',

  // 3. 使用 ws 而不是 wss
  'ws://fstream.binance.com/stream?streams=bnbusdt@aggTrade/btcusdt@markPrice',

  // 4. 使用 /ws/ 路径
  'wss://fstream.binance.com/ws/bnbusdt@aggTrade/btcusdt@markPrice',
];

// 创建第一个连接
console.log('尝试连接到 URL:', urls[0]);
const binanceWss = new BinanceWssHelper({
  streams: ['bnbusdt@aggTrade', 'btcusdt@markPrice'],
  directUrl: urls[0],
  proxy: 'http://127.0.0.1:7897',
});

// 事件处理
binanceWss.on('connected', () => {
  console.log('连接成功: ', urls[0]);
});

binanceWss.on('message', (message) => {
  console.log(
    `Received message from stream ${message.stream}:`,
    JSON.stringify(message.data).substring(0, 100),
  );
});

binanceWss.on('error', (error) => {
  console.error('连接错误:', error.message);
});

// 5秒后如果第一个连接失败，尝试第二个连接
setTimeout(() => {
  if (!binanceWss.isWebSocketConnected()) {
    console.log('首次连接失败，尝试第二个 URL:', urls[1]);
    binanceWss.disconnect();

    const binanceWss2 = new BinanceWssHelper({
      streams: [],
      directUrl: urls[1],
    });

    binanceWss2.on('connected', () => {
      console.log('第二次连接成功: ', urls[1]);
    });

    binanceWss2.on('message', (message) => {
      console.log('收到消息(2):', JSON.stringify(message).substring(0, 100));
    });

    binanceWss2.connect();

    // 5秒后如果第二个连接失败，尝试第三个连接
    setTimeout(() => {
      if (!binanceWss2.isWebSocketConnected()) {
        console.log('第二次连接失败，尝试第三个 URL:', urls[2]);
        binanceWss2.disconnect();

        const binanceWss3 = new BinanceWssHelper({
          streams: [],
          directUrl: urls[2],
        });

        binanceWss3.on('connected', () => {
          console.log('第三次连接成功: ', urls[2]);
        });

        binanceWss3.on('message', (message) => {
          console.log(
            '收到消息(3):',
            JSON.stringify(message).substring(0, 100),
          );
        });

        binanceWss3.connect();

        // 5秒后如果第三个连接失败，尝试第四个连接
        setTimeout(() => {
          if (!binanceWss3.isWebSocketConnected()) {
            console.log('第三次连接失败，尝试第四个 URL:', urls[3]);
            binanceWss3.disconnect();

            const binanceWss4 = new BinanceWssHelper({
              streams: [],
              directUrl: urls[3],
            });

            binanceWss4.on('connected', () => {
              console.log('第四次连接成功: ', urls[3]);
            });

            binanceWss4.on('message', (message) => {
              console.log(
                '收到消息(4):',
                JSON.stringify(message).substring(0, 100),
              );
            });

            binanceWss4.connect();
          }
        }, 5000);
      }
    }, 5000);
  }
}, 5000);

// 连接并保持程序运行
binanceWss.connect();
console.log('Binance WebSocket 测试程序运行中...');

// 处理程序关闭
process.on('SIGINT', () => {
  console.log('关闭连接...');
  binanceWss.disconnect();
  process.exit();
});
