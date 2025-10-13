import { ethers } from 'ethers';
import { EthersLogHelper } from '../src/utils/web3/ethersLogHelper';

// 示例：如何构建完整的topics数组来过滤indexed参数
async function topicsUsageExample() {
  const helper = new EthersLogHelper('https://your-rpc-url');

  // 1. ERC20 Transfer 事件：Transfer(address indexed from, address indexed to, uint256 value)
  // 事件签名：Transfer(address,address,uint256)
  const transferSignature = 'Transfer(address,address,uint256)';
  const transferTopic0 = ethers.id(transferSignature); // 这是你已经获得的topic0

  console.log('Transfer event topic0:', transferTopic0);

  // 2. 构建完整的topics数组

  // 2.1 只过滤from地址
  const fromAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const paddedFromAddress = ethers.zeroPadValue(fromAddress, 32);
  const topics1 = helper.buildTopics(transferSignature, [
    paddedFromAddress,
    null,
  ]);
  console.log('Topics with from filter:', topics1);

  // 2.2 只过滤to地址
  const toAddress = '0xF977814e90dA44bFA03b6295A0616a897441aceC';
  const paddedToAddress = ethers.zeroPadValue(toAddress, 32);
  const topics2 = helper.buildTopics(transferSignature, [
    null,
    paddedToAddress,
  ]);
  console.log('Topics with to filter:', topics2);

  // 2.3 同时过滤from和to地址
  const topics3 = helper.buildTopics(transferSignature, [
    paddedFromAddress,
    paddedToAddress,
  ]);
  console.log('Topics with both from and to filter:', topics3);

  // 3. 使用构建的topics进行查询
  const logs1 = await helper.getRawContractLogs({
    contract_addresses: '0xA0b86a33E6441fCE4A4EA8c9a6c2b3E6F8C8F6E5', // ERC20合约地址
    event_signatures: transferSignature,
    filter: {
      topics: [null, paddedFromAddress, null], // filter.topics对应topic1, topic2, topic3
      fromBlock: 18000000,
      toBlock: 19000000,
    },
  });

  console.log('Found logs with from filter:', logs1.length);

  // 4. 对于数值类型的indexed参数
  // 假设有一个事件：Swap(address indexed user, uint256 indexed amountIn, uint256 indexed amountOut)
  const swapSignature = 'Swap(address,uint256,uint256)';
  const userAddress = ethers.zeroPadValue(
    '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    32,
  );
  const amountIn = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256'],
    [1000000000000000000n],
  ); // 1 ETH in wei

  const swapTopics = helper.buildTopics(swapSignature, [
    userAddress,
    amountIn,
    null,
  ]);
  console.log('Swap topics:', swapTopics);

  // 5. 手动构建topics数组（不使用helper方法）
  const manualTopics = [
    ethers.id('Transfer(address,address,uint256)'), // topic0
    ethers.zeroPadValue('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 32), // topic1: from address
    null, // topic2: to address (不过滤)
    null, // topic3: value (不过滤)
  ];

  console.log('Manual topics construction:', manualTopics);
}

// 3. 使用智能filter（推荐方式）- 只传入indexed参数，程序自动处理
async function smartFilterExample() {
  const helper = new EthersLogHelper('https://your-rpc-url');

  // 示例ABI - ERC20 Transfer事件
  const erc20ABI = [
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          name: 'from',
          type: 'address',
        },
        {
          indexed: true,
          name: 'to',
          type: 'address',
        },
        {
          indexed: false,
          name: 'value',
          type: 'uint256',
        },
      ],
      name: 'Transfer',
      type: 'event',
    },
  ];

  // 只传入indexed参数的值，程序会自动处理类型转换
  const logs = await helper.getContractLogs({
    contract_addresses: '0xA0b86a33E6441fCE4A4EA8c9a6c2b3E6F8C8F6E5',
    abi: erc20ABI,
    event_names: 'Transfer',
    filter: {
      // 直接传入原始值，程序会自动转换为正确的格式
      topics: [
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // from address
        null, // to address (不过滤)
        // value参数不是indexed的，不会出现在topics中
      ],
      fromBlock: 18000000,
      toBlock: 19000000,
    },
  });

  console.log('智能filter结果:', logs.length);

  // 4. 数值类型的indexed参数
  const customEventABI = [
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          name: 'user',
          type: 'address',
        },
        {
          indexed: true,
          name: 'amount',
          type: 'uint256',
        },
        {
          indexed: true,
          name: 'timestamp',
          type: 'uint64',
        },
      ],
      name: 'Stake',
      type: 'event',
    },
  ];

  const stakeLogs = await helper.getContractLogs({
    contract_addresses: '0x...',
    abi: customEventABI,
    event_names: 'Stake',
    filter: {
      topics: [
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // user address
        '1000000000000000000', // amount (1 ETH in wei) - 作为字符串传入
        null, // timestamp (不过滤)
      ],
    },
  });

  console.log('Stake事件过滤结果:', stakeLogs.length);
}

// 运行示例
topicsUsageExample().catch(console.error);
smartFilterExample().catch(console.error);
