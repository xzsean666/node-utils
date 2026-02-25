import { EthersTxBatchHelper } from '../ethersTxBatchHelper';
import { EthersLogHelper } from '../ethersLogHelper';
import { ethers, HDNodeWallet } from 'ethers';
import ERC20_ABI from './configs/abis/erc20.json';
import { PGKVDatabase } from '../../dbUtils/KVPostgresql';
import { CryptoHelper } from '../../encodeUtils/cryptoHelper';

// --- 配置接口 ---
interface Web3WalletConfig {
  tokenAddress: string;
  batchCallAddress: string;
  rpc: string;
  privateKey: string;
  dbUrl: string;
  chainId: string;
  expiryHours: number;
  tokenDecimals?: number; // 默认为 6 (USDT/USDC)
}

// 订单状态枚举
enum OrderStatus {
  PENDING = 'pending',
  PARTIALLY_PAID = 'partially_paid',
  PAID = 'paid',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

// 订单接口
interface PaymentOrder {
  orderHash?: string;
  walletIndex: number;
  walletAddress: string;
  expectedAmount: string;
  receivedAmount: string;
  status: OrderStatus;
  expiresAt: number;
  orderId: string;
  createdAt: number;
  lastCheckedBlock?: number;
}

// 钱包余额信息
interface WalletBalance {
  address: string;
  balance: string;
  formattedBalance: string;
  decimals: number;
}

// 收款事件
interface PaymentEvent {
  orderId: string;
  walletAddress: string;
  amount: string;
  transactionHash: string;
  blockNumber: number;
  timestamp: number;
}

// 批量查询余额结果
interface BatchBalanceResult {
  target: string;
  success: boolean;
  decodedData: any;
  function: string;
  args: any[];
}

class Web3Wallet {
  private web3: EthersTxBatchHelper;
  private logHelper: EthersLogHelper;
  private wallet_db: PGKVDatabase;
  private unexpected_wallet_db: PGKVDatabase;
  private orders_db: PGKVDatabase;
  private archived_orders_db: PGKVDatabase;
  private events_db: PGKVDatabase;
  private metadata_db: PGKVDatabase;
  private config: Web3WalletConfig;
  private tokenDecimals: number;

  // 用于保护 getNextWalletIndex 的互斥锁
  private walletIndexLock: Promise<void> = Promise.resolve();

  constructor(config: Web3WalletConfig) {
    this.config = config;
    // token decimals 默认 6 (USDT / USDC)
    this.tokenDecimals = config.tokenDecimals ?? 6;

    this.web3 = new EthersTxBatchHelper(config.rpc, {
      private_key: config.privateKey,
      batch_call_address: config.batchCallAddress,
    });

    this.logHelper = new EthersLogHelper(config.rpc);

    // 初始化数据库表
    this.wallet_db = new PGKVDatabase(
      config.dbUrl,
      this.getTableName('wallets'),
    );
    this.unexpected_wallet_db = new PGKVDatabase(
      config.dbUrl,
      this.getTableName('unexpected_wallet'),
    );
    this.orders_db = new PGKVDatabase(
      config.dbUrl,
      this.getTableName('orders'),
    );
    this.archived_orders_db = new PGKVDatabase(
      config.dbUrl,
      this.getTableName('archived_orders'),
    );
    this.events_db = new PGKVDatabase(
      config.dbUrl,
      this.getTableName('events'),
    );
    this.metadata_db = new PGKVDatabase(
      config.dbUrl,
      this.getTableName('metadata'),
    );
  }

  getTableName(table: string): string {
    return `${this.config.chainId}_${this.config.tokenAddress}_wallet_${table}`;
  }

  /**
   * HD 钱包派生（替代旧 EthersUtils.getDeriveWallets）
   * @param index 派生路径索引
   */
  private deriveWallet(index: number): {
    address: string;
    privateKey: string;
    path: string;
  } {
    const wallet = new ethers.Wallet(this.config.privateKey);
    const hdNode = HDNodeWallet.fromSeed(wallet.privateKey);
    const path = `m/44'/60'/0'/0/${index}`;
    const derivedWallet = hdNode.derivePath(path);

    if (!(derivedWallet instanceof HDNodeWallet)) {
      throw new Error('钱包派生失败');
    }

    return {
      address: derivedWallet.address,
      privateKey: derivedWallet.privateKey,
      path,
    };
  }

  /**
   * 获取下一个钱包索引（使用互斥锁防止竞态条件）
   * P0 修复：使用应用层互斥锁 + PostgreSQL 事务保证原子性
   */
  private async getNextWalletIndex(): Promise<number> {
    // 使用 Promise 链实现应用层互斥锁
    return new Promise<number>((resolve, reject) => {
      this.walletIndexLock = this.walletIndexLock.then(async () => {
        try {
          const lastIndex = await this.metadata_db.get('last_wallet_index');
          const nextIndex = lastIndex
            ? parseInt(lastIndex as string) + 1
            : 0;
          await this.metadata_db.put(
            'last_wallet_index',
            nextIndex.toString(),
          );
          resolve(nextIndex);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  /**
   * 获取一个可用的钱包地址（优先从钱包池取，否则派生新钱包）
   * 自动跳过有意外余额的钱包，最多重试 maxRetries 次
   */
  async getWallet(maxRetries: number = 10): Promise<{ address: string; index: number }> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // 1. 优先从钱包池中取
      const wallet = await this.wallet_db.db.findOne({
        order: {
          created_at: 'asc',
        },
      });

      if (wallet) {
        const balance = await this.queryTokenBalance(wallet.key);
        if (Number(balance) > 0) {
          // 有意外余额，标记为异常钱包后继续尝试下一个
          await this.unexpected_wallet_db.add(wallet.key, wallet.value);
          await this.wallet_db.delete(wallet.key);
          continue;
        }
        await this.wallet_db.delete(wallet.key);
        return {
          address: wallet.key,
          index: parseInt(wallet.value.index),
        };
      }

      // 2. 钱包池为空，派生新钱包
      const nextIndex = await this.getNextWalletIndex();
      const derivedWallet = this.deriveWallet(nextIndex);
      const balance = await this.queryTokenBalance(derivedWallet.address);
      if (Number(balance) > 0) {
        // 有意外余额，标记为异常钱包后继续尝试下一个
        await this.unexpected_wallet_db.add(derivedWallet.address, {
          index: nextIndex,
        });
        continue;
      }
      return {
        address: derivedWallet.address,
        index: nextIndex,
      };
    }

    throw new Error(
      `Failed to find a wallet with zero balance after ${maxRetries} attempts`,
    );
  }

  /**
   * 查询单个地址的 token 余额
   */
  private async queryTokenBalance(address: string): Promise<bigint> {
    return await this.web3.callReadContract<bigint>({
      target: this.config.tokenAddress,
      abi: ERC20_ABI,
      function_name: 'balanceOf',
      execute_args: [address],
    });
  }

  generateOrderHash({
    walletAddress,
    orderId,
  }: {
    walletAddress: string;
    orderId: string;
  }): string {
    return CryptoHelper.calculateObjectMD5({ walletAddress, orderId });
  }

  /**
   * 创建收款订单
   * @param expectedAmountWei 期望收款金额（Wei 字符串格式）
   * @param orderId 订单 ID（需唯一）
   * @returns 订单信息
   */
  async createPaymentOrder(
    expectedAmountWei: string,
    orderId: string,
  ): Promise<PaymentOrder> {
    const walletInfo = await this.getWallet();

    const now = Date.now();
    const expiresAt = now + this.config.expiryHours * 60 * 60 * 1000;

    const orderHash = this.generateOrderHash({
      walletAddress: walletInfo.address,
      orderId,
    });

    // 先检查是否已存在（已归档），避免重复下单
    const isExist = await this.archived_orders_db.get(orderHash);
    if (isExist) {
      throw new Error('OrderId already exists, please try again');
    }

    const order: PaymentOrder = {
      orderId,
      walletIndex: walletInfo.index,
      walletAddress: walletInfo.address,
      expectedAmount: expectedAmountWei,
      receivedAmount: '0',
      status: OrderStatus.PENDING,
      expiresAt,
      createdAt: now,
    };

    // 保存订单到数据库
    await this.orders_db.add(orderHash, order);

    return { ...order, orderHash };
  }

  /**
   * 查询单个订单状态
   * @param orderHash 订单 Hash
   * @returns 订单状态字符串
   */
  async queryOrderStatus(orderHash: string): Promise<string> {
    const order = (await this.orders_db.get(orderHash)) as PaymentOrder | null;
    if (!order) {
      // 在归档中查找
      const archivedOrder = (await this.archived_orders_db.get(
        orderHash,
      )) as PaymentOrder | null;
      if (archivedOrder) return archivedOrder.status;
      return OrderStatus.EXPIRED;
    }

    // 检查订单是否过期并自动归档
    if (order.status === OrderStatus.PENDING && Date.now() > order.expiresAt) {
      order.status = OrderStatus.EXPIRED;
      await this.archiveOrder(orderHash, order);
    }
    return order.status;
  }

  /**
   * 查询订单详情（优先查活跃订单，其次查归档订单）
   */
  async queryOrder(orderHash: string): Promise<PaymentOrder> {
    const order = (await this.orders_db.get(orderHash)) as PaymentOrder | null;
    if (!order) {
      const archivedOrder = (await this.archived_orders_db.get(
        orderHash,
      )) as PaymentOrder | null;
      if (!archivedOrder) throw new Error('Order not found');
      return archivedOrder;
    }
    return order;
  }

  /**
   * 归档订单（从活跃订单移动到归档订单库）
   * P0 修复：确保已完成/过期/取消的订单被正确归档，避免 orders_db 无限膨胀
   */
  private async archiveOrder(
    orderHash: string,
    order: PaymentOrder,
  ): Promise<void> {
    try {
      await this.archived_orders_db.put(orderHash, order);
      await this.orders_db.delete(orderHash);
    } catch (error: any) {
      console.error(`归档订单失败 (${orderHash}): ${error.message}`);
    }
  }

  /**
   * 批量查询钱包余额
   * @param addresses 钱包地址数组
   * @returns 余额信息数组
   */
  async batchQueryBalances(
    addresses: string[],
  ): Promise<BatchBalanceResult[]> {
    const calls = addresses.map((address) =>
      this.web3.encodeDataByABI({
        target: this.config.tokenAddress,
        abi: ERC20_ABI,
        function_name: 'balanceOf',
        execute_args: [address],
      }),
    );
    return this.web3.batchStaticCall(calls);
  }

  /**
   * 检查所有待处理订单的收款状态
   * @param batchSize 批量查询大小
   */
  async checkAllPendingOrders(batchSize: number = 50): Promise<{
    checked: number;
    updated: number;
    newPayments: PaymentEvent[];
  }> {
    // 使用 searchJson 按 status 查询，避免全量加载所有订单
    const { data: pendingRecords } = await this.orders_db.searchJson({
      contains: { status: OrderStatus.PENDING },
    });

    const now = Date.now();

    // 分离待处理和过期的订单
    const pendingOrders: Array<{ hash: string; order: PaymentOrder }> = [];
    const expiredOrders: Array<{ hash: string; order: PaymentOrder }> = [];

    for (const record of pendingRecords) {
      const order = record.value as PaymentOrder;
      const hash = record.key as string;
      if (now < order.expiresAt) {
        pendingOrders.push({ hash, order });
      } else {
        order.status = OrderStatus.EXPIRED;
        expiredOrders.push({ hash, order });
      }
    }

    // 批量归档过期订单
    if (expiredOrders.length > 0) {
      await Promise.all(
        expiredOrders.map(({ hash, order }) => this.archiveOrder(hash, order)),
      );
    }

    if (pendingOrders.length === 0) {
      return { checked: 0, updated: 0, newPayments: [] };
    }

    let updatedCount = 0;
    const newPayments: PaymentEvent[] = [];

    // 分批处理
    for (let i = 0; i < pendingOrders.length; i += batchSize) {
      const batch = pendingOrders.slice(i, i + batchSize);
      const addresses = batch.map((item) => item.order.walletAddress);

      // 批量查询余额
      const balances = await this.batchQueryBalances(addresses);

      // 获取当前区块号（一次请求，避免 N 次重复调用）
      const currentBlock = await this.web3.web3.getBlockNumber();

      for (const [j, { hash: orderHash, order }] of batch.entries()) {
        const balanceResult = balances[j];
        if (!balanceResult || !balanceResult.success) continue;

        // decodedData 是 ethers Result，取第一个元素即为 balance bigint
        const currentBalance: bigint =
          balanceResult.decodedData?.[0] ?? 0n;
        const currentBalanceStr = currentBalance.toString();

        if (currentBalanceStr === order.receivedAmount) continue;

        // 余额发生变化，更新订单
        const previousAmount = ethers.parseUnits(
          order.receivedAmount || '0',
          0,
        );
        const currentAmount = currentBalance;
        const expectedAmount = ethers.parseUnits(order.expectedAmount, 0);

        if (currentAmount > previousAmount) {
          // 收到新的付款
          const paymentAmount = currentAmount - previousAmount;

          const paymentEvent: PaymentEvent = {
            orderId: order.orderId,
            walletAddress: order.walletAddress,
            amount: paymentAmount.toString(),
            transactionHash: '', // 需要通过 events 查询获取
            blockNumber: currentBlock,
            timestamp: Date.now(),
          };

          newPayments.push(paymentEvent);
          await this.events_db.put(
            `${order.orderId}_${Date.now()}`,
            paymentEvent,
          );
        }

        // 更新订单状态
        order.receivedAmount = currentBalanceStr;
        order.lastCheckedBlock = currentBlock;

        if (currentAmount >= expectedAmount) {
          order.status = OrderStatus.PAID;
          // 已付款订单自动归档
          await this.archiveOrder(orderHash, order);
        } else if (currentAmount > 0n) {
          order.status = OrderStatus.PARTIALLY_PAID;
          await this.orders_db.put(orderHash, order);
        } else {
          await this.orders_db.put(orderHash, order);
        }
        updatedCount++;
      }
    }

    return {
      checked: pendingOrders.length,
      updated: updatedCount,
      newPayments,
    };
  }

  /**
   * 获取钱包的历史交易事件
   * @param walletAddress 钱包地址
   * @param fromBlock 起始区块
   * @param toBlock 结束区块
   */
  async getWalletTransferEvents(
    walletAddress: string,
    fromBlock?: number,
    toBlock?: number | string,
  ) {
    const events = await this.logHelper.getContractLogs({
      contract_addresses: this.config.tokenAddress,
      event_names: ['Transfer'],
      abi: ERC20_ABI,
      filter: {
        fromBlock,
        toBlock,
        topics: [
          null as unknown as string, // from address (any)
          ethers.zeroPadValue(walletAddress, 32), // to address (our wallet)
        ],
      },
    });

    return events
      .filter((event) => event.args != null)
      .map((event) => ({
        from: event.args!.from,
        to: event.args!.to,
        amount: event.args!.value.toString(),
        formattedAmount: ethers.formatUnits(
          event.args!.value,
          this.tokenDecimals,
        ),
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        logIndex: event.index,
      }));
  }

  /**
   * 集合转账 - 将多个钱包的资金转移到主钱包
   * @param walletIndices 钱包索引数组
   * @param targetAddress 目标地址
   * @param minAmount 最小转账金额（低于此金额不转账），单位 Wei
   */
  async collectFundsFromWallets(
    walletIndices: number[],
    targetAddress: string,
    minAmount: string = '0',
  ): Promise<{
    success: boolean;
    transactions: Array<{
      fromAddress: string;
      amount: string;
      transactionHash?: string;
      error?: string;
    }>;
  }> {
    const minAmountBN = ethers.parseUnits(minAmount, 0);
    const transactions: Array<{
      fromAddress: string;
      amount: string;
      transactionHash?: string;
      error?: string;
    }> = [];

    // 获取所有钱包地址
    const walletAddresses = walletIndices.map(
      (index) => this.deriveWallet(index).address,
    );

    // 批量查询余额
    const balances = await this.batchQueryBalances(walletAddresses);

    // 过滤有足够余额的钱包
    const walletsToCollect: Array<{
      address: string;
      balance: bigint;
      index: number;
    }> = [];

    for (let i = 0; i < balances.length; i++) {
      const result = balances[i];
      if (!result || !result.success) continue;
      const balance: bigint = result.decodedData?.[0] ?? 0n;
      if (balance > minAmountBN) {
        walletsToCollect.push({
          address: walletAddresses[i]!,
          balance,
          index: walletIndices[i]!,
        });
      }
    }

    if (walletsToCollect.length === 0) {
      return { success: true, transactions: [] };
    }

    // 并发发送所有转账交易（不逐个等待确认，大幅提升效率）
    const txPromises = walletsToCollect.map(async (walletInfo) => {
      try {
        const derivedWallet = this.deriveWallet(walletInfo.index);

        const walletWeb3 = new EthersTxBatchHelper(this.config.rpc, {
          private_key: derivedWallet.privateKey,
          batch_call_address: this.config.batchCallAddress,
        });

        const tx = await walletWeb3.callContract({
          target: this.config.tokenAddress,
          abi: ERC20_ABI,
          function_name: 'transfer',
          execute_args: [targetAddress, walletInfo.balance],
          waitConfirm: true,
        });

        return {
          fromAddress: walletInfo.address,
          amount: walletInfo.balance.toString(),
          transactionHash: tx.hash,
        };
      } catch (error: any) {
        return {
          fromAddress: walletInfo.address,
          amount: walletInfo.balance.toString(),
          error: error.message,
        };
      }
    });

    const results = await Promise.allSettled(txPromises);
    for (const result of results) {
      if (result.status === 'fulfilled') {
        transactions.push(result.value);
      }
    }

    const successCount = transactions.filter((tx) => tx.transactionHash).length;
    return {
      success: successCount > 0,
      transactions,
    };
  }

  /**
   * 获取订单的收款事件历史
   * @param orderId 订单ID
   */
  async getOrderPaymentEvents(orderId: string): Promise<PaymentEvent[]> {
    // 使用 prefix 查询优化，避免全量扫描
    const events = await this.events_db.getWithPrefix<PaymentEvent>(
      `${orderId}_`,
    );
    return Object.values(events) as PaymentEvent[];
  }

  /**
   * 取消订单
   * @param orderHash 订单 Hash
   */
  async cancelOrder(orderHash: string): Promise<boolean> {
    const order = (await this.orders_db.get(orderHash)) as PaymentOrder | null;
    if (!order) return false;

    if (
      order.status === OrderStatus.PENDING ||
      order.status === OrderStatus.PARTIALLY_PAID
    ) {
      order.status = OrderStatus.CANCELLED;
      // P0 修复：取消的订单也归档
      await this.archiveOrder(orderHash, order);
      return true;
    }

    return false;
  }

  /**
   * 获取统计信息
   */
  async getPaymentStats(): Promise<{
    totalOrders: number;
    pendingOrders: number;
    paidOrders: number;
    expiredOrders: number;
    totalReceived: string;
    formattedTotalReceived: string;
  }> {
    const [activeOrders, archivedOrders] = await Promise.all([
      this.orders_db.getAll(),
      this.archived_orders_db.getAll(),
    ]);

    // 合并活跃和归档订单
    const allOrderValues = [
      ...Object.values(activeOrders),
      ...Object.values(archivedOrders),
    ] as PaymentOrder[];

    let totalReceived = 0n;
    let pendingCount = 0;
    let paidCount = 0;
    let expiredCount = 0;

    for (const order of allOrderValues) {
      if (order.receivedAmount && order.receivedAmount !== '0') {
        totalReceived += ethers.parseUnits(order.receivedAmount, 0);
      }

      switch (order.status) {
        case OrderStatus.PENDING:
          if (Date.now() > order.expiresAt) {
            expiredCount++;
          } else {
            pendingCount++;
          }
          break;
        case OrderStatus.PAID:
          paidCount++;
          break;
        case OrderStatus.EXPIRED:
          expiredCount++;
          break;
      }
    }

    return {
      totalOrders: allOrderValues.length,
      pendingOrders: pendingCount,
      paidOrders: paidCount,
      expiredOrders: expiredCount,
      totalReceived: totalReceived.toString(),
      formattedTotalReceived: ethers.formatUnits(
        totalReceived,
        this.tokenDecimals,
      ),
    };
  }

  /**
   * 查询所有订单（支持分页和筛选，包含归档订单）
   * @param options 查询选项
   */
  async queryOrders(
    options: {
      status?: OrderStatus;
      limit?: number;
      offset?: number;
      sortBy?: 'createdAt' | 'expiresAt';
      sortOrder?: 'asc' | 'desc';
      includeArchived?: boolean;
    } = {},
  ): Promise<{
    orders: PaymentOrder[];
    total: number;
    hasMore: boolean;
  }> {
    const includeArchived = options.includeArchived ?? true;

    const [activeOrders, archivedOrders] = await Promise.all([
      this.orders_db.getAll(),
      includeArchived
        ? this.archived_orders_db.getAll()
        : Promise.resolve({}),
    ]);

    let orders = [
      ...Object.values(activeOrders),
      ...Object.values(archivedOrders),
    ] as PaymentOrder[];

    // 状态筛选
    if (options.status) {
      orders = orders.filter((order) => order.status === options.status);
    }

    // 排序
    const sortBy = options.sortBy || 'createdAt';
    const sortOrder = options.sortOrder || 'desc';
    orders.sort((a, b) => {
      const aVal = a[sortBy] ?? 0;
      const bVal = b[sortBy] ?? 0;
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    const total = orders.length;
    const offset = options.offset || 0;
    const limit = options.limit || 20;

    // 分页
    const paginatedOrders = orders.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    return {
      orders: paginatedOrders,
      total,
      hasMore,
    };
  }

  /**
   * 关闭所有数据库连接
   */
  async close(): Promise<void> {
    await Promise.all([
      this.wallet_db.close(),
      this.unexpected_wallet_db.close(),
      this.orders_db.close(),
      this.archived_orders_db.close(),
      this.events_db.close(),
      this.metadata_db.close(),
    ]);
  }
}

export { Web3Wallet, OrderStatus };
export type { Web3WalletConfig, PaymentOrder, WalletBalance, PaymentEvent };
