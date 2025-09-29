import { EthersLogHelper } from './ethersLogHelper';

import { PGKVDatabase } from '../dbUtils/KVPostgresql';
import { SqliteKVDatabase } from '../dbUtils/KVSqlite';

export class EthersLogSyncHelper extends EthersLogHelper {
  private sqlite_path?: string;
  private postgres_path?: string;

  constructor(
    NODE_PROVIDER: string,
    configs: {
      sqlite_path?: string;
      postgres_path?: string;
    },
  ) {
    super(NODE_PROVIDER);
    if (!configs.sqlite_path && !configs.postgres_path) {
      throw new Error('sqlite_path or postgres_path is required');
    }
    this.sqlite_path = configs.sqlite_path;
    this.postgres_path = configs.postgres_path;
  }
  async getDB(table: string) {
    if (this.postgres_path) {
      return new PGKVDatabase(this.postgres_path, table);
    }
    if (this.sqlite_path) {
      return new SqliteKVDatabase(this.sqlite_path, table);
    }
    throw new Error('database is not initialized');
  }

  async getContractDB(contract_address: string) {
    const metadata_db = await this.getDB('metadata');
    const db = await this.getDB(contract_address);
    return {
      db,
      metadata_db,
    };
  }
  async syncLogs(params: {
    contract_address: string;
    abi: any[];
    eventNames?: string | string[];
    start_block?: number;
  }) {
    const { contract_address, abi, eventNames, start_block = 0 } = params;

    const { db, metadata_db } = await this.getContractDB(contract_address);
    const metadata = await metadata_db.get(contract_address);
    let effective_start_block = start_block;
    if (metadata && metadata.start_block) {
      effective_start_block = metadata.start_block;
    }
    let nonce = 0;
    if (metadata && metadata.nonce) {
      nonce = metadata.nonce;
    }

    const current_block = await this.web3.getBlockNumber();
    const max_block = 100000;
    let to_block = current_block;
    if (current_block - effective_start_block > max_block) {
      to_block = effective_start_block + max_block;
    } else {
      to_block = current_block;
    }

    // 获取日志
    const logs = await this.getContractLogs({
      contractAddresses: contract_address,
      eventNames,
      abi,
      filter: {
        fromBlock: effective_start_block,
        toBlock: to_block,
      },
    });

    // 存储每个日志
    for (const log of logs) {
      const key = `${log.blockNumber}_${nonce}`;
      await db.put(key, log);
      nonce++;
    }

    // 更新metadata
    await metadata_db.put(contract_address, {
      start_block: to_block + 1,
      nonce: nonce,
      last_sync: Date.now(),
    });

    return {
      synced_logs: logs.length,
      from_block: effective_start_block,
      to_block: to_block,
      next_nonce: nonce,
    };
  }
}
