export enum ExchangeName {
  BINANCE = "BINANCE",
  OKX = "OKX",
  GATE = "GATE",
  HUOBI = "HUOBI",
  // 可以继续添加其他交易所
}

export interface ExchangeConfig {
  name: ExchangeName;
  apiHelper: any; // 这里用any，因为不同交易所的API Helper类型不同
}

export interface UnifiedPosition {
  exchange: ExchangeName; // 使用枚举类型
  symbol: string; // 交易对
  positionSide: "LONG" | "SHORT"; // 持仓方向
  positionAmt: number; // 持仓数量
  entryPrice: number; // 开仓均价
  markPrice: number; // 标记价格
  unrealizedProfit: number; // 未实现盈亏
  leverage: number; // 实际杠杆率
  // 健康状态
  healthStatus: {
    riskRatio: number; // 风险率
    marginRatio: number; // 保证金率
    liquidationPrice: number; // 强平价格
    safetyDistance: number; // 安全距离（百分比）
    healthLevel: "SAFE" | "WARNING" | "DANGER"; // 健康等级
  };
  // 性能指标
  metrics: {
    roe: number; // 收益率
    pnl: number; // 盈亏金额
    pnlPercentage: number; // 盈亏百分比
  };
  // 原始数据
  rawData: any; // 保留原始数据，方便调试和扩展
}

export interface UnifiedTrade {
  exchange: ExchangeName;
  accountId: string; // 用于区分不同账号
  symbol: string;
  id: number;
  orderId: number;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
  isBestMatch: boolean;
  realizedPnl: string; // 新增字段：已实现盈亏
  entryPrice?: string; // 计算出的开仓价格
  rawData: any; // Keep raw exchange-specific data
}

/**
 * 统一账户状态变化接口
 */
export interface UnifiedAccountStateChanges {
  exchange: ExchangeName;
  accountId: string;
  timeSpan: {
    fromTime: number;
    toTime: number;
    minutes: number;
  };
  balanceChanges: {
    walletBalance: string;
    walletBalanceChange: string;
    walletBalanceChangePercent: string;
    unrealizedProfit: string;
    unrealizedProfitChange: string;
    unrealizedProfitChangePercent: string;
    marginBalance: string;
    marginBalanceChange: string;
    marginBalanceChangePercent: string;
    availableBalance: string;
    availableBalanceChange: string;
    availableBalanceChangePercent: string;
  };
  positionChanges: Array<{
    symbol: string;
    currentPositionAmt: string;
    previousPositionAmt: string;
    positionAmtChange: string;
    currentEntryPrice: string;
    previousEntryPrice: string;
    entryPriceChange: string;
    currentUnrealizedProfit: string;
    previousUnrealizedProfit: string;
    unrealizedProfitChange: string;
    unrealizedProfitChangePercent: string;
    isNew: boolean;
    isClosed: boolean;
    directionChanged: boolean;
  }>;
  rawData: any;
}

/**
 * 交易统计周期类型
 */
export enum TradeStatisticsPeriod {
  DAY = "day",
  WEEK = "week",
  MONTH = "month",
}

/**
 * 交易统计选项
 */
export interface TradeStatisticsOptions {
  /**
   * 统计周期 (天/周/月)
   * @default TradeStatisticsPeriod.DAY
   */
  period?: TradeStatisticsPeriod;

  /**
   * 开始时间戳 (毫秒)
   */
  startTime?: number;

  /**
   * 结束时间戳 (毫秒)
   */
  endTime?: number;

  /**
   * 是否包含空交易日期
   * @default false
   */
  includeEmptyPeriods?: boolean;

  /**
   * 要统计的交易对
   */
  symbols?: string[];

  /**
   * 要统计的账户ID
   */
  accountIds?: string[];
}

/**
 * 交易统计结果
 */
export interface TradeStatistics {
  /**
   * 时间段标识 (YYYY-MM-DD, YYYY-WW, YYYY-MM)
   */
  period: string;

  /**
   * 开始时间戳
   */
  startTime: number;

  /**
   * 结束时间戳
   */
  endTime: number;

  /**
   * 总交易笔数
   */
  totalTrades: number;

  /**
   * 买入交易笔数
   */
  totalBuyTrades: number;

  /**
   * 卖出交易笔数
   */
  totalSellTrades: number;

  /**
   * 挂单交易笔数 (Maker)
   */
  totalMakerTrades: number;

  /**
   * 吃单交易笔数 (Taker)
   */
  totalTakerTrades: number;

  /**
   * 总交易数量
   */
  totalQuantity: number;

  /**
   * 总交易价值
   */
  totalValue: number;

  /**
   * 总手续费
   */
  totalCommission: number;

  /**
   * 总已实现盈亏
   */
  totalRealizedPnl: number;

  /**
   * 按资产类型的手续费统计
   */
  commissionByAsset: Record<string, number>;

  /**
   * 按交易对的交易笔数统计
   */
  symbolCounts: Record<string, number>;

  /**
   * 按交易对的交易量统计
   */
  symbolVolumes: Record<string, number>;

  /**
   * 盈亏统计 (如果可计算)
   */
  profitLoss?: number;
}
