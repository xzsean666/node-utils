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
  rawData: any; // Keep raw exchange-specific data
}
