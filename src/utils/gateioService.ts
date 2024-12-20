import axios from "axios";
import { KVDatabase } from "./PGKVDatabase";
import dotenv from "dotenv";
dotenv.config();

export class GateioService {
  private readonly BASE_URL = "https://api.gateio.ws/api/v4";
  private readonly db?: KVDatabase;

  constructor(dbConfig?: { dbUrl: string; tableName: string }) {
    // 如果没有传入 dbConfig，尝试从环境变量获取
    const dbUrl = dbConfig?.dbUrl || process.env.GATE_PRICE_CACHE_DB_URL;
    const tableName =
      dbConfig?.tableName ||
      process.env.GATE_PRICE_CACHE_DB_TABLE_NAME ||
      "gate_price_cache";

    if (dbUrl && tableName) {
      this.db = new KVDatabase(dbUrl, tableName);
    }
  }

  async getPrice(token: string, timestamp?: number): Promise<number> {
    try {
      // 构建缓存键
      const cacheKey = `price:${token}:${timestamp || "current"}`;

      // 如果启用了缓存，先尝试从缓存获取
      if (this.db) {
        const cachedPrice = await this.db.get(cacheKey);
        if (cachedPrice) {
          return parseFloat(cachedPrice);
        }
      }

      // 以下是原有的价格获取逻辑
      let symbolToken = token.toUpperCase();
      if (symbolToken === "WETH") {
        symbolToken = "ETH";
      }
      if (symbolToken === "USDC.E") {
        symbolToken = "USDC";
      }
      if (symbolToken === "USDT") {
        symbolToken = "USDT";
        return 1;
      }

      const currencyPair = `${symbolToken}_USDT`;
      let price: number;

      if (timestamp) {
        const interval = "1m";
        const endTime = timestamp + 60;
        const url = `${this.BASE_URL}/spot/candlesticks?currency_pair=${currencyPair}&from=${timestamp}&to=${endTime}&interval=${interval}`;
        const response = await axios.get(url);

        if (
          response.data &&
          Array.isArray(response.data) &&
          response.data.length > 0
        ) {
          const [, , close] = response.data[0];
          price = parseFloat(close);
        } else {
          throw new Error(`未找到交易对 ${currencyPair} 的历史价格信息`);
        }
      } else {
        const url = `${this.BASE_URL}/spot/tickers?currency_pair=${currencyPair}`;
        const response = await axios.get(url);

        if (
          response.data &&
          Array.isArray(response.data) &&
          response.data.length > 0
        ) {
          const ticker = response.data[0];
          if (ticker.last) {
            price = parseFloat(ticker.last);
          } else {
            throw new Error(`未找到交易对 ${currencyPair} 的价格信息`);
          }
        } else {
          throw new Error(`未找到交易对 ${currencyPair} 的价格信息`);
        }
      }

      // 如果启用了缓存，将结果存入缓存
      if (this.db) {
        // 设置5分钟的缓存时间
        await this.db.put(cacheKey, price.toString());
      }

      return price;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`请求失败:`, {
          status: error.response?.status,
          data: error.response?.data,
          url: error.config?.url,
        });
      }
      throw error;
    }
  }
}
