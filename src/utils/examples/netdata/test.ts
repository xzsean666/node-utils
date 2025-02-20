import { netDataHelper } from '.';

async function test() {
  //   const data = await netDataHelper.getSystemInfo();
  //   console.log(data);
  //   const cpuUsage = await netDataHelper.getCPUUsage();
  //   console.log(cpuUsage);
  //   const memoryUsage = await netDataHelper.getMemoryUsage();
  //   console.log(memoryUsage);
  //   const diskUsage = await netDataHelper.getDiskUsage();
  //   console.log(diskUsage);
  const systemMetrics = await netDataHelper.getSystemMetrics();
  console.log(JSON.stringify(systemMetrics, null, 2));
}

test();
