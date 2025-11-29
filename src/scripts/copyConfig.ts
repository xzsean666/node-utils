import * as fs from "fs";
import * as path from "path";

// 获取命令行参数
const args = process.argv.slice(2);
let configPath: string | undefined;
let customTargetDir: string | undefined;

// 解析命令行参数
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--input" && args[i + 1]) {
    configPath = path.resolve(process.cwd(), args[i + 1]);
    i++;
  } else if (args[i] === "--output" && args[i + 1]) {
    customTargetDir = path.resolve(process.cwd(), args[i + 1]);
    i++;
  }
}

if (!configPath) {
  console.error("请提供配置文件路径！");
  console.error(
    "用法: ts-node scripts/copyConfig.ts --input <配置文件路径> [--output <目标目录>]"
  );
  console.error(
    "示例: ts-node scripts/copyConfig.ts --input src/config/shibuyaConfig.ts --output ./dist"
  );
  process.exit(1);
}

// 使用自定义目录或默认目录
const targetDir = customTargetDir || "src/main";

// 导入配置文件
const configFullPath = path.resolve(process.cwd(), configPath);
if (!fs.existsSync(configFullPath)) {
  console.error(`配置文件不存在: ${configFullPath}`);
  process.exit(1);
}

// 确保输出目录存在
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// 获取配置文件的基本名称(不含扩展名)
const configBaseName = path.basename(configPath, path.extname(configPath));

// 动态导入配置
import(configFullPath)
  .then((module) => {
    const config = module.config;

    // 创建配置的副本并移除 privateKey
    const configToWrite = { ...config };
    delete configToWrite.privateKey;

    // 使用原始文件名但扩展名改为.json
    const outputPath = path.join(targetDir, `${configBaseName}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(configToWrite, null, 2));
    console.log(`配置已写入: ${outputPath}`);
  })
  .catch((error) => {
    console.error("导入配置文件失败:", error);
    process.exit(1);
  });
