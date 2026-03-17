import { EthersUtils, ethers } from './ethersUtilsV2';
import { KVDatabase } from '../db/PGKVDatabase';
import IEVM2EVMOnRamp from './abis/IEVM2EVMOnRamp.json';
import IEVM2EVMOffRamp from './abis/IEVM2EVMOffRamp.json';

export class CCIPHelper {
  private onRampDB: KVDatabase;
  private offRampDB: KVDatabase;
  private ethersUtils: EthersUtils;
  config: any;
  constructor(config: any) {
    this.config = config;
    this.onRampDB = new KVDatabase(config.db.url, config.db.prefix + '_onramp');
    this.offRampDB = new KVDatabase(
      config.db.url,
      config.db.prefix + '_offramp',
    );
    this.ethersUtils = new EthersUtils(config.rpcUrl);
  }
  async getMessageId(txHash: string) {
    const alllogs = await this.ethersUtils.getLogByTxHash(
      txHash,
      IEVM2EVMOnRamp,
    );
    const log = alllogs.find(
      (log) =>
        (log as ethers.LogDescription)?.topic ===
        '0xd0c3c799bf9e2639de44391e7f524d229b2b55f5b1ea94b2bf7da42f7243dddd',
    );
    const messageId = (log as ethers.LogDescription)?.args[0].at(-1);
    return messageId;
  }

  async getOnRampDBLogs(
    fromBlock: number = 0,
    toBlock: number | string = 'latest',
  ) {
    const logs = await this.ethersUtils.getContractLogs(
      this.config.onRampAddress,
      ['CCIPSendRequested'],
      IEVM2EVMOnRamp,
      {
        fromBlock: fromBlock,
        toBlock: toBlock,
      },
    );
    return logs;
  }
  async getOffRampDBLogs(
    fromBlock: number = 0,
    toBlock: number | string = 'latest',
  ) {
    const logs = await this.ethersUtils.getContractLogs(
      this.config.offRampAddress,
      ['ExecutionStateChanged'],
      IEVM2EVMOffRamp,
      {
        fromBlock: fromBlock,
        toBlock: toBlock,
      },
    );
    return logs;
  }
}
