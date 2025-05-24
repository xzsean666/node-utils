# 安装 AWS SDK v3 依赖

为了使用新的 S3Helper（基于 AWS SDK v3），请运行以下命令安装依赖：

```bash
# 使用 pnpm (推荐)
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# 或使用 npm
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# 或使用 yarn
yarn add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

## 为什么迁移到 AWS SDK v3？

1. **官方支持** - Amazon 官方维护
2. **更好的 TypeScript 支持** - 完整类型定义
3. **模块化设计** - 只引入需要的功能
4. **更好的 S3 兼容服务支持** - 原生支持各种服务
5. **性能优化** - 更好的性能和错误处理

## 兼容的服务

✅ AWS S3  
✅ Cloudflare R2  
✅ Backblaze B2  
✅ MinIO  
✅ 任何 S3 兼容服务

## 安装后

安装完成后，你可以使用：

```typescript
import { S3Helper } from 'node-utils-sean';

const s3 = S3Helper.createAWS(
  'access-key',
  'secret-key',
  'us-west-2',
  'bucket',
);
```

查看完整使用示例：

- `src/utils/dbUtils/S3Helper_README.md`
- `src/utils/dbUtils/examples/s3HelperAWSSDKExample.ts`
