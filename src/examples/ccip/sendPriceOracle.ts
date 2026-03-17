import ccip from './ccip.json';
import { config as dotenvConfig } from 'dotenv';
import { CCIPLiteHelper } from './index';
import { rpcs } from './rpcs';

dotenvConfig();
const ccipSoneium = ccip.soneium;
const ccipAstar = ccip.astar;

const ccipHelper = new CCIPLiteHelper(rpcs.astar, process.env.PRIVATE_KEY);

const L2Deploy = {
  'L2#DestinationChainCCIPAdapter':
    '0x897319BAD2e1962A330B93c04fC7002d06D94F69',
  'L2#PriceOracle': '0x5A599251a359Cf27A6A42E7baB1b1494d3919083',
};
async function main() {
  const messge = await ccipHelper.createMessage({
    receiver: L2Deploy['L2#DestinationChainCCIPAdapter'],
    data: '0x0000000000000000000000000000000000000000000000000000000000000064', // uint256 value of 100
  });
  console.log(messge);
  const fee = await ccipHelper.getFee(
    ccipAstar.router,
    ccipSoneium.chainSelector,
    messge,
  );
  console.log(fee);
  const callData = await ccipHelper.getCallData(
    ccipAstar.router,
    ccipSoneium.chainSelector,
    messge,
  );
  //   console.log(callData);
  const tx = await ccipHelper.sendTransaction(callData);
  console.log(tx);
}
main();
