import { ethers } from 'ethers';
import {
  ClobClient,
  Chain,
  ApiKeyCreds,
  PriceHistoryFilterParams,
  PriceHistoryInterval,
  BookParams,
  OrderBookSummary,
} from './clobClient';

export { PriceHistoryInterval, BookParams, OrderBookSummary, Chain };
/**
 * Helper class to simplify interactions with Polymarket CLOB API
 */
export class ClobHelper {
  private clobClient: ClobClient;

  /**
   * Create a new ClobHelper instance
   * @param host API host URL (default: "https://clob.polymarket.com/")
   * @param chainId Blockchain chain ID (default: Chain.POLYGON)
   * @param wallet Optional ethers wallet for authenticated requests
   * @param credentials Optional API credentials
   */
  constructor(
    host: string = 'https://clob.polymarket.com/',
    chainId: Chain = Chain.POLYGON,
    wallet?: ethers.Wallet,
    credentials?: ApiKeyCreds,
  ) {
    this.clobClient = new ClobClient(host, chainId, wallet, credentials);
  }

  /**
   * Create a new API key
   * @returns Response from API key creation
   */
  async createApiKey() {
    try {
      return await this.clobClient.createApiKey();
    } catch (error) {
      console.error('Failed to create API key:', error);
      throw error;
    }
  }

  /**
   * Get all API keys for the authenticated user
   * @returns List of API keys
   */
  async getApiKeys() {
    try {
      return await this.clobClient.getApiKeys();
    } catch (error) {
      console.error('Failed to get API keys:', error);
      throw error;
    }
  }

  /**
   * Get orderbook for a specific token
   * @param tokenId The token ID to get orderbook for
   * @returns Orderbook data
   */
  async getOrderBook(tokenId: string) {
    try {
      return await this.clobClient.getOrderBook(tokenId);
    } catch (error) {
      console.error(`Failed to get orderbook for token ${tokenId}:`, error);
      throw error;
    }
  }

  async getOrderBooks(tokenIds: string[]) {
    try {
      const orderbooks: OrderBookSummary[] = [];
      for (const tokenId of tokenIds) {
        const orderbook = await this.clobClient.getOrderBook(tokenId);
        orderbooks.push(orderbook);
      }
      return orderbooks;
    } catch (error) {
      console.error('Failed to get orderbooks:', error);
      throw error;
    }
  }

  /**
   * Get orderbook hash
   * @param orderbook The orderbook to hash
   * @returns Hash of the orderbook
   */
  getOrderBookHash(orderbook: any) {
    return this.clobClient.getOrderBookHash(orderbook);
  }

  /**
   * Get price history for a token with the specified parameters
   * @param params Price history filter parameters
   * @returns Price history data
   */
  async getPricesHistory(params: PriceHistoryFilterParams) {
    try {
      return await this.clobClient.getPricesHistory(params);
    } catch (error) {
      console.error('Failed to get price history:', error);
      throw error;
    }
  }

  /**
   * Helper method to get recent price history for a token
   * Uses multiple API calls to fetch data beyond single request limits
   * @param tokenId The token ID to get price history for
   * @param interval Price history interval (default: undefined)
   * @param durationDays How far back to look in days (default: 7)
   * @param batchSizeDays Size of each data batch in days (default: 1)
   * @returns Combined price history data
   */
  async getRecentPriceHistory({
    tokenId,
    durationDays = 7,
    batchSizeDays = 1,
  }: {
    tokenId: string;
    interval?: PriceHistoryInterval;
    durationDays?: number;
    batchSizeDays?: number;
  }) {
    const now = Math.floor(Date.now() / 1000);
    const secondsInDay = 24 * 60 * 60;
    let allHistoryData: any[] = [];

    // Fetch data in batches
    for (
      let dayOffset = 0;
      dayOffset < durationDays;
      dayOffset += batchSizeDays
    ) {
      // Calculate the start and end time for this batch
      const batchSize = Math.min(batchSizeDays, durationDays - dayOffset);
      const batchEndTs = now - dayOffset * secondsInDay;
      const batchStartTs = batchEndTs - batchSize * secondsInDay;

      try {
        // console.log(batchStartTs, batchEndTs);
        const batchData: any = await this.getPricesHistory({
          startTs: batchStartTs,
          endTs: batchEndTs,
          market: tokenId,
        });
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Extract and merge the history data
        if (
          batchData &&
          batchData.history &&
          Array.isArray(batchData.history)
        ) {
          allHistoryData = [...allHistoryData, ...batchData.history];
          console.log(
            `Fetched ${tokenId} data for days ${dayOffset}-${dayOffset + batchSize}: ${
              batchData.history.length
            } entries`,
          );

          // Stop fetching if we received fewer than 1441 entries
          if (batchData.history.length < 1) {
            console.log(
              'Received fewer than 1441 entries, stopping fetches as we likely reached the data limit',
            );
            break;
          }
        } else if (batchData && Array.isArray(batchData)) {
          // If batchData is already an array, merge it directly
          allHistoryData = [...allHistoryData, ...batchData];
          console.log(
            `Fetched data for days ${dayOffset}-${dayOffset + batchSize}: ${
              batchData.length
            } entries`,
          );

          // Stop fetching if we received fewer than 1441 entries
          if (batchData.length < 1441) {
            console.log(
              'Received fewer than 1441 entries, stopping fetches as we likely reached the data limit',
            );
            break;
          }
        } else {
          console.log(
            `Fetched data for days ${dayOffset}-${
              dayOffset + batchSize
            }, but format is unexpected:`,
            batchData,
          );
        }
      } catch (error) {
        console.error(
          `Failed to get price data for batch starting at ${new Date(
            batchStartTs * 1000,
          )}:`,
          error,
        );
      }
    }
    const sortedHistoryData = allHistoryData
      .sort((a, b) => a.t - b.t) // Sort by timestamp (ascending)
      .filter(
        (item, index, self) => index === 0 || item.t !== self[index - 1].t, // Keep item if it's the first one or if its timestamp differs from the previous one
      );

    // Return data in the expected format with a single history array
    return sortedHistoryData;
  }
}
