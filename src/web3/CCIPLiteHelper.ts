import { ethers } from 'ethers';
import { EthersLogHelper } from './ethersLogHelper';
import IEVM2EVMOnRamp from '../web3config/abis/IEVM2EVMOnRamp.json';
import IRouterClientABI from '../web3config/abis/IRouterClient.json';

interface TokenAmount {
  token?: string;
  amount?: string | bigint;
}

interface MessageParams {
  receiver: string;
  data: string;
  token?: string;
  amount?: string | bigint;
  feeToken?: string;
  gasLimit?: number;
}

interface CCIPMessage {
  receiver: string;
  data: string;
  tokenAmounts: TokenAmount[];
  feeToken: string;
  extraArgs: string;
}

export class CCIPLiteHelper extends EthersLogHelper {
  private private_key?: string;
  private wallet?: ethers.Wallet;

  constructor(rpc_url: string, private_key?: string) {
    super(rpc_url);
    this.private_key = private_key;
    if (private_key) {
      this.wallet = new ethers.Wallet(private_key, this.web3);
    }
  }

  /**
   * 获取合约实例
   */
  getContract(contract_address: string, abi: any[]) {
    if (this.wallet) {
      return new ethers.Contract(contract_address, abi, this.wallet);
    }
    return new ethers.Contract(contract_address, abi, this.web3);
  }

  /**
   * 发送交易
   */
  async sendTransaction(call_data: any) {
    if (!this.wallet) {
      throw new Error('Private key is required for sending transactions');
    }
    const tx_result = await this.wallet.sendTransaction(call_data);
    return tx_result;
  }

  /**
   * 编码调用数据
   */
  encodeDataByABI(params: {
    abi: any[];
    functionName: string;
    executeArgs: any[];
    target: string;
    value?: string | bigint;
  }) {
    const { abi, functionName, executeArgs, target, value } = params;
    const contract_interface = new ethers.Interface(abi);
    const encoded_data = contract_interface.encodeFunctionData(
      functionName,
      executeArgs,
    );

    return {
      to: target,
      data: encoded_data,
      value: value || '0',
    };
  }

  /**
   * 获取最新区块号
   */
  async getLatestBlockNumber(): Promise<number> {
    return await this.web3.getBlockNumber();
  }

  /**
   * 获取调用数据
   */
  async getCallData(
    source_router_address: string,
    destination_chain_selector: string,
    message: CCIPMessage,
  ): Promise<any> {
    const use_native = message.feeToken === ethers.ZeroAddress;

    const fee = await this.getFee(
      source_router_address,
      destination_chain_selector,
      message,
    );
    const call_data = this.encodeDataByABI({
      abi: IRouterClientABI,
      functionName: 'ccipSend',
      executeArgs: [destination_chain_selector, message],
      target: source_router_address,
      value: use_native ? fee : '0',
    });
    return call_data;
  }

  /**
   * 获取跨链手续费
   */
  async getFee(
    source_router_address: string,
    destination_chain_selector: string,
    message: CCIPMessage,
  ): Promise<string> {
    const router_contract = this.getContract(
      source_router_address,
      IRouterClientABI,
    );
    const fees = await router_contract.getFee(
      destination_chain_selector,
      message,
    );
    return fees.toString();
  }

  /**
   * 创建CCIP消息
   */
  createMessage(params: MessageParams): CCIPMessage {
    if (!params.receiver) {
      throw new Error('Receiver address is required');
    }

    // Encode the receiver address using abi.encode
    const abi_coder = new ethers.AbiCoder();
    const formatted_receiver = abi_coder.encode(
      ['address'],
      [ethers.getAddress(params.receiver)],
    );

    // Only add tokenAmount if token or amount is provided
    const token_amounts: TokenAmount[] = [];
    if (params.token || params.amount) {
      let formatted_token = ethers.ZeroAddress;
      if (params.token) {
        try {
          formatted_token = ethers.getAddress(params.token);
        } catch (error) {
          throw new Error('Invalid token address format');
        }
      }

      token_amounts.push({
        token: formatted_token,
        amount: BigInt(params.amount || '0'),
      });
    }

    return {
      receiver: formatted_receiver,
      data: params.data || '0x',
      tokenAmounts: token_amounts,
      feeToken: params.feeToken
        ? ethers.getAddress(params.feeToken)
        : ethers.ZeroAddress,
      extraArgs: '0x',
    };
  }

  /**
   * 创建额外参数
   */
  createExtraArgs(gas_limit: number): string {
    const abi_coder = new ethers.AbiCoder();
    // bytes4(keccak256("CCIP EVMExtraArgsV1")) = 0x97a657c9
    const EVM_EXTRA_ARGS_V1_TAG = '0x97a657c9';
    const encoded_args = abi_coder.encode(
      ['tuple(uint256)'], // EVMExtraArgsV1 结构体
      [[BigInt(gas_limit)]], // 只需要 gasLimit 参数
    );
    return EVM_EXTRA_ARGS_V1_TAG + encoded_args.slice(2);
  }

  /**
   * 通过交易哈希获取消息ID
   */
  async getMessageId(tx_hash: string) {
    const all_logs = await this.getLogByTxHash(tx_hash, IEVM2EVMOnRamp);
    const receipt = await this.web3.getTransactionReceipt(tx_hash);
    const log = all_logs.find(
      (log) =>
        (log as ethers.LogDescription)?.topic ===
        '0xd0c3c799bf9e2639de44391e7f524d229b2b55f5b1ea94b2bf7da42f7243dddd',
    );
    const message_id = (log as ethers.LogDescription)?.args[0].at(-1);
    const result = {
      messageId: message_id,
      blockNumber: Number(receipt?.blockNumber) || 0,
    };
    return result;
  }

  /**
   * 获取地址的CCIP发送状态
   */
  async getAddressCCIPsendStatus({
    from_address,
    to_address,
    source_router_address,
    destination_chain_selector,
    blocks_to_search = 1000,
  }: {
    from_address?: string;
    to_address?: string;
    source_router_address: string;
    destination_chain_selector: string;
    blocks_to_search?: number;
  }) {
    // 输入参数验证 - 只验证必填地址
    const addresses = [source_router_address];
    if (from_address) addresses.push(from_address);
    if (to_address) addresses.push(to_address);

    if (!addresses.every((addr) => ethers.isAddress(addr))) {
      throw new Error('Invalid address provided');
    }
    if (!destination_chain_selector) {
      throw new Error('Invalid destination chain selector');
    }

    // 获取 onRamp 地址
    const router_contract = this.getContract(
      source_router_address,
      IRouterClientABI,
    );

    const on_ramp = await router_contract
      .getOnRamp(destination_chain_selector)
      .catch(() => {
        throw new Error('Failed to fetch onRamp address');
      });

    if (!on_ramp) {
      throw new Error('OnRamp not found for the specified chain');
    }

    // 获取区块范围
    const latest_block = await this.getLatestBlockNumber();
    const from_block = Math.max(0, latest_block - blocks_to_search);

    // 获取并过滤日志
    const logs = await this.getContractLogs({
      contract_addresses: on_ramp,
      event_names: ['CCIPSendRequested'],
      abi: IEVM2EVMOnRamp,
      filter: {
        fromBlock: from_block,
        toBlock: latest_block,
      },
    });

    // 处理匹配的交易
    const matching_transactions = logs
      .filter((log: any) => {
        const message = log.args[0];
        const from_match =
          !from_address ||
          message.sender.toLowerCase() === from_address.toLowerCase();
        const to_match =
          !to_address ||
          message.receiver.toLowerCase() === to_address.toLowerCase();
        return from_match && to_match;
      })
      .map((log: any) => {
        const message = log.args[0];
        return {
          messageId: message.messageId,
          sender: message.sender,
          receiver: message.receiver,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          tokenAmounts: message.tokenAmounts,
          data: message.data,
          fees: {
            feeToken: message.feeToken,
            feeAmount: message.feeTokenAmount,
          },
        };
      });

    return matching_transactions;
  }

  /**
   * 获取转账状态
   */
  async getTransferStatus(
    message_id: string,
    destination_router_address: string,
    source_chain_selector: string,
    blocks_to_search = 1000,
  ) {
    // 验证目标路由地址
    if (!ethers.isAddress(destination_router_address)) {
      throw new Error(
        '参数错误: 目标路由地址 ' +
          String(destination_router_address) +
          ' 无效',
      );
    }

    // 验证消息ID
    if (!ethers.isHexString(message_id, 32)) {
      throw new Error('参数错误: ' + message_id + ' 不是有效的消息ID');
    }

    // 验证源链选择器
    if (!source_chain_selector) {
      throw new Error('参数错误: 源链选择器缺失或无效');
    }

    // 获取所有的OffRamps
    const router_contract = this.getContract(
      destination_router_address,
      IRouterClientABI,
    );

    let off_ramps;
    try {
      off_ramps = await router_contract.getOffRamps();
    } catch (error: unknown) {
      console.log('获取 OffRamps 失败:', error);
      console.log('Router 地址:', destination_router_address);
      const error_string =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        '合约调用错误: 无法获取 off-ramps 信息 (' + error_string + ')',
      );
    }

    if (!off_ramps || off_ramps.length === 0) {
      throw new Error('合约调用错误: 未找到任何 off-ramps');
    }
    // 过滤匹配的OffRamps
    const matching_off_ramps = off_ramps
      .filter(
        (off_ramp: any) => off_ramp[0].toString() === source_chain_selector,
      )
      .map((off_ramp) => ({
        sourceChainSelector: off_ramp[0].toString(),
        offRamp: off_ramp[1],
      }));

    if (matching_off_ramps.length === 0) {
      throw new Error('合约调用错误: 未找到匹配的off-ramp');
    }

    // 获取起始区块
    const latest_block = await this.getLatestBlockNumber();
    const from_block = Math.max(0, latest_block - blocks_to_search);
    const status: any = {
      state: 'UNTOUCHED',
    };
    // 检查每个OffRamp的状态
    for (const off_ramp of matching_off_ramps) {
      const logs = (
        await this.web3.getLogs({
          address: off_ramp.offRamp,
          topics: [
            ethers.id('ExecutionStateChanged(uint64,bytes32,uint8,bytes)'),
            null,
            ethers.zeroPadValue(message_id, 32),
          ],
          fromBlock: from_block,
        })
      ).reverse();

      if (logs && logs.length > 0) {
        const iface = new ethers.Interface([
          'event ExecutionStateChanged(uint64 indexed sequenceNumber, bytes32 indexed messageId, uint8 state, bytes returnData)',
        ]);
        const parsed_log = iface.parseLog(logs[0]);
        status.blockNumber = logs[0].blockNumber;
        status.messageId = parsed_log?.args[1];
        status.transactionHash = logs[0].transactionHash;
        if (parsed_log?.args) {
          const state = Number(parsed_log.args[2]);
          switch (state) {
            case 0:
              return status;
            case 1:
              status.state = 'IN_PROGRESS';
              return status;
            case 2:
              status.state = 'SUCCESS';
              return status;
            case 3:
              status.state = 'FAILURE';
              return status;
            default:
              status.state = 'UNKNOWN';
              return status;
          }
        }
      }
    }
    return status; // 默认状态
  }
}
