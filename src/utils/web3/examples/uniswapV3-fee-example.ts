import { UniswapHelper } from '../uniswapHelper';

/**
 * Uniswap V3 Fee 选择示例
 * 展示如何快速获取和选择最佳的 fee tier
 */

const helper = new UniswapHelper(
  'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
  {
    uniswapV3FactoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Mainnet V3 Factory
    uniswapV3QuoterAddress: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6', // Mainnet V3 Quoter
    uniswapV3RouterAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Mainnet V3 Router
  },
);

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

// ==================== 方法 1: 查询所有 fee tier 信息 ====================

async function example1_getAllPoolInfo() {
  console.log('=== 查询所有 fee tier 的池子信息 ===\n');

  const poolInfos = await helper.getAllV3PoolInfo(WETH, USDC);

  console.log('WETH/USDC 的所有池子:');
  poolInfos.forEach((info) => {
    console.log(`  Fee: ${info.fee} (${info.fee / 10000}%)`);
    console.log(`  池子地址: ${info.poolAddress}`);
    console.log(`  是否存在: ${info.exists}`);
    console.log(`  流动性: ${info.liquidity.toString()}`);
    console.log('');
  });

  // 输出示例:
  // WETH/USDC 的所有池子:
  //   Fee: 500 (0.05%)
  //   池子地址: 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640
  //   是否存在: true
  //   流动性: 123456789...
  //
  //   Fee: 3000 (0.3%)
  //   池子地址: 0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8
  //   是否存在: true
  //   流动性: 987654321...
  //
  //   Fee: 10000 (1%)
  //   池子地址: 0x0000000000000000000000000000000000000000
  //   是否存在: false
  //   流动性: 0
}

// ==================== 方法 2: 自动选择最佳 fee (基于流动性) ====================

async function example2_getBestFeeByLiquidity() {
  console.log('=== 自动选择流动性最大的 fee tier ===\n');

  const bestFee = await helper.getBestV3Fee(WETH, USDC);

  if (bestFee) {
    console.log(`最佳 fee tier: ${bestFee.fee} (${bestFee.fee / 10000}%)`);
    console.log(`池子地址: ${bestFee.poolAddress}`);
    console.log(`流动性: ${bestFee.liquidity.toString()}`);
  } else {
    console.log('没有找到可用的池子');
  }

  // 输出示例:
  // 最佳 fee tier: 500 (0.05%)
  // 池子地址: 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640
  // 流动性: 123456789...
}

// ==================== 方法 3: 自动选择最佳 fee (基于实际报价) ====================

async function example3_getBestFeeByQuote() {
  console.log('=== 自动选择报价最优的 fee tier ===\n');

  const amountIn = '1000000000000000000'; // 1 WETH

  const bestQuote = await helper.quoteV3WithBestFee({
    tokenIn: WETH,
    tokenOut: USDC,
    amountIn,
  });

  if (bestQuote) {
    console.log(`输入: 1 WETH`);
    console.log(`最佳 fee tier: ${bestQuote.fee} (${bestQuote.fee / 10000}%)`);
    console.log(`输出: ${bestQuote.amountOut.toString()} USDC (最小单位)`);
    console.log(`池子地址: ${bestQuote.poolAddress}`);
    console.log(`流动性: ${bestQuote.liquidity.toString()}`);
  } else {
    console.log('没有找到可用的报价');
  }

  // 输出示例:
  // 输入: 1 WETH
  // 最佳 fee tier: 500 (0.05%)
  // 输出: 3500000000 USDC (最小单位)
  // 池子地址: 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640
  // 流动性: 123456789...
}

// ==================== 方法 4: 检查特定 fee tier 是否存在 ====================

async function example4_checkPoolExists() {
  console.log('=== 检查特定 fee tier 的池子是否存在 ===\n');

  const fees = [500, 3000, 10000];

  for (const fee of fees) {
    const exists = await helper.isV3PoolExists(WETH, USDC, fee);
    console.log(
      `WETH/USDC ${fee} (${fee / 10000}%) 池子: ${exists ? '存在' : '不存在'}`,
    );
  }

  // 输出示例:
  // WETH/USDC 500 (0.05%) 池子: 存在
  // WETH/USDC 3000 (0.3%) 池子: 存在
  // WETH/USDC 10000 (1%) 池子: 不存在
}

// ==================== 方法 5: 比较不同 fee tier 的报价 ====================

async function example5_compareFees() {
  console.log('=== 比较不同 fee tier 的报价 ===\n');

  const amountIn = '1000000000000000000'; // 1 WETH
  const fees = [500, 3000, 10000];

  console.log(`输入: 1 WETH\n`);

  for (const fee of fees) {
    try {
      // 检查池子是否存在
      const exists = await helper.isV3PoolExists(WETH, USDC, fee);
      if (!exists) {
        console.log(`Fee ${fee} (${fee / 10000}%): 池子不存在\n`);
        continue;
      }

      // 获取报价
      const amountOut = await helper.quoteExactInputSingleV3({
        tokenIn: WETH,
        tokenOut: USDC,
        fee,
        amountIn,
      });

      // 获取流动性
      const poolAddress = await helper.getV3PoolAddress(WETH, USDC, fee);
      const liquidity = await helper.getV3PoolLiquidity(poolAddress);

      // 计算实际价格 (USDC per WETH)
      const price = Number(amountOut) / 1e6; // USDC 有 6 位小数

      console.log(`Fee ${fee} (${fee / 10000}%):`);
      console.log(
        `  输出: ${amountOut.toString()} USDC (${price.toFixed(2)} USDC)`,
      );
      console.log(`  流动性: ${liquidity.toString()}`);
      console.log(`  池子: ${poolAddress}\n`);
    } catch (error: any) {
      console.log(
        `Fee ${fee} (${fee / 10000}%): 查询失败 - ${error.message}\n`,
      );
    }
  }
}

// ==================== 方法 6: 实际使用最佳 fee 进行 swap ====================

async function example6_swapWithBestFee() {
  console.log('=== 使用最佳 fee 进行 swap ===\n');

  const amountIn = '1000000000000000000'; // 1 WETH
  const myAddress = '0xYourWalletAddress';

  // 1. 获取最佳报价
  const bestQuote = await helper.quoteV3WithBestFee({
    tokenIn: WETH,
    tokenOut: USDC,
    amountIn,
  });

  if (!bestQuote) {
    console.log('没有找到可用的池子');
    return;
  }

  console.log(
    `找到最佳 fee tier: ${bestQuote.fee} (${bestQuote.fee / 10000}%)`,
  );
  console.log(`预期输出: ${bestQuote.amountOut.toString()} USDC\n`);

  // 2. 计算滑点保护
  const minAmountOut = helper.calculateMinAmountOut(bestQuote.amountOut, 0.5); // 0.5% 滑点
  console.log(`最小接受输出 (0.5% 滑点): ${minAmountOut.toString()} USDC\n`);

  // 3. 检查授权
  const allowance = await helper.allowance({
    token_address: WETH,
    owner: myAddress,
    spender: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // V3 Router
  });

  if (allowance < BigInt(amountIn)) {
    console.log('授权额度不足，正在授权...');
    const approveTx = await helper.approve({
      token_address: WETH,
      spender: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      amount: ethers.MaxUint256,
    });
    await approveTx.wait();
    console.log('授权完成\n');
  }

  // 4. 执行 swap
  console.log('执行 swap...');
  const swapTx = await helper.exactInputSingleV3({
    tokenIn: WETH,
    tokenOut: USDC,
    fee: bestQuote.fee, // 使用最佳 fee
    recipient: myAddress,
    amountIn,
    amountOutMinimum: minAmountOut,
  });

  console.log(`交易哈希: ${swapTx.hash}`);
  console.log('等待确认...');

  const receipt = await swapTx.wait();
  console.log(`交易已确认，区块号: ${receipt.blockNumber}`);
}

// ==================== 方法 7: 对比多个 token pair ====================

async function example7_compareMultiplePairs() {
  console.log('=== 对比多个 token pair 的最佳 fee ===\n');

  const pairs = [
    { name: 'WETH/USDC', tokenA: WETH, tokenB: USDC },
    { name: 'WETH/USDT', tokenA: WETH, tokenB: USDT },
    { name: 'WETH/DAI', tokenA: WETH, tokenB: DAI },
    { name: 'USDC/USDT', tokenA: USDC, tokenB: USDT },
  ];

  for (const pair of pairs) {
    console.log(`${pair.name}:`);

    const bestFee = await helper.getBestV3Fee(pair.tokenA, pair.tokenB);

    if (bestFee) {
      console.log(`  最佳 fee: ${bestFee.fee} (${bestFee.fee / 10000}%)`);
      console.log(`  流动性: ${bestFee.liquidity.toString()}`);
      console.log(`  池子: ${bestFee.poolAddress}`);
    } else {
      console.log('  没有找到可用的池子');
    }
    console.log('');
  }
}

// ==================== 方法 8: 使用自定义 fee tier 列表 ====================

async function example8_customFeeTiers() {
  console.log('=== 使用自定义 fee tier 列表 ===\n');

  // Uniswap V3 在某些网络上可能有不同的 fee tiers
  // 或者你可能只想检查特定的 fee tiers
  const customFees = [500, 3000]; // 只检查 0.05% 和 0.3%

  const bestQuote = await helper.quoteV3WithBestFee({
    tokenIn: WETH,
    tokenOut: USDC,
    amountIn: '1000000000000000000',
    fees: customFees, // 自定义 fee tier 列表
  });

  if (bestQuote) {
    console.log(`最佳 fee (从 ${customFees.join(', ')} 中选择):`);
    console.log(`  Fee: ${bestQuote.fee} (${bestQuote.fee / 10000}%)`);
    console.log(`  输出: ${bestQuote.amountOut.toString()} USDC`);
  } else {
    console.log('没有找到可用的报价');
  }
}

// ==================== 运行所有示例 ====================

async function main() {
  try {
    // 取消注释想要运行的示例
    // await example1_getAllPoolInfo();
    // await example2_getBestFeeByLiquidity();
    // await example3_getBestFeeByQuote();
    // await example4_checkPoolExists();
    // await example5_compareFees();
    // await example6_swapWithBestFee();
    // await example7_compareMultiplePairs();
    // await example8_customFeeTiers();
  } catch (error) {
    console.error('Error:', error);
  }
}

// main();

export {
  example1_getAllPoolInfo,
  example2_getBestFeeByLiquidity,
  example3_getBestFeeByQuote,
  example4_checkPoolExists,
  example5_compareFees,
  example6_swapWithBestFee,
  example7_compareMultiplePairs,
  example8_customFeeTiers,
};
