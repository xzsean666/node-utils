import * as jwt from 'jsonwebtoken';

export interface JWTPayload {
  [key: string]: any;
}

export class JWTHelper {
  private readonly secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  /**
   * 生成 JWT 令牌
   * @param payload 需要加密的数据
   * @param expiresInSeconds 过期时间（单位：秒）
   */
  public generateToken(
    payload: JWTPayload,
    expiresInSeconds: number = 3600,
  ): string {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return jwt.sign({ ...payload, exp: expiresAt }, this.secretKey);
  }

  /**
   * 验证 JWT 令牌
   * @param token JWT 令牌
   * @returns 如果验证成功返回解码后的数据，失败则抛出错误
   */
  public verifyToken(token: string): JWTPayload {
    try {
      const decoded = jwt.verify(token, this.secretKey) as JWTPayload;
      if (this.isTokenExpired(token)) {
        throw new Error('Token has expired');
      }
      return decoded;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Invalid token');
    }
  }

  /**
   * 解析 JWT 令牌（不验证签名）
   * @param token JWT 令牌
   * @returns 解码后的数据
   */
  public decodeToken(token: string): JWTPayload | null {
    return jwt.decode(token) as JWTPayload;
  }

  /**
   * 检查令牌是否过期
   * @param token JWT 令牌
   * @returns 是否过期
   */
  public isTokenExpired(token: string): boolean {
    try {
      const decoded = jwt.decode(token) as JWTPayload;
      const currentTime = Math.floor(Date.now() / 1000);
      return !decoded.exp || decoded.exp < currentTime;
    } catch {
      return true;
    }
  }

  /**
   * 简单加密 JWT 令牌（无过期时间）
   * @param payload 需要加密的数据
   */
  public encode(payload: JWTPayload): string {
    return jwt.sign(payload, this.secretKey);
  }

  /**
   * 简单解密 JWT 令牌（无过期时间验证）
   * @param token JWT 令牌
   * @returns 解码后的数据
   */
  public decode(token: string): JWTPayload {
    try {
      return jwt.verify(token, this.secretKey) as JWTPayload;
    } catch {
      throw new Error('Invalid token');
    }
  }
}
