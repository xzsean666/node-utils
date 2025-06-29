import { Web3Wallet, OrderStatus } from '../src/utils/web3/wallet/web3Wallet';

async function demonstratePaymentCollectionSDK() {
  // 初始化钱包SDK
  const wallet = new Web3Wallet({
    tokenAddress: '0xA0b86a33E6441e6C7F08B2A86d3aEa8B23bb6D3b', // 示例USDT地址
    batchCallAddress: '0x...', // BatchCall合约地址
    rpc: 'https://eth-mainnet.alchemyapi.io/v2/your-api-key',
    privateKey: 'your-master-private-key', // 主私钥，用于派生收款钱包
    dbUrl: 'postgresql://username:password@localhost:5432/database',
    dbPrefix: 'payment_system', // 数据库表前缀
  });

  console.log('=== ERC20收款SDK演示 ===\n');

  // 1. 创建收款订单
  console.log('1. 创建收款订单');
  const order1 = await wallet.createPaymentOrder(
    '100.50', // 期望收款100.50 USDT
    24, // 24小时过期
    {
      customerEmail: 'customer@example.com',
      productId: 'PROD-001',
      description: '商品购买',
    },
  );

  console.log('订单创建成功:');
  console.log(`- 订单ID: ${order1.orderId}`);
  console.log(`- 收款地址: ${order1.walletAddress}`);
  console.log(`- 期望金额: ${order1.expectedAmount} USDT`);
  console.log(`- 钱包索引: ${order1.walletIndex}`);
  console.log(`- 过期时间: ${new Date(order1.expiresAt)}\n`);

  // 2. 创建更多订单用于演示
  const order2 = await wallet.createPaymentOrder('50.25', 12);
  const order3 = await wallet.createPaymentOrder('200.00', 48);

  // 3. 查询单个订单状态
  console.log('2. 查询订单状态');
  const orderStatus = await wallet.getOrderStatus(order1.orderId);
  if (orderStatus) {
    console.log(`订单 ${orderStatus.orderId} 状态: ${orderStatus.status}`);
    console.log(`已收到金额: ${orderStatus.receivedAmount} USDT\n`);
  }

  // 4. 批量查询钱包余额
  console.log('3. 批量查询收款钱包余额');
  const addresses = [
    order1.walletAddress,
    order2.walletAddress,
    order3.walletAddress,
  ];
  const balances = await wallet.batchQueryBalances(addresses);

  balances.forEach((balance, index) => {
    console.log(`钱包 ${index + 1}: ${balance.address}`);
    console.log(`- 余额: ${balance.formattedBalance} USDT`);
    console.log(`- 原始余额: ${balance.balance}`);
  });
  console.log();

  // 5. 检查所有待处理订单的收款状态
  console.log('4. 检查所有待处理订单');
  const checkResult = await wallet.checkAllPendingOrders(10);
  console.log(`检查了 ${checkResult.checked} 个订单`);
  console.log(`更新了 ${checkResult.updated} 个订单`);
  console.log(`发现 ${checkResult.newPayments.length} 笔新付款\n`);

  // 6. 查询钱包的历史交易
  console.log('5. 查询钱包交易历史');
  const events = await wallet.getWalletTransferEvents(
    order1.walletAddress,
    'latest' as any, // 从最新区块开始
    'latest',
  );

  console.log(`钱包 ${order1.walletAddress} 的交易历史:`);
  events.forEach((event, index) => {
    console.log(`交易 ${index + 1}:`);
    console.log(`- 从: ${event.from}`);
    console.log(`- 到: ${event.to}`);
    console.log(`- 金额: ${event.formattedAmount} USDT`);
    console.log(`- 交易哈希: ${event.transactionHash}`);
    console.log(`- 区块号: ${event.blockNumber}`);
  });
  console.log();

  // 7. 获取支付统计信息
  console.log('6. 支付系统统计');
  const stats = await wallet.getPaymentStats();
  console.log(`总订单数: ${stats.totalOrders}`);
  console.log(`待处理订单: ${stats.pendingOrders}`);
  console.log(`已完成订单: ${stats.paidOrders}`);
  console.log(`过期订单: ${stats.expiredOrders}`);
  console.log(`总收款金额: ${stats.formattedTotalReceived} USDT\n`);

  // 8. 查询订单（支持筛选和分页）
  console.log('7. 查询所有待处理订单');
  const pendingOrders = await wallet.queryOrders({
    status: OrderStatus.PENDING,
    limit: 10,
    offset: 0,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });

  console.log(`找到 ${pendingOrders.total} 个待处理订单`);
  pendingOrders.orders.forEach((order, index) => {
    console.log(`订单 ${index + 1}:`);
    console.log(`- ID: ${order.orderId}`);
    console.log(`- 钱包: ${order.walletAddress}`);
    console.log(`- 期望金额: ${order.expectedAmount} USDT`);
    console.log(`- 状态: ${order.status}`);
    console.log(`- 创建时间: ${new Date(order.createdAt)}`);
  });
  console.log();

  // 9. 集合转账演示（将收款转移到主钱包）
  console.log('8. 集合转账演示');
  const masterWalletAddress = '0x...'; // 主钱包地址
  const walletIndices = [
    order1.walletIndex,
    order2.walletIndex,
    order3.walletIndex,
  ];

  const collectResult = await wallet.collectFundsFromWallets(
    walletIndices,
    masterWalletAddress,
    '1.0', // 最小转账金额1 USDT
  );

  console.log(`集合转账${collectResult.success ? '成功' : '失败'}`);
  collectResult.transactions.forEach((tx, index) => {
    console.log(`转账 ${index + 1}:`);
    console.log(`- 从: ${tx.fromAddress}`);
    console.log(`- 金额: ${tx.amount}`);
    if (tx.transactionHash) {
      console.log(`- 交易哈希: ${tx.transactionHash}`);
    } else if (tx.error) {
      console.log(`- 错误: ${tx.error}`);
    }
  });
  console.log();

  // 10. 取消订单
  console.log('9. 取消订单');
  const cancelResult = await wallet.cancelOrder(order3.orderId);
  console.log(`订单 ${order3.orderId} 取消${cancelResult ? '成功' : '失败'}\n`);

  // 11. 获取订单的支付事件历史
  console.log('10. 查询订单支付事件');
  const paymentEvents = await wallet.getOrderPaymentEvents(order1.orderId);
  console.log(`订单 ${order1.orderId} 的支付事件:`);
  paymentEvents.forEach((event, index) => {
    console.log(`事件 ${index + 1}:`);
    console.log(`- 金额: ${event.amount}`);
    console.log(`- 时间: ${new Date(event.timestamp)}`);
    console.log(`- 区块: ${event.blockNumber}`);
  });
}

// 定时任务示例：监控待处理订单
async function startPaymentMonitoring() {
  const wallet = new Web3Wallet({
    tokenAddress: '0xA0b86a33E6441e6C7F08B2A86d3aEa8B23bb6D3b',
    batchCallAddress: '0x...',
    rpc: 'https://eth-mainnet.alchemyapi.io/v2/your-api-key',
    privateKey: 'your-master-private-key',
    dbUrl: 'postgresql://username:password@localhost:5432/database',
    dbPrefix: 'payment_system',
  });

  console.log('启动支付监控系统...');

  // 每30秒检查一次待处理订单
  setInterval(async () => {
    try {
      console.log('检查待处理订单...');
      const result = await wallet.checkAllPendingOrders(50);

      if (result.updated > 0) {
        console.log(`✅ 更新了 ${result.updated} 个订单`);

        // 处理新支付事件
        for (const payment of result.newPayments) {
          console.log(
            `💰 新支付: 订单 ${payment.orderId} 收到 ${payment.amount} 代币`,
          );

          // 这里可以添加业务逻辑，如发送通知邮件、更新业务系统等
          await handleNewPayment(payment);
        }
      }
    } catch (error) {
      console.error('监控检查失败:', error);
    }
  }, 30000); // 30秒间隔
}

// 处理新支付的业务逻辑
async function handleNewPayment(payment: any) {
  // 这里可以实现:
  // 1. 发送支付确认邮件
  // 2. 更新订单状态到业务系统
  // 3. 触发发货流程
  // 4. 记录审计日志

  console.log(`处理新支付: ${payment.orderId} - ${payment.amount}`);

  // 示例: 发送Webhook通知
  // await sendWebhookNotification(payment);
}

// API路由示例（Express.js风格）
function setupPaymentAPI(wallet: Web3Wallet) {
  // 创建订单API
  const createOrder = async (req: any, res: any) => {
    try {
      const { amount, expiryHours, metadata } = req.body;

      const order = await wallet.createPaymentOrder(
        amount,
        expiryHours,
        metadata,
      );

      res.json({
        success: true,
        data: order,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  };

  // 查询订单状态API
  const getOrderStatus = async (req: any, res: any) => {
    try {
      const { orderId } = req.params;

      const order = await wallet.getOrderStatus(orderId);

      if (!order) {
        return res.status(404).json({
          success: false,
          error: '订单不存在',
        });
      }

      res.json({
        success: true,
        data: order,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  };

  // 订单列表API
  const listOrders = async (req: any, res: any) => {
    try {
      const { status, limit, offset, sortBy, sortOrder } = req.query;

      const result = await wallet.queryOrders({
        status,
        limit: parseInt(limit) || 20,
        offset: parseInt(offset) || 0,
        sortBy,
        sortOrder,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  };

  // 支付统计API
  const getStats = async (req: any, res: any) => {
    try {
      const stats = await wallet.getPaymentStats();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  };

  return {
    createOrder,
    getOrderStatus,
    listOrders,
    getStats,
  };
}

// 导出
export {
  demonstratePaymentCollectionSDK,
  startPaymentMonitoring,
  setupPaymentAPI,
};

// 如果直接运行此文件
if (require.main === module) {
  demonstratePaymentCollectionSDK()
    .then(() => console.log('演示完成'))
    .catch(console.error);
}
