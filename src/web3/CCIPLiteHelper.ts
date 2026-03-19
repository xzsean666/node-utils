import {
  ethers,
  type ContractRunner,
  type InterfaceAbi,
  type Log,
  type LogDescription,
  type TransactionRequest,
  type TransactionResponse,
} from "ethers";
import {
  EthersLogHelper,
  type EthersLogHelperConfig,
  type ParsedContractLog,
} from "./ethersLogHelper";
import IEVM2EVMOffRamp from "../web3config/abis/IEVM2EVMOffRamp.json";
import IEVM2EVMOnRamp from "../web3config/abis/IEVM2EVMOnRamp.json";
import IRouterClientABI from "../web3config/abis/IRouterClient.json";

interface TokenAmount {
  token: string;
  amount: bigint;
}

interface MessageParams {
  receiver: string;
  data: string;
  token?: string;
  amount?: string | bigint;
  feeToken?: string;
  gasLimit?: number;
}

interface CCIPMessage {
  receiver: string;
  data: string;
  tokenAmounts: TokenAmount[];
  feeToken: string;
  extraArgs: string;
}

interface CCIPSendRequestedMessage {
  sourceChainSelector: bigint;
  sender: string;
  receiver: string;
  sequenceNumber: bigint;
  gasLimit: bigint;
  strict: boolean;
  nonce: bigint;
  feeToken: string;
  feeTokenAmount: bigint;
  data: string;
  tokenAmounts: TokenAmount[];
  sourceTokenData: string[];
  messageId: string;
}

interface OffRampEntry {
  sourceChainSelector: string;
  offRamp: string;
}

interface ExecutionStateChangedData {
  sequenceNumber: bigint;
  messageId: string;
  state: number;
  returnData: string;
}

export interface CCIPLiteHelperConfig extends EthersLogHelperConfig {
  private_key?: string;
}

export interface CCIPMessageIdResult {
  messageId?: string;
  blockNumber: number;
}

export interface CCIPSendStatus {
  messageId: string;
  sender: string;
  receiver: string;
  blockNumber: number;
  transactionHash: string;
  tokenAmounts: TokenAmount[];
  data: string;
  fees: {
    feeToken: string;
    feeAmount: bigint;
  };
}

export type CCIPTransferState =
  | "UNTOUCHED"
  | "IN_PROGRESS"
  | "SUCCESS"
  | "FAILURE"
  | "UNKNOWN";

export interface CCIPTransferStatus {
  state: CCIPTransferState;
  blockNumber?: number;
  messageId?: string;
  transactionHash?: string;
  offRamp?: string;
  sourceChainSelector?: string;
}

export class CCIPLiteHelper extends EthersLogHelper {
  private private_key?: string;
  private wallet?: ethers.Wallet;

  constructor(rpc_url: string, private_key?: string);
  constructor(rpc_url: string, config?: CCIPLiteHelperConfig);
  constructor(
    rpc_url: string,
    privateKeyOrConfig?: string | CCIPLiteHelperConfig,
  ) {
    const config =
      typeof privateKeyOrConfig === "string"
        ? { private_key: privateKeyOrConfig }
        : (privateKeyOrConfig ?? {});

    super(rpc_url, config);
    this.private_key = config.private_key;

    if (this.private_key) {
      this.wallet = new ethers.Wallet(this.private_key, this.web3);
    }
  }

  private getCCIPLiteErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private getContractRunner(): ContractRunner {
    return this.wallet ?? this.web3;
  }

  private normalizeAddress(address: string, label: string): string {
    try {
      return ethers.getAddress(address);
    } catch {
      throw new Error(`Invalid ${label}: ${String(address)}`);
    }
  }

  private normalizeHexString(
    value: string | undefined,
    label: string,
    fallback: string = "0x",
  ): string {
    if (value === undefined || value.trim() === "") {
      return fallback;
    }

    const normalized = value.startsWith("0x") ? value : `0x${value}`;
    if (!ethers.isHexString(normalized)) {
      throw new Error(`Invalid ${label}: ${String(value)}`);
    }

    return normalized;
  }

  private toBigIntSafe(value: unknown, fallback: bigint = 0n): bigint {
    if (value === undefined || value === null) {
      return fallback;
    }

    try {
      return ethers.toBigInt(value as ethers.BigNumberish);
    } catch {
      return fallback;
    }
  }

  private toBoolean(value: unknown): boolean {
    return value === true;
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

  private parseTokenAmounts(value: unknown): TokenAmount[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((item) => {
      const record = this.asRecord(item);

      return {
        token: this.normalizeAddressIfPossible(record?.token ?? ethers.ZeroAddress),
        amount: this.toBigIntSafe(record?.amount),
      };
    });
  }

  private parseCCIPSendRequestedMessage(
    value: unknown,
  ): CCIPSendRequestedMessage | null {
    const record = this.asRecord(value);
    if (!record) {
      return null;
    }

    return {
      sourceChainSelector: this.toBigIntSafe(record.sourceChainSelector),
      sender: this.normalizeAddressIfPossible(record.sender),
      receiver: this.normalizeAddressIfPossible(record.receiver),
      sequenceNumber: this.toBigIntSafe(record.sequenceNumber),
      gasLimit: this.toBigIntSafe(record.gasLimit),
      strict: this.toBoolean(record.strict),
      nonce: this.toBigIntSafe(record.nonce),
      feeToken: this.normalizeAddressIfPossible(record.feeToken),
      feeTokenAmount: this.toBigIntSafe(record.feeTokenAmount),
      data: typeof record.data === "string" ? record.data : "0x",
      tokenAmounts: this.parseTokenAmounts(record.tokenAmounts),
      sourceTokenData: Array.isArray(record.sourceTokenData)
        ? record.sourceTokenData.map((item) => String(item))
        : [],
      messageId: typeof record.messageId === "string" ? record.messageId : "",
    };
  }

  private getCCIPSendRequestedMessage(
    log: ParsedContractLog | LogDescription,
  ): CCIPSendRequestedMessage | null {
    const messageArg = log.args?.[0];
    return this.parseCCIPSendRequestedMessage(messageArg);
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

  private parseExecutionStateChangedData(
    log: ParsedContractLog,
  ): ExecutionStateChangedData | null {
    if (!log.args) {
      return null;
    }

    const sequenceNumber = this.toBigIntSafe(log.args[0]);
    const messageId = log.args[1];
    const state = Number(log.args[2] ?? -1);
    const returnData = log.args[3];

    if (typeof messageId !== "string") {
      return null;
    }

    return {
      sequenceNumber,
      messageId,
      state,
      returnData: typeof returnData === "string" ? returnData : "0x",
    };
  }

  private mapExecutionState(state: number): CCIPTransferState {
    switch (state) {
      case 0:
        return "UNTOUCHED";
      case 1:
        return "IN_PROGRESS";
      case 2:
        return "SUCCESS";
      case 3:
        return "FAILURE";
      default:
        return "UNKNOWN";
    }
  }

  private isLogDescription(log: Log | LogDescription): log is LogDescription {
    return "fragment" in log && "args" in log;
  }

  private getContractMethod(contract: ethers.Contract, functionName: string) {
    const method = contract.getFunction(functionName);
    if (!method) {
      throw new Error(`Function ${functionName} not found in contract ABI`);
    }

    return method;
  }

  private async callReadonlyContractFunction<TResult>(
    contract: ethers.Contract,
    functionName: string,
    args: unknown[],
  ): Promise<TResult> {
    const method = this.getContractMethod(contract, functionName);
    return (await method.staticCall(...args)) as TResult;
  }

  private async getOnRampAddress(
    source_router_address: string,
    destination_chain_selector: string,
  ): Promise<string> {
    const routerContract = this.getContract(
      source_router_address,
      IRouterClientABI,
    );
    const onRamp = await this.callReadonlyContractFunction<string>(
      routerContract,
      "getOnRamp",
      [destination_chain_selector],
    );

    if (!onRamp || onRamp === ethers.ZeroAddress) {
      throw new Error("OnRamp not found for the specified chain");
    }

    return onRamp;
  }

  private async getOffRamps(
    destination_router_address: string,
  ): Promise<OffRampEntry[]> {
    const routerContract = this.getContract(
      destination_router_address,
      IRouterClientABI,
    );

    const rawOffRamps = await this.callReadonlyContractFunction<unknown[]>(
      routerContract,
      "getOffRamps",
      [],
    );
    const offRamps = this.parseOffRampEntries(rawOffRamps);

    if (offRamps.length === 0) {
      throw new Error("合约调用错误: 未找到任何 off-ramps");
    }

    return offRamps;
  }

  /**
   * 获取合约实例
   */
  getContract(contract_address: string, abi: InterfaceAbi): ethers.Contract {
    return new ethers.Contract(contract_address, abi, this.getContractRunner());
  }

  /**
   * 发送交易
   */
  async sendTransaction(
    call_data: TransactionRequest,
  ): Promise<TransactionResponse> {
    if (!this.wallet) {
      throw new Error("Private key is required for sending transactions");
    }

    return await this.wallet.sendTransaction(call_data);
  }

  /**
   * 编码调用数据
   */
  encodeDataByABI(params: {
    abi: InterfaceAbi;
    functionName: string;
    executeArgs: unknown[];
    target: string;
    value?: string | bigint;
  }): TransactionRequest {
    const { abi, functionName, executeArgs, target, value } = params;
    const contract_interface = new ethers.Interface(abi);
    const encoded_data = contract_interface.encodeFunctionData(
      functionName,
      executeArgs,
    );

    return {
      to: target,
      data: encoded_data,
      value: value ?? 0n,
    };
  }

  /**
   * 获取最新区块号
   */
  async getLatestBlockNumber(): Promise<number> {
    return await this.web3.getBlockNumber();
  }

  /**
   * 获取调用数据
   */
  async getCallData(
    source_router_address: string,
    destination_chain_selector: string,
    message: CCIPMessage,
  ): Promise<TransactionRequest> {
    const use_native = message.feeToken === ethers.ZeroAddress;

    const fee = await this.getFee(
      source_router_address,
      destination_chain_selector,
      message,
    );

    return this.encodeDataByABI({
      abi: IRouterClientABI,
      functionName: "ccipSend",
      executeArgs: [destination_chain_selector, message],
      target: source_router_address,
      value: use_native ? fee : 0n,
    });
  }

  /**
   * 获取跨链手续费
   */
  async getFee(
    source_router_address: string,
    destination_chain_selector: string,
    message: CCIPMessage,
  ): Promise<string> {
    const routerContract = this.getContract(
      source_router_address,
      IRouterClientABI,
    );
    const fee = await this.callReadonlyContractFunction<bigint>(
      routerContract,
      "getFee",
      [destination_chain_selector, message],
    );

    return fee.toString();
  }

  /**
   * 创建 CCIP 消息
   */
  createMessage(params: MessageParams): CCIPMessage {
    if (!params.receiver) {
      throw new Error("Receiver address is required");
    }

    if ((params.token === undefined) !== (params.amount === undefined)) {
      throw new Error("token 和 amount 需要同时传入");
    }

    const abi_coder = new ethers.AbiCoder();
    const formatted_receiver = abi_coder.encode(
      ["address"],
      [this.normalizeAddress(params.receiver, "receiver")],
    );

    const token_amounts: TokenAmount[] = [];
    if (params.token && params.amount !== undefined) {
      token_amounts.push({
        token: this.normalizeAddress(params.token, "token"),
        amount: ethers.toBigInt(params.amount),
      });
    }

    return {
      receiver: formatted_receiver,
      data: this.normalizeHexString(params.data, "data"),
      tokenAmounts: token_amounts,
      feeToken: params.feeToken
        ? this.normalizeAddress(params.feeToken, "feeToken")
        : ethers.ZeroAddress,
      extraArgs:
        params.gasLimit !== undefined
          ? this.createExtraArgs(params.gasLimit)
          : "0x",
    };
  }

  /**
   * 创建额外参数
   */
  createExtraArgs(gas_limit: number): string {
    if (!Number.isFinite(gas_limit) || gas_limit < 0) {
      throw new Error("gasLimit must be a non-negative finite number");
    }

    const abi_coder = new ethers.AbiCoder();
    const EVM_EXTRA_ARGS_V1_TAG = "0x97a657c9";
    const encoded_args = abi_coder.encode(
      ["tuple(uint256)"],
      [[BigInt(Math.floor(gas_limit))]],
    );

    return EVM_EXTRA_ARGS_V1_TAG + encoded_args.slice(2);
  }

  /**
   * 通过交易哈希获取消息 ID
   */
  async getMessageId(tx_hash: string): Promise<CCIPMessageIdResult> {
    const all_logs = await this.getLogByTxHash(tx_hash, IEVM2EVMOnRamp);
    const receipt = await this.web3.getTransactionReceipt(tx_hash);
    if (!receipt) {
      throw new Error("Transaction receipt not found");
    }

    const log = all_logs.find(
      (item): item is LogDescription =>
        this.isLogDescription(item) && item.name === "CCIPSendRequested",
    );
    const message = log ? this.getCCIPSendRequestedMessage(log) : null;

    return {
      messageId: message?.messageId,
      blockNumber: receipt.blockNumber,
    };
  }

  /**
   * 获取地址的 CCIP 发送状态
   */
  async getAddressCCIPsendStatus({
    from_address,
    to_address,
    source_router_address,
    destination_chain_selector,
    blocks_to_search = 1000,
  }: {
    from_address?: string;
    to_address?: string;
    source_router_address: string;
    destination_chain_selector: string;
    blocks_to_search?: number;
  }): Promise<CCIPSendStatus[]> {
    const normalized_source_router_address = this.normalizeAddress(
      source_router_address,
      "source_router_address",
    );
    const normalized_from_address = from_address
      ? this.normalizeAddress(from_address, "from_address").toLowerCase()
      : undefined;
    const normalized_to_address = to_address
      ? this.normalizeAddress(to_address, "to_address").toLowerCase()
      : undefined;

    if (!destination_chain_selector) {
      throw new Error("Invalid destination chain selector");
    }

    const on_ramp = await this.getOnRampAddress(
      normalized_source_router_address,
      destination_chain_selector,
    );

    const latest_block = await this.getLatestBlockNumber();
    const from_block = Math.max(0, latest_block - Math.max(0, blocks_to_search));

    const logs = await this.getContractLogs({
      contract_addresses: on_ramp,
      event_names: "CCIPSendRequested",
      abi: IEVM2EVMOnRamp,
      filter: {
        fromBlock: from_block,
        toBlock: latest_block,
      },
    });

    return logs.flatMap((log) => {
      const message = this.getCCIPSendRequestedMessage(log);
      if (!message) {
        return [];
      }

      const from_match =
        !normalized_from_address ||
        message.sender.toLowerCase() === normalized_from_address;
      const to_match =
        !normalized_to_address ||
        message.receiver.toLowerCase() === normalized_to_address;

      if (!from_match || !to_match || !message.messageId) {
        return [];
      }

      return [
        {
          messageId: message.messageId,
          sender: message.sender,
          receiver: message.receiver,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          tokenAmounts: message.tokenAmounts,
          data: message.data,
          fees: {
            feeToken: message.feeToken,
            feeAmount: message.feeTokenAmount,
          },
        } satisfies CCIPSendStatus,
      ];
    });
  }

  /**
   * 获取转账状态
   */
  async getTransferStatus(
    message_id: string,
    destination_router_address: string,
    source_chain_selector: string,
    blocks_to_search = 1000,
  ): Promise<CCIPTransferStatus> {
    const normalized_destination_router_address = this.normalizeAddress(
      destination_router_address,
      "destination_router_address",
    );

    if (!ethers.isHexString(message_id, 32)) {
      throw new Error(`参数错误: ${message_id} 不是有效的消息ID`);
    }

    if (!source_chain_selector) {
      throw new Error("参数错误: 源链选择器缺失或无效");
    }

    let off_ramps: OffRampEntry[];
    try {
      off_ramps = await this.getOffRamps(normalized_destination_router_address);
    } catch (error) {
      const error_string = this.getCCIPLiteErrorMessage(error);
      this.logWarn("获取 OffRamps 失败", error);
      this.logWarn("Router 地址", normalized_destination_router_address);
      throw new Error(
        `合约调用错误: 无法获取 off-ramps 信息 (${error_string})`,
      );
    }

    const matching_off_ramps = off_ramps.filter(
      (off_ramp) => off_ramp.sourceChainSelector === source_chain_selector,
    );

    if (matching_off_ramps.length === 0) {
      throw new Error("合约调用错误: 未找到匹配的off-ramp");
    }

    const latest_block = await this.getLatestBlockNumber();
    const from_block = Math.max(0, latest_block - Math.max(0, blocks_to_search));

    for (const off_ramp of matching_off_ramps) {
      const logs = await this.getContractLogs({
        contract_addresses: off_ramp.offRamp,
        event_names: "ExecutionStateChanged",
        abi: IEVM2EVMOffRamp,
        filter: {
          fromBlock: from_block,
          toBlock: latest_block,
          topics: [null, message_id],
        },
      });

      const latest_log = [...logs]
        .filter((log) => log.args !== null)
        .sort((left, right) => {
          if (left.blockNumber !== right.blockNumber) {
            return right.blockNumber - left.blockNumber;
          }

          return right.index - left.index;
        })[0];

      if (!latest_log) {
        continue;
      }

      const parsed_log = this.parseExecutionStateChangedData(latest_log);
      if (!parsed_log) {
        continue;
      }

      return {
        state: this.mapExecutionState(parsed_log.state),
        blockNumber: latest_log.blockNumber,
        messageId: parsed_log.messageId,
        transactionHash: latest_log.transactionHash,
        offRamp: off_ramp.offRamp,
        sourceChainSelector: off_ramp.sourceChainSelector,
      };
    }

    return {
      state: "UNTOUCHED",
    };
  }
}
