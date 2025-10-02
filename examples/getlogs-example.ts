import { EthersLogSyncHelper } from '../src/utils/web3/ethersLogSyncHelper';

const rpcurl = 'https://evm.astar.network';

const helper = new EthersLogSyncHelper(rpcurl);

async function main() {
  const contract_address = '0x0DC6E8922ac0ECa8287ba22Db14C9Ac9317ed18F';

  // 示例1: 获取所有 Deposit 事件的日志
  console.log('=== 获取所有 Deposit 事件 ===');
  const allDepositLogs = await helper.getLogs({
    contract_address,
    eventNames: 'Deposit',
  });
  console.log(`找到 ${allDepositLogs.total_count} 条 Deposit 日志`);

  // 示例2: 获取指定区块范围内的日志
  // 例如：10231000 到 10235000，前缀会是 "1023"
  console.log('\n=== 获取区块范围 10231000-10235000 的日志 ===');
  const rangeLogs = await helper.getLogs({
    contract_address,
    eventNames: 'Deposit',
    start_block: 10231000,
    end_block: 10235000,
  });
  console.log(`找到 ${rangeLogs.total_count} 条日志`);
  console.log(`查询前缀: Deposit_1023`);

  // 示例3: 获取更小范围的日志
  // 例如：10231799 到 10231800，前缀会是 "102317"
  console.log('\n=== 获取区块范围 10231799-10231800 的日志 ===');
  const smallRangeLogs = await helper.getLogs({
    contract_address,
    eventNames: 'Deposit',
    start_block: 10231799,
    end_block: 10231800,
  });
  console.log(`找到 ${smallRangeLogs.total_count} 条日志`);
  console.log(`查询前缀: Deposit_102317`);

  // 示例4: 使用分页查询（limit 和 offset）
  console.log('\n=== 分页查询示例 ===');
  const page1Logs = await helper.getLogs({
    contract_address,
    eventNames: 'Deposit',
    start_block: 10231000,
    end_block: 10235000,
    limit: 10,
    offset: 0,
  });
  console.log(`第1页: 找到 ${page1Logs.total_count} 条日志`);
  console.log(`查询参数: limit=${page1Logs.limit}, offset=${page1Logs.offset}`);

  const page2Logs = await helper.getLogs({
    contract_address,
    eventNames: 'Deposit',
    start_block: 10231000,
    end_block: 10235000,
    limit: 10,
    offset: 10,
  });
  console.log(`第2页: 找到 ${page2Logs.total_count} 条日志`);
  console.log(`查询参数: limit=${page2Logs.limit}, offset=${page2Logs.offset}`);

  // 示例5: 获取所有事件类型的日志（不指定 eventNames）
  console.log('\n=== 获取所有事件类型的日志 ===');
  const allLogs = await helper.getLogs({
    contract_address,
    start_block: 10231000,
    end_block: 10232000,
  });
  console.log(`找到 ${allLogs.total_count} 条日志`);
  console.log(`查询前缀: 10231`);
}

main().catch(console.error);
