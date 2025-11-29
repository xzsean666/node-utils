import { EthersLogHelper } from './ethersLogHelper';

import { PGKVDatabase } from '../dbUtils/KVPostgresql';
import { SqliteKVDatabase } from '../dbUtils/KVSqlite';

import { memoryCache } from '../dbUtils/MemoryCache';

export class EthersLogSyncHelper extends EthersLogHelper {
  private sqlite_path?: string;
  private postgres_path?: string;

  constructor(
    node_provider: string,
    configs?: {
      sqlite_path?: string;
      postgres_path?: string;
    },
  ) {
    super(node_provider);
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
      let sqlite_path = this.sqlite_path;
      // 如果不是以 .db 结尾，则加上 .db
      if (!sqlite_path.endsWith('.db')) {
        sqlite_path = `${sqlite_path}.db`;
      }
      const chain_id = await this.getChainId();
      // 在 path 中加入 chainid，格式为 _chainid.db
      const path_with_chain_id = sqlite_path.replace(
        /(\.db)$/,
        `_${chain_id}.db`,
      );
      return new SqliteKVDatabase(path_with_chain_id, table);
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
    event_name?: string | string[];
    start_block?: number;
    filter?: any;
    key_generator?: (log: any, nonce: number) => string;
  }) {
    const {
      contract_address,
      abi,
      event_name,
      start_block = 0,
      filter,
      key_generator,
    } = params;

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
        contract_addresses: contract_address,
        event_names: event_name,
        abi,
        filter: {
          fromBlock: effective_start_block,
          toBlock: to_block,
          ...filter,
        },
      });

      // 存储每个日志
      for (const log of logs) {
        let key: string;
        if (key_generator) {
          // 使用自定义的key生成器
          key = key_generator(log, nonce);
        } else {
          // 使用默认的key生成逻辑
          const log_name = 'name' in log ? log.name : 'unknown';
          key = `${log_name}_${log.blockNumber}_${nonce}`;
        }
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
        logs,
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
    event_name?: string | string[];
    start_block?: number;
    key_generator?: (log: any, nonce: number) => string;
  }) {
    const {
      contract_address,
      abi,
      event_name,
      start_block = 0,
      key_generator,
    } = params;
    const current_block = await this.getCurrentBlock();
    while (true) {
      const result = await this.syncLogs({
        contract_address,
        abi,
        event_name,
        start_block,
        key_generator,
      });
      if (Math.abs(result.to_block - current_block) < 1000) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return true;
  }

  async getRecentLogs(params: {
    contract_address: string;
    event_name?: string;
    block_range?: number;
  }) {
    const { contract_address, event_name, block_range } = params;
    const { db, metadata_db } = await this.getContractDB(contract_address);
    const metadata = await metadata_db.get(contract_address);
    const to_block = metadata?.start_block || 0;
    const start_block = to_block - (block_range || 10000);

    const logs = await this.getLogs({
      contract_address,
      event_name,
      start_block,
      to_block,
    });
    return logs;
  }
  async getAllLogs(params: {
    contract_address: string;
    event_name?: string;
    start_block?: number;
    limit?: number;
    offset?: number;
  }) {
    const { contract_address, event_name, limit, offset } = params;
    const { db, metadata_db } = await this.getContractDB(contract_address);
    const metadata = await metadata_db.get(contract_address);
    const to_block = metadata?.start_block;
    if (!to_block) {
      return [];
    }
    const logs = await db.getWithPrefix(event_name ? `${event_name}_` : '', {
      limit,
      offset,
    });
    return logs;
  }

  async getLogs(params: {
    contract_address: string;
    event_name?: string;
    start_block?: number;
    to_block?: number;
    limit?: number;
    offset?: number;
    args?: any[];
  }) {
    const {
      contract_address,
      event_name,
      start_block = 0,
      to_block = 0,
      limit,
      offset,
      args,
    } = params;

    const { db } = await this.getContractDB(contract_address);

    try {
      // 构建基础前缀，格式: eventName_
      const base_prefix = event_name ? `${event_name}_` : '';

      // 如果没有指定区块范围，使用基础前缀查询所有
      if (start_block === 0 && to_block === 0) {
        const all_logs = await db.getWithPrefix(base_prefix, {
          limit,
          offset,
        });

        // 如果传了 args 参数，需要过滤
        let filtered_logs = all_logs;
        if (args && args.length > 0) {
          filtered_logs = all_logs.filter(({ value }) => {
            const log = value;
            return args.every((arg) => log.args.includes(arg));
          });
        }

        return {
          logs: filtered_logs.map(({ value }) => value),
          total_count: filtered_logs.length,
          contract_address,
          event_name,
          start_block,
          to_block,
          limit,
          offset,
        };
      }

      // 计算共同前缀
      // 例如：10231000 到 10235000，共同前缀是 1023
      const common_prefix = this.findCommonPrefix(start_block, to_block);
      const key_prefix = `${base_prefix}${common_prefix}`;

      // 使用计算出的前缀查询
      const logs = await db.getWithPrefix(key_prefix, {
        limit,
        offset,
      });

      // 过滤出在指定范围内的日志
      const filtered_logs = logs.filter(({ value }) => {
        const log = value;
        const block_number = log.blockNumber || log.block_number;

        // 首先检查 block_number 是否在范围内
        const in_block_range =
          block_number >= start_block && block_number <= to_block;

        // 如果不在 block_number 范围内，直接返回 false
        if (!in_block_range) {
          return false;
        }

        // 如果在 block_number 范围内，再检查 args 参数
        if (args && args.length > 0) {
          return args.every((arg) => log.args.includes(arg));
        }

        // 如果没有 args 参数，只要在 block_number 范围内就返回 true
        return true;
      });

      return {
        logs: filtered_logs.map(({ value }) => value),
        total_count: filtered_logs.length,
        contract_address,
        event_name,
        start_block,
        to_block,
        limit,
        offset,
      };
    } finally {
      // 确保数据库连接被关闭
      try {
        await db.close();
      } catch (e) {
        console.error('Error closing database connections:', e);
      }
    }
  }

  // 找到两个区块号的共同前缀
  // 例如：10231000 和 10235000 的共同前缀是 1023
  private findCommonPrefix(start_block: number, to_block: number): string {
    const start_str = start_block.toString();
    const end_str = to_block.toString();

    let common_length = 0;
    const min_length = Math.min(start_str.length, end_str.length);

    for (let i = 0; i < min_length; i++) {
      if (start_str[i] === end_str[i]) {
        common_length++;
      } else {
        break;
      }
    }

    return start_str.substring(0, common_length);
  }
}
