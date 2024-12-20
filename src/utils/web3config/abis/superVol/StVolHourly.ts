export const StVolHourlyABI = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "target",
        type: "address",
      },
    ],
    name: "AddressEmptyCode",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address",
      },
    ],
    name: "AddressInsufficientBalance",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "implementation",
        type: "address",
      },
    ],
    name: "ERC1967InvalidImplementation",
    type: "error",
  },
  {
    inputs: [],
    name: "ERC1967NonPayable",
    type: "error",
  },
  {
    inputs: [],
    name: "EnforcedPause",
    type: "error",
  },
  {
    inputs: [],
    name: "ExpectedPause",
    type: "error",
  },
  {
    inputs: [],
    name: "FailedInnerCall",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidInitialization",
    type: "error",
  },
  {
    inputs: [],
    name: "NotInitializing",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address",
      },
    ],
    name: "OwnableInvalidOwner",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address",
      },
    ],
    name: "OwnableUnauthorizedAccount",
    type: "error",
  },
  {
    inputs: [],
    name: "ReentrancyGuardReentrantCall",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
    ],
    name: "SafeERC20FailedOperation",
    type: "error",
  },
  {
    inputs: [],
    name: "UUPSUnauthorizedCallContext",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "slot",
        type: "bytes32",
      },
    ],
    name: "UUPSUnsupportedProxiableUUID",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "from",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "result",
        type: "uint256",
      },
    ],
    name: "Deposit",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "from",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "expirationEpoch",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "result",
        type: "uint256",
      },
    ],
    name: "DepositCoupon",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "epoch",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "productId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "price",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "timestamp",
        type: "uint256",
      },
    ],
    name: "EndRound",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint64",
        name: "version",
        type: "uint64",
      },
    ],
    name: "Initialized",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "idx",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "epoch",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "prevBalance",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "newBalance",
        type: "uint256",
      },
    ],
    name: "OrderSettled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address",
      },
    ],
    name: "OwnershipTransferred",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address",
      },
    ],
    name: "Paused",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "epoch",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "orderCount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "collectedFee",
        type: "uint256",
      },
    ],
    name: "RoundSettled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "epoch",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "productId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "price",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "timestamp",
        type: "uint256",
      },
    ],
    name: "StartRound",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address",
      },
    ],
    name: "Unpaused",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "implementation",
        type: "address",
      },
    ],
    name: "Upgraded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "to",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "result",
        type: "uint256",
      },
    ],
    name: "Withdraw",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "WithdrawalApproved",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "WithdrawalRejected",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "WithdrawalRequested",
    type: "event",
  },
  {
    inputs: [],
    name: "UPGRADE_INTERFACE_VERSION",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "addresses",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
      {
        internalType: "address",
        name: "",
        type: "address",
      },
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "idx",
        type: "uint256",
      },
    ],
    name: "approveWithdrawal",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address",
      },
    ],
    name: "balanceOf",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address",
      },
    ],
    name: "balances",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "claimTreasury",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "commissionfee",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "epoch",
        type: "uint256",
      },
    ],
    name: "countUnsettledFilledOrders",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address",
      },
    ],
    name: "couponBalanceOf",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "couponHolders",
    outputs: [
      {
        internalType: "address[]",
        name: "",
        type: "address[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "currentEpoch",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "expirationEpoch",
        type: "uint256",
      },
    ],
    name: "depositCouponTo",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "depositTo",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes[]",
        name: "priceUpdateData",
        type: "bytes[]",
      },
      {
        internalType: "uint64",
        name: "initDate",
        type: "uint64",
      },
      {
        internalType: "bool",
        name: "skipSettlement",
        type: "bool",
      },
    ],
    name: "executeRound",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256[]",
        name: "epochList",
        type: "uint256[]",
      },
    ],
    name: "fillSettlementResult",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "epoch",
        type: "uint256",
      },
    ],
    name: "filledOrders",
    outputs: [
      {
        components: [
          {
            internalType: "uint256",
            name: "idx",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "epoch",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "productId",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "strike",
            type: "uint256",
          },
          {
            internalType: "address",
            name: "overUser",
            type: "address",
          },
          {
            internalType: "address",
            name: "underUser",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "overPrice",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "underPrice",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "unit",
            type: "uint256",
          },
          {
            internalType: "bool",
            name: "isSettled",
            type: "bool",
          },
        ],
        internalType: "struct StVolHourly.FilledOrder[]",
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "epoch",
        type: "uint256",
      },
    ],
    name: "filledOrdersWithResult",
    outputs: [
      {
        components: [
          {
            internalType: "uint256",
            name: "idx",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "epoch",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "productId",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "strike",
            type: "uint256",
          },
          {
            internalType: "address",
            name: "overUser",
            type: "address",
          },
          {
            internalType: "address",
            name: "underUser",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "overPrice",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "underPrice",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "unit",
            type: "uint256",
          },
          {
            internalType: "bool",
            name: "isSettled",
            type: "bool",
          },
        ],
        internalType: "struct StVolHourly.FilledOrder[]",
        name: "",
        type: "tuple[]",
      },
      {
        components: [
          {
            internalType: "uint256",
            name: "idx",
            type: "uint256",
          },
          {
            internalType: "enum StVolHourly.WinPosition",
            name: "winPosition",
            type: "uint8",
          },
          {
            internalType: "uint256",
            name: "winAmount",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "feeRate",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "fee",
            type: "uint256",
          },
        ],
        internalType: "struct StVolHourly.SettlementResult[]",
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "forceWithdrawAll",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "from",
        type: "uint256",
      },
    ],
    name: "getWithdrawalRequests",
    outputs: [
      {
        components: [
          {
            internalType: "uint256",
            name: "idx",
            type: "uint256",
          },
          {
            internalType: "address",
            name: "user",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "amount",
            type: "uint256",
          },
          {
            internalType: "bool",
            name: "processed",
            type: "bool",
          },
          {
            internalType: "string",
            name: "message",
            type: "string",
          },
          {
            internalType: "uint256",
            name: "created",
            type: "uint256",
          },
        ],
        internalType: "struct StVolHourly.WithdrawalRequest[]",
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_oracleAddress",
        type: "address",
      },
      {
        internalType: "address",
        name: "_adminAddress",
        type: "address",
      },
      {
        internalType: "address",
        name: "_operatorAddress",
        type: "address",
      },
      {
        internalType: "address",
        name: "_operatorVaultAddress",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_commissionfee",
        type: "uint256",
      },
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "lastFilledOrderId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "lastSettledFilledOrderId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "pause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "paused",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "proxiableUUID",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "reclaimAllExpiredCoupons",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address",
      },
    ],
    name: "reclaimExpiredCoupons",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "idx",
        type: "uint256",
      },
      {
        internalType: "string",
        name: "reason",
        type: "string",
      },
    ],
    name: "rejectWithdrawal",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "requestWithdrawal",
    outputs: [
      {
        components: [
          {
            internalType: "uint256",
            name: "idx",
            type: "uint256",
          },
          {
            internalType: "address",
            name: "user",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "amount",
            type: "uint256",
          },
          {
            internalType: "bool",
            name: "processed",
            type: "bool",
          },
          {
            internalType: "string",
            name: "message",
            type: "string",
          },
          {
            internalType: "uint256",
            name: "created",
            type: "uint256",
          },
        ],
        internalType: "struct StVolHourly.WithdrawalRequest",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "retrieveMisplacedETH",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_token",
        type: "address",
      },
    ],
    name: "retrieveMisplacedTokens",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "epoch",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "productId",
        type: "uint256",
      },
    ],
    name: "rounds",
    outputs: [
      {
        components: [
          {
            internalType: "uint256",
            name: "epoch",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "startTimestamp",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "endTimestamp",
            type: "uint256",
          },
          {
            internalType: "bool",
            name: "isSettled",
            type: "bool",
          },
          {
            internalType: "uint256",
            name: "startPrice",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "endPrice",
            type: "uint256",
          },
          {
            internalType: "bool",
            name: "isStarted",
            type: "bool",
          },
        ],
        internalType: "struct StVolHourly.ProductRound",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_adminAddress",
        type: "address",
      },
    ],
    name: "setAdmin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_commissionfee",
        type: "uint256",
      },
    ],
    name: "setCommissionfee",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_operatorAddress",
        type: "address",
      },
    ],
    name: "setOperator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_operatorVaultAddress",
        type: "address",
      },
    ],
    name: "setOperatorVault",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_oracle",
        type: "address",
      },
    ],
    name: "setOracle",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_token",
        type: "address",
      },
    ],
    name: "setToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "epoch",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "size",
        type: "uint256",
      },
    ],
    name: "settleFilledOrders",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "uint256",
            name: "idx",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "epoch",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "productId",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "strike",
            type: "uint256",
          },
          {
            internalType: "address",
            name: "overUser",
            type: "address",
          },
          {
            internalType: "address",
            name: "underUser",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "overPrice",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "underPrice",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "unit",
            type: "uint256",
          },
          {
            internalType: "bool",
            name: "isSettled",
            type: "bool",
          },
        ],
        internalType: "struct StVolHourly.FilledOrder[]",
        name: "transactions",
        type: "tuple[]",
      },
    ],
    name: "submitFilledOrders",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newOwner",
        type: "address",
      },
    ],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "treasuryAmount",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "unpause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newImplementation",
        type: "address",
      },
      {
        internalType: "bytes",
        name: "data",
        type: "bytes",
      },
    ],
    name: "upgradeToAndCall",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address",
      },
    ],
    name: "userCoupons",
    outputs: [
      {
        components: [
          {
            internalType: "address",
            name: "user",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "amount",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "usedAmount",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "expirationEpoch",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "created",
            type: "uint256",
          },
          {
            internalType: "address",
            name: "issuer",
            type: "address",
          },
        ],
        internalType: "struct StVolHourly.Coupon[]",
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "epoch",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "user",
        type: "address",
      },
    ],
    name: "userFilledOrders",
    outputs: [
      {
        components: [
          {
            internalType: "uint256",
            name: "idx",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "epoch",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "productId",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "strike",
            type: "uint256",
          },
          {
            internalType: "address",
            name: "overUser",
            type: "address",
          },
          {
            internalType: "address",
            name: "underUser",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "overPrice",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "underPrice",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "unit",
            type: "uint256",
          },
          {
            internalType: "bool",
            name: "isSettled",
            type: "bool",
          },
        ],
        internalType: "struct StVolHourly.FilledOrder[]",
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];
