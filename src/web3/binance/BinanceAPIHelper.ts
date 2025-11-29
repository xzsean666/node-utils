import axios from "axios";
import * as crypto from "crypto";
import {
  BinanceConfig,
  BinanceBalance,
  BinanceTrade,
  BinanceOrder,
  FuturesAccountInfo,
  BinanceAccountInfo,
  FuturesPosition,
  FormattedPosition,
  FuturesAccountState,
  FuturesAccountChanges,
} from "./types";
export * from "./types";

// 在文件顶部添加接口定义
interface KlineUpdateParams {
  symbol: string;
  interval: string;
  startTime: number;
  endTime?: number;
  isFutures: boolean;
  limit?: number;
}

interface KlineUpdateCheckpoint extends KlineUpdateParams {
  lastKlineTime: number;
  totalKlines: number;
  lastUpdateTime: number;
  error?: string;
}

export class BinanceAPIHelper {
  private apiKey?: string;
  private apiSecret?: string;
  private baseUrl: string;
  private futuresBaseUrl: string;
  private kvdb: any; // 用于存储断点信息

  constructor(config: BinanceConfig, kvdb?: any) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.isTestnet
      ? "https://testnet.binance.vision"
      : "https://api.binance.com";
    this.futuresBaseUrl = config.isTestnet
      ? "https://testnet.binancefuture.com"
      : "https://fapi.binance.com";
    this.kvdb = kvdb;
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

  async checkAPIKeyAndSecret(): Promise<{
    spot: boolean;
    futures: boolean;
  }> {
    const result = {
      spot: false,
      futures: false,
    };

    try {
      // 验证现货账号
      await this.getAccountInfo();
      result.spot = true;
    } catch (error) {
      result.spot = false;
    }

    try {
      // 验证合约账号
      await this.makeRequest<FuturesAccountInfo>(
        "GET",
        "/fapi/v3/account",
        {},
        this.futuresBaseUrl
      );
      result.futures = true;
    } catch (error) {
      result.futures = false;
    }

    return result;
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

  /**
   * 获取指定时间点的账户状态
   * @param targetTime 目标时间戳（毫秒）
   * @returns 指定时间的账户状态
   */
  async getFuturesAccountStateAt(
    targetTime: number
  ): Promise<FuturesAccountState> {
    // 1. 获取当前账户状态
    const currentAccount = await this.getFuturesAccountInfo();

    // 2. 获取目标时间到现在的交易历史
    const trades = await this.getAllFuturesTradingHistory({
      startTime: targetTime,
      endTime: Date.now(),
    });

    // 按交易对分组
    const tradesBySymbol: Record<string, BinanceTrade[]> = {};

    trades.forEach((trade) => {
      if (!tradesBySymbol[trade.symbol]) {
        tradesBySymbol[trade.symbol] = [];
      }
      tradesBySymbol[trade.symbol].push(trade);
    });

    // 3. 创建一个持仓映射，以便于更新
    const positionMap: Record<
      string,
      {
        symbol: string;
        positionAmt: number;
        entryPrice: number;
        unrealizedProfit: number;
        initialMargin: number;
        maintMargin: number;
      }
    > = {};

    // 初始化当前所有持仓
    currentAccount.positions.forEach((pos) => {
      if (parseFloat(pos.positionAmt) !== 0) {
        positionMap[pos.symbol] = {
          symbol: pos.symbol,
          positionAmt: parseFloat(pos.positionAmt),
          entryPrice: parseFloat(pos.entryPrice || "0"),
          unrealizedProfit: parseFloat(pos.unrealizedProfit),
          initialMargin: parseFloat(pos.initialMargin),
          maintMargin: parseFloat(pos.maintMargin),
        };
      }
    });

    // 4. 复制当前账户状态作为基础
    const historicalAccount = {
      totalInitialMargin: currentAccount.totalInitialMargin,
      totalMaintMargin: currentAccount.totalMaintMargin,
      totalWalletBalance: currentAccount.totalWalletBalance,
      totalUnrealizedProfit: currentAccount.totalUnrealizedProfit,
      totalMarginBalance: currentAccount.totalMarginBalance,
      totalPositionInitialMargin: currentAccount.totalPositionInitialMargin,
      totalOpenOrderInitialMargin: currentAccount.totalOpenOrderInitialMargin,
      totalCrossWalletBalance: currentAccount.totalCrossWalletBalance,
      totalCrossUnPnl: currentAccount.totalCrossUnPnl,
      availableBalance: currentAccount.availableBalance,
      maxWithdrawAmount: currentAccount.maxWithdrawAmount,
      positions: [] as Array<{
        symbol: string;
        positionAmt: string;
        entryPrice: string;
        unrealizedProfit: string;
        initialMargin: string;
        maintMargin: string;
      }>,
    };

    // 5. 计算更改的余额信息
    let realizedPnlChange = 0;
    let commissionChange = 0;

    // 6. 从新到旧反向应用交易
    Object.keys(tradesBySymbol).forEach((symbol) => {
      const symbolTrades = tradesBySymbol[symbol];

      // 按时间从新到旧排序
      symbolTrades.sort((a, b) => b.time - a.time);

      // 如果这个交易对当前没有持仓，但有交易，创建一个空持仓
      if (!positionMap[symbol] && symbolTrades.length > 0) {
        positionMap[symbol] = {
          symbol,
          positionAmt: 0,
          entryPrice: 0,
          unrealizedProfit: 0,
          initialMargin: 0,
          maintMargin: 0,
        };
      }

      // 反向应用每笔交易来回溯到目标时间
      symbolTrades.forEach((trade) => {
        const qty = parseFloat(trade.qty);
        const price = parseFloat(trade.price);
        const side = trade.side.toUpperCase();

        // 累计实现盈亏变化
        if (trade.realizedPnl) {
          realizedPnlChange += parseFloat(trade.realizedPnl);
        }

        // 累计手续费变化
        if (trade.commission) {
          commissionChange += parseFloat(trade.commission);
        }

        // 反向应用持仓变化
        if (positionMap[symbol]) {
          if (side === "BUY") {
            // 如果是买入，回溯就是减少持仓
            positionMap[symbol].positionAmt -= qty;
          } else if (side === "SELL") {
            // 如果是卖出，回溯就是增加持仓
            positionMap[symbol].positionAmt += qty;
          }
        }
      });
    });

    // 7. 调整钱包余额（撤销已实现盈亏和手续费的影响）
    const totalWalletBalance = parseFloat(historicalAccount.totalWalletBalance);
    historicalAccount.totalWalletBalance = (
      totalWalletBalance -
      realizedPnlChange +
      commissionChange
    ).toFixed(8);

    // 8. 计算未实现盈亏和保证金（简化版）
    let totalUnrealizedProfit = 0;
    let totalInitialMargin = 0;
    let totalMaintMargin = 0;

    // 9. 转换持仓信息并计算总额
    historicalAccount.positions = Object.values(positionMap)
      .filter((pos) => pos.positionAmt !== 0)
      .map((pos) => {
        // 简化的未实现盈亏计算（实际应该考虑目标时间的价格）
        // 这里假设持仓数量变化会按比例改变未实现盈亏
        const currentPosition = currentAccount.positions.find(
          (p) => p.symbol === pos.symbol
        );
        const currentPosAmt = currentPosition
          ? parseFloat(currentPosition.positionAmt)
          : 0;

        let unrealizedProfit = 0;
        if (currentPosAmt !== 0 && currentPosition) {
          const ratio = pos.positionAmt / currentPosAmt;
          unrealizedProfit =
            parseFloat(currentPosition.unrealizedProfit) * ratio;
        }

        // 简化的保证金计算
        const initialMargin = Math.abs(pos.positionAmt * pos.entryPrice) / 20; // 假设20倍杠杆
        const maintMargin = initialMargin * 0.5; // 假设维持保证金是初始保证金的50%

        totalUnrealizedProfit += unrealizedProfit;
        totalInitialMargin += initialMargin;
        totalMaintMargin += maintMargin;

        return {
          symbol: pos.symbol,
          positionAmt: pos.positionAmt.toString(),
          entryPrice: pos.entryPrice.toString(),
          unrealizedProfit: unrealizedProfit.toFixed(8),
          initialMargin: initialMargin.toFixed(8),
          maintMargin: maintMargin.toFixed(8),
        };
      });

    // 10. 更新账户总金额
    historicalAccount.totalUnrealizedProfit = totalUnrealizedProfit.toFixed(8);
    historicalAccount.totalInitialMargin = totalInitialMargin.toFixed(8);
    historicalAccount.totalMaintMargin = totalMaintMargin.toFixed(8);
    historicalAccount.totalPositionInitialMargin =
      totalInitialMargin.toFixed(8);

    // 11. 计算其他账户余额指标
    const walletBalance = parseFloat(historicalAccount.totalWalletBalance);
    historicalAccount.totalMarginBalance = (
      walletBalance + totalUnrealizedProfit
    ).toFixed(8);
    historicalAccount.totalCrossWalletBalance =
      historicalAccount.totalWalletBalance;
    historicalAccount.totalCrossUnPnl = historicalAccount.totalUnrealizedProfit;
    historicalAccount.availableBalance = (
      walletBalance +
      totalUnrealizedProfit -
      totalInitialMargin
    ).toFixed(8);
    historicalAccount.maxWithdrawAmount = historicalAccount.availableBalance;

    return historicalAccount;
  }

  /**
   * 获取当前时间的期货账户状态
   * @returns 当前账户状态的详细信息
   */
  async getCurrentFuturesAccountState(): Promise<FuturesAccountState> {
    // 获取当前账户信息
    const accountInfo = await this.getFuturesAccountInfo();

    // 过滤非空持仓
    const activePositions = accountInfo.positions
      .filter((pos) => parseFloat(pos.positionAmt) !== 0)
      .map((pos) => ({
        symbol: pos.symbol,
        positionAmt: pos.positionAmt,
        entryPrice: pos.entryPrice || "0",
        unrealizedProfit: pos.unrealizedProfit,
        initialMargin: pos.initialMargin,
        maintMargin: pos.maintMargin,
      }));

    // 组织返回格式，与历史状态查询一致
    return {
      totalInitialMargin: accountInfo.totalInitialMargin,
      totalMaintMargin: accountInfo.totalMaintMargin,
      totalWalletBalance: accountInfo.totalWalletBalance,
      totalUnrealizedProfit: accountInfo.totalUnrealizedProfit,
      totalMarginBalance: accountInfo.totalMarginBalance,
      totalPositionInitialMargin: accountInfo.totalPositionInitialMargin,
      totalOpenOrderInitialMargin: accountInfo.totalOpenOrderInitialMargin,
      totalCrossWalletBalance: accountInfo.totalCrossWalletBalance,
      totalCrossUnPnl: accountInfo.totalCrossUnPnl,
      availableBalance: accountInfo.availableBalance,
      maxWithdrawAmount: accountInfo.maxWithdrawAmount,
      positions: activePositions,
    };
  }

  /**
   * 获取指定分钟数内的期货账户状态变化
   * @param minutes 过去的分钟数
   * @param options 额外选项
   * @param options.includeUnchangedPositions 是否包含无变化的持仓，默认为true
   * @returns 账户状态变化信息
   */
  async getFuturesAccountStateChanges(
    minutes: number,
    options: {
      includeUnchangedPositions?: boolean;
    } = {}
  ): Promise<FuturesAccountChanges> {
    // 设置默认选项
    const { includeUnchangedPositions = false } = options;

    // 1. 获取时间范围
    const now = Date.now();
    const pastTime = now - minutes * 60 * 1000;

    // 2. 获取当前和过去的账户状态
    const [currentState, pastState] = await Promise.all([
      this.getCurrentFuturesAccountState(),
      this.getFuturesAccountStateAt(pastTime),
    ]);

    // 3. 计算余额变化
    const walletBalance = parseFloat(currentState.totalWalletBalance);
    const pastWalletBalance = parseFloat(pastState.totalWalletBalance);
    const walletBalanceChange = walletBalance - pastWalletBalance;
    const walletBalanceChangePercent =
      pastWalletBalance !== 0
        ? (walletBalanceChange / pastWalletBalance) * 100
        : 0;

    const unrealizedProfit = parseFloat(currentState.totalUnrealizedProfit);
    const pastUnrealizedProfit = parseFloat(pastState.totalUnrealizedProfit);
    const unrealizedProfitChange = unrealizedProfit - pastUnrealizedProfit;
    const unrealizedProfitChangePercent =
      pastUnrealizedProfit !== 0 &&
      Math.sign(pastUnrealizedProfit) === Math.sign(unrealizedProfit)
        ? (unrealizedProfitChange / Math.abs(pastUnrealizedProfit)) * 100
        : pastUnrealizedProfit === 0
        ? 0
        : "盈亏方向已改变";

    const marginBalance = parseFloat(currentState.totalMarginBalance);
    const pastMarginBalance = parseFloat(pastState.totalMarginBalance);
    const marginBalanceChange = marginBalance - pastMarginBalance;
    const marginBalanceChangePercent =
      pastMarginBalance !== 0
        ? (marginBalanceChange / pastMarginBalance) * 100
        : 0;

    const availableBalance = parseFloat(currentState.availableBalance);
    const pastAvailableBalance = parseFloat(pastState.availableBalance);
    const availableBalanceChange = availableBalance - pastAvailableBalance;
    const availableBalanceChangePercent =
      pastAvailableBalance !== 0
        ? (availableBalanceChange / pastAvailableBalance) * 100
        : 0;

    // 4. 创建所有交易对的映射
    const allSymbols = new Set<string>();
    currentState.positions.forEach((pos) => allSymbols.add(pos.symbol));
    pastState.positions.forEach((pos) => allSymbols.add(pos.symbol));

    // 5. 计算持仓变化
    const positionChanges = Array.from(allSymbols).map((symbol) => {
      const currentPosition = currentState.positions.find(
        (pos) => pos.symbol === symbol
      );
      const pastPosition = pastState.positions.find(
        (pos) => pos.symbol === symbol
      );

      const currentPositionAmt = currentPosition
        ? parseFloat(currentPosition.positionAmt)
        : 0;
      const previousPositionAmt = pastPosition
        ? parseFloat(pastPosition.positionAmt)
        : 0;
      const positionAmtChange = currentPositionAmt - previousPositionAmt;

      const currentEntryPrice = currentPosition
        ? parseFloat(currentPosition.entryPrice)
        : 0;
      const previousEntryPrice = pastPosition
        ? parseFloat(pastPosition.entryPrice)
        : 0;
      const entryPriceChange = currentEntryPrice - previousEntryPrice;

      const currentUnrealizedProfit = currentPosition
        ? parseFloat(currentPosition.unrealizedProfit)
        : 0;
      const previousUnrealizedProfit = pastPosition
        ? parseFloat(pastPosition.unrealizedProfit)
        : 0;
      const unrealizedProfitChange =
        currentUnrealizedProfit - previousUnrealizedProfit;

      // 检测持仓方向变化
      const directionChanged =
        (previousPositionAmt > 0 && currentPositionAmt < 0) ||
        (previousPositionAmt < 0 && currentPositionAmt > 0);

      // 如果方向变化，特殊处理入场价格和盈亏计算
      let unrealizedProfitChangePercent: number | string = 0;
      if (directionChanged) {
        // 方向变化时使用特殊标记
        unrealizedProfitChangePercent = "持仓方向已改变";
      } else if (previousUnrealizedProfit !== 0) {
        // 正常计算百分比变化
        unrealizedProfitChangePercent =
          (unrealizedProfitChange / Math.abs(previousUnrealizedProfit)) * 100;
      } else if (currentUnrealizedProfit !== 0) {
        // 之前没有盈亏但现在有
        unrealizedProfitChangePercent = 100; // 新增盈亏
      }

      // 检查新开仓或已平仓
      const isNew = !pastPosition && !!currentPosition;
      const isClosed = !!pastPosition && !currentPosition;

      // 当unrealizedProfitChangePercent是字符串时正确处理
      let formattedProfitChangePercent: string;
      if (typeof unrealizedProfitChangePercent === "number") {
        formattedProfitChangePercent = unrealizedProfitChangePercent.toFixed(2);
      } else {
        formattedProfitChangePercent = unrealizedProfitChangePercent;
      }

      return {
        symbol,
        currentPositionAmt: currentPositionAmt.toString(),
        previousPositionAmt: previousPositionAmt.toString(),
        positionAmtChange: positionAmtChange.toString(),
        currentEntryPrice: currentEntryPrice.toString(),
        previousEntryPrice: previousEntryPrice.toString(),
        entryPriceChange: entryPriceChange.toString(),
        currentUnrealizedProfit: currentUnrealizedProfit.toString(),
        previousUnrealizedProfit: previousUnrealizedProfit.toString(),
        unrealizedProfitChange: unrealizedProfitChange.toString(),
        unrealizedProfitChangePercent: formattedProfitChangePercent,
        isNew,
        isClosed,
        directionChanged, // 添加方向变化标记到结果中
      };
    });

    // 6. 只返回有意义的持仓变化（有变化的持仓）
    const filteredPositionChanges = positionChanges.filter((change) => {
      // 是否有变化
      const hasChanged =
        change.isNew ||
        change.isClosed ||
        change.directionChanged ||
        Math.abs(parseFloat(change.positionAmtChange)) >= 0.00001 ||
        Math.abs(parseFloat(change.unrealizedProfitChange)) >= 0.00001;

      // 是否是当前活跃持仓
      const isActivePosition = parseFloat(change.currentPositionAmt) !== 0;

      // 根据选项决定是否包含无变化的持仓
      return hasChanged || (includeUnchangedPositions && isActivePosition);
    });

    // 添加调试日志
    // console.log(
    //   `原始持仓数量: ${positionChanges.length}, 过滤后持仓数量: ${filteredPositionChanges.length}, 包含无变化持仓: ${includeUnchangedPositions}`
    // );
    if (filteredPositionChanges.length === 0 && positionChanges.length > 0) {
      console.log("警告: 所有持仓都被过滤掉了，检查过滤条件是否过于严格");
      console.log("持仓示例:", positionChanges[0]);
    }

    // 在返回数据中处理类型问题
    let formattedTotalProfitChangePercent: string;
    if (typeof unrealizedProfitChangePercent === "number") {
      formattedTotalProfitChangePercent =
        unrealizedProfitChangePercent.toFixed(2);
    } else {
      formattedTotalProfitChangePercent = unrealizedProfitChangePercent;
    }

    return {
      timeSpan: {
        fromTime: pastTime,
        toTime: now,
        minutes,
      },
      balanceChanges: {
        walletBalance: walletBalance.toString(),
        walletBalanceChange: walletBalanceChange.toFixed(8),
        walletBalanceChangePercent: walletBalanceChangePercent.toFixed(2),
        unrealizedProfit: unrealizedProfit.toString(),
        unrealizedProfitChange: unrealizedProfitChange.toFixed(8),
        unrealizedProfitChangePercent: formattedTotalProfitChangePercent,
        marginBalance: marginBalance.toString(),
        marginBalanceChange: marginBalanceChange.toFixed(8),
        marginBalanceChangePercent: marginBalanceChangePercent.toFixed(2),
        availableBalance: availableBalance.toString(),
        availableBalanceChange: availableBalanceChange.toFixed(8),
        availableBalanceChangePercent: availableBalanceChangePercent.toFixed(2),
      },
      positionChanges: filteredPositionChanges,
    };
  }

  /**
   * 获取K线数据（支持现货和合约）
   * @param symbol 交易对（如 'BTCUSDT'）
   * @param interval K线周期（如 '1m', '5m', '1h', '1d' 等）
   * @param options 其他可选参数（startTime, endTime, limit, isFutures）
   * @returns K线数据数组
   */
  async getKlines(
    symbol: string,
    interval: string,
    options: {
      startTime?: number;
      endTime?: number;
      limit?: number;
      isFutures?: boolean;
    } = {}
  ): Promise<any[]> {
    const { startTime, endTime, limit, isFutures = false } = options;
    const endpoint = isFutures ? "/fapi/v1/klines" : "/api/v3/klines";
    const baseUrl = isFutures ? this.futuresBaseUrl : this.baseUrl;
    const params: Record<string, any> = { symbol, interval };
    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;
    if (limit) params.limit = limit;

    // K线接口不需要签名
    const url = `${baseUrl}${endpoint}`;
    const response = await axios.get(url, { params });
    return response.data;
  }

  /**
   * 获取指定时间范围内的完整K线数据（支持断点续传）
   * @param symbol 交易对（如 'BTCUSDT'）
   * @param interval K线周期（如 '1m', '5m', '1h', '1d' 等）
   * @param options 其他可选参数
   */
  private async getKlinesWithPagination(
    symbol: string,
    interval: string,
    options: {
      startTime: number;
      endTime: number;
      isFutures?: boolean;
      limit?: number;
      onProgress?: (progress: {
        currentTime: number;
        endTime: number;
        totalKlines: number;
        checkpoint: KlineUpdateCheckpoint;
      }) => void;
    }
  ): Promise<{
    klines: any[];
    checkpoint: KlineUpdateCheckpoint;
  }> {
    const {
      startTime,
      endTime,
      isFutures = false,
      limit = 1000,
      onProgress,
    } = options;
    const allKlines: any[] = [];
    let currentStartTime = startTime;
    let totalKlines = 0;

    while (currentStartTime < endTime) {
      try {
        const klines = await this.getKlines(symbol, interval, {
          startTime: currentStartTime,
          endTime,
          limit,
          isFutures,
        });

        if (klines.length === 0) break;

        allKlines.push(...klines);
        totalKlines += klines.length;

        const lastKline = klines[klines.length - 1];
        currentStartTime = lastKline[0] + 1;

        if (onProgress) {
          onProgress({
            currentTime: currentStartTime,
            endTime,
            totalKlines,
            checkpoint: {
              symbol,
              interval,
              startTime,
              endTime,
              isFutures,
              lastKlineTime: lastKline[0],
              totalKlines,
              lastUpdateTime: Date.now(),
            },
          });
        }

        if (klines.length < limit) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error("获取K线数据时出错:", error);
        return {
          klines: allKlines,
          checkpoint: {
            symbol,
            interval,
            startTime,
            endTime,
            isFutures,
            lastKlineTime: currentStartTime - 1,
            totalKlines,
            lastUpdateTime: Date.now(),
          },
        };
      }
    }

    return {
      klines: allKlines,
      checkpoint: {
        symbol,
        interval,
        startTime,
        endTime,
        isFutures,
        lastKlineTime: endTime,
        totalKlines,
        lastUpdateTime: Date.now(),
      },
    };
  }

  /**
   * 持久化更新K线数据
   * @param params 更新参数
   * @param onProgress 进度回调
   * @returns 更新结果
   */
  async updateKlines(
    params: KlineUpdateParams,
    onProgress?: (progress: {
      currentTime: number;
      endTime: number;
      totalKlines: number;
      checkpoint: KlineUpdateCheckpoint;
    }) => void
  ): Promise<{
    klines: any[];
    checkpoint: KlineUpdateCheckpoint;
  }> {
    if (!this.kvdb) {
      throw new Error("KVDB is required for persistent Kline updates");
    }

    // 生成唯一的检查点key
    const checkpointKey = `kline_checkpoint_${params.symbol}_${
      params.interval
    }_${params.isFutures ? "futures" : "spot"}`;

    // 生成数据存储的key前缀
    const dataKeyPrefix = `kline_data_${params.symbol}_${params.interval}_${
      params.isFutures ? "futures" : "spot"
    }`;

    // 尝试获取现有的检查点
    let checkpoint: KlineUpdateCheckpoint | null = await this.kvdb.get(
      checkpointKey
    );

    // 获取当前时间作为结束时间
    const currentTime = Date.now();

    // 按时间范围存储数据
    const timeRanges = this.splitTimeRange(
      params.startTime,
      currentTime,
      24 * 60 * 60 * 1000 // 按天分割
    );

    // 获取并合并现有数据
    const existingData = await this.getExistingKlineData(
      dataKeyPrefix,
      timeRanges
    );

    // 如果检查点存在，检查是否需要更新
    if (checkpoint) {
      // 检查现有数据是否覆盖了请求的时间范围
      const hasCompleteData =
        existingData.length > 0 &&
        existingData[0][0] <= params.startTime &&
        existingData[existingData.length - 1][0] >= currentTime;

      if (hasCompleteData) {
        console.log(
          "Using existing data as it already covers the requested time range"
        );
        return {
          klines: existingData,
          checkpoint: checkpoint,
        };
      }
    }

    // 确定需要获取数据的时间范围
    let startTimeToFetch = params.startTime;
    let endTimeToFetch = currentTime;

    if (existingData.length > 0) {
      // 检查是否需要获取更早的数据
      if (params.startTime < existingData[0][0]) {
        // 需要获取更早的数据
        endTimeToFetch = existingData[0][0] - 1;
        startTimeToFetch = params.startTime;
      } else {
        // 从最后一条数据的时间开始获取
        startTimeToFetch = existingData[existingData.length - 1][0] + 1;
      }
    }

    // 创建或更新检查点
    checkpoint = {
      ...params,
      lastKlineTime: startTimeToFetch,
      totalKlines: existingData.length,
      lastUpdateTime: Date.now(),
    };

    try {
      const result = await this.getKlinesWithPagination(
        params.symbol,
        params.interval,
        {
          startTime: startTimeToFetch,
          endTime: endTimeToFetch,
          isFutures: params.isFutures,
          limit: params.limit,
          onProgress: async (progress) => {
            // 更新检查点
            checkpoint = {
              ...checkpoint!,
              lastKlineTime: progress.currentTime,
              totalKlines: progress.totalKlines + existingData.length,
              lastUpdateTime: Date.now(),
            };

            // 保存检查点
            await this.kvdb.put(checkpointKey, checkpoint);

            // 调用进度回调
            if (onProgress) {
              onProgress(progress);
            }
          },
        }
      );

      // 合并新数据，避免重复
      const mergedKlines = this.mergeKlines(existingData, result.klines);

      // 按时间范围保存数据
      await this.saveKlineDataByTimeRange(
        dataKeyPrefix,
        timeRanges,
        mergedKlines
      );

      // 更新最终检查点
      const finalCheckpoint: KlineUpdateCheckpoint = {
        ...checkpoint,
        lastKlineTime: result.checkpoint.lastKlineTime,
        totalKlines: mergedKlines.length,
        lastUpdateTime: Date.now(),
      };

      // 保存最终检查点
      await this.kvdb.put(checkpointKey, finalCheckpoint);

      return {
        klines: mergedKlines,
        checkpoint: finalCheckpoint,
      };
    } catch (error) {
      // 保存错误检查点
      const errorCheckpoint: KlineUpdateCheckpoint = {
        ...checkpoint!,
        error: error instanceof Error ? error.message : String(error),
        lastUpdateTime: Date.now(),
      };
      await this.kvdb.put(checkpointKey, errorCheckpoint);

      throw error;
    }
  }

  /**
   * 将时间范围分割成多个区间
   */
  private splitTimeRange(
    startTime: number,
    endTime: number,
    interval: number
  ): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    let currentStart = startTime;

    while (currentStart < endTime) {
      const currentEnd = Math.min(currentStart + interval, endTime);
      ranges.push({ start: currentStart, end: currentEnd });
      currentStart = currentEnd;
    }

    return ranges;
  }

  /**
   * 获取现有的K线数据
   */
  private async getExistingKlineData(
    dataKeyPrefix: string,
    timeRanges: Array<{ start: number; end: number }>
  ): Promise<any[]> {
    const existingData: any[] = [];

    for (const range of timeRanges) {
      const dataKey = `${dataKeyPrefix}_${range.start}`;
      const data = await this.kvdb.get(dataKey);
      if (data) {
        existingData.push(...data);
      }
    }

    return existingData;
  }

  /**
   * 合并K线数据，避免重复
   */
  private mergeKlines(existingData: any[], newData: any[]): any[] {
    const mergedMap = new Map<number, any>();

    // 添加现有数据
    existingData.forEach((kline) => {
      mergedMap.set(kline[0], kline);
    });

    // 添加或更新新数据
    newData.forEach((kline) => {
      mergedMap.set(kline[0], kline);
    });

    // 转换为数组并按时间排序
    return Array.from(mergedMap.values()).sort((a, b) => a[0] - b[0]);
  }

  /**
   * 按时间范围保存K线数据
   */
  private async saveKlineDataByTimeRange(
    dataKeyPrefix: string,
    timeRanges: Array<{ start: number; end: number }>,
    klines: any[]
  ): Promise<void> {
    for (const range of timeRanges) {
      const dataKey = `${dataKeyPrefix}_${range.start}`;
      const rangeKlines = klines.filter(
        (kline) => kline[0] >= range.start && kline[0] < range.end
      );

      if (rangeKlines.length > 0) {
        await this.kvdb.put(dataKey, rangeKlines);
      }
    }
  }

  /**
   * 检查参数是否匹配
   */
  private isParamsMatch(
    checkpoint: KlineUpdateCheckpoint,
    params: KlineUpdateParams
  ): boolean {
    return (
      checkpoint.symbol === params.symbol &&
      checkpoint.interval === params.interval &&
      checkpoint.isFutures === params.isFutures &&
      checkpoint.startTime === params.startTime &&
      checkpoint.endTime === params.endTime
    );
  }

  /**
   * 获取已保存的K线数据检查点
   * @param symbol 交易对（如 'BTCUSDT'）
   * @param interval K线周期（如 '1m', '5m', '1h', '1d' 等）
   * @param isFutures 是否为合约市场
   * @returns 检查点信息，如果不存在则返回null
   */
  async getKlineCheckpoint(
    symbol: string,
    interval: string,
    isFutures: boolean
  ): Promise<KlineUpdateCheckpoint | null> {
    if (!this.kvdb) {
      throw new Error("KVDB is required for getting Kline checkpoints");
    }

    const checkpointKey = `kline_checkpoint_${symbol}_${interval}_${
      isFutures ? "futures" : "spot"
    }`;

    return await this.kvdb.get(checkpointKey);
  }

  /**
   * 获取指定时间范围内的K线数据
   * @param symbol 交易对（如 'BTCUSDT'）
   * @param interval K线周期（如 '1m', '5m', '1h', '1d' 等）
   * @param startTime 开始时间（毫秒时间戳）
   * @param endTime 结束时间（毫秒时间戳）
   * @param isFutures 是否为合约市场
   * @param limit 每次请求的K线数量限制（默认1000）
   * @returns K线数据数组
   */
  async getKlinesByTimeRange(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    isFutures: boolean = false,
    limit: number = 1000
  ): Promise<any[]> {
    if (!this.kvdb) {
      throw new Error("KVDB is required for getting Kline data");
    }

    // 生成数据存储的key
    const dataKey = `kline_data_${symbol}_${interval}_${
      isFutures ? "futures" : "spot"
    }_${startTime}`;

    // 尝试从缓存中获取数据
    const cachedData = await this.kvdb.get(dataKey);
    if (cachedData) {
      // 过滤数据以匹配请求的时间范围
      return cachedData.filter((kline: any[]) => {
        const klineTime = kline[0];
        return klineTime >= startTime && klineTime <= endTime;
      });
    }

    // 如果没有缓存数据，则从API获取
    const result = await this.getKlinesWithPagination(symbol, interval, {
      startTime,
      endTime,
      isFutures,
      limit,
    });

    // 保存到缓存
    await this.kvdb.put(dataKey, result.klines);

    return result.klines;
  }

  /**
   * 格式化并打印K线数据
   * @param klines K线数据数组
   * @param interval K线周期（如 '1m', '5m', '1h', '1d' 等）
   */
  private formatAndLogKlines(klines: any[], interval: string): void {
    console.log("\n=== K线数据详情 ===");
    console.log(`总数据条数: ${klines.length}`);
    console.log("时间范围:", {
      开始: new Date(klines[0][0]).toLocaleString(),
      结束: new Date(klines[klines.length - 1][0]).toLocaleString(),
    });
    console.log("\n数据详情:");

    klines.forEach((kline, index) => {
      const [
        openTime,
        open,
        high,
        low,
        close,
        volume,
        closeTime,
        quoteVolume,
        trades,
        takerBuyBaseVolume,
        takerBuyQuoteVolume,
        ignore,
      ] = kline;

      console.log(`\n第 ${index + 1} 条数据:`);
      console.log("时间:", new Date(openTime).toLocaleString());
      console.log("开盘价:", open);
      console.log("最高价:", high);
      console.log("最低价:", low);
      console.log("收盘价:", close);
      console.log("成交量:", volume);
      console.log("成交额:", quoteVolume);
      console.log("成交笔数:", trades);
      console.log("主动买入成交量:", takerBuyBaseVolume);
      console.log("主动买入成交额:", takerBuyQuoteVolume);
    });
  }

  /**
   * 根据参数获取K线数据，优先使用缓存数据
   * @param params 更新参数
   * @param days 获取最近几天的数据，默认为7天
   * @param shouldLog 是否打印格式化后的数据，默认为false
   * @returns K线数据数组
   */
  async getKlinesByParams(
    params: KlineUpdateParams,
    days: number = 7,
    shouldLog: boolean = false
  ): Promise<any[]> {
    if (!this.kvdb) {
      throw new Error("KVDB is required for getting Kline data");
    }

    // 计算时间范围
    const endTime = params.endTime || Date.now();
    const startTime = Math.max(
      params.startTime,
      endTime - days * 24 * 60 * 60 * 1000
    );

    // 获取检查点信息
    const checkpoint = await this.getKlineCheckpoint(
      params.symbol,
      params.interval,
      params.isFutures
    );

    // 如果检查点存在且数据足够新，优先使用检查点数据
    if (checkpoint && checkpoint.lastKlineTime >= startTime) {
      const dataKeyPrefix = `kline_data_${params.symbol}_${params.interval}_${
        params.isFutures ? "futures" : "spot"
      }`;

      // 只获取需要的时间范围
      const timeRanges = this.splitTimeRange(
        startTime,
        Math.min(endTime, checkpoint.lastKlineTime),
        24 * 60 * 60 * 1000
      );

      const existingData = await this.getExistingKlineData(
        dataKeyPrefix,
        timeRanges
      );

      if (existingData.length > 0) {
        // 如果数据完整，直接返回
        if (
          existingData[0][0] <= startTime &&
          existingData[existingData.length - 1][0] >= endTime
        ) {
          return existingData;
        }
      }
    }

    // 如果没有足够的数据，则更新并获取新数据
    const result = await this.updateKlines({
      ...params,
      startTime,
      endTime,
    });

    if (shouldLog) {
      this.formatAndLogKlines(result.klines, params.interval);
    }

    return result.klines;
  }
}
