/**
 * WaveParty — Sample Library (个人音效库)
 * 使用 IndexedDB 持久化存储音频采样，支持保存/列表/加载/删除。
 * 
 * 存储内容：
 *   - 元数据（名称、参考音高、时长等）
 *   - 音频 PCM 数据（从 AudioBuffer 提取，存储为 Float32Array 的 ArrayBuffer）
 *
 * 使用方式：
 *   SampleLibrary.init().then(...)  // 初始化 DB
 *   SampleLibrary.save({ name, fileName, baseMidi, buffer })  // 保存
 *   SampleLibrary.list()             // 列出所有
 *   SampleLibrary.load(id, audioCtx) // 加载为 AudioBuffer
 *   SampleLibrary.remove(id)         // 删除
 */
window.SampleLibrary = (function () {
    'use strict';

    const DB_NAME   = 'waveparty-samples';
    const DB_VERSION = 1;
    const STORE_NAME = 'samples';

    let db = null;

    /* ===== IndexedDB 初始化 ===== */
    function init() {
        return new Promise(function (resolve, reject) {
            if (db) { resolve(db); return; }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                const _db = e.target.result;
                if (!_db.objectStoreNames.contains(STORE_NAME)) {
                    const store = _db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('name',    'name',    { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };
            req.onsuccess = function (e) {
                db = e.target.result;
                resolve(db);
            };
            req.onerror = function (e) {
                reject(e.target.error);
            };
        });
    }

    function getDB() {
        return db ? Promise.resolve(db) : init();
    }

    /* ===== AudioBuffer ↔ 可存储对象 ===== */

    /**
     * 将 AudioBuffer 转为可存入 IndexedDB 的纯 JS 对象
     * （IndexedDB 可以存储 ArrayBuffer）
     */
    function audioBufferToStored(buffer) {
        const channels = [];
        for (let i = 0; i < buffer.numberOfChannels; i++) {
            const chData = buffer.getChannelData(i);   // Float32Array
            // 显式拷贝，避免 .buffer 指向更大内部缓冲区
            const copy = new Float32Array(chData.length);
            copy.set(chData);
            channels.push(copy.buffer);              // ArrayBuffer（仅实际数据）
        }
        return {
            sampleRate     : buffer.sampleRate,
            numberOfChannels: buffer.numberOfChannels,
            length         : buffer.length,
            channels       : channels,   // ArrayBuffer[]
        };
    }

    /**
     * 从存储对象恢复为 AudioBuffer
     * @param {AudioContext} audioCtx
     * @param {Object} stored  - audioBufferToStored 的输出
     * @returns {AudioBuffer}
     */
    function storedToAudioBuffer(audioCtx, stored) {
        const buffer = audioCtx.createBuffer(
            stored.numberOfChannels,
            stored.length,
            stored.sampleRate
        );
        for (let i = 0; i < stored.numberOfChannels; i++) {
            const chData = new Float32Array(stored.channels[i]);
            buffer.copyToChannel(chData, i);
        }
        return buffer;
    }

    /* ===== 公开 API ===== */

    /**
     * 保存采样到音效库
     * @param {Object} opts
     * @param {string}   opts.name         - 用户命名的音效名称
     * @param {string}   opts.fileName     - 原始文件名
     * @param {number}   opts.baseMidi     - 参考音高 MIDI 编号
     * @param {number}   opts.baseFreq     - 参考音高频率
     * @param {number}   opts.duration     - 时长（秒）
     * @param {number}   opts.sampleRate   - 采样率
     * @param {AudioBuffer} opts.buffer   - 解码后的 AudioBuffer
     * @returns {Promise<string>} 保存的 id
     */
    function save(opts) {
        return getDB().then(function (_db) {
            return new Promise(function (resolve, reject) {
                const id = 'smp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
                const record = {
                    id            : id,
                    name          : opts.name || opts.fileName || '未命名音效',
                    fileName      : opts.fileName || '',
                    baseMidi      : opts.baseMidi || 60,
                    baseFreq      : opts.baseFreq || 261.63,
                    duration      : opts.duration || 0,
                    sampleRate    : opts.sampleRate || 44100,
                    createdAt     : Date.now(),
                    // 存储 PCM 数据（而不是 AudioBuffer 本身）
                    pcmData       : audioBufferToStored(opts.buffer),
                };

                const tx    = _db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const req   = store.put(record);

                req.onsuccess = function () { resolve(id); };
                req.onerror   = function () { reject(req.error); };
            });
        });
    }

    /**
     * 列出所有已保存的采样（不含 pcmData，仅元数据）
     * @returns {Promise<Array>}
     */
    function list() {
        return getDB().then(function (_db) {
            return new Promise(function (resolve, reject) {
                const tx    = _db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req   = store.getAll();

                req.onsuccess = function (e) {
                    const records = e.target.result || [];
                    // 不返回 pcmData（太大），只返回元数据
                    const result = records.map(function (r) {
                        return {
                            id        : r.id,
                            name      : r.name,
                            fileName  : r.fileName,
                            baseMidi  : r.baseMidi,
                            baseFreq  : r.baseFreq,
                            duration  : r.duration,
                            sampleRate: r.sampleRate,
                            createdAt : r.createdAt,
                        };
                    });
                    // 按创建时间倒序
                    result.sort(function (a, b) { return b.createdAt - a.createdAt; });
                    resolve(result);
                };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    /**
     * 加载完整记录（含 pcmData）并恢复为 AudioBuffer
     * @param {string} id
     * @param {AudioContext} audioCtx
     * @returns {Promise<{ record: Object, audioBuffer: AudioBuffer }>}
     */
    function load(id, audioCtx) {
        return getDB().then(function (_db) {
            return new Promise(function (resolve, reject) {
                const tx    = _db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req   = store.get(id);

                req.onsuccess = function (e) {
                    const record = e.target.result;
                    if (!record) {
                        reject(new Error('音效不存在：' + id));
                        return;
                    }
                    try {
                        const audioBuffer = storedToAudioBuffer(audioCtx, record.pcmData);
                        resolve({
                            record     : record,
                            audioBuffer: audioBuffer,
                        });
                    } catch (err) {
                        reject(err);
                    }
                };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    /**
     * 删除指定采样
     * @param {string} id
     * @returns {Promise<void>}
     */
    function remove(id) {
        return getDB().then(function (_db) {
            return new Promise(function (resolve, reject) {
                const tx    = _db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const req   = store.delete(id);
                req.onsuccess = function () { resolve(); };
                req.onerror   = function () { reject(req.error); };
            });
        });
    }

    /**
     * 获取存储使用情况（估算）
     * @returns {Promise<{ count: number, totalDuration: number }>}
     */
    function getStats() {
        return list().then(function (items) {
            const totalDuration = items.reduce(function (sum, i) { return sum + (i.duration || 0); }, 0);
            return {
                count         : items.length,
                totalDuration  : totalDuration,
            };
        });
    }

    // 公开 API
    return {
        init   : init,
        save   : save,
        list   : list,
        load   : load,
        remove : remove,
        getStats: getStats,
    };
})();
