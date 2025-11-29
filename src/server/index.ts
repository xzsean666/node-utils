import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { router } from './services';

// 加载环境变量
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' })); // 添加大小限制
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 请求ID和响应时间追踪
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = Math.random().toString(36).substring(7);
  const startTime = Date.now();

  // 将 requestId 添加到请求对象
  (req as any).requestId = requestId;

  // 忽略浏览器自动请求的路径
  const ignorePaths = [
    '/sw.js',
    '/favicon.ico',
    '/manifest.json',
    '/robots.txt',
  ];

  // 响应结束时记录日志
  res.on('finish', () => {
    // 过滤掉不需要记录的路径
    if (ignorePaths.includes(req.path)) {
      return;
    }

    const duration = Date.now() - startTime;
    const log = {
      timestamp: new Date().toISOString(),
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
    };
    console.log(JSON.stringify(log));
  });

  next();
});

// 路由
app.use('/', router);

// 404处理
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found' });
});

// 错误处理
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  const requestId = (req as any).requestId || 'unknown';
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      requestId,
      error: err.message,
      stack: NODE_ENV === 'development' ? err.stack : undefined,
    }),
  );

  res.status(500).json({
    error: 'Internal Server Error',
    message: NODE_ENV === 'development' ? err.message : 'Something went wrong',
    requestId,
  });
});

// 启动服务器
const server = app.listen(PORT, () => {
  console.log(`🚀 API Server running on http://localhost:${PORT}`);
  console.log(`📝 Health check: http://localhost:${PORT}/health`);
  console.log(`📊 API info: http://localhost:${PORT}/api/info`);
});

// 优雅关闭
const shutdown = () => {
  console.log('\n⏳ Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });

  // 超时强制关闭
  setTimeout(() => {
    console.error('⚠️  Forced shutdown');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
