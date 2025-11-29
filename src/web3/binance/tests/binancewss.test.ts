import WebSocket from "ws"; // 需要安装: npm install ws
import { HttpsProxyAgent } from "https-proxy-agent"; // 需要安装: npm install https-proxy-agent

// 设置代理地址
const proxyUrl = "http://127.0.0.1:7897"; // 请替换为您的代理地址
console.log(`使用代理: ${proxyUrl}`);
const proxyAgent = new HttpsProxyAgent(proxyUrl);

const ws = new WebSocket(
  "wss://fstream.binance.com/stream?streams=bnbusdt@aggTrade/btcusdt@markPrice",
  {
    agent: proxyAgent,
  }
);

ws.on("open", () => {
  console.log("WebSocket 连接已建立");
});

ws.on("message", (data) => {
  const message = JSON.parse(data.toString());
  console.log("收到消息:", JSON.stringify(message, null, 2));
});

ws.on("error", (error) => {
  console.error("WebSocket 错误:", error);
});

ws.on("close", () => {
  console.log("WebSocket 连接已关闭");
});

// 10秒后关闭连接
setTimeout(() => {
  ws.close();
}, 30000);
