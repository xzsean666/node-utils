import * as fs from "fs";
import * as path from "path";

const sourceDir = path.resolve(__dirname, "../src");
const targetDir = path.resolve(__dirname, "../src/vite");

// 创建目标目录
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// 用于存储已处理的文件，避免重复处理
const processedFiles = new Set<string>();

// 分析文件依赖并复制
function analyzeDependencies(filePath: string) {
  if (processedFiles.has(filePath)) return;
  processedFiles.add(filePath);

  const content = fs.readFileSync(filePath, "utf-8");
  const relativePath = path.relative(sourceDir, filePath);
  const targetPath = path.join(targetDir, relativePath);

  // 创建目标文件所在的目录
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(filePath, targetPath);

  console.log(`Copied: ${relativePath}`);

  // 使用正则表达式查找 import 语句
  const importRegex = /from\s+['"]([^'"]+)['"]/g;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];

    // 跳过 node_modules 的依赖
    if (!importPath.startsWith(".")) continue;

    // 解析相对路径
    const absolutePath = path.resolve(path.dirname(filePath), importPath);
    const resolvedPath =
      absolutePath + (absolutePath.endsWith(".ts") ? "" : ".ts");

    if (fs.existsSync(resolvedPath)) {
      analyzeDependencies(resolvedPath);
    }
  }
}

// 获取命令行参数
const targetFile = process.argv[2];
if (!targetFile) {
  console.error("请提供要分析的文件路径！");
  console.error("示例: ts-node scripts/copyDependencies.ts src/LSTHelper.ts");
  process.exit(1);
}

// 修改起始文件路径
const startFile = path.resolve(sourceDir, targetFile.replace(/^src\//, ""));
if (!fs.existsSync(startFile)) {
  console.error(`文件不存在: ${startFile}`);
  process.exit(1);
}

analyzeDependencies(startFile);

console.log("Dependencies copying completed!");
