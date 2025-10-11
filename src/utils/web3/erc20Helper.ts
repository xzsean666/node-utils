import { EthersTxBatchHelper } from './ethersTxBatchHelper';

import { ethers } from 'ethers';

export class ERC20Helper extends EthersTxBatchHelper {
  constructor(NODE_PROVIDER: string | ethers.BrowserProvider, config?: any) {
    super(NODE_PROVIDER, config);
  }

  /**
   * 获取 token 名称
   * @param token_address token 地址
   * @returns token 名称
   */
  async getName(token_address: string): Promise<string> {
    return await this.callReadContract<string>({
      target: token_address,
      abi: ERC20_ABI,
      function_name: 'name',
      args: [],
    });
  }

  /**
   * 获取 token 符号
   * @param token_address token 地址
   * @returns token 符号
   */
  async getSymbol(token_address: string): Promise<string> {
    return await this.callReadContract<string>({
      target: token_address,
      abi: ERC20_ABI,
      function_name: 'symbol',
      args: [],
    });
  }

  /**
   * 获取 token 精度
   * @param token_address token 地址
   * @returns token 精度
   */
  async getDecimals(token_address: string): Promise<number> {
    return await this.callReadContract<number>({
      target: token_address,
      abi: ERC20_ABI,
      function_name: 'decimals',
      args: [],
    });
  }

  /**
   * 获取 token 总供应量
   * @param token_address token 地址
   * @returns token 总供应量
   */
  async getTotalSupply(token_address: string): Promise<bigint> {
    return await this.callReadContract<bigint>({
      target: token_address,
      abi: ERC20_ABI,
      function_name: 'totalSupply',
      args: [],
    });
  }

  /**
   * 获取 token 信息
   * @param token_address token 地址
   * @returns token 信息对象
   */
  async getTokenInfo(token_address: string): Promise<{
    name: string;
    symbol: string;
    decimals: number;
    total_supply: bigint;
    address: string;
  }> {
    const [name, symbol, decimals, total_supply] = await Promise.all([
      this.getName(token_address),
      this.getSymbol(token_address),
      this.getDecimals(token_address),
      this.getTotalSupply(token_address),
    ]);

    return {
      name,
      symbol,
      decimals,
      total_supply,
      address: token_address,
    };
  }

  /**
   * 获取地址的 token 余额
   * @param params 参数对象
   *   - token_address token 地址
   *   - wallet_address 钱包地址
   *   - block_number 区块号（可选）
   * @returns token 余额
   */
  async balanceOf(params: {
    token_address: string;
    wallet_address: string;
    block_number?: number;
  }): Promise<bigint> {
    const { token_address, wallet_address, block_number } = params;
    return await this.callReadContract<bigint>({
      target: token_address,
      abi: ERC20_ABI,
      function_name: 'balanceOf',
      args: [wallet_address],
      blockTag: block_number,
    });
  }

  /**
   * 转账 token
   * @param params 参数对象
   *   - token_address token 地址
   *   - to 接收地址
   *   - amount 转账数量（原始单位）
   * @returns 交易结果
   */
  async transfer(params: {
    token_address: string;
    to: string;
    amount: bigint | string;
  }): Promise<any> {
    const { token_address, to, amount } = params;
    return await this.callContract({
      target: token_address,
      abi: ERC20_ABI,
      function_name: 'transfer',
      execute_args: [to, amount],
    });
  }

  /**
   * 授权 token
   * @param params 参数对象
   *   - token_address token 地址
   *   - spender 被授权地址
   *   - amount 授权数量（原始单位）
   * @returns 交易结果
   */
  async approve(params: {
    token_address: string;
    spender: string;
    amount: bigint | string;
  }): Promise<any> {
    const { token_address, spender, amount } = params;
    return await this.callContract({
      target: token_address,
      abi: ERC20_ABI,
      function_name: 'approve',
      execute_args: [spender, amount],
    });
  }

  /**
   * 查询授权额度
   * @param token_address token 地址
   * @param owner 授权者地址
   * @param spender 被授权者地址
   * @returns 授权额度
   */
  async allowance(params: {
    token_address: string;
    owner: string;
    spender: string;
    block_number?: number;
  }): Promise<bigint> {
    const { token_address, owner, spender, block_number } = params;
    return await this.callReadContract<bigint>({
      target: token_address,
      abi: ERC20_ABI,
      function_name: 'allowance',
      args: [owner, spender],
      blockTag: block_number,
    });
  }

  /**
   * 从授权地址转账 token
   */
  async transferFrom(params: {
    token_address: string;
    from: string;
    to: string;
    amount: bigint | string;
  }): Promise<any> {
    return await this.callContract({
      target: params.token_address,
      abi: ERC20_ABI,
      function_name: 'transferFrom',
      execute_args: [params.from, params.to, params.amount],
    });
  }

  /**
   * 批量查询余额（单个 token，多个地址）
   */
  async batchGetBalances(params: {
    token_address: string;
    addresses: string[];
    block_number?: number;
    batch_limit?: number;
  }): Promise<
    Array<{
      address: string;
      balance: bigint;
      success: boolean;
    }>
  > {
    const {
      token_address,
      addresses,
      block_number,
      batch_limit = 200,
    } = params;

    // 构建批量调用参数
    const calls = addresses.map((address) => ({
      target: token_address,
      data: this.encodeDataByABI({
        abi: ERC20_ABI,
        function_name: 'balanceOf',
        execute_args: [address],
        target: token_address,
      }).data,
      abi: ERC20_ABI,
      function_name: 'balanceOf',
      execute_args: [address],
    }));

    // 执行批量调用
    const results = await this.batchStaticCall(
      calls,
      block_number,
      batch_limit,
    );

    // 格式化返回结果
    return results.map((result, index) => ({
      address: addresses[index],
      balance: result.success ? (result.decodedData[0] as bigint) : 0n,
      success: result.success,
    }));
  }

  /**
   * 批量查询余额（多个 token，多个地址）
   */
  async batchGetBalancesMultipleTokens(params: {
    queries: Array<{ token_address: string; address: string }>;
    block_number?: number;
    batch_limit?: number;
  }): Promise<
    Array<{
      token_address: string;
      address: string;
      balance: bigint;
      success: boolean;
    }>
  > {
    const { queries, block_number, batch_limit = 200 } = params;

    // 构建批量调用参数
    const calls = queries.map((query) => ({
      target: query.token_address,
      data: this.encodeDataByABI({
        abi: ERC20_ABI,
        function_name: 'balanceOf',
        execute_args: [query.address],
        target: query.token_address,
      }).data,
      abi: ERC20_ABI,
      function_name: 'balanceOf',
      execute_args: [query.address],
    }));

    // 执行批量调用
    const results = await this.batchStaticCall(
      calls,
      block_number,
      batch_limit,
    );

    // 格式化返回结果
    return results.map((result, index) => ({
      token_address: queries[index].token_address,
      address: queries[index].address,
      balance: result.success ? (result.decodedData[0] as bigint) : 0n,
      success: result.success,
    }));
  }

  /**
   * 批量查询多个地址在多个 token 的完整余额信息
   */
  async batchGetBalancesGrouped(params: {
    token_addresses: string[];
    wallet_addresses: string[];
    block_number?: number;
    batch_limit?: number;
  }): Promise<
    Record<
      string,
      Array<{
        token_address: string;
        balance: bigint;
        success: boolean;
      }>
    >
  > {
    const {
      token_addresses,
      wallet_addresses,
      block_number,
      batch_limit = 200,
    } = params;

    // 构建所有查询组合
    const queries: Array<{ token_address: string; address: string }> = [];
    for (const wallet_address of wallet_addresses) {
      for (const token_address of token_addresses) {
        queries.push({ token_address, address: wallet_address });
      }
    }

    // 批量查询
    const results = await this.batchGetBalancesMultipleTokens({
      queries,
      block_number,
      batch_limit,
    });

    // 按钱包地址分组
    const grouped: Record<
      string,
      Array<{
        token_address: string;
        balance: bigint;
        success: boolean;
      }>
    > = {};

    for (const result of results) {
      if (!grouped[result.address]) {
        grouped[result.address] = [];
      }
      grouped[result.address].push({
        token_address: result.token_address,
        balance: result.balance,
        success: result.success,
      });
    }

    return grouped;
  }

  /**
   * 格式化 token 数量（从原始单位转换为可读格式）
   * @param amount 原始数量
   * @param decimals token 精度
   * @returns 格式化后的字符串
   */
  formatTokenAmount(amount: bigint, decimals: number): string {
    return ethers.formatUnits(amount, decimals);
  }

  /**
   * 解析 token 数量（从可读格式转换为原始单位）
   * @param amount 可读数量
   * @param decimals token 精度
   * @returns 原始数量
   */
  parseTokenAmount(amount: string, decimals: number): bigint {
    return ethers.parseUnits(amount, decimals);
  }
}

export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
];
