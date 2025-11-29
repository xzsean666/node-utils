

class Indexeddb {
    db: IDBDatabase | unknown;
    storeName: string;
    dbName: string;
    version: number;
    keyPath: string;
    constructor(dbName = "LocalCache", storeName = "LocalCache", version = 1, keyPath = "key") {
        this.openIndexDB(dbName, version, keyPath).then((db) => { this.db = db })
        this.dbName = dbName
        this.version = version
        this.keyPath = keyPath
        this.storeName = storeName
    }
    async openIndexDB(dbName: string, version = 1, keyPath = "key") {
        return new Promise((resolve) => {
            //  兼容浏览器
            const indexedDB = window.indexedDB;
            let db;
            // 打开数据库，若没有则会创建
            const request = indexedDB.open(dbName, version);
            // 数据库打开成功回调
            request.onsuccess = () => {
                db = request.result;
                // console.log("数据库打开成功");
                resolve(db);
            };
            // 数据库打开失败的回调
            request.onerror = function () {
                console.log("数据库打开报错");
            };
            // 数据库有更新时候的回调
            request.onupgradeneeded = () => {
                // 数据库创建或升级的时候会触发
                console.log("onupgradeneeded");
                db = request.result; // 数据库对象
                // 创建存储库
                db.createObjectStore(dbName, {
                    keyPath: keyPath,
                });
            };
        });
    }
    async getDB() {
        if (this.db instanceof IDBDatabase) {
            return this.db
        } else {
            this.db = await this.openIndexDB(this.dbName, this.version, this.keyPath)
            if (this.db instanceof IDBDatabase) {
                return this.db
            } else {
                throw new Error("browser not support indexedDB!");
            }
        }
    }
    async updateDB(db: IDBDatabase, storeName: string, data: object) {
        return new Promise((resolve) => {
            const request = db
                .transaction([storeName], "readwrite")
                .objectStore(storeName)
                .put(data);

            request.onsuccess = function () {
                // console.log("数据更新成功");
                resolve(true)
            };

            request.onerror = function () {
                // console.log("数据更新失败");
                throw new Error("put data failed!");
            };
        });
    }
    async getDataByKeyPathValue(db: IDBDatabase, storeName: string, keyPathValue: string) {
        return new Promise((resolve) => {
            const transaction = db.transaction([storeName]);
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.get(keyPathValue);

            request.onerror = function () {
                // console.log("事务失败");
                throw new Error("data not found!");
            };

            request.onsuccess = function () {
                // console.log("主键查询结果: ", request.result);
                resolve(request.result);
            };
        });
    }
    async deleteDataByKeyPathValue(db: IDBDatabase, storeName: string, keyPathValue: string) {
        return new Promise((resolve) => {
            const request = db
                .transaction([storeName], "readwrite")
                .objectStore(storeName)
                .delete(keyPathValue);

            request.onsuccess = function () {
                resolve(true)
                // console.log("数据删除成功");
            };

            request.onerror = function () {
                throw new Error("database error!");
                // console.log("数据删除失败");
            };
        });
    }

    async put(key: string, value: any) {
        const data = {
            key: key,
            value: value
        }
        const db = await this.getDB()
        const result = await this.updateDB(db, this.storeName, data);
        return result
    }
    async get(key: string, Default = null) {
        const db = await this.getDB()
        let result: any = await this.getDataByKeyPathValue(db, this.storeName, key);
        try {
            result = result.value
        } catch (error) {
            result = Default
        }
        return result
    }
    async delete(key: string) {
        const db = await this.getDB()
        const result = await this.deleteDataByKeyPathValue(db, this.storeName, key)
        return result
    }
}
export default Indexeddb
