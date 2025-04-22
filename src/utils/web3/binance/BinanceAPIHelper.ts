import axios from "axios";
import crypto from "crypto";
import {
  BinanceConfig,
  BinanceBalance,
  BinanceTrade,
  BinanceOrder,
  FuturesAccountInfo,
} from "./types";

export class BinanceAPIHelper {
  private apiKey?: string;
  private apiSecret?: string;
  private baseUrl: string;
  private futuresBaseUrl: string;

  constructor(config: BinanceConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.isTestnet
      ? "https://testnet.binance.vision"
      : "https://api.binance.com";
    this.futuresBaseUrl = config.isTestnet
      ? "https://testnet.binancefuture.com"
      : "https://fapi.binance.com";
  }

  private async signRequest(params: Record<string, any>): Promise<string> {
    const timestamp = Date.now();
    const queryString = Object.entries({ ...params, timestamp })
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    if (!this.apiSecret) {
      throw new Error("API secret is not set");
    }
    const signature = crypto
      .createHmac("sha256", this.apiSecret)
      .update(queryString)
      .digest("hex");

    return `${queryString}&signature=${signature}`;
  }

  private async makeRequest<T>(
    method: "GET" | "POST" | "DELETE",
    endpoint: string,
    params: Record<string, any> = {},
    baseUrl?: string
  ): Promise<T> {
    const signedQuery = await this.signRequest(params);
    const url = `${baseUrl || this.baseUrl}${endpoint}?${signedQuery}`;

    const response = await axios({
      method,
      url,
      headers: {
        "X-MBX-APIKEY": this.apiKey,
      },
    });

    return response.data;
  }

  /**
   * Get current account information
   * @returns Account information including balances
   */
  async getAccountInfo(): Promise<{
    makerCommission: number;
    takerCommission: number;
    buyerCommission: number;
    sellerCommission: number;
    canTrade: boolean;
    canWithdraw: boolean;
    canDeposit: boolean;
    updateTime: number;
    accountType: string;
    balances: BinanceBalance[];
    permissions: string[];
  }> {
    return this.makeRequest("GET", "/api/v3/account");
  }

  /**
   * Get trades for a specific symbol
   * @param symbol Trading pair symbol (e.g., 'BTCUSDT')
   * @param options Additional query parameters
   */
  async getAccountTrades(
    symbol: string,
    options: {
      startTime?: number;
      endTime?: number;
      fromId?: number;
      limit?: number;
    } = {}
  ): Promise<BinanceTrade[]> {
    return this.makeRequest("GET", "/api/v3/myTrades", {
      symbol,
      ...options,
    });
  }

  /**
   * Get all open orders for a specific symbol
   * @param symbol Trading pair symbol (e.g., 'BTCUSDT')
   */
  async getOpenOrders(symbol?: string): Promise<BinanceOrder[]> {
    return this.makeRequest("GET", "/api/v3/openOrders", {
      ...(symbol && { symbol }),
    });
  }

  /**
   * Get all orders for a specific symbol
   * @param symbol Trading pair symbol (e.g., 'BTCUSDT')
   * @param options Additional query parameters
   */
  async getAllOrders(
    symbol: string,
    options: {
      orderId?: number;
      startTime?: number;
      endTime?: number;
      limit?: number;
    } = {}
  ): Promise<BinanceOrder[]> {
    return this.makeRequest("GET", "/api/v3/allOrders", {
      symbol,
      ...options,
    });
  }

  /**
   * Get account balance for a specific asset
   * @param asset Asset symbol (e.g., 'BTC')
   */
  async getAssetBalance(asset: string): Promise<BinanceBalance | null> {
    const accountInfo = await this.getAccountInfo();
    const balance = accountInfo.balances.find((b) => b.asset === asset);
    return balance || null;
  }

  /**
   * Get USDⓈ-M Futures account information
   * @returns Futures account information including positions and balances
   */
  async getFuturesAccountInfo(): Promise<FuturesAccountInfo> {
    return this.makeRequest("GET", "/fapi/v3/account", {}, this.futuresBaseUrl);
  }

  /**
   * Get spot trading history for a specific symbol
   * @param symbol Trading pair symbol (e.g., 'BTCUSDT')
   * @param options Additional query parameters
   */
  async getSpotTradingHistory(
    symbol: string,
    options: {
      startTime?: number;
      endTime?: number;
      fromId?: number;
      limit?: number;
      orderId?: number;
    } = {}
  ): Promise<BinanceTrade[]> {
    return this.makeRequest("GET", "/api/v3/myTrades", {
      symbol,
      limit: 500, // 设置默认值
      ...options,
    });
  }

  /**
   * Get futures trading history for a specific symbol
   * @param symbol Trading pair symbol (e.g., 'BTCUSDT')
   * @param options Additional query parameters
   */
  async getFuturesTradingHistory(
    symbol: string,
    options: {
      startTime?: number;
      endTime?: number;
      fromId?: number;
      limit?: number;
    } = {}
  ): Promise<BinanceTrade[]> {
    return this.makeRequest(
      "GET",
      "/fapi/v1/userTrades",
      {
        symbol,
        limit: 500, // 设置默认值
        ...options,
      },
      this.futuresBaseUrl
    );
  }

  /**
   * Get spot trading history for multiple symbols
   * @param symbols Array of trading pair symbols (e.g., ['BTCUSDT', 'ETHUSDT'])
   * @param options Additional query parameters
   */
  async getAllSpotTradingHistory(
    symbols: string[],
    options: {
      startTime?: number;
      endTime?: number;
      fromId?: number;
      limit?: number;
    } = {}
  ): Promise<BinanceTrade[]> {
    const allTrades: BinanceTrade[] = [];

    for (const symbol of symbols) {
      try {
        const trades = await this.getSpotTradingHistory(symbol, {
          ...options,
          limit: options.limit || 500,
        });
        allTrades.push(...trades);
      } catch (error) {
        console.error(`Failed to get trades for ${symbol}:`, error);
      }
    }

    // 按时间排序
    return allTrades.sort((a, b) => b.time - a.time);
  }

  /**
   * Get all futures trading history with pagination support
   * @param options Additional query parameters
   * @param options.fromId Get trades from tradeId (inclusive)
   * @param options.limit Default 500; max 1000
   * @param options.startTime Start time in milliseconds
   * @param options.endTime End time in milliseconds
   */
  async getAllFuturesTradingHistory(
    options: {
      startTime?: number;
      endTime?: number;
      fromId?: number;
      limit?: number;
    } = {}
  ): Promise<BinanceTrade[]> {
    return this.makeRequest(
      "GET",
      "/fapi/v1/userTrades",
      {
        limit: 500, // 设置默认值
        ...options,
      },
      this.futuresBaseUrl
    );
  }
}
