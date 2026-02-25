export interface BinanceConfig {
  apiKey?: string;
  apiSecret?: string;
  isTestnet?: boolean;
}

export interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceAccountInfo {
  balances: BinanceBalance[];
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  updateTime: number;
  accountType: string;
}

export interface BinanceTrade {
  symbol: string;
  id: number;
  orderId: number;
  orderListId: number;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
  isBestMatch: boolean;
  realizedPnl?: string;
  side: string;
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

export interface FuturesPosition {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unrealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  maxNotionalValue: string;
  marginType: string;
  isAutoAddMargin: string;
  isolatedMargin: string;
  notional: string;
  isolatedWallet: string;
  updateTime: number;
  positionSide: string;
  initialMargin: string;
  maintMargin: string;
}

export interface FuturesAccountInfo {
  assets: any[];
  positions: FuturesPosition[];
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  updateTime: number;
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
}

export interface FormattedPosition extends FuturesPosition {
  healthStatus: {
    riskRatio: number;
    marginRatio: number;
    leverage: number;
    liquidationPrice: string;
    safetyDistance: number;
    healthLevel: 'SAFE' | 'WARNING' | 'DANGER';
  };
  metrics: {
    entryPrice: string;
    markPrice: string;
    roe: number;
    pnl: string;
    pnlPercentage: number;
  };
}

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

export interface FuturesAccountChanges {
  walletBalanceChange: number;
  walletBalanceChangePercent: number;
  unrealizedProfitChange: number;
  unrealizedProfitChangePercent: number | string;
  marginBalanceChange: number;
  marginBalanceChangePercent: number;
  availableBalanceChange: number;
  availableBalanceChangePercent: number;
  positionChanges: any[];
}
