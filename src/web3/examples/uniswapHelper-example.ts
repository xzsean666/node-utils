import { UniswapHelper } from '../uniswapHelper';

/**
 * UniswapHelper 使用示例
 */

// ==================== 初始化 ====================

// 方法 1: 在构造函数中配置
const uniswapHelper1 = new UniswapHelper(
  'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
  {
    privateKey: 'YOUR_PRIVATE_KEY', // 可选，仅执行交易时需要
    uniswapV2RouterAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 Router
    uniswapV3RouterAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3 Router
    uniswapV3QuoterAddress: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6', // Uniswap V3 Quoter
    batchCallAddress: '0xYOUR_BATCH_CALL_CONTRACT', // 如果需要批量调用
  },
);

// 方法 2: 动态设置地址
const uniswapHelper2 = new UniswapHelper(
  'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
);
uniswapHelper2.setUniswapV2Router('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D');
uniswapHelper2.setUniswapV3Router('0xE592427A0AEce92De3Edee1F18E0157C05861564');
uniswapHelper2.setUniswapV3Quoter('0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6');

// ==================== Uniswap V2 示例 ====================

async function examplesV2() {
  const helper = uniswapHelper1;

  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

  // 1. 查询兑换输出数量
  console.log('=== V2: 查询兑换输出数量 ===');
  const amountsOut = await helper.getAmountsOutV2({
    amountIn: '1000000000000000000', // 1 WETH
    path: [WETH, USDC],
  });
  console.log(
    '输入 1 WETH，可以换出:',
    amountsOut[1].toString(),
    'USDC (最小单位)',
  );

  // 2. 查询兑换输入数量
  console.log('\n=== V2: 查询兑换输入数量 ===');
  const amountsIn = await helper.getAmountsInV2({
    amountOut: '1000000000', // 1000 USDC (6 decimals)
    path: [WETH, USDC],
  });
  console.log(
    '换出 1000 USDC，需要输入:',
    amountsIn[0].toString(),
    'WETH (最小单位)',
  );

  // 3. 计算滑点保护
  console.log('\n=== V2: 计算滑点保护 ===');
  const expectedOut = amountsOut[1];
  const minAmountOut = helper.calculateMinAmountOut(expectedOut, 0.5); // 0.5% 滑点
  console.log('预期输出:', expectedOut.toString());
  console.log('最小输出 (0.5% 滑点):', minAmountOut.toString());

  // 4. 执行 token 换 token (需要先 approve)
  console.log('\n=== V2: Token 换 Token ===');
  try {
    // 先授权 Router 使用你的 WETH
    await helper.approve({
      token_address: WETH,
      spender: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // V2 Router
      amount: '1000000000000000000', // 1 WETH
    });

    // 执行 swap
    const swapResult = await helper.swapExactTokensForTokensV2({
      amountIn: '1000000000000000000', // 1 WETH
      amountOutMin: minAmountOut, // 使用滑点保护
      path: [WETH, USDC],
      to: '0xYourWalletAddress',
      deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 分钟后过期
    });
    console.log('Swap 交易哈希:', swapResult.hash);
  } catch (error) {
    console.error('Swap 失败:', error);
  }

  // 5. ETH 换 Token
  console.log('\n=== V2: ETH 换 Token ===');
  try {
    const ethSwapResult = await helper.swapExactETHForTokensV2({
      amountETH: '0.1', // 0.1 ETH
      amountOutMin: minAmountOut,
      path: [WETH, USDC],
      to: '0xYourWalletAddress',
    });
    console.log('ETH Swap 交易哈希:', ethSwapResult.hash);
  } catch (error) {
    console.error('ETH Swap 失败:', error);
  }

  // 6. Token 换 ETH
  console.log('\n=== V2: Token 换 ETH ===');
  try {
    const tokenToEthResult = await helper.swapExactTokensForETHV2({
      amountIn: '1000000000', // 1000 USDC
      amountOutMin: '100000000000000000', // 至少 0.1 ETH
      path: [USDC, WETH],
      to: '0xYourWalletAddress',
    });
    console.log('Token 换 ETH 交易哈希:', tokenToEthResult.hash);
  } catch (error) {
    console.error('Token 换 ETH 失败:', error);
  }

  // 7. 多跳路径 (USDC -> WETH -> DAI)
  console.log('\n=== V2: 多跳路径 ===');
  const multiHopAmounts = await helper.getAmountsOutV2({
    amountIn: '1000000000', // 1000 USDC
    path: [USDC, WETH, DAI],
  });
  console.log('1000 USDC -> WETH -> DAI:');
  console.log('  中间 WETH:', multiHopAmounts[1].toString());
  console.log('  最终 DAI:', multiHopAmounts[2].toString());
}

// ==================== Uniswap V3 示例 ====================

async function examplesV3() {
  const helper = uniswapHelper1;

  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

  // V3 手续费等级
  const FEE_LOW = 500; // 0.05%
  const FEE_MEDIUM = 3000; // 0.3%
  const FEE_HIGH = 10000; // 1%

  // 1. 查询单笔精确输入的输出数量
  console.log('=== V3: 查询输出数量 ===');
  const amountOut = await helper.quoteExactInputSingleV3({
    tokenIn: WETH,
    tokenOut: USDC,
    fee: FEE_MEDIUM, // 0.3% 手续费池
    amountIn: '1000000000000000000', // 1 WETH
    sqrtPriceLimitX96: 0n, // 不限制价格
  });
  console.log(
    '输入 1 WETH，可以换出:',
    amountOut.toString(),
    'USDC (最小单位)',
  );

  // 2. 查询单笔精确输出的输入数量
  console.log('\n=== V3: 查询输入数量 ===');
  const amountIn = await helper.quoteExactOutputSingleV3({
    tokenIn: WETH,
    tokenOut: USDC,
    fee: FEE_MEDIUM,
    amountOut: '1000000000', // 1000 USDC
  });
  console.log(
    '换出 1000 USDC，需要输入:',
    amountIn.toString(),
    'WETH (最小单位)',
  );

  // 3. 执行单笔精确输入的 swap
  console.log('\n=== V3: 执行 Swap (精确输入) ===');
  try {
    // 先授权
    await helper.approve({
      token_address: WETH,
      spender: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // V3 Router
      amount: '1000000000000000000',
    });

    const minAmountOut = helper.calculateMinAmountOut(amountOut, 0.5); // 0.5% 滑点

    const swapResult = await helper.exactInputSingleV3({
      tokenIn: WETH,
      tokenOut: USDC,
      fee: FEE_MEDIUM,
      recipient: '0xYourWalletAddress',
      amountIn: '1000000000000000000', // 1 WETH
      amountOutMinimum: minAmountOut,
      sqrtPriceLimitX96: 0n,
    });
    console.log('Swap 交易哈希:', swapResult.hash);
  } catch (error) {
    console.error('Swap 失败:', error);
  }

  // 4. 执行单笔精确输出的 swap
  console.log('\n=== V3: 执行 Swap (精确输出) ===');
  try {
    const maxAmountIn = helper.calculateMaxAmountIn(amountIn, 0.5); // 0.5% 滑点

    const swapResult = await helper.exactOutputSingleV3({
      tokenIn: WETH,
      tokenOut: USDC,
      fee: FEE_MEDIUM,
      recipient: '0xYourWalletAddress',
      amountOut: '1000000000', // 精确换出 1000 USDC
      amountInMaximum: maxAmountIn,
      sqrtPriceLimitX96: 0n,
    });
    console.log('Swap 交易哈希:', swapResult.hash);
  } catch (error) {
    console.error('Swap 失败:', error);
  }

  // 5. 多路径 swap (USDC -> WETH -> DAI)
  console.log('\n=== V3: 多路径 Swap ===');
  try {
    // 编码路径
    const encodedPath = helper.encodePathV3(
      [USDC, WETH, DAI],
      [FEE_MEDIUM, FEE_MEDIUM], // 每一跳的手续费
    );
    console.log('编码后的路径:', encodedPath);

    const multiPathResult = await helper.exactInputV3({
      path: encodedPath,
      recipient: '0xYourWalletAddress',
      amountIn: '1000000000', // 1000 USDC
      amountOutMinimum: '900000000000000000', // 至少 0.9 DAI
    });
    console.log('多路径 Swap 交易哈希:', multiPathResult.hash);
  } catch (error) {
    console.error('多路径 Swap 失败:', error);
  }
}

// ==================== 结合 ERC20Helper 的完整工作流 ====================

async function completeWorkflow() {
  const helper = uniswapHelper1;

  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const myAddress = '0xYourWalletAddress';

  console.log('=== 完整工作流示例 ===');

  // 1. 查询 token 信息
  const wethInfo = await helper.getTokenInfo(WETH);
  const usdcInfo = await helper.getTokenInfo(USDC);
  console.log('WETH 信息:', wethInfo);
  console.log('USDC 信息:', usdcInfo);

  // 2. 查询当前余额
  const wethBalance = await helper.balanceOf({
    token_address: WETH,
    wallet_address: myAddress,
  });
  console.log(
    '当前 WETH 余额:',
    helper.formatTokenAmount(wethBalance, wethInfo.decimals),
    'WETH',
  );

  // 3. 查询兑换报价
  const swapAmount = helper.parseTokenAmount('1.0', wethInfo.decimals); // 1 WETH
  const amountsOut = await helper.getAmountsOutV2({
    amountIn: swapAmount,
    path: [WETH, USDC],
  });
  const expectedUSDC = amountsOut[1];
  console.log(
    '1 WETH 可以换出:',
    helper.formatTokenAmount(expectedUSDC, usdcInfo.decimals),
    'USDC',
  );

  // 4. 检查授权额度
  const allowance = await helper.allowance({
    token_address: WETH,
    owner: myAddress,
    spender: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // V2 Router
  });
  console.log(
    '当前授权额度:',
    helper.formatTokenAmount(allowance, wethInfo.decimals),
    'WETH',
  );

  // 5. 如果授权不足，进行授权
  if (allowance < swapAmount) {
    console.log('授权额度不足，正在授权...');
    const approveResult = await helper.approve({
      token_address: WETH,
      spender: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      amount: ethers.MaxUint256, // 授权最大值
    });
    console.log('授权交易哈希:', approveResult.hash);
    await approveResult.wait(); // 等待交易确认
  }

  // 6. 执行 swap
  const minAmountOut = helper.calculateMinAmountOut(expectedUSDC, 0.5); // 0.5% 滑点
  console.log(
    '最小接受输出:',
    helper.formatTokenAmount(minAmountOut, usdcInfo.decimals),
    'USDC',
  );

  const swapResult = await helper.swapExactTokensForTokensV2({
    amountIn: swapAmount,
    amountOutMin: minAmountOut,
    path: [WETH, USDC],
    to: myAddress,
  });
  console.log('Swap 交易哈希:', swapResult.hash);

  // 7. 等待交易确认
  const receipt = await swapResult.wait();
  console.log('交易已确认，区块号:', receipt.blockNumber);

  // 8. 查询新的余额
  const newUSDCBalance = await helper.balanceOf({
    token_address: USDC,
    wallet_address: myAddress,
  });
  console.log(
    '新的 USDC 余额:',
    helper.formatTokenAmount(newUSDCBalance, usdcInfo.decimals),
    'USDC',
  );
}

// ==================== 运行示例 ====================

async function main() {
  try {
    // await examplesV2();
    // await examplesV3();
    // await completeWorkflow();
  } catch (error) {
    console.error('Error:', error);
  }
}

// main();

export { examplesV2, examplesV3, completeWorkflow };
