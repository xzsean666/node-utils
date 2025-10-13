import { EthersLogHelper } from '../src/utils/web3/ethersLogHelper';

// 智能filter使用示例
// 你只需要传入indexed参数的原始值，程序会自动处理类型转换

async function smartFilterExample() {
  const helper = new EthersLogHelper('https://your-rpc-url');

  // ERC20 Transfer事件ABI
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
  ];

  // 🎯 过滤某个地址的所有转出交易
  const outgoingTransfers = await helper.getContractLogs({
    contract_addresses: '0xA0b86a33E6441fCE4A4EA8c9a6c2b3E6F8C8F6E5', // USDC合约
    abi: erc20ABI,
    event_names: 'Transfer',
    filter: {
      // 直接传入原始值！程序会自动转换为正确的32字节格式
      topics: [
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // from地址
        null, // to地址（不过滤）
      ],
      fromBlock: 18000000,
      toBlock: 19000000,
    },
  });

  console.log(`找到 ${outgoingTransfers.length} 笔转出交易`);

  // 🎯 过滤某个地址的所有转入交易
  const incomingTransfers = await helper.getContractLogs({
    contract_addresses: '0xA0b86a33E6441fCE4A4EA8c9a6c2b3E6F8C8F6E5',
    abi: erc20ABI,
    event_names: 'Transfer',
    filter: {
      topics: [
        null, // from地址（不过滤）
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // to地址
      ],
    },
  });

  console.log(`找到 ${incomingTransfers.length} 笔转入交易`);

  // 🎯 自定义事件示例
  const stakingABI = [
    {
      anonymous: false,
      inputs: [
        { indexed: true, name: 'user', type: 'address' },
        { indexed: true, name: 'amount', type: 'uint256' },
        { indexed: true, name: 'poolId', type: 'uint32' },
        { indexed: false, name: 'timestamp', type: 'uint256' },
      ],
      name: 'Staked',
      type: 'event',
    },
  ];

  // 过滤特定用户在特定池子的质押记录
  const stakingLogs = await helper.getContractLogs({
    contract_addresses: '0x...',
    abi: stakingABI,
    event_names: 'Staked',
    filter: {
      topics: [
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // user地址
        '1000000000000000000', // amount (1 ETH)
        '1', // poolId
      ],
    },
  });

  console.log(`找到 ${stakingLogs.length} 笔质押记录`);
}

// 🎯 高级用法：同时过滤多个不同事件的logs
async function advancedMultiEventFilterExample() {
  const helper = new EthersLogHelper('https://your-rpc-url');

  // ERC20合约的完整ABI（包含Transfer和Approval事件）
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

  // 🔥 同时过滤多个事件的logs！
  // key是事件名，value是对应的indexed参数数组
  const logs = await helper.getContractLogs({
    contract_addresses: '0xA0b86a33E6441fCE4A4EA8c9a6c2b3E6F8C8F6E5',
    abi: erc20ABI,
    event_names: ['Transfer', 'Approval'], // 获取多个事件
    filter: {
      topics: {
        // Transfer(from, to, value) 事件：只过滤from地址
        Transfer: [
          '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // from地址
          null, // to地址（不过滤）
        ],
        // Approval(owner, spender, value) 事件：只过滤owner地址
        Approval: [
          '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // owner地址
          null, // spender地址（不过滤）
        ],
      },
      fromBlock: 18000000,
      toBlock: 19000000,
    },
  });

  console.log(`找到 ${logs.length} 笔 Transfer 或 Approval 事件`);

  // 更复杂的过滤：同时过滤Transfer的from和to，以及Approval的owner
  const complexLogs = await helper.getContractLogs({
    contract_addresses: '0xA0b86a33E6441fCE4A4EA8c9a6c2b3E6F8C8F6E5',
    abi: erc20ABI,
    event_names: ['Transfer', 'Approval'],
    filter: {
      topics: {
        Transfer: [
          '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // from
          '0xF977814e90dA44bFA03b6295A0616a897441aceC', // to
        ],
        Approval: [
          '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // owner
        ],
      },
    },
  });

  console.log(`找到 ${complexLogs.length} 笔复杂的过滤结果`);
}

// 使用说明：
// 1. 你只需要传入 ABI 和 event_names
// 2. filter.topics 支持两种格式：
//    a) 数组格式（向后兼容）：直接传入indexed参数数组
//    b) 对象格式（新功能）：key是事件名，value是对应的indexed参数数组
// 3. address 直接传字符串，数值类型传字符串或数字
// 4. null 表示跳过该参数的过滤
// 5. 程序会根据 ABI 中的类型定义自动转换格式

smartFilterExample().catch(console.error);
advancedMultiEventFilterExample().catch(console.error);
