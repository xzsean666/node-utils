import { EthersLogHelper } from './ethersLogHelper';

import { PGKVDatabase } from '../dbUtils/KVPostgresql';
import { SqliteKVDatabase } from '../dbUtils/KVSqlite';

import { memoryCache } from '../dbUtils/MemoryCache';

export class EthersLogSyncHelper extends EthersLogHelper {
  private sqlite_path?: string;
  private postgres_path?: string;

  constructor(
    NODE_PROVIDER: string,
    configs?: {
      sqlite_path?: string;
      postgres_path?: string;
    },
  ) {
    super(NODE_PROVIDER);
    this.sqlite_path = configs?.sqlite_path;
    this.postgres_path = configs?.postgres_path;

    if (!configs?.sqlite_path && !configs?.postgres_path) {
      this.sqlite_path = './db/ethersLog.db';
      console.log(
        'sqlite_path is not set, using default path: ',
        this.sqlite_path,
      );
    }
  }
  @memoryCache(60 * 60, 'ethersLogSyncHelper')
  async getChainId() {
    const network = await this.web3.getNetwork();
    return network.chainId;
  }
  @memoryCache(60 * 60, 'ethersLogSyncHelper')
  async getCurrentBlock() {
    const block = await this.web3.getBlockNumber();
    return Number(block);
  }
  async getDB(table: string) {
    if (this.postgres_path) {
      return new PGKVDatabase(this.postgres_path, table);
    }
    if (this.sqlite_path) {
      let sqlitePath = this.sqlite_path;
      // 如果不是以 .db 结尾，则加上 .db
      if (!sqlitePath.endsWith('.db')) {
        sqlitePath = `${sqlitePath}.db`;
      }
      const chain_id = await this.getChainId();
      // 在 path 中加入 chainid，格式为 _chainid.db
      const pathWithChainId = sqlitePath.replace(/(\.db)$/, `_${chain_id}.db`);
      return new SqliteKVDatabase(pathWithChainId, table);
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
    try {
      const metadata = await metadata_db.get(contract_address);
      let effective_start_block = start_block;
      if (metadata && metadata.start_block) {
        effective_start_block = metadata.start_block;
      }
      let nonce = 0;
      if (metadata && metadata.nonce) {
        nonce = metadata.nonce;
      }

      const current_block = await this.getCurrentBlock();
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
    } finally {
      // 确保数据库连接被关闭
      console.log('Closing database connections...');
      try {
        await db.close();
        console.log('Main DB closed');
      } catch (e) {
        console.error('Error closing main DB:', e);
      }
      try {
        await metadata_db.close();
        console.log('Metadata DB closed');
      } catch (e) {
        console.error('Error closing metadata DB:', e);
      }
      console.log('All database connections closed');
    }
  }

  async syncLogsToCurrent(params: {
    contract_address: string;
    abi: any[];
    eventNames?: string | string[];
    start_block?: number;
  }) {
    const { contract_address, abi, eventNames, start_block = 0 } = params;
    const current_block = await this.getCurrentBlock();
    while (true) {
      const result = await this.syncLogs({
        contract_address,
        abi,
        eventNames,
        start_block,
      });
      if (Math.abs(result.to_block - current_block) < 1000) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return true;
  }
}
