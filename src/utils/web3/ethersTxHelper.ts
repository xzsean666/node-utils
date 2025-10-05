import { ethers } from 'ethers';

export class EthersTxHelper {
  web3!: ethers.JsonRpcProvider | ethers.BrowserProvider;
  NODE_PROVIDER?: string | ethers.BrowserProvider;
  private privateKey?: string;

  constructor(NODE_PROVIDER: string | ethers.BrowserProvider, config?: any) {
    this.NODE_PROVIDER = NODE_PROVIDER;
    this.privateKey = config?.privateKey;

    if (typeof NODE_PROVIDER == 'string') {
      this.web3 = new ethers.JsonRpcProvider(NODE_PROVIDER);
    } else if (NODE_PROVIDER instanceof ethers.BrowserProvider) {
      this.web3 = NODE_PROVIDER;
    } else {
      throw new Error('Invalid NODE_PROVIDER type');
    }
  }

  private normalizeHexData(data?: string): string | undefined {
    if (!data) return undefined;
    return data.startsWith('0x') ? data : '0x' + data;
  }

  private normalizeValue(value?: string): bigint | string {
    if (!value || value === '0') return '0x0';
    if (value.startsWith('0x')) return value;
    return ethers.parseEther(value);
  }
  public async deployContract(abi: any[], bytecode: string): Promise<any> {
    try {
      const signer = new ethers.Wallet(this.privateKey || '', this.web3);
      const factory = new ethers.ContractFactory(abi, bytecode, signer);
      const contract = await factory.deploy();
      await contract.waitForDeployment();
      console.log(`合约已部署到: ${await contract.getAddress()}`);
      return contract;
    } catch (error: any) {
      throw new Error(`部署合约失败: ${error.message}`);
    }
  }

  encodeDataByABI(params: {
    abi: any[];
    function_name: string;
    execute_args: any[];
    target: string;
    value?: string;
  }) {
    const iface = new ethers.Interface(params.abi);
    // Encode the function call
    const data = iface.encodeFunctionData(
      params.function_name,
      params.execute_args,
    );
    return {
      target: params.target,
      data,
      abi: params.abi,
      function_name: params.function_name,
      execute_args: params.execute_args,
      value: params.value,
    };
  }
  decodeDataByABI(params: { abi: any[]; function_name: string; data: string }) {
    const { abi, function_name, data } = params;
    const iface = new ethers.Interface(abi);
    // 解返回数据
    const decodedData = iface.decodeFunctionResult(function_name, data);
    return decodedData;
  }

  decodeResultDataByABI(params: {
    abi: any[];
    function_name: string;
    data: string;
  }) {
    const { abi, function_name, data } = params;
    const iface = new ethers.Interface(abi);
    // 解返回数据
    const decodedData = iface.decodeFunctionResult(function_name, data);
    return decodedData;
  }
  async sendEther(to_address: string, amount: string) {
    return await this.sendTransaction({
      target: to_address,
      value: amount,
    });
  }

  async callContract(params: {
    target: string;
    function_name: string;
    abi: any[];
    execute_args: any[];
    value?: string;
  }) {
    const { abi, function_name, execute_args, target, value } = params;
    const data = this.encodeDataByABI({
      abi: abi,
      function_name,
      execute_args,
      target,
      value,
    });
    const txResult = await this.sendTransaction(data);
    return txResult;
  }

  async callReadContract<T = unknown>(opts: {
    target: string;
    abi: any[];
    function_name: string;
    args?: unknown[];
    blockTag?: number | bigint | 'latest';
  }): Promise<T> {
    const { target, abi, function_name, args = [], blockTag } = opts;
    const contract = new ethers.Contract(target, abi, this.web3);

    try {
      const fn = contract.getFunction(function_name);
      const options = blockTag !== undefined ? { blockTag } : undefined;
      return (await fn(...args, options)) as T;
    } catch (error: any) {
      throw new Error(
        '读取合约失败 (' +
          function_name +
          '): ' +
          (error && (error.message || String(error))),
      );
    }
  }
  async callStaticContract<T = unknown>(opts: {
    target: string;
    abi: any[];
    function_name: string;
    args?: unknown[];
  }): Promise<T> {
    const { target, abi, function_name, args = [] } = opts;
    try {
      const contract = new ethers.Contract(target, abi, this.web3);
      const fn = contract.getFunction(function_name);
      return (await fn.staticCall(...args)) as T;
    } catch (error: any) {
      throw new Error(
        '静态调用合约失败 (' +
          function_name +
          '): ' +
          (error && (error.message || String(error))),
      );
    }
  }

  private async sendWithBrowserProvider(
    to: string,
    data?: string,
    value: string = '0',
  ): Promise<ethers.TransactionResponse> {
    if (!this.web3 || !(this.web3 instanceof ethers.BrowserProvider)) {
      throw new Error('未找到有效的BrowserProvider');
    }

    try {
      // 获取签名者
      const signer = await this.web3.getSigner();

      // 构建交易对象
      const tx = {
        to,
        data: this.normalizeHexData(data),
        value: this.normalizeValue(value),
      };

      // 发送交易
      const tx_response = await signer.sendTransaction(tx);

      // 等待交易被确认
      const receipt = await tx_response.wait();

      if (!receipt) {
        throw new Error('交易未被确认');
      }

      // 返回交易哈希
      return tx_response;
    } catch (error: any) {
      console.error('发送交易失败:', error);
      throw new Error(`发送交易失败: ${error.message}`);
    }
  }

  private async sendWithPrivateKey(
    to: string,
    data?: string,
    value: string = '0',
  ): Promise<ethers.TransactionResponse> {
    if (!this.privateKey) {
      throw new Error('Private key is required');
    }
    const signer = new ethers.Wallet(this.privateKey, this.web3);
    const tx_response = await signer.sendTransaction({
      to,
      data: this.normalizeHexData(data),
      value: this.normalizeValue(value),
    });

    await tx_response.wait();
    return tx_response;
  }

  async sendTransaction(call: {
    target: string;
    data?: string;
    value?: string;
    abi?: any[];
    functionName?: string;
    executeArgs?: any[];
  }): Promise<ethers.TransactionResponse> {
    if (!this.web3) {
      throw new Error('未找到有效的Provider');
    }

    try {
      let tx_response: ethers.TransactionResponse;
      // 保留原有的 Provider 判断逻辑
      if (this.privateKey && this.web3 instanceof ethers.JsonRpcProvider) {
        tx_response = await this.sendWithPrivateKey(
          call.target,
          call.data,
          call.value || '0',
        );
      } else if (this.web3 instanceof ethers.BrowserProvider) {
        tx_response = await this.sendWithBrowserProvider(
          call.target,
          call.data,
          call.value || '0',
        );
      } else {
        throw new Error('未找到有效的Provider');
      }
      return tx_response;
    } catch (error: any) {
      throw new Error(`发送交易失败: ${error.message}`);
    }
  }
}
