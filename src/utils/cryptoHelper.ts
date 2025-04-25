import * as crypto from 'crypto';

export class CryptoHelper {
  /**
   * 计算对象的 MD5 哈希值
   * @param obj 任意对象
   * @returns MD5 哈希值（16进制字符串）
   */
  static calculateObjectMD5(obj: any): string {
    // 将对象转换为规范的 JSON 字符串（按键排序）
    const jsonStr = JSON.stringify(obj, Object.keys(obj).sort());
    return this.calculateMD5(jsonStr);
  }

  /**
   * 计算字符串的 MD5 哈希值
   * @param str 输入字符串
   * @returns MD5 哈希值（16进制字符串）
   */
  static calculateMD5(str: string): string {
    return crypto.createHash('md5').update(str).digest('hex');
  }

  /**
   * 计算文件的 MD5 哈希值
   * @param buffer 文件 buffer
   * @returns MD5 哈希值（16进制字符串）
   */
  static calculateBufferMD5(buffer: Buffer): string {
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  /**
   * 生成随机字符串
   * @param length 字符串长度
   * @returns 随机字符串
   */
  static generateRandomString(length: number): string {
    return crypto
      .randomBytes(Math.ceil(length / 2))
      .toString('hex')
      .slice(0, length);
  }

  /**
   * AES 加密
   * @param text 要加密的文本
   * @param key 密钥
   * @returns 加密后的文本（base64格式）
   */
  static encryptAES(text: string, key: string): string {
    // Create a 32-byte key from the provided key using SHA-256
    const sha256Key = crypto.createHash('sha256').update(String(key)).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', sha256Key, iv);
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return iv.toString('base64') + ':' + encrypted;
  }

  /**
   * AES 解密
   * @param encrypted 加密后的文本（base64格式）
   * @param key 密钥
   * @returns 解密后的文本
   */
  static decryptAES(encrypted: string, key: string): string {
    // Create a 32-byte key from the provided key using SHA-256
    const sha256Key = crypto.createHash('sha256').update(String(key)).digest();
    const [ivBase64, encryptedData] = encrypted.split(':');
    const iv = Buffer.from(ivBase64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-cbc', sha256Key, iv);
    let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * SHA256 哈希
   * @param str 输入字符串
   * @returns SHA256 哈希值（16进制字符串）
   */
  static calculateSHA256(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex');
  }
}
