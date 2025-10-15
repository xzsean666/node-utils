import { ethers } from "ethers";
import { EthersLogSyncHelper } from "./ethersLogSyncHelper";
import IEVM2EVMOnRamp from "../web3config/abis/IEVM2EVMOnRamp.json";
import IEVM2EVMOffRamp from "../web3config/abis/IEVM2EVMOffRamp.json";
import IRouterClientABI from "../web3config/abis/IRouterClient.json";
import { memoryCache } from "../dbUtils/MemoryCache";

/**
 * CCIP日志同步助手类
 * 用于同步和查询CCIP跨链事件（CCIPSendRequested 和 ExecutionStateChanged）
 */
export class CCIPLogHelper extends EthersLogSyncHelper {
  private router_address: string;
  private chain_selector?: string;

  constructor(
    rpc_url: string,

    configs: {
      router_address: string;
      chain_selector?: string;
      sqlite_path?: string;
      postgres_path?: string;
    }
  ) {
    super(rpc_url, {
      sqlite_path: configs?.sqlite_path,
      postgres_path: configs?.postgres_path,
    });

    if (!ethers.isAddress(configs?.router_address)) {
      const error_msg =
        "Invalid router address: " + String(configs?.router_address);
      throw new Error(error_msg);
    }

    this.router_address = configs?.router_address;
    this.chain_selector = configs?.chain_selector;
  }

  /**
   * 获取 OnRamp 地址
   * @private
   */
  @memoryCache(60 * 60 * 24, "CCIPLogHelper")
  private async getOnRampAddress(): Promise<string> {
    if (!this.chain_selector) {
      throw new Error("chain_selector is required for OnRamp");
    }

    const router_contract = new ethers.Contract(
      this.router_address,
      IRouterClientABI,
      this.web3
    );

    try {
      const on_ramp = await router_contract.getOnRamp(this.chain_selector);

      if (!on_ramp || on_ramp === ethers.ZeroAddress) {
        throw new Error(
          `OnRamp not found for chain selector: ${this.chain_selector}`
        );
      }

      console.log(
        `OnRamp address for chain ${this.chain_selector}: ${on_ramp}`
      );
      return on_ramp;
    } catch (error: unknown) {
      const error_message =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get OnRamp address: ${error_message}`);
    }
  }

  /**
   * 获取 OffRamp 地址
   * @private
   */
  @memoryCache(60 * 60 * 24, "CCIPLogHelper")
  private async getOffRampAddress(): Promise<string> {
    if (!this.chain_selector) {
      throw new Error("chain_selector is required for OffRamp");
    }

    const router_contract = new ethers.Contract(
      this.router_address,
      IRouterClientABI,
      this.web3
    );

    try {
      const off_ramps = await router_contract.getOffRamps();

      const matching_off_ramp = off_ramps.find(
        (off_ramp: any) => off_ramp[0].toString() === this.chain_selector
      );

      if (!matching_off_ramp) {
        throw new Error(
          `OffRamp not found for chain selector: ${this.chain_selector}`
        );
      }

      console.log(
        `OffRamp address for chain ${this.chain_selector}: ${matching_off_ramp[1]}`
      );
      return matching_off_ramp[1];
    } catch (error: unknown) {
      const error_message =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get OffRamp address: ${error_message}`);
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
    console.log("Syncing CCIPSendRequested events...");

    const on_ramp = await this.getOnRampAddress();

    // 构建过滤器
    const filter: any = {};

    // 如果有地址过滤，可以在同步后进行过滤
    // CCIP事件的indexed参数需要根据具体ABI确定

    // 使用自定义key生成器: receiver_sender_nonce
    const key_generator = (log: any, nonce: number) => {
      try {
        const message = log.args?.[0];
        if (message && message.receiver && message.sender) {
          const receiver = message.receiver.toLowerCase();
          const sender = message.sender.toLowerCase();

          return `${receiver}_${sender}_${nonce}`;
        }
        // 如果提取失败，回退到默认格式
        const log_name = "name" in log ? log.name : "CCIPSendRequested";
        return `${log_name}_${log.blockNumber}_${nonce}`;
      } catch (error) {
        // 出错时使用默认格式
        const log_name = "name" in log ? log.name : "CCIPSendRequested";
        return `${log_name}_${log.blockNumber}_${nonce}`;
      }
    };

    const result = await this.syncLogs({
      contract_address: on_ramp,
      abi: IEVM2EVMOnRamp,
      event_name: "CCIPSendRequested",
      start_block: params?.start_block,
      filter,
      key_generator,
    });

    console.log(
      `Synced ${result.synced_logs} CCIPSendRequested events from block ${result.from_block} to ${result.to_block}`
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
    console.log("Syncing ExecutionStateChanged events...");

    const off_ramp = await this.getOffRampAddress();

    // 构建过滤器
    const filter: any = {};

    // 如果指定了message_id，可以添加到topics中进行过滤
    if (params?.message_id) {
      // ExecutionStateChanged(uint64 indexed sequenceNumber, bytes32 indexed messageId, uint8 state, bytes returnData)
      // messageId 是第二个indexed参数
      filter.topics = [null, ethers.zeroPadValue(params.message_id, 32)];
    }

    // 使用自定义key生成器: message_id
    const key_generator = (log: any, nonce: number) => {
      try {
        // ExecutionStateChanged 事件结构：sequenceNumber, messageId, state, returnData
        // messageId 是第二个参数 (args[1])
        const message_id = log.args?.[1];
        if (message_id) {
          return message_id.toString();
        }
        // 如果提取失败，回退到默认格式
        const log_name = "name" in log ? log.name : "ExecutionStateChanged";
        return `${log_name}_${log.blockNumber}_${nonce}`;
      } catch (error) {
        // 出错时使用默认格式
        const log_name = "name" in log ? log.name : "ExecutionStateChanged";
        return `${log_name}_${log.blockNumber}_${nonce}`;
      }
    };

    const result = await this.syncLogs({
      contract_address: off_ramp,
      abi: IEVM2EVMOffRamp,
      event_name: "ExecutionStateChanged",
      start_block: params?.start_block,
      filter,
      key_generator,
    });

    console.log(
      `Synced ${result.synced_logs} ExecutionStateChanged events from block ${result.from_block} to ${result.to_block}`
    );

    return result;
  }
  async getOffRampDB() {
    const off_ramp = await this.getOffRampAddress();
    const { db } = await this.getContractDB(off_ramp);
    return db;
  }
  async getOnRampDB() {
    const on_ramp = await this.getOnRampAddress();
    const { db } = await this.getContractDB(on_ramp);
    return db;
  }

  async getRecentOffRampDBLogs(limit: number = 100) {
    const db = await this.getOffRampDB();
    return db.getWithPrefix("ExecutionStateChanged", {
      limit,
    });
  }
  async getRecentOnRampDBLogs(receiver: string, limit: number = 100) {
    const db = await this.getOnRampDB();
    return db.getWithPrefix(receiver, {
      limit,
    });
  }

  /**

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
