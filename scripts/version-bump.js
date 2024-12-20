const fs = require('fs');
const { execSync } = require('child_process');

try {
  // 读取当前版本
  const package = JSON.parse(fs.readFileSync('./package.json'));
  const currentVersion = package.version;

  // 更新补丁版本
  const [major, minor, patch] = currentVersion.split('.');
  const newVersion = `${major}.${minor}.${parseInt(patch) + 1}`;

  // 更新 package.json
  package.version = newVersion;
  fs.writeFileSync('./package.json', JSON.stringify(package, null, 2));

  // 提交更改
  execSync('git add package.json');
  execSync(`git commit -m "chore: bump version to ${newVersion}"`);
  execSync(`git tag v${newVersion}`);

  console.log(`Successfully bumped version to ${newVersion}`);
} catch (error) {
  console.error('Error updating version:', error);
  process.exit(1);
} 