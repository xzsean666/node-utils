import type { Response } from 'express';

// 统一响应格式类型定义
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
  requestId?: string;
}

// 辅助函数：递归解析对象，将内部的 BigInt 转换为字符串
const parseBigInt = (value: any): any => {
  if (value === null || value === undefined) {
    return value;
  }

  // 如果是 BigInt，转换为字符串
  if (typeof value === 'bigint') {
    return value.toString();
  }

  // 如果是数组，递归处理每个元素
  if (Array.isArray(value)) {
    return value.map((item) => parseBigInt(item));
  }

  // 如果是对象（但不是 Date 等特殊对象），递归处理每个属性
  if (typeof value === 'object' && value.constructor === Object) {
    const result: any = {};
    for (const key in value) {
      if (value.hasOwnProperty(key)) {
        result[key] = parseBigInt(value[key]);
      }
    }
    return result;
  }

  // 其他类型直接返回
  return value;
};

// 辅助函数：发送成功响应
export const sendSuccess = <T>(
  res: Response,
  data: T,
  message?: string,
): void => {
  const response: ApiResponse<T> = {
    success: true,
    data: parseBigInt(data) as T,
    message,
    timestamp: new Date().toISOString(),
    requestId: (res.req as any).requestId,
  };
  res.json(response);
};

// 辅助函数：发送错误响应
export const sendError = (
  res: Response,
  statusCode: number,
  error: string,
  message?: string,
): void => {
  const response: ApiResponse = {
    success: false,
    error,
    message,
    timestamp: new Date().toISOString(),
    requestId: (res.req as any).requestId,
  };
  res.status(statusCode).json(response);
};
