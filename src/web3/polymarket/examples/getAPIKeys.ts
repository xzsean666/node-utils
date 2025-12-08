import { ethers } from 'ethers';
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import { ApiKeyCreds, Chain, ClobClient } from '../clobClient';

dotenvConfig({ path: resolve(__dirname, '../.env') });

async function main() {
  const wallet = new ethers.Wallet(`${process.env.PRIVATE_KEY_TEST}`);
  const chainId = parseInt(`${process.env.CHAIN_ID || Chain.POLYGON}`) as Chain;
  console.log(`Address: ${await wallet.getAddress()}, chainId: ${chainId}`);

  const host = process.env.CLOB_API_URL || 'https://clob.polymarket.com/';
  const creds: ApiKeyCreds = {
    key: `${process.env.CLOB_API_KEY}`,
    secret: `${process.env.CLOB_SECRET}`,
    passphrase: `${process.env.CLOB_PASS_PHRASE}`,
  };
  const clobClient = new ClobClient(host, chainId, wallet, creds);

  console.log(`Response: `);
  const resp = await clobClient.getApiKeys();
  console.log(resp);
}

main();
