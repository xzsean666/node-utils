# LST SDK API Server

一个简单的 RESTful API 服务器，用于 LST SDK 项目。

## 安装依赖

首先需要安装新添加的依赖包：

```bash
 npm install
# 或
pnpm install

pnpm add cors express
```

## 启动服务器

### 开发模式（带热重载）

```bash
npm run dev:server
# 或
pnpm run dev:server
```

### 生产模式

```bash
npm run start:server
# 或
pnpm run start:server
```

服务器默认运行在 `http://localhost:3000`

## 可用端点

### 健康检查

```
GET /health
```

返回服务器健康状态

### API 信息

```
GET /api/info
```

返回 API 的基本信息和所有可用端点

### 系统状态

```
GET /api/status
```

返回系统运行状态

### 示例 POST 端点

```
POST /api/example
Content-Type: application/json

{
  "data": "your data here"
}
```

## 添加新端点

在 `src/server/services.ts` 文件中添加新的路由：

```typescript
// 示例：获取价格
router.get('/api/price/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    // 调用你的业务逻辑
    // const price = await priceService.getPrice(token);

    res.json({
      token,
      price: 0, // 替换为实际价格
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get price',
      message: error.message,
    });
  }
});
```

## 配置

可以通过环境变量配置服务器：

- `PORT`: 服务器端口（默认: 3000）
- `NODE_ENV`: 运行环境（development/production）

创建 `.env` 文件：

```env
PORT=3000
NODE_ENV=development
```

## 集成现有功能

可以在路由中导入并使用现有的 helper 和 service：

```typescript
import { helper, logService } from '../index';

router.get('/api/vault/status', async (req, res) => {
  try {
    const status = await helper.getVaultStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

## 测试 API

使用 curl 测试：

```bash
# 健康检查
curl http://localhost:3000/health

# 获取 API 信息
curl http://localhost:3000/api/info

# POST 请求示例
curl -X POST http://localhost:3000/api/example \
  -H "Content-Type: application/json" \
  -d '{"data": "test"}'
```

或使用 Postman、Insomnia 等工具进行测试。
