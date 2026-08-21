/**
 * WaveParty — Sample Importer
 * 导入音频文件（WAV/MP3/OGG/FLAC/AIFF）作为轨道音色。
 * 解码为 AudioBuffer，通过 playbackRate 变调播放。
 * 新增：可保存到个人音效库（IndexedDB）
 */
window.SampleImporter = (function () {
    'use strict';

    let modalEl      = null;
    let canvasEl     = null;
    let fileInputEl  = null;
    let dropZoneEl   = null;
    let infoEl       = null;
    let waveWrapEl   = null;
    let baseNoteSel  = null;
    let fileNameEl   = null;
    let durationEl   = null;
    let previewBtn   = null;
    let stopPreviewBtn = null;
    let saveLibBtn   = null;   // 新增：保存到音效库按钮

    let currentBuffer   = null;   // Decoded AudioBuffer
    let currentFileName = '';
    let isPreviewing   = false;
    let previewSource  = null;

    // ── Scrubber / 切片状态 ──
    let zoomCanvasEl     = null; // 放大波形 canvas
    let scrubberEl       = null; // range slider
    let scrubTimeEl      = null; // 时间显示
    let sliceStart       = 0;    // 切片起始（秒）
    let sliceEnd         = 0;    // 切片结束（秒，0=未设置=全长）
    let slicePreviewSrc  = null; // 切片试听 source

    // 参考音高下拉选项（MIDI note → 显示名）
    const NOTE_OPTIONS = [];
    for (let midi = 24; midi <= 96; midi++) {
        const name = noteName(midi);
        const freq  = midiToFreq(midi);
        NOTE_OPTIONS.push({ midi, name, freq: freq.toFixed(1) });
    }

    function noteName(m) {
        const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
        const oct = Math.floor(m / 12) - 1;
        return names[m % 12] + oct;
    }

    function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

    // ── 初始化：创建模态框 DOM ───────────────────────────────────
    function init() {
        if (modalEl) return;

        // 遮罩
        modalEl = document.createElement('div');
        modalEl.id = 'sample-importer-modal';
        modalEl.className = 'modal-overlay';
        modalEl.style.display = 'none';

        modalEl.innerHTML = `
        <div class="si-modal-box">
            <div class="si-header">
                <span class="si-title">🎵 导入音频音色</span>
                <button class="si-close-btn" id="si-close-btn">×</button>
            </div>

            <!-- 文件拖放区 -->
            <div class="si-drop-zone" id="si-drop-zone">
                <div class="si-drop-icon">📁</div>
                <div class="si-drop-text">点击选择或拖放音频文件到此处</div>
                <div class="si-drop-hint">支持 WAV / MP3 / OGG / FLAC / AIFF（建议 &lt; 10 秒）</div>
                <input type="file" id="si-file-input" accept=".wav,.mp3,.ogg,.flac,.aiff,.aif,.m4a,.mp4,.webm,.wma" style="display:none">
            </div>

            <!-- 文件信息 -->
            <div class="si-file-info" id="si-file-info" style="display:none;">
                <span id="si-filename" class="si-filename"></span>
                <span id="si-duration" class="si-duration"></span>
                <span id="si-samplerate" class="si-samplerate"></span>
                <span id="si-channels" class="si-channels"></span>
            </div>

            <!-- 波形预览 -->
            <div class="si-wave-wrap" id="si-wave-wrap" style="display:none;">
                <canvas id="si-wave-canvas" class="si-wave-canvas"></canvas>
                <!-- 波形拖动预览区 -->
                <div class="si-scrubber-section" id="si-scrubber-section">
                    <div class="si-scrub-header">
                        <span class="si-scrub-label">🔍 波形定位</span>
                        <span id="si-scrub-time" class="si-scrub-time">0.00s / 0.00s</span>
                    </div>
                    <input type="range" id="si-scrubber" class="si-scrubber-slider" min="0" max="10000" value="0">
                    <!-- 放大波形显示 -->
                    <canvas id="si-zoom-wave-canvas" class="si-zoom-wave-canvas"></canvas>
                    <!-- 切片控制 -->
                    <div class="si-slice-ctrl">
                        <button class="si-btn si-btn-slice" id="si-slice-set-start">◀ 切片起点</button>
                        <button class="si-btn si-btn-slice" id="si-slice-set-end">切片终点 ▶</button>
                        <button class="si-btn si-btn-preview" id="si-slice-preview-btn">▶ 试听切片</button>
                        <span id="si-slice-range" class="si-slice-range">全选</span>
                    </div>
                </div>
            </div>

            <!-- 参考音高选择 -->
            <div class="si-base-section" id="si-base-section" style="display:none;">
                <label class="si-base-label">参考音高（导入音频的原始音高）：</label>
                <select id="si-base-note" class="si-base-select">
                    ${NOTE_OPTIONS.filter((_,i) => i % 12 === 0 || NOTE_OPTIONS[i].midi === 60).map(o =>
                        `<option value="${o.midi}" ${o.midi===60?'selected':''}>${o.name} (${o.freq} Hz)</option>`
                    ).join('')}
                </select>
                <span class="si-base-hint">播放音符 C4 时，将以此音高回放原速</span>
            </div>

            <!-- 操作按钮 -->
            <div class="si-actions">
                <button class="si-btn si-btn-preview" id="si-preview-btn" disabled>▶ 试听</button>
                <button class="si-btn si-btn-stop"    id="si-stop-btn" disabled>■ 停止</button>
                <span class="si-spacer"></span>
                <button class="si-btn si-btn-save-lib" id="si-save-lib-btn" disabled>💾 保存到音效库</button>
                <button class="si-btn si-btn-cancel"  id="si-cancel-btn">取消</button>
                <button class="si-btn si-btn-apply-track" id="si-apply-btn" disabled>🎹 导入到当前轨道</button>
                <button class="si-btn si-btn-new-track" id="si-new-track-btn" disabled>🎸 创建为新轨道</button>
            </div>
        </div>`;

        document.body.appendChild(modalEl);

        // 缓存 DOM
        canvasEl    = document.getElementById('si-wave-canvas');
        fileInputEl = document.getElementById('si-file-input');
        dropZoneEl  = document.getElementById('si-drop-zone');
        infoEl      = document.getElementById('si-file-info');
        waveWrapEl  = document.getElementById('si-wave-wrap');
        baseNoteSel = document.getElementById('si-base-note');
        fileNameEl  = document.getElementById('si-filename');
        durationEl  = document.getElementById('si-duration');
        previewBtn  = document.getElementById('si-preview-btn');
        stopPreviewBtn = document.getElementById('si-stop-btn');
        saveLibBtn  = document.getElementById('si-save-lib-btn');

        // Scrubber 元素
        zoomCanvasEl   = document.getElementById('si-zoom-wave-canvas');
        scrubberEl     = document.getElementById('si-scrubber');
        scrubTimeEl    = document.getElementById('si-scrub-time');

        bindEvents();
    }

    function bindEvents() {
        // 关闭
        document.getElementById('si-close-btn').addEventListener('click', close);
        document.getElementById('si-cancel-btn').addEventListener('click', close);
        modalEl.addEventListener('click', e => { if (e.target === modalEl) close(); });

        // 拖放区点击 → 触发文件选择
        dropZoneEl.addEventListener('click', () => fileInputEl.click());

        // 文件选择变化
        fileInputEl.addEventListener('change', e => {
            if (e.target.files.length > 0) handleFile(e.target.files[0]);
        });

        // 拖放
        dropZoneEl.addEventListener('dragover', e => { e.preventDefault(); dropZoneEl.classList.add('si-drop-hover'); });
        dropZoneEl.addEventListener('dragleave', () => dropZoneEl.classList.remove('si-drop-hover'));
        dropZoneEl.addEventListener('drop', e => {
            e.preventDefault();
            dropZoneEl.classList.remove('si-drop-hover');
            if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
        });

        // 试听
        previewBtn.addEventListener('click', previewSample);
        stopPreviewBtn.addEventListener('click', stopPreview);

        // 创建为新轨道 / 导入到当前轨道
        document.getElementById('si-new-track-btn').addEventListener('click', createAudioTrack);
        document.getElementById('si-apply-btn').addEventListener('click', importToCurrentTrack);

        // 新增：保存到音效库
        saveLibBtn.addEventListener('click', saveToLibrary);

        // 参考音高变化 → 更新提示
        baseNoteSel.addEventListener('change', () => {
            /* 不需要额外操作，apply 时读取最新值 */
        });

        // Scrubber 拖动
        if (scrubberEl) {
            scrubberEl.addEventListener('input', _onScrubberMove);
        }
        // 切片控制
        document.getElementById('si-slice-set-start')?.addEventListener('click', _setSliceStart);
        document.getElementById('si-slice-set-end')?.addEventListener('click', _setSliceEnd);
        document.getElementById('si-slice-preview-btn')?.addEventListener('click', _previewSlice);
    }

    // ── 打开模态框 ─────────────────────────────────────────────
    function open() {
        if (!modalEl) init();
        modalEl.style.display = 'flex';
        resetState();
    }

    function close() {
        stopPreview();
        if (modalEl) modalEl.style.display = 'none';
    }

    function resetState() {
        currentBuffer   = null;
        currentFileName = '';
        isPreviewing   = false;
        if (previewSource) { try { previewSource.stop(); } catch(e){} previewSource = null; }
        if (slicePreviewSrc) { try { slicePreviewSrc.stop(); } catch(e){} slicePreviewSrc = null; }

        // 重置切片
        sliceStart = 0; sliceEnd = 0;

        dropZoneEl.style.display = '';
        infoEl.style.display      = 'none';
        waveWrapEl.style.display  = 'none';
        document.getElementById('si-base-section').style.display = 'none';
        var scrubSec = document.getElementById('si-scrubber-section');
        if (scrubSec) scrubSec.style.display = 'none';

        previewBtn.disabled = true;
        stopPreviewBtn.disabled = true;
        if (saveLibBtn) saveLibBtn.disabled = true;
        document.getElementById('si-new-track-btn').disabled = true;
        document.getElementById('si-apply-btn').disabled = true;

        // 重置文件输入（允许重复选择同一文件）
        fileInputEl.value = '';

        _updateSliceLabel();
    }

    // ── 处理文件 ───────────────────────────────────────────────
    function handleFile(file) {
        const maxSize = 50 * 1024 * 1024; // 50 MB
        if (file.size > maxSize) {
            showToast('文件过大（最大 50 MB）');
            return;
        }

        currentFileName = file.name;
        dropZoneEl.querySelector('.si-drop-text').textContent = '解码中…';

        const reader = new FileReader();
        reader.onload = function (e) {
            const arrayBuffer = e.target.result;
            // 使用临时 AudioContext 解码（不用主上下文避免状态问题）
            const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
            decodeCtx.decodeAudioData(arrayBuffer, function (buffer) {
                currentBuffer = buffer;
                decodeCtx.close();
                onFileDecoded(buffer, file.name);
            }, function (err) {
                decodeCtx.close();
                dropZoneEl.querySelector('.si-drop-text').textContent = '解码失败，请换一个文件';
                showToast('无法解码此音频文件：' + (err && err.message || '未知错误'));
            });
        };
        reader.onerror = function () {
            dropZoneEl.querySelector('.si-drop-text').textContent = '读取文件失败';
            showToast('读取文件失败');
        };
        reader.readAsArrayBuffer(file);
    }

    function onFileDecoded(buffer, fileName) {
        // 更新 UI
        dropZoneEl.querySelector('.si-drop-text').textContent = '文件已加载 ✓  点击此处更换文件';
        infoEl.style.display      = '';
        waveWrapEl.style.display  = '';
        document.getElementById('si-base-section').style.display = '';

        fileNameEl.textContent = '📄 ' + fileName;
        durationEl.textContent = '⏱ ' + buffer.duration.toFixed(2) + ' s';
        document.getElementById('si-samplerate').textContent = '🔊 ' + buffer.sampleRate + ' Hz';
        document.getElementById('si-channels').textContent   = '🎧 ' + buffer.numberOfChannels + ' ch';

        // 若超过 30 秒给警告
        if (buffer.duration > 30) {
            showToast('音频较长（' + buffer.duration.toFixed(1) + ' 秒），建议裁剪到 10 秒内以获得最佳性能');
        }

        // 绘制波形
        drawWaveform(buffer);

        // 初始化 Scrubber
        var scrubSec = document.getElementById('si-scrubber-section');
        if (scrubSec) scrubSec.style.display = '';
        if (scrubberEl) {
            scrubberEl.max = 10000;
            scrubberEl.value = 0;
        }
        sliceStart = 0; sliceEnd = 0;
        _updateSliceLabel();
        _onScrubberMove(); // 初始绘制放大波形

        // 启用按钮
        previewBtn.disabled = false;
        stopPreviewBtn.disabled = false;
        if (saveLibBtn) saveLibBtn.disabled = false;
        document.getElementById('si-new-track-btn').disabled = false;
        document.getElementById('si-apply-btn').disabled = false;
    }

    // ── 保存到音效库 ─────────────────────────────────────────
    function saveToLibrary() {
        if (!currentBuffer) return;

        // 弹出命名对话框
        const defaultName = currentFileName.replace(/\.[^.]+$/, '');
        const name = prompt('为此音效命名：', defaultName);
        if (name === null) return;   // 用户取消
        if (!name.trim()) {
            showToast('名称不能为空');
            return;
        }

        // 确保 SampleLibrary 已初始化
        if (!window.SampleLibrary) {
            showToast('音效库模块未加载');
            return;
        }

        showToast('正在保存到音效库…');

        window.SampleLibrary.init().then(function () {
            const baseMidi = parseInt(baseNoteSel.value);
            const baseFreq = midiToFreq(baseMidi);

            return window.SampleLibrary.save({
                name      : name.trim(),
                fileName  : currentFileName,
                baseMidi  : baseMidi,
                baseFreq  : baseFreq,
                duration  : currentBuffer.duration,
                sampleRate: currentBuffer.sampleRate,
                buffer    : currentBuffer,
            });
        }).then(function (id) {
            showToast('✅ 已保存到音效库：' + name.trim());
        }).catch(function (err) {
            console.error('[SampleImporter] 保存到音效库失败：', err);
            showToast('保存失败：' + (err && err.message || '未知错误'));
        });
    }

    // ── 绘制波形 ───────────────────────────────────────────────
    function drawWaveform(buffer) {
        const canvas = canvasEl;
        const W = 580, H = 140;
        canvas.width  = W * 2;   // retina
        canvas.height = H * 2;
        canvas.style.width  = W + 'px';
        canvas.style.height = H + 'px';
        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2);

        // 背景
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, W, H);

        // 中线
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
        ctx.stroke();

        // 时间轴
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '9px monospace';
        const dur = buffer.duration;
        const numMarkers = Math.min(10, Math.floor(dur));
        for (let i = 0; i <= numMarkers; i++) {
            const x = (i / numMarkers) * W;
            const t = (i / numMarkers * dur).toFixed(1);
            ctx.fillText(t + 's', x + 2, H - 3);
            if (i > 0) {
                ctx.strokeStyle = 'rgba(255,255,255,0.04)';
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
            }
        }

        // 合并声道绘制波形
        const ch0 = buffer.getChannelData(0);
        const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
        const step = Math.max(1, Math.floor(ch0.length / W));
        const midLine = H / 2;
        const ampScale = (H / 2) * 0.9;

        ctx.beginPath();
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 1.2;

        for (let px = 0; px < W; px++) {
            const i0 = Math.floor((px / W) * ch0.length);
            const i1 = Math.min(ch0.length - 1, i0 + step);
            let min = 0, max = 0;
            for (let i = i0; i <= i1; i++) {
                const s = ch1 ? (ch0[i] + ch1[i]) / 2 : ch0[i];
                if (s < min) min = s;
                if (s > max) max = s;
            }
            const x = px;
            const y1 = midLine - max * ampScale;
            const y2 = midLine - min * ampScale;
            if (px === 0) ctx.moveTo(x, y1); else ctx.lineTo(x, y1);
            // 填充
        }
        ctx.stroke();

        // 填充（二次绘制填充区域）
        ctx.beginPath();
        for (let px = 0; px < W; px++) {
            const i0 = Math.floor((px / W) * ch0.length);
            const i1 = Math.min(ch0.length - 1, i0 + step);
            let min = 0, max = 0;
            for (let i = i0; i <= i1; i++) {
                const s = ch1 ? (ch0[i] + ch1[i]) / 2 : ch0[i];
                if (s < min) min = s;
                if (s > max) max = s;
            }
            const x = px;
            const yMax = midLine - max * ampScale;
            const yMin = midLine - min * ampScale;
            if (px === 0) { ctx.moveTo(x, yMax); }
            else ctx.lineTo(x, yMax);
        }
        for (let px = W - 1; px >= 0; px--) {
            const i0 = Math.floor((px / W) * ch0.length);
            const i1 = Math.min(ch0.length - 1, i0 + step);
            let min = 0, max = 0;
            for (let i = i0; i <= i1; i++) {
                const s = ch1 ? (ch0[i] + ch1[i]) / 2 : ch0[i];
                if (s < min) min = s;
                if (s > max) max = s;
            }
            const x = px;
            const yMin = midLine - min * ampScale;
            ctx.lineTo(x, yMin);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,229,255,0.08)';
        ctx.fill();
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 1.2;
        // 重绘上轮廓
        ctx.beginPath();
        for (let px = 0; px < W; px++) {
            const i0 = Math.floor((px / W) * ch0.length);
            const i1 = Math.min(ch0.length - 1, i0 + step);
            let max = 0;
            for (let i = i0; i <= i1; i++) {
                const s = ch1 ? (ch0[i] + ch1[i]) / 2 : ch0[i];
                if (s > max) max = s;
            }
            const yMax = midLine - max * ampScale;
            if (px === 0) ctx.moveTo(px, yMax); else ctx.lineTo(px, yMax);
        }
        ctx.stroke();
    }

    // ── 试听 ───────────────────────────────────────────────────
    function previewSample() {
        if (!currentBuffer || isPreviewing) return;
        const track = window.Tracks && window.Tracks.getSelectedTrack();
        if (!track) {
            showToast('请先选中一条轨道以试听');
            return;
        }

        const baseMidi  = parseInt(baseNoteSel.value);
        const baseFreq = midiToFreq(baseMidi);

        // 用轨道的 gain/pan 链播放参考音高（原速）
        const audioEngine = window.AudioEngine;
        if (audioEngine && audioEngine.ensureContext) audioEngine.ensureContext();
        const ctx = window.AudioEngine.getCtx && window.AudioEngine.getCtx() || new (window.AudioContext || window.webkitAudioContext)();

        previewSource = ctx.createBufferSource();
        previewSource.buffer = currentBuffer;
        // 以用户设定的参考音高试听（原速）
        const previewFreq = baseFreq;
        previewSource.playbackRate.value = previewFreq / baseFreq;

        const gain = ctx.createGain();
        gain.gain.value = 0.5;
        previewSource.connect(gain);
        gain.connect(ctx.destination);

        previewSource.onended = () => { isPreviewing = false; previewBtn.disabled = false; };
        previewSource.start(0);
        isPreviewing = true;
        previewBtn.disabled = true;
    }

    function stopPreview() {
        if (previewSource) {
            try { previewSource.stop(); } catch(e){}
            previewSource = null;
        }
        isPreviewing = false;
        previewBtn.disabled = false;
    }

    // ── 导入到当前选中轨道（替换当前音色）─────────────────────────────
    function importToCurrentTrack() {
        if (!currentBuffer) return;

        const track = window.Tracks && window.Tracks.getSelectedTrack();
        if (!track) {
            showToast('请先选中一条轨道');
            return;
        }

        // 保存状态（用于撤销）
        if (window.App && window.App.saveState) window.App.saveState();

        // 获取切片范围
        var range = _getSliceRange();
        var slicedBuf = _sliceBuffer(currentBuffer, range.start, range.end);

        const baseMidi  = parseInt(baseNoteSel.value);
        const baseFreq = midiToFreq(baseMidi);
        const durationSec = slicedBuf.duration;

        // 获取项目 BPM
        const bpm = (window.AudioExport && window.AudioExport.BPM) ? window.AudioExport.BPM : 120;
        const durationBeats = (durationSec / 60) * bpm;

        // 设置为采样音色模式
        track.instrument.timbreMode = 'sample';
        track.instrument.sampleData = {
            fileName: currentFileName,
            baseFreq: baseFreq,
            baseNote: baseMidi,
            duration: durationSec,
            sampleRate: slicedBuf.sampleRate
        };

        // 替换默认音符 —— 写入 clip（多乐段体系）
        if (track.clips && track.clips.length > 0) {
            track.clips[0].notes = [{
                pitch: baseMidi,
                beat: 0,
                duration: durationBeats,
                velocity: 100
            }];
            // 同步 clip 长度
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

        // 存储 AudioBuffer 到 AudioEngine（使用切片后的 buffer）
        if (window.AudioEngine && window.AudioEngine.loadSampleBuffer) {
            window.AudioEngine.loadSampleBuffer(track.id, slicedBuf, baseFreq, currentFileName);
        }

        // 重新渲染轨道 UI
        window.Tracks.renderTrackLane(track);
        window.Tracks.refreshMiniNotes(track.id);
        window.Tracks.updatePropertiesPanel(track);

        // 关闭模态框并提示
        close();
        showToast('🎵 已导入采样到轨道：' + track.name + '（' + durationSec.toFixed(1) + ' 秒）');
    }

    // ── 创建为新音频轨道（不需要预选轨道）─────────────────────────────
    function createAudioTrack() {
        if (!currentBuffer) return;

        // 保存状态（用于撤销）
        if (window.App && window.App.saveState) window.App.saveState();

        // 获取切片范围
        var range = _getSliceRange();
        var slicedBuf = _sliceBuffer(currentBuffer, range.start, range.end);

        const baseMidi  = parseInt(baseNoteSel.value);
        const baseFreq = midiToFreq(baseMidi);
        const durationSec = slicedBuf.duration;

        // 获取项目 BPM（优先从全局变量读取）
        const bpm = (window.AudioExport && window.AudioExport.BPM) ? window.AudioExport.BPM : 120;
        const durationBeats = (durationSec / 60) * bpm;

        // 轨道名称（去掉扩展名）
        const trackName = currentFileName.replace(/\.[^.]+$/, '');

        // 1. 创建新轨道（使用基础 instrument，后续会覆盖为 sample 模式）
        const newTrack = window.Tracks.addTrack(trackName, {
            waveform: 'sawtooth'
        });
        if (!newTrack) { showToast('创建轨道失败'); return; }

        // 2. 设置为采样音色模式
        newTrack.instrument.timbreMode = 'sample';
        newTrack.instrument.sampleData = {
            fileName: currentFileName,
            baseFreq: baseFreq,
            baseNote: baseMidi,
            duration: durationSec,
            sampleRate: slicedBuf.sampleRate
        };

        // 3. 替换默认音符 —— 写入 clip（多乐段体系）
        if (newTrack.clips && newTrack.clips.length > 0) {
            newTrack.clips[0].notes = [{
                pitch: baseMidi,
                beat: 0,
                duration: durationBeats,
                velocity: 100
            }];
            newTrack.clips[0].length = durationBeats;
        }
        newTrack.notes = [{
            pitch: baseMidi,
            beat: 0,
            duration: durationBeats,
            velocity: 100
        }];

        // 4. 调整轨道长度（向上取整到小节）
        newTrack.length = Math.max(4, Math.ceil(durationBeats / 4) * 4);

        // 5. 存储 AudioBuffer 到 AudioEngine（使用切片后的 buffer）
        if (window.AudioEngine && window.AudioEngine.loadSampleBuffer) {
            window.AudioEngine.loadSampleBuffer(newTrack.id, slicedBuf, baseFreq, currentFileName);
        }

        // 6. 重新渲染轨道 UI（notes 已变更）
        window.Tracks.renderTrackLane(newTrack);
        window.Tracks.refreshMiniNotes(newTrack.id);

        // 7. 选中新轨道
        window.Tracks.selectTrack(newTrack.id);

        // 8. 关闭模态框并提示
        close();
        showToast('🎸 音频轨道已创建：' + trackName + '（' + durationSec.toFixed(1) + ' 秒）');
    }

    function showToast(msg) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();
        const el = document.createElement('div');
        el.className = 'toast'; el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2500);
    }

    /**
     * 打开音效库面板（供外部调用）
     */
    function openLibraryPanel() {
        if (window.SampleLibraryUI && window.SampleLibraryUI.open) {
            window.SampleLibraryUI.open();
        } else {
            showToast('音效库面板未加载');
        }
    }

    return { init, open, close, openLibraryPanel };

    /* ================================================================
     *  Scrubber / 波形拖动预览 / 切片
     * ================================================================ */

    /** scrubber 滑动时：更新放大波形显示和时间标签 */
    function _onScrubberMove() {
        if (!currentBuffer || !scrubberEl) return;
        const dur = currentBuffer.duration;
        const ratio = scrubberEl.value / 10000; // 0..1
        const t = ratio * dur;

        // 更新时间显示
        if (scrubTimeEl) {
            scrubTimeEl.textContent = t.toFixed(2) + 's / ' + dur.toFixed(2) + 's';
        }

        // 绘制放大波形（以当前位置为中心，显示 ±0.15s 窗口）
        if (zoomCanvasEl) {
            _drawZoomedWaveform(t);
        }
    }

    /**
     * 绘制以 t 为中心的放大波形窗口
     * @param {number} centerT - 中心时间位置（秒）
     */
    function _drawZoomedWaveform(centerT) {
        const canvas = zoomCanvasEl;
        if (!canvas || !currentBuffer) return;

        const W = canvas.clientWidth || 628, H = 70;
        canvas.width = W * 2; canvas.height = H * 2;
        canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2);

        const buf = currentBuffer;
        const sr = buf.sampleRate;
        const dur = buf.duration;
        const windowSec = Math.min(0.3, dur);  // 显示窗口大小

        let winStart = centerT - windowSec / 2;
        let winEnd   = centerT + windowSec / 2;
        if (winStart < 0) { winStart = 0; winEnd = windowSec; }
        if (winEnd > dur) { winEnd = dur; winStart = dur - windowSec; }

        const iStart = Math.floor(winStart * sr);
        const iEnd   = Math.min(buf.length - 1, Math.floor(winEnd * sr));
        const ch0 = buf.getChannelData(0);
        const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;

        // 背景
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, W, H);

        // 中线
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
        ctx.stroke();

        // 切片区域高亮
        if (sliceEnd > sliceStart && sliceStart < dur) {
            const x0 = ((sliceStart - winStart) / (winEnd - winStart)) * W;
            const x1 = ((Math.min(sliceEnd, dur) - winStart) / (winEnd - winStart)) * W;
            if (x1 > 0 && x0 < W) {
                ctx.fillStyle = 'rgba(156,39,176,0.12)';
                ctx.fillRect(Math.max(0, x0), 0, Math.min(W, x1) - Math.max(0, x0), H);
            }
        }

        // 当前位置指示线
        const cx = ((centerT - winStart) / (winEnd - winStart)) * W;
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();

        // 绘制波形
        const step = Math.max(1, Math.floor((iEnd - iStart) / W));
        const midLine = H / 2;
        const ampScale = (H / 2) * 0.85;

        ctx.beginPath();
        for (let px = 0; px < W; px++) {
            const i0 = iStart + Math.floor((px / W) * (iEnd - iStart));
            const i1 = Math.min(iEnd, i0 + step);
            let min = 0, max = 0;
            for (let i = i0; i <= i1; i++) {
                const s = ch1 ? (ch0[i] + ch1[i]) / 2 : ch0[i];
                if (s < min) min = s;
                if (s > max) max = s;
            }
            const yMax = midLine - max * ampScale;
            if (px === 0) ctx.moveTo(px, yMax); else ctx.lineTo(px, yMax);
        }
        ctx.stroke();

        // 填充
        ctx.beginPath();
        for (let px = 0; px < W; px++) {
            const i0 = iStart + Math.floor((px / W) * (iEnd - iStart));
            const i1 = Math.min(iEnd, i0 + step);
            let min = 0, max = 0;
            for (let i = i0; i <= i1; i++) {
                const s = ch1 ? (ch0[i] + ch1[i]) / 2 : ch0[i];
                if (s < min) min = s;
                if (s > max) max = s;
            }
            if (px === 0) { ctx.moveTo(px, midLine - max * ampScale); }
            else ctx.lineTo(px, midLine - max * ampScale);
        }
        for (let px = W - 1; px >= 0; px--) {
            const i0 = iStart + Math.floor((px / W) * (iEnd - iStart));
            const i1 = Math.min(iEnd, i0 + step);
            let min = 0;
            for (let i = i0; i <= i1; i++) {
                const s = ch1 ? (ch0[i] + ch1[i]) / 2 : ch0[i];
                if (s < min) min = s;
            }
            ctx.lineTo(px, midLine - min * ampScale);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,229,255,0.08)';
        ctx.fill();
    }

    /** 设置切片起点 */
    function _setSliceStart() {
        if (!currentBuffer || !scrubberEl) return;
        const dur = currentBuffer.duration;
        sliceStart = (scrubberEl.value / 10000) * dur;
        if (sliceEnd > 0 && sliceEnd <= sliceStart) sliceEnd = 0;  // 重置终点
        _updateSliceLabel();
        if (zoomCanvasEl) _drawZoomedWaveform(sliceStart);
    }

    /** 设置切片终点 */
    function _setSliceEnd() {
        if (!currentBuffer || !scrubberEl) return;
        const dur = currentBuffer.duration;
        const newEnd = (scrubberEl.value / 10000) * dur;
        if (newEnd < sliceStart) { showToast('终点需在起点之后'); return; }
        sliceEnd = newEnd;
        _updateSliceLabel();
        if (zoomCanvasEl) _drawZoomedWaveform(sliceEnd);
    }

    /** 更新切片范围文字显示 */
    function _updateSliceLabel() {
        const el = document.getElementById('si-slice-range');
        if (!el) return;
        if (sliceEnd > sliceStart) {
            el.textContent = (sliceStart.toFixed(2) + ' ~ ' + sliceEnd.toFixed(2) + 's')
                           + ' (' + (sliceEnd - sliceStart).toFixed(2) + 's)';
            el.style.color = '#ce93d8';
        } else if (sliceStart > 0) {
            el.textContent = '起点: ' + sliceStart.toFixed(2) + 's';
            el.style.color = 'var(--text-muted)';
        } else {
            el.textContent = '全选';
            el.style.color = 'var(--text-muted)';
        }
    }

    /** 试听切片片段 */
    function _previewSlice() {
        stopPreview();
        if (!currentBuffer) return;

        var startT = sliceStart;
        var endT   = (sliceEnd > sliceStart) ? sliceEnd : currentBuffer.duration;
        if (endT > currentBuffer.duration) endT = currentBuffer.duration;

        var ctx = window.AudioEngine && window.AudioEngine.getCtx
            ? window.AudioEngine.getCtx()
            : new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();

        // 截取 AudioBuffer 片段
        var sr = currentBuffer.sampleRate;
        var startSample = Math.floor(startT * sr);
        var endSample   = Math.floor(endT * sr);
        var length      = endSample - startSample;

        if (length <= 0) { showToast('无效的切片范围'); return; }

        var slicedBuf = ctx.createBuffer(currentBuffer.numberOfChannels, length, sr);
        for (var ch = 0; ch < currentBuffer.numberOfChannels; ch++) {
            var srcCh = currentBuffer.getChannelData(ch);
            var dstCh = slicedBuf.getChannelData(ch);
            dstCh.set(srcCh.subarray(startSample, endSample));
        }

        slicePreviewSrc = ctx.createBufferSource();
        slicePreviewSrc.buffer = slicedBuf;

        var gain = ctx.createGain();
        gain.gain.value = 0.5;
        slicePreviewSrc.connect(gain);
        gain.connect(ctx.destination);

        slicePreviewSrc.onended = function () { isPreviewing = false; };
        slicePreviewSrc.start(0);
        isPreviewing = true;
    }

    /** 获取有效切片范围（用于导入） */
    function _getSliceRange() {
        if (!currentBuffer) return { start: 0, end: 0 };
        var dur = currentBuffer.duration;
        return {
            start: sliceStart,
            end:   (sliceEnd > sliceStart) ? sliceEnd : dur
        };
    }

    /**
     * 从 AudioBuffer 中截取 [startSec, endSec] 时间段，返回新的 AudioBuffer
     */
    function _sliceBuffer(buf, startSec, endSec) {
        var sr = buf.sampleRate;
        var dur = buf.duration;
        startSec = Math.max(0, Math.min(dur, startSec));
        endSec   = Math.max(startSec, Math.min(dur, endSec));
        var i0 = Math.floor(startSec * sr);
        var i1 = Math.min(Math.floor(endSec * sr), buf.length - 1);
        var len = i1 - i0;
        if (len <= 1) { len = 1; i1 = i0 + 1; }

        var outBuf = new OfflineAudioContext ? null : null; // placeholder
        // 使用 OfflineAudioContext 或普通 AudioContext 创建 buffer
        var tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
        var sliced = tmpCtx.createBuffer(buf.numberOfChannels, len, sr);
        for (var ch = 0; ch < buf.numberOfChannels; ch++) {
            sliced.getChannelData(ch).set(buf.getChannelData(ch).subarray(i0, i1));
        }
        tmpCtx.close();
        return sliced;
    }
})();
