import dotenv from "dotenv";
dotenv.config();

export const configShibuya = {
  rpcUrl: process.env.RPC_URL_SHIBUYA,
  onRampAddress: "0xf44C900e9DBCEE18C57967Da554330AcDcE77fBA",
  offRampAddress: "0x9A04De2E0bf6b1b62ffB3AAe91fdEe76d65Fde79",
  ccip: {
    Router: "0x22aE550d87eBf775E0c1fDc8881121c8A51F5903",
    ChainSelector: "6955638871347136141",
    RMN: "0xc96ac0533F240ad52694391583267ACAbc479C07",
    TokenAdminRegistry: "0x54eBB8F7E81305E1bBdDD03860A9a5D41312bB35",
    RegistryModuleOwner: "0xc5F62dF12F09dd4a0Ff3Ec85D54a28Be87759c9d",
    LINK: "0xe74037112db8807B3B4B3895F5790e5bc1866a29",
    WSBY: "0xbd5F3751856E11f3e80dBdA567Ef91Eb7e874791",
  },
  db: {
    url: process.env.DB_URL,
    prefix: "ccip-shibuya",
  },
};

export const configMinato = {
  rpcUrl: process.env.RPC_URL_MINATO,
  onRampAddress: "0xA68DF1dc2FfaBC3cB2cA822aa0d50b9e69FF1FaA",
  offRampAddress: "0x73933E9E3a3F948f08B8e49173eBe2BD4d5DEBb4",
  ccip: {
    Router: "0x443a1bce545d56E2c3f20ED32eA588395FFce0f4",
    ChainSelector: "686603546605904534",
    RMN: "0x6172F4f60eEE3876cF83318DEe4477BfAf15Ffd3",
    TokenAdminRegistry: "0xD2334a6f4f79CE462193EAcB89eB2c29Ae552750",
    RegistryModuleOwner: "0xe06fE3AEfef3a27b8BF0edd5ae834B006EdE3aa1",
    LINK: "0x7ea13478Ea3961A0e8b538cb05a9DF0477c79Cd2",
    WETH: "0x4200000000000000000000000000000000000006",
  },
  db: {
    url: process.env.DB_URL,
    prefix: "ccip-minato",
  },
};
export const config = configMinato;

export const ccipConfig = {
  minato: {
    Router: "0x443a1bce545d56E2c3f20ED32eA588395FFce0f4",
    ChainSelector: "686603546605904534",
    RMN: "0x6172F4f60eEE3876cF83318DEe4477BfAf15Ffd3",
    TokenAdminRegistry: "0xD2334a6f4f79CE462193EAcB89eB2c29Ae552750",
    RegistryModuleOwner: "0xe06fE3AEfef3a27b8BF0edd5ae834B006EdE3aa1",
    LINK: "0x7ea13478Ea3961A0e8b538cb05a9DF0477c79Cd2",
    WETH: "0x4200000000000000000000000000000000000006",
  },
  shibuya: {
    Router: "0x22aE550d87eBf775E0c1fDc8881121c8A51F5903",
    ChainSelector: "6955638871347136141",
    RMN: "0xc96ac0533F240ad52694391583267ACAbc479C07",
    TokenAdminRegistry: "0x54eBB8F7E81305E1bBdDD03860A9a5D41312bB35",
    RegistryModuleOwner: "0xc5F62dF12F09dd4a0Ff3Ec85D54a28Be87759c9d",
    LINK: "0xe74037112db8807B3B4B3895F5790e5bc1866a29",
    WSBY: "0xbd5F3751856E11f3e80dBdA567Ef91Eb7e874791",
  },
};
