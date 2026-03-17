import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

export const config = {
  baseUrl: 'http://31.58.137.32:13001',
  username: process.env.VITE_UK_USERNAME,
  password: process.env.VITE_UK_PASSWORD,
};
