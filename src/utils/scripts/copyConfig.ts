import * as fs from "fs";
import * as path from "path";

// 导入所需的配置
import { config } from "../src/config";

// 创建新的配置对象，排除 privateKey
const publicConfig = { ...config };
delete (publicConfig as any).privateKey;

// 确保目标目录存在
const targetDir = path.resolve(__dirname, "../src/vite");
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// 写入配置文件
const configPath = path.join(targetDir, "config.json");
fs.writeFileSync(configPath, JSON.stringify(publicConfig, null, 2));

console.log(`配置已写入: ${configPath}`);
