import { ethers } from 'ethers';

export class EthersTxHelper {
  web3!: ethers.JsonRpcProvider | ethers.BrowserProvider;
  NODE_PROVIDER?: string | ethers.BrowserProvider | ethers.JsonRpcProvider;
  private private_key?: string;

  constructor(NODE_PROVIDER: string | ethers.BrowserProvider | ethers.JsonRpcProvider, config?: any) {
    this.NODE_PROVIDER = NODE_PROVIDER;
    this.private_key = config?.private_key;

    if (typeof NODE_PROVIDER == 'string') {
      this.web3 = new ethers.JsonRpcProvider(NODE_PROVIDER);
    } else if (NODE_PROVIDER instanceof ethers.BrowserProvider || NODE_PROVIDER instanceof ethers.JsonRpcProvider) {
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
      let signer: ethers.Signer;
      if (this.private_key) {
        signer = new ethers.Wallet(this.private_key, this.web3);
      } else if (this.web3 instanceof ethers.BrowserProvider) {
        signer = await this.web3.getSigner();
      } else {
        throw new Error('未提供可用的 Signer (需要 private_key 或 BrowserProvider)');
      }

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
  // 解返回的数据
  decodeResultDataByABI(params: {
    abi: any[];
    function_name: string;
    data: string;
  }) {
    const { abi, function_name, data } = params;
    const iface = new ethers.Interface(abi);
    const decoded_data = iface.decodeFunctionResult(function_name, data);
    return decoded_data;
  }

  // 解输入的 Data Payload
  decodeInputDataByABI(params: {
    abi: any[];
    data: string;
  }) {
    const { abi, data } = params;
    const iface = new ethers.Interface(abi);
    return iface.parseTransaction({ data });
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
    waitConfirm?: boolean;
  }) {
    const { abi, function_name, execute_args, target, value, waitConfirm } = params;
    const data = this.encodeDataByABI({
      abi: abi,
      function_name,
      execute_args,
      target,
      value,
    });
    const tx_result = await this.sendTransaction({
      ...data,
      waitConfirm,
    });
    return tx_result;
  }

  async callReadContract<T = unknown>(opts: {
    target: string;
    abi: any[];
    function_name: string;
    execute_args?: unknown[];
    blockTag?: number | bigint | 'latest';
  }): Promise<T> {
    const { target, abi, function_name, execute_args = [], blockTag } = opts;
    const contract = new ethers.Contract(target, abi, this.web3);

    try {
      const fn = contract.getFunction(function_name);
      if (blockTag !== undefined) {
        return (await fn(...execute_args, { blockTag })) as T;
      } else {
        return (await fn(...execute_args)) as T;
      }
    } catch (error: any) {
      throw new Error(
        `读取合约失败 (${function_name}): ${error?.message || String(error)}`
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
        `静态调用合约失败 (${function_name}): ${error?.message || String(error)}`
      );
    }
  }

  private async sendWithBrowserProvider(
    to: string,
    data?: string,
    value: string = '0',
    waitConfirm: boolean = false,
  ): Promise<ethers.TransactionResponse | ethers.TransactionReceipt> {
    if (!this.web3 || !(this.web3 instanceof ethers.BrowserProvider)) {
      throw new Error('未找到有效的BrowserProvider');
    }

    try {
      const signer = await this.web3.getSigner();

      const tx = {
        to,
        data: this.normalizeHexData(data),
        value: this.normalizeValue(value),
      };

      const tx_response = await signer.sendTransaction(tx);

      if (waitConfirm) {
        const receipt = await tx_response.wait();
        if (!receipt) {
          throw new Error('交易未被确认');
        }
        return receipt;
      }

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
    waitConfirm: boolean = false,
  ): Promise<ethers.TransactionResponse | ethers.TransactionReceipt> {
    if (!this.private_key) {
      throw new Error('Private key is required');
    }
    const signer = new ethers.Wallet(this.private_key, this.web3);
    const tx_response = await signer.sendTransaction({
      to,
      data: this.normalizeHexData(data),
      value: this.normalizeValue(value),
    });

    if (waitConfirm) {
      const receipt = await tx_response.wait();
      if (!receipt) return tx_response;
      return receipt;
    }

    return tx_response;
  }

  async sendTransaction(call: {
    target: string;
    data?: string;
    value?: string;
    abi?: any[];
    functionName?: string;
    executeArgs?: any[];
    waitConfirm?: boolean;
  }): Promise<ethers.TransactionResponse | ethers.TransactionReceipt> {
    if (!this.web3) {
      throw new Error('未找到有效的Provider');
    }

    try {
      if (this.private_key) {
        return await this.sendWithPrivateKey(
          call.target,
          call.data,
          call.value || '0',
          call.waitConfirm,
        );
      } else if (this.web3 instanceof ethers.BrowserProvider) {
        return await this.sendWithBrowserProvider(
          call.target,
          call.data,
          call.value || '0',
          call.waitConfirm,
        );
      } else {
        throw new Error('未找到有效的Provider (需要 private_key 或者是 BrowserProvider)');
      }
    } catch (error: any) {
      throw new Error(`发送交易失败: ${error.message}`);
    }
  }
}
