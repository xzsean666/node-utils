import { ethers } from "ethers";
interface TransferFromWithPKParams {
  fromAddressPK: string;
  toAddress: string;
  amount?: bigint;
  threshold?: bigint;
}

export class ERC20Utils {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet | null = null;
  private contract: ethers.Contract;

  private static ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  ];

  constructor(rpcUrl: string, tokenAddress: string, privateKey?: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    if (privateKey) {
      this.wallet = new ethers.Wallet(privateKey, this.provider);
      this.contract = new ethers.Contract(
        tokenAddress,
        ERC20Utils.ERC20_ABI,
        this.wallet
      );
    } else {
      this.contract = new ethers.Contract(
        tokenAddress,
        ERC20Utils.ERC20_ABI,
        this.provider
      );
    }
  }

  /**
   * 获取代币余额
   * @param accountAddress 账户地址
   * @returns 余额（原始数值，未经过 decimals 转换）
   */
  public async balanceOf(accountAddress: string): Promise<bigint> {
    return await this.contract.balanceOf(accountAddress);
  }

  /**
   * 获取代币信息
   * @returns 代币信息对象
   */
  public async getTokenInfo(): Promise<{
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: bigint;
  }> {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      this.contract.name(),
      this.contract.symbol(),
      this.contract.decimals(),
      this.contract.totalSupply(),
    ]);
    return { name, symbol, decimals, totalSupply };
  }

  /**
   * 发送代币
   * @param toAddress 接收地址
   * @param amount 发送数量（原始数值，未经过 decimals 转换）
   * @returns 交易回执
   */
  public async transfer(
    toAddress: string,
    amount: bigint,
    fromAddressPK?: string
  ): Promise<ethers.ContractTransaction> {
    if (fromAddressPK) {
      // 使用提供的私钥创建新的钱包实例
      const fromWallet = new ethers.Wallet(fromAddressPK, this.provider);
      const fromContract = new ethers.Contract(
        this.contract.target,
        ERC20Utils.ERC20_ABI,
        fromWallet
      );
      return await fromContract.transfer(toAddress, amount);
    }

    // 使用默认钱包
    if (!this.wallet) {
      throw new Error("需要提供私钥才能执行转账操作");
    }
    return await this.contract.transfer(toAddress, amount);
  }

  async approve(toAddress: string, amount?: bigint, fromAddressPK?: string) {
    const activeWallet = fromAddressPK
      ? new ethers.Wallet(fromAddressPK, this.provider)
      : this.wallet;

    if (!activeWallet) {
      throw new Error("需要提供私钥才能执行转账操作");
    }

    // 获取当前授权额度
    const currentAllowance = await this.contract.allowance(
      activeWallet.address,
      toAddress
    );

    if (amount) {
      // 如果指定了具体金额，检查当前授权是否足够
      if (currentAllowance >= amount) {
        return null;
      }
    } else {
      // 如果没有指定金额，使用 MaxUint128
      amount = ethers.MaxUint256 / 2n;
      // 如果当前授权已经是 MaxUint128 或更大，则不需要再授权
      if (currentAllowance >= amount) {
        return null;
      }
    }
    const activeContract = new ethers.Contract(
      this.contract.target,
      ERC20Utils.ERC20_ABI,
      activeWallet
    );
    return await activeContract.approve(toAddress, amount);
  }

  /**
   * 获取最近的转账交易的平均 gas 使用量
   * @param count 要查询的交易数量
   * @returns 平均 gas 使用量和当前 gas 价格的乘积
   */
  public async getHistoricalTransferGasCost(
    count: number = 10
  ): Promise<bigint> {
    // Transfer 事件的 topic
    const transferEventTopic =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

    // 获取最近的区块
    const currentBlock = await this.provider.getBlockNumber();
    const fromBlock = currentBlock - 10000; // 查询最近10000个区块

    // 获取 Transfer 事件日志
    const logs = await this.provider.getLogs({
      address: this.contract.target,
      topics: [transferEventTopic],
      fromBlock,
      toBlock: "latest",
    });

    // 获取最近的 count 个转账记录
    const recentTransfers = logs.slice(-count);

    if (recentTransfers.length === 0) {
      throw new Error("没有找到最近的转账记录");
    }

    // 获取这些交易的 gas 使用量
    const gasUsages = await Promise.all(
      recentTransfers.map((log) =>
        this.provider.getTransactionReceipt(log.transactionHash)
      )
    );

    // 计算平均 gas 使用量
    const totalGasUsed = gasUsages.reduce(
      (sum, receipt) => sum + receipt!.gasUsed,
      0n
    );
    const averageGasUsed = totalGasUsed / BigInt(gasUsages.length);

    // 获取当前 gas 价格
    const { gasPrice } = await this.provider.getFeeData();

    return averageGasUsed * gasPrice!;
  }

  public async estimateTransferGasCost(
    toAddress: string,
    amount: bigint | number
  ): Promise<bigint> {
    try {
      // 首先尝试获取历史平均值
      const historicalGasCost = await this.getHistoricalTransferGasCost();
      return historicalGasCost;
    } catch (error) {
      // 如果获取历史数据失败，回退到原来的估算方法
      const gasLimit = await this.contract.transfer.estimateGas(
        toAddress,
        amount
      );
      const gasPrice = await this.provider.getFeeData();
      return gasLimit * gasPrice.gasPrice!;
    }
  }

  async transferFromWithPK(params: TransferFromWithPKParams): Promise<any> {
    if (!this.wallet) {
      throw new Error("需要提供主钱包私钥用于补充gas费");
    }

    const { fromAddressPK, toAddress, amount, threshold } = params;

    // 创建发送方的钱包实例
    const fromWallet = new ethers.Wallet(fromAddressPK, this.provider);

    // 获取代币精度并计算默认阈值
    const decimals = await this.contract.decimals();
    const defaultThreshold =
      BigInt(10) ** BigInt(Math.floor(Number(decimals) / 2));
    const actualThreshold = threshold ?? defaultThreshold;

    // 如果没有指定转账金额，则获取全部余额
    const balance = await this.getBalance(fromWallet.address);
    const transferAmount = amount ?? balance;

    // 检查余额是否超过阈值
    if (transferAmount <= actualThreshold) {
      throw new Error(
        `余额 ${transferAmount} 低于设定阈值 ${actualThreshold}，不执行转账`
      );
    }

    // 估算gas费用
    let estimatedGasCost = await this.estimateTransferGasCost(
      toAddress,
      transferAmount
    );
    estimatedGasCost = (estimatedGasCost * BigInt(150)) / BigInt(100);

    // 检查发送方账户的ETH余额
    const fromBalance = await this.provider.getBalance(fromWallet.address);

    // 如果ETH余额不足以支付gas
    if (fromBalance < estimatedGasCost) {
      // 计算需要补充的ETH数量
      const neededGas = estimatedGasCost - fromBalance;

      try {
        // 使用主钱包转入所需的ETH
        const tx = await this.wallet.sendTransaction({
          to: fromWallet.address,
          value: neededGas,
        });
        await tx.wait(1);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error: any) {
        if (error?.error?.message === "already known") {
          console.log("ETH补充交易已经在进行中...");
          await new Promise((resolve) => setTimeout(resolve, 5000));
        } else {
          throw error;
        }
      }
      const fromContract = new ethers.Contract(
        this.contract.target,
        ERC20Utils.ERC20_ABI,
        fromWallet
      );
      const tx = await fromContract.transfer(toAddress, transferAmount);
      await tx.wait(1);
      return tx;
    }
  }

  /**
   * 转移钱包中所有的原生代币（如 ETH）
   * @param toAddress 接收地址
   * @returns 交易回执
   */
  async transferAllNative(
    toAddress: string,
    fromAddressPK?: string
  ): Promise<ethers.TransactionResponse> {
    // 确定使用哪个钱包
    const activeWallet = fromAddressPK
      ? new ethers.Wallet(fromAddressPK, this.provider)
      : this.wallet;

    if (!activeWallet) {
      throw new Error("需要提供私钥才能执行转账操作");
    }

    // 获取当前账户余额
    const balance = await this.provider.getBalance(activeWallet.address);

    // 估算 gas 费用
    const gasPrice = await this.provider.getFeeData();
    const gasLimit = 21000n; // ETH 转账的固定 gas 限制
    const gasCost = gasLimit * gasPrice.gasPrice! * 2n;

    // 计算实际可转账金额（总余额减去 gas 费用）
    const transferAmount = balance - gasCost;

    // 检查是否有足够的余额支付 gas
    if (transferAmount <= 0n) {
      throw new Error("余额不足以支付 gas 费用");
    }

    // 发送交易
    const tx = await activeWallet.sendTransaction({
      to: toAddress,
      value: transferAmount,
    });
    return tx;
  }
}
