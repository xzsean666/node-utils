import { EthersLogSyncHelper } from '../src/utils/web3/ethersLogSyncHelper';

// syncLogs 支持智能filter示例
async function syncLogsFilterExample() {
  const helper = new EthersLogSyncHelper('https://your-rpc-url');

  // ERC20合约ABI
  const erc20ABI = [
    {
      anonymous: false,
      inputs: [
        { indexed: true, name: 'from', type: 'address' },
        { indexed: true, name: 'to', type: 'address' },
        { indexed: false, name: 'value', type: 'uint256' },
      ],
      name: 'Transfer',
      type: 'event',
    },
    {
      anonymous: false,
      inputs: [
        { indexed: true, name: 'owner', type: 'address' },
        { indexed: true, name: 'spender', type: 'address' },
        { indexed: false, name: 'value', type: 'uint256' },
      ],
      name: 'Approval',
      type: 'event',
    },
  ];

  // 🎯 示例1：使用数组格式的filter（简单模式）
  console.log('=== 示例1：数组格式filter ===');
  const result1 = await helper.syncLogs({
    contract_address: '0xA0b86a33E6441fCE4A4EA8c9a6c2b3E6F8C8F6E5', // USDC合约
    abi: erc20ABI,
    event_name: 'Transfer',
    start_block: 18000000,
    filter: {
      // 直接传入indexed参数数组，程序会自动处理
      topics: [
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // from地址
        null, // to地址（不过滤）
      ],
    },
  });

  console.log('同步结果1:', result1);

  // 🎯 示例2：使用对象格式的filter（多事件模式）
  console.log('=== 示例2：对象格式filter（多事件）===');
  const result2 = await helper.syncLogs({
    contract_address: '0xA0b86a33E6441fCE4A4EA8c9a6c2b3E6F8C8F6E5',
    abi: erc20ABI,
    event_name: ['Transfer', 'Approval'], // 同步多个事件
    start_block: 18000000,
    filter: {
      // key是事件名，value是对应的indexed参数数组
      topics: {
        Transfer: [
          '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // 只同步这个地址的转出
          null,
        ],
        Approval: [
          null, // 不限制owner
          '0xF977814e90dA44bFA03b6295A0616a897441aceC', // 只同步给这个spender的授权
        ],
      },
    },
  });

  console.log('同步结果2:', result2);

  // 🎯 示例3：结合其他filter条件
  console.log('=== 示例3：结合其他filter条件 ===');
  const result3 = await helper.syncLogs({
    contract_address: '0xA0b86a33E6441fCE4A4EA8c9a6c2b3E6F8C8F6E5',
    abi: erc20ABI,
    event_name: 'Transfer',
    start_block: 18000000,
    filter: {
      topics: [
        null, // 不限制from
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // 只同步转入这个地址的交易
      ],
      // 注意：fromBlock和toBlock会在内部被覆盖，这里设置会被忽略
      // fromBlock: 18000000, // 这个会被start_block参数覆盖
      // toBlock: 19000000,   // 这个会被计算出的to_block覆盖
    },
  });

  console.log('同步结果3:', result3);

  // 🎯 示例4：无filter条件（同步所有事件）
  console.log('=== 示例4：无filter条件 ===');
  const result4 = await helper.syncLogs({
    contract_address: '0xA0b86a33E6441fCE4A4EA8c9a6c2b3E6F8C8F6E5',
    abi: erc20ABI,
    event_name: ['Transfer', 'Approval'],
    start_block: 18000000,
    // 不传filter，同步所有事件的所有日志
  });

  console.log('同步结果4:', result4);
}

// 使用说明：
// 1. syncLogs中的filter参数会被传递给内部的getContractLogs方法
// 2. 支持所有getContractLogs支持的filter格式
// 3. fromBlock和toBlock会在内部根据start_block和当前区块计算，会覆盖filter中的设置
// 4. topics可以使用数组格式或对象格式

syncLogsFilterExample().catch(console.error);
