import { EthersUtils, ethers } from '../deprecate/ethersUtils';
import ERC20_ABI from './configs/abis/erc20.json';
import BATCHCALL_ABI from './configs/abis/batchCall.json';
import { PGKVDatabase } from '../../dbUtils/KVPostgresql';
import { CryptoHelper } from '../../encodeUtils/cryptoHelper';

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

class Web3Wallet {
  private web3: EthersUtils;
  private token: ethers.Contract;
  private batchCall: ethers.Contract;
  private wallet_db: PGKVDatabase;
  private active_wallet_db: PGKVDatabase;
  private unexpect_wallet_db: PGKVDatabase;
  private orders_db: PGKVDatabase;
  private achived_orders_db: PGKVDatabase;
  private events_db: PGKVDatabase;
  private metadata_db: PGKVDatabase;
  private config: any;

  constructor(config: {
    tokenAddress: string;
    batchCallAddress: string;
    rpc: string;
    privateKey: string;
    dbUrl: string;
    chainId: string;
    expiryHours: number;
  }) {
    this.config = config;
    this.web3 = new EthersUtils(config.rpc, {
      privateKey: config.privateKey,
      batchCallAddress: config.batchCallAddress,
    });

    this.token = this.web3.getContract(config.tokenAddress, ERC20_ABI);
    this.batchCall = this.web3.getContract(
      config.batchCallAddress,
      BATCHCALL_ABI,
    );

    // 初始化数据库表
    this.wallet_db = new PGKVDatabase(
      config.dbUrl,
      this.getTableName('wallets'),
    );
    this.active_wallet_db = new PGKVDatabase(
      config.dbUrl,
      this.getTableName('active_wallet'),
    );
    this.unexpect_wallet_db = new PGKVDatabase(
      config.dbUrl,
      this.getTableName('unexpect_wallet'),
    );
    this.orders_db = new PGKVDatabase(
      config.dbUrl,
      this.getTableName('orders'),
    );
    this.achived_orders_db = new PGKVDatabase(
      config.dbUrl,
      this.getTableName('achived_orders'),
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

  getTableName(table: string) {
    return `${this.config.chainId}_${this.config.tokenAddress}_wallet_${table}`;
  }
  /**
   * 获取下一个钱包索引
   */
  private async getNextWalletIndex(): Promise<number> {
    const lastIndex = await this.metadata_db.get('last_wallet_index');
    const nextIndex = lastIndex ? parseInt(lastIndex as string) + 1 : 0;
    await this.wallet_db.put('last_wallet_index', nextIndex.toString());
    return nextIndex;
  }

  async getWallet(): Promise<{ address: string; index: number }> {
    const wallet = await this.wallet_db.db.findOne({
      order: {
        created_at: 'asc',
      },
    });
    if (wallet) {
      const balance = await this.token.balanceOf(wallet?.key);
      if (Number(balance) > 0) {
        await this.unexpect_wallet_db.add(wallet?.key, wallet?.value);
        await this.wallet_db.delete(wallet?.key);
        throw new Error('Unexpect error 999, try again later');
      }
      await this.wallet_db.delete(wallet?.key);
      return {
        address: wallet?.key,
        index: parseInt(wallet?.value.index),
      };
    }
    const nextIndex = await this.getNextWalletIndex();
    const derivedWallet = this.web3.getDeriveWallets(nextIndex);
    const balance = await this.token.balanceOf(derivedWallet.address);
    if (Number(balance) > 0) {
      await this.unexpect_wallet_db.add(derivedWallet.address, {
        index: nextIndex,
      });
      throw new Error('Unexpect error 999, try again later');
    }
    return {
      address: derivedWallet.address,
      index: nextIndex,
    };
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
   * @param expectedAmount 期望收款金额（字符串格式，已考虑decimals）
   * @param expiryHours 订单过期时间（小时）
   * @param metadata 订单元数据
   * @returns 订单信息
   */
  async createPaymentOrder(
    expectedAmountWei: string,
    orderId: string,
  ): Promise<PaymentOrder> {
    const walletInfo = await this.getWallet();

    const now = Date.now();
    const expiresAt = now + this.config.expiryHours * 60 * 60 * 1000;

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
    const orderHash = this.generateOrderHash({
      walletAddress: walletInfo.address,
      orderId,
    });
    const isExsist = await this.achived_orders_db.get(orderHash);
    if (isExsist) {
      throw new Error('OrderId already exists, please try again');
    }

    // 保存订单到数据库
    await this.orders_db.add(orderHash, order);
    const result = {
      ...order,
      orderHash,
    };

    return result;
  }
  /**
   * 查询单个订单状态
   * @param orderId 订单ID
   * @returns 订单信息
   */
  async queryOrderStatus(orderHash: string): Promise<string> {
    const order = (await this.orders_db.get(orderHash)) as PaymentOrder;
    if (!order) return OrderStatus.EXPIRED;

    // 检查订单是否过期
    if (order.status === OrderStatus.PENDING && Date.now() > order.expiresAt) {
      order.status = OrderStatus.EXPIRED;
      await this.orders_db.put(orderHash, order);
    }
    return order.status;
  }
  async queryOrder(orderHash: string): Promise<PaymentOrder | null> {
    const order = (await this.orders_db.get(orderHash)) as PaymentOrder;
    if (!order) {
      const achivedOrder = (await this.achived_orders_db.get(
        orderHash,
      )) as PaymentOrder;
      if (!achivedOrder) throw new Error('Order not found');
      return achivedOrder;
    }
    return order;
  }

  /**
   * 批量查询钱包余额
   * @param addresses 钱包地址数组
   * @returns 余额信息数组
   */
  async batchQueryBalances(addresses: string[]): Promise<any[]> {
    const calls = addresses.map((address) =>
      this.web3.encodeDataByABI({
        target: this.config.tokenAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        executeArgs: [address],
      }),
    );
    const results = await this.web3.batchReadCall(calls);
    return results;
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
    // 获取所有待处理的订单
    const allOrders = await this.orders_db.getAll();
    const pendingOrders = Object.values(allOrders).filter(
      (order: any) =>
        order.status === OrderStatus.PENDING && Date.now() < order.expiresAt,
    ) as PaymentOrder[];

    if (pendingOrders.length === 0) {
      return { checked: 0, updated: 0, newPayments: [] };
    }

    let updatedCount = 0;
    const newPayments: PaymentEvent[] = [];

    // 分批处理
    for (let i = 0; i < pendingOrders.length; i += batchSize) {
      const batch = pendingOrders.slice(i, i + batchSize);
      const addresses = batch.map((order) => order.walletAddress);

      // 批量查询余额
      const balances = await this.batchQueryBalances(addresses);

      // 检查每个订单
      for (let j = 0; j < batch.length; j++) {
        const order = batch[j];
        const balance = balances[j];

        if (balance.balance !== order.receivedAmount) {
          // 余额发生变化，更新订单
          const previousAmount = ethers.parseUnits(
            order.receivedAmount || '0',
            this.tokenDecimals,
          );
          const currentAmount = ethers.parseUnits(balance.balance, 0);
          const expectedAmount = ethers.parseUnits(
            order.expectedAmount,
            this.tokenDecimals,
          );

          if (currentAmount > previousAmount) {
            // 收到新的付款
            const paymentAmount = currentAmount - previousAmount;

            const paymentEvent: PaymentEvent = {
              orderId: order.orderId,
              walletAddress: order.walletAddress,
              amount: paymentAmount.toString(),
              transactionHash: '', // 需要通过events查询获取
              blockNumber: await this.web3.getLatestBlockNumber(),
              timestamp: Date.now(),
            };

            newPayments.push(paymentEvent);
            await this.events_db.set(
              `${order.orderId}_${Date.now()}`,
              paymentEvent,
            );
          }

          // 更新订单状态
          order.receivedAmount = balance.balance;
          order.lastCheckedBlock = await this.web3.getLatestBlockNumber();

          if (currentAmount >= expectedAmount) {
            order.status = OrderStatus.PAID;
          } else if (currentAmount > 0) {
            order.status = OrderStatus.PARTIALLY_PAID;
          }

          await this.orders_db.set(order.orderId, order);
          updatedCount++;
        }
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
    const events = await this.web3.getContractLogs(
      await this.token.getAddress(),
      ['Transfer'],
      ERC20_ABI,
      {
        fromBlock,
        toBlock,
        topics: [
          null, // Transfer event signature
          null, // from address (any)
          ethers.zeroPadValue(walletAddress, 32), // to address (our wallet)
        ],
      },
    );

    return events.map((event) => ({
      from: event.args.from,
      to: event.args.to,
      amount: event.args.value.toString(),
      formattedAmount: ethers.formatUnits(event.args.value, this.tokenDecimals),
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber,
      logIndex: event.logIndex,
    }));
  }

  /**
   * 集合转账 - 将多个钱包的资金转移到主钱包
   * @param walletIndices 钱包索引数组
   * @param targetAddress 目标地址
   * @param minAmount 最小转账金额（低于此金额不转账）
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
    const minAmountBN = ethers.parseUnits(minAmount, this.tokenDecimals);
    const transactions: Array<{
      fromAddress: string;
      amount: string;
      transactionHash?: string;
      error?: string;
    }> = [];

    // 获取所有钱包地址
    const walletAddresses = walletIndices.map(
      (index) => this.web3.getDeriveWallets(index).address,
    );

    // 批量查询余额
    const balances = await this.batchQueryBalances(walletAddresses);

    // 过滤有足够余额的钱包
    const walletsToCollect = balances.filter(
      (balance) => ethers.parseUnits(balance.balance, 0) > minAmountBN,
    );

    if (walletsToCollect.length === 0) {
      return { success: true, transactions: [] };
    }

    // 为每个钱包创建转账交易
    for (const walletBalance of walletsToCollect) {
      try {
        const walletIndex =
          walletIndices[walletAddresses.indexOf(walletBalance.address)];
        const derivedWallet = this.web3.getDeriveWallets(walletIndex);

        // 创建新的EthersUtils实例用于该钱包
        const walletWeb3 = new EthersUtils(this.rpc, {
          privateKey: derivedWallet.privateKey,
          batchCallAddress: this.web3.config?.batchCallAddress,
        });

        const tokenContract = walletWeb3.getContractWithSigner(
          await this.token.getAddress(),
          ERC20_ABI,
        );

        // 执行转账
        const tx = await tokenContract.transfer(
          targetAddress,
          walletBalance.balance,
        );
        await tx.wait();

        transactions.push({
          fromAddress: walletBalance.address,
          amount: walletBalance.balance,
          transactionHash: tx.hash,
        });
      } catch (error: any) {
        transactions.push({
          fromAddress: walletBalance.address,
          amount: walletBalance.balance,
          error: error.message,
        });
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
    const allEvents = await this.events_db.getAll();
    return Object.values(allEvents).filter(
      (event: any) => event.orderId === orderId,
    ) as PaymentEvent[];
  }

  /**
   * 取消订单
   * @param orderId 订单ID
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    const order = (await this.orders_db.get(orderId)) as PaymentOrder;
    if (!order) return false;

    if (
      order.status === OrderStatus.PENDING ||
      order.status === OrderStatus.PARTIALLY_PAID
    ) {
      order.status = OrderStatus.CANCELLED;
      await this.orders_db.set(orderId, order);
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
    const allOrders = await this.orders_db.getAll();
    const orders = Object.values(allOrders) as PaymentOrder[];

    let totalReceived = ethers.getBigInt(0);
    let pendingCount = 0;
    let paidCount = 0;
    let expiredCount = 0;

    for (const order of orders) {
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
      totalOrders: orders.length,
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
   * 查询所有订单（支持分页和筛选）
   * @param options 查询选项
   */
  async queryOrders(
    options: {
      status?: OrderStatus;
      limit?: number;
      offset?: number;
      sortBy?: 'createdAt' | 'expiresAt';
      sortOrder?: 'asc' | 'desc';
    } = {},
  ): Promise<{
    orders: PaymentOrder[];
    total: number;
    hasMore: boolean;
  }> {
    const allOrders = await this.orders_db.getAll();
    let orders = Object.values(allOrders) as PaymentOrder[];

    // 状态筛选
    if (options.status) {
      orders = orders.filter((order) => order.status === options.status);
    }

    // 排序
    const sortBy = options.sortBy || 'createdAt';
    const sortOrder = options.sortOrder || 'desc';
    orders.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
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
}

export { Web3Wallet, OrderStatus, PaymentOrder, WalletBalance, PaymentEvent };
