import { AnvilForkHelper } from '../../web3/anvilForkHelper';
import { EthersUtils } from '../../web3/deprecate/ethersUtilsV2';
export { ERC20Utils } from '../../web3/deprecate/ERC20Utils';
export const anvilForkHelper = new AnvilForkHelper();
export const ethersUtils = new EthersUtils('http://localhost:8545');
