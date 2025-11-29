# ERC20 收款钱包 SDK

这是一个基于以太坊的 ERC20 代币收款系统 SDK，支持自动生成收款地址、批量查询余额、收款状态监控和资金集合管理。

## 功能特性

- 🔐 **HD钱包派生**: 基于主私钥自动生成收款地址
- 💰 **订单管理**: 创建、查询、取消收款订单
- 📊 **批量查询**: 高效的批量余额查询功能
- 🔍 **状态监控**: 自动监控收款状态变化
- 💸 **资金集合**: 将多个收款地址的资金转移到主钱包
- 📈 **统计分析**: 完整的收款数据统计
- 🗄️ **数据持久化**: 基于 PostgreSQL 的数据存储
- ⚡ **高性能**: 利用 BatchCall 合约进行批量操作

## 安装依赖

```bash
npm install ethers
npm install pg  # PostgreSQL 客户端
```

## 快速开始

### 1. 初始化 SDK

```typescript
import { Web3Wallet, OrderStatus } from './web3Wallet';

const wallet = new Web3Wallet({
  tokenAddress: '0xA0b86a33E6441e6C7F08B2A86d3aEa8B23bb6D3b', // ERC20代币合约地址
  batchCallAddress: '0x...', // BatchCall合约地址
  rpc: 'https://eth-mainnet.alchemyapi.io/v2/your-api-key',
  privateKey: 'your-master-private-key', // 主私钥（用于派生收款钱包）
  dbUrl: 'postgresql://username:password@localhost:5432/database',
  dbPrefix: 'payment_system', // 数据库表前缀
});
```

### 2. 创建收款订单

```typescript
const order = await wallet.createPaymentOrder(
  '100.50', // 期望收款金额
  24, // 过期时间（小时）
  {
    // 订单元数据（可选）
    customerEmail: 'customer@example.com',
    productId: 'PROD-001',
    description: '商品购买',
  },
);

console.log('收款地址:', order.walletAddress);
console.log('订单ID:', order.orderId);
```

### 3. 查询订单状态

```typescript
const orderStatus = await wallet.getOrderStatus(order.orderId);
console.log('订单状态:', orderStatus.status);
console.log('已收金额:', orderStatus.receivedAmount);
```

### 4. 批量监控收款

```typescript
// 检查所有待处理订单
const result = await wallet.checkAllPendingOrders(50);
console.log(`检查了 ${result.checked} 个订单`);
console.log(`发现 ${result.newPayments.length} 笔新付款`);
```

## 核心功能

### 订单管理

#### 创建订单

```typescript
const order = await wallet.createPaymentOrder(
  amount: string,        // 期望金额
  expiryHours: number,   // 过期小时数
  metadata?: any         // 元数据
);
```

#### 查询订单

```typescript
// 查询单个订单
const order = await wallet.getOrderStatus(orderId);

// 查询订单列表（支持分页和筛选）
const result = await wallet.queryOrders({
  status: OrderStatus.PENDING,
  limit: 20,
  offset: 0,
  sortBy: 'createdAt',
  sortOrder: 'desc',
});
```

#### 取消订单

```typescript
const success = await wallet.cancelOrder(orderId);
```

### 余额查询

#### 批量查询余额

```typescript
const addresses = ['0x...', '0x...', '0x...'];
const balances = await wallet.batchQueryBalances(addresses);

balances.forEach((balance) => {
  console.log(`地址: ${balance.address}`);
  console.log(`余额: ${balance.formattedBalance} USDT`);
});
```

### 收款监控

#### 自动检查待处理订单

```typescript
const result = await wallet.checkAllPendingOrders(batchSize);

// 处理新支付事件
result.newPayments.forEach((payment) => {
  console.log(`新收款: ${payment.amount} 代币`);
  console.log(`订单: ${payment.orderId}`);
});
```

#### 获取交易历史

```typescript
const events = await wallet.getWalletTransferEvents(
  walletAddress,
  fromBlock,
  toBlock,
);
```

### 资金管理

#### 集合转账

```typescript
const result = await wallet.collectFundsFromWallets(
  [0, 1, 2, 3], // 钱包索引数组
  '0x...', // 目标地址
  '1.0', // 最小转账金额
);

console.log(`转账${result.success ? '成功' : '失败'}`);
result.transactions.forEach((tx) => {
  if (tx.transactionHash) {
    console.log(`✅ ${tx.fromAddress}: ${tx.transactionHash}`);
  } else {
    console.log(`❌ ${tx.fromAddress}: ${tx.error}`);
  }
});
```

### 统计分析

```typescript
const stats = await wallet.getPaymentStats();
console.log(`总订单: ${stats.totalOrders}`);
console.log(`待处理: ${stats.pendingOrders}`);
console.log(`已完成: ${stats.paidOrders}`);
console.log(`总收款: ${stats.formattedTotalReceived} USDT`);
```

## 订单状态

```typescript
enum OrderStatus {
  PENDING = 'pending', // 待支付
  PARTIALLY_PAID = 'partially_paid', // 部分支付
  PAID = 'paid', // 已完成
  EXPIRED = 'expired', // 已过期
  CANCELLED = 'cancelled', // 已取消
}
```

## 数据结构

### PaymentOrder

```typescript
interface PaymentOrder {
  orderId: string; // 订单ID
  walletIndex: number; // 钱包索引
  walletAddress: string; // 收款地址
  expectedAmount: string; // 期望金额
  receivedAmount: string; // 已收金额
  status: OrderStatus; // 订单状态
  tokenAddress: string; // 代币合约地址
  createdAt: number; // 创建时间
  expiresAt: number; // 过期时间
  lastCheckedBlock: number; // 最后检查区块
  metadata?: any; // 元数据
}
```

### WalletBalance

```typescript
interface WalletBalance {
  address: string; // 钱包地址
  balance: string; // 原始余额
  formattedBalance: string; // 格式化余额
  decimals: number; // 代币精度
}
```

### PaymentEvent

```typescript
interface PaymentEvent {
  orderId: string; // 订单ID
  walletAddress: string; // 钱包地址
  amount: string; // 支付金额
  transactionHash: string; // 交易哈希
  blockNumber: number; // 区块号
  timestamp: number; // 时间戳
}
```

## 高级用法

### 定时监控系统

```typescript
// 启动自动监控
setInterval(async () => {
  try {
    const result = await wallet.checkAllPendingOrders(50);

    if (result.updated > 0) {
      console.log(`✅ 更新了 ${result.updated} 个订单`);

      // 处理新支付
      for (const payment of result.newPayments) {
        await handleNewPayment(payment);
      }
    }
  } catch (error) {
    console.error('监控检查失败:', error);
  }
}, 30000); // 30秒检查一次
```

### Express.js API 集成

```typescript
import express from 'express';

const app = express();
const paymentAPI = setupPaymentAPI(wallet);

// 创建订单
app.post('/api/orders', paymentAPI.createOrder);

// 查询订单状态
app.get('/api/orders/:orderId', paymentAPI.getOrderStatus);

// 订单列表
app.get('/api/orders', paymentAPI.listOrders);

// 支付统计
app.get('/api/stats', paymentAPI.getStats);
```

## 部署要求

### 智能合约

1. **BatchCall 合约**: 用于批量查询，提高效率
2. **ERC20 代币合约**: 目标收款代币

### 数据库

- PostgreSQL 数据库
- 自动创建以下表：
  - `{prefix}_wallets`: 钱包信息
  - `{prefix}_orders`: 订单数据
  - `{prefix}_events`: 支付事件

### 网络配置

- 稳定的以太坊 RPC 节点
- 建议使用 Alchemy、Infura 等服务

## 安全注意事项

1. **私钥安全**: 主私钥需要安全存储，建议使用环境变量
2. **数据库安全**: 确保数据库连接使用 SSL
3. **访问控制**: API 端点需要适当的身份验证
4. **资金监控**: 定期检查资金流向，设置异常告警
5. **备份策略**: 定期备份钱包索引和订单数据

## 性能优化

1. **批量查询**: 使用 `batchQueryBalances` 而不是逐个查询
2. **合理的检查间隔**: 根据业务需求调整监控频率
3. **数据库索引**: 为查询字段添加适当索引
4. **缓存策略**: 对频繁查询的数据使用缓存

## 故障排除

### 常见问题

1. **余额查询失败**

   - 检查 RPC 节点状态
   - 确认 BatchCall 合约地址正确
   - 验证代币合约地址

2. **派生钱包错误**

   - 确认主私钥格式正确
   - 检查钱包索引是否递增

3. **数据库连接问题**
   - 验证数据库连接字符串
   - 确认数据库权限

### 调试模式

```typescript
// 启用详细日志
console.log('订单详情:', await wallet.getOrderStatus(orderId));
console.log('钱包余额:', await wallet.batchQueryBalances([address]));
console.log('系统统计:', await wallet.getPaymentStats());
```

## 许可证

MIT License

## 支持

如有问题，请提交 Issue 或联系开发团队。
