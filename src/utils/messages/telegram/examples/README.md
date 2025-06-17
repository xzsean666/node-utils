# GramJSBase 使用示例

这个目录包含了 GramJSBase 类的完整使用示例，展示了如何使用两步认证 API、发送消息、文件传输等功能。

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
