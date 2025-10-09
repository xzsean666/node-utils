import { ERC20Helper } from '../erc20Helper';

/**
 * ERC20Helper 使用示例
 * 展示如何使用 ERC20Helper 类进行各种 ERC20 操作
 */

async function main() {
  // 初始化 ERC20Helper
  const RPC_URL = 'https://eth-mainnet.g.alchemy.com/v2/YOUR-API-KEY';
  const PRIVATE_KEY = 'your-private-key'; // 用于发送交易
  const BATCH_CALL_ADDRESS = '0xYourBatchCallContractAddress'; // 批量调用合约地址

  const erc20Helper = new ERC20Helper(RPC_URL, {
    privateKey: PRIVATE_KEY,
    batchCallAddress: BATCH_CALL_ADDRESS,
  });

  // USDT 合约地址 (Ethereum mainnet)
  const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
  const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

  // ===== 1. 获取 token 基本信息 =====
  console.log('\n===== 获取 Token 信息 =====');
  try {
    const tokenInfo = await erc20Helper.getTokenInfo(USDT_ADDRESS);
    console.log('Token 信息:', {
      name: tokenInfo.name,
      symbol: tokenInfo.symbol,
      decimals: tokenInfo.decimals,
      totalSupply: tokenInfo.totalSupply.toString(),
      address: tokenInfo.address,
    });
  } catch (error) {
    console.error('获取 token 信息失败:', error);
  }

  // ===== 2. 查询单个地址余额 =====
  console.log('\n===== 查询余额 =====');
  const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
  try {
    const balance = await erc20Helper.balanceOf(USDT_ADDRESS, walletAddress);
    const decimals = await erc20Helper.getDecimals(USDT_ADDRESS);
    const formattedBalance = erc20Helper.formatTokenAmount(balance, decimals);
    console.log(`地址 ${walletAddress} 的 USDT 余额:`, formattedBalance);
  } catch (error) {
    console.error('查询余额失败:', error);
  }

  // ===== 3. 批量查询余额（单个 token，多个地址）=====
  console.log('\n===== 批量查询余额（单个 token）=====');
  const addresses = [
    '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    '0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE',
    '0x28C6c06298d514Db089934071355E5743bf21d60',
  ];

  try {
    const balances = await erc20Helper.batchGetBalances(
      USDT_ADDRESS,
      addresses,
    );
    const decimals = await erc20Helper.getDecimals(USDT_ADDRESS);

    console.log('批量余额查询结果:');
    for (const result of balances) {
      const formatted = erc20Helper.formatTokenAmount(result.balance, decimals);
      console.log(
        `  ${result.address}: ${formatted} USDT (成功: ${result.success})`,
      );
    }
  } catch (error) {
    console.error('批量查询余额失败:', error);
  }

  // ===== 4. 批量查询余额（多个 token，多个地址）=====
  console.log('\n===== 批量查询余额（多个 token）=====');
  const queries = [
    { tokenAddress: USDT_ADDRESS, address: addresses[0] },
    { tokenAddress: USDC_ADDRESS, address: addresses[0] },
    { tokenAddress: USDT_ADDRESS, address: addresses[1] },
    { tokenAddress: USDC_ADDRESS, address: addresses[1] },
  ];

  try {
    const multiTokenBalances =
      await erc20Helper.batchGetBalancesMultipleTokens(queries);

    console.log('多 token 余额查询结果:');
    for (const result of multiTokenBalances) {
      const symbol = result.tokenAddress === USDT_ADDRESS ? 'USDT' : 'USDC';
      const decimals = await erc20Helper.getDecimals(result.tokenAddress);
      const formatted = erc20Helper.formatTokenAmount(result.balance, decimals);
      console.log(
        `  ${result.address.slice(0, 10)}... - ${symbol}: ${formatted}`,
      );
    }
  } catch (error) {
    console.error('多 token 批量查询失败:', error);
  }

  // ===== 5. 批量查询余额（按地址分组）=====
  console.log('\n===== 批量查询余额（分组）=====');
  const tokenAddresses = [USDT_ADDRESS, USDC_ADDRESS];
  const walletAddresses = addresses.slice(0, 2);

  try {
    const groupedBalances = await erc20Helper.batchGetBalancesGrouped(
      tokenAddresses,
      walletAddresses,
    );

    console.log('按地址分组的余额:');
    for (const [address, tokens] of Object.entries(groupedBalances)) {
      console.log(`\n地址: ${address}`);
      for (const token of tokens) {
        const symbol = token.tokenAddress === USDT_ADDRESS ? 'USDT' : 'USDC';
        const decimals = await erc20Helper.getDecimals(token.tokenAddress);
        const formatted = erc20Helper.formatTokenAmount(
          token.balance,
          decimals,
        );
        console.log(`  ${symbol}: ${formatted}`);
      }
    }
  } catch (error) {
    console.error('分组查询失败:', error);
  }

  // ===== 6. 转账示例 =====
  console.log('\n===== 转账示例 =====');
  // 注意: 这是一个示例，实际执行需要有效的私钥和足够的余额
  const transferExample = async () => {
    try {
      const toAddress = '0xReceiverAddress';
      const amount = erc20Helper.parseTokenAmount('10', 6); // 转账 10 USDT (USDT 是 6 位精度)

      const tx = await erc20Helper.transfer(USDT_ADDRESS, toAddress, amount);
      console.log('转账交易哈希:', tx.hash);
    } catch (error) {
      console.error('转账失败:', error);
    }
  };
  console.log('转账示例代码已准备（未执行）');

  // ===== 7. 授权示例 =====
  console.log('\n===== 授权示例 =====');
  const approveExample = async () => {
    try {
      const spenderAddress = '0xSpenderAddress';
      const amount = erc20Helper.parseTokenAmount('100', 6); // 授权 100 USDT

      const tx = await erc20Helper.approve(
        USDT_ADDRESS,
        spenderAddress,
        amount,
      );
      console.log('授权交易哈希:', tx.hash);
    } catch (error) {
      console.error('授权失败:', error);
    }
  };
  console.log('授权示例代码已准备（未执行）');

  // ===== 8. 查询授权额度 =====
  console.log('\n===== 查询授权额度示例 =====');
  const allowanceExample = async () => {
    try {
      const owner = '0xOwnerAddress';
      const spender = '0xSpenderAddress';

      const allowance = await erc20Helper.allowance(
        USDT_ADDRESS,
        owner,
        spender,
      );
      const decimals = await erc20Helper.getDecimals(USDT_ADDRESS);
      const formatted = erc20Helper.formatTokenAmount(allowance, decimals);

      console.log(`授权额度: ${formatted} USDT`);
    } catch (error) {
      console.error('查询授权额度失败:', error);
    }
  };
  console.log('查询授权额度示例代码已准备（未执行）');

  // ===== 9. transferFrom 示例 =====
  console.log('\n===== TransferFrom 示例 =====');
  const transferFromExample = async () => {
    try {
      const fromAddress = '0xFromAddress';
      const toAddress = '0xToAddress';
      const amount = erc20Helper.parseTokenAmount('5', 6); // 转账 5 USDT

      const tx = await erc20Helper.transferFrom(
        USDT_ADDRESS,
        fromAddress,
        toAddress,
        amount,
      );
      console.log('TransferFrom 交易哈希:', tx.hash);
    } catch (error) {
      console.error('TransferFrom 失败:', error);
    }
  };
  console.log('TransferFrom 示例代码已准备（未执行）');

  // ===== 10. 格式化和解析数量 =====
  console.log('\n===== 格式化和解析数量 =====');
  const decimals = 6; // USDT 精度
  const rawAmount = 1000000n; // 1 USDT (原始单位)
  const formatted = erc20Helper.formatTokenAmount(rawAmount, decimals);
  console.log(`原始数量 ${rawAmount} 格式化为: ${formatted}`);

  const parsed = erc20Helper.parseTokenAmount('1.5', decimals);
  console.log(`字符串 "1.5" 解析为原始单位: ${parsed}`);
}

// 运行示例
if (require.main === module) {
  main().catch((error) => {
    console.error('程序执行失败:', error);
    process.exit(1);
  });
}
