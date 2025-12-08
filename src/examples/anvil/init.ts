import { anvilForkHelper, ethersUtils, ERC20Utils } from './index';
import { abi, bytecode } from '../../web3config/contracts/batchcall/batchcall';

const main = async () => {
  const blockNumber = await ethersUtils.getLatestBlockNumber();
  await anvilForkHelper.increaseBlock(10);
  const newBlockNumber = await ethersUtils.getLatestBlockNumber();
  console.log('Current block number:', blockNumber);
  console.log('New block number:', newBlockNumber);
  const userAddress = '0x285bd8C75C7647b7da1C1154776633804d4ff5eC';
  const balance = await ethersUtils.getBalance(userAddress);
  await anvilForkHelper.mintETH(userAddress, 1000);
  const newBalance = await ethersUtils.getBalance(userAddress);
  console.log('Balance:', balance);
  console.log('New balance:', newBalance);

  // const tokenAddress = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
  // //   const tokenAddress = "0x094bAa7af82e29a0372924E04901743050cD7886";
  // const erc20 = new ERC20Utils("http://localhost:8545", tokenAddress);
  // const tokenBalance = await erc20.balanceOf(userAddress);
  // console.log("Token balance:", tokenBalance);
  // await anvilForkHelper.mintToken(tokenAddress, userAddress, 1000);
  // const newTokenBalance = await erc20.balanceOf(userAddress);
  // console.log("Token balance:", tokenBalance);
  // console.log("New token balance:", newTokenBalance);
};
main();
