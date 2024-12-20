const fs = require('fs');

function bumpVersion() {
  // 使用不同的变量名，避免使用 package 这个保留字
  const pkgJson = JSON.parse(fs.readFileSync('./package.json'));
  
  // 分割版本号
  const [major, minor, patch] = pkgJson.version.split('.').map(Number);
  
  // 增加补丁版本号
  pkgJson.version = `${major}.${minor}.${patch + 1}`;
  
  // 更新 package.json
  fs.writeFileSync('./package.json', JSON.stringify(pkgJson, null, 2));
  
  console.log(`Version bumped to ${pkgJson.version}`);
}

bumpVersion(); 