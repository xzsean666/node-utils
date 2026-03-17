import { Request, Response, NextFunction } from 'express';

// 简单的内存缓存速率限制器
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

/**
 * 简单的速率限制中间件
 * @param maxRequests 时间窗口内的最大请求数
 * @param windowMs 时间窗口（毫秒）
 */
export const rateLimit = (
  maxRequests: number = 100,
  windowMs: number = 60000,
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const record = rateLimitStore.get(key);

    if (!record || now > record.resetTime) {
      rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }

    if (record.count >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil((record.resetTime - now) / 1000),
      });
    }

    record.count++;
    next();
  };
};

/**
 * 异步路由处理器包装器
 * 自动捕获 async 函数中的错误并传递给错误处理中间件
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * 请求验证中间件工厂
 * @param schema 验证函数
 */
export const validate = (
  schema: (body: any) => { valid: boolean; errors?: string[] },
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema(req.body);
    if (!result.valid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        message: result.errors?.join(', ') || 'Invalid request data',
      });
    }
    next();
  };
};

/**
 * 定期清理速率限制缓存
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // 每分钟清理一次
