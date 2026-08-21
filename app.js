/**
 * WaveParty App — Main Controller
 * 初始化所有模块，处理播放、录制、标尺等
 */

(function () {
    'use strict';

    // ===== State =====
    let isPlaying = false;
    let currentBeat = 0;
    let tempo = 120;
    let scheduleAhead = 0.1; // seconds
    let nextNoteTime = 0;
    let schedulerInterval = null;
    let playbackStartTime = 0;
    let playbackStartBeat = 0;
    let rulerAnimId = null;
    const BEAT_W = 80;

    // ===== Undo/Redo System =====
    const MAX_UNDO = 50;
    let undoStack = [];
    let redoStack = [];

    /** 深拷贝轨道数据（用于撤销系统） */
    function cloneTracks(tracks) {
        return tracks.map(t => JSON.parse(JSON.stringify(t)));
    }

    /** 保存当前状态到撤销栈 */
    function saveState() {
        const tracks = window.Tracks && window.Tracks.getAllTracks();
        if (!tracks) return;
        undoStack.push(cloneTracks(tracks));
        if (undoStack.length > MAX_UNDO) undoStack.shift();
        redoStack = []; // 新操作清空重做栈
    }

    /** 撤销 */
    function undo() {
        if (undoStack.length === 0) {
            showToast('没有可撤销的操作');
            return;
        }
        const tracks = window.Tracks.getAllTracks();
        redoStack.push(cloneTracks(tracks));
        const prevState = undoStack.pop();
        _restoreTracksState(prevState);
        showToast('已撤销');
    }

    /** 重做 */
    function redo() {
        if (redoStack.length === 0) {
            showToast('没有可重做的操作');
            return;
        }
        const tracks = window.Tracks.getAllTracks();
        undoStack.push(cloneTracks(tracks));
        const nextState = redoStack.pop();
        _restoreTracksState(nextState);
        showToast('已重做');
    }

    /** 设置全局 tempo（供项目加载用）*/
    function setTempo(bpm) {
        tempo = Math.max(20, Math.min(300, parseInt(bpm) || 120));
        const input = document.getElementById('tempo-input');
        if (input) input.value = tempo;
    }

    /** 恢复轨道状态 */
    function _restoreTracksState(state) {
        if (!state || !window.Tracks) return;
        // 这里需要通过 Tracks 模块暴露的接口来恢复状态
        // 由于 Tracks 使用闭包，我们需要直接修改它的内部数据
        // 最简单的方法是重新加载整个项目状态
        const tracks = window.Tracks.getAllTracks();
        if (!tracks) return;

        // 清空当前轨道
        while (tracks.length > 0) tracks.pop();
        // 恢复状态
        state.forEach(t => tracks.push(t));

        // 重新渲染 UI
        _rebuildTrackUI();
    }

    /** 重新构建轨道 UI（撤销/重做后调用） */
    function _rebuildTrackUI() {
        // 清空现有 UI
        const headerList = document.getElementById('track-header-list');
        const container = document.getElementById('tracks-container');
        if (headerList) headerList.innerHTML = '';
        if (container) container.innerHTML = '';

        // 重新渲染所有轨道
        const tracks = window.Tracks.getAllTracks();
        if (!tracks) return;

        // 由于 Tracks 模块使用闭包，我们需要调用它的 init 或 render 函数
        // 这里直接调用 Tracks 的内部方法来重新渲染
        if (window.Tracks.renderAllTracks) {
            window.Tracks.renderAllTracks();
        } else {
            // 降级方案：刷新页面（不推荐，但作为后备）
            location.reload();
        }

        // 刷新钢琴卷帘
        if (window.PianoRoll && window.PianoRoll.isOpen()) {
            const selected = window.Tracks.getSelectedTrack();
            if (selected) window.PianoRoll.openForTrack(selected);
        }
    }

    // ===== Init =====
    window.addEventListener('DOMContentLoaded', () => {
        // 各模块初始化（独立容错，防止单个失败阻断后续）
        const inits = [
            ['BezierEditor', () => BezierEditor.init()],
            ['PianoRoll',   () => PianoRoll.init()],
            ['Tracks',      () => Tracks.init()],
            ['Mixer',       () => Mixer.init()],
            ['ScaleKeyboard', () => ScaleKeyboard.init()],
            ['SpectrogramDesigner', () => SpectrogramDesigner.init()],
            ['SampleImporter',     () => { if (window.SampleImporter) SampleImporter.init(); }],
            ['SampleLibrary',     () => { if (window.SampleLibrary) SampleLibrary.init(); }],
            ['SampleLibraryUI',  () => { if (window.SampleLibraryUI) SampleLibraryUI.init(); }],
        ];
        inits.forEach(([name, fn]) => {
            try { fn(); } catch(e) { console.error('[Init] ' + name + ' 失败:', e); }
        });

        try { initTransport(); } catch(e) { console.error('[Init] Transport 失败:', e); }

        try { initRuler(); } catch(e) { console.error('[Init] Ruler 失败:', e); }
        try { initPlayhead(); } catch(e) { console.error('[Init] Playhead 失败:', e); }
        try { renderRuler(); } catch(e) { console.error('[Init] RenderRuler 失败:', e); }

        // 工具栏右侧按钮（独立绑定，互不影响）
        try {
            const btnSpec = document.getElementById('btn-spectrogram');
            if (btnSpec) btnSpec.addEventListener('click', () => {
                console.log('[Toolbar] 音色设计 clicked');
                if (window.SpectrogramDesigner && SpectrogramDesigner.open) SpectrogramDesigner.open();
                else alert('音色设计器未加载');
            });
        } catch(e) { console.error('[Init] spectrogram 按钮绑定失败:', e); }

        try {
            const btnWaveDesigner = document.getElementById('btn-wave-designer');
            if (btnWaveDesigner) btnWaveDesigner.addEventListener('click', () => {
                console.log('[Toolbar] 波形设计 clicked');
                if (window.WaveDesigner && WaveDesigner.openPanel) WaveDesigner.openPanel();
                else if (window.WaveDesigner && WaveDesigner.togglePanel) WaveDesigner.togglePanel();
                else alert('波形设计器未加载');
            });
        } catch(e) { console.error('[Init] wave-designer 按钮绑定失败:', e); }

        try {
            const btnImport = document.getElementById('btn-import-audio');
            if (btnImport) btnImport.addEventListener('click', () => {
                console.log('[Toolbar] 导入音频 clicked');
                if (window.SampleImporter && SampleImporter.open) SampleImporter.open();
                else alert('导入器未加载');
            });
        } catch(e) { console.error('[Init] import-audio 按钮绑定失败:', e); }

        try {
            const btnLib = document.getElementById('btn-sample-library');
            if (btnLib) btnLib.addEventListener('click', () => {
                console.log('[Toolbar] 音效库 clicked');
                if (window.SampleLibraryUI && SampleLibraryUI.open) SampleLibraryUI.open();
                else alert('音效库模块未加载');
            });
        } catch(e) { console.error('[Init] sample-library 按钮绑定失败:', e); }

        try {
            const btnExport = document.getElementById('btn-export-wav');
            if (btnExport) btnExport.addEventListener('click', () => {
                console.log('[Toolbar] 导出WAV clicked');
                if (window.AudioExport && window.AudioExport.exportToWAV)
                    window.AudioExport.exportToWAV(Tracks.getAllTracks(), tempo);
                else alert('导出模块未加载');
            });
        } catch(e) { console.error('[Init] export-wav 按钮绑定失败:', e); }

        console.log('[Init] 所有初始化完成');

        // ===== 直接绑定"添加轨道"按钮（最可靠方式）=====
        initAddTrackButton();
    });

    /** 直接绑定添加轨道按钮，绕过所有 IIFE / 事件委托问题 */
    function initAddTrackButton() {
        const btn = document.getElementById('btn-add-track');
        if (!btn) {
            console.error('[Init] 找不到 btn-add-track，将在 500ms 后重试');
            setTimeout(initAddTrackButton, 500);
            return;
        }
        // 移除旧事件（防止重复绑定）
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('[Init] 添加轨道按钮被点击');
            if (window.Tracks && window.Tracks.addDefaultTrack) {
                window.Tracks.addDefaultTrack();
            } else {
                console.error('[Init] Tracks.addDefaultTrack 不存在', window.Tracks);
                alert('轨道模块未加载，请刷新页面');
            }
        });
        console.log('[Init] 添加轨道按钮事件绑定成功');
    }

    // ===== Transport =====
    function initTransport() {
        document.getElementById('btn-play').addEventListener('click', togglePlay);
        document.getElementById('btn-stop').addEventListener('click', stopPlayback);
        document.getElementById('btn-rewind').addEventListener('click', rewind);
        document.getElementById('btn-back').addEventListener('click', () => { currentBeat = Math.max(0, currentBeat - 4); updatePlayhead(); });
        document.getElementById('btn-forward').addEventListener('click', () => { currentBeat += 4; updatePlayhead(); });
        document.getElementById('btn-record').addEventListener('click', toggleRecord);
        document.getElementById('tempo-input').addEventListener('change', e => {
            tempo = Math.max(20, Math.min(300, parseInt(e.target.value)));
        });
        document.getElementById('master-vol').addEventListener('input', e => {
            AudioEngine.setMasterVolume(parseInt(e.target.value));
        });
    }

    function togglePlay() {
        if (isPlaying) {
            pausePlayback();
        } else {
            startPlayback();
        }
    }

    function startPlayback() {
        AudioEngine.ensureContext();
        isPlaying = true;
        document.getElementById('btn-play').textContent = '⏸';
        document.getElementById('btn-play').classList.add('playing');

        playbackStartBeat = currentBeat;
        playbackStartTime = AudioEngine.getCurrentTime();
        nextNoteTime = playbackStartTime;

        scheduleNotes();
        schedulerInterval = setInterval(scheduleNotes, 50);
        startRulerAnim();
    }

    function pausePlayback() {
        isPlaying = false;
        clearInterval(schedulerInterval);
        document.getElementById('btn-play').textContent = '▶';
        document.getElementById('btn-play').classList.remove('playing');
        stopRulerAnim();
    }

    function stopPlayback() {
        pausePlayback();
        currentBeat = 0;
        updatePlayhead();
        PianoRoll.refresh();
    }

    function rewind() {
        const wasPlaying = isPlaying;
        if (isPlaying) pausePlayback();
        currentBeat = 0;
        updatePlayhead();
        if (wasPlaying) startPlayback();
    }

    function toggleRecord() {
        const btn = document.getElementById('btn-record');
        btn.classList.toggle('active');
    }

    // ===== Scheduler =====
    function scheduleNotes() {
        const now = AudioEngine.getCurrentTime();
        const lookahead = now + scheduleAhead;

        while (nextNoteTime < lookahead) {
            const beat = playbackStartBeat + (nextNoteTime - playbackStartTime) * (tempo / 60);
            currentBeat = beat;
            scheduleBeatsForAllTracks(beat, nextNoteTime);
            nextNoteTime += (60 / tempo) * (1 / 4); // 1/4 beat step
        }
    }

    function scheduleBeatsForAllTracks(beat, audioTime) {
        const tracks = Tracks.getAllTracks();
        tracks.forEach(track => {
            if (track.muted) return;
            const beatDur = 60 / tempo;

            // 聚合所有 clip 的音符（clip.notes 存储的是相对于 clip 起始的 beat）
            // 同时兼容旧的 track.notes（直接存全局 beat）
            const allNotes = [];

            if (track.clips && track.clips.length > 0) {
                track.clips.forEach(clip => {
                    const clipNotes = clip.notes || [];
                    clipNotes.forEach(note => {
                        // 将 clip 内相对 beat 换算为全局 beat
                        allNotes.push({
                            ...note,
                            beat: (clip.startBeat || 0) + note.beat,
                            _srcNote: note  // 保留引用以更新 _scheduled
                        });
                    });
                });
            } else if (track.notes) {
                // 兼容旧格式
                track.notes.forEach(note => allNotes.push({ ...note, _srcNote: note }));
            }

            allNotes.forEach(note => {
                const noteDelta = Math.abs(note.beat - beat);
                if (noteDelta < 1 / (4 * 4) && !note._srcNote._scheduled) {
                    const startAt = audioTime + (note.beat - beat) * beatDur;
                    const durSec = note.duration * beatDur;
                    if (startAt >= audioTime - 0.01) {
                        AudioEngine.scheduleNote(track.id, note.pitch, track.instrument, startAt, durSec);
                        note._srcNote._scheduled = true;
                        setTimeout(() => { note._srcNote._scheduled = false; }, (note.duration + 0.5) * beatDur * 1000);
                    }
                }
            });
        });
    }

    // ===== Ruler & Playhead =====
    function initRuler() {
        // 点击标尺跳转播放位置
        document.getElementById('ruler').addEventListener('pointerdown', onRulerClick);

        // 点击编排区域跳转播放位置
        document.getElementById('tracks-container').addEventListener('pointerdown', onTracksClick);
    }

    /** 根据点击 X 坐标计算节拍位置并跳转 */
    function seekToBeat(clientX, scrollEl) {
        const scrollLeft = scrollEl ? scrollEl.scrollLeft : 0;
        const rect = scrollEl ? scrollEl.getBoundingClientRect() : document.getElementById('ruler').getBoundingClientRect();
        const x = clientX - rect.left + scrollLeft;
        const beat = Math.max(0, x / BEAT_W);
        const wasPlaying = isPlaying;
        if (isPlaying) pausePlayback();
        currentBeat = beat;
        updatePlayhead();
        PianoRoll.refresh();
        if (wasPlaying) startPlayback();
    }

    function onRulerClick(e) {
        // 如果点在按钮等交互元素上则忽略
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        e.preventDefault();
        seekToBeat(e.clientX, document.getElementById('ruler'));
    }

    function onTracksClick(e) {
        // 如果点击的是轨道头部（左边按钮区）或交互元素，忽略
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        if (e.target.closest('.track-lane')) return; // 双击轨道进入钢琴卷帘，不干扰
        e.preventDefault();
        seekToBeat(e.clientX, document.getElementById('tracks-container'));
    }

    function renderRuler() {
        const ruler = document.getElementById('ruler');
        ruler.innerHTML = '';

        // 动态长度：取所有轨道中最长的
        let maxBeats = 32; // 默认最小值
        if (window.Tracks && window.Tracks.getAllTracks) {
            const tracks = window.Tracks.getAllTracks();
            tracks.forEach(t => { maxBeats = Math.max(maxBeats, t.length || 8); });
        }
        // 确保至少 32 拍可见
        maxBeats = Math.max(maxBeats, 32);

        const totalBeats = maxBeats;
        const marksEl = document.createElement('canvas');
        marksEl.width = totalBeats * BEAT_W + 200;
        marksEl.height = 32;
        marksEl.style.width = marksEl.width + 'px';
        marksEl.style.cursor = 'pointer';
        const ctx = marksEl.getContext('2d');
        ctx.fillStyle = '#22262f';
        ctx.fillRect(0, 0, marksEl.width, 32);

        for (let b = 0; b <= totalBeats; b++) {
            const x = b * BEAT_W;
            const isBar = b % 4 === 0;
            ctx.fillStyle = isBar ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)';
            ctx.fillRect(x, isBar ? 8 : 18, 1, isBar ? 24 : 10);
            if (isBar) {
                ctx.fillStyle = 'rgba(255,255,255,0.6)';
                ctx.font = '11px monospace';
                ctx.fillText((b / 4 + 1) + '', x + 4, 20);
            }
        }
        ruler.appendChild(marksEl);
    }

    function initPlayhead() {
        ensurePlayhead();
    }

    /** 确保 playhead 存在（被 innerHTML 清空后可调用恢复） */
    function ensurePlayhead() {
        if (document.getElementById('arrangement-playhead')) return; // 已存在则跳过
        const playhead = document.createElement('div');
        playhead.id = 'arrangement-playhead';
        playhead.className = 'playhead';
        playhead.style.cssText = 'position:absolute;top:0;bottom:0;width:2px;background:#ff4081;z-index:9999;pointer-events:none;left:0;';
        document.getElementById('tracks-container').appendChild(playhead);
    }

    function updatePlayhead() {
        const ph = document.getElementById('arrangement-playhead');
        if (ph) ph.style.left = (currentBeat * BEAT_W) + 'px';
    }

    function startRulerAnim() {
        function loop() {
            const now = AudioEngine.getCurrentTime();
            currentBeat = playbackStartBeat + (now - playbackStartTime) * (tempo / 60);
            updatePlayhead();
            PianoRoll.refresh();
            rulerAnimId = requestAnimationFrame(loop);
        }
        loop();
    }

    function stopRulerAnim() {
        if (rulerAnimId) { cancelAnimationFrame(rulerAnimId); rulerAnimId = null; }
    }

    // ===== Keyboard shortcuts =====
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
        if (e.code === 'Home') { e.preventDefault(); rewind(); }

        // Delete/Backspace：删除选中 clip
        if (e.key === 'Delete' || e.key === 'Backspace') {
            const clip = window.Tracks && window.Tracks.getSelectedClip();
            if (clip) {
                e.preventDefault();
                const track = window.Tracks.getSelectedTrack();
                if (track && window.Tracks._deleteClip) {
                    window.Tracks._deleteClip(track, clip);
                }
            }
        }

        // E 键：打开钢琴卷帘（选中 clip 时）
        if (e.key === 'e' || e.key === 'E') {
            const clip = window.Tracks && window.Tracks.getSelectedClip();
            const track = window.Tracks && window.Tracks.getSelectedTrack();
            if (clip && track && window.PianoRoll && window.PianoRoll.openForTrack) {
                e.preventDefault();
                window.PianoRoll.openForTrack(track, clip);
            }
        }

        // Undo: Ctrl+Z
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            if (window.App && window.App.undo) window.App.undo();
            return;
        }
        // Redo: Ctrl+Shift+Z 或 Ctrl+Y
        if ((e.ctrlKey || e.metaKey) && (e.key === 'z' && e.shiftKey) ||
            (e.ctrlKey || e.metaKey) && e.key === 'y') {
            e.preventDefault();
            if (window.App && window.App.redo) window.App.redo();
            return;
        }
    });

    // ===== Expose to other modules =====
    window.App = {
        getPlaybackBeat: () => currentBeat,
        getTempo: () => tempo,
        setTempo,
        renderRuler,
        saveState,
        undo,
        redo,
        getUndoStackSize: () => undoStack.length,
        getRedoStackSize: () => redoStack.length,
        ensurePlayhead
    };

})();
