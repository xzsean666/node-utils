export interface BinanceConfig {
  apiKey: string;
  apiSecret: string;
  isTestnet?: boolean;
}

export interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceTrade {
  symbol: string;
  id: number;
  orderId: number;
  side: string;
  price: string;
  qty: string;
  realizedPnl: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  positionSide: string;
  maker: boolean;
  buyer: boolean;
  rawData?: any;
}

export interface BinanceOrder {
  symbol: string;
  orderId: number;
  orderListId: number;
  clientOrderId: string;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  timeInForce: string;
  type: string;
  side: string;
  stopPrice: string;
  icebergQty: string;
  time: number;
  updateTime: number;
  isWorking: boolean;
  origQuoteOrderQty: string;
}

export interface FuturesAsset {
  asset: string;
  walletBalance: string;
  unrealizedProfit: string;
  marginBalance: string;
  maintMargin: string;
  initialMargin: string;
  positionInitialMargin: string;
  openOrderInitialMargin: string;
  crossWalletBalance: string;
  crossUnPnl: string;
  availableBalance: string;
  maxWithdrawAmount: string;
  marginAvailable: boolean;
  updateTime: number;
}

export interface FuturesPosition {
  symbol: string;
  positionSide: string;
  positionAmt: string;
  unrealizedProfit: string;
  isolatedMargin: string;
  notional: string;
  isolatedWallet: string;
  initialMargin: string;
  maintMargin: string;
  updateTime: number;
  entryPrice: string;
}

export interface FuturesAccountInfo {
  totalInitialMargin: string;
  totalMaintMargin: string;
  totalWalletBalance: string;
  totalUnrealizedProfit: string;
  totalMarginBalance: string;
  totalPositionInitialMargin: string;
  totalOpenOrderInitialMargin: string;
  totalCrossWalletBalance: string;
  totalCrossUnPnl: string;
  availableBalance: string;
  maxWithdrawAmount: string;
  assets: FuturesAsset[];
  positions: FuturesPosition[];
}

export interface BinanceAccountInfo {
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
}

export interface FormattedPosition {
  symbol: string;
  positionSide: string;
  positionAmt: string;
  unrealizedProfit: string;
  isolatedMargin: string;
  notional: string;
  isolatedWallet: string;
  initialMargin: string;
  maintMargin: string;
  updateTime: number;
  healthStatus: {
    riskRatio: number;
    marginRatio: number;
    leverage: number;
    liquidationPrice: string;
    safetyDistance: number;
    healthLevel: "SAFE" | "WARNING" | "DANGER";
  };
  metrics: {
    entryPrice: string;
    markPrice: string;
    roe: number;
    pnl: string;
    pnlPercentage: number;
  };
}

/**
 * 期货账户状态接口，用于当前和历史账户状态查询
 */
export interface FuturesAccountState {
  totalInitialMargin: string;
  totalMaintMargin: string;
  totalWalletBalance: string;
  totalUnrealizedProfit: string;
  totalMarginBalance: string;
  totalPositionInitialMargin: string;
  totalOpenOrderInitialMargin: string;
  totalCrossWalletBalance: string;
  totalCrossUnPnl: string;
  availableBalance: string;
  maxWithdrawAmount: string;
  positions: Array<{
    symbol: string;
    positionAmt: string;
    entryPrice: string;
    unrealizedProfit: string;
    initialMargin: string;
    maintMargin: string;
  }>;
}

/**
 * 期货账户状态变化接口，用于展示一段时间内的账户变化
 */
export interface FuturesAccountChanges {
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
    directionChanged?: boolean;
  }>;
}
