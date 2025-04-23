import axios from "axios";
import crypto from "crypto";
import {
  BinanceConfig,
  BinanceBalance,
  BinanceTrade,
  BinanceOrder,
  FuturesAccountInfo,
  BinanceAccountInfo,
  FuturesPosition,
  FormattedPosition,
} from "./types";
export * from "./types";

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

  /**
   * Get account ID (API key)
   * @returns Account ID
   */
  getAccountId(): string {
    return this.apiKey?.slice(0, 10) || "unknown";
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
  async getAccountInfo(): Promise<BinanceAccountInfo> {
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
    const accountInfo = await this.makeRequest<FuturesAccountInfo>(
      "GET",
      "/fapi/v3/account",
      {},
      this.futuresBaseUrl
    );

    // 获取所有持仓的入场价格
    const positionsWithEntryPrice = await Promise.all(
      accountInfo.positions.map(async (position) => {
        if (parseFloat(position.positionAmt) !== 0) {
          const trades = await this.getFuturesTradingHistory(position.symbol, {
            limit: 1,
          });
          if (trades.length > 0) {
            return {
              ...position,
              entryPrice: trades[0].price,
            };
          }
        }
        return position;
      })
    );

    return {
      ...accountInfo,
      positions: positionsWithEntryPrice,
    };
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

  /**
   * Format position information with health status and metrics
   * @param position Position information from futures account
   * @param markPrice Current mark price of the position
   */
  private formatPositionWithHealthStatus(
    position: FuturesPosition,
    markPrice: string
  ): FormattedPosition {
    const positionAmt = parseFloat(position.positionAmt);
    const unrealizedProfit = parseFloat(position.unrealizedProfit);
    const initialMargin = parseFloat(position.initialMargin);
    const maintMargin = parseFloat(position.maintMargin);
    const notional = parseFloat(position.notional);

    // 计算风险率
    const riskRatio = maintMargin / (initialMargin + unrealizedProfit);

    // 计算保证金率
    const marginRatio = (initialMargin + unrealizedProfit) / maintMargin;

    // 计算实际杠杆率
    const leverage = notional / (initialMargin + unrealizedProfit);

    // 使用币安API返回的入场价格
    const entryPrice =
      position.entryPrice || (notional / Math.abs(positionAmt)).toString();

    // 计算强平价格
    const liquidationPrice = this.calculateLiquidationPrice(
      position,
      entryPrice,
      markPrice
    );

    // 计算安全距离
    const currentPrice = parseFloat(markPrice);
    const liqPrice = parseFloat(liquidationPrice);
    const safetyDistance =
      positionAmt > 0
        ? ((currentPrice - liqPrice) / currentPrice) * 100
        : ((liqPrice - currentPrice) / currentPrice) * 100;

    // 确定健康等级
    const healthLevel = this.determineHealthLevel(
      riskRatio,
      marginRatio,
      safetyDistance
    );

    // 计算收益率
    const roe = (unrealizedProfit / initialMargin) * 100;

    // 计算盈亏百分比
    const pnlPercentage = (unrealizedProfit / notional) * 100;

    return {
      ...position,
      healthStatus: {
        riskRatio,
        marginRatio,
        leverage,
        liquidationPrice,
        safetyDistance,
        healthLevel,
      },
      metrics: {
        entryPrice,
        markPrice,
        roe,
        pnl: position.unrealizedProfit,
        pnlPercentage,
      },
    };
  }

  /**
   * Calculate liquidation price based on position details
   */
  private calculateLiquidationPrice(
    position: FuturesPosition,
    entryPrice: string,
    markPrice: string
  ): string {
    const positionAmt = parseFloat(position.positionAmt);
    const maintMargin = parseFloat(position.maintMargin);
    const initialMargin = parseFloat(position.initialMargin);

    if (positionAmt > 0) {
      // 多仓强平价格
      return (
        parseFloat(entryPrice) *
        (1 - maintMargin / initialMargin)
      ).toString();
    } else {
      // 空仓强平价格
      return (
        parseFloat(entryPrice) *
        (1 + maintMargin / initialMargin)
      ).toString();
    }
  }

  /**
   * Determine health level based on risk metrics
   */
  private determineHealthLevel(
    riskRatio: number,
    marginRatio: number,
    safetyDistance: number
  ): "SAFE" | "WARNING" | "DANGER" {
    if (riskRatio < 0.5 && marginRatio > 2 && safetyDistance > 20) {
      return "SAFE";
    } else if (riskRatio < 0.8 && marginRatio > 1.2 && safetyDistance > 10) {
      return "WARNING";
    } else {
      return "DANGER";
    }
  }

  /**
   * Get formatted futures positions with health status
   */
  async getFormattedFuturesPositions(): Promise<FormattedPosition[]> {
    const accountInfo = await this.getFuturesAccountInfo();
    const positions = accountInfo.positions.filter(
      (p) => parseFloat(p.positionAmt) !== 0
    );

    // 获取所有持仓的标记价格
    const markPrices = await Promise.all(
      positions.map((p) => this.getMarkPrice(p.symbol))
    );

    return positions.map((position, index) =>
      this.formatPositionWithHealthStatus(position, markPrices[index])
    );
  }

  /**
   * Get mark price for a symbol
   */
  private async getMarkPrice(symbol: string): Promise<string> {
    const response = await this.makeRequest<{ markPrice: string }>(
      "GET",
      "/fapi/v1/premiumIndex",
      { symbol },
      this.futuresBaseUrl
    );
    return response.markPrice;
  }
}
