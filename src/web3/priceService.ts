import axios from 'axios';
// 基础类型定义
interface ExchangeConfig {
  baseUrl: string;
  getCurrentPriceUrl: (symbol: string) => string;
  getHistoricalPriceUrl: (symbol: string, timestamp: number) => string;
  parseCurrentResponse: (data: any) => number;
  parseHistoricalResponse: (data: any) => number;
}

interface PriceResult {
  exchange: string;
  price: number | null;
  timestamp: number;
  error?: string;
  fromCache?: boolean;
}

interface PriceOptions {
  timestamp?: number;
}

// 交易所配置
const EXCHANGES: Record<string, ExchangeConfig> = {
  gate: {
    baseUrl: 'https://api.gateio.ws/api/v4',
    getCurrentPriceUrl: (symbol) =>
      `/spot/tickers?currency_pair=${symbol}_USDT`,
    getHistoricalPriceUrl: (symbol, timestamp) =>
      `/spot/candlesticks?currency_pair=${symbol}_USDT&from=${timestamp}&to=${
        timestamp + 60
      }&interval=1m`,
    parseCurrentResponse: (data) => parseFloat(data[0]?.last),
    parseHistoricalResponse: (data) => parseFloat(data[0]?.[2]),
  },
  binance: {
    baseUrl: 'https://api.binance.com/api/v3',
    getCurrentPriceUrl: (symbol) => `/ticker/price?symbol=${symbol}USDT`,
    getHistoricalPriceUrl: (symbol, timestamp) =>
      `/klines?symbol=${symbol}USDT&interval=1m&startTime=${
        timestamp * 1000
      }&limit=1`,
    parseCurrentResponse: (data) => parseFloat(data.price),
    parseHistoricalResponse: (data) => parseFloat(data[0]?.[4]),
  },
  huobi: {
    baseUrl: 'https://api.huobi.pro/market',
    getCurrentPriceUrl: (symbol) =>
      `/detail/merged?symbol=${symbol.toLowerCase()}usdt`,
    getHistoricalPriceUrl: (symbol, timestamp) =>
      `/history/kline?symbol=${symbol.toLowerCase()}usdt&period=1min&size=1&start=${timestamp}`,
    parseCurrentResponse: (data) => parseFloat(data.tick?.close),
    parseHistoricalResponse: (data) => parseFloat(data.data[0]?.close),
  },
  okx: {
    baseUrl: 'https://www.okx.com/api/v5',
    getCurrentPriceUrl: (symbol) => `/market/ticker?instId=${symbol}-USDT`,
    getHistoricalPriceUrl: (symbol, timestamp) =>
      `/market/history-candles?instId=${symbol}-USDT&after=${
        timestamp * 1000
      }&bar=1m&limit=1`,
    parseCurrentResponse: (data) => parseFloat(data.data[0]?.last),
    parseHistoricalResponse: (data) => parseFloat(data.data[0]?.[4]),
  },
  kucoin: {
    baseUrl: 'https://api.kucoin.com/api/v1',
    getCurrentPriceUrl: (symbol) =>
      `/market/orderbook/level1?symbol=${symbol}-USDT`,
    getHistoricalPriceUrl: (symbol, timestamp) =>
      `/market/candles?symbol=${symbol}-USDT&startAt=${timestamp}&endAt=${
        timestamp + 60
      }&type=1min`,
    parseCurrentResponse: (data) => parseFloat(data.data?.price),
    parseHistoricalResponse: (data) => parseFloat(data.data[0]?.[2]),
  },
};

export class PriceService {
  private readonly TIMEOUT = 2000;

  private normalizeToken(token: string): string {
    const tokenMap: Record<string, string> = {
      WETH: 'ETH',
      'USDC.E': 'USDC',
      USDT: 'USDT',
    };
    return tokenMap[token.toUpperCase()] || token.toUpperCase();
  }

  private async fetchPrice(
    exchange: string,
    config: ExchangeConfig,
    token: string,
    options: PriceOptions = {},
  ): Promise<PriceResult> {
    try {
      const { timestamp } = options;
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const isHistorical = Boolean(timestamp);

      const url = `${config.baseUrl}${
        isHistorical
          ? config.getHistoricalPriceUrl(token, timestamp!)
          : config.getCurrentPriceUrl(token)
      }`;

      const response = await axios.get(url, {
        timeout: this.TIMEOUT,
        headers: { Accept: 'application/json' },
      });

      const price = isHistorical
        ? config.parseHistoricalResponse(response.data)
        : config.parseCurrentResponse(response.data);

      return {
        exchange,
        price,
        timestamp: timestamp || currentTimestamp,
        fromCache: false,
      };
    } catch (error) {
      // console.error(`Error fetching price from ${exchange}:`, error);
      return {
        exchange,
        price: null,
        timestamp: options.timestamp || Math.floor(Date.now() / 1000),
        error: error instanceof Error ? error.message : 'Unknown error',
        fromCache: false,
      };
    }
  }

  async getAllPrices(
    token: string,
    options: PriceOptions = {},
  ): Promise<PriceResult[]> {
    const normalizedToken = this.normalizeToken(token);

    if (normalizedToken === 'USDT') {
      return Object.keys(EXCHANGES).map((exchange) => ({
        exchange,
        price: 1,
        timestamp: options.timestamp || Date.now(),
        fromCache: false,
      }));
    }

    const pricePromises = Object.entries(EXCHANGES).map(([exchange, config]) =>
      this.fetchPrice(exchange, config, normalizedToken, options),
    );

    return Promise.all(pricePromises);
  }

  async getPrice(
    token: string,
    exchange: string,
    options: PriceOptions = {},
  ): Promise<PriceResult> {
    const config = EXCHANGES[exchange];
    if (!config) {
      return {
        exchange,
        price: null,
        timestamp: options.timestamp || Date.now(),
        error: 'Exchange not supported',
      };
    }

    return this.fetchPrice(
      exchange,
      config,
      this.normalizeToken(token),
      options,
    );
  }

  async getHistoricalPrices(
    token: string,
    timestamps: number[],
  ): Promise<Record<number, PriceResult[]>> {
    const normalizedToken = this.normalizeToken(token);
    const results: Record<number, PriceResult[]> = {};

    await Promise.all(
      timestamps.map(async (timestamp) => {
        const prices = await this.getAllPrices(normalizedToken, { timestamp });
        results[timestamp] = prices;
      }),
    );

    return results;
  }

  // 获取有效价格的平均值
  private calculateAveragePrice(prices: PriceResult[]): number | null {
    const validPrices = prices
      .filter((p) => p.price !== null)
      .map((p) => p.price as number);

    if (validPrices.length === 0) return null;

    return (
      validPrices.reduce((sum, price) => sum + price, 0) / validPrices.length
    );
  }

  // 获取当前平均价格
  async getCurrentAveragePrice(token: string): Promise<number | null> {
    const prices = await this.getAllPrices(token);
    return this.calculateAveragePrice(prices);
  }

  // 获取历史平均价格
  async getHistoricalAveragePrice(
    token: string,
    timestamp: number,
  ): Promise<number | null> {
    const prices = await this.getAllPrices(token, { timestamp });
    return this.calculateAveragePrice(prices);
  }
}
