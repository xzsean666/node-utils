import { error } from 'console';
import {
  BinanceAPIHelper,
  FormattedPosition,
  BinanceTrade,
  FuturesAccountChanges,
} from '../binance/BinanceAPIHelper';
import {
  ExchangeConfig,
  ExchangeName,
  UnifiedPosition,
  UnifiedTrade,
  UnifiedAccountStateChanges,
  TradeStatisticsOptions,
  TradeStatistics,
  TradeStatisticsPeriod,
} from './types';
export * from './types';
export { BinanceAPIHelper };
export class ExIndex {
  private exchangeConfigs: ExchangeConfig[] = [];

  constructor(configs: ExchangeConfig[]) {
    this.exchangeConfigs = configs;
  }

  /**
   * 添加交易所配置
   */
  addExchange(config: ExchangeConfig) {
    this.exchangeConfigs.push(config);
  }

  /**
   * 移除交易所配置
   */
  removeExchange(exchangeName: ExchangeName) {
    this.exchangeConfigs = this.exchangeConfigs.filter(
      (config) => config.name !== exchangeName,
    );
  }

  /**
   * 获取指定交易所的配置
   */
  private getExchangeConfigs(exchangeName: ExchangeName): ExchangeConfig[] {
    return this.exchangeConfigs.filter(
      (config) => config.name === exchangeName,
    );
  }

  /**
   * 统一格式化币安期货持仓信息
   */
  private formatBinancePosition(position: FormattedPosition): UnifiedPosition {
    const positionAmt = parseFloat(position.positionAmt); // Keep parsing here for positionSide and absolute amount
    const unrealizedProfit = parseFloat(position.unrealizedProfit);
    const initialMargin = parseFloat(position.initialMargin);
    const notional = parseFloat(position.notional);
    const maintMargin = parseFloat(position.maintMargin);

    // Calculate current equity and risk metrics
    const currentEquity = initialMargin + unrealizedProfit;
    const riskRatio =
      currentEquity > 0 ? (maintMargin / currentEquity) * 100 : 0;
    const marginRatio =
      currentEquity > 0 ? (currentEquity / Math.abs(notional)) * 100 : 0;

    // Calculate leverage as notional/initialMargin and round to integer
    const leverage = Math.round(Math.abs(notional / initialMargin));
    const liquidationPrice =
      parseFloat(position.healthStatus?.liquidationPrice) || 0;
    const safetyDistance = position.healthStatus?.safetyDistance ?? 0;
    const entryPrice = parseFloat(position.metrics?.entryPrice) || 0;
    const markPrice = parseFloat(position.metrics?.markPrice) || 0;

    // Calculate PNL metrics
    const pnl = unrealizedProfit; // PNL is just unrealizedProfit
    // ROE should be 0 when equity is negative
    const roe =
      currentEquity > 0 ? (unrealizedProfit / currentEquity) * 100 : 0;
    const pnlPercentage =
      initialMargin !== 0 ? (unrealizedProfit / initialMargin) * 100 : 0;

    // Check for NaN from initial parsing, default to 0 if necessary
    const safeInitialMargin = isNaN(initialMargin) ? 0 : initialMargin;
    const safeUnrealizedProfit = isNaN(unrealizedProfit) ? 0 : unrealizedProfit;
    const safePositionAmt = isNaN(positionAmt) ? 0 : positionAmt;

    return {
      exchange: ExchangeName.BINANCE,
      symbol: position.symbol,
      positionSide: safePositionAmt > 0 ? 'LONG' : 'SHORT',
      positionAmt: Math.abs(safePositionAmt),
      entryPrice,
      markPrice: markPrice,
      unrealizedProfit: safeUnrealizedProfit,
      leverage, // Use pre-calculated leverage
      updateTime: position.updateTime, // Add updateTime
      healthStatus: {
        riskRatio, // Use pre-calculated riskRatio
        marginRatio, // Use pre-calculated marginRatio
        liquidationPrice, // Use pre-calculated liquidationPrice
        safetyDistance, // Use pre-calculated safetyDistance
        healthLevel: this.determineHealthLevel(
          riskRatio,
          marginRatio,
          safetyDistance, // Pass pre-calculated safetyDistance
          safeUnrealizedProfit,
          safeInitialMargin,
        ),
      },
      metrics: {
        roe, // Use pre-calculated roe
        pnl: pnl, // Use pre-calculated pnl
        pnlPercentage, // Use pre-calculated pnlPercentage
      },
      // Keep rawData as is
      rawData: {
        symbol: position.symbol,
        positionSide: position.positionSide,
        positionAmt: position.positionAmt,
        unrealizedProfit: position.unrealizedProfit,
        isolatedMargin: position.isolatedMargin,
        notional: position.notional,
        isolatedWallet: position.isolatedWallet,
        initialMargin: position.initialMargin,
        maintMargin: position.maintMargin,
        updateTime: position.updateTime,
      },
    };
  }

  /**
   * Calculate liquidation price based on position details
   */
  // This method is removed as the calculation is complex and potentially inaccurate.
  // We now rely on the liquidationPrice provided by BinanceAPIHelper's FormattedPosition.
  /*
  private calculateLiquidationPrice(
    positionAmt: number,
    entryPrice: number,
    maintMargin: number,
    initialMargin: number
  ): number {
    if (positionAmt > 0) {
      // 多仓强平价格
      return entryPrice * (1 - maintMargin / initialMargin);
    } else {
      // 空仓强平价格
      return entryPrice * (1 + maintMargin / initialMargin);
    }
  }
  */

  /**
   * Determine health level based on risk metrics and profit
   */
  private determineHealthLevel(
    riskRatio: number,
    marginRatio: number,
    safetyDistance: number, // Added safetyDistance parameter
    unrealizedProfit: number,
    initialMargin: number,
  ): 'SAFE' | 'WARNING' | 'DANGER' {
    // Add basic checks for invalid inputs
    if (
      isNaN(riskRatio) ||
      isNaN(marginRatio) ||
      isNaN(safetyDistance) ||
      isNaN(unrealizedProfit) ||
      isNaN(initialMargin) ||
      initialMargin === 0 // Avoid division by zero
    ) {
      return 'DANGER'; // Default to DANGER if inputs are invalid
    }

    // 计算收益率
    const profitRatio = unrealizedProfit / initialMargin;

    // 如果是盈利状态，主要看安全距离和保证金率
    if (profitRatio > 0) {
      if (safetyDistance > 20 && marginRatio > 3) {
        return 'SAFE';
      } else if (safetyDistance > 10 && marginRatio > 2) {
        return 'WARNING';
      }
      // 盈利但安全距离不足或保证金率过低，仍然标记为危险
      return 'DANGER';
    }

    // 如果是亏损状态，综合评估所有风险指标
    if (riskRatio < 0.3 && marginRatio > 3 && safetyDistance > 30) {
      return 'SAFE';
    } else if (riskRatio < 0.5 && marginRatio > 2 && safetyDistance > 20) {
      return 'WARNING';
    }

    // 如果风险率超过0.8或保证金率低于1.2，直接标记为危险
    if (riskRatio > 0.8 || marginRatio < 1.2) {
      return 'DANGER';
    }

    // 如果安全距离小于10%，标记为危险
    if (safetyDistance < 10) {
      return 'DANGER';
    }

    // 其他情况根据亏损程度判断
    if (profitRatio < -0.5) {
      return 'DANGER';
    } else if (profitRatio < -0.3) {
      return 'WARNING';
    }

    return 'SAFE';
  }

  /**
   * 获取所有交易所的格式化持仓信息
   */
  async getUnifiedPositions(): Promise<UnifiedPosition[]> {
    const positions: UnifiedPosition[] = [];

    // 获取币安持仓
    const binanceConfigs = this.getExchangeConfigs(ExchangeName.BINANCE);
    for (const config of binanceConfigs) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const binanceAPIHelper = config.apiHelper as BinanceAPIHelper;
        if (binanceAPIHelper) {
          const binancePositions =
            await binanceAPIHelper.getFormattedFuturesPositions();
          positions.push(
            ...binancePositions.map((p) => this.formatBinancePosition(p)),
          );
        }
      } catch (error) {
        console.error(
          `Failed to get positions from Binance instance: ${error}`,
        );
      }
    }

    // TODO: 添加其他交易所的格式化逻辑
    // const okxConfigs = this.getExchangeConfigs(ExchangeName.OKX);
    // for (const config of okxConfigs) {
    //   try {
    //     const okxAPIHelper = config.apiHelper as OkxAPIHelper;
    //     if (okxAPIHelper) {
    //       const okxPositions = await okxAPIHelper.getPositions();
    //       positions.push(...okxPositions.map(p => this.formatOkxPosition(p)));
    //     }
    //   } catch (error) {
    //     console.error(`Failed to get positions from OKX instance: ${error}`);
    //   }
    // }

    return positions;
  }
  async getUnifiedPositionsWithPriceHistory(
    positions: UnifiedPosition[],
    kvdb?: any,
  ): Promise<UnifiedPosition[]> {
    const positionsWithPriceHistory: UnifiedPosition[] = [];
    const date = new Date('2025-01-01');
    const binanceAPIHelper = new BinanceAPIHelper({}, kvdb);

    for (const position of positions) {
      const params = {
        symbol: position.symbol,
        interval: '1d',
        startTime: date.getTime(),
        isFutures: true,
      };

      await binanceAPIHelper.updateKlines(params, (progress) => {
        console.log(`Progress: ${progress.currentTime} / ${progress.endTime}`);
      });
      const klines7Days = await binanceAPIHelper.getKlinesByParams(params, 7);

      // Calculate price history data
      const priceHistory = klines7Days.map((kline) => ({
        timestamp: kline[0],
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5]),
        average: (parseFloat(kline[2]) + parseFloat(kline[3])) / 2, // Add average price
      }));

      // Calculate unrealized profit changes
      const unrealizedProfitChanges = klines7Days.map((kline) => {
        const currentPrice = parseFloat(kline[4]); // Use close price
        const averagePrice = (parseFloat(kline[2]) + parseFloat(kline[3])) / 2; // Calculate average price
        const positionAmt = parseFloat(position.positionAmt.toString());
        const entryPrice = parseFloat(position.entryPrice.toString());

        // Calculate unrealized profit for both close and average prices
        const unrealizedProfit = positionAmt * (currentPrice - entryPrice);
        const unrealizedProfitAverage =
          positionAmt * (averagePrice - entryPrice);

        return {
          timestamp: kline[0],
          unrealizedProfit,
          unrealizedProfitAverage,
          price: currentPrice,
          averagePrice,
        };
      });

      // Create new position object with additional data
      const positionWithHistory = {
        ...position,
        priceHistory,
        unrealizedProfitChanges,
      };

      positionsWithPriceHistory.push(positionWithHistory);
    }

    return positionsWithPriceHistory;
  }

  /**
   * 获取指定交易所的格式化持仓信息
   */
  async getUnifiedPositionsByExchange(
    exchangeName: ExchangeName,
  ): Promise<UnifiedPosition[]> {
    const allPositions = await this.getUnifiedPositions();
    return allPositions.filter((p) => p.exchange === exchangeName);
  }

  /**
   * 获取指定交易对的格式化持仓信息
   */
  async getUnifiedPositionsBySymbol(
    symbol: string,
  ): Promise<UnifiedPosition[]> {
    const allPositions = await this.getUnifiedPositions();
    return allPositions.filter((p) => p.symbol === symbol);
  }

  /**
   * 获取指定健康等级的格式化持仓信息
   */
  async getUnifiedPositionsByHealthLevel(
    healthLevel: 'SAFE' | 'WARNING' | 'DANGER',
  ): Promise<UnifiedPosition[]> {
    const allPositions = await this.getUnifiedPositions();
    return allPositions.filter(
      (p) => p.healthStatus.healthLevel === healthLevel,
    );
  }

  /**
   * 格式化币安交易记录
   */
  private formatBinanceTrade(
    trade: BinanceTrade,
    accountId: string,
  ): UnifiedTrade {
    // Parse necessary values
    const price = parseFloat(trade.price);
    const qty = parseFloat(trade.qty);
    const realizedPnl = parseFloat(trade.realizedPnl || '0');

    // Calculate entryPrice
    let entryPrice: number | undefined;

    // If realizedPnl exists, we can calculate entryPrice (this is likely a closing trade)
    if (realizedPnl !== 0) {
      // For long positions (isBuyer = false when closing)
      if (!trade.buyer) {
        // When closing a long: entryPrice = price - (realizedPnl / qty)
        entryPrice = price - realizedPnl / qty;
      }
      // For short positions (isBuyer = true when closing)
      else {
        // When closing a short: entryPrice = price + (realizedPnl / qty)
        entryPrice = price + realizedPnl / qty;
      }
    }
    // If no realizedPnl, this is likely an opening trade
    else {
      entryPrice = price;
    }

    return {
      exchange: ExchangeName.BINANCE,
      accountId,
      symbol: trade.symbol,
      id: trade.id,
      orderId: trade.orderId,
      price: trade.price,
      qty: trade.qty,
      quoteQty: trade.quoteQty,
      commission: trade.commission,
      commissionAsset: trade.commissionAsset,
      time: trade.time,
      isBuyer: trade.buyer,
      isMaker: trade.maker,
      isBestMatch: true, // 币安期货API不返回这个字段，默认为true
      realizedPnl: trade.realizedPnl || '0', // 添加已实现盈亏字段，如果不存在则默认为'0'
      entryPrice: entryPrice?.toString(), // Add calculated entryPrice
      rawData: trade.rawData || trade,
    };
  }

  /**
   * 获取指定交易所的期货交易历史
   * @param exchangeName 交易所名称
   * @param options 查询参数
   * @returns 交易历史记录
   */
  async getFuturesTradingHistory(
    exchangeName: ExchangeName,
    options: {
      startTime?: number;
      endTime?: number;
      fromId?: number;
      limit?: number;
    } = {},
  ): Promise<UnifiedTrade[]> {
    const trades: UnifiedTrade[] = [];

    switch (exchangeName) {
      case ExchangeName.BINANCE: {
        const binanceConfigs = this.getExchangeConfigs(ExchangeName.BINANCE);
        for (const config of binanceConfigs) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          try {
            const binanceAPIHelper = config.apiHelper as BinanceAPIHelper;
            if (binanceAPIHelper) {
              const binanceTrades =
                await binanceAPIHelper.getAllFuturesTradingHistory(options);
              trades.push(
                ...binanceTrades.map((trade) =>
                  this.formatBinanceTrade(
                    trade,
                    binanceAPIHelper.getAccountId(),
                  ),
                ),
              );
            }
          } catch (error) {
            console.error(
              `Failed to get futures trading history from Binance instance: ${error}`,
            );
          }
        }
        break;
      }
      // TODO: Add support for other exchanges
      default:
        console.warn(
          `Exchange ${exchangeName} is not supported yet for futures trading history`,
        );
    }

    // Sort trades by time in descending order (newest first)
    return trades.sort((a, b) => b.time - a.time);
  }

  /**
   * 格式化币安账户状态变化信息
   */
  private formatBinanceAccountChanges(
    accountChanges: FuturesAccountChanges,
    accountId: string,
  ): UnifiedAccountStateChanges {
    // Ensure all position changes have directionChanged as boolean
    const positionChanges = accountChanges.positionChanges.map((position) => ({
      ...position,
      // Make sure directionChanged is a boolean (default to false if undefined)
      directionChanged: position.directionChanged === true,
    }));

    return {
      exchange: ExchangeName.BINANCE,
      accountId,
      timeSpan: accountChanges.timeSpan,
      balanceChanges: accountChanges.balanceChanges,
      positionChanges,
      rawData: accountChanges,
    };
  }

  /**
   * 获取指定交易所的期货账户状态变化
   * @param exchangeName 交易所名称
   * @param minutes 过去的分钟数
   * @param options 额外选项
   * @returns 账户状态变化信息
   */
  async getFuturesAccountStateChanges(
    exchangeName: ExchangeName,
    minutes: number,
    options: {
      includeUnchangedPositions?: boolean;
    } = {},
  ): Promise<UnifiedAccountStateChanges[]> {
    const results: UnifiedAccountStateChanges[] = [];

    switch (exchangeName) {
      case ExchangeName.BINANCE: {
        const binanceConfigs = this.getExchangeConfigs(ExchangeName.BINANCE);

        for (const config of binanceConfigs) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          try {
            const binanceAPIHelper = config.apiHelper as BinanceAPIHelper;
            if (binanceAPIHelper) {
              const accountChanges =
                await binanceAPIHelper.getFuturesAccountStateChanges(
                  minutes,
                  options,
                );
              if (accountChanges) {
                results.push(
                  this.formatBinanceAccountChanges(
                    accountChanges,
                    binanceAPIHelper.getAccountId(),
                  ),
                );
              }
            }
          } catch (error) {
            console.error(
              `Failed to get futures account state changes from Binance instance: ${error}`,
            );
          }
        }
        break;
      }
      // TODO: Add support for other exchanges like OKX
      // case ExchangeName.OKX: {
      //   const okxConfigs = this.getExchangeConfigs(ExchangeName.OKX);
      //   for (const config of okxConfigs) {
      //     try {
      //       const okxAPIHelper = config.apiHelper as OkxAPIHelper;
      //       if (okxAPIHelper) {
      //         const okxChanges = await okxAPIHelper.getAccountStateChanges(minutes, options);
      //         results.push(this.formatOkxAccountChanges(okxChanges, okxAPIHelper.getAccountId()));
      //       }
      //     } catch (error) {
      //       console.error(`Failed to get account state changes from OKX: ${error}`);
      //     }
      //   }
      //   break;
      // }
      default:
        console.warn(
          `Exchange ${exchangeName} is not supported yet for futures account state changes`,
        );
    }

    return results;
  }

  /**
   * 获取所有交易所的期货账户状态变化
   * @param minutes 过去的分钟数
   * @param options 额外选项
   * @returns 所有交易所的账户状态变化信息
   */
  async getAllFuturesAccountStateChanges(
    minutes: number,
    options: {
      includeUnchangedPositions?: boolean;
    } = {},
  ): Promise<UnifiedAccountStateChanges[]> {
    const results: UnifiedAccountStateChanges[] = [];

    // Get unique exchange names from configs
    const exchangeNames = Array.from(
      new Set(this.exchangeConfigs.map((config) => config.name)),
    );

    // Get state changes for each exchange
    for (const exchangeName of exchangeNames) {
      const exchangeResults = await this.getFuturesAccountStateChanges(
        exchangeName,
        minutes,
        options,
      );
      results.push(...exchangeResults);
    }

    return results;
  }

  /**
   * 获取指定账户ID的期货账户状态变化
   * @param accountId 账户ID
   * @param minutes 过去的分钟数
   * @param options 额外选项
   * @returns 账户状态变化信息
   */
  async getFuturesAccountStateChangesByAccountId(
    accountId: string,
    minutes: number,
    options: {
      includeUnchangedPositions?: boolean;
    } = {},
  ): Promise<UnifiedAccountStateChanges | null> {
    const allChanges = await this.getAllFuturesAccountStateChanges(
      minutes,
      options,
    );
    const accountChanges = allChanges.find(
      (change) => change.accountId === accountId,
    );
    return accountChanges || null;
  }

  /**
   * 计算交易统计数据，按天/周/月分组
   * @param trades 交易记录数组
   * @param options 统计选项
   * @returns 按指定周期分组的交易统计数据
   */
  getTradeStatistics(
    trades: UnifiedTrade[],
    options: TradeStatisticsOptions = {},
  ): Record<string, TradeStatistics> {
    // 设置默认选项
    const period = options.period || TradeStatisticsPeriod.DAY;
    const startTime = options.startTime || 0;
    const endTime = options.endTime || Date.now();
    const includeEmptyPeriods = options.includeEmptyPeriods || false;

    // 过滤交易数据
    let filteredTrades = trades.filter(
      (trade) => trade.time >= startTime && trade.time <= endTime,
    );

    // 按指定的交易对过滤
    if (options.symbols && options.symbols.length > 0) {
      filteredTrades = filteredTrades.filter((trade) =>
        options.symbols!.includes(trade.symbol),
      );
    }

    // 按账户ID过滤
    if (options.accountIds && options.accountIds.length > 0) {
      filteredTrades = filteredTrades.filter((trade) =>
        options.accountIds!.includes(trade.accountId),
      );
    }

    // 按周期分组
    const stats: Record<string, TradeStatistics> = {};

    // 处理每笔交易
    for (const trade of filteredTrades) {
      const date = new Date(trade.time);
      let periodKey: string;
      let periodStartTime: number;
      let periodEndTime: number;

      // 按不同周期生成键值和时间范围
      switch (period) {
        case TradeStatisticsPeriod.DAY:
          // 日期格式: YYYY-MM-DD
          periodKey = date.toISOString().split('T')[0];
          periodStartTime = new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
          ).getTime();
          periodEndTime =
            new Date(
              date.getFullYear(),
              date.getMonth(),
              date.getDate() + 1,
            ).getTime() - 1;
          break;

        case TradeStatisticsPeriod.WEEK:
          // 获取本周的开始日期 (周日为一周的开始)
          const firstDayOfWeek = new Date(date);
          const day = date.getDay(); // 0 是周日，1 是周一，...
          firstDayOfWeek.setDate(date.getDate() - day);

          // 周格式: YYYY-WW (ISO周)
          const weekNumber = Math.ceil(
            ((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) /
              86400000 +
              1) /
              7,
          );
          periodKey = `${date.getFullYear()}-W${weekNumber
            .toString()
            .padStart(2, '0')}`;

          periodStartTime = new Date(
            firstDayOfWeek.getFullYear(),
            firstDayOfWeek.getMonth(),
            firstDayOfWeek.getDate(),
          ).getTime();

          periodEndTime =
            new Date(
              firstDayOfWeek.getFullYear(),
              firstDayOfWeek.getMonth(),
              firstDayOfWeek.getDate() + 7,
            ).getTime() - 1;
          break;

        case TradeStatisticsPeriod.MONTH:
          // 月格式: YYYY-MM
          periodKey = `${date.getFullYear()}-${(date.getMonth() + 1)
            .toString()
            .padStart(2, '0')}`;

          periodStartTime = new Date(
            date.getFullYear(),
            date.getMonth(),
            1,
          ).getTime();

          periodEndTime =
            new Date(date.getFullYear(), date.getMonth() + 1, 0).getTime() +
            86399999; // 23:59:59.999
          break;

        default:
          throw new Error(`Unsupported period: ${period}`);
      }

      // 如果该周期未初始化，创建初始值
      if (!stats[periodKey]) {
        stats[periodKey] = {
          period: periodKey,
          startTime: periodStartTime,
          endTime: periodEndTime,
          totalTrades: 0,
          totalBuyTrades: 0,
          totalSellTrades: 0,
          totalMakerTrades: 0,
          totalTakerTrades: 0,
          totalQuantity: 0,
          totalValue: 0,
          totalCommission: 0,
          totalRealizedPnl: 0, // 添加已实现盈亏
          commissionByAsset: {},
          symbolCounts: {},
          symbolVolumes: {},
        };
      }

      // 更新统计数据
      const periodStats = stats[periodKey];
      periodStats.totalTrades += 1;
      periodStats.totalBuyTrades += trade.isBuyer ? 1 : 0;
      periodStats.totalSellTrades += trade.isBuyer ? 0 : 1;
      periodStats.totalMakerTrades += trade.isMaker ? 1 : 0;
      periodStats.totalTakerTrades += trade.isMaker ? 0 : 1;

      // 将字符串转换为数字
      const qty = parseFloat(trade.qty);
      const quoteQty = parseFloat(trade.quoteQty);
      const commission = parseFloat(trade.commission);
      const realizedPnl = parseFloat(trade.realizedPnl || '0'); // 解析已实现盈亏

      periodStats.totalQuantity += qty;
      periodStats.totalValue += quoteQty;
      periodStats.totalCommission += commission;
      periodStats.totalRealizedPnl += realizedPnl; // 累加已实现盈亏

      // 按资产类型累计手续费
      if (!periodStats.commissionByAsset[trade.commissionAsset]) {
        periodStats.commissionByAsset[trade.commissionAsset] = 0;
      }
      periodStats.commissionByAsset[trade.commissionAsset] += commission;

      // 按交易对统计
      if (!periodStats.symbolCounts[trade.symbol]) {
        periodStats.symbolCounts[trade.symbol] = 0;
        periodStats.symbolVolumes[trade.symbol] = 0;
      }
      periodStats.symbolCounts[trade.symbol] += 1;
      periodStats.symbolVolumes[trade.symbol] += qty;
    }

    // 生成空白周期数据（如果需要）
    if (includeEmptyPeriods && period !== TradeStatisticsPeriod.WEEK) {
      // 为天或月生成连续的空白数据
      const periodMs =
        period === TradeStatisticsPeriod.DAY
          ? 86400000 // 一天的毫秒数
          : 0; // 月份处理方式不同

      if (period === TradeStatisticsPeriod.DAY) {
        // 按天填充
        const currentDate = new Date(startTime);
        const endDate = new Date(endTime);

        while (currentDate <= endDate) {
          const dateStr = currentDate.toISOString().split('T')[0];

          if (!stats[dateStr]) {
            // 添加空白日期数据
            const dayStart = new Date(
              currentDate.getFullYear(),
              currentDate.getMonth(),
              currentDate.getDate(),
            ).getTime();

            const dayEnd = dayStart + 86399999; // 23:59:59.999

            stats[dateStr] = {
              period: dateStr,
              startTime: dayStart,
              endTime: dayEnd,
              totalTrades: 0,
              totalBuyTrades: 0,
              totalSellTrades: 0,
              totalMakerTrades: 0,
              totalTakerTrades: 0,
              totalQuantity: 0,
              totalValue: 0,
              totalCommission: 0,
              totalRealizedPnl: 0, // 初始化已实现盈亏
              commissionByAsset: {},
              symbolCounts: {},
              symbolVolumes: {},
            };
          }

          // 下一天
          currentDate.setDate(currentDate.getDate() + 1);
        }
      } else if (period === TradeStatisticsPeriod.MONTH) {
        // 按月填充
        const currentMonth = new Date(startTime);
        const endMonth = new Date(endTime);

        while (
          currentMonth.getFullYear() < endMonth.getFullYear() ||
          (currentMonth.getFullYear() === endMonth.getFullYear() &&
            currentMonth.getMonth() <= endMonth.getMonth())
        ) {
          const monthStr = `${currentMonth.getFullYear()}-${(
            currentMonth.getMonth() + 1
          )
            .toString()
            .padStart(2, '0')}`;

          if (!stats[monthStr]) {
            // 添加空白月份数据
            const monthStart = new Date(
              currentMonth.getFullYear(),
              currentMonth.getMonth(),
              1,
            ).getTime();

            const monthEnd =
              new Date(
                currentMonth.getFullYear(),
                currentMonth.getMonth() + 1,
                0,
              ).getTime() + 86399999; // 23:59:59.999

            stats[monthStr] = {
              period: monthStr,
              startTime: monthStart,
              endTime: monthEnd,
              totalTrades: 0,
              totalBuyTrades: 0,
              totalSellTrades: 0,
              totalMakerTrades: 0,
              totalTakerTrades: 0,
              totalQuantity: 0,
              totalValue: 0,
              totalCommission: 0,
              totalRealizedPnl: 0, // 初始化已实现盈亏
              commissionByAsset: {},
              symbolCounts: {},
              symbolVolumes: {},
            };
          }

          // 下一月
          currentMonth.setMonth(currentMonth.getMonth() + 1);
        }
      }
    }

    return stats;
  }

  /**
   * 获取每日交易统计（兼容旧版本）
   * @deprecated 请使用 getTradeStatistics 代替
   */
  getDailyTradeStatistics(trades: UnifiedTrade[]): Record<string, any> {
    return this.getTradeStatistics(trades, {
      period: TradeStatisticsPeriod.DAY,
    }) as any;
  }
}
