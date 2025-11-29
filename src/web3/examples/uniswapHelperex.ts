import { UniswapHelper } from '../uniswapHelper';
import { rpcs } from '../../web3config/rpcs';
const batchCallAddress = '0x0a9EA1e389ED7f6bFc7a7cd04E58467947dd3cb1';

const kyoHelper = new UniswapHelper(rpcs.soneium, {
  uniswapV2RouterAddress: '0x3c56C7C1Bfd9dbC14Ab04935f409d49D3b7A802E',
  uniswapV3RouterAddress: '0x0dC73Fe1341365929Ed8a89Dd47097A9FDD254D0',
  uniswapV3QuoterAddress: '0x60eb4B04932797374a291380349008dc8cc40426',
  uniswapV3FactoryAddress: '0x137841043180BBA8EF52828F9030D1b7fE065F95',
  batchCallAddress,
  // useQuoterV2: true, // 启用 QuoterV2 支持
});
export const soneium = {
  WstASTR: '0x3b0DC2daC9498A024003609031D973B1171dE09E',
  WASTR: '0x2CAE934a1e84F693fbb78CA5ED3B0A6893259441',
};
// [1, 50, 100, 500, 3000, 5000, 10000]
async function main() {
  // V2 查询示例
  // const amountsv2 = await kyoHelper.getAmountsOutV2({
  //   amountIn: BigInt(1e18),
  //   path: [soneium.WstASTR, soneium.WASTR],
  // });
  // console.log('V2 amounts:', amountsv2);

  // V3 自动选择最佳费率查询
  // const bestFee = await kyoHelper.quoteV3WithBestFee({
  //   tokenIn: soneium.WstASTR,
  //   tokenOut: soneium.WASTR,
  //   amountIn: '1000000000000000000',
  //   fees: [100, 500, 3000, 10000],
  // });
  // console.log('最佳费率查询结果:', bestFee);

  // V3 指定费率查询示例
  const quote500 = await kyoHelper.quoteExactInputSingleV3({
    tokenIn: soneium.WstASTR,
    tokenOut: soneium.WASTR,
    fee: 500,
    amountIn: '1000000000000000000',
  });
  console.log('Fee 500 quote:', quote500.toString());
}

main().catch(console.error);
