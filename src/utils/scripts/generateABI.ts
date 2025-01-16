import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";

// 获取命令行参数
const [interfacesDir, outputDir = "./abis"] = process.argv.slice(2);
if (!interfacesDir) {
  console.error("请提供必要的参数！");
  console.error(
    "使用方法: ts-node generateABI.ts <接口目录路径> [输出目录路径]"
  );
  console.error("例如: ts-node generateABI.ts ./contracts/interfaces ./abis");
  process.exit(1);
}

// 转换为绝对路径
const absoluteInterfacesDir = path.resolve(process.cwd(), interfacesDir);
const absoluteOutputDir = path.resolve(process.cwd(), outputDir);

// 检查目录
if (!fs.existsSync(absoluteInterfacesDir)) {
  console.error(`接口目录不存在: ${absoluteInterfacesDir}`);
  process.exit(1);
}

// 创建输出目录
if (!fs.existsSync(absoluteOutputDir)) {
  fs.mkdirSync(absoluteOutputDir, { recursive: true });
  console.log(`✅ 创建输出目录: ${absoluteOutputDir}`);
}

// 递归获取所有.sol文件
function getAllSolFiles(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);

  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      results = results.concat(getAllSolFiles(filePath));
    } else if (file.endsWith(".sol")) {
      results.push(filePath);
    }
  });

  return results;
}

const solFiles = getAllSolFiles(absoluteInterfacesDir);

if (solFiles.length === 0) {
  console.error("未找到.sol文件！");
  process.exit(1);
}

console.log(`找到 ${solFiles.length} 个接口文件待处理...`);

// 使用 Promise 处理异步编译
const compilePromises = solFiles.map((filePath) => {
  return new Promise((resolve, reject) => {
    const fileName = path.basename(filePath, ".sol");
    const command = `solcjs --abi ${filePath} --output-dir ${absoluteOutputDir}`;

    exec(command, async (error, stdout, stderr) => {
      if (error) {
        // 版本不匹配时的处理
        if (stderr && stderr.includes("requires different compiler version")) {
          const versionMatch = stderr.match(/pragma solidity ([\d.]+)/);
          if (versionMatch) {
            const requiredVersion = versionMatch[1];
            console.log(
              `⚠️ ${fileName} 需要 Solidity ${requiredVersion} 版本，尝试安装并使用...`
            );

            try {
              // 等待 3 秒确保 npx 安装完成
              await new Promise((resolve) => setTimeout(resolve, 3000));

              const retryCommand = `npx solc@${requiredVersion} --abi ${filePath} -o ${absoluteOutputDir}`;
              exec(retryCommand, (retryError, retryStdout, retryStderr) => {
                if (retryError) {
                  console.error(`❌ 编译 ${fileName} 出错:`, retryError);
                  reject(retryError);
                  return;
                }

                // 检查生成的文件
                const checkAndRename = () => {
                  const generatedFiles = fs.readdirSync(absoluteOutputDir);
                  const possibleNames = [
                    `${fileName}.abi`,
                    `${path.basename(filePath)}_${fileName}.abi`,
                    `${fileName}_sol_${fileName}.abi`,
                    `${fileName}.json`,
                  ];

                  for (const possibleName of possibleNames) {
                    const abiFile = generatedFiles.find((f) =>
                      f.includes(possibleName)
                    );
                    if (abiFile) {
                      const newPath = path.join(
                        absoluteOutputDir,
                        `${fileName}.json`
                      );
                      if (fs.existsSync(newPath)) {
                        fs.unlinkSync(newPath);
                      }
                      fs.renameSync(
                        path.join(absoluteOutputDir, abiFile),
                        newPath
                      );
                      console.log(`✅ 已生成 ${fileName}.json`);
                      resolve(fileName);
                      return true;
                    }
                  }
                  return false;
                };

                // 尝试多次检查文件
                setTimeout(() => {
                  if (!checkAndRename()) {
                    reject(new Error(`未找到 ${fileName} 的ABI文件`));
                  }
                }, 1000);
              });
            } catch (err) {
              console.error(`❌ 处理 ${fileName} 时出错:`, err);
              reject(err);
            }
            return;
          }
        }
        console.error(`❌ 编译 ${fileName} 出错:`, error);
        reject(error);
        return;
      }

      // 处理正常编译的情况
      setTimeout(() => {
        const generatedFiles = fs.readdirSync(absoluteOutputDir);
        const abiFile = generatedFiles.find(
          (f) =>
            f.includes(fileName) && (f.endsWith(".abi") || f.includes("_sol_"))
        );

        if (abiFile) {
          const newPath = path.join(absoluteOutputDir, `${fileName}.json`);
          fs.renameSync(path.join(absoluteOutputDir, abiFile), newPath);
          console.log(`✅ 已生成 ${fileName}.json`);
          resolve(fileName);
        } else {
          reject(new Error(`未找到 ${fileName} 的ABI文件`));
        }
      }, 1000); // 等待 1 秒确保文件已生成
    });
  });
});

// 改进错误处理
Promise.all(compilePromises.map((p) => p.catch((e) => e)))
  .then((results) => {
    const successfulFiles = results.filter((r) => typeof r === "string");
    const errors = results.filter((r) => r instanceof Error);

    if (errors.length > 0) {
      console.log("\n⚠️ 部分文件处理失败:");
      errors.forEach((e) => console.error(e.message));
    }

    if (successfulFiles.length > 0) {
      // 生成 index.ts
      const indexContent = `${successfulFiles
        .map((name) => `import ${name}ABI from './${name}.json';`)
        .join("\n")}

export {
${successfulFiles.map((name) => `    ${name}ABI,`).join("\n")}
};
`;

      const indexPath = path.join(absoluteOutputDir, "index.ts");
      fs.writeFileSync(indexPath, indexContent);
      console.log(`\n✅ 已生成 index.ts`);

      // 生成类型声明文件
      const declarationContent = `declare module '*.json' {
    const value: any;
    export default value;
}`;

      const dtsPath = path.join(absoluteOutputDir, "abis.d.ts");
      fs.writeFileSync(dtsPath, declarationContent);
      console.log(`✅ 已生成 abis.d.ts`);
    }
  })
  .catch((error) => {
    console.error("处理过程中出现错误:", error);
    process.exit(1);
  });
