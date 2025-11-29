import { EthersLogSyncHelper } from '../web3/ethersLogSyncHelper';
import vaultinfo from './abis/vault.json';

const rpcurl = 'https://evm.astar.network';

const abi = vaultinfo.abi || [];
const sample = {
  provider: {},
  transactionHash:
    '0x40b1a1f0b62ca3e460f83e8939968940365753a73506cfae820791484088a2d1',
  blockHash:
    '0x48a12278846b4b9193a9289f4e0856c709208f24472f47992b8facec0578e72f',
  blockNumber: 10235501,
  removed: false,
  address: '0x0DC6E8922ac0ECa8287ba22Db14C9Ac9317ed18F',
  data: '0x00000000000000000000000000000000000000000000000553cd3800161372b0000000000000000000000000000000000000000000000004fea431d7c02b20e6',
  topics: [
    '0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7',
    '0x0000000000000000000000006f9d07e9e974da5b3f57a6b092eb524f176162e4',
    '0x0000000000000000000000000dc6e8922ac0eca8287ba22db14c9ac9317ed18f',
  ],
  index: 9,
  transactionIndex: 0,
  args: [
    '0x6F9D07e9e974DA5B3F57a6B092EB524F176162e4',
    '0x0DC6E8922ac0ECa8287ba22Db14C9Ac9317ed18F',
    '98272264616942990000',
    '92135821879364231398',
  ],
  name: 'Deposit',
  signature: 'Deposit(address,address,uint256,uint256)',
  eventFragment: {
    type: 'event',
    inputs: [
      {
        name: 'caller',
        type: 'address',
        baseType: 'address',
        indexed: true,
        components: null,
        arrayLength: null,
        arrayChildren: null,
      },
      {
        name: 'owner',
        type: 'address',
        baseType: 'address',
        indexed: true,
        components: null,
        arrayLength: null,
        arrayChildren: null,
      },
      {
        name: 'assets',
        type: 'uint256',
        baseType: 'uint256',
        indexed: false,
        components: null,
        arrayLength: null,
        arrayChildren: null,
      },
      {
        name: 'shares',
        type: 'uint256',
        baseType: 'uint256',
        indexed: false,
        components: null,
        arrayLength: null,
        arrayChildren: null,
      },
    ],
    name: 'Deposit',
    anonymous: false,
  },
};
const eventABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'caller',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'owner',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'assets',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'shares',
        type: 'uint256',
      },
    ],
    name: 'Deposit',
    type: 'event',
  },
];

const helper = new EthersLogSyncHelper(rpcurl);

async function main() {
  const result = await helper.syncLogsToCurrent({
    contract_address: '0x0DC6E8922ac0ECa8287ba22Db14C9Ac9317ed18F',
    abi: eventABI,
    start_block: 10222416,
  });
  console.log('Sync result:', result);
  // process.exit(0);
  // 现在数据库连接会在 syncLogs 方法中正确关闭，程序会自动退出
}

main();
