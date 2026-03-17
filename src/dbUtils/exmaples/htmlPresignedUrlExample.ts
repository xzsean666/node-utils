import { S3Helper } from '../s3Helper';

// 在 HTML 中使用预签名 URL 的示例

async function generatePresignedUrlsForHTML() {
  console.log('=== HTML 预签名 URL 使用示例 ===\n');

  // 创建 S3 实例
  const s3 = S3Helper.createAWS(
    process.env.AWS_ACCESS_KEY_ID || 'your-access-key',
    process.env.AWS_SECRET_ACCESS_KEY || 'your-secret-key',
    'us-west-2',
    'my-media-bucket',
  );

  try {
    // 1. 先上传一些测试文件
    console.log('📤 上传测试文件...');

    // 上传图片（模拟）
    const imageData = Buffer.from('fake-image-data', 'utf-8'); // 实际使用时这里是真实的图片数据
    await s3.uploadBuffer('images/avatar.jpg', imageData, undefined, {
      contentType: 'image/jpeg',
      metadata: {
        'original-name': 'user-avatar.jpg',
        'uploaded-by': 'user-123',
      },
    });

    // 上传视频（模拟）
    const videoData = Buffer.from('fake-video-data', 'utf-8');
    await s3.uploadBuffer('videos/demo.mp4', videoData, undefined, {
      contentType: 'video/mp4',
      metadata: {
        duration: '120',
        resolution: '1920x1080',
      },
    });

    // 上传文档
    const pdfData = Buffer.from('fake-pdf-content', 'utf-8');
    await s3.uploadBuffer('documents/report.pdf', pdfData, undefined, {
      contentType: 'application/pdf',
      metadata: {
        pages: '10',
        size: 'A4',
      },
    });

    console.log('✅ 测试文件上传完成\n');

    // 2. 生成预签名 URL
    console.log('🔗 生成预签名 URL...');

    // 图片 URL - 1小时有效
    const imageUrl = await s3.getPresignedDownloadUrl(
      'images/avatar.jpg',
      3600,
    );
    console.log('📸 图片 URL:', imageUrl);

    // 视频 URL - 4小时有效
    const videoUrl = await s3.getPresignedDownloadUrl(
      'videos/demo.mp4',
      4 * 3600,
    );
    console.log('🎥 视频 URL:', videoUrl);

    // 文档 URL - 24小时有效
    const documentUrl = await s3.getPresignedDownloadUrl(
      'documents/report.pdf',
      24 * 3600,
    );
    console.log('📄 文档 URL:', documentUrl);

    // 3. 生成 HTML 代码
    console.log('\n📝 生成的 HTML 代码:\n');

    const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>S3 预签名 URL 示例</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .media-container { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
        img { max-width: 300px; border-radius: 8px; }
        video { max-width: 500px; }
        .download-link { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; }
    </style>
</head>
<body>
    <h1>S3 预签名 URL 在 HTML 中的使用</h1>
    
    <!-- 1. 图片显示 -->
    <div class="media-container">
        <h2>📸 图片显示 (直接在 img 标签中使用)</h2>
        <img src="${imageUrl}" alt="用户头像" />
        <p>图片URL有效期: 1小时</p>
        <p><small>URL: ${imageUrl.substring(0, 80)}...</small></p>
    </div>

    <!-- 2. 视频播放 -->
    <div class="media-container">
        <h2>🎥 视频播放 (直接在 video 标签中使用)</h2>
        <video controls>
            <source src="${videoUrl}" type="video/mp4">
            您的浏览器不支持视频播放。
        </video>
        <p>视频URL有效期: 4小时</p>
        <p><small>URL: ${videoUrl.substring(0, 80)}...</small></p>
    </div>

    <!-- 3. 文档下载 -->
    <div class="media-container">
        <h2>📄 文档下载 (在 a 标签中使用)</h2>
        <a href="${documentUrl}" class="download-link" download="report.pdf">
            📥 下载 PDF 报告
        </a>
        <p>文档URL有效期: 24小时</p>
        <p><small>URL: ${documentUrl.substring(0, 80)}...</small></p>
    </div>

    <!-- 4. 其他用途 -->
    <div class="media-container">
        <h2>🔧 其他使用方式</h2>
        
        <!-- 作为背景图片 -->
        <div style="width: 200px; height: 200px; background-image: url('${imageUrl}'); background-size: cover; background-position: center; border-radius: 8px;">
            <p style="color: white; text-align: center; padding-top: 80px; margin: 0;">背景图片</p>
        </div>
        <br>
        
        <!-- 在 iframe 中显示PDF -->
        <iframe src="${documentUrl}" width="600" height="400" style="border: 1px solid #ddd;"></iframe>
        <p>PDF 在 iframe 中预览</p>
    </div>

    <script>
        // JavaScript 中也可以使用这些 URL
        console.log('图片 URL:', '${imageUrl}');
        console.log('视频 URL:', '${videoUrl}');
        console.log('文档 URL:', '${documentUrl}');
        
        // 动态加载图片
        function loadImage() {
            const img = new Image();
            img.onload = function() {
                console.log('图片加载成功:', this.src);
            };
            img.src = '${imageUrl}';
        }
        
        // 检查 URL 是否仍然有效
        async function checkUrlValidity(url) {
            try {
                const response = await fetch(url, { method: 'HEAD' });
                return response.ok;
            } catch (error) {
                return false;
            }
        }
    </script>
</body>
</html>`;

    console.log(htmlContent);

    // 4. 保存 HTML 文件
    const fs = await import('fs');
    const path = await import('path');

    const htmlFilePath = path.join(process.cwd(), 'presigned-url-demo.html');
    await fs.promises.writeFile(htmlFilePath, htmlContent, 'utf-8');

    console.log(`\n💾 HTML 文件已保存到: ${htmlFilePath}`);
    console.log('🌐 你可以直接在浏览器中打开这个文件查看效果\n');

    // 5. 清理测试文件（可选）
    console.log('🗑️ 清理测试文件...');
    await s3.deleteFiles([
      'images/avatar.jpg',
      'videos/demo.mp4',
      'documents/report.pdf',
    ]);
    console.log('✅ 清理完成');
  } catch (error) {
    console.error('❌ 示例执行失败:', error);
  }
}

// Web API 返回预签名 URL 的示例
async function webApiExample() {
  console.log('\n=== Web API 返回预签名 URL 示例 ===');

  const s3 = S3Helper.createAWS(
    process.env.AWS_ACCESS_KEY_ID || 'your-access-key',
    process.env.AWS_SECRET_ACCESS_KEY || 'your-secret-key',
    'us-west-2',
    'api-files-bucket',
  );

  // 模拟 API 端点：获取用户头像
  async function getUserAvatar(userId: string) {
    try {
      const avatarKey = `avatars/${userId}.jpg`;

      // 检查文件是否存在
      const exists = await s3.fileExists(avatarKey);
      if (!exists) {
        return { error: '头像不存在' };
      }

      // 生成预签名 URL（2小时有效）
      const avatarUrl = await s3.getPresignedDownloadUrl(avatarKey, 2 * 3600);

      return {
        success: true,
        avatarUrl,
        expiresIn: 2 * 3600, // 秒
        expiresAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
      };
    } catch (error: any) {
      return { error: error.message };
    }
  }

  // 模拟 API 端点：获取文件下载链接
  async function getFileDownloadLink(fileId: string, fileName: string) {
    try {
      const fileKey = `files/${fileId}/${fileName}`;

      // 生成下载 URL（1小时有效）
      const downloadUrl = await s3.getPresignedDownloadUrl(fileKey, 3600);

      return {
        success: true,
        downloadUrl,
        fileName,
        expiresIn: 3600,
        // 前端可以直接使用这个 URL
        htmlCode: `<a href="${downloadUrl}" download="${fileName}">下载 ${fileName}</a>`,
      };
    } catch (error: any) {
      return { error: error.message };
    }
  }

  // 示例调用
  console.log('API 响应示例:');
  console.log('getUserAvatar("user123"):', await getUserAvatar('user123'));
  console.log(
    'getFileDownloadLink("doc456", "report.pdf"):',
    await getFileDownloadLink('doc456', 'report.pdf'),
  );
}

// React/Vue 组件中使用预签名 URL 的示例代码
function generateReactExample() {
  console.log('\n=== React 组件示例 ===\n');

  const reactCode = `// React 组件中使用 S3 预签名 URL
import React, { useState, useEffect } from 'react';

function S3ImageGallery({ imageIds }) {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadImages() {
      try {
        const imagePromises = imageIds.map(async (id) => {
          const response = await fetch(\`/api/images/\${id}/presigned-url\`);
          const data = await response.json();
          return {
            id,
            url: data.avatarUrl,
            expiresAt: data.expiresAt
          };
        });
        
        const loadedImages = await Promise.all(imagePromises);
        setImages(loadedImages);
      } catch (error) {
        console.error('加载图片失败:', error);
      } finally {
        setLoading(false);
      }
    }

    loadImages();
  }, [imageIds]);

  if (loading) return <div>加载中...</div>;

  return (
    <div className="image-gallery">
      {images.map((image) => (
        <div key={image.id} className="image-item">
          <img 
            src={image.url} 
            alt={\`Image \${image.id}\`}
            onError={(e) => {
              console.error('图片加载失败，可能已过期');
              e.target.src = '/fallback-image.jpg';
            }}
          />
          <p>过期时间: {new Date(image.expiresAt).toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}

export default S3ImageGallery;`;

  console.log(reactCode);
}

// 主函数
async function main() {
  try {
    await generatePresignedUrlsForHTML();
    await webApiExample();
    generateReactExample();
  } catch (error) {
    console.error('示例运行失败:', error);
  }
}

export {
  generatePresignedUrlsForHTML,
  webApiExample,
  generateReactExample,
  main,
};

// 如果直接运行此文件
if (require.main === module) {
  main();
}
