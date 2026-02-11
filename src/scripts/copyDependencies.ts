import * as fs from 'fs';
import * as path from 'path';

// 获取命令行参数
const args = process.argv.slice(2);
let inputFile: string | undefined;
let outputDir: string | undefined;
let relativeDir: string | undefined;

// 解析命令行参数
let baseStrip: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--input' && args[i + 1]) {
    inputFile = args[i + 1];
    i++;
  } else if (args[i] === '--output' && args[i + 1]) {
    outputDir = path.resolve(process.cwd(), args[i + 1]);
    i++;
  } else if (args[i] === '--base' && args[i + 1]) {
    baseStrip = args[i + 1];
    i++;
  }
}

if (!inputFile) {
  console.error('请提供要分析的文件路径！');
  console.error(
    '用法: ts-node src/utils/scripts/copyDependencies.ts --input <文件路径> --output <目标目录> [--base <要剥离的基础路径>]',
  );
  console.error(
    '示例: ts-node src/utils/scripts/copyDependencies.ts --input src/LSTHelper.ts --output ./dist --base src',
  );
  process.exit(1);
}

// 使用当前工作目录作为源目录
const sourceDir = process.cwd();
const targetDir = outputDir || 'src/main';

// 预处理 baseStrip，确保它不以 / 结尾，如果是空则不处理
const normalizedBase = baseStrip ? baseStrip.replace(/\/+$/, '') : '';

// 创建目标目录
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// 用于存储已处理的文件，避免重复处理
const processedFiles = new Set<string>();

// 递归分析文件依赖并复制
function analyzeDependencies(filePath: string, depth = 0, maxDepth = 10) {
  if (processedFiles.has(filePath) || depth > maxDepth) return;
  processedFiles.add(filePath);

  const content = fs.readFileSync(filePath, 'utf-8');
  const relativePathFromCwd = path.relative(sourceDir, filePath);

  // 这里的逻辑是：如果指定了 baseStrip，我们就从 cwd 相对路径中去掉这个前缀
  let relativePathFixed = relativePathFromCwd;
  if (normalizedBase) {
    const baseWithSlash = normalizedBase.endsWith('/') ? normalizedBase : normalizedBase + '/';
    if (relativePathFromCwd.startsWith(baseWithSlash)) {
      relativePathFixed = relativePathFromCwd.substring(baseWithSlash.length);
    } else if (relativePathFromCwd === normalizedBase) {
      relativePathFixed = path.basename(relativePathFromCwd);
    }
  }

  const targetPath = path.join(targetDir, relativePathFixed);

  // 创建目标文件所在的目录
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(filePath, targetPath);

  console.log(`Copied [Depth ${depth}]: ${relativePathFromCwd} -> ${path.relative(targetDir, targetPath)}`);

  // 使用正则表达式查找所有类型的导入语句
  const importRegexes = [
    /from\s+['"]([^'"]+)['"]/g, // ES6 imports
    /require\(['"]([^'"]+)['"]\)/g, // CommonJS require
    /import\(['"]([^'"]+)['"]\)/g, // Dynamic imports
  ];

  for (const regex of importRegexes) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const importPath = match[1];

      // 跳过 node_modules 的依赖
      if (!importPath.startsWith('.')) continue;

      // 解析相对路径
      const absolutePath = path.resolve(path.dirname(filePath), importPath);
      const possibleExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json'];

      // 尝试不同的文件扩展名
      for (const ext of possibleExtensions) {
        const resolvedPath =
          absolutePath + (absolutePath.endsWith(ext) ? '' : ext);
        if (fs.existsSync(resolvedPath)) {
          analyzeDependencies(resolvedPath, depth + 1, maxDepth);
          break;
        }
      }

      // 尝试作为目录处理 (查找 index 文件)
      if (
        fs.existsSync(absolutePath) &&
        fs.statSync(absolutePath).isDirectory()
      ) {
        for (const ext of possibleExtensions) {
          const indexPath = path.join(absolutePath, `index${ext}`);
          if (fs.existsSync(indexPath)) {
            analyzeDependencies(indexPath, depth + 1, maxDepth);
            break;
          }
        }
      }
    }
  }
}

// 修改起始文件路径
const startFile = path.resolve(sourceDir, inputFile);
if (!fs.existsSync(startFile)) {
  console.error(`文件不存在: ${startFile}`);
  process.exit(1);
}

analyzeDependencies(startFile);

console.log('Dependencies copying completed!');
