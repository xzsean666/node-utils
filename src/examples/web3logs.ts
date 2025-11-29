import { EthersLogSyncHelper } from '../web3/ethersLogSyncHelper';
import vaultinfo from './abis/vault.json';

const rpcurl = 'https://evm.astar.network';

const helper = new EthersLogSyncHelper(rpcurl);

async function main() {
  const result = await helper.getLogs({
    contract_address: '0x0DC6E8922ac0ECa8287ba22Db14C9Ac9317ed18F',
    event_name: 'Deposit',
    args: ['98272264616942990000'],
  });
  console.log('Sync result:', result);
  const recentLogs = await helper.getRecentLogs({
    contract_address: '0x0DC6E8922ac0ECa8287ba22Db14C9Ac9317ed18F',
    event_name: 'Deposit',
    block_range: 100000,
  });
  console.log('Recent logs:', recentLogs);
  // process.exit(0);
  // 现在数据库连接会在 syncLogs 方法中正确关闭，程序会自动退出
}

main();
