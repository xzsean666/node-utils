import * as fs from "fs";
import * as path from "path";

// 获取命令行参数,设置默认输出目录
const [configPath] = process.argv.slice(2);
const outputDir = path.resolve(__dirname, "../src/vite");

if (!configPath) {
  console.error("请提供配置文件路径！");
  console.error("示例: ts-node scripts/copyConfig.ts src/config/localVault");
  process.exit(1);
}

// 导入配置文件
const configFullPath = path.resolve(__dirname, "..", configPath);
if (!fs.existsSync(configFullPath)) {
  console.error(`配置文件不存在: ${configFullPath}`);
  process.exit(1);
}

// 确保输出目录存在
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 获取配置文件的基本名称(不含扩展名)
const configBaseName = path.basename(configPath, path.extname(configPath));

// 动态导入配置
import(configFullPath)
  .then((module) => {
    const config = module.config;

    // 使用原始文件名但扩展名改为.json
    const outputPath = path.join(outputDir, `${configBaseName}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
    console.log(`配置已写入: ${outputPath}`);
  })
  .catch((error) => {
    console.error("导入配置文件失败:", error);
    process.exit(1);
  });
