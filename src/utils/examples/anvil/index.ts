import { AnvilForkHelper } from "../../web3/anvilForkHelper";
import { EthersUtils } from "../../web3/ethersUtilsV2";
export { ERC20Utils } from "../../web3/ERC20Utils";
export const anvilForkHelper = new AnvilForkHelper();
export const ethersUtils = new EthersUtils("http://localhost:8545");
