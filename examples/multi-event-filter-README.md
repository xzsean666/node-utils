# 智能Filter功能 - 支持多事件过滤

## 🎯 功能概述

`getContractLogs` 方法现在支持智能filter，可以自动处理indexed参数的类型转换，并且支持同时过滤多个不同事件的logs。

## 📝 两种使用方式

### 1. 简单数组格式（向后兼容）

```typescript
const logs = await helper.getContractLogs({
  contract_addresses: '0x...',
  abi: erc20ABI,
  event_names: 'Transfer', // 单个事件
  filter: {
    topics: [
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // from地址
      null, // to地址（不过滤）
    ],
  },
});
```

### 2. 对象格式（新功能 - 支持多事件）

```typescript
const logs = await helper.getContractLogs({
  contract_addresses: '0x...',
  abi: erc20ABI,
  event_names: ['Transfer', 'Approval'], // 多个事件
  filter: {
    topics: {
      // key是事件名，value是对应的indexed参数数组
      Transfer: [
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // from
        null, // to（不过滤）
      ],
      Approval: [
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // owner
        null, // spender（不过滤）
      ],
    },
  },
});
```

## 🔧 自动类型转换

程序会根据ABI中的类型定义自动转换参数：

- **address** → `ethers.zeroPadValue(address, 32)`
- **uint/int** → `ethers.AbiCoder.defaultAbiCoder().encode([type], [value])`
- **bool** → `ethers.AbiCoder.defaultAbiCoder().encode(['bool'], [value])`
- **bytes** → 如果以0x开头则直接使用，否则编码
- **其他类型** → 尝试编码，失败则转为字符串

## 💡 使用技巧

1. **null表示不过滤**：在数组中使用null跳过该位置的过滤
2. **原始值直接传入**：address直接传字符串，数值直接传数字或字符串
3. **多事件优化**：如果多个事件在相同位置有相同过滤条件，会自动合并
4. **完全向后兼容**：原有的数组格式仍然支持

## 🚀 运行示例

```bash
# 运行基础示例
npx ts-node examples/smart-filter-example.ts

# 运行多事件过滤示例
npx ts-node examples/smart-filter-example.ts
```

## 📋 完整示例代码

参考 `examples/smart-filter-example.ts` 查看完整的使用示例。
