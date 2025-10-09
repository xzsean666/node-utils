# UniswapHelper 使用指南

`UniswapHelper` 是一个强大的工具类，封装了 Uniswap V2 和 V3 的常用操作，继承自 `ERC20Helper`，提供了完整的 token 交换功能。

## 目录

- [快速开始](#快速开始)
- [初始化](#初始化)
- [Uniswap V2 功能](#uniswap-v2-功能)
- [Uniswap V3 功能](#uniswap-v3-功能)
- [工具方法](#工具方法)
- [完整示例](#完整示例)
- [常用合约地址](#常用合约地址)

## 快速开始

```typescript
import { UniswapHelper } from './uniswapHelper';

// 初始化
const helper = new UniswapHelper('YOUR_RPC_URL', {
  privateKey: 'YOUR_PRIVATE_KEY',
  uniswapV2RouterAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  uniswapV3RouterAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  uniswapV3QuoterAddress: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
});

// 查询兑换报价
const amounts = await helper.getAmountsOutV2({
  amountIn: '1000000000000000000', // 1 WETH
  path: [WETH_ADDRESS, USDC_ADDRESS],
});

// 执行 swap
await helper.swapExactTokensForTokensV2({
  amountIn: '1000000000000000000',
  amountOutMin: amounts[1],
  path: [WETH_ADDRESS, USDC_ADDRESS],
  to: 'YOUR_WALLET_ADDRESS',
});
```

## 初始化

### 方式 1: 构造函数配置

```typescript
const helper = new UniswapHelper(
  'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
  {
    privateKey: 'YOUR_PRIVATE_KEY', // 可选，仅执行交易时需要
    uniswapV2RouterAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    uniswapV3RouterAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    uniswapV3QuoterAddress: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
    batchCallAddress: '0xYOUR_BATCH_CALL_CONTRACT', // 可选
  },
);
```

### 方式 2: 动态设置

```typescript
const helper = new UniswapHelper('YOUR_RPC_URL');
helper.setUniswapV2Router('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D');
helper.setUniswapV3Router('0xE592427A0AEce92De3Edee1F18E0157C05861564');
helper.setUniswapV3Quoter('0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6');
```

## Uniswap V2 功能

### 1. 查询兑换输出数量

```typescript
const amounts = await helper.getAmountsOutV2({
  amountIn: '1000000000000000000', // 1 WETH
  path: [WETH, USDC],
});
// amounts[0] = 输入数量
// amounts[1] = 输出数量
```

### 2. 查询兑换输入数量

```typescript
const amounts = await helper.getAmountsInV2({
  amountOut: '1000000000', // 1000 USDC (6 decimals)
  path: [WETH, USDC],
});
// amounts[0] = 需要的输入数量
// amounts[1] = 输出数量
```

### 3. Token 换 Token

```typescript
// 先授权
await helper.approve({
  token_address: WETH,
  spender: UNISWAP_V2_ROUTER_ADDRESS,
  amount: '1000000000000000000',
});

// 执行 swap
const tx = await helper.swapExactTokensForTokensV2({
  amountIn: '1000000000000000000', // 1 WETH
  amountOutMin: minAmountOut, // 最小接受输出（考虑滑点）
  path: [WETH, USDC],
  to: 'YOUR_WALLET_ADDRESS',
  deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 可选，默认 20 分钟
});
```

### 4. ETH 换 Token

```typescript
const tx = await helper.swapExactETHForTokensV2({
  amountETH: '0.1', // 0.1 ETH
  amountOutMin: minAmountOut,
  path: [WETH, USDC], // 第一个必须是 WETH
  to: 'YOUR_WALLET_ADDRESS',
});
```

### 5. Token 换 ETH

```typescript
const tx = await helper.swapExactTokensForETHV2({
  amountIn: '1000000000', // 1000 USDC
  amountOutMin: '100000000000000000', // 最少 0.1 ETH
  path: [USDC, WETH], // 最后一个必须是 WETH
  to: 'YOUR_WALLET_ADDRESS',
});
```

### 6. 多跳路径

```typescript
const amounts = await helper.getAmountsOutV2({
  amountIn: '1000000000', // 1000 USDC
  path: [USDC, WETH, DAI], // USDC -> WETH -> DAI
});
// amounts[0] = USDC 输入
// amounts[1] = 中间 WETH
// amounts[2] = 最终 DAI 输出
```

## Uniswap V3 功能

### 手续费等级

```typescript
const FEE_LOW = 500; // 0.05%
const FEE_MEDIUM = 3000; // 0.3%
const FEE_HIGH = 10000; // 1%
```

### 1. 查询输出数量

```typescript
const amountOut = await helper.quoteExactInputSingleV3({
  tokenIn: WETH,
  tokenOut: USDC,
  fee: 3000, // 0.3% 手续费池
  amountIn: '1000000000000000000', // 1 WETH
  sqrtPriceLimitX96: 0n, // 可选，价格限制
});
```

### 2. 查询输入数量

```typescript
const amountIn = await helper.quoteExactOutputSingleV3({
  tokenIn: WETH,
  tokenOut: USDC,
  fee: 3000,
  amountOut: '1000000000', // 1000 USDC
});
```

### 3. 执行精确输入 Swap

```typescript
// 先授权
await helper.approve({
  token_address: WETH,
  spender: UNISWAP_V3_ROUTER_ADDRESS,
  amount: '1000000000000000000',
});

// 执行 swap
const tx = await helper.exactInputSingleV3({
  tokenIn: WETH,
  tokenOut: USDC,
  fee: 3000,
  recipient: 'YOUR_WALLET_ADDRESS',
  amountIn: '1000000000000000000',
  amountOutMinimum: minAmountOut,
  sqrtPriceLimitX96: 0n, // 可选
});
```

### 4. 执行精确输出 Swap

```typescript
const tx = await helper.exactOutputSingleV3({
  tokenIn: WETH,
  tokenOut: USDC,
  fee: 3000,
  recipient: 'YOUR_WALLET_ADDRESS',
  amountOut: '1000000000', // 精确换出 1000 USDC
  amountInMaximum: maxAmountIn, // 最大输入
});
```

### 5. 多路径 Swap

```typescript
// 编码路径
const path = helper.encodePathV3(
  [USDC, WETH, DAI],
  [3000, 3000], // 每一跳的手续费
);

const tx = await helper.exactInputV3({
  path,
  recipient: 'YOUR_WALLET_ADDRESS',
  amountIn: '1000000000',
  amountOutMinimum: minAmountOut,
});
```

## 工具方法

### 1. 计算滑点保护

```typescript
// 计算最小输出（用于精确输入）
const minOut = helper.calculateMinAmountOut(
  expectedOut,
  0.5, // 0.5% 滑点
);

// 计算最大输入（用于精确输出）
const maxIn = helper.calculateMaxAmountIn(
  expectedIn,
  0.5, // 0.5% 滑点
);
```

### 2. 格式化 Token 数量

```typescript
// 原始单位 -> 可读格式
const formatted = helper.formatTokenAmount(
  1000000000000000000n, // 1 WETH (18 decimals)
  18,
); // "1.0"

// 可读格式 -> 原始单位
const parsed = helper.parseTokenAmount('1.0', 18); // 1000000000000000000n
```

### 3. 查询 Token 信息

```typescript
const info = await helper.getTokenInfo(WETH);
// {
//   name: "Wrapped Ether",
//   symbol: "WETH",
//   decimals: 18,
//   total_supply: 123456789n,
//   address: "0x..."
// }
```

### 4. 查询余额和授权

```typescript
// 查询余额
const balance = await helper.balanceOf({
  token_address: WETH,
  wallet_address: 'YOUR_ADDRESS',
});

// 查询授权额度
const allowance = await helper.allowance({
  token_address: WETH,
  owner: 'YOUR_ADDRESS',
  spender: ROUTER_ADDRESS,
});
```

## 完整示例

```typescript
import { UniswapHelper } from './uniswapHelper';

async function swapExample() {
  const helper = new UniswapHelper('YOUR_RPC_URL', {
    privateKey: 'YOUR_PRIVATE_KEY',
    uniswapV2RouterAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  });

  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const myAddress = '0xYourAddress';

  // 1. 获取 token 信息
  const wethInfo = await helper.getTokenInfo(WETH);
  const usdcInfo = await helper.getTokenInfo(USDC);

  // 2. 准备 swap 数量
  const swapAmount = helper.parseTokenAmount('1.0', wethInfo.decimals);

  // 3. 查询预期输出
  const amounts = await helper.getAmountsOutV2({
    amountIn: swapAmount,
    path: [WETH, USDC],
  });
  const expectedOut = amounts[1];

  console.log(
    `1 WETH 可以换出: ${helper.formatTokenAmount(expectedOut, usdcInfo.decimals)} USDC`,
  );

  // 4. 计算滑点保护
  const minAmountOut = helper.calculateMinAmountOut(expectedOut, 0.5); // 0.5% 滑点

  // 5. 检查并授权
  const allowance = await helper.allowance({
    token_address: WETH,
    owner: myAddress,
    spender: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  });

  if (allowance < swapAmount) {
    const approveTx = await helper.approve({
      token_address: WETH,
      spender: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      amount: ethers.MaxUint256,
    });
    await approveTx.wait();
    console.log('授权完成');
  }

  // 6. 执行 swap
  const swapTx = await helper.swapExactTokensForTokensV2({
    amountIn: swapAmount,
    amountOutMin: minAmountOut,
    path: [WETH, USDC],
    to: myAddress,
  });

  console.log('Swap 交易哈希:', swapTx.hash);

  // 7. 等待确认
  const receipt = await swapTx.wait();
  console.log('交易已确认，区块号:', receipt.blockNumber);

  // 8. 查询新余额
  const newBalance = await helper.balanceOf({
    token_address: USDC,
    wallet_address: myAddress,
  });
  console.log(
    '新的 USDC 余额:',
    helper.formatTokenAmount(newBalance, usdcInfo.decimals),
  );
}

swapExample();
```

## 常用合约地址

### Ethereum Mainnet

```typescript
// Uniswap V2
const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';

// Uniswap V3
const UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const UNISWAP_V3_QUOTER = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';
const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';

// 常用 Tokens
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
```

### Polygon

```typescript
// Uniswap V3 on Polygon
const UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const UNISWAP_V3_QUOTER = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';

// Tokens on Polygon
const WMATIC = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';
const USDC = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
```

### Arbitrum

```typescript
// Uniswap V3 on Arbitrum
const UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const UNISWAP_V3_QUOTER = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';

// Tokens on Arbitrum
const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const USDC = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8';
```

## 注意事项

1. **授权 (Approve)**：在执行 token swap 之前，必须先授权 Router 合约使用你的 token
2. **滑点保护**：建议使用 `calculateMinAmountOut` 和 `calculateMaxAmountIn` 来设置合理的滑点保护
3. **Gas 费用**：V3 的 gas 费用通常比 V2 低，但单笔交易的 gas 费用可能更高
4. **手续费等级**：V3 有不同的手续费池（0.05%, 0.3%, 1%），需要选择流动性最好的池子
5. **Deadline**：所有交易都有默认 20 分钟的 deadline，可以根据需要调整
6. **价格影响**：大额交易可能会有较大的价格影响，建议先查询报价
7. **MEV 保护**：考虑使用私有交易池或 Flashbots 来避免 MEV 攻击

## 继承的 ERC20Helper 功能

`UniswapHelper` 继承自 `ERC20Helper`，因此也包含所有 ERC20 操作：

- `getName()`, `getSymbol()`, `getDecimals()`, `getTotalSupply()`
- `getTokenInfo()` - 获取完整 token 信息
- `balanceOf()` - 查询余额
- `transfer()` - 转账
- `approve()` - 授权
- `allowance()` - 查询授权额度
- `transferFrom()` - 从授权地址转账
- `batchGetBalances()` - 批量查询余额
- `formatTokenAmount()`, `parseTokenAmount()` - 格式化工具

详见 `ERC20Helper` 文档。

## 相关文件

- `uniswapHelper.ts` - 主文件
- `erc20Helper.ts` - 父类
- `ethersTxBatchHelper.ts` - 批量调用功能
- `examples/uniswapHelper-example.ts` - 使用示例

## 许可证

MIT
