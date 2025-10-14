import { CCIPLogHelper } from '../src/utils/web3/CCIPLogHelper';

/**
 * CCIP日志同步使用示例
 */

async function example() {
  // 配置参数
  const sepolia_rpc = 'https://ethereum-sepolia-rpc.publicnode.com';
  const sepolia_router = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59';
  const arbitrum_sepolia_selector = '3478487238524512106'; // Arbitrum Sepolia chain selector
  const sepolia_selector = '16015286601757825753'; // Sepolia chain selector

  // 示例1: 在源链（Sepolia）上同步 CCIPSendRequested 事件
  console.log('\n=== 示例1: 同步源链发送事件 ===');
  const source_helper = new CCIPLogHelper(sepolia_rpc, sepolia_router, {
    destination_chain_selector: arbitrum_sepolia_selector,
    sqlite_path: './db/ccip_sepolia',
  });

  try {
    // 同步最近1000个区块的 CCIPSendRequested 事件
    const send_result = await source_helper.syncCCIPSendRequested({
      start_block: undefined, // 从数据库上次同步位置继续
    });

    console.log('同步结果:', send_result);
  } catch (error) {
    console.error('同步失败:', error);
  }

  // 示例2: 查询已同步的发送事件
  console.log('\n=== 示例2: 查询发送事件 ===');
  try {
    const send_logs = await source_helper.getCCIPSendRequestedLogs({
      limit: 10, // 获取最近10条
    });

    console.log(`找到 ${send_logs.total_count} 条发送记录`);
    send_logs.logs.forEach((log: any, index: number) => {
      const message = log.args?.[0];
      console.log(`\n记录 ${index + 1}:`);
      console.log('  Message ID:', message?.messageId);
      console.log('  发送者:', message?.sender);
      console.log('  接收者:', message?.receiver);
      console.log('  区块号:', log.blockNumber);
      console.log('  交易哈希:', log.transactionHash);
    });
  } catch (error) {
    console.error('查询失败:', error);
  }

  // 示例3: 在目标链（Arbitrum Sepolia）上同步 ExecutionStateChanged 事件
  console.log('\n=== 示例3: 同步目标链执行事件 ===');
  const arbitrum_rpc = 'https://arbitrum-sepolia-rpc.publicnode.com';
  const arbitrum_router = '0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165';

  const dest_helper = new CCIPLogHelper(arbitrum_rpc, arbitrum_router, {
    source_chain_selector: sepolia_selector,
    sqlite_path: './db/ccip_arbitrum',
  });

  try {
    const exec_result = await dest_helper.syncExecutionStateChanged({
      start_block: undefined, // 从数据库上次同步位置继续
    });

    console.log('同步结果:', exec_result);
  } catch (error) {
    console.error('同步失败:', error);
  }

  // 示例4: 查询已同步的执行事件
  console.log('\n=== 示例4: 查询执行事件 ===');
  try {
    const exec_logs = await dest_helper.getExecutionStateChangedLogs({
      limit: 10,
    });

    console.log(`找到 ${exec_logs.total_count} 条执行记录`);
    exec_logs.logs.forEach((log: any, index: number) => {
      console.log(`\n记录 ${index + 1}:`);
      console.log('  Message ID:', log.args?.[1]);
      console.log('  执行状态:', getStateString(Number(log.args?.[2])));
      console.log('  区块号:', log.blockNumber);
      console.log('  交易哈希:', log.transactionHash);
    });
  } catch (error) {
    console.error('查询失败:', error);
  }

  // 示例5: 根据 messageId 查询完整的跨链状态
  console.log('\n=== 示例5: 查询跨链消息完整状态 ===');
  const message_id =
    '0x1234567890123456789012345678901234567890123456789012345678901234'; // 示例 messageId

  try {
    // 在源链查询
    const status = await source_helper.getCCIPMessageStatus(message_id);

    console.log('\n消息状态:');
    console.log('  Message ID:', status.message_id);

    if (status.send_event) {
      console.log('\n  发送事件:');
      console.log('    区块号:', status.send_event.blockNumber);
      console.log('    交易哈希:', status.send_event.transactionHash);
      console.log('    发送者:', status.send_event.args?.[0]?.sender);
      console.log('    接收者:', status.send_event.args?.[0]?.receiver);
    } else {
      console.log('  发送事件: 未找到');
    }

    if (status.execution_event) {
      console.log('\n  执行事件:');
      console.log('    区块号:', status.execution_event.blockNumber);
      console.log('    交易哈希:', status.execution_event.transactionHash);
      console.log(
        '    执行状态:',
        getStateString(Number(status.execution_event.args?.[2])),
      );
    } else {
      console.log('  执行事件: 未找到');
    }
  } catch (error) {
    console.error('查询失败:', error);
  }

  // 示例6: 同步所有CCIP事件到最新区块
  console.log('\n=== 示例6: 持续同步所有事件 ===');
  try {
    // 在源链同步
    await source_helper.syncAllCCIPEvents({
      sync_send_events: true,
      sync_execution_events: false, // 源链不需要同步执行事件
    });

    // 在目标链同步
    await dest_helper.syncAllCCIPEvents({
      sync_send_events: false, // 目标链不需要同步发送事件
      sync_execution_events: true,
    });

    console.log('所有事件同步完成');
  } catch (error) {
    console.error('同步失败:', error);
  }

  // 示例7: 过滤特定地址的事件
  console.log('\n=== 示例7: 查询特定地址的发送事件 ===');
  const sender_address = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0';

  try {
    const filtered_logs = await source_helper.getCCIPSendRequestedLogs({
      from_address: sender_address,
      limit: 5,
    });

    console.log(
      `找到 ${filtered_logs.total_count} 条来自 ${sender_address} 的发送记录`,
    );
  } catch (error) {
    console.error('查询失败:', error);
  }
}

// 辅助函数：将执行状态数字转换为字符串
function getStateString(state: number): string {
  switch (state) {
    case 0:
      return 'UNTOUCHED';
    case 1:
      return 'IN_PROGRESS';
    case 2:
      return 'SUCCESS';
    case 3:
      return 'FAILURE';
    default:
      return 'UNKNOWN';
  }
}

// 运行示例
if (require.main === module) {
  example()
    .then(() => {
      console.log('\n✅ 示例运行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ 示例运行失败:', error);
      process.exit(1);
    });
}

export { example };
