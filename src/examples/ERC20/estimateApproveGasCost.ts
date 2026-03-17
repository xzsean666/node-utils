import dotenv from 'dotenv';
import { ERC20Utils } from '../../web3/deprecate/ERC20Utils';
import { rpcs, testbnbTOKENS } from './config';

dotenv.config();

const erc20Utils = new ERC20Utils(
  rpcs.testbnb,
  '0x397E696881DA1b85834BD7b6289925f8B9a1ee8a',
  process.env.PRIVATE_KEY,
);

async function main() {
  const gasCost = await erc20Utils.estimateApproveGasCost(
    '0x6d8B018833495b79805171e716030b807e08090E',
  );
  console.log(gasCost);
}

main();
