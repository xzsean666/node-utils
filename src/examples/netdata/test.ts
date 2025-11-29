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
  // const netData = await netDataHelper.getAverageNetworkTraffic();
  // console.log(netData);
  // const allCharts = await netDataHelper.getAllCharts();
  // console.log(Object.keys(allCharts.charts));
  // // console.log(allCharts);
  // console.log(allCharts.charts['disk_space./']);
  // for (const chart of Object.keys(allCharts.charts)) {
  //   if (chart.includes('system')) {
  //     console.log(chart);
  //   }
  // }
  // const diskUsage = await netDataHelper.getAverageDiskIO();
  // console.log(diskUsage);
}

test();
