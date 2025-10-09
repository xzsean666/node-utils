import { ERC20Helper } from './erc20Helper';

import { ethers } from 'ethers';

export class UniswapHelper extends ERC20Helper {
  private uniswapV2RouterAddress?: string;
  private uniswapV3RouterAddress?: string;
  private uniswapV3QuoterAddress?: string;
  private uniswapV3FactoryAddress?: string;
  private useQuoterV2: boolean = true; // 默认使用 QuoterV2

  constructor(NODE_PROVIDER: string | ethers.BrowserProvider, config?: any) {
    super(NODE_PROVIDER, config);
    this.uniswapV2RouterAddress = config?.uniswapV2RouterAddress;
    this.uniswapV3RouterAddress = config?.uniswapV3RouterAddress;
    this.uniswapV3QuoterAddress = config?.uniswapV3QuoterAddress;
    this.uniswapV3FactoryAddress = config?.uniswapV3FactoryAddress;
    this.useQuoterV2 = config?.useQuoterV2 ?? true;
  }

  /**
   * 设置 Uniswap V2 Router 地址
   */
  setUniswapV2Router(address: string) {
    this.uniswapV2RouterAddress = address;
  }

  /**
   * 设置 Uniswap V3 Router 地址
   */
  setUniswapV3Router(address: string) {
    this.uniswapV3RouterAddress = address;
  }

  /**
   * 设置 Uniswap V3 Quoter 地址
   */
  setUniswapV3Quoter(address: string) {
    this.uniswapV3QuoterAddress = address;
  }

  /**
   * 设置 Uniswap V3 Factory 地址
   */
  setUniswapV3Factory(address: string) {
    this.uniswapV3FactoryAddress = address;
  }

  // ==================== Uniswap V2 Methods ====================

  /**
   * 查询 V2 兑换输出数量
   * @param params 参数对象
   *   - amountIn 输入数量（原始单位）
   *   - path 兑换路径（token 地址数组）
   * @returns 输出数量数组
   */
  async getAmountsOutV2(params: {
    amountIn: bigint | string;
    path: string[];
  }): Promise<bigint[]> {
    if (!this.uniswapV2RouterAddress) {
      throw new Error('Uniswap V2 Router address not set');
    }

    const { amountIn, path } = params;

    const amounts = await this.callReadContract<bigint[]>({
      target: this.uniswapV2RouterAddress,
      abi: UNISWAP_V2_ROUTER_ABI,
      function_name: 'getAmountsOut',
      args: [amountIn, path],
    });

    return amounts;
  }

  /**
   * 查询 V2 兑换输入数量
   * @param params 参数对象
   *   - amountOut 输出数量（原始单位）
   *   - path 兑换路径（token 地址数组）
   * @returns 输入数量数组
   */
  async getAmountsInV2(params: {
    amountOut: bigint | string;
    path: string[];
  }): Promise<bigint[]> {
    if (!this.uniswapV2RouterAddress) {
      throw new Error('Uniswap V2 Router address not set');
    }

    const { amountOut, path } = params;

    const amounts = await this.callReadContract<bigint[]>({
      target: this.uniswapV2RouterAddress,
      abi: UNISWAP_V2_ROUTER_ABI,
      function_name: 'getAmountsIn',
      args: [amountOut, path],
    });

    return amounts;
  }

  /**
   * V2 精确输入数量交换 token
   * @param params 参数对象
   *   - amountIn 输入数量（原始单位）
   *   - amountOutMin 最小输出数量（原始单位）
   *   - path 兑换路径（token 地址数组）
   *   - to 接收地址
   *   - deadline 截止时间（Unix 时间戳）
   * @returns 交易结果
   */
  async swapExactTokensForTokensV2(params: {
    amountIn: bigint | string;
    amountOutMin: bigint | string;
    path: string[];
    to: string;
    deadline?: number;
  }): Promise<any> {
    if (!this.uniswapV2RouterAddress) {
      throw new Error('Uniswap V2 Router address not set');
    }

    const {
      amountIn,
      amountOutMin,
      path,
      to,
      deadline = Math.floor(Date.now() / 1000) + 60 * 20, // 默认 20 分钟
    } = params;

    return await this.callContract({
      target: this.uniswapV2RouterAddress,
      abi: UNISWAP_V2_ROUTER_ABI,
      function_name: 'swapExactTokensForTokens',
      execute_args: [amountIn, amountOutMin, path, to, deadline],
    });
  }

  /**
   * V2 精确 ETH 换 token
   * @param params 参数对象
   *   - amountETH 输入 ETH 数量（单位：ETH，如 "0.1"）
   *   - amountOutMin 最小输出数量（原始单位）
   *   - path 兑换路径（token 地址数组，第一个必须是 WETH）
   *   - to 接收地址
   *   - deadline 截止时间（Unix 时间戳）
   * @returns 交易结果
   */
  async swapExactETHForTokensV2(params: {
    amountETH: string;
    amountOutMin: bigint | string;
    path: string[];
    to: string;
    deadline?: number;
  }): Promise<any> {
    if (!this.uniswapV2RouterAddress) {
      throw new Error('Uniswap V2 Router address not set');
    }

    const {
      amountETH,
      amountOutMin,
      path,
      to,
      deadline = Math.floor(Date.now() / 1000) + 60 * 20,
    } = params;

    return await this.callContract({
      target: this.uniswapV2RouterAddress,
      abi: UNISWAP_V2_ROUTER_ABI,
      function_name: 'swapExactETHForTokens',
      execute_args: [amountOutMin, path, to, deadline],
      value: amountETH,
    });
  }

  /**
   * V2 精确 token 换 ETH
   * @param params 参数对象
   *   - amountIn 输入数量（原始单位）
   *   - amountOutMin 最小输出 ETH 数量（原始单位）
   *   - path 兑换路径（token 地址数组，最后一个必须是 WETH）
   *   - to 接收地址
   *   - deadline 截止时间（Unix 时间戳）
   * @returns 交易结果
   */
  async swapExactTokensForETHV2(params: {
    amountIn: bigint | string;
    amountOutMin: bigint | string;
    path: string[];
    to: string;
    deadline?: number;
  }): Promise<any> {
    if (!this.uniswapV2RouterAddress) {
      throw new Error('Uniswap V2 Router address not set');
    }

    const {
      amountIn,
      amountOutMin,
      path,
      to,
      deadline = Math.floor(Date.now() / 1000) + 60 * 20,
    } = params;

    return await this.callContract({
      target: this.uniswapV2RouterAddress,
      abi: UNISWAP_V2_ROUTER_ABI,
      function_name: 'swapExactTokensForETH',
      execute_args: [amountIn, amountOutMin, path, to, deadline],
    });
  }

  // ==================== Uniswap V3 Methods ====================

  /**
   * V3 查询单笔精确输入的输出数量
   * @param params 参数对象
   *   - tokenIn 输入 token 地址
   *   - tokenOut 输出 token 地址
   *   - fee 手续费等级（500, 3000, 10000）
   *   - amountIn 输入数量（原始单位）
   *   - sqrtPriceLimitX96 价格限制（可选，默认 0）
   * @returns 输出数量
   */
  async quoteExactInputSingleV3(params: {
    tokenIn: string;
    tokenOut: string;
    fee: number;
    amountIn: bigint | string;
    sqrtPriceLimitX96?: bigint;
  }): Promise<bigint> {
    if (!this.uniswapV3QuoterAddress) {
      throw new Error('Uniswap V3 Quoter address not set');
    }

    const { tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96 = 0n } = params;

    if (this.useQuoterV2) {
      // QuoterV2 使用 struct 参数和多返回值，需要用 staticCall
      const result = await this.callStaticContract<any[]>({
        target: this.uniswapV3QuoterAddress,
        abi: UNISWAP_V3_QUOTER_V2_ABI,
        function_name: 'quoteExactInputSingle',
        args: [
          {
            tokenIn,
            tokenOut,
            amountIn,
            fee,
            sqrtPriceLimitX96,
          },
        ],
      });
      // QuoterV2 返回 (amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate)
      return result[0] as bigint;
    } else {
      // QuoterV1 使用分散参数和单返回值，也需要用 staticCall
      const amountOut = await this.callStaticContract<bigint>({
        target: this.uniswapV3QuoterAddress,
        abi: UNISWAP_V3_QUOTER_ABI,
        function_name: 'quoteExactInputSingle',
        args: [tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96],
      });

      return amountOut;
    }
  }

  /**
   * V3 查询单笔精确输出的输入数量
   * @param params 参数对象
   *   - tokenIn 输入 token 地址
   *   - tokenOut 输出 token 地址
   *   - fee 手续费等级（500, 3000, 10000）
   *   - amountOut 输出数量（原始单位）
   *   - sqrtPriceLimitX96 价格限制（可选，默认 0）
   * @returns 输入数量
   */
  async quoteExactOutputSingleV3(params: {
    tokenIn: string;
    tokenOut: string;
    fee: number;
    amountOut: bigint | string;
    sqrtPriceLimitX96?: bigint;
  }): Promise<bigint> {
    if (!this.uniswapV3QuoterAddress) {
      throw new Error('Uniswap V3 Quoter address not set');
    }

    const {
      tokenIn,
      tokenOut,
      fee,
      amountOut,
      sqrtPriceLimitX96 = 0n,
    } = params;

    if (this.useQuoterV2) {
      // QuoterV2 使用 struct 参数和多返回值，需要用 staticCall
      const result = await this.callStaticContract<any[]>({
        target: this.uniswapV3QuoterAddress,
        abi: UNISWAP_V3_QUOTER_V2_ABI,
        function_name: 'quoteExactOutputSingle',
        args: [
          {
            tokenIn,
            tokenOut,
            amount: amountOut,
            fee,
            sqrtPriceLimitX96,
          },
        ],
      });
      // QuoterV2 返回 (amountIn, sqrtPriceX96After, initializedTicksCrossed, gasEstimate)
      return result[0] as bigint;
    } else {
      // QuoterV1 使用分散参数和单返回值，也需要用 staticCall
      const amountIn = await this.callStaticContract<bigint>({
        target: this.uniswapV3QuoterAddress,
        abi: UNISWAP_V3_QUOTER_ABI,
        function_name: 'quoteExactOutputSingle',
        args: [tokenIn, tokenOut, fee, amountOut, sqrtPriceLimitX96],
      });

      return amountIn;
    }
  }

  /**
   * V3 执行单笔精确输入的 swap
   * @param params 参数对象
   *   - tokenIn 输入 token 地址
   *   - tokenOut 输出 token 地址
   *   - fee 手续费等级（500, 3000, 10000）
   *   - recipient 接收地址
   *   - deadline 截止时间（Unix 时间戳）
   *   - amountIn 输入数量（原始单位）
   *   - amountOutMinimum 最小输出数量（原始单位）
   *   - sqrtPriceLimitX96 价格限制（可选，默认 0）
   * @returns 交易结果
   */
  async exactInputSingleV3(params: {
    tokenIn: string;
    tokenOut: string;
    fee: number;
    recipient: string;
    deadline?: number;
    amountIn: bigint | string;
    amountOutMinimum: bigint | string;
    sqrtPriceLimitX96?: bigint;
  }): Promise<any> {
    if (!this.uniswapV3RouterAddress) {
      throw new Error('Uniswap V3 Router address not set');
    }

    const {
      tokenIn,
      tokenOut,
      fee,
      recipient,
      deadline = Math.floor(Date.now() / 1000) + 60 * 20,
      amountIn,
      amountOutMinimum,
      sqrtPriceLimitX96 = 0n,
    } = params;

    const exactInputSingleParams = {
      tokenIn,
      tokenOut,
      fee,
      recipient,
      deadline,
      amountIn,
      amountOutMinimum,
      sqrtPriceLimitX96,
    };

    return await this.callContract({
      target: this.uniswapV3RouterAddress,
      abi: UNISWAP_V3_ROUTER_ABI,
      function_name: 'exactInputSingle',
      execute_args: [exactInputSingleParams],
    });
  }

  /**
   * V3 执行单笔精确输出的 swap
   * @param params 参数对象
   *   - tokenIn 输入 token 地址
   *   - tokenOut 输出 token 地址
   *   - fee 手续费等级（500, 3000, 10000）
   *   - recipient 接收地址
   *   - deadline 截止时间（Unix 时间戳）
   *   - amountOut 输出数量（原始单位）
   *   - amountInMaximum 最大输入数量（原始单位）
   *   - sqrtPriceLimitX96 价格限制（可选，默认 0）
   * @returns 交易结果
   */
  async exactOutputSingleV3(params: {
    tokenIn: string;
    tokenOut: string;
    fee: number;
    recipient: string;
    deadline?: number;
    amountOut: bigint | string;
    amountInMaximum: bigint | string;
    sqrtPriceLimitX96?: bigint;
  }): Promise<any> {
    if (!this.uniswapV3RouterAddress) {
      throw new Error('Uniswap V3 Router address not set');
    }

    const {
      tokenIn,
      tokenOut,
      fee,
      recipient,
      deadline = Math.floor(Date.now() / 1000) + 60 * 20,
      amountOut,
      amountInMaximum,
      sqrtPriceLimitX96 = 0n,
    } = params;

    const exactOutputSingleParams = {
      tokenIn,
      tokenOut,
      fee,
      recipient,
      deadline,
      amountOut,
      amountInMaximum,
      sqrtPriceLimitX96,
    };

    return await this.callContract({
      target: this.uniswapV3RouterAddress,
      abi: UNISWAP_V3_ROUTER_ABI,
      function_name: 'exactOutputSingle',
      execute_args: [exactOutputSingleParams],
    });
  }

  /**
   * V3 执行多路径精确输入的 swap
   * @param params 参数对象
   *   - path 编码后的路径
   *   - recipient 接收地址
   *   - deadline 截止时间（Unix 时间戳）
   *   - amountIn 输入数量（原始单位）
   *   - amountOutMinimum 最小输出数量（原始单位）
   * @returns 交易结果
   */
  async exactInputV3(params: {
    path: string;
    recipient: string;
    deadline?: number;
    amountIn: bigint | string;
    amountOutMinimum: bigint | string;
  }): Promise<any> {
    if (!this.uniswapV3RouterAddress) {
      throw new Error('Uniswap V3 Router address not set');
    }

    const {
      path,
      recipient,
      deadline = Math.floor(Date.now() / 1000) + 60 * 20,
      amountIn,
      amountOutMinimum,
    } = params;

    const exactInputParams = {
      path,
      recipient,
      deadline,
      amountIn,
      amountOutMinimum,
    };

    return await this.callContract({
      target: this.uniswapV3RouterAddress,
      abi: UNISWAP_V3_ROUTER_ABI,
      function_name: 'exactInput',
      execute_args: [exactInputParams],
    });
  }

  /**
   * 编码 V3 多路径
   * @param tokens token 地址数组
   * @param fees 手续费数组
   * @returns 编码后的路径
   */
  encodePathV3(tokens: string[], fees: number[]): string {
    if (tokens.length !== fees.length + 1) {
      throw new Error('Invalid path: tokens.length must be fees.length + 1');
    }

    let path = '0x';
    for (let i = 0; i < fees.length; i++) {
      path += tokens[i].slice(2); // 去掉 '0x'
      path += fees[i].toString(16).padStart(6, '0'); // fee 3 bytes
    }
    path += tokens[tokens.length - 1].slice(2);

    return path;
  }

  // ==================== 工具方法 ====================

  /**
   * 计算滑点保护的最小输出数量
   * @param amountOut 预期输出数量
   * @param slippagePercent 滑点百分比（如 0.5 表示 0.5%）
   * @returns 最小输出数量
   */
  calculateMinAmountOut(amountOut: bigint, slippagePercent: number): bigint {
    const slippage = BigInt(Math.floor(slippagePercent * 100));
    return (amountOut * (10000n - slippage)) / 10000n;
  }

  /**
   * 计算滑点保护的最大输入数量
   * @param amountIn 预期输入数量
   * @param slippagePercent 滑点百分比（如 0.5 表示 0.5%）
   * @returns 最大输入数量
   */
  calculateMaxAmountIn(amountIn: bigint, slippagePercent: number): bigint {
    const slippage = BigInt(Math.floor(slippagePercent * 100));
    return (amountIn * (10000n + slippage)) / 10000n;
  }

  // ==================== V3 Fee 辅助方法 ====================

  /**
   * 获取 V3 池子地址
   * @param tokenA token A 地址
   * @param tokenB token B 地址
   * @param fee 手续费等级
   * @returns 池子地址，如果不存在返回 zero address
   */
  async getV3PoolAddress(
    tokenA: string,
    tokenB: string,
    fee: number,
  ): Promise<string> {
    if (!this.uniswapV3FactoryAddress) {
      throw new Error('Uniswap V3 Factory address not set');
    }

    const poolAddress = await this.callReadContract<string>({
      target: this.uniswapV3FactoryAddress,
      abi: UNISWAP_V3_FACTORY_ABI,
      function_name: 'getPool',
      args: [tokenA, tokenB, fee],
    });

    return poolAddress;
  }

  /**
   * 检查 V3 池子是否存在
   * @param tokenA token A 地址
   * @param tokenB token B 地址
   * @param fee 手续费等级
   * @returns 池子是否存在
   */
  async isV3PoolExists(
    tokenA: string,
    tokenB: string,
    fee: number,
  ): Promise<boolean> {
    const poolAddress = await this.getV3PoolAddress(tokenA, tokenB, fee);
    return poolAddress !== ethers.ZeroAddress;
  }

  /**
   * 获取 V3 池子的流动性
   * @param poolAddress 池子地址
   * @returns 流动性数量
   */
  async getV3PoolLiquidity(poolAddress: string): Promise<bigint> {
    try {
      const liquidity = await this.callReadContract<bigint>({
        target: poolAddress,
        abi: UNISWAP_V3_POOL_ABI,
        function_name: 'liquidity',
        args: [],
      });
      return liquidity;
    } catch (error) {
      return 0n;
    }
  }

  /**
   * 获取所有可用的 fee tier 及其池子信息
   * @param tokenA token A 地址
   * @param tokenB token B 地址
   * @param fees 要检查的 fee tier 数组，默认 [500, 3000, 10000]
   * @returns 所有可用 fee tier 的信息数组
   */
  async getAllV3PoolInfo(
    tokenA: string,
    tokenB: string,
    fees: number[] = [500, 3000, 10000],
  ): Promise<
    Array<{
      fee: number;
      poolAddress: string;
      exists: boolean;
      liquidity: bigint;
    }>
  > {
    if (!this.uniswapV3FactoryAddress) {
      throw new Error('Uniswap V3 Factory address not set');
    }

    // 如果没有 batchCallAddress，使用传统方式
    if (!this.batchCallAddress) {
      const results = await Promise.all(
        fees.map(async (fee) => {
          const poolAddress = await this.getV3PoolAddress(tokenA, tokenB, fee);
          const exists = poolAddress !== ethers.ZeroAddress;
          const liquidity = exists
            ? await this.getV3PoolLiquidity(poolAddress)
            : 0n;

          return {
            fee,
            poolAddress,
            exists,
            liquidity,
          };
        }),
      );
      return results;
    }

    // 使用 batchCall 优化：先批量获取所有池子地址
    const poolAddressCalls = fees.map((fee) => ({
      target: this.uniswapV3FactoryAddress!,
      data: this.encodeDataByABI({
        abi: UNISWAP_V3_FACTORY_ABI,
        function_name: 'getPool',
        execute_args: [tokenA, tokenB, fee],
        target: this.uniswapV3FactoryAddress!,
      }).data,
      abi: UNISWAP_V3_FACTORY_ABI,
      function_name: 'getPool',
      executeArgs: [tokenA, tokenB, fee],
    }));

    const poolAddressResults = await this.batchStaticCall(poolAddressCalls);

    // 过滤出存在的池子并批量获取流动性
    const existingPools = poolAddressResults
      .map((result, index) => ({
        fee: fees[index],
        poolAddress: result.success
          ? (result.decodedData[0] as string)
          : ethers.ZeroAddress,
        exists:
          result.success &&
          result.decodedData[0] !== ethers.ZeroAddress &&
          result.decodedData[0] !==
            '0x0000000000000000000000000000000000000000',
      }))
      .filter((pool) => pool.exists);

    // 如果没有存在的池子，直接返回
    if (existingPools.length === 0) {
      return fees.map((fee, index) => ({
        fee,
        poolAddress: poolAddressResults[index].success
          ? (poolAddressResults[index].decodedData[0] as string)
          : ethers.ZeroAddress,
        exists: false,
        liquidity: 0n,
      }));
    }

    // 批量获取流动性
    const liquidityCalls = existingPools.map((pool) => ({
      target: pool.poolAddress,
      data: this.encodeDataByABI({
        abi: UNISWAP_V3_POOL_ABI,
        function_name: 'liquidity',
        execute_args: [],
        target: pool.poolAddress,
      }).data,
      abi: UNISWAP_V3_POOL_ABI,
      function_name: 'liquidity',
      executeArgs: [],
    }));

    const liquidityResults = await this.batchStaticCall(liquidityCalls);

    // 构建流动性映射
    const liquidityMap = new Map<string, bigint>();
    existingPools.forEach((pool, index) => {
      const liquidity = liquidityResults[index].success
        ? (liquidityResults[index].decodedData[0] as bigint)
        : 0n;
      liquidityMap.set(pool.poolAddress.toLowerCase(), liquidity);
    });

    // 合并结果
    return fees.map((fee, index) => {
      const poolAddress = poolAddressResults[index].success
        ? (poolAddressResults[index].decodedData[0] as string)
        : ethers.ZeroAddress;
      const exists =
        poolAddress !== ethers.ZeroAddress &&
        poolAddress !== '0x0000000000000000000000000000000000000000';

      return {
        fee,
        poolAddress,
        exists,
        liquidity: exists
          ? liquidityMap.get(poolAddress.toLowerCase()) || 0n
          : 0n,
      };
    });
  }

  /**
   * 自动选择最佳的 fee tier（流动性最大的）
   * @param tokenA token A 地址
   * @param tokenB token B 地址
   * @param fees 要检查的 fee tier 数组，默认 [500, 3000, 10000]
   * @returns 最佳的 fee tier 及其信息
   */
  async getBestV3Fee(
    tokenA: string,
    tokenB: string,
    fees: number[] = [1, 50, 100, 500, 3000, 5000, 10000],
  ): Promise<{
    fee: number;
    poolAddress: string;
    liquidity: bigint;
  } | null> {
    const poolInfos = await this.getAllV3PoolInfo(tokenA, tokenB, fees);

    // 过滤出存在的池子
    const existingPools = poolInfos.filter((info) => info.exists);

    if (existingPools.length === 0) {
      return null;
    }

    // 找到流动性最大的池子
    const bestPool = existingPools.reduce((best, current) =>
      current.liquidity > best.liquidity ? current : best,
    );

    return {
      fee: bestPool.fee,
      poolAddress: bestPool.poolAddress,
      liquidity: bestPool.liquidity,
    };
  }

  /**
   * 使用最佳 fee 查询 V3 兑换输出数量
   * @param tokenIn 输入 token 地址
   * @param tokenOut 输出 token 地址
   * @param amountIn 输入数量（原始单位）
   * @param fees 要检查的 fee tier 数组，默认 [500, 3000, 10000]
   * @returns 最佳 fee 及输出数量
   */
  async quoteV3WithBestFee(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint | string;
    fees?: number[];
  }): Promise<{
    fee: number;
    amountOut: bigint;
    poolAddress: string;
    liquidity: bigint;
  } | null> {
    const {
      tokenIn,
      tokenOut,
      amountIn,
      fees = [1, 50, 100, 500, 3000, 5000, 10000],
    } = params;

    // 获取所有池子信息
    const poolInfos = await this.getAllV3PoolInfo(tokenIn, tokenOut, fees);
    const existingPools = poolInfos.filter((info) => info.exists);

    if (existingPools.length === 0) {
      return null;
    }

    // 对每个存在的池子进行报价
    const quotes = await Promise.all(
      existingPools.map(async (poolInfo) => {
        try {
          const amountOut = await this.quoteExactInputSingleV3({
            tokenIn,
            tokenOut,
            fee: poolInfo.fee,
            amountIn,
          });
          return {
            fee: poolInfo.fee,
            amountOut,
            poolAddress: poolInfo.poolAddress,
            liquidity: poolInfo.liquidity,
            success: true,
          };
        } catch (error) {
          return {
            fee: poolInfo.fee,
            amountOut: 0n,
            poolAddress: poolInfo.poolAddress,
            liquidity: poolInfo.liquidity,
            success: false,
          };
        }
      }),
    );

    // 过滤出成功的报价并找到输出最大的
    const successfulQuotes = quotes.filter(
      (q) => q.success && q.amountOut > 0n,
    );

    if (successfulQuotes.length === 0) {
      return null;
    }

    const bestQuote = successfulQuotes.reduce((best, current) =>
      current.amountOut > best.amountOut ? current : best,
    );

    return {
      fee: bestQuote.fee,
      amountOut: bestQuote.amountOut,
      poolAddress: bestQuote.poolAddress,
      liquidity: bestQuote.liquidity,
    };
  }
}

// ==================== ABI Definitions ====================

export const UNISWAP_V2_ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
  'function getAmountsIn(uint amountOut, address[] memory path) public view returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapTokensForExactETH(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapETHForExactTokens(uint amountOut, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
];

export const UNISWAP_V3_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountIn)',
  'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)',
  'function exactOutput((bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum)) external payable returns (uint256 amountIn)',
];

// Uniswap V3 Quoter V1 ABI
export const UNISWAP_V3_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut)',
  'function quoteExactOutputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountOut, uint160 sqrtPriceLimitX96) external view returns (uint256 amountIn)',
  'function quoteExactInput(bytes memory path, uint256 amountIn) external view returns (uint256 amountOut)',
  'function quoteExactOutput(bytes memory path, uint256 amountOut) external view returns (uint256 amountIn)',
];

// Uniswap V3 Quoter V2 ABI (returns multiple values)
export const UNISWAP_V3_QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactInput(bytes memory path, uint256 amountIn) external returns (uint256 amountOut, uint160[] memory sqrtPriceX96AfterList, uint32[] memory initializedTicksCrossedList, uint256 gasEstimate)',
  'function quoteExactOutput(bytes memory path, uint256 amountOut) external returns (uint256 amountIn, uint160[] memory sqrtPriceX96AfterList, uint32[] memory initializedTicksCrossedList, uint256 gasEstimate)',
];

export const UNISWAP_V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

export const UNISWAP_V3_POOL_ABI = [
  'function liquidity() external view returns (uint128)',
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
];
