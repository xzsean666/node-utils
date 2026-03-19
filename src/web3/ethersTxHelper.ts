import { ethers } from "ethers";

type SupportedProvider = ethers.JsonRpcProvider | ethers.BrowserProvider;
type TxResult = ethers.TransactionResponse | ethers.TransactionReceipt;

export type EthersTxOverrides = Omit<
  ethers.TransactionRequest,
  "to" | "data" | "value" | "from"
>;

export interface EthersTxLogger {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

export interface EthersTxHelperConfig {
  private_key?: string;
  logger?: EthersTxLogger;
}

export interface WaitReceiptOptions {
  confirmations?: number;
  timeoutMs?: number;
}

export interface EncodedContractCall {
  target: string;
  data: string;
  abi: ethers.InterfaceAbi;
  function_name: string;
  execute_args: unknown[];
  value?: ethers.BigNumberish;
  valueEther?: string;
}

export interface SendTransactionParams<
  TWait extends boolean | undefined = undefined,
> extends WaitReceiptOptions {
  target: string;
  data?: string;
  value?: ethers.BigNumberish;
  valueEther?: string;
  txOverrides?: EthersTxOverrides;
  waitConfirm?: TWait;
}

export interface CallContractParams<
  TWait extends boolean | undefined = undefined,
> extends WaitReceiptOptions {
  target: string;
  function_name: string;
  abi: ethers.InterfaceAbi;
  execute_args?: unknown[];
  value?: ethers.BigNumberish;
  valueEther?: string;
  txOverrides?: EthersTxOverrides;
  waitConfirm?: TWait;
}

export interface SendEtherOptions<
  TWait extends boolean | undefined = undefined,
> extends WaitReceiptOptions {
  waitConfirm?: TWait;
  txOverrides?: EthersTxOverrides;
}

interface WaitBehavior extends WaitReceiptOptions {
  waitConfirm?: boolean;
}

interface TransactionValueInput {
  value?: ethers.BigNumberish;
  valueEther?: string;
}

export class EthersTxHelper {
  web3: SupportedProvider;
  NODE_PROVIDER: string | SupportedProvider;
  private private_key?: string;
  private walletSigner?: ethers.Wallet;
  protected logger?: EthersTxLogger;
  private readonly interfaceCache = new WeakMap<object, ethers.Interface>();

  constructor(
    NODE_PROVIDER: string | SupportedProvider,
    config: EthersTxHelperConfig = {},
  ) {
    this.NODE_PROVIDER = NODE_PROVIDER;
    this.private_key = config.private_key;
    this.logger = config.logger;

    if (typeof NODE_PROVIDER === "string") {
      this.web3 = new ethers.JsonRpcProvider(NODE_PROVIDER);
    } else if (
      NODE_PROVIDER instanceof ethers.BrowserProvider ||
      NODE_PROVIDER instanceof ethers.JsonRpcProvider
    ) {
      this.web3 = NODE_PROVIDER;
    } else {
      throw new Error("Invalid NODE_PROVIDER type");
    }

    if (this.private_key) {
      this.walletSigner = new ethers.Wallet(this.private_key, this.web3);
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const ethersError = error as Error & { shortMessage?: string };
      return ethersError.shortMessage ?? error.message;
    }

    if (error && typeof error === "object") {
      const shortMessage = (error as { shortMessage?: unknown }).shortMessage;
      if (typeof shortMessage === "string") {
        return shortMessage;
      }
    }

    return String(error);
  }

  private createWrappedError(message: string, error: unknown): Error {
    if (error instanceof Error) {
      return new Error(`${message}: ${this.getErrorMessage(error)}`, {
        cause: error,
      });
    }

    return new Error(`${message}: ${String(error)}`);
  }

  private createContractError(
    action: string,
    functionName: string,
    abi: ethers.InterfaceAbi,
    error: unknown,
  ): Error {
    const decodedError = this.decodeContractError(abi, error);
    const suffix = decodedError ? ` [${decodedError}]` : "";
    const message = `${action} (${functionName})${suffix}: ${this.getErrorMessage(error)}`;

    if (error instanceof Error) {
      return new Error(message, { cause: error });
    }

    return new Error(message);
  }

  private getInterface(abi: ethers.InterfaceAbi): ethers.Interface {
    if (typeof abi === "object" && abi !== null) {
      const cached = this.interfaceCache.get(abi);
      if (cached) {
        return cached;
      }

      const iface = new ethers.Interface(abi);
      this.interfaceCache.set(abi, iface);
      return iface;
    }

    return new ethers.Interface(abi);
  }

  private normalizeHexData(data?: string): string | undefined {
    if (!data) return undefined;

    const normalized = data.trim();
    if (normalized === "") return undefined;

    const hexData = normalized.startsWith("0x")
      ? normalized
      : `0x${normalized}`;

    if (!ethers.isHexString(hexData)) {
      throw new Error("Invalid hex data");
    }

    return hexData;
  }

  private normalizeWeiValue(
    value?: ethers.BigNumberish,
  ): ethers.BigNumberish | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized === "") {
        return undefined;
      }

      if (normalized.includes(".")) {
        throw new Error(
          "value 必须是 wei/BigNumberish；带小数的原生币金额请使用 valueEther",
        );
      }

      return normalized;
    }

    return value;
  }

  private normalizeEtherValue(valueEther?: string): bigint | undefined {
    if (valueEther === undefined) {
      return undefined;
    }

    const normalized = valueEther.trim();
    if (normalized === "") {
      return undefined;
    }

    return ethers.parseEther(normalized);
  }

  private resolveTransactionValue(
    input: TransactionValueInput,
  ): ethers.BigNumberish | undefined {
    if (input.value !== undefined && input.valueEther !== undefined) {
      throw new Error("value 和 valueEther 不能同时传入");
    }

    const etherValue = this.normalizeEtherValue(input.valueEther);
    if (etherValue !== undefined) {
      return etherValue;
    }

    return this.normalizeWeiValue(input.value);
  }

  private formatErrorArg(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "bigint") {
      return `${value}n`;
    }

    if (Array.isArray(value)) {
      return `[${value.map((item) => this.formatErrorArg(item)).join(", ")}]`;
    }

    if (value && typeof value === "object") {
      try {
        return JSON.stringify(value, (_, currentValue) =>
          typeof currentValue === "bigint" ? `${currentValue}n` : currentValue,
        );
      } catch {
        return String(value);
      }
    }

    return String(value);
  }

  private extractErrorData(error: unknown): string | undefined {
    const queue: unknown[] = [error];
    const seen = new Set<object>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== "object") {
        continue;
      }

      if (seen.has(current)) {
        continue;
      }
      seen.add(current);

      const candidates = [
        (current as { data?: unknown }).data,
        (current as { error?: { data?: unknown } }).error?.data,
        (current as { info?: { error?: { data?: unknown } } }).info?.error
          ?.data,
        (current as { cause?: { data?: unknown } }).cause?.data,
      ];

      for (const candidate of candidates) {
        if (typeof candidate === "string" && ethers.isHexString(candidate)) {
          return candidate;
        }
      }

      queue.push(
        (current as { cause?: unknown }).cause,
        (current as { error?: unknown }).error,
        (current as { info?: { error?: unknown } }).info?.error,
      );
    }

    return undefined;
  }

  private decodeContractError(
    abi: ethers.InterfaceAbi,
    error: unknown,
  ): string | undefined {
    const errorData = this.extractErrorData(error);
    if (!errorData) {
      return undefined;
    }

    try {
      const parsedError = this.getInterface(abi).parseError(errorData);
      if (!parsedError) {
        return undefined;
      }

      const args = Array.from(parsedError.args).map((arg) =>
        this.formatErrorArg(arg),
      );

      return args.length > 0
        ? `${parsedError.name}(${args.join(", ")})`
        : parsedError.name;
    } catch {
      return undefined;
    }
  }

  private shouldWaitForReceipt(waitBehavior: WaitBehavior): boolean {
    const hasAdvancedWaitOptions =
      waitBehavior.confirmations !== undefined ||
      waitBehavior.timeoutMs !== undefined;

    if (hasAdvancedWaitOptions && waitBehavior.waitConfirm !== true) {
      throw new Error(
        "confirmations 和 timeoutMs 需要与 waitConfirm: true 一起使用",
      );
    }

    if (
      waitBehavior.confirmations !== undefined &&
      (!Number.isInteger(waitBehavior.confirmations) ||
        waitBehavior.confirmations < 1)
    ) {
      throw new Error("confirmations 必须是大于等于 1 的整数");
    }

    if (
      waitBehavior.timeoutMs !== undefined &&
      (!Number.isInteger(waitBehavior.timeoutMs) || waitBehavior.timeoutMs < 1)
    ) {
      throw new Error("timeoutMs 必须是大于等于 1 的整数");
    }

    return waitBehavior.waitConfirm === true;
  }

  private async getSigner(): Promise<ethers.Signer> {
    if (this.walletSigner) {
      return this.walletSigner;
    }

    if (this.web3 instanceof ethers.BrowserProvider) {
      return await this.web3.getSigner();
    }

    throw new Error(
      "未提供可用的 Signer (需要 private_key 或 BrowserProvider)",
    );
  }

  private async waitForReceipt(
    txResponse: ethers.TransactionResponse,
    waitOptions: WaitReceiptOptions = {},
  ): Promise<ethers.TransactionReceipt> {
    const confirmations = waitOptions.confirmations ?? 1;
    const receipt = await txResponse.wait(confirmations, waitOptions.timeoutMs);
    if (!receipt) {
      throw new Error("交易未被确认");
    }
    return receipt;
  }

  private buildTransactionRequest(
    call: SendTransactionParams<boolean | undefined>,
  ): ethers.TransactionRequest {
    return {
      ...call.txOverrides,
      to: call.target,
      data: this.normalizeHexData(call.data),
      value: this.resolveTransactionValue(call),
    };
  }

  private async sendWithSigner(
    call: SendTransactionParams<boolean | undefined>,
  ): Promise<TxResult> {
    try {
      const shouldWait = this.shouldWaitForReceipt(call);
      const signer = await this.getSigner();
      const txResponse = await signer.sendTransaction(
        this.buildTransactionRequest(call),
      );

      if (shouldWait) {
        return await this.waitForReceipt(txResponse, call);
      }

      return txResponse;
    } catch (error) {
      throw this.createWrappedError("发送交易失败", error);
    }
  }

  public async deployContract(
    abi: ethers.InterfaceAbi,
    bytecode: string,
    constructorArgs: unknown[] = [],
  ): Promise<ethers.BaseContract> {
    try {
      const signer = await this.getSigner();
      const factory = new ethers.ContractFactory(abi, bytecode, signer);
      const contract = await factory.deploy(...constructorArgs);
      await contract.waitForDeployment();
      return contract;
    } catch (error) {
      throw this.createWrappedError("部署合约失败", error);
    }
  }

  encodeDataByABI(params: {
    abi: ethers.InterfaceAbi;
    function_name: string;
    execute_args?: unknown[];
    target: string;
    value?: ethers.BigNumberish;
    valueEther?: string;
  }): EncodedContractCall {
    const execute_args = params.execute_args ?? [];
    const iface = this.getInterface(params.abi);
    const data = iface.encodeFunctionData(params.function_name, execute_args);

    return {
      target: params.target,
      data,
      abi: params.abi,
      function_name: params.function_name,
      execute_args,
      value: params.value,
      valueEther: params.valueEther,
    };
  }

  decodeResultDataByABI(params: {
    abi: ethers.InterfaceAbi;
    function_name: string;
    data: string;
  }) {
    const { abi, function_name, data } = params;
    const iface = this.getInterface(abi);
    return iface.decodeFunctionResult(function_name, data);
  }

  decodeInputDataByABI(params: { abi: ethers.InterfaceAbi; data: string }) {
    const { abi, data } = params;
    const iface = this.getInterface(abi);
    return iface.parseTransaction({ data });
  }

  async sendEther(
    to_address: string,
    amount: string,
    waitConfirm: true,
  ): Promise<ethers.TransactionReceipt>;
  async sendEther(
    to_address: string,
    amount: string,
    waitConfirm?: false,
  ): Promise<ethers.TransactionResponse>;
  async sendEther(
    to_address: string,
    amount: string,
    options: SendEtherOptions<true>,
  ): Promise<ethers.TransactionReceipt>;
  async sendEther(
    to_address: string,
    amount: string,
    options?: SendEtherOptions<false | undefined>,
  ): Promise<ethers.TransactionResponse>;
  async sendEther(
    to_address: string,
    amount: string,
    waitOrOptions: boolean | SendEtherOptions<boolean | undefined> = false,
  ): Promise<TxResult> {
    const options =
      typeof waitOrOptions === "boolean"
        ? { waitConfirm: waitOrOptions }
        : waitOrOptions;

    return await this.sendWithSigner({
      target: to_address,
      valueEther: amount,
      ...options,
    });
  }

  async callContract(
    params: CallContractParams<true>,
  ): Promise<ethers.TransactionReceipt>;
  async callContract(
    params: CallContractParams<false | undefined>,
  ): Promise<ethers.TransactionResponse>;
  async callContract(
    params: CallContractParams<boolean | undefined>,
  ): Promise<TxResult> {
    const {
      abi,
      function_name,
      execute_args = [],
      target,
      value,
      valueEther,
      txOverrides,
      waitConfirm,
      confirmations,
      timeoutMs,
    } = params;

    try {
      const callData = this.encodeDataByABI({
        abi,
        function_name,
        execute_args,
        target,
        value,
        valueEther,
      });

      return await this.sendWithSigner({
        target: callData.target,
        data: callData.data,
        value: callData.value,
        valueEther: callData.valueEther,
        txOverrides,
        waitConfirm,
        confirmations,
        timeoutMs,
      });
    } catch (error) {
      throw this.createContractError("调用合约失败", function_name, abi, error);
    }
  }

  async callReadContract<T = unknown>(opts: {
    target: string;
    abi: ethers.InterfaceAbi;
    function_name: string;
    execute_args?: unknown[];
    blockTag?: ethers.BlockTag;
  }): Promise<T> {
    const { target, abi, function_name, execute_args = [], blockTag } = opts;

    try {
      const contract = new ethers.Contract(target, abi, this.web3);
      const fn = contract.getFunction(function_name);

      if (blockTag !== undefined) {
        return (await fn(...execute_args, { blockTag })) as T;
      }

      return (await fn(...execute_args)) as T;
    } catch (error) {
      throw this.createContractError("读取合约失败", function_name, abi, error);
    }
  }

  async callStaticContract<T = unknown>(opts: {
    target: string;
    abi: ethers.InterfaceAbi;
    function_name: string;
    args?: unknown[];
  }): Promise<T> {
    const { target, abi, function_name, args = [] } = opts;

    try {
      const contract = new ethers.Contract(target, abi, this.web3);
      const fn = contract.getFunction(function_name);
      return (await fn.staticCall(...args)) as T;
    } catch (error) {
      throw this.createContractError(
        "静态调用合约失败",
        function_name,
        abi,
        error,
      );
    }
  }

  async sendTransaction(
    call: SendTransactionParams<true>,
  ): Promise<ethers.TransactionReceipt>;
  async sendTransaction(
    call: SendTransactionParams<false | undefined>,
  ): Promise<ethers.TransactionResponse>;
  async sendTransaction(
    call: SendTransactionParams<boolean | undefined>,
  ): Promise<TxResult> {
    if (!this.web3) {
      throw new Error("未找到有效的Provider");
    }

    return await this.sendWithSigner(call);
  }
}
