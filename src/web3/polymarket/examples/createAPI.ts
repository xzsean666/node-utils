import { ethers } from 'ethers';
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import { Chain } from '../clobClient';
import { ClobClient } from '../clobClient/client';

dotenvConfig({ path: resolve(__dirname, '../.env') });

async function main() {
  const wallet = new ethers.Wallet(`${process.env.PRIVATE_KEY_TEST}`);
  const chainId = parseInt(`${process.env.CHAIN_ID || Chain.POLYGON}`) as Chain;
  console.log(`Address: ${await wallet.getAddress()}, chainId: ${chainId}`);

  const host = process.env.CLOB_API_URL || 'https://clob.polymarket.com/';
  const clobClient = new ClobClient(host, chainId, wallet);

  console.log(`Response: `);
  const resp = await clobClient.createApiKey();
  console.log(resp);
  console.log(`Complete!`);
}

// Uncomment to run the second example
main();
