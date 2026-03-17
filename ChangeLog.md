# ChangeLog

## 2026-02-25 (S3 模块精简与上传 URL 生成增强)

### ⚠️ 重大变更 (Breaking Changes)
- **删除 `S3Sync` 模块**：移除了 `s3Sync.ts` 文件及所有文件夹同步功能（`SyncMode`、`SyncOperation`、`SyncOptions`、`SyncResult` 等类型一并移除）。
- **删除 `S3FolderUploader` 模块**：移除了 `s3FolderUploader.ts` 文件及文件夹批量上传功能（`FolderUploadOptions`、`FolderUploadResult`、`FolderUploadResultAdvanced` 等类型一并移除）。
- **移除 `IKVDatabase` 外部数据库依赖**：`S3Helper` 构造函数不再接受 `kvdb` 参数，防重复上传现改为内存 `Map` 实现（进程生命周期内有效）。
- **`uploadFile` / `uploadBuffer` 返回类型变更**：统一返回 `UploadResult`（含 `wasUploaded` 标记），而非原来的 `FileInfo`。
- **移除 `uploadFileAdvanced` / `uploadBufferAdvanced`**：防重复逻辑已内置于 `uploadFile` / `uploadBuffer`，无需高级版本。
- **移除 `uploadFileAndGetETag`**：为冗余封装，直接使用 `uploadFile` 获取 etag。
- **移除 `getLocalFiles` / `applyFileFilter`**：为 Sync 专用方法，已随模块一同移除。
- **工厂方法签名变更**：`createAWS`、`createCloudflareR2`、`createBackblazeB2`、`createMinIO` 均不再接受 `kvdb` 参数。

### 新增功能 (New Features)
1. **`S3UrlGenerator.generateOneTimeUploadUrl()`**：生成一次性预签名上传 URL，使用 UUID 构造唯一 S3 key 防止文件覆盖，支持自定义有效期。
2. **`S3UrlGenerator.generateReusableUploadUrl()`**：生成可重复使用的预签名上传 URL，使用固定 S3 key，在有效期内可多次上传（会覆盖同名文件）。
3. **`S3UrlGenerator.generateBatchOneTimeUploadUrls()`**：批量生成一次性上传 URL。
4. **`S3Helper.clearDedupCache()` / `getDedupCacheSize()`**：管理内存防重复缓存。
5. **新增类型 `PresignedUploadUrlOptions` / `PresignedUploadUrlResult`**：上传 URL 生成的选项与结果定义。

### 优化 (Enhancements)
1. **S3Helper 大幅精简**：从 1311 行精简至约 700 行，移除所有非核心功能。
2. **防重复上传零外部依赖**：使用内存 `Map<MD5, objectName>` 实现，无需配置任何外部 KV 数据库。
3. **`getPresignedUploadUrl` 增强**：支持传入 `contentType` 限制上传文件类型。
4. **移除冗余日志输出**：`S3UrlGenerator` 中移除了大量 `console.log` 调用，生产环境更干净。
5. **示例文件同步更新**：所有 `exmaples/s3Helper*.ts` 示例已适配新 API。

## 2026-02-25 (S3Helper 架构重构与 P0 修复)

### ⚠️ 重大变更 (Breaking Changes)
- **文件与架构拆分**：原先长达近 3000 行的 `s3Helper.ts` 已根据功能领域彻底拆分为多个高内聚、低耦合的类并统一存放于 `src/dbUtils/s3` 目录下：
  - `S3Helper` (核心)：负责与 S3/R2/B2 通信、桶管理、单文件基础编解码上传。
  - `S3Sync` (文件夹同步)：独立负责双向和单向的目录智能比对同步。
  - `S3FolderUploader` (按目录批传)：独立负责扫描本地系统进行并发图片/文件直传。
  - `S3UrlGenerator` (签名生成器)：独立负责单个和批量的带有过期设置的上传/下载/元数据签名 URL 构造。
  - `s3Types.ts`：纯接口定义、MIME 类型、常量字典与全局公共的 Typescript Enums 结构，确保循环依赖消除。
- `src/dbUtils/s3Helper.ts` 现在仅作为全量导出入口被保留以提供向后兼容性，原本直接依赖 `s3Helper.ts` 的业务逻辑不受影响。

### P0 修复 (Critical Fixes)
1. **修复 `uploadFile` 及 `uploadBuffer` 重复计算 MD5 问题**：移除了原逻辑中冗余计算两遍本地/内存流 MD5 的严重性能漏洞；通过 `tryGetCachedFile` 重用缓存，MD5 开销减半。
2. **修复大批量下触发 S3 `DeleteObjects` 请求限制**：AWS S3 原生接口存在每次最多操作 1000 个限制；已对 `deleteFiles` (级联影响 `clearBucket` 与 `deleteExpire`) 加入强行按 `1000` 切块的排队执行机制，避免运行时超限报错。
3. **修复 `calculateBufferMD5` 冗余的 Promise 包裹**：移除没必要的 `new Promise` 强制转换，改为纯同步计算并返回，避免由于大量微任务队列堆积引发的调度积压。

### 优化 (Enhancements)
1. **优化了 `fileExists` 异常检测**：去除了不可靠的 `error.message.includes` 定位机制；改为精确识别 `$metadata?.httpStatusCode === 404` 和 `NoSuchKey`，兼容不同提供商的异常载荷。
2. **重构签名 URL 批量生成结构**：清理了由于复制粘贴产生的近百行相似逻辑，重构成组合单对象复用逻辑 `generateUrlsForObject` 及统一的批任务分配器。
3. **清理 `uploadBuffer` 残留输出**：去除了 Debug 遗留的多处 `console.log`，净化生产环境控制台输出日志。
4. **统一 MIME 内容格式词典**：去除了原来在循环内部局部创建 `content_type_map` 对象造成的内存不断分配折损现象，将其提升固化由于静态常量字典进行查询。
## 2026-02-24 (web3Wallet.ts 架构重构 + P0 修复)

### ⚠️ 重大变更 (Breaking Changes)
- **依赖替换**：从已废弃的 `EthersUtils`（`deprecate/ethersUtils.ts`）迁移至新的 Helper 体系：
  - `EthersTxBatchHelper` — 替代合约调用、批量查询、HD 钱包派生功能
  - `EthersLogHelper` — 替代 `getContractLogs` 日志查询功能
- **数据库表名变更**：
  - `unexpect_wallet` → `unexpected_wallet`（修复拼写）
  - `achived_orders` → `archived_orders`（修复拼写）
  - `active_wallet` 表已移除（从未被使用）
- **`batchQueryBalances` 返回类型变更**：从 `any[]` 改为强类型 `BatchBalanceResult[]`

### P0 修复 (Critical Fixes)
1. **修复 `getNextWalletIndex()` 竞态条件**：并发调用 `createPaymentOrder` 时，两个请求可能读到相同的 `lastIndex` 导致分配同一个钱包地址。通过应用层 Promise 互斥锁保证索引分配的原子性。
2. **修复订单未归档导致 `orders_db` 无限膨胀**：
   - 已完成（PAID）订单自动归档到 `archived_orders_db`
   - 已过期（EXPIRED）订单在 `checkAllPendingOrders` 时自动归档
   - 已取消（CANCELLED）订单在 `cancelOrder` 时自动归档
   - `getPaymentStats` 和 `queryOrders` 现在同时查询活跃和归档订单，确保统计数据完整

### 优化 (Enhancements)
- **新增 `close()` 方法**：关闭所有 6 个数据库连接，防止连接泄漏
- **新增 `deriveWallet()` 私有方法**：本地实现 HD 钱包派生，不依赖外部工具类
- **新增 `queryTokenBalance()` 私有方法**：使用 `callReadContract` 替代 `getContract + getFunction` 调用链
- **`getOrderPaymentEvents` 性能优化**：从全量扫描 `getAll()` + `filter` 改为 `getWithPrefix()` 前缀查询
- **`collectFundsFromWallets` 类型安全优化**：使用强类型中间结构存储钱包信息，避免 `any` 类型
- **`queryOrders` 新增 `includeArchived` 选项**：允许选择是否包含归档订单
- **移除未使用的 `active_wallet_db`**：节省一个数据库连接和表
- **修正拼写错误**：`achived` → `archived`，`unexpect` → `unexpected`

### P1 修复 (Important Fixes)
1. **`getWallet()` 自动重试**：遇到有意外余额的钱包时不再直接抛出异常，而是自动跳过并尝试下一个钱包（最多重试 10 次），大幅改善调用方体验。

### P2 优化 (Performance)
1. **`checkAllPendingOrders` 查询优化**：从 `getAll()` 全量加载改为 `searchJson({ contains: { status: 'pending' } })`，仅查询 PENDING 状态的订单，减少内存占用和数据库IO。
2. **`checkAllPendingOrders` 过期订单批量归档**：使用 `Promise.all` 并发归档过期订单，替代串行逐个归档。
3. **`checkAllPendingOrders` 避免冗余 hash 计算**：改为直接使用数据库记录的 key 作为 orderHash，省去每条记录的 `generateOrderHash` 调用。
4. **`collectFundsFromWallets` 并发归集**：从串行发送交易改为 `Promise.allSettled` 并发发送，钱包数量多时效率大幅提升。



## 2026-02-24 (web3Wallet.ts 全量 TypeScript 错误修复)

### Bug 修复 (Bug Fixes)
- **`src/web3/wallet/web3Wallet.ts`** — 修复所有 TypeScript 编译错误（共 20 项），零报错通过：
  1. **`noUncheckedIndexedAccess` — Contract 方法调用**：`this.token.balanceOf(...)` 及 `tokenContract.transfer(...)` 在严格模式下被推断为 `ContractMethod | undefined`。改用 `contract.getFunction('methodName')(...)` 绕过下标访问，同时保持运行时行为完全一致。
  2. **`.set()` 方法不存在**：`PGKVDatabase` 没有 `set()` 方法，正确 API 为 `put()`。3 处调用（`events_db`、`orders_db`、`cancelOrder` 中）全部修正为 `.put()`。
  3. **`topics` 数组中的 `null` 值**：`getContractLogs` 的 `topics` 类型为 `string[]`，不允许 `null`。用 `null as unknown as string` 做类型转换，保留"匹配任意"的语义同时满足类型检查。
  4. **`event.args` 可能为 null**：`getContractLogs` 解析失败时会返回 `args: null`。在 `.map()` 前加 `.filter((event) => event.args != null)` 过滤掉解析失败的日志，并对 `.map()` 内访问加 `!` 断言。
  5. **`event.logIndex` 不存在**：ethers.js v6 将日志索引字段从 `logIndex` 改名为 `index`。已修正为 `event.index`，并加注释说明与 v5 的差异。
  6. **`isolatedModules` — 类型重导出**：接口（`Web3WalletConfig`、`PaymentOrder`、`WalletBalance`、`PaymentEvent`）在 `isolatedModules` 模式下必须用 `export type` 导出，已将底部 export 拆分为 `export { Web3Wallet, OrderStatus }` 和 `export type { ... }`。

## 2026-02-24 (web3Wallet.ts TypeScript 严格模式修复)


### Bug 修复 (Bug Fixes)
- **`src/web3/wallet/web3Wallet.ts`:**
  - **修复 `'order' is possibly 'undefined'` 类型报错**：由于 `tsconfig.json` 启用了 `noUncheckedIndexedAccess: true`，所有数组下标访问（`arr[i]`）会被 TypeScript 推断为 `T | undefined`。`checkAllPendingOrders` 内层循环中 `batch[j]` 和 `balances[j]` 均触发此问题。修复方案：
    1. 将 `for (let j = 0; j < batch.length; j++)` 改为 `for (const [j, order] of batch.entries())`，通过解构赋值让 TypeScript 确认 `order` 必然有值。
    2. 对 `balances[j]` 的访问结果添加 `if (!balance) continue;` 空值守卫，消除 `undefined` 访问风险。

## 2026-02-24 (web3Wallet.ts 优化)


### Bug 修复 (Bug Fixes)
- **`src/web3/wallet/web3Wallet.ts`:**
  1. **修复 `getNextWalletIndex` 写入目标错误**：原代码将钱包索引持久化到 `wallet_db`，但应写入负责元数据存储的 `metadata_db`，导致索引状态每次 wallets 清空后丢失。
  2. **修复 `this.tokenDecimals` 未定义**：`checkAllPendingOrders`、`getWalletTransferEvents`、`getPaymentStats` 等方法均引用了 `this.tokenDecimals`，但原类中该属性从未声明，运行时会抛 `TypeError`。现已在构造函数中正确初始化（默认为 `6`，可通过 config 覆盖）。
  3. **修复 `checkAllPendingOrders` 余额解析 decimals 错误**：`ethers.parseUnits(order.receivedAmount, this.tokenDecimals)` 对链上原始 balance（已是 Wei 字符串）重复换算 decimals，应统一使用 `parseUnits(..., 0)`。
  4. **修复 `checkAllPendingOrders` 订单 key 错误**：更新订单时使用了 `order.orderId` 作为 DB key，实际应使用 `orderHash`（与存储逻辑保持一致）。
  5. **修复 `collectFundsFromWallets` 引用未定义属性 `this.rpc`**：原代码使用 `this.rpc`（不存在），改为正确的 `this.config.rpc`；同理 `batchCallAddress` 也改为 `this.config.batchCallAddress`。

### 优化 (Enhancements)
- **类型安全**：新增 `Web3WalletConfig` 接口替换 `config: any`，为构造函数入参提供完整类型约束，并在 export 中一并导出。
- **接口补全**：`PaymentOrder` 补充了 `lastCheckedBlock?: number` 字段声明（代码中隐式使用但 interface 中缺失）。
- **性能**：`checkAllPendingOrders` 内层循环中原来对每笔订单分别调用 `this.web3.getLatestBlockNumber()`（N 次 RPC），改为批次级别调用一次，避免冗余网络请求。
- **去冗余**：`batchQueryBalances` 直接 `return` 结果，移除多余的中间变量；`queryOrders` sort 比较时对 `undefined` 进行了安全 fallback。
- **可读性**：`createPaymentOrder` 将 `orderHash` 计算提前至检查归档前（逻辑更清晰），`cancelOrder` 参数备注明确为 `orderHash`。

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
