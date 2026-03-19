import { describe, expect, it, afterEach, vi } from "vitest";
import { ethers } from "ethers";
import {
  EthersLogHelper,
  type ParsedContractLog,
} from "../../src/web3/ethersLogHelper";
import {
  EthersLogSyncHelper,
  type EthersLogSyncHelperConfig,
} from "../../src/web3/ethersLogSyncHelper";

interface TestStoredLogRecord {
  name?: string;
  blockNumber?: number;
  args?: ArrayLike<unknown> | null;
  [key: string]: unknown;
}

interface TestKVStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  putMany(entries: Array<[string, unknown]>): Promise<void>;
  getWithPrefix<T = unknown>(
    prefix: string,
  ): Promise<
    Record<string, T | { value: T; created_at: Date; updated_at: Date }>
  >;
  scan<T = unknown>(options?: {
    cursor?: string;
    limit?: number;
    order_by?: "ASC" | "DESC";
    prefix?: string;
    include_timestamps?: boolean;
  }): Promise<{
    data: Record<string, T | { value: T; created_at: Date; updated_at: Date }>;
    next_cursor: string | null;
  }>;
  close(): Promise<void>;
}

class TestEthersLogSyncHelper extends EthersLogSyncHelper {
  constructor(
    provider: ethers.JsonRpcProvider,
    private readonly stores: Record<string, TestKVStore>,
    config: EthersLogSyncHelperConfig = {},
  ) {
    super(provider, config);
  }

  protected override async createDB(table: string): Promise<TestKVStore> {
    const store = this.stores[table];
    if (!store) {
      throw new Error(`Missing test store for table: ${table}`);
    }

    return store;
  }
}

function createMemoryStore(
  records: Record<string, TestStoredLogRecord>,
  options?: {
    scanCalls?: Array<{
      cursor?: string;
      limit?: number;
      order_by?: "ASC" | "DESC";
      prefix?: string;
      include_timestamps?: boolean;
    }>;
    onClose?: () => void;
  },
): TestKVStore {
  const getSortedKeys = () =>
    Object.keys(records).sort((left, right) => left.localeCompare(right));

  return {
    async get<T = unknown>(key: string) {
      return records[key] as T | undefined;
    },
    async put(key: string, value: unknown) {
      records[key] = value as TestStoredLogRecord;
    },
    async putMany(entries: Array<[string, unknown]>) {
      for (const [key, value] of entries) {
        records[key] = value as TestStoredLogRecord;
      }
    },
    async getWithPrefix<T = unknown>(prefix: string) {
      return getSortedKeys()
        .filter((key) => key.startsWith(prefix))
        .reduce(
          (acc, key) => {
            acc[key] = records[key] as T;
            return acc;
          },
          {} as Record<string, T>,
        );
    },
    async scan<T = unknown>(scanOptions) {
      if (scanOptions && options?.scanCalls) {
        options.scanCalls.push({ ...scanOptions });
      }

      const order_by = scanOptions?.order_by === "DESC" ? "DESC" : "ASC";
      const limit = Math.max(1, Math.floor(scanOptions?.limit ?? 100));
      const prefixedKeys = getSortedKeys().filter((key) =>
        scanOptions?.prefix ? key.startsWith(scanOptions.prefix) : true,
      );
      const orderedKeys =
        order_by === "DESC" ? [...prefixedKeys].reverse() : prefixedKeys;
      const startIndex = scanOptions?.cursor
        ? orderedKeys.findIndex((key) => key === scanOptions.cursor) + 1
        : 0;
      const pageKeys = orderedKeys.slice(startIndex, startIndex + limit + 1);
      const hasMore = pageKeys.length > limit;
      const visibleKeys = hasMore ? pageKeys.slice(0, limit) : pageKeys;
      const data = visibleKeys.reduce(
        (acc, key) => {
          acc[key] = records[key] as T;
          return acc;
        },
        {} as Record<string, T>,
      );

      return {
        data,
        next_cursor: hasMore
          ? (visibleKeys[visibleKeys.length - 1] ?? null)
          : null,
      };
    },
    async close() {
      options?.onClose?.();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EthersLogSyncHelper", () => {
  it("does not cache current block height", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    let currentBlock = 100;
    vi.spyOn(provider, "getBlockNumber").mockImplementation(
      async () => currentBlock++,
    );

    const helper = new EthersLogSyncHelper(provider);

    await expect(helper.getCurrentBlock()).resolves.toBe(100);
    await expect(helper.getCurrentBlock()).resolves.toBe(101);
  });

  it("filters stored logs after scanning instead of before pagination", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const records: Record<string, TestStoredLogRecord> = {};

    for (let index = 0; index < 1000; index++) {
      records[`custom_${String(index).padStart(4, "0")}`] = {
        name: "Transfer",
        blockNumber: index,
        args: ["skip"],
      };
    }

    records["custom_1000"] = {
      name: "Transfer",
      blockNumber: 1000,
      args: ["match"],
    };
    records["custom_1001"] = {
      name: "Transfer",
      blockNumber: 1001,
      args: ["match"],
    };

    const helper = new TestEthersLogSyncHelper(provider, {
      test_contract: createMemoryStore(records),
      metadata: createMemoryStore({
        test_contract: {
          start_block: 1002,
        },
      }),
    });

    const result = await helper.getLogs({
      contract_address: "test_contract",
      event_name: "Transfer",
      limit: 1,
      offset: 0,
      args: ["match"],
    });

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]?.blockNumber).toBe(1000);
    expect(result.total_count).toBe(2);
  });

  it("maps contract addresses to safe table names", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const requestedTables: string[] = [];

    class CaptureTableHelper extends EthersLogSyncHelper {
      protected override async createDB(table: string): Promise<TestKVStore> {
        requestedTables.push(table);
        return createMemoryStore({});
      }
    }

    const helper = new CaptureTableHelper(provider);

    await helper.getContractDB("0x00000000000000000000000000000000000000AA");

    expect(requestedTables).toEqual([
      "metadata",
      "contract_00000000000000000000000000000000000000aa",
    ]);
  });

  it("uses event key prefixes for indexed storage queries", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const contractAddress = "0x00000000000000000000000000000000000000AA";
    const contractKey = contractAddress.toLowerCase();
    const scanCalls: Array<{
      cursor?: string;
      limit?: number;
      order_by?: "ASC" | "DESC";
      prefix?: string;
      include_timestamps?: boolean;
    }> = [];

    const helper = new TestEthersLogSyncHelper(provider, {
      contract_00000000000000000000000000000000000000aa: createMemoryStore(
        {
          "event:Transfer:00000000000000001000:0000000000:0000000000:0x1": {
            name: "Transfer",
            blockNumber: 1000,
            args: ["match"],
          },
          "event:Approval:00000000000000001001:0000000000:0000000000:0x2": {
            name: "Approval",
            blockNumber: 1001,
            args: ["skip"],
          },
        },
        { scanCalls },
      ),
      metadata: createMemoryStore({
        [contractKey]: {
          start_block: 1002,
          key_strategy: "event_block_index",
        },
      }),
    });

    const result = await helper.getLogs({
      contract_address: contractAddress,
      event_name: "Transfer",
    });

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]?.name).toBe("Transfer");
    expect(scanCalls[0]?.prefix).toBe("event:Transfer:");
  });

  it("narrows indexed storage scans with a block range prefix", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const contractAddress = "0x00000000000000000000000000000000000000AA";
    const contractKey = contractAddress.toLowerCase();
    const scanCalls: Array<{
      cursor?: string;
      limit?: number;
      order_by?: "ASC" | "DESC";
      prefix?: string;
      include_timestamps?: boolean;
    }> = [];

    const helper = new TestEthersLogSyncHelper(provider, {
      contract_00000000000000000000000000000000000000aa: createMemoryStore(
        {
          "event:Transfer:00000000000000001000:0000000000:0000000000:0x1": {
            name: "Transfer",
            blockNumber: 1000,
            args: ["match"],
          },
          "event:Transfer:00000000000000001999:0000000000:0000000000:0x2": {
            name: "Transfer",
            blockNumber: 1999,
            args: ["match"],
          },
          "event:Transfer:00000000000000002000:0000000000:0000000000:0x3": {
            name: "Transfer",
            blockNumber: 2000,
            args: ["skip"],
          },
        },
        { scanCalls },
      ),
      metadata: createMemoryStore({
        [contractKey]: {
          start_block: 2001,
          key_strategy: "event_block_index",
        },
      }),
    });

    const result = await helper.getLogs({
      contract_address: contractAddress,
      event_name: "Transfer",
      start_block: 1000,
      to_block: 1999,
    });

    expect(result.logs).toHaveLength(2);
    expect(scanCalls[0]?.prefix).toBe("event:Transfer:00000000000000001");
  });

  it("stores new syncs with indexed keys and remembers the strategy", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const contractAddress = "0x00000000000000000000000000000000000000AA";
    const contractKey = contractAddress.toLowerCase();
    const contractTable = "contract_00000000000000000000000000000000000000aa";
    const storedLogs: Record<string, TestStoredLogRecord> = {};
    const metadataRecords: Record<string, TestStoredLogRecord> = {};

    class SyncStubHelper extends TestEthersLogSyncHelper {
      override async getCurrentBlock() {
        return 1000;
      }

      override async getContractLogs(): Promise<ParsedContractLog[]> {
        return [
          {
            provider,
            transactionHash: `0x${"11".repeat(32)}`,
            blockHash: `0x${"aa".repeat(32)}`,
            blockNumber: 1000,
            removed: false,
            address: contractAddress,
            data: "0x",
            topics: [ethers.id("Transfer(address,address,uint256)")],
            index: 2,
            transactionIndex: 1,
            args: [] as any,
            name: "Transfer",
            signature: "Transfer(address,address,uint256)",
            decoded: true,
          } as ParsedContractLog,
        ];
      }
    }

    const helper = new SyncStubHelper(provider, {
      [contractTable]: createMemoryStore(storedLogs),
      metadata: createMemoryStore(metadataRecords),
    });

    await helper.syncLogs({
      contract_address: contractAddress,
      abi: [
        "event Transfer(address indexed from,address indexed to,uint256 value)",
      ],
    });

    expect(Object.keys(storedLogs)).toEqual([
      `event:Transfer:00000000000000001000:0000000001:0000000002:0x${"11".repeat(32)}`,
    ]);
    expect(metadataRecords[contractKey]).toMatchObject({
      start_block: 1001,
      nonce: 1,
      key_strategy: "event_block_index",
    });
  });

  it("respects configured confirmation lag when syncing", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const contractAddress = "0x00000000000000000000000000000000000000AA";
    let capturedToBlock: unknown;

    class ConfirmationAwareHelper extends TestEthersLogSyncHelper {
      override async getCurrentBlock() {
        return 100;
      }

      override async getContractLogs(params: {
        filter?: { toBlock?: unknown };
      }): Promise<ParsedContractLog[]> {
        capturedToBlock = params.filter?.toBlock;
        return [];
      }
    }

    const helper = new ConfirmationAwareHelper(
      provider,
      {
        contract_00000000000000000000000000000000000000aa: createMemoryStore({}),
        metadata: createMemoryStore({}),
      },
      {
        confirmations: 12,
      },
    );

    const result = await helper.syncLogs({
      contract_address: contractAddress,
      abi: ["event Transfer(address indexed from,address indexed to,uint256 value)"],
    });

    expect(capturedToBlock).toBe(88);
    expect(result.to_block).toBe(88);
  });

  it("can sync against the safe block tag", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const contractAddress = "0x00000000000000000000000000000000000000AA";
    let capturedToBlock: unknown;

    vi.spyOn(provider, "getBlock").mockImplementation(async (tag) => {
      if (tag === "safe") {
        return { number: 91 } as any;
      }

      throw new Error(`unexpected tag: ${String(tag)}`);
    });

    class SafeTagHelper extends TestEthersLogSyncHelper {
      override async getContractLogs(params: {
        filter?: { toBlock?: unknown };
      }): Promise<ParsedContractLog[]> {
        capturedToBlock = params.filter?.toBlock;
        return [];
      }
    }

    const helper = new SafeTagHelper(
      provider,
      {
        contract_00000000000000000000000000000000000000aa: createMemoryStore({}),
        metadata: createMemoryStore({}),
      },
      {
        sync_block_tag: "safe",
      },
    );

    const result = await helper.syncLogs({
      contract_address: contractAddress,
      abi: ["event Transfer(address indexed from,address indexed to,uint256 value)"],
    });

    expect(capturedToBlock).toBe(91);
    expect(result.to_block).toBe(91);
  });

  it("stops scanning early for getAllLogs when total count is not needed", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const contractAddress = "0x00000000000000000000000000000000000000AA";
    const contractKey = contractAddress.toLowerCase();
    const scanCalls: Array<{
      cursor?: string;
      limit?: number;
      order_by?: "ASC" | "DESC";
      prefix?: string;
      include_timestamps?: boolean;
    }> = [];
    const records: Record<string, TestStoredLogRecord> = {};

    for (let index = 0; index < 2500; index++) {
      records[
        `event:Transfer:${String(index).padStart(20, "0")}:0000000000:0000000000:0x${String(index).padStart(64, "0")}`
      ] = {
        name: "Transfer",
        blockNumber: index,
        args: [],
      };
    }

    const helper = new TestEthersLogSyncHelper(provider, {
      contract_00000000000000000000000000000000000000aa: createMemoryStore(
        records,
        { scanCalls },
      ),
      metadata: createMemoryStore({
        [contractKey]: {
          start_block: 2500,
          key_strategy: "event_block_index",
        },
      }),
    });

    const logs = await helper.getAllLogs({
      contract_address: contractAddress,
      event_name: "Transfer",
      limit: 1,
      offset: 1000,
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.blockNumber).toBe(1000);
    expect(scanCalls).toHaveLength(2);
  });

  it("queries recent logs without reopening metadata twice", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const requestedTables: string[] = [];
    const contractAddress = "0x00000000000000000000000000000000000000AA";
    const contractKey = contractAddress.toLowerCase();

    class RecentLogsHelper extends EthersLogSyncHelper {
      constructor() {
        super(provider, {});
      }

      protected override async createDB(table: string): Promise<TestKVStore> {
        requestedTables.push(table);

        if (table === "metadata") {
          return createMemoryStore({
            [contractKey]: {
              start_block: 120,
              key_strategy: "event_block_index",
            },
          });
        }

        return createMemoryStore({
          "event:Transfer:00000000000000000119:0000000000:0000000000:0x1": {
            name: "Transfer",
            blockNumber: 119,
            args: [],
          },
        });
      }
    }

    const helper = new RecentLogsHelper();

    const result = await helper.getRecentLogs({
      contract_address: contractAddress,
      event_name: "Transfer",
      block_range: 10,
    });

    expect(result.logs).toHaveLength(1);
    expect(requestedTables).toEqual([
      "metadata",
      "contract_00000000000000000000000000000000000000aa",
    ]);
  });

  it("can reuse DB instances and close them explicitly", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const contractAddress = "0x00000000000000000000000000000000000000AA";
    const contractKey = contractAddress.toLowerCase();
    const contractTable = "contract_00000000000000000000000000000000000000aa";
    const createCalls: string[] = [];
    const closeCounts: Record<string, number> = {};

    class ReuseDBHelper extends EthersLogSyncHelper {
      constructor() {
        super(provider, { reuse_db_instances: true });
      }

      protected override async createDB(table: string): Promise<TestKVStore> {
        createCalls.push(table);

        return createMemoryStore(
          table === "metadata"
            ? {
                [contractKey]: {
                  start_block: 120,
                  key_strategy: "event_block_index",
                },
              }
            : {
                "event:Transfer:00000000000000000119:0000000000:0000000000:0x1":
                  {
                    name: "Transfer",
                    blockNumber: 119,
                    args: [],
                  },
              },
          {
            onClose: () => {
              closeCounts[table] = (closeCounts[table] ?? 0) + 1;
            },
          },
        );
      }
    }

    const helper = new ReuseDBHelper();

    await helper.getRecentLogs({
      contract_address: contractAddress,
      event_name: "Transfer",
      block_range: 10,
    });
    await helper.getRecentLogs({
      contract_address: contractAddress,
      event_name: "Transfer",
      block_range: 10,
    });

    expect(createCalls).toEqual(["metadata", contractTable]);

    await helper.closeAllDBs();

    expect(closeCounts).toEqual({
      metadata: 1,
      [contractTable]: 1,
    });

    await helper.getRecentLogs({
      contract_address: contractAddress,
      event_name: "Transfer",
      block_range: 10,
    });

    expect(createCalls).toEqual([
      "metadata",
      contractTable,
      "metadata",
      contractTable,
    ]);
  });
});

describe("EthersLogHelper", () => {
  it("throws when a single block log query fails instead of skipping it", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    vi.spyOn(provider, "getBlockNumber").mockResolvedValue(12);
    vi.spyOn(provider, "getLogs").mockRejectedValue(new Error("rpc failed"));

    const helper = new EthersLogHelper(provider);

    await expect(
      helper.getContractLogs({
        contract_addresses: "0x0000000000000000000000000000000000000001",
        abi: [
          "event Transfer(address indexed from,address indexed to,uint256 value)",
        ],
        event_names: "Transfer",
        filter: {
          fromBlock: 12,
          toBlock: 12,
        },
      }),
    ).rejects.toThrow("无法获取区块 12 的日志");
  });

  it("builds separate precise queries for per-event topic maps", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const getLogsSpy = vi.spyOn(provider, "getLogs").mockResolvedValue([]);
    vi.spyOn(provider, "getBlockNumber").mockResolvedValue(10);

    const helper = new EthersLogHelper(provider);
    const abi = [
      "event Foo(address indexed user)",
      "event Bar(uint256 indexed id)",
    ];

    await expect(
      helper.getContractLogs({
        contract_addresses: "0x0000000000000000000000000000000000000001",
        abi,
        event_names: ["Foo", "Bar"],
        filter: {
          topics: {
            Foo: ["0x00000000000000000000000000000000000000AA"],
            Bar: [1n],
          },
        },
      }),
    ).resolves.toEqual([] as ParsedContractLog[]);

    expect(getLogsSpy).toHaveBeenCalledTimes(2);
    expect(getLogsSpy.mock.calls[0]?.[0].topics).toEqual([
      ethers.id("Foo(address)"),
      ethers.zeroPadValue("0x00000000000000000000000000000000000000AA", 32),
    ]);
    expect(getLogsSpy.mock.calls[1]?.[0].topics).toEqual([
      ethers.id("Bar(uint256)"),
      ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [1n]),
    ]);
  });

  it("returns multi-plan results in chain order", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    vi.spyOn(provider, "getBlockNumber").mockResolvedValue(30);

    const fooAt10 = {
      provider,
      transactionHash: `0x${"11".repeat(32)}`,
      blockHash: `0x${"aa".repeat(32)}`,
      blockNumber: 10,
      removed: false,
      address: "0x0000000000000000000000000000000000000001",
      data: "0x",
      topics: [
        ethers.id("Foo(address)"),
        ethers.zeroPadValue("0x00000000000000000000000000000000000000AA", 32),
      ],
      index: 0,
      transactionIndex: 0,
    };
    const fooAt30 = {
      ...fooAt10,
      transactionHash: `0x${"22".repeat(32)}`,
      blockHash: `0x${"bb".repeat(32)}`,
      blockNumber: 30,
    };
    const barAt20 = {
      ...fooAt10,
      transactionHash: `0x${"33".repeat(32)}`,
      blockHash: `0x${"cc".repeat(32)}`,
      blockNumber: 20,
      topics: [
        ethers.id("Bar(uint256)"),
        ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [1n]),
      ],
    };

    const getLogsSpy = vi.spyOn(provider, "getLogs");
    getLogsSpy.mockResolvedValueOnce([fooAt10, fooAt30] as any);
    getLogsSpy.mockResolvedValueOnce([barAt20] as any);

    const helper = new EthersLogHelper(provider);

    const result = await helper.getContractLogs({
      contract_addresses: "0x0000000000000000000000000000000000000001",
      abi: [
        "event Foo(address indexed user)",
        "event Bar(uint256 indexed id)",
      ],
      event_names: ["Foo", "Bar"],
      filter: {
        topics: {
          Foo: ["0x00000000000000000000000000000000000000AA"],
          Bar: [1n],
        },
      },
    });

    expect(result.map((log) => [log.name, log.blockNumber])).toEqual([
      ["Foo", 10],
      ["Bar", 20],
      ["Foo", 30],
    ]);
  });

  it("uses adaptive batching for raw log queries", async () => {
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const getLogsSpy = vi.spyOn(provider, "getLogs").mockImplementation(
      async (filter) => {
        const fromBlock = Number(filter.fromBlock);
        const toBlock = Number(filter.toBlock);

        if (toBlock - fromBlock >= 4) {
          throw new Error("range too large");
        }

        return [];
      },
    );
    vi.spyOn(provider, "getBlockNumber").mockResolvedValue(8);

    const helper = new EthersLogHelper(provider);

    await expect(
      helper.getRawContractLogs({
        contract_addresses: "0x0000000000000000000000000000000000000001",
        event_signatures: "Transfer(address,address,uint256)",
        filter: {
          fromBlock: 1,
          toBlock: 8,
        },
        initial_batch_size: 8,
      }),
    ).resolves.toEqual([]);

    expect(getLogsSpy).toHaveBeenCalledTimes(3);
    expect(getLogsSpy.mock.calls.map(([filter]) => [
      Number(filter.fromBlock),
      Number(filter.toBlock),
    ])).toEqual([
      [1, 8],
      [1, 4],
      [5, 8],
    ]);
  });
});
