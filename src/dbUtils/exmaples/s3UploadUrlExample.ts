/**
 * S3 预签名上传 URL 示例
 *
 * 典型使用场景：服务端生成预签名上传 URL 后返回给前端，
 * 前端直接用 PUT 请求将文件上传到 S3，无需经过服务端中转。
 *
 * 两种模式：
 *   - 一次性 URL：每次请求生成唯一 key（UUID 前缀），避免覆盖，适合用户上传场景
 *   - 可重用 URL：使用固定 key，有效期内可多次 PUT，适合头像/封面等"始终覆盖"场景
 */

import { S3Helper, S3UrlGenerator, ContentType } from '../s3Helper';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================
// 初始化
// ============================================================

const r2 = S3Helper.createCloudflareR2(
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
    process.env.CLOUDFLARE_ACCOUNT_ID!,
    process.env.CLOUDFLARE_R2_BUCKET || 'my-bucket',
);

const urlGen = new S3UrlGenerator(r2);

// ============================================================
// 示例 1：一次性上传 URL（推荐用于普通文件上传）
// ============================================================

async function oneTimeUploadExample() {
    console.log('\n=== 示例 1：一次性上传 URL ===');

    const result = await urlGen.generateOneTimeUploadUrl(
        'uploads/images',   // S3 路径前缀
        {
            fileName: 'photo.jpg',
            expiry: 3600,
            contentType: ContentType.JPEG,   // ← 输入 ContentType. 即可补全
        },
    );

    console.log('✅ 生成成功');
    console.log('  上传 URL   :', result.uploadUrl);
    console.log('  S3 Key     :', result.objectName);   // 如 uploads/images/uuid-photo.jpg
    console.log('  有效期     :', result.expirySeconds, '秒');
    console.log('  过期时间   :', result.expiresAt.toISOString());
    console.log('  一次性     :', result.oneTime);       // true

    // 前端使用方式（伪代码）：
    // await fetch(result.uploadUrl, {
    //   method: 'PUT',
    //   headers: { 'Content-Type': 'image/jpeg' },
    //   body: fileBlob,
    // });
    //
    // 上传成功后，文件的最终访问地址为：
    // https://your-domain.com/{result.objectName}

    return result;
}

// ============================================================
// 示例 2：可重复使用的上传 URL（适合固定路径场景）
// ============================================================

async function reusableUploadExample() {
    console.log('\n=== 示例 2：可重复使用的上传 URL ===');

    const objectName = 'ACT20260215';

    const result = await urlGen.generateReusableUploadUrl(
        `${objectName}`,   // 固定 S3 key，每次上传都会覆盖
        {
            expiry: 86400,
            contentType: ContentType.GZIP,  // ← 不用记 'application/gzip'
        },
    );

    console.log('✅ 生成成功');
    console.log('  上传 URL   :', result.uploadUrl);
    console.log('  S3 Key     :', result.objectName);   // avatars/user-123/avatar.png（固定）
    console.log('  有效期     :', result.expirySeconds, '秒');
    console.log('  过期时间   :', result.expiresAt.toISOString());
    console.log('  一次性     :', result.oneTime);       // false（可重复使用）

    return result;
}

// ============================================================
// 示例 3：批量一次性上传 URL（一次给多个文件分配上传地址）
// ============================================================

async function batchOneTimeUploadExample() {
    console.log('\n=== 示例 3：批量一次性上传 URL ===');

    const results = await urlGen.generateBatchOneTimeUploadUrls(
        'uploads/batch',
        [
            { fileName: 'photo1.jpg', contentType: ContentType.JPEG },
            { fileName: 'photo2.png', contentType: ContentType.PNG },
            { ext: '.pdf', contentType: ContentType.PDF },
            {},  // 纯 UUID key，不指定类型
        ],
        { expiry: 1800 },
    );
    const fileNames = ['photo1.jpg', 'photo2.png', '.pdf', '(auto)'];

    console.log(`✅ 批量生成 ${results.length} 个上传 URL`);
    results.forEach((r, i) => {
        console.log(`\n  [${i + 1}] ${fileNames[i]}`);
        console.log(`      S3 Key    : ${r.objectName}`);
        console.log(`      过期时间  : ${r.expiresAt.toISOString()}`);
        console.log(`      上传 URL  : ${r.uploadUrl.slice(0, 80)}...`);
    });

    return results;
}

// ============================================================
// 示例 4：直接使用 S3Helper 底层方法（更灵活的定制）
// ============================================================

async function rawPresignedUrlExample() {
    console.log('\n=== 示例 4：直接使用 S3Helper 底层方法 ===');

    // 生成下载 URL
    const downloadUrl = await r2.getPresignedDownloadUrl(
        'uploads/images/some-existing-file.jpg',
        7 * 24 * 3600,   // 7 天有效期
    );
    console.log('📥 下载 URL (7天):', downloadUrl.slice(0, 80) + '...');

    // 生成上传 URL（指定 Content-Type）
    const uploadUrl = await r2.getPresignedUploadUrl(
        'uploads/raw/custom-key.bin',
        600,             // 10 分钟
        undefined,       // 使用默认 bucket
        'application/octet-stream',
    );
    console.log('📤 上传 URL (10分钟):', uploadUrl.slice(0, 80) + '...');
}

// ============================================================
// 主函数
// ============================================================

async function main() {
    console.log('🚀 S3 预签名上传 URL 示例');
    console.log('='.repeat(50));

    try {
        // await oneTimeUploadExample();
        await reusableUploadExample();
        // await batchOneTimeUploadExample();
        // await rawPresignedUrlExample();

        console.log('\n✅ 所有示例完成！');
    } catch (error: any) {
        console.error('❌ 示例运行失败:', error.message);
        process.exit(1);
    }
}

export {
    oneTimeUploadExample,
    reusableUploadExample,
    batchOneTimeUploadExample,
    rawPresignedUrlExample,
    main,
};

main();
