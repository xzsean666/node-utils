import { NetDataHelper } from '../../NetDataHelper';
import dotenv from 'dotenv';

dotenv.config();
const baseUrl = process.env.NETDATA_BASE_URL || 'http://localhost:19999';

export const netDataHelper = new NetDataHelper(baseUrl);
