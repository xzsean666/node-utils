import { EthersLogSyncHelper } from '../web3/ethersLogSyncHelper';
import vaultinfo from './abis/vault.json';

const rpcurl = 'https://evm.astar.network';

const abi = vaultinfo.abi || [];

const helper = new EthersLogSyncHelper(rpcurl, {
  sqlite_path: './db/astarlog.db',
});

async function main() {
  const logs = await helper.syncLogs({
    contract_address: '0x0DC6E8922ac0ECa8287ba22Db14C9Ac9317ed18F',
    abi: abi,
    start_block: 10222416,
  });
  console.log(logs);
}

void main();
