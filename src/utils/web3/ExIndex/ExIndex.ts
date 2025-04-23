import {
  BinanceAPIHelper,
  FormattedPosition,
  BinanceTrade,
} from "../binance/BinanceAPIHelper";
import {
  ExchangeConfig,
  ExchangeName,
  UnifiedPosition,
  UnifiedTrade,
} from "./types";
export * from "./types";
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
      (config) => config.name !== exchangeName
    );
  }

  /**
   * 获取指定交易所的配置
   */
  private getExchangeConfigs(exchangeName: ExchangeName): ExchangeConfig[] {
    return this.exchangeConfigs.filter(
      (config) => config.name === exchangeName
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
      positionSide: safePositionAmt > 0 ? "LONG" : "SHORT",
      positionAmt: Math.abs(safePositionAmt),
      entryPrice,
      markPrice: markPrice,
      unrealizedProfit: safeUnrealizedProfit,
      leverage, // Use pre-calculated leverage
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
          safeInitialMargin
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
    initialMargin: number
  ): "SAFE" | "WARNING" | "DANGER" {
    // Add basic checks for invalid inputs
    if (
      isNaN(riskRatio) ||
      isNaN(marginRatio) ||
      isNaN(safetyDistance) ||
      isNaN(unrealizedProfit) ||
      isNaN(initialMargin) ||
      initialMargin === 0 // Avoid division by zero
    ) {
      return "DANGER"; // Default to DANGER if inputs are invalid
    }

    // 计算收益率
    const profitRatio = unrealizedProfit / initialMargin;

    // 如果是盈利状态，主要看安全距离和保证金率
    if (profitRatio > 0) {
      if (safetyDistance > 20 && marginRatio > 3) {
        return "SAFE";
      } else if (safetyDistance > 10 && marginRatio > 2) {
        return "WARNING";
      }
      // 盈利但安全距离不足或保证金率过低，仍然标记为危险
      return "DANGER";
    }

    // 如果是亏损状态，综合评估所有风险指标
    if (riskRatio < 0.3 && marginRatio > 3 && safetyDistance > 30) {
      return "SAFE";
    } else if (riskRatio < 0.5 && marginRatio > 2 && safetyDistance > 20) {
      return "WARNING";
    }

    // 如果风险率超过0.8或保证金率低于1.2，直接标记为危险
    if (riskRatio > 0.8 || marginRatio < 1.2) {
      return "DANGER";
    }

    // 如果安全距离小于10%，标记为危险
    if (safetyDistance < 10) {
      return "DANGER";
    }

    // 其他情况根据亏损程度判断
    if (profitRatio < -0.5) {
      return "DANGER";
    } else if (profitRatio < -0.3) {
      return "WARNING";
    }

    return "SAFE";
  }

  /**
   * 获取所有交易所的格式化持仓信息
   */
  async getUnifiedPositions(): Promise<UnifiedPosition[]> {
    const positions: UnifiedPosition[] = [];

    // 获取币安持仓
    const binanceConfigs = this.getExchangeConfigs(ExchangeName.BINANCE);
    for (const config of binanceConfigs) {
      try {
        const binanceAPIHelper = config.apiHelper as BinanceAPIHelper;
        if (binanceAPIHelper) {
          const binancePositions =
            await binanceAPIHelper.getFormattedFuturesPositions();
          positions.push(
            ...binancePositions.map((p) => this.formatBinancePosition(p))
          );
        }
      } catch (error) {
        console.error(
          `Failed to get positions from Binance instance: ${error}`
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

  /**
   * 获取指定交易所的格式化持仓信息
   */
  async getUnifiedPositionsByExchange(
    exchangeName: ExchangeName
  ): Promise<UnifiedPosition[]> {
    const allPositions = await this.getUnifiedPositions();
    return allPositions.filter((p) => p.exchange === exchangeName);
  }

  /**
   * 获取指定交易对的格式化持仓信息
   */
  async getUnifiedPositionsBySymbol(
    symbol: string
  ): Promise<UnifiedPosition[]> {
    const allPositions = await this.getUnifiedPositions();
    return allPositions.filter((p) => p.symbol === symbol);
  }

  /**
   * 获取指定健康等级的格式化持仓信息
   */
  async getUnifiedPositionsByHealthLevel(
    healthLevel: "SAFE" | "WARNING" | "DANGER"
  ): Promise<UnifiedPosition[]> {
    const allPositions = await this.getUnifiedPositions();
    return allPositions.filter(
      (p) => p.healthStatus.healthLevel === healthLevel
    );
  }

  /**
   * 格式化币安交易记录
   */
  private formatBinanceTrade(
    trade: BinanceTrade,
    accountId: string
  ): UnifiedTrade {
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
    } = {}
  ): Promise<UnifiedTrade[]> {
    const trades: UnifiedTrade[] = [];

    switch (exchangeName) {
      case ExchangeName.BINANCE: {
        const binanceConfigs = this.getExchangeConfigs(ExchangeName.BINANCE);
        for (const config of binanceConfigs) {
          try {
            const binanceAPIHelper = config.apiHelper as BinanceAPIHelper;
            if (binanceAPIHelper) {
              const binanceTrades =
                await binanceAPIHelper.getAllFuturesTradingHistory(options);
              trades.push(
                ...binanceTrades.map((trade) =>
                  this.formatBinanceTrade(
                    trade,
                    binanceAPIHelper.getAccountId()
                  )
                )
              );
            }
          } catch (error) {
            console.error(
              `Failed to get futures trading history from Binance instance: ${error}`
            );
          }
        }
        break;
      }
      // TODO: Add support for other exchanges
      default:
        console.warn(
          `Exchange ${exchangeName} is not supported yet for futures trading history`
        );
    }

    // Sort trades by time in descending order (newest first)
    return trades.sort((a, b) => b.time - a.time);
  }
}
