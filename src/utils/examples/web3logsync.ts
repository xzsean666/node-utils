import { EthersLogSyncHelper } from '../web3/ethersLogSyncHelper';
import vaultinfo from './abis/vault.json';

const rpcurl = 'https://evm.astar.network';

const abi = vaultinfo.abi || [];
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
