import { ethers } from "ethers";
import type { ParsedContractLog } from "./ethersLogHelper";
import {
  EthersLogSyncHelper,
  type EthersLogSyncHelperConfig,
} from "./ethersLogSyncHelper";
import IEVM2EVMOnRamp from "../web3config/abis/IEVM2EVMOnRamp.json";
import IEVM2EVMOffRamp from "../web3config/abis/IEVM2EVMOffRamp.json";
import IRouterClientABI from "../web3config/abis/IRouterClient.json";
import { memoryCache } from "../dbUtils/MemoryCache";

interface OffRampEntry {
  sourceChainSelector: string;
  offRamp: string;
}

interface CCIPLogStore {
  getWithPrefix<T = unknown>(
    prefix: string,
    options?: {
      limit?: number;
      offset?: number;
      order_by?: "ASC" | "DESC";
      include_timestamps?: boolean;
    },
  ): Promise<Record<string, T | { value: T; created_at: Date; updated_at: Date }>>;
  close(): Promise<void>;
}

interface CCIPSendRequestedMessageKey {
  sender: string;
  receiver: string;
  messageId?: string;
}

export interface CCIPLogHelperConfig extends EthersLogSyncHelperConfig {
  router_address: string;
  chain_selector?: string;
}

/**
 * CCIP 日志同步助手类
 * 用于同步和查询 CCIP 跨链事件（CCIPSendRequested 和 ExecutionStateChanged）
 */
export class CCIPLogHelper extends EthersLogSyncHelper {
  private router_address: string;
  private chain_selector?: string;

  constructor(rpc_url: string, configs: CCIPLogHelperConfig) {
    super(rpc_url, configs);

    if (!ethers.isAddress(configs.router_address)) {
      throw new Error(`Invalid router address: ${String(configs.router_address)}`);
    }

    this.router_address = ethers.getAddress(configs.router_address);
    this.chain_selector = configs.chain_selector;
  }

  private getCCIPLogErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private getRequiredChainSelector(label: string): string {
    const selector = this.chain_selector?.trim();
    if (!selector) {
      throw new Error(`chain_selector is required for ${label}`);
    }

    return selector;
  }

  private getRouterContract(): ethers.Contract {
    return new ethers.Contract(this.router_address, IRouterClientABI, this.web3);
  }

  private getContractMethod(contract: ethers.Contract, functionName: string) {
    const method = contract.getFunction(functionName);
    if (!method) {
      throw new Error(`Function ${functionName} not found in contract ABI`);
    }

    return method;
  }

  private async callRouterView<TResult>(
    functionName: string,
    args: unknown[],
  ): Promise<TResult> {
    const contract = this.getRouterContract();
    const method = this.getContractMethod(contract, functionName);
    return (await method.staticCall(...args)) as TResult;
  }

  private async closeStoreQuietly(label: string, store: CCIPLogStore) {
    try {
      await store.close();
    } catch (error) {
      this.logWarn(`关闭 ${label} 失败`, error);
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  }

  private normalizeAddressIfPossible(value: unknown): string {
    if (typeof value !== "string") {
      return String(value ?? "");
    }

    try {
      return ethers.getAddress(value);
    } catch {
      return value;
    }
  }

  private parseCCIPSendRequestedMessage(
    log: ParsedContractLog,
  ): CCIPSendRequestedMessageKey | null {
    if (!log.args) {
      return null;
    }

    const message = this.asRecord(log.args[0]);
    if (!message) {
      return null;
    }

    return {
      sender: this.normalizeAddressIfPossible(message.sender),
      receiver: this.normalizeAddressIfPossible(message.receiver),
      messageId:
        typeof message.messageId === "string" ? message.messageId : undefined,
    };
  }

  private parseOffRampEntries(value: unknown): OffRampEntry[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => {
        const record = this.asRecord(entry);
        const sourceChainSelector =
          record?.sourceChainSelector ??
          (Array.isArray(entry) ? entry[0] : undefined);
        const offRamp =
          (typeof record?.offRamp === "string" ? record.offRamp : undefined) ??
          (Array.isArray(entry) && typeof entry[1] === "string"
            ? entry[1]
            : undefined);

        if (!offRamp) {
          return null;
        }

        return {
          sourceChainSelector: String(sourceChainSelector ?? ""),
          offRamp: this.normalizeAddressIfPossible(offRamp),
        } satisfies OffRampEntry;
      })
      .filter((entry): entry is OffRampEntry => entry !== null);
  }

  /**
   * 获取 OnRamp 地址
   * @private
   */
  @memoryCache(60 * 60 * 24, "CCIPLogHelper")
  private async getOnRampAddress(): Promise<string> {
    const chainSelector = this.getRequiredChainSelector("OnRamp");

    try {
      const on_ramp = await this.callRouterView<string>("getOnRamp", [
        chainSelector,
      ]);

      if (!on_ramp || on_ramp === ethers.ZeroAddress) {
        throw new Error(`OnRamp not found for chain selector: ${chainSelector}`);
      }

      this.logInfo(`OnRamp address for chain ${chainSelector}: ${on_ramp}`);
      return on_ramp;
    } catch (error) {
      throw new Error(
        `Failed to get OnRamp address: ${this.getCCIPLogErrorMessage(error)}`,
      );
    }
  }

  /**
   * 获取 OffRamp 地址
   * @private
   */
  @memoryCache(60 * 60 * 24, "CCIPLogHelper")
  private async getOffRampAddress(): Promise<string> {
    const chainSelector = this.getRequiredChainSelector("OffRamp");

    try {
      const off_ramps = this.parseOffRampEntries(
        await this.callRouterView<unknown[]>("getOffRamps", []),
      );
      const matching_off_ramp = off_ramps.find(
        (off_ramp) => off_ramp.sourceChainSelector === chainSelector,
      );

      if (!matching_off_ramp) {
        throw new Error(`OffRamp not found for chain selector: ${chainSelector}`);
      }

      this.logInfo(
        `OffRamp address for chain ${chainSelector}: ${matching_off_ramp.offRamp}`,
      );
      return matching_off_ramp.offRamp;
    } catch (error) {
      throw new Error(
        `Failed to get OffRamp address: ${this.getCCIPLogErrorMessage(error)}`,
      );
    }
  }

  /**
   * 同步 CCIPSendRequested 事件
   * 该事件在源链上发出，表示跨链消息已发送
   */
  async syncCCIPSendRequested(params?: {
    start_block?: number;
    from_address?: string;
    to_address?: string;
  }) {
    this.logInfo("Syncing CCIPSendRequested events...");

    const on_ramp = await this.getOnRampAddress();

    const key_generator = (log: ParsedContractLog, nonce: number) => {
      const message = this.parseCCIPSendRequestedMessage(log);
      const receiver = message?.receiver?.toLowerCase();

      if (receiver) {
        return `${receiver}_${log.blockNumber}_${nonce}`;
      }

      return `${log.name ?? "CCIPSendRequested"}_${log.blockNumber}_${nonce}`;
    };

    const result = await this.syncLogs({
      contract_address: on_ramp,
      abi: IEVM2EVMOnRamp,
      event_name: "CCIPSendRequested",
      start_block: params?.start_block,
      key_generator,
    });

    this.logInfo(
      `Synced ${result.synced_logs} CCIPSendRequested events from block ${result.from_block} to ${result.to_block}`,
    );

    return result;
  }

  /**
   * 同步 ExecutionStateChanged 事件
   * 该事件在目标链上发出，表示跨链消息的执行状态
   */
  async syncExecutionStateChanged(params?: {
    start_block?: number;
    message_id?: string;
  }) {
    this.logInfo("Syncing ExecutionStateChanged events...");

    const off_ramp = await this.getOffRampAddress();
    const normalized_message_id = params?.message_id
      ? ethers.hexlify(ethers.getBytes(params.message_id))
      : undefined;

    if (
      normalized_message_id !== undefined &&
      !ethers.isHexString(normalized_message_id, 32)
    ) {
      throw new Error(`Invalid message_id: ${String(params?.message_id)}`);
    }

    const key_generator = (log: ParsedContractLog, nonce: number) => {
      const message_id = log.args?.[1];
      if (typeof message_id === "string" && message_id !== "") {
        return message_id;
      }

      return `${log.name ?? "ExecutionStateChanged"}_${log.blockNumber}_${nonce}`;
    };

    const result = await this.syncLogs({
      contract_address: off_ramp,
      abi: IEVM2EVMOffRamp,
      event_name: "ExecutionStateChanged",
      start_block: params?.start_block,
      filter: normalized_message_id
        ? {
            topics: [null, normalized_message_id],
          }
        : undefined,
      key_generator,
    });

    this.logInfo(
      `Synced ${result.synced_logs} ExecutionStateChanged events from block ${result.from_block} to ${result.to_block}`,
    );

    return result;
  }

  async getOffRampDB() {
    const off_ramp = await this.getOffRampAddress();
    const { db } = await this.getContractDB(off_ramp);
    return db as CCIPLogStore;
  }

  async getOnRampDB() {
    const on_ramp = await this.getOnRampAddress();
    const { db } = await this.getContractDB(on_ramp);
    return db as CCIPLogStore;
  }

  async getRecentOffRampDBLogs(limit: number = 100): Promise<unknown[]> {
    const off_ramp = await this.getOffRampAddress();
    const result = await this.getLogs({
      contract_address: off_ramp,
      limit,
    });
    return result.logs;
  }

  async getRecentOnRampDBLogs(receiver: string, limit: number = 100) {
    const db = await this.getOnRampDB();

    try {
      return await db.getWithPrefix(receiver.toLowerCase(), {
        limit,
      });
    } finally {
      await this.closeStoreQuietly("OnRamp DB", db);
    }
  }

  /**
   * 设置 chain_selector
   */
  setDestinationChainSelector(selector: string) {
    this.chain_selector = selector;
  }

  /**
   * 设置 chain_selector
   */
  setSourceChainSelector(selector: string) {
    this.chain_selector = selector;
  }

  /**
   * 获取当前配置
   */
  getConfig() {
    return {
      router_address: this.router_address,
      chain_selector: this.chain_selector,
    };
  }
}
