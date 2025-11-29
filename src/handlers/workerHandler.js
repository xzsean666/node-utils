"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkerPool = void 0;
var worker_threads_1 = require("worker_threads");
var os = require("os");
var path = require("path");
var crypto_1 = require("crypto");
var WorkerPool = /** @class */ (function () {
    function WorkerPool(maxWorkers) {
        if (maxWorkers === void 0) { maxWorkers = os.cpus().length; }
        this.workers = [];
        this.idleWorkers = [];
        this.taskQueue = [];
        this.activeTasks = new Map();
        this.maxWorkers = maxWorkers;
    }
    WorkerPool.prototype.spawnWorker = function () {
        var _this = this;
        var worker = new worker_threads_1.Worker(__filename);
        worker.on('message', function (msg) {
            var taskId = msg.taskId, result = msg.result, error = msg.error;
            var taskPromise = _this.activeTasks.get(taskId);
            if (taskPromise) {
                _this.activeTasks.delete(taskId);
                if (error)
                    taskPromise.reject(new Error(error));
                else
                    taskPromise.resolve(result);
            }
            _this.idleWorkers.push(worker);
            _this.next();
        });
        worker.on('error', function (err) {
            console.error('Worker error:', err);
        });
        this.idleWorkers.push(worker);
        this.workers.push(worker);
    };
    WorkerPool.prototype.next = function () {
        if (!this.idleWorkers.length || !this.taskQueue.length)
            return;
        var worker = this.idleWorkers.pop();
        var task = this.taskQueue.shift();
        worker.postMessage(task);
    };
    WorkerPool.prototype.run = function (jsFilePath, funcName, args) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var taskId = (0, crypto_1.randomUUID)();
            _this.activeTasks.set(taskId, { resolve: resolve, reject: reject });
            var task = {
                taskId: taskId,
                jsFilePath: jsFilePath,
                funcName: funcName,
                args: args,
            };
            _this.taskQueue.push(task);
            if (_this.workers.length < _this.maxWorkers)
                _this.spawnWorker();
            _this.next();
        });
    };
    WorkerPool.prototype.destroy = function () {
        for (var _i = 0, _a = this.workers; _i < _a.length; _i++) {
            var w = _a[_i];
            w.terminate();
        }
    };
    return WorkerPool;
}());
exports.WorkerPool = WorkerPool;
// Worker 逻辑放在文件底部
if (!worker_threads_1.isMainThread) {
    worker_threads_1.parentPort.on('message', function (task) { return __awaiter(void 0, void 0, void 0, function () {
        var taskId, jsFilePath, funcName, args, mod, result, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    taskId = task.taskId, jsFilePath = task.jsFilePath, funcName = task.funcName, args = task.args;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    mod = require(path.resolve(jsFilePath));
                    if (!(funcName in mod))
                        throw new Error("Function ".concat(funcName, " not found"));
                    return [4 /*yield*/, mod[funcName].apply(mod, args)];
                case 2:
                    result = _a.sent();
                    worker_threads_1.parentPort.postMessage({ taskId: taskId, result: result });
                    return [3 /*break*/, 4];
                case 3:
                    err_1 = _a.sent();
                    worker_threads_1.parentPort.postMessage({ taskId: taskId, error: err_1.message });
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    }); });
}
