import {
  BinanceAccountInfo,
  BinanceAPIHelper,
} from "../binance/BinanceAPIHelper";

export class ExIndex {
  private binanceAPIHelper?: BinanceAPIHelper;

  constructor(config: { binanceAPIHelper?: BinanceAPIHelper }) {
    this.binanceAPIHelper = config.binanceAPIHelper;
  }

  async formatBinanceAccountInfo(accountInfo: BinanceAccountInfo) {
    return accountInfo.balances.map((balance) => ({
      asset: balance.asset,
      free: balance.free,
      locked: balance.locked,
    }));
  }

  async getBinanceAccountInfo() {
    const response = await this.binanceAPIHelper?.getAccountInfo();
    if (!response) {
      throw new Error("No response from Binance API");
    }
    return this.formatBinanceAccountInfo(response);
  }
}
