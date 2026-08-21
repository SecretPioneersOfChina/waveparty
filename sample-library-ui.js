/**
 * WaveParty — Sample Library UI
 * 个人音效库面板：展示、预览、删除、应用已保存的采样。
 * 依赖：SampleLibrary（IndexedDB 存储模块）
 */
window.SampleLibraryUI = (function () {
    'use strict';

    let panelEl = null;
    let listEl   = null;
    let statsEl  = null;
    let previewSource = null;   // 预览用 AudioBufferSourceNode

    /* ===== 初始化面板 DOM ===== */
    function init() {
        if (panelEl) return;

        panelEl = document.createElement('div');
        panelEl.id = 'sample-library-panel';
        panelEl.className = 'modal-overlay';
        panelEl.style.display = 'none';

        panelEl.innerHTML = `
        <div class="sl-panel-box">
            <div class="sl-header">
                <span class="sl-title">🎵 个人音效库</span>
                <button class="sl-close-btn" id="sl-close-btn">×</button>
            </div>
            <div class="sl-toolbar">
                <button class="sl-btn sl-btn-import" id="sl-import-btn">📁 导入新音效</button>
                <button class="sl-btn sl-btn-refresh" id="sl-refresh-btn">🔄 刷新</button>
                <span class="sl-stats" id="sl-stats"></span>
            </div>
            <div class="sl-list-wrap" id="sl-list-wrap">
                <div class="sl-empty" id="sl-empty">音效库为空，请先导入并保存音效。</div>
                <div class="sl-list" id="sl-list"></div>
            </div>
        </div>`;

        document.body.appendChild(panelEl);

        // 缓存 DOM
        listEl  = document.getElementById('sl-list');
        statsEl = document.getElementById('sl-stats');

        // 绑定事件
        document.getElementById('sl-close-btn').addEventListener('click', close);
        document.getElementById('sl-import-btn').addEventListener('click', function () {
            close();
            if (window.SampleImporter && window.SampleImporter.open) {
                window.SampleImporter.open();
            }
        });
        document.getElementById('sl-refresh-btn').addEventListener('click', renderList);

        panelEl.addEventListener('click', function (e) {
            if (e.target === panelEl) close();
        });
    }

    /* ===== 打开 / 关闭 ===== */
    function open() {
        if (!panelEl) init();
        panelEl.style.display = 'flex';
        renderList();
    }

    function close() {
        stopPreview();
        if (panelEl) panelEl.style.display = 'none';
    }

    /* ===== 渲染列表 ===== */
    function renderList() {
        if (!window.SampleLibrary) {
            showEmpty('音效库模块未加载');
            return;
        }

        window.SampleLibrary.list().then(function (items) {
            if (items.length === 0) {
                showEmpty('音效库为空，请先导入并保存音效。');
                updateStats(0, 0);
                return;
            }

            listEl.innerHTML = '';
            items.forEach(function (item) {
                const div = document.createElement('div');
                div.className = 'sl-item';
                div.dataset.id = item.id;

                const noteName = midiToNoteName(item.baseMidi);
                const durStr   = item.duration ? item.duration.toFixed(1) + 's' : '?';
                const dateStr  = new Date(item.createdAt).toLocaleDateString('zh-CN');

                div.innerHTML = `
                    <div class="sl-item-info">
                        <span class="sl-item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
                        <span class="sl-item-meta">
                            📄 ${escapeHtml(item.fileName || '')} ·
                            ⏱ ${durStr} ·
                            🎹 参考 ${noteName}
                        </span>
                        <span class="sl-item-date">${dateStr}</span>
                    </div>
                    <div class="sl-item-actions">
                        <button class="sl-btn sl-btn-preview" data-id="${item.id}" title="试听">▶</button>
                        <button class="sl-btn sl-btn-apply" data-id="${item.id}" title="应用到选中轨道">🎹</button>
                        <button class="sl-btn sl-btn-delete" data-id="${item.id}" title="删除">🗑</button>
                    </div>`;

                listEl.appendChild(div);
            });

            // 绑定列表内按钮事件（事件委托）
            listEl.onclick = function (e) {
                const btn = e.target.closest('button[data-id]');
                if (!btn) return;
                const id = btn.dataset.id;
                if (btn.classList.contains('sl-btn-preview')) previewSample(id);
                if (btn.classList.contains('sl-btn-apply'))   applyToTrack(id);
                if (btn.classList.contains('sl-btn-delete'))   deleteSample(id);
            };

            updateStats(items.length, items.reduce(function (s, i) { return s + (i.duration || 0); }, 0));
        }).catch(function (err) {
            console.error('[SampleLibraryUI] 列表加载失败：', err);
            showEmpty('加载失败：' + (err && err.message || '未知错误'));
        });
    }

    function showEmpty(msg) {
        const emptyEl = document.getElementById('sl-empty');
        emptyEl.textContent = msg || '音效库为空';
        emptyEl.style.display = '';
        listEl.innerHTML = '';
    }

    function updateStats(count, totalDuration) {
        if (statsEl) {
            statsEl.textContent = count + ' 个音效 · 共 ' + totalDuration.toFixed(1) + ' 秒';
        }
    }

    /* ===== 预览 ===== */
    function previewSample(id) {
        stopPreview();

        const audioCtx = getAudioContext();
        if (!audioCtx) { showToast('无法获取音频上下文'); return; }

        window.SampleLibrary.load(id, audioCtx).then(function (result) {
            previewSource = audioCtx.createBufferSource();
            previewSource.buffer = result.audioBuffer;
            previewSource.connect(audioCtx.destination);
            previewSource.onended = function () { previewSource = null; };
            previewSource.start(0);
            showToast('▶ 正在试听：' + result.record.name);
        }).catch(function (err) {
            console.error('[SampleLibraryUI] 预览失败：', err);
            showToast('试听失败：' + (err && err.message || ''));
        });
    }

    function stopPreview() {
        if (previewSource) {
            try { previewSource.stop(); } catch (e) {}
            previewSource = null;
        }
    }

    /* ===== 删除 ===== */
    function deleteSample(id) {
        if (!confirm('确定要删除此音效吗？此操作不可撤销。')) return;

        window.SampleLibrary.remove(id).then(function () {
            showToast('已删除');
            renderList();
        }).catch(function (err) {
            console.error('[SampleLibraryUI] 删除失败：', err);
            showToast('删除失败：' + (err && err.message || ''));
        });
    }

    /* ===== 应用到选中轨道 ===== */
    function applyToTrack(id) {
        const track = window.Tracks && window.Tracks.getSelectedTrack();
        if (!track) {
            showToast('请先选中一条轨道');
            return;
        }

        const audioCtx = getAudioContext();
        if (!audioCtx) { showToast('无法获取音频上下文'); return; }

        window.SampleLibrary.load(id, audioCtx).then(function (result) {
            const record    = result.record;
            const buffer    = result.audioBuffer;
            const baseFreq  = record.baseFreq;
            const baseMidi  = record.baseMidi;
            const durationSec = buffer.duration;

            // 获取项目 BPM
            const bpm = (window.AudioExport && window.AudioExport.BPM) ? window.AudioExport.BPM : 120;
            const durationBeats = (durationSec / 60) * bpm;

            // 保存状态（用于撤销）
            if (window.App && window.App.saveState) window.App.saveState();

            // 设置为采样音色模式
            track.instrument.timbreMode = 'sample';
            track.instrument.sampleData = {
                fileName: record.fileName,
                baseFreq: baseFreq,
                baseNote: baseMidi,
                duration: durationSec,
                sampleRate: buffer.sampleRate,
                libraryId: record.id,   // 记录音效库 ID
            };

            // 写入 clip（多乐段体系）
            if (track.clips && track.clips.length > 0) {
                track.clips[0].notes = [{
                    pitch: baseMidi,
                    beat: 0,
                    duration: durationBeats,
                    velocity: 100
                }];
                track.clips[0].length = durationBeats;
            }
            track.notes = [{
                pitch: baseMidi,
                beat: 0,
                duration: durationBeats,
                velocity: 100
            }];

            // 调整轨道长度
            track.length = Math.max(4, Math.ceil(durationBeats / 4) * 4);

            // 存储 AudioBuffer 到 AudioEngine
            if (window.AudioEngine && window.AudioEngine.loadSampleBuffer) {
                window.AudioEngine.loadSampleBuffer(track.id, buffer, baseFreq, record.fileName);
            }

            // 重新渲染轨道 UI
            window.Tracks.renderTrackLane(track);
            window.Tracks.refreshMiniNotes(track.id);
            window.Tracks.updatePropertiesPanel(track);

            showToast('🎵 已应用音效：「' + record.name + '」→ ' + track.name);
        }).catch(function (err) {
            console.error('[SampleLibraryUI] 应用失败：', err);
            showToast('应用失败：' + (err && err.message || ''));
        });
    }

    /* ===== 工具函数 ===== */
    function getAudioContext() {
        if (window.AudioEngine && window.AudioEngine.getCtx) {
            return window.AudioEngine.getCtx();
        }
        // 降级：创建临时上下文
        return new (window.AudioContext || window.webkitAudioContext)();
    }

    function midiToNoteName(m) {
        const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
        const oct = Math.floor(m / 12) - 1;
        return names[m % 12] + oct;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function showToast(msg) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();
        const el = document.createElement('div');
        el.className = 'toast'; el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, 2500);
    }

    // 公开 API
    return { init, open, close, renderList };
})();
