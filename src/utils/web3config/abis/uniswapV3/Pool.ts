export const POOL_ABI = [
  {
    inputs: [],
    name: "token0",
    outputs: [{ type: "address", name: "", internalType: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token1",
    outputs: [{ type: "address", name: "", internalType: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "fee",
    outputs: [{ type: "uint24", name: "", internalType: "uint24" }],
    stateMutability: "view",
    type: "function",
  },
  // 流动性和价格相关查询
  {
    inputs: [],
    name: "liquidity",
    outputs: [{ type: "uint128", name: "", internalType: "uint128" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "slot0",
    outputs: [
      { type: "uint160", name: "sqrtPriceX96", internalType: "uint160" },
      { type: "int24", name: "tick", internalType: "int24" },
      { type: "uint16", name: "observationIndex", internalType: "uint16" },
      {
        type: "uint16",
        name: "observationCardinality",
        internalType: "uint16",
      },
      {
        type: "uint16",
        name: "observationCardinalityNext",
        internalType: "uint16",
      },
      { type: "uint8", name: "feeProtocol", internalType: "uint8" },
      { type: "bool", name: "unlocked", internalType: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // 交易相关方法
  {
    inputs: [
      { type: "address", name: "recipient", internalType: "address" },
      { type: "bool", name: "zeroForOne", internalType: "bool" },
      { type: "int256", name: "amountSpecified", internalType: "int256" },
      { type: "uint160", name: "sqrtPriceLimitX96", internalType: "uint160" },
      { type: "bytes", name: "data", internalType: "bytes" },
    ],
    name: "swap",
    outputs: [
      { type: "int256", name: "amount0", internalType: "int256" },
      { type: "int256", name: "amount1", internalType: "int256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  // 流动性管理方法
  {
    inputs: [
      { type: "address", name: "recipient", internalType: "address" },
      { type: "int24", name: "tickLower", internalType: "int24" },
      { type: "int24", name: "tickUpper", internalType: "int24" },
      { type: "uint128", name: "amount", internalType: "uint128" },
      { type: "bytes", name: "data", internalType: "bytes" },
    ],
    name: "mint",
    outputs: [
      { type: "uint256", name: "amount0", internalType: "uint256" },
      { type: "uint256", name: "amount1", internalType: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { type: "int24", name: "tickLower", internalType: "int24" },
      { type: "int24", name: "tickUpper", internalType: "int24" },
      { type: "uint128", name: "amount", internalType: "uint128" },
    ],
    name: "burn",
    outputs: [
      { type: "uint256", name: "amount0", internalType: "uint256" },
      { type: "uint256", name: "amount1", internalType: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "tickSpacing",
    outputs: [{ type: "int24", name: "", internalType: "int24" }],
    stateMutability: "view",
    type: "function",
  },
];
