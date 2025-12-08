import * as tls from 'tls';
import { URL } from 'url';
export async function checkSSLExpiry(website: string): Promise<number | null> {
  try {
    const url = new URL(website);
    const hostname = url.hostname;

    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host: hostname,
          port: 443,
          rejectUnauthorized: false,
          minVersion: 'TLSv1.2',
          maxVersion: 'TLSv1.3',
          ciphers: 'HIGH:!aNULL:!MD5:!RC4',
          servername: hostname,
        },
        () => {
          const cert = socket.getPeerCertificate();
          socket.end();

          if (!cert?.valid_to) {
            console.error(`无法获取 ${hostname} 的证书信息`);
            resolve(null);
            return;
          }

          const expiryDate = new Date(cert.valid_to);
          const today = new Date();
          const daysRemaining = Math.ceil(
            (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
          );

          resolve(daysRemaining);
        },
      );

      socket.on('error', (error) => {
        console.error(`检查 SSL 证书失败: ${error.message}`);
        resolve(null);
      });
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error(`检查 SSL 证书失败: ${error.message}`);
    } else {
      console.error('检查 SSL 证书时发生未知错误');
    }
    return null;
  }
}

// 使用示例
// checkSSLExpiry('https://acs-api.astar.network/').then((days) => {
//   console.log('Days remaining:', days);
// });
