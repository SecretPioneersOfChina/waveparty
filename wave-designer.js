/**
 * WaveParty Wave Designer - Serum 风格波形设计器
 * 支持：
 *   - 可视化波形编辑（绘制/调整波形）
 *   - 谐波编辑器（调整各次谐波幅度）
 *   - 多个振荡器叠加（Osc 1 + Osc 2）
 *   - 实时试听
 *   - 预设波形（Sine, Square, Sawtooth, Triangle, Custom）
 */

window.WaveDesigner = (function () {
    'use strict';

    // ===== 状态 =====
    let panelEl = null;
    let isOpen = false;
    let canvasWave = null;  // 波形绘制 Canvas
    let ctxWave = null;
    let canvasSpectrum = null; // 频谱 Canvas
    let ctxSpectrum = null;

    // 振荡器配置（类似 Serum 的 Osc A / Osc B）
    const oscillators = [
        { enabled: true,  name: 'Osc 1', waveform: 'custom', harmonics: new Float32Array(32), gain: 0.7, detune: 0, active: true },
        { enabled: true,  name: 'Osc 2', waveform: 'custom', harmonics: new Float32Array(32), gain: 0.3, detune: 7, active: false },
    ];
    let activeOscIndex = 0; // 当前编辑的振荡器

    // 当前绘制的波形点（时域，128 个点）
    const WAVE_POINTS = 128;
    let wavePoints = new Float32Array(WAVE_POINTS);
    let isDrawingWave = false;
    let dragHarmonicIndex = -1;

    // 预设波形
    const PRESET_WAVEFORMS = {
        sine:     { name: '正弦波',   harmonics: buildSineHarmonics() },
        square:   { name: '方波',     harmonics: buildSquareHarmonics() },
        sawtooth: { name: '锯齿波',   harmonics: buildSawtoothHarmonics() },
        triangle: { name: '三角波',   harmonics: buildTriangleHarmonics() },
        pulse25:  { name: '脉冲 25%', harmonics: buildPulseHarmonics(0.25) },
        pulse50:  { name: '脉冲 50%', harmonics: buildPulseHarmonics(0.5) },
        saw_up:   { name: '上升锯齿',   harmonics: buildSawUpHarmonics() },
        saw_down: { name: '下降锯齿',   harmonics: buildSawDownHarmonics() },
    };

    // ===== 初始化谐波预设 =====
    function buildSineHarmonics() {
        const h = new Float32Array(32);
        h[0] = 1.0;
        return h;
    }
    function buildSquareHarmonics() {
        const h = new Float32Array(32);
        for (let i = 0; i < 16; i++) {
            const n = i * 2 + 1;
            h[i] = 1.0 / n;
        }
        return h;
    }
    function buildSawtoothHarmonics() {
        const h = new Float32Array(32);
        for (let i = 0; i < 32; i++) {
            h[i] = 1.0 / (i + 1);
        }
        return h;
    }
    function buildTriangleHarmonics() {
        const h = new Float32Array(32);
        for (let i = 0; i < 16; i++) {
            const n = i * 2 + 1;
            h[i] = 1.0 / (n * n);
        }
        return h;
    }
    function buildPulseHarmonics(duty) {
        const h = new Float32Array(32);
        for (let i = 0; i < 32; i++) {
            const n = i + 1;
            h[i] = Math.sin(n * Math.PI * duty) / (n * Math.PI * duty + 0.0001);
        }
        return h;
    }
    function buildSawUpHarmonics() {
        const h = new Float32Array(32);
        for (let i = 0; i < 32; i++) {
            h[i] = (i % 2 === 0 ? 1 : -1) * 1.0 / (i + 1);
        }
        return h;
    }
    function buildSawDownHarmonics() {
        const h = new Float32Array(32);
        for (let i = 0; i < 32; i++) {
            h[i] = 1.0 / (i + 1);
        }
        return h;
    }

    // ===== 谐波 → 波形点 =====
    function harmonicsToWaveform(harmonics, points) {
        const result = new Float32Array(points);
        for (let i = 0; i < points; i++) {
            const t = (i / points) * 2 * Math.PI;
            let val = 0;
            const len = Math.min(harmonics.length, 32);
            for (let h = 0; h < len; h++) {
                val += harmonics[h] * Math.sin((h + 1) * t);
            }
            result[i] = val;
        }
        // Normalize
        let max = 0;
        for (let i = 0; i < points; i++) max = Math.max(max, Math.abs(result[i]));
        if (max > 0) {
            for (let i = 0; i < points; i++) result[i] /= max;
        }
        return result;
    }

    // ===== 波形点 → 谐波（FFT 简化）=====
    function waveformToHarmonics(wave) {
        const N = wave.length;
        const harmonics = new Float32Array(32);
        for (let h = 0; h < 32; h++) {
            let re = 0, im = 0;
            const freq = h + 1;
            for (let i = 0; i < N; i++) {
                const t = (i / N) * 2 * Math.PI * freq;
                re += wave[i] * Math.cos(t);
                im += wave[i] * Math.sin(t);
            }
            re /= N; im /= N;
            harmonics[h] = Math.sqrt(re * re + im * im) * 2;
        }
        return harmonics;
    }

    // ===== 构建 PeriodicWave =====
    function buildPeriodicWaveFromHarmonics(ctx, harmonics) {
        const N = Math.min(harmonics.length, 32);
        const real = new Float32Array(N + 1);
        const imag = new Float32Array(N + 1);
        real[0] = 0;
        for (let i = 0; i < N; i++) {
            imag[i + 1] = harmonics[i];
        }
        return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    }

    // ===== 获取当前设计的波形（供音频引擎使用）=====
    function getWaveData() {
        const oscData = oscillators.map(osc => ({
            enabled: osc.enabled,
            gain: osc.gain,
            detune: osc.detune,
            harmonics: new Float32Array(osc.harmonics),
        }));
        return { oscillators: oscData };
    }

    // ===== 绘制波形 =====
    function drawWaveform() {
        if (!ctxWave || !canvasWave) return;
        const W = canvasWave.width;
        const H = canvasWave.height;
        ctxWave.clearRect(0, 0, W, H);

        // 背景网格
        ctxWave.strokeStyle = 'rgba(255,255,255,0.08)';
        ctxWave.lineWidth = 1;
        for (let i = 0; i <= 8; i++) {
            const y = (i / 8) * H;
            ctxWave.beginPath(); ctxWave.moveTo(0, y); ctxWave.lineTo(W, y); ctxWave.stroke();
        }
        for (let i = 0; i <= 16; i++) {
            const x = (i / 16) * W;
            ctxWave.beginPath(); ctxWave.moveTo(x, 0); ctxWave.lineTo(x, H); ctxWave.stroke();
        }

        // 零线
        ctxWave.strokeStyle = 'rgba(255,255,255,0.3)';
        ctxWave.lineWidth = 1;
        ctxWave.beginPath();
        ctxWave.moveTo(0, H / 2);
        ctxWave.lineTo(W, H / 2);
        ctxWave.stroke();

        // 当前振荡器波形
        const osc = oscillators[activeOscIndex];
        const wave = harmonicsToWaveform(osc.harmonics, WAVE_POINTS);

        // 绘制波形
        ctxWave.strokeStyle = activeOscIndex === 0 ? '#ff6b35' : '#35c2ff';
        ctxWave.lineWidth = 2;
        ctxWave.beginPath();
        for (let i = 0; i < WAVE_POINTS; i++) {
            const x = (i / (WAVE_POINTS - 1)) * W;
            const y = H / 2 - wave[i] * (H / 2) * 0.9;
            if (i === 0) ctxWave.moveTo(x, y);
            else ctxWave.lineTo(x, y);
        }
        ctxWave.stroke();

        // 绘制另一个振荡器波形（半透明）
        const otherIdx = activeOscIndex === 0 ? 1 : 0;
        const otherOsc = oscillators[otherIdx];
        if (otherOsc.enabled) {
            const otherWave = harmonicsToWaveform(otherOsc.harmonics, WAVE_POINTS);
            ctxWave.strokeStyle = otherIdx === 0 ? 'rgba(255,107,53,0.35)' : 'rgba(53,194,255,0.35)';
            ctxWave.lineWidth = 1.5;
            ctxWave.beginPath();
            for (let i = 0; i < WAVE_POINTS; i++) {
                const x = (i / (WAVE_POINTS - 1)) * W;
                const y = H / 2 - otherWave[i] * (H / 2) * 0.9;
                if (i === 0) ctxWave.moveTo(x, y);
                else ctxWave.lineTo(x, y);
            }
            ctxWave.stroke();
        }
    }

    // ===== 绘制频谱（谐波柱状图）=====
    function drawSpectrum() {
        if (!ctxSpectrum || !canvasSpectrum) return;
        const W = canvasSpectrum.width;
        const H = canvasSpectrum.height;
        ctxSpectrum.clearRect(0, 0, W, H);

        const osc = oscillators[activeOscIndex];
        const harmonics = osc.harmonics;
        const barW = Math.max(2, (W - 40) / Math.min(harmonics.length, 32));
        const maxH = H - 30;

        // 找到最大值用于归一化
        let maxVal = 0;
        for (let i = 0; i < Math.min(harmonics.length, 32); i++) {
            maxVal = Math.max(maxVal, harmonics[i]);
        }
        if (maxVal === 0) maxVal = 1;

        for (let i = 0; i < Math.min(harmonics.length, 32); i++) {
            const val = harmonics[i] / maxVal;
            const barH = val * maxH;
            const x = 20 + i * barW;
            const y = H - 25 - barH;

            // 渐变颜色（低频暖色，高频冷色）
            const hue = 20 + (i / 32) * 200;
            ctxSpectrum.fillStyle = `hsl(${hue}, 80%, 55%)`;
            ctxSpectrum.fillRect(x + 1, y, barW - 2, barH);

            // 标签
            if (i < 16 && i % 4 === 0) {
                ctxSpectrum.fillStyle = 'rgba(255,255,255,0.5)';
                ctxSpectrum.font = '9px sans-serif';
                ctxSpectrum.textAlign = 'center';
                ctxSpectrum.fillText(`${i + 1}`, x + barW / 2, H - 8);
            }
        }
    }

    // ===== 波形 Canvas 交互 =====
    function onWavePointerDown(e) {
        if (!canvasWave) return;
        const rect = canvasWave.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        isDrawingWave = true;

        // 直接在波形上绘制
        updateWaveFromPointer(x, y);
        canvasWave.setPointerCapture(e.pointerId);
    }

    function onWavePointerMove(e) {
        if (!isDrawingWave) return;
        const rect = canvasWave.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        updateWaveFromPointer(x, y);
    }

    function onWavePointerUp() {
        isDrawingWave = false;
    }

    function updateWaveFromPointer(x, y) {
        if (!canvasWave) return;
        const W = canvasWave.width;
        const H = canvasWave.height;
        const index = Math.floor((x / W) * WAVE_POINTS);
        if (index < 0 || index >= WAVE_POINTS) return;

        const value = -(y - H / 2) / (H / 2) / 0.9;
        wavePoints[index] = Math.max(-1, Math.min(1, value));

        // 更新当前振荡器的谐波
        const osc = oscillators[activeOscIndex];
        const newHarmonics = waveformToHarmonics(wavePoints);
        osc.harmonics.set(newHarmonics);

        drawWaveform();
        drawSpectrum();
    }

    // ===== 频谱柱状图交互（拖动调整谐波）=====
    function onSpectrumPointerDown(e) {
        if (!canvasSpectrum) return;
        const rect = canvasSpectrum.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const W = canvasSpectrum.width;
        const barW = Math.max(2, (W - 40) / 32);
        const idx = Math.floor((x - 20) / barW);
        if (idx >= 0 && idx < 32) {
            dragHarmonicIndex = idx;
            updateHarmonicFromPointer(e);
            canvasSpectrum.setPointerCapture(e.pointerId);
        }
    }

    function onSpectrumPointerMove(e) {
        if (dragHarmonicIndex < 0) return;
        updateHarmonicFromPointer(e);
    }

    function onSpectrumPointerUp() {
        dragHarmonicIndex = -1;
    }

    function updateHarmonicFromPointer(e) {
        if (!canvasSpectrum) return;
        const rect = canvasSpectrum.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const H = canvasSpectrum.height;
        const val = Math.max(0, Math.min(1, (H - 25 - y) / (H - 30)));
        const osc = oscillators[activeOscIndex];
        osc.harmonics[dragHarmonicIndex] = val;

        drawWaveform();
        drawSpectrum();
    }

    // ===== 加载预设 =====
    function loadPreset(presetName) {
        const preset = PRESET_WAVEFORMS[presetName];
        if (!preset) return;
        const osc = oscillators[activeOscIndex];
        osc.harmonics.set(preset.harmonics);
        wavePoints = harmonicsToWaveform(osc.harmonics, WAVE_POINTS);
        drawWaveform();
        drawSpectrum();
    }

    // ===== 试听当前波形 =====
    function previewWave(freq) {
        if (!window.AudioEngine) return;
        const f = freq || 440;
        // 播放 0.5 秒的当前波形
        if (window.AudioEngine && window.AudioEngine.playPreview) {
            window.AudioEngine.playPreview(f, getWaveData(), 0.5);
        }
    }

    // ===== 面板创建 =====
    function createPanel() {
        if (panelEl) return;
        panelEl = document.createElement('div');
        panelEl.id = 'wave-designer-panel';
        panelEl.className = 'wave-designer-panel';
        panelEl.innerHTML = `
            <div class="wave-designer-header">
                <span class="wave-designer-title">🔬 波形设计器</span>
                <button class="wave-designer-close" id="btn-wave-designer-close">✕</button>
            </div>
            <div class="wave-designer-body">
                <!-- 振荡器选择 -->
                <div class="wd-osc-tabs">
                    <button class="wd-osc-tab active" data-osc="0">Osc 1</button>
                    <button class="wd-osc-tab" data-osc="1">Osc 2</button>
                    <label class="wd-osc-enable">
                        <input type="checkbox" id="wd-osc-enable" checked> 启用
                    </label>
                </div>

                <!-- 波形显示区 -->
                <div class="wd-section">
                    <div class="wd-section-title">波形</div>
                    <canvas class="wd-wave-canvas" id="wd-wave-canvas" width="400" height="150"></canvas>
                </div>

                <!-- 频谱编辑器 -->
                <div class="wd-section">
                    <div class="wd-section-title">谐波频谱 <span class="wd-hint">（拖动柱子调整）</span></div>
                    <canvas class="wd-spectrum-canvas" id="wd-spectrum-canvas" width="400" height="120"></canvas>
                </div>

                <!-- 预设 -->
                <div class="wd-section">
                    <div class="wd-section-title">预设波形</div>
                    <div class="wd-presets">
                        ${Object.keys(PRESET_WAVEFORMS).map(key =>
                            `<button class="wd-preset-btn" data-preset="${key}">${PRESET_WAVEFORMS[key].name}</button>`
                        ).join('')}
                    </div>
                </div>

                <!-- 振荡器参数 -->
                <div class="wd-section">
                    <div class="wd-section-title">振荡器参数</div>
                    <div class="wd-params">
                        <div class="wd-param">
                            <label>音量</label>
                            <input type="range" id="wd-osc-gain" min="0" max="100" value="70">
                            <span class="wd-param-val" id="wd-osc-gain-val">0.70</span>
                        </div>
                        <div class="wd-param">
                            <label>失谐 (Detune)</label>
                            <input type="range" id="wd-osc-detune" min="-100" max="100" value="0">
                            <span class="wd-param-val" id="wd-osc-detune-val">0 ct</span>
                        </div>
                    </div>
                </div>

                <!-- 操作按钮 -->
                <div class="wd-actions">
                    <button class="wd-action-btn" id="wd-preview-btn">🔊 试听 (440Hz)</button>
                    <button class="wd-action-btn" id="wd-apply-btn">✅ 应用到轨道</button>
                    <button class="wd-action-btn" id="wd-reset-btn">↺ 重置</button>
                </div>
            </div>
        `;
        document.body.appendChild(panelEl);

        // 获取 Canvas
        canvasWave = document.getElementById('wd-wave-canvas');
        if (canvasWave) ctxWave = canvasWave.getContext('2d');
        canvasSpectrum = document.getElementById('wd-spectrum-canvas');
        if (canvasSpectrum) ctxSpectrum = canvasSpectrum.getContext('2d');

        bindEvents();
        drawWaveform();
        drawSpectrum();
    }

    // ===== 事件绑定 =====
    function bindEvents() {
        // 关闭按钮
        document.getElementById('btn-wave-designer-close').addEventListener('click', closePanel);

        // Osc 选项卡
        document.querySelectorAll('.wd-osc-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.wd-osc-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                activeOscIndex = parseInt(tab.dataset.osc);
                updateOscUI();
                drawWaveform();
                drawSpectrum();
            });
        });

        // 启用/禁用
        document.getElementById('wd-osc-enable').addEventListener('change', (e) => {
            oscillators[activeOscIndex].enabled = e.target.checked;
        });

        // 波形 Canvas 交互
        canvasWave.addEventListener('pointerdown', onWavePointerDown);
        canvasWave.addEventListener('pointermove', onWavePointerMove);
        canvasWave.addEventListener('pointerup', onWavePointerUp);
        canvasWave.addEventListener('pointercancel', onWavePointerUp);

        // 频谱 Canvas 交互
        canvasSpectrum.addEventListener('pointerdown', onSpectrumPointerDown);
        canvasSpectrum.addEventListener('pointermove', onSpectrumPointerMove);
        canvasSpectrum.addEventListener('pointerup', onSpectrumPointerUp);
        canvasSpectrum.addEventListener('pointercancel', onSpectrumPointerUp);

        // 预设按钮
        document.querySelectorAll('.wd-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                loadPreset(btn.dataset.preset);
            });
        });

        // 振荡器参数
        const gainSlider = document.getElementById('wd-osc-gain');
        gainSlider.addEventListener('input', () => {
            const val = parseInt(gainSlider.value) / 100;
            oscillators[activeOscIndex].gain = val;
            document.getElementById('wd-osc-gain-val').textContent = val.toFixed(2);
        });
        const detuneSlider = document.getElementById('wd-osc-detune');
        detuneSlider.addEventListener('input', () => {
            const val = parseInt(detuneSlider.value);
            oscillators[activeOscIndex].detune = val;
            document.getElementById('wd-osc-detune-val').textContent = val + ' ct';
        });

        // 试听
        document.getElementById('wd-preview-btn').addEventListener('click', () => {
            previewWave(440);
        });

        // 应用
        document.getElementById('wd-apply-btn').addEventListener('click', applyToTrack);

        // 重置
        document.getElementById('wd-reset-btn').addEventListener('click', () => {
            const osc = oscillators[activeOscIndex];
            osc.harmonics.fill(0);
            osc.harmonics[0] = 1.0;
            drawWaveform();
            drawSpectrum();
        });
    }

    function updateOscUI() {
        const osc = oscillators[activeOscIndex];
        document.getElementById('wd-osc-enable').checked = osc.enabled;
        document.getElementById('wd-osc-gain').value = Math.round(osc.gain * 100);
        document.getElementById('wd-osc-gain-val').textContent = osc.gain.toFixed(2);
        document.getElementById('wd-osc-detune').value = osc.detune;
        document.getElementById('wd-osc-detune-val').textContent = osc.detune + ' ct';
    }

    // ===== 应用到轨道 =====
    function applyToTrack() {
        if (!window.Tracks || !window.Tracks.getCurrentTrack) return;
        const track = window.Tracks.getCurrentTrack();
        if (!track) {
            alert('请先选中一个轨道！');
            return;
        }
        // 保存当前波形数据到轨道
        if (!track.waveDesign) track.waveDesign = {};
        track.waveDesign = JSON.parse(JSON.stringify(getWaveData()));
        // 标记使用自定义波形
        if (track.instrument) {
            track.instrument.useCustomWave = true;
        }
        if (window.App && window.App.saveState) window.App.saveState();
        alert(`已将波形设计应用到轨道「${track.name}」！`);
    }

    // ===== 面板开关 =====
    function openPanel() {
        if (!panelEl) createPanel();
        panelEl.classList.add('open');
        isOpen = true;
        // 初始化波形
        const osc = oscillators[activeOscIndex];
        wavePoints = harmonicsToWaveform(osc.harmonics, WAVE_POINTS);
        drawWaveform();
        drawSpectrum();
    }

    function closePanel() {
        if (!panelEl) return;
        panelEl.classList.remove('open');
        isOpen = false;
    }

    function togglePanel() {
        if (isOpen) closePanel();
        else openPanel();
    }

    // ===== 导出供音频引擎使用 =====
    function getCustomWaveForTrack(trackId) {
        if (!window.Tracks) return null;
        const track = window.Tracks.getTrackById(trackId);
        if (!track || !track.waveDesign) return null;
        return track.waveDesign;
    }

    // ===== 公共 API =====
    return {
        openPanel,
        closePanel,
        togglePanel,
        getWaveData,
        getCustomWaveForTrack,
        isOpen: () => isOpen,
    };
})();
