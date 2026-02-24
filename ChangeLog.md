# ChangeLog

## 2026-02-24

### 优化 (Enhancements)
- **`src/web3/ethersTxHelper.ts` (EthersTxHelper 解析与交易体验优化):**
  1. 优化了 `sendTransaction` (包含 `sendWithBrowserProvider` 和 `sendWithPrivateKey`) 方法。去除了方法中默认执行的 `await tx_response.wait()`，改为接收并使用可选参数 `waitConfirm?: boolean` 来决定是否在库内部等待交易上链打包。现在前端能够立即获得 `TransactionResponse` 从而展示交易哈希，大大提升了前端的交互体验。
  2. 修复并优化了 `deployContract` 方法。原代码中硬编码使用 `new ethers.Wallet(this.private_key || '', this.web3);` 在基于 `BrowserProvider` (如 MetaMask 环境) 时会导致抛错。现在加入了自动判断，检测到 `BrowserProvider` 时将使用 `await this.web3.getSigner()`。
  3. 清理重构了 ABI 数据解码函数。原先 `decodeDataByABI` 和 `decodeResultDataByABI` 全都是进行解码 Result 输出的操作，存在语义混淆与代码冗余。现已将其修正并拆分为针对返回数据的 `decodeResultDataByABI`，以及专用于解析输入 Tx payload 数据的 `decodeInputDataByABI` 方法。
  4. 加强了 `callReadContract` 和 `callStaticContract` 的错误捕捉。现在除了抛出原错误字符串，还会提取 `error?.message` 提供更清晰的引发原因输出。
  5. 更正了提供者类型的鉴别支持，拓展构造函数允许 `ethers.JsonRpcProvider` 类型实例的直接传入以提高接口的通用性。
- **`src/web3/(ethersTxBatchHelper.ts | ethersLogSyncHelper.ts | ethersLogHelper.ts | erc20Helper.ts)` (Ethers 系列 Helper 代码类型与风格跟进优化):**
  1. 优化了 `EthersTxBatchHelper`：将其构造函数签名与 `EthersTxHelper` 对齐，补充了 `ethers.JsonRpcProvider` 的参数兼容；修复了 `batchStaticCall` 解码时潜在的 `undefined` 越界读取报错，提升类型与运行安全性。
  2. 优化了 `EthersLogHelper`：修复了类型导出缺少 `type` 关键字的隔离模块语法警告；优化构造函数类型；增强并修复了按 `filter.topics` 过滤时参数未校验 `undefined` 报出的类型警告。
  3. 优化了 `EthersLogSyncHelper`：对齐了构造函数的 `node_provider` 类型签名（接受 `BrowserProvider` / `JsonRpcProvider` 等实例），并修复对应的 `ethers` 类型包导入缺失。
  4. 优化了 `ERC20Helper`：统一了构造函数的入参类型兼容性，移除了冗余的空参数 `execute_args: []` 参数赋值代码；给 `getName`、`getSymbol` 和 `getDecimals` 添加了 `@memoryCache(24 * 60 * 60)` 缓存修饰器，避免重复请求网络带来的阻塞和消耗，大幅提高批量执行下的查询读取性能。
