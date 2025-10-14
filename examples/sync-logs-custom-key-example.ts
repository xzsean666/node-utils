import { EthersLogSyncHelper } from '../src/utils/web3/ethersLogSyncHelper';

const node_url = 'YOUR_RPC_URL';
const contract_address = '0xYourContractAddress';

const abi = [
  // Your contract ABI here
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

async function exampleWithDefaultKey() {
  const helper = new EthersLogSyncHelper(node_url, {
    sqlite_path: './db/myLogs',
  });

  // 使用默认的key生成逻辑: ${log_name}_${log.blockNumber}_${nonce}
  const result = await helper.syncLogs({
    contract_address,
    abi,
    event_name: 'Transfer',
    start_block: 1000000,
  });

  console.log('Default key example:', result);
}

async function exampleWithCustomKey() {
  const helper = new EthersLogSyncHelper(node_url, {
    sqlite_path: './db/myLogs',
  });

  // 使用自定义key生成器: 根据log内部字段组合生成key
  const result = await helper.syncLogs({
    contract_address,
    abi,
    event_name: 'Transfer',
    start_block: 1000000,
    // 自定义key生成器：使用 transactionHash 和 logIndex 作为key
    key_generator: (log, nonce) => {
      return `${log.transactionHash}_${log.logIndex}`;
    },
  });

  console.log('Custom key example:', result);
}

async function exampleWithArgsBasedKey() {
  const helper = new EthersLogSyncHelper(node_url, {
    sqlite_path: './db/myLogs',
  });

  // 使用自定义key生成器: 根据event参数生成key
  const result = await helper.syncLogs({
    contract_address,
    abi,
    event_name: 'Transfer',
    start_block: 1000000,
    // 自定义key生成器：使用 from 和 to 地址组合作为key
    key_generator: (log, nonce) => {
      const log_name = 'name' in log ? log.name : 'unknown';
      // log.args 是一个数组，对于 Transfer event:
      // args[0] = from, args[1] = to, args[2] = value
      const from = log.args[0];
      const to = log.args[1];
      return `${log_name}_${from}_${to}_${log.blockNumber}_${nonce}`;
    },
  });

  console.log('Args-based key example:', result);
}

async function exampleWithMessageIdKey() {
  const helper = new EthersLogSyncHelper(node_url, {
    sqlite_path: './db/myLogs',
  });

  // 使用自定义key生成器: 如果log中有messageId字段，使用它作为key
  const result = await helper.syncLogs({
    contract_address,
    abi,
    event_name: 'CCIPSendRequested',
    start_block: 1000000,
    // 自定义key生成器：使用 messageId 作为唯一key
    key_generator: (log, nonce) => {
      const log_name = 'name' in log ? log.name : 'unknown';
      // 假设log中有messageId字段
      const message_id = log.args?.messageId || log.messageId;
      if (message_id) {
        return `${log_name}_${message_id}`;
      }
      // 如果没有messageId，回退到默认格式
      return `${log_name}_${log.blockNumber}_${nonce}`;
    },
  });

  console.log('MessageId-based key example:', result);
}

async function exampleSyncToCurrent() {
  const helper = new EthersLogSyncHelper(node_url, {
    sqlite_path: './db/myLogs',
  });

  // syncLogsToCurrent 也支持自定义key生成器
  await helper.syncLogsToCurrent({
    contract_address,
    abi,
    event_name: 'Transfer',
    start_block: 1000000,
    key_generator: (log, nonce) => {
      return `${log.transactionHash}_${log.logIndex}`;
    },
  });

  console.log('Synced to current block with custom key');
}

// 运行示例
async function main() {
  // 选择要运行的示例
  // await exampleWithDefaultKey();
  // await exampleWithCustomKey();
  // await exampleWithArgsBasedKey();
  // await exampleWithMessageIdKey();
  // await exampleSyncToCurrent();
}

main().catch(console.error);
