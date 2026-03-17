import { Router, Request, Response } from 'express';
import type { Router as IRouter } from 'express';
import {
  botHelper,
  logService,
  wstaStarDepegAlert,
  vaultHelper,
} from '../helpers/sdk';
import { sendSuccess, sendError } from './services-base';

export const router: IRouter = Router();

router.get('/api/template-get', async (req: Request, res: Response) => {
  sendSuccess(res, 'data', 'message');
});

router.get('/api/check-unstake-status', async (req: Request, res: Response) => {
  const { address } = req.query;
  const result = await vaultHelper.getUserAllUnstakeStatus(address as string);
  // const result = await vaultHelper.formatAllUnstakeStatus(address as string);
  sendSuccess(res, result, 'message');
});

router.get('/api/all-unstake-status', async (req: Request, res: Response) => {
  const result = await botHelper.withdrawUserStauts();
  sendSuccess(res, result, 'all-unstake-status');
});

router.get('/api/is-quick-unstake', async (req: Request, res: Response) => {
  const { address, nonce } = req.query;
  const result = await vaultHelper.isQuickUnstake(
    address as string,
    Number(nonce),
  );
  sendSuccess(res, result, 'is-quick-unstake');
});

/**
 * 健康检查端点
 * GET /health
 */
router.get('/health', (req: Request, res: Response) => {
  sendSuccess(res, {
    status: 'ok',
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      unit: 'MB',
    },
    environment: process.env.NODE_ENV || 'development',
  });
});

/**
 * API信息端点
 * GET /api/info
 */
router.get('/api/info', (req: Request, res: Response) => {
  sendSuccess(res, {
    name: 'LST SDK API',
    version: '1.0.0',
    description: 'Liquid Staking Token SDK API',
    endpoints: [
      { method: 'GET', path: '/health', description: 'Health check' },
      { method: 'GET', path: '/api/info', description: 'API information' },
      { method: 'GET', path: '/api/status', description: 'System status' },
      {
        method: 'POST',
        path: '/api/example',
        description: 'Example POST endpoint',
      },
    ],
  });
});

/**
 * 系统状态端点
 * GET /api/status
 */
router.get('/api/status', async (req: Request, res: Response) => {
  try {
    // 示例：这里可以添加你的业务逻辑
    // 例如：调用 helper.getVaultStatus() 等
    const status = {
      server: 'running',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid,
      nodeVersion: process.version,
      // 添加更多状态信息...
    };

    sendSuccess(res, status, 'System status retrieved successfully');
  } catch (error: any) {
    sendError(res, 500, 'Failed to get status', error.message);
  }
});

/**
 * 示例POST端点
 * POST /api/example
 */
router.post('/api/example', async (req: Request, res: Response) => {
  try {
    const { data } = req.body;

    // 简单验证
    if (!data) {
      return sendError(res, 400, 'Validation failed', 'Data field is required');
    }

    // 你的业务逻辑
    sendSuccess(res, { received: data }, 'Data processed successfully');
  } catch (error: any) {
    sendError(res, 500, 'Request failed', error.message);
  }
});

// 在这里添加更多路由...
// 示例：获取价格
// router.get('/api/price/:token', async (req: Request, res: Response) => {
//   try {
//     const { token } = req.params;
//     // 调用业务逻辑
//     sendSuccess(res, { token, price: 0 });
//   } catch (error: any) {
//     sendError(res, 500, 'Failed to get price', error.message);
//   }
// });
