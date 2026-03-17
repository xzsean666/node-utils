import { NetDataHelper } from '../../system/NetDataHelper';
import dotenv from 'dotenv';

dotenv.config();
const config = process.env.VITE_NETDATA_BASE_URL || 'http://localhost:19999';
const baseUrl = JSON.parse(config);
console.log(baseUrl);

export const netDataHelper = new NetDataHelper(baseUrl[0]);
