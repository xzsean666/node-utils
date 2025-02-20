import { uptimeKumaHelper } from ".";

async function test() {
  const getMonitors = await uptimeKumaHelper.getMonitors();
  console.log(JSON.stringify(getMonitors, null, 2));
  // const monitor1 = await uptimeKumaHelper.getMonitorStatus(1);
  // console.log(monitor1);
  // const monitor = await uptimeKumaMonitor.getStatus();
  // console.log(monitor);
  uptimeKumaHelper.close();
}
test();
