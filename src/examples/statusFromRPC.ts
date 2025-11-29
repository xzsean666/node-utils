import { EthersUtils } from '../web3/deprecate/ethersUtils';

async function main() {
  const astar =
    'https://rpc.startale.com/astar?apikey=JJqkHq0DQVZpuIN7ABQDGES7s6HSehbB';
  const astarPublic = 'https://astar.public.blastapi.io';
  const status = await EthersUtils.getCurrentChainStatus(astarPublic);
  console.log(status);
}

main();
