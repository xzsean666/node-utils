import otplib from 'otplib';
const { authenticator } = otplib;
import * as qrcode from 'qrcode';

export interface OTPOptions {
  window?: number;
  step?: number;
  algorithm?: string;
  digits?: number;
}

export interface OTPSecretResult {
  secret: string;
  otpauth: string;
  imageUrl: string;
}

export interface VerifyResult {
  isValid: boolean;
  delta?: number;
}

export class OTPUtils {
  private secret?: string;
  private readonly options: OTPOptions;

  constructor(options: OTPOptions = {}) {
    this.options = {
      window: 1,
      step: 30,
      algorithm: 'sha1',
      digits: 6,
      ...options,
    };
    this.configureAuthenticator();
  }

  private configureAuthenticator() {
    authenticator.options = {
      window: this.options.window,
      step: this.options.step,
      algorithm: this.options.algorithm as any,
      digits: this.options.digits,
    };
  }

  /**
   * 生成新的 OTP 密钥和二维码
   * @param user - 用户标识
   * @param service - 服务名称
   * @returns OTP 配置信息，包含密钥和二维码
   */
  async newSecret(user: string, service: string): Promise<OTPSecretResult> {
    try {
      const secret = authenticator.generateSecret();
      const otpauth = authenticator.keyuri(user, service, secret);
      const imageUrl = await qrcode.toDataURL(otpauth);

      return {
        secret,
        otpauth,
        imageUrl,
      };
    } catch (error) {
      throw new Error(
        `Failed to generate OTP secret: ${(error as Error).message}`,
      );
    }
  }

  /**
   * 获取当前 OTP 令牌的剩余有效时间
   * @returns 剩余秒数
   */
  timer(): number {
    return authenticator.timeRemaining();
  }

  /**
   * 生成当前 OTP 令牌
   * @param secret - OTP 密钥
   * @returns OTP 令牌
   */
  getToken(secret: string): string {
    try {
      return authenticator.generate(secret);
    } catch (error) {
      throw new Error(
        `Failed to generate OTP token: ${(error as Error).message}`,
      );
    }
  }

  /**
   * 验证 OTP 令牌是否有效
   * @param token - 待验证的 OTP 令牌
   * @param secret - OTP 密钥
   * @param window - 验证窗口大小（可选，覆盖构造函数中的设置）
   * @returns 是否有效
   */
  verifyToken(token: string, secret: string, window?: number): boolean {
    try {
      return authenticator.verify({
        token,
        secret,
        window: window ?? this.options.window,
      } as any);
    } catch (error) {
      throw new Error(
        `Failed to verify OTP token: ${(error as Error).message}`,
      );
    }
  }

  /**
   * 验证 OTP 令牌是否有效，并返回验证结果详情
   * @param token - 待验证的 OTP 令牌
   * @param secret - OTP 密钥
   * @param window - 验证窗口大小（可选，覆盖构造函数中的设置）
   * @returns 验证结果详情
   */
  verifyTokenWithDetail(
    token: string,
    secret: string,
    window?: number,
  ): VerifyResult {
    try {
      const result = authenticator.verify({
        token,
        secret,
        window: window ?? this.options.window,
      } as any);
      return {
        isValid: result,
        delta: result ? authenticator.timeUsed() : undefined,
      };
    } catch (error) {
      throw new Error(
        `Failed to verify OTP token: ${(error as Error).message}`,
      );
    }
  }
}
