import 'reflect-metadata';
import { PGKVDatabase } from './KVPostgresql';
import { SqliteKVDatabase } from './KVSqlite';
import path from 'path';
import fs from 'fs';

/**
 * 通用数据库服务类 (Postgres)
 * 负责管理和复用不同表的 KVDatabase 实例
 */
export class PGDBService {
    private static instance: PGDBService | null = null;
    private dbInstances: Map<string, PGKVDatabase> = new Map();
    private readonly db_url: string;
    private readonly prefix: string;

    private constructor(db_url: string, prefix: string = '') {
        this.db_url = db_url;
        this.prefix = prefix;
    }

    public static getInstance(db_url: string, prefix: string = ''): PGDBService {
        if (!PGDBService.instance) {
            PGDBService.instance = new PGDBService(db_url, prefix);
        }
        return PGDBService.instance;
    }

    /**
     * 获取指定表的数据库实例
     * @param tableName 表名
     * @returns KVDatabase 实例
     */
    public getDBInstance(tableName: string): PGKVDatabase {
        if (!this.db_url) {
            throw new Error('DATABASE_URL 未配置，无法获取数据库实例');
        }

        let finalTableName = tableName;

        if (this.prefix) {
            finalTableName = `${this.prefix}_${tableName}`;
        }

        if (!this.dbInstances.has(finalTableName)) {
            this.dbInstances.set(finalTableName, new PGKVDatabase(this.db_url, finalTableName));
        }
        return this.dbInstances.get(finalTableName) as PGKVDatabase;
    }

    /**
     * 关闭所有已打开的数据库连接
     */
    public async destroy() {
        for (const db of this.dbInstances.values()) {
            await db.close();
        }
        this.dbInstances.clear();
    }
}

/**
 * Sqlite 数据库服务类
 * 负责管理和复用不同表的 SqliteKVDatabase 实例
 */
export class SqliteDBService {
    private static instance: SqliteDBService | null = null;
    private dbInstances: Map<string, SqliteKVDatabase> = new Map();
    private readonly dbPath: string;

    private constructor(dbPath: string) {
        this.dbPath = dbPath;
    }

    public static getInstance(): SqliteDBService {
        if (!SqliteDBService.instance) {
            // 确保数据目录存在
            const DATA_DIR = path.resolve(process.cwd(), 'data');
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            const dbPath = path.join(DATA_DIR, 'trade_dashboard.sqlite');
            SqliteDBService.instance = new SqliteDBService(dbPath);
        }
        return SqliteDBService.instance;
    }

    /**
     * 获取指定表的数据库实例
     * @param tableName 表名
     * @returns KVDatabase 实例
     */
    public getDBInstance(tableName: string): SqliteKVDatabase {
        if (!this.dbInstances.has(tableName)) {
            this.dbInstances.set(tableName, new SqliteKVDatabase(this.dbPath, tableName));
        }
        return this.dbInstances.get(tableName) as SqliteKVDatabase;
    }

    /**
     * 关闭所有已打开的数据库连接
     */
    public async destroy() {
        for (const db of this.dbInstances.values()) {
            await db.close();
        }
        this.dbInstances.clear();
    }
}

export const db_tables = {
    invite_code: 'invite_code',
    user_otp: 'user_otp',
    user_password: 'user_password',
    user_ex: 'user_ex',
    user_history: 'user_history',
    user_admin: 'user_admin',
    klines: 'klines',
    user_admin_privileges: 'user_admin_privileges',
    backtest_reports: 'backtest_reports',
};

// 导出便捷使用的 SqliteDBService 实例（仅用于缓存）
export const sqliteDBService = SqliteDBService.getInstance();

// 导出便捷使用的 PGDBService 实例（用于持久化数据）
import { config } from '@helpers/config';
export const pgDBService = PGDBService.getInstance(config.database.url!, config.database.prefix);
