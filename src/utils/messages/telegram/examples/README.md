# Telegram 客户端使用示例

本目录包含了 Telegram 消息处理的各种示例代码，展示了如何使用 `TelegramJSBase` (GramJS) 和 `TelegramBotBase` (Grammy) 进行 Telegram 开发。

## 主要类说明

### TelegramJSBase

- 基于 `telegram` (GramJS) 库
- 支持用户账户登录 (需要 API ID/Hash)
- 可以访问完整的 Telegram API
- 适合需要高级功能的应用

### TelegramBotBase

- 基于 `grammy` 库
- 支持 Bot Token 登录
- 使用 Telegram Bot API
- 适合标准的机器人应用

## 🔄 类同步说明

两个类现在具有一致的接口，主要同步的方法包括：

### 共同方法

| 方法             | TelegramJSBase | TelegramBotBase | 说明                           |
| ---------------- | -------------- | --------------- | ------------------------------ |
| `onMessage()`    | ✅             | ✅              | 消息事件处理器，支持多个处理器 |
| `getMessages()`  | ✅             | ✅              | 获取历史消息                   |
| `sendMessage()`  | ✅             | ✅              | 发送文本消息                   |
| `sendFile()`     | ✅             | ✅              | 发送文件                       |
| `connect()`      | ✅             | ✅              | 连接客户端                     |
| `disconnect()`   | ✅             | ✅              | 断开连接                       |
| `getUserInfo()`  | ✅             | ✅              | 获取用户信息                   |
| `isAuthorized()` | ✅             | ✅              | 检查授权状态                   |

### 消息处理器同步

两个类现在都支持相同的消息处理模式：

```typescript
// TelegramJSBase
client.onMessage(async (event: NewMessageEvent) => {
  // 处理消息
});

// TelegramBotBase
bot.onMessage(async (ctx: BaseContext) => {
  // 处理消息
});
```

两者都支持：

- 多个消息处理器
- 错误处理机制
- 自动用户信息更新

## 示例文件

### 1. `onMessage-with-getMessages-example.ts`

完整的示例文件，展示了：

- **示例 0**: `TelegramBotBase` 的使用方法
- **示例 1**: `TelegramJSBase` 的基础用法
- **示例 2-3**: 高级消息处理器

### 2. `grammy-base-example.ts`

Grammy (Bot API) 的基础使用示例

### 3. `gramjs-base-example.ts`

GramJS (User API) 的基础使用示例

### 4. `simple-usage-example.ts`

最简单的使用示例

## 使用指南

### 启动示例

```bash
# 使用 TelegramBotBase (Bot API)
npx ts-node onMessage-with-getMessages-example.ts 0

# 使用 TelegramJSBase (User API) - 基础用法
npx ts-node onMessage-with-getMessages-example.ts 1

# 使用 TelegramJSBase (User API) - 高级用法
npx ts-node onMessage-with-getMessages-example.ts 2
```

### 配置参数

在使用前，请在示例文件中配置：

```typescript
const config = {
  apiId: 12968078, // 从 https://my.telegram.org/apps 获取
  apiHash: 'your_api_hash', // 从 https://my.telegram.org/apps 获取
  sessionString: 'your_session_string', // TelegramJSBase 的会话字符串
  proxy: 'http://127.0.0.1:7897', // 可选的代理设置
  botToken: 'your_bot_token', // TelegramBotBase 的 Bot Token
};
```

## API 差异说明

### getMessages 方法

- **TelegramJSBase**: 可以获取任意数量的历史消息，支持复杂的查询参数
- **TelegramBotBase**: 受 Bot API 限制，主要通过 `getUpdates` 实现，功能相对有限

### 文件发送

- **TelegramJSBase**: 支持直接发送本地文件、Buffer、URL
- **TelegramBotBase**: 支持文件路径、URL、Buffer，使用 `InputFile` 处理

### 用户信息

- **TelegramJSBase**: 可以获取完整的用户账户信息
- **TelegramBotBase**: 只能获取机器人的基本信息

## 最佳实践

1. **选择合适的类**:

   - 需要访问用户消息历史 → `TelegramJSBase`
   - 标准机器人功能 → `TelegramBotBase`

2. **错误处理**:

   - 两个类都内置了错误处理机制
   - 建议在消息处理器中添加 try-catch

3. **性能考虑**:

   - `getMessages` 操作可能较慢，建议限制数量
   - 避免在高频消息中进行大量历史查询

4. **代理使用**:
   - 两个类都支持代理配置
   - `TelegramJSBase` 支持更多代理类型 (SOCKS4/5, MTProxy)

## 📂 文件说明

### 1. `gramjs-base-example.ts`

**完整功能示例**

- ✅ 两步认证获取 session
- ✅ 使用已有 session 连接
- ✅ 发送消息（文本、格式化文本）
- ✅ 发送文件
- ✅ 获取对话列表和消息历史
- ✅ 消息事件监听
- ✅ 代理配置使用

### 2. `api-example.ts`

**REST API 集成示例**

- 🔥 完整的 API 端点实现
- 🔥 Express.js 路由示例
- 🔥 Session 管理
- 🔥 错误处理

## 🚀 快速开始

### 1. 准备工作

首先，你需要从 [Telegram 官网](https://my.telegram.org/apps) 获取 API 凭据：

1. 登录你的 Telegram 账号
2. 点击 "API development tools"
3. 填写应用信息（只需要应用标题和简短名称）
4. 点击 "Create application"
5. 获得 `api_id` 和 `api_hash`

### 2. 基本使用

```typescript
import { GramJSBase } from '../telegramBase';

// 配置信息
const config = {
  apiId: 123456, // 替换为你的API ID
  apiHash: 'your_api_hash_here', // 替换为你的API Hash
  phoneNumber: '+1234567890', // 你的手机号
  proxy: 'http://127.0.0.1:7987', // 可选的代理
};
```

### 3. 两步认证流程

```typescript
// 步骤1：发送验证码
const { tempSessionString, phoneCodeHash } = await GramJSBase.sendPhoneCode(
  config.apiId,
  config.apiHash,
  config.phoneNumber,
  config.proxy,
);

// 步骤2：用户输入验证码后，提交验证码
const phoneCode = '12345'; // 从手机收到的验证码
const sessionString = await GramJSBase.submitPhoneCodeAndGetSession(
  config.apiId,
  config.apiHash,
  config.phoneNumber,
  phoneCode,
  phoneCodeHash,
  tempSessionString,
);

// 步骤3：保存sessionString，下次直接使用
console.log('Session String:', sessionString);
```

### 4. 使用已有 Session

```typescript
// 如果你已经有了sessionString
const client = new GramJSBase(
  config.apiId,
  config.apiHash,
  sessionString, // 之前保存的session
  { proxy: config.proxy },
);

// 直接连接，无需重新认证
await client.start();

// 发送消息
await client.sendMessage('me', 'Hello World! 🚀');
```

## 🌐 代理配置

支持多种代理格式：

```typescript
// HTTP代理
const client1 = new GramJSBase(apiId, apiHash, sessionString, {
  proxy: 'http://127.0.0.1:7987',
});

// SOCKS5代理
const client2 = new GramJSBase(apiId, apiHash, sessionString, {
  proxy: 'socks5://127.0.0.1:1080',
});

// 带认证的代理
const client3 = new GramJSBase(apiId, apiHash, sessionString, {
  proxy: 'socks5://user:pass@127.0.0.1:1080',
});

// 详细配置对象
const client4 = new GramJSBase(apiId, apiHash, sessionString, {
  proxy: {
    ip: '127.0.0.1',
    port: 1080,
    socksType: 5,
    username: 'proxyuser',
    password: 'proxypass',
  },
});
```

## 📡 API 服务集成

### REST API 端点

```typescript
// 1. 发送验证码
POST /api/telegram/send-code
{
  "apiId": 123456,
  "apiHash": "your_api_hash",
  "phoneNumber": "+1234567890",
  "proxy": "http://127.0.0.1:7987"
}

// 2. 验证验证码
POST /api/telegram/verify-code
{
  "apiId": 123456,
  "apiHash": "your_api_hash",
  "phoneNumber": "+1234567890",
  "phoneCode": "12345",
  "phoneCodeHash": "hash_from_step1",
  "tempSessionString": "session_from_step1",
  "userId": "user123",
  "proxy": "http://127.0.0.1:7987"
}

// 3. 发送消息
POST /api/telegram/send-message
{
  "apiId": 123456,
  "apiHash": "your_api_hash",
  "userId": "user123",
  "target": "me",
  "message": "Hello World!",
  "parseMode": "html"
}
```

### Express.js 集成

```typescript
import express from 'express';
import { setupExpressRoutes } from './api-example';

const app = express();
app.use(express.json());

// 自动设置所有Telegram API路由
setupExpressRoutes(app);

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

## 🏃 运行示例

### 运行完整示例

```bash
# 编译并运行
npx ts-node src/utils/messages/telegram/examples/gramjs-base-example.ts
```

### 运行 API 示例

```bash
# 编译并运行
npx ts-node src/utils/messages/telegram/examples/api-example.ts
```

## ⚠️ 注意事项

1. **API 凭据安全**: 请妥善保管你的 `api_id` 和 `api_hash`，不要泄露给他人
2. **Session 保护**: `sessionString` 相当于登录凭证，请安全存储
3. **验证码时效**: Telegram 验证码通常有时间限制，请及时使用
4. **代理连接**: 如果你在某些地区，可能需要使用代理连接 Telegram 服务器
5. **速率限制**: Telegram 对 API 调用有速率限制，请合理使用

## 🐛 常见问题

### Q: 提示"AUTH_KEY_UNREGISTERED"错误？

A: 这通常意味着 session 已过期，需要重新进行两步认证。

### Q: 代理连接失败？

A: 请检查代理服务器是否正常运行，以及代理格式是否正确。

### Q: 验证码收不到？

A: 请确保手机号格式正确（带国家代码），并检查网络连接。

### Q: 如何获取其他用户的 ID？

A: 可以通过 `@username` 格式发送消息，或使用 `getEntity('@username')` 获取用户信息。

## 📚 更多资源

- [Telegram API 文档](https://core.telegram.org/api)
- [GramJS 官方文档](https://gram.js.org/)
- [Telegram Bot API](https://core.telegram.org/bots/api)

## 💡 贡献

如果你发现示例中的问题或有改进建议，欢迎提交 Issue 或 Pull Request！
