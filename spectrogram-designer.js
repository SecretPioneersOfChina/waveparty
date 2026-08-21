/**
 * WaveParty Spectrogram Timbre Designer
 * 集成语谱图绘制 + 可拖动衰减曲线 + 实时波形预览
 * 作为主要音色设计工具，完全替代贝塞尔编辑器
 */

window.SpectrogramDesigner = (function () {
    'use strict';

    // ==================== 常量 ====================
    const MIN_FREQ   = 20;
    const MAX_FREQ   = 18000;
    const SAMPLE_RATE = 44100;
    const CANVAS_W   = 600;
    const CANVAS_H   = 280;
    const ENV_W      = 600;   // 衰减曲线宽度（与语谱图同宽）
    const ENV_H      = 80;    // 衰减曲线高度
    const WAVE_W     = 200;   // 波形预览宽度
    const WAVE_H     = 280;   // 波形预览高度（与语谱图同高）
    const FREQ_BANDS = 80;
    const FRAME_SIZE = 1024;
    const HOP_SIZE   = 256;

    // 热力图调色板
    const COLORMAP = [
        { pos: 0.00, r: 13,  g: 17,  b: 23  },
        { pos: 0.10, r: 20,  g: 10,  b: 60  },
        { pos: 0.25, r: 80,  g: 15,  b: 120 },
        { pos: 0.40, r: 180, g: 20,  b: 60  },
        { pos: 0.55, r: 240, g: 70,  b: 10  },
        { pos: 0.70, r: 255, g: 160, b: 20  },
        { pos: 0.85, r: 255, g: 220, b: 60  },
        { pos: 1.00, r: 255, g: 255, b: 240 },
    ];

    function colormap(t) {
        if (t <= 0) return COLORMAP[0];
        if (t >= 1) return COLORMAP[COLORMAP.length - 1];
        for (let i = 1; i < COLORMAP.length; i++) {
            if (t <= COLORMAP[i].pos) {
                const a = COLORMAP[i - 1], b = COLORMAP[i];
                const f = (t - a.pos) / (b.pos - a.pos);
                return {
                    r: Math.round(a.r + (b.r - a.r) * f),
                    g: Math.round(a.g + (b.g - a.g) * f),
                    b: Math.round(a.b + (b.b - a.b) * f)
                };
            }
        }
        return COLORMAP[COLORMAP.length - 1];
    }

    // ==================== 状态 ====================
    let panel = null;

    // --- 语谱图画布 ---
    let specCanvas = null, specCtx = null;
    let gridCanvas = null, gridCtx = null;

    // --- 衰减曲线画布 ---
    let envCanvas = null, envCtx = null;

    // --- 波形预览画布 ---
    let waveCanvas = null, waveCtx = null;

    let isDrawing = false;
    let tool = 'brush';
    let brushSize = 10;
    let duration = 2.0;
    let lineStart = null;
    let rectStart = null;
    let audioCtx = null;
    let currentSource = null;
    let previewing = false;

    /** 每个像素的振幅 [0-1]，row-major */
    let ampData = null;

    // --- 包络曲线节点（可拖动控制点） ---
    // 节点数组: [{x: 0..1, y: 0..1}]，x=时间归一化, y=振幅
    let envNodes = [
        { x: 0,    y: 0 },     // 起始静音
        { x: 0.02, y: 1 },     // 快速起音
        { x: 0.15, y: 0.7 },   // 衰减到持续
        { x: 0.85, y: 0.7 },   // 持续结束
        { x: 1,    y: 0 }      // 释音到0
    ];
    let envDragging = null;   // 正在拖拽的节点索引
    let envDirty = false;     // 需要刷新波形

    // ==================== 初始化 ====================
    function init() {
        createPanel();
        resetAmpData();
    }

    function getAudioCtx() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx;
    }

    function resetAmpData() {
        ampData = new Float32Array(CANVAS_W * CANVAS_H);
    }

    // ==================== 面板创建 ====================
    function createPanel() {
        panel = document.createElement('div');
        panel.className = 'modal-overlay';
        panel.id = 'spectrogram-modal';
        panel.style.display = 'none';
        panel.innerHTML = `
        <div class="modal-box spd-modal-box">
            <div class="modal-header">
                <h2>🎨 音色设计器</h2>
                <button class="modal-close" id="spec-modal-close">✕</button>
     
            </div>
            <!-- 标签页切换 -->
            <div class="spd-tabs">
                <button class="spd-tab active" data-tab="spectrogram">🎙 语谱图</button>
                <button class="spd-tab" data-tab="wave">🔬 波形设计</button>
            </div>
            

            

            
            <div class="spd-tab-content active" id="spd-tab-spectrogram">
                <div class="spd-section-spec" id="spd-section-spec">

            <!-- 工具栏 -->
            <div class="spec-toolbar">
                <div class="spec-tool-group">
                    <span class="spec-label">绘制工具</span>
                    <button class="spec-tool-btn active" data-tool="brush" title="画笔">🖊</button>
                    <button class="spec-tool-btn" data-tool="eraser" title="橡皮">🧹</button>
                    <button class="spec-tool-btn" data-tool="line" title="直线扫频">📏</button>
                    <button class="spec-tool-btn" data-tool="noise" title="噪点喷洒">🌊</button>
                    <button class="spec-tool-btn" data-tool="rect" title="矩形填充">🔲</button>
                </div>
                <div class="spec-tool-group">
                    <span class="spec-label">笔刷</span>
                    <input type="range" id="spec-brush-size" min="2" max="40" value="10" class="spec-slider">
                    <span class="spec-value" id="spec-brush-display">10</span>
                </div>
                <div class="spec-tool-group">
                    <span class="spec-label">时长</span>
                    <input type="range" id="spec-duration" min="0.5" max="6" step="0.1" value="2" class="spec-slider">
                    <span class="spec-value" id="spec-duration-display">2.0s</span>
                </div>
                <div class="spec-tool-group spec-presets">
                    <span class="spec-label">预设</span>
                    <button class="spec-preset-btn" data-preset="sweep-up">↗ 升频</button>
                    <button class="spec-preset-btn" data-preset="sweep-down">↘ 降频</button>
                    <button class="spec-preset-btn" data-preset="noise-burst">💥 噪点</button>
                    <button class="spec-preset-btn" data-preset="harmonic">🎵 泛音列</button>
                    <button class="spec-preset-btn" data-preset="percussive">🥁 打击</button>
                    <button class="spec-preset-btn" data-preset="chirp">🐦 啾啾</button>
                    <span class="spec-label" style="margin-left:12px;">包络预设</span>
                    <button class="spec-preset-btn env-preset" data-env="piano">钢琴</button>
                    <button class="spec-preset-btn env-preset" data-env="pluck">拨弦</button>
                    <button class="spec-preset-btn env-preset" data-env="pad">合成垫</button>
                    <button class="spec-preset-btn env-preset" data-env="perc">打击乐</button>
                </div>
            </div>

            <!-- 主编辑区: 语谱图 + 波形预览 -->
            <div class="spd-main-area">
                <!-- 左侧频率标签 -->
                <div class="spd-freq-axis">
                    <div class="spd-freq-labels" id="spd-freq-labels"></div>
                </div>

                <!-- 中: 语谱图画布 -->
                <div class="spd-spec-wrap">
                    <div class="spd-canvas-stack" id="spd-canvas-stack">
                        <canvas id="spec-data-canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
                        <canvas id="spec-grid-canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
                    </div>
                    <!-- HUD -->
                    <div class="spec-hud" id="spec-hud">
                        <span id="spec-hud-freq">-- Hz</span>
                        <span id="spec-hud-time">-- s</span>
                        <span id="spec-hud-amp">-- dB</span>
                    </div>
                </div>

                <!-- 右: 波形预览 -->
                <div class="spd-wave-area">
                    <div class="spd-wave-title">波形预览</div>
                    <canvas id="spd-wave-canvas" width="${WAVE_W}" height="${WAVE_H}"></canvas>
                    <div class="spd-wave-hint">← 合成波形</div>
                </div>
            </div>

            <!-- 衰减曲线编辑器 -->
            <div class="spd-env-section">
                <div class="spd-env-header">
                    <span class="spd-env-title">📈 音量包络</span>
                    <span class="spd-env-hint">拖动控制点调整包络 · 双击添加节点 · 右键删除节点</span>
                </div>
                <div class="spd-env-wrap">
                    <div class="spd-env-ylabels">
                        <span>100%</span>
                        <span>50%</span>
                        <span>0%</span>
                    </div>
                    <canvas id="spd-env-canvas" width="${ENV_W}" height="${ENV_H}"></canvas>
                    <div class="spd-env-xlabels" id="spd-env-xlabels"></div>
                </div>
            </div>

            </div>

            <!-- 底部操作栏 -->
            <div class="spec-actions">
                <button class="spec-action-btn primary" id="btn-spec-preview">▶ 预览试音</button>
                <button class="spec-action-btn" id="btn-spec-stop" disabled>⏹ 停止</button>
                <button class="spec-action-btn" id="btn-spec-export">💾 导出WAV</button>
                <button class="spec-action-btn" id="btn-spec-export-test" style="font-size:11px;">🔊 测试音(440Hz)</button>
                <button class="spec-action-btn danger" id="btn-spec-clear">🗑 清空语谱图</button>
                <button class="spec-action-btn" id="btn-spec-import-track">📥 从轨道导入</button>
                <button class="spec-action-btn" id="btn-spec-import-audio" title="导入音频文件（WAV/MP3/OGG等）作为音色">📁 导入音效</button>
                <button class="spec-action-btn primary" id="btn-spec-set-timbre" style="background:#00bcd4;border-color:#00bcd4;">🎹 设为轨道音色</button>
            </div>
        </div>

        <!-- 波形设计标签页 -->
            <div class="spd-tab-content" id="spd-tab-wave">
                <div class="spd-section-divider"><span>🔬 波形设计</span></div>
                <div class="spd-wave-inner">
                    <div class="spd-wave-osc-tabs">
                        <button class="spd-wave-osc-tab active" data-osc="0">Osc 1</button>
                        <button class="spd-wave-osc-tab" data-osc="1">Osc 2</button>
                        <label class="wd-osc-enable">
                            <input type="checkbox" id="wd-osc-enable" checked> 启用
                        </label>
                    </div>
                    <div class="spd-wave-section">
                        <div class="spd-section-title">谐波频谱 <span class="wd-hint">（拖动柱子调整）</span></div>
                        <canvas class="spd-wave-spectrum-canvas" id="wd-spectrum-canvas" width="400" height="120"></canvas>
                    </div>
                    <div class="spd-wave-section">
                        <div class="spd-section-title">波形预览</div>
                        <canvas class="spd-wave-preview-canvas" id="wd-wave-preview-canvas" width="400" height="150"></canvas>
                    </div>

                    <!-- 预设波形 -->
                    <div class="spd-wave-section">
                        <div class="spd-section-title">预设波形</div>
                        <div class="wd-presets">
                            <button class="wd-preset-btn" data-wave="sine">正弦波</button>
                            <button class="wd-preset-btn" data-wave="square">方波</button>
                            <button class="wd-preset-btn" data-wave="sawtooth">锯齿波</button>
                            <button class="wd-preset-btn" data-wave="triangle">三角波</button>
                            <button class="wd-preset-btn" data-wave="pulse25">脉冲 25%</button>
                            <button class="wd-preset-btn" data-wave="pulse50">脉冲 50%</button>
                            <button class="wd-preset-btn" data-wave="rampup">上升锯齿</button>
                            <button class="wd-preset-btn" data-wave="organ">风琴</button>
                            <button class="wd-preset-btn" data-wave="pluck">拨弦</button>
                            <button class="wd-preset-btn" data-wave="bell">钟声</button>
                        </div>
                    </div>

                    <div class="spd-wave-section">
                        <div class="spd-section-title">额外声源</div>
                        <div class="wd-extra-row">
                            <label class="wd-checkbox-label">
                                <input type="checkbox" id="wd-noise-enable" checked> 噪音 (Noise)
                            </label>
                            <label class="wd-param-label">音量</label>
                            <input type="range" id="wd-noise-gain" min="0" max="100" value="30">
                            <span class="wd-param-val" id="wd-noise-gain-val">0.30</span>
                        </div>
                        <div class="wd-extra-row">
                            <label class="wd-checkbox-label">
                                <input type="checkbox" id="wd-sub-enable" checked> 低频 (Sub -1oct)</label>
                            <label class="wd-param-label">音量</label>
                            <input type="range" id="wd-sub-gain" min="0" max="100" value="40">
                            <span class="wd-param-val" id="wd-sub-gain-val">0.40</span>
                        </div>
                    </div>
<div class="spd-wave-section">
                        <div class="spd-section-title">振荡器参数</div>
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
                    <div class="spd-wave-actions">
                        <button class="spd-wave-action-btn" id="wd-preview-btn" style="position:relative;z-index:999;pointer-events:auto !important;" onclick="console.log('[WD] preview clicked');window.__wdPreview && window.__wdPreview()">🔊 试听 (440Hz)</button>
                        <button class="spd-wave-action-btn" id="wd-apply-btn" style="position:relative;z-index:999;pointer-events:auto !important;" onclick="console.log('[WD] apply clicked');window.__wdApply && window.__wdApply()">✅ 应用波形到轨道</button>
                        <button class="spd-wave-action-btn" id="wd-export-btn" style="position:relative;z-index:999;pointer-events:auto !important;" onclick="window.__wdExportWAV && window.__wdExportWAV()">💾 导出WAV</button>
                        <button class="spd-wave-action-btn" id="wd-reset-btn" style="position:relative;z-index:999;pointer-events:auto !important;" onclick="console.log('[WD] reset clicked');window.__wdReset && window.__wdReset()">↺ 重置</button>
                    </div>
                </div>
                
                </div>
            </div>`;
        document.body.appendChild(panel);

        // 获取引用（加 null 保护，防止单元素缺失中断全流程）
        specCanvas  = panel.querySelector('#spec-data-canvas');
        specCtx     = specCanvas ? specCanvas.getContext('2d') : null;
        gridCanvas  = panel.querySelector('#spec-grid-canvas');
        gridCtx     = gridCanvas ? gridCanvas.getContext('2d') : null;
        envCanvas   = panel.querySelector('#spd-env-canvas');
        envCtx      = envCanvas ? envCanvas.getContext('2d') : null;
        waveCanvas  = panel.querySelector('#spd-wave-canvas');
        waveCtx     = waveCanvas ? waveCanvas.getContext('2d') : null;

        bindEvents();

        // ===== 波形设计初始化（用 try/catch 隔离，即使失败也不影响语谱图）=====
        try {
            _initWaveDesign(panel);
        } catch(e) {
            console.error('[SpectrogramDesigner] 波形设计初始化失败:', e);
        }
    }

    // ─── 波形设计独立初始化函数（与 createPanel 解耦）───
    function _initWaveDesign(panel) {
        // --- 波形设计：Osc 选项卡 ---
        let wdActiveOsc = 0;
        const wdOscTabs = panel.querySelectorAll('.spd-wave-osc-tab');
        const wdEnableCheckbox = panel.querySelector('#wd-osc-enable');
        wdOscTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                wdOscTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                wdActiveOsc = parseInt(tab.dataset.osc);
                wdUpdateOscUI();
                wdDrawSpectrum();
                wdDrawPreview();
            });
        });
        if (wdEnableCheckbox) {
            wdEnableCheckbox.addEventListener('change', () => {
                if (!window._wdOscillators) window._wdOscillators = [{enabled:true,gain:0.7,detune:0,harmonics:new Float32Array(32)},{enabled:false,gain:0.3,detune:7,harmonics:new Float32Array(32)}];
                window._wdOscillators[wdActiveOsc].enabled = wdEnableCheckbox.checked;
            });
        }

        // --- 波形设计：频谱 Canvas 交互 ---
        const wdSpecCanvas = panel.querySelector('#wd-spectrum-canvas');
        const wdPreviewCanvas = panel.querySelector('#wd-wave-preview-canvas');
        let wdSpectrumCtx = null;
        let wdPreviewCtx = null;
        if (wdSpecCanvas) wdSpectrumCtx = wdSpecCanvas.getContext('2d');
        if (wdPreviewCanvas) wdPreviewCtx = wdPreviewCanvas.getContext('2d');

        // 初始化 _wdOscillators
        if (!window._wdOscillators) {
            window._wdOscillators = [
                {enabled:true, gain:0.7, detune:0, harmonics:new Float32Array(32)},
                {enabled:false, gain:0.3, detune:7, harmonics:new Float32Array(32)}
            ];
            // 默认给 Osc 1 一个正弦波的谐波
            window._wdOscillators[0].harmonics[0] = 1.0;
        }

        function wdUpdateOscUI() {
            if (!window._wdOscillators) return;
            const osc = window._wdOscillators[wdActiveOsc];
            if (wdEnableCheckbox) wdEnableCheckbox.checked = osc.enabled;
            const gainSlider = panel.querySelector('#wd-osc-gain');
            const gainVal = panel.querySelector('#wd-osc-gain-val');
            if (gainSlider) gainSlider.value = Math.round(osc.gain * 100);
            if (gainVal) gainVal.textContent = osc.gain.toFixed(2);
            const detuneSlider = panel.querySelector('#wd-osc-detune');
            const detuneVal = panel.querySelector('#wd-osc-detune-val');
            if (detuneSlider) detuneSlider.value = osc.detune;
            if (detuneVal) detuneVal.textContent = osc.detune + ' ct';
        }

        function wdSpectrumToHarmonics() {
            // 从频谱 Canvas 读取谐波数据（简化：用预设）
            if (!window._wdOscillators) return;
            const osc = window._wdOscillators[wdActiveOsc];
            // 如果频谱 Canvas 上有手动绘制的数据，转换为谐波
            // 这里简化为：用 Canvas 像素数据估算谐波
            if (!wdSpectrumCtx || !wdSpecCanvas) return;
            const w = wdSpecCanvas.width;
            const h = wdSpecCanvas.height;
            const imgData = wdSpectrumCtx.getImageData(0, 0, w, h);
            for (let i = 0; i < 32; i++) {
                const x = Math.floor((i / 32) * w);
                let sum = 0;
                for (let y = 0; y < h; y++) {
                    const idx = (y * w + x) * 4;
                    sum += imgData.data[idx] / 255;
                }
                osc.harmonics[i] = Math.max(0, (sum / h) * 2);
            }
        }

        function wdDrawSpectrum() {
            if (!wdSpectrumCtx || !wdSpecCanvas) return;
            const w = wdSpecCanvas.width;
            const h = wdSpecCanvas.height;
            wdSpectrumCtx.fillStyle = '#0e1018';
            wdSpectrumCtx.fillRect(0, 0, w, h);
            if (!window._wdOscillators) return;
            const osc = window._wdOscillators[wdActiveOsc];
            const harmonics = osc.harmonics;
            const barW = Math.max(2, (w - 40) / 32);
            let maxV = 0;
            for (let i = 0; i < 32; i++) maxV = Math.max(maxV, harmonics[i]);
            if (maxV === 0) maxV = 1;
            for (let i = 0; i < 32; i++) {
                const val = harmonics[i] / maxV;
                const barH = val * (h - 30);
                const x = 20 + i * barW;
                const y = h - 25 - barH;
                const hue = 20 + (i / 32) * 200;
                wdSpectrumCtx.fillStyle = 'hsl(' + hue + ',80%,55%)';
                wdSpectrumCtx.fillRect(x + 1, y, barW - 2, barH);
            }
            // 标签
            wdSpectrumCtx.fillStyle = 'rgba(255,255,255,0.5)';
            wdSpectrumCtx.font = '9px sans-serif';
            wdSpectrumCtx.textAlign = 'center';
            for (let i = 0; i < 32; i += 4) {
                const x = 20 + i * barW + barW / 2;
                wdSpectrumCtx.fillText((i + 1).toString(), x, h - 8);
            }
        }

        function wdDrawPreview() {
            if (!wdPreviewCtx || !wdPreviewCanvas) return;
            const w = wdPreviewCanvas.width;
            const h = wdPreviewCanvas.height;
            wdPreviewCtx.fillStyle = '#0e1018';
            wdPreviewCtx.fillRect(0, 0, w, h);
            if (!window._wdOscillators) return;
            // 合成波形
            const pts = 128;
            const wave = new Float32Array(pts);
            window._wdOscillators.forEach(osc => {
                if (!osc.enabled) return;
                for (let i = 0; i < pts; i++) {
                    const t = (i / pts) * 2 * Math.PI;
                    let v = 0;
                    for (let h = 0; h < 32; h++) {
                        v += (osc.harmonics[h] || 0) * Math.sin((h + 1) * t);
                    }
                    wave[i] += v * osc.gain;
                }
            });
            // 归一化
            let maxW = 0;
            for (let i = 0; i < pts; i++) maxW = Math.max(maxW, Math.abs(wave[i]));
            if (maxW > 0) for (let i = 0; i < pts; i++) wave[i] /= maxW;
            // 绘制
            wdPreviewCtx.strokeStyle = '#00bcd4';
            wdPreviewCtx.lineWidth = 2;
            wdPreviewCtx.beginPath();
            for (let i = 0; i < pts; i++) {
                const x = (i / (pts - 1)) * w;
                const y = h / 2 - wave[i] * (h / 2) * 0.9;
                if (i === 0) wdPreviewCtx.moveTo(x, y);
                else wdPreviewCtx.lineTo(x, y);
            }
            wdPreviewCtx.stroke();
        }

        // --- 频谱 Canvas 交互（拖动柱子）---
        let wdDragIdx = -1;
        if (wdSpecCanvas) {
            wdSpecCanvas.addEventListener('pointerdown', (e) => {
                const rect = wdSpecCanvas.getBoundingClientRect();
                const scaleX = wdSpecCanvas.width / rect.width;
                const scaleY = wdSpecCanvas.height / rect.height;
                const x = (e.clientX - rect.left) * scaleX;
                const y = (e.clientY - rect.top) * scaleY;
                const w = wdSpecCanvas.width;
                const h = wdSpecCanvas.height;
                const barW = Math.max(2, (w - 40) / 32);
                const idx = Math.floor((x - 20) / barW);
                if (idx >= 0 && idx < 32) {
                    wdDragIdx = idx;
                    const val = Math.max(0, Math.min(1, (h - 25 - y) / (h - 30)));
                    if (window._wdOscillators) {
                        window._wdOscillators[wdActiveOsc].harmonics[idx] = val;
                        wdDrawSpectrum();
                        wdDrawPreview();
                    }
                    wdSpecCanvas.setPointerCapture(e.pointerId);
                }
            });
            wdSpecCanvas.addEventListener('pointermove', (e) => {
                if (wdDragIdx < 0) return;
                const rect = wdSpecCanvas.getBoundingClientRect();
                const scaleY = wdSpecCanvas.height / rect.height;
                const y = (e.clientY - rect.top) * scaleY;
                const h = wdSpecCanvas.height;
                const val = Math.max(0, Math.min(1, (h - 25 - y) / (h - 30)));
                if (window._wdOscillators) {
                    window._wdOscillators[wdActiveOsc].harmonics[wdDragIdx] = val;
                    wdDrawSpectrum();
                    wdDrawPreview();
                }
            });
            wdSpecCanvas.addEventListener('pointerup', () => { wdDragIdx = -1; });
            wdSpecCanvas.addEventListener('pointercancel', () => { wdDragIdx = -1; });
        }

        // --- 参数滑块 ---
        const gainSlider = panel.querySelector('#wd-osc-gain');
        if (gainSlider) {
            gainSlider.addEventListener('input', () => {
                const val = parseInt(gainSlider.value) / 100;
                if (window._wdOscillators) {
                    window._wdOscillators[wdActiveOsc].gain = val;
                    const valEl = panel.querySelector('#wd-osc-gain-val');
                    if (valEl) valEl.textContent = val.toFixed(2);
                    wdDrawPreview();
                }
            });
        }
        const detuneSlider = panel.querySelector('#wd-osc-detune');
        if (detuneSlider) {
            detuneSlider.addEventListener('input', () => {
                const val = parseInt(detuneSlider.value);
                if (window._wdOscillators) {
                    window._wdOscillators[wdActiveOsc].detune = val;
                    const valEl = panel.querySelector('#wd-osc-detune-val');
                    if (valEl) valEl.textContent = val + ' ct';
                    wdDrawPreview();
                }
            });
        }

        // --- 试听 ---
                // === 波形设计按钮处理函数（通过 inline onclick 调用）===
        
        // --- 试听 ---
        window.__wdPreview = function() {
            if (!window.AudioEngine || !window._wdOscillators) { console.warn('[WD] AudioEngine or _wdOscillators not ready'); return; }
            try {
                const ctx = window.AudioEngine.getCtx ? window.AudioEngine.getCtx() : new (window.AudioContext || window.webkitAudioContext)();
                const dur = 0.5;
                const now = ctx.currentTime;
                window._wdOscillators.forEach(function(osc) {
                    if (!osc.enabled) return;
                    var oscNode = ctx.createOscillator();
                    var g = ctx.createGain();
                    g.gain.value = 0;
                    var N = Math.min(osc.harmonics.length, 32);
                    var real = new Float32Array(N + 1);
                    var imag = new Float32Array(N + 1);
                    real[0] = 0;
                    for (var i = 0; i < N; i++) imag[i + 1] = osc.harmonics[i] || 0;
                    try { oscNode.setPeriodicWave(ctx.createPeriodicWave(real, imag)); } catch(ex) { oscNode.type = 'sine'; }
                    oscNode.frequency.value = 440;
                    if (osc.detune) oscNode.detune.value = osc.detune;
                    g.gain.setValueAtTime(0.0001, now);
                    g.gain.linearRampToValueAtTime(osc.gain * 0.3, now + 0.02);
                    g.gain.setValueAtTime(osc.gain * 0.3, now + dur * 0.8);
                    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
                    oscNode.connect(g); g.connect(ctx.destination);
                    oscNode.start(now); oscNode.stop(now + dur + 0.05);
                });
            } catch(e) { console.error('[WD] Preview error:', e); }
        };

        // --- 应用波形到轨道 ---
        window.__wdApply = function() {
            if (!window.Tracks || !window._wdOscillators) { console.warn('[WD] Tracks or _wdOscillators not ready'); return; }
            try {
                var track = window.Tracks.getSelectedTrack();
                if (!track) {
                    track = window.Tracks.addTrack('Wave', {waveform: 'sine'});
                    if (!track) { alert('创建轨道失败'); return; }
                    window.Tracks.selectTrack(track.id);
                }
                track.instrument.useCustomWave = true;
                track.instrument.waveDesign = { oscillators: window._wdOscillators.map(function(o) { return Object.assign({}, o, {harmonics: Array.from(o.harmonics)}); }) };
                var avg = new Float32Array(32);
                window._wdOscillators.forEach(function(o) {
                    if (!o.enabled) return;
                    for (var i = 0; i < 32; i++) avg[i] += (o.harmonics[i] || 0) * o.gain;
                });
                var maxA = 0;
                for (var i = 0; i < 32; i++) maxA = Math.max(maxA, Math.abs(avg[i]));
                if (maxA > 0) for (var i = 0; i < 32; i++) avg[i] /= maxA;
                track.instrument.timbre = Array.from(avg);
                if (window.App && window.App.saveState) window.App.saveState();
                alert('✅ 已应用波形设计到轨道「' + track.name + '」！');
            } catch(e) { console.error('[WD] Apply error:', e); alert('应用失败: ' + e.message); }
        };

        // --- 重置 ---
        window.__wdReset = function() {
            if (!window._wdOscillators) return;
            var osc = window._wdOscillators[wdActiveOsc];
            osc.harmonics.fill(0);
            osc.harmonics[0] = 1.0;
            if (typeof wdDrawSpectrum === 'function') wdDrawSpectrum();
            if (typeof wdDrawPreview === 'function') wdDrawPreview();
        };

        // --- 预设波形（生成谐波数组）---
        function setOscPreset(presetName) {
            if (!window._wdOscillators) {
                console.warn('[WD] _wdOscillators not ready');
                return;
            }
            const osc = window._wdOscillators[wdActiveOsc];
            const N = 32;
            osc.harmonics = new Float32Array(N);
            // 不同预设的谐波配方
            switch (presetName) {
                case 'sine':
                    osc.harmonics[0] = 1.0;
                    break;
                case 'square':
                    // 方波：奇次谐波，1/n
                    for (let i = 0; i < N; i++) {
                        const k = i + 1;
                        osc.harmonics[i] = (k % 2 === 1) ? 1.0 / k : 0;
                    }
                    break;
                case 'sawtooth':
                    // 锯齿波：所有谐波，1/n
                    for (let i = 0; i < N; i++) {
                        osc.harmonics[i] = 1.0 / (i + 1);
                    }
                    break;
                case 'triangle':
                    // 三角波：奇次谐波，1/n²
                    for (let i = 0; i < N; i++) {
                        const k = i + 1;
                        osc.harmonics[i] = (k % 2 === 1) ? 1.0 / (k * k) : 0;
                    }
                    break;
                case 'pulse25':
                    // 25% 占空比脉冲
                    for (let i = 0; i < N; i++) {
                        const k = i + 1;
                        osc.harmonics[i] = (Math.sin(Math.PI * k * 0.25) / (Math.PI * k));
                    }
                    osc.harmonics[0] = 0.25;
                    break;
                case 'pulse50':
                    // 50% 占空比脉冲（≈方波）
                    for (let i = 0; i < N; i++) {
                        const k = i + 1;
                        osc.harmonics[i] = (k % 2 === 1) ? 1.0 / k : 0;
                    }
                    osc.harmonics[0] = 0.5;
                    break;
                case 'rampup':
                    // 上升锯齿（与锯齿波类似，但相位差）
                    for (let i = 0; i < N; i++) {
                        const k = i + 1;
                        osc.harmonics[i] = (1.0 / k) * (k % 2 === 1 ? 1 : -1);
                    }
                    break;
                case 'organ':
                    // 风琴：基频 + 二次 + 三次
                    osc.harmonics[0] = 1.0;
                    osc.harmonics[1] = 0.5;
                    osc.harmonics[2] = 0.25;
                    osc.harmonics[3] = 0.125;
                    break;
                case 'pluck':
                    // 拨弦：所有谐波，等强度
                    for (let i = 0; i < 12; i++) osc.harmonics[i] = 0.7;
                    osc.harmonics[0] = 1.0;
                    break;
                case 'bell':
                    // 钟声：基频 + 不和谐波
                    osc.harmonics[0] = 1.0;
                    osc.harmonics[1] = 0.4;
                    osc.harmonics[2] = 0.3;
                    osc.harmonics[3] = 0.6;
                    osc.harmonics[4] = 0.4;
                    osc.harmonics[5] = 0.2;
                    osc.harmonics[6] = 0.15;
                    break;
                default:
                    osc.harmonics[0] = 1.0;
            }
            // 重新绘制
            if (typeof wdDrawSpectrum === 'function') wdDrawSpectrum();
            if (typeof wdDrawPreview === 'function') wdDrawPreview();
            // 启用振荡器（用户选了预设，肯定想听到声音）
            osc.enabled = true;
            if (wdEnableCheckbox) wdEnableCheckbox.checked = true;
            // 给个反馈
            showToast('🎵 已应用预设：' + presetName);
        }

        // 绑定预设按钮事件
        panel.querySelectorAll('.wd-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const wave = btn.dataset.wave;
                setOscPreset(wave);
            });
        });

        // 把试听/应用/重置按钮改为 addEventListener（更可靠，避免 inline onclick 失效）
        const previewBtn = panel.querySelector('#wd-preview-btn');
        const applyBtn   = panel.querySelector('#wd-apply-btn');
        const resetBtn   = panel.querySelector('#wd-reset-btn');
        if (previewBtn) previewBtn.addEventListener('click', () => window.__wdPreview && window.__wdPreview());
        if (applyBtn)   applyBtn.addEventListener('click', () => window.__wdApply && window.__wdApply());
        if (resetBtn)   resetBtn.addEventListener('click', () => window.__wdReset && window.__wdReset());

        // --- 标签页切换 ---
        panel.querySelectorAll(".spd-tab").forEach(tab => {
            tab.addEventListener("click", () => {
                panel.querySelectorAll(".spd-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                const target = tab.dataset.tab;
                const specContent = panel.querySelector("#spd-tab-spectrogram");
                const waveContent = panel.querySelector("#spd-tab-wave");
                if (specContent) specContent.style.display = target === "spectrogram" ? "flex" : "none";
                if (waveContent) waveContent.style.display = target === "wave" ? "flex" : "none";
            });
        });
        
        buildFreqLabels();
        buildEnvXLabels();
    }

    // ==================== 事件绑定 ====================
    function bindEvents() {
        panel.querySelector('#spec-modal-close').addEventListener('click', close);

        // 工具选择
        panel.querySelectorAll('.spec-tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                tool = btn.dataset.tool;
                panel.querySelectorAll('.spec-tool-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                lineStart = null; rectStart = null;
            });
        });

        // 画笔大小
        const brushSlider = panel.querySelector('#spec-brush-size');
        brushSlider.addEventListener('input', () => {
            brushSize = parseInt(brushSlider.value);
            panel.querySelector('#spec-brush-display').textContent = brushSize;
        });

        // 时长
        const durSlider = panel.querySelector('#spec-duration');
        durSlider.addEventListener('input', () => {
            duration = parseFloat(durSlider.value);
            panel.querySelector('#spec-duration-display').textContent = duration.toFixed(1) + 's';
            buildEnvXLabels();
            renderGrid();
            drawEnvCurve();
        });

        // 语谱图预设
        panel.querySelectorAll('.spec-preset-btn:not(.env-preset)').forEach(btn => {
            btn.addEventListener('click', () => applySpecPreset(btn.dataset.preset));
        });

        // 包络预设
        panel.querySelectorAll('.env-preset').forEach(btn => {
            btn.addEventListener('click', () => applyEnvPreset(btn.dataset.env));
        });

        // 语谱图画布绘制
        specCanvas.addEventListener('pointerdown', onSpecPointerDown);
        specCanvas.addEventListener('pointermove', onSpecPointerMove);
        specCanvas.addEventListener('pointerup',   onSpecPointerUp);
        specCanvas.addEventListener('pointerleave', onSpecPointerUp);
        specCanvas.addEventListener('mousemove', onSpecHover);

        // 包络曲线编辑
        envCanvas.addEventListener('pointerdown', onEnvPointerDown);
        envCanvas.addEventListener('pointermove', onEnvPointerMove);
        envCanvas.addEventListener('pointerup',   onEnvPointerUp);
        envCanvas.addEventListener('pointerleave', onEnvPointerUp);
        envCanvas.addEventListener('dblclick', onEnvDblClick);
        envCanvas.addEventListener('contextmenu', onEnvContextMenu);

        // 操作按钮
        panel.querySelector('#btn-spec-preview').addEventListener('click', preview);
        panel.querySelector('#btn-spec-stop').addEventListener('click', stopPreview);
        panel.querySelector('#btn-spec-export').addEventListener('click', exportWAV);
        panel.querySelector('#btn-spec-export-test').addEventListener('click', exportTestTone);
        panel.querySelector('#btn-spec-clear').addEventListener('click', clearCanvas);
        panel.querySelector('#btn-spec-import-track').addEventListener('click', importFromTrack);
        panel.querySelector('#btn-spec-import-audio').addEventListener('click', () => {
            if (window.SampleImporter && SampleImporter.open) SampleImporter.open();
        });
        panel.querySelector('#btn-spec-set-timbre').addEventListener('click', setAsTrackTimbre);

        panel.addEventListener('click', (e) => { if (e.target === panel) close(); });
    }

    // ==================== 开/关 ====================
    function open() {
        try {
            // 确保波形设计全局函数和振荡器数据始终存在
            if (!window._wdOscillators) {
                window._wdOscillators = [
                    {enabled:true, gain:0.7, detune:0, harmonics:new Float32Array(32)},
                    {enabled:false, gain:0.3, detune:7, harmonics:new Float32Array(32)}
                ];
                window._wdOscillators[0].harmonics[0] = 1.0;
            }
            if (typeof window.__wdPreview !== 'function') {
                window.__wdPreview = function() {
                    if (!window.AudioEngine || !window._wdOscillators) { console.warn('[WD] AudioEngine or _wdOscillators not ready'); return; }
                    try {
                        const ctx = window.AudioEngine.getCtx ? window.AudioEngine.getCtx() : new (window.AudioContext || window.webkitAudioContext)();
                        const dur = 0.5;
                        const now = ctx.currentTime;
                        window._wdOscillators.forEach(function(osc) {
                            if (!osc.enabled) return;
                            var oscNode = ctx.createOscillator();
                            var g = ctx.createGain();
                            g.gain.value = 0;
                            var N = Math.min(osc.harmonics.length, 32);
                            var real = new Float32Array(N + 1);
                            var imag = new Float32Array(N + 1);
                            real[0] = 0;
                            for (var i = 0; i < N; i++) imag[i + 1] = osc.harmonics[i] || 0;
                            try { oscNode.setPeriodicWave(ctx.createPeriodicWave(real, imag)); } catch(ex) { oscNode.type = 'sine'; }
                            oscNode.frequency.value = 440;
                            if (osc.detune) oscNode.detune.value = osc.detune;
                            g.gain.setValueAtTime(0.0001, now);
                            g.gain.linearRampToValueAtTime(osc.gain * 0.3, now + 0.02);
                            g.gain.setValueAtTime(osc.gain * 0.3, now + dur * 0.8);
                            g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
                            oscNode.connect(g); g.connect(ctx.destination);
                            oscNode.start(now); oscNode.stop(now + dur + 0.05);
                        });
                    } catch(e) { console.error('[WD] Preview error:', e); }
                };
            }
            if (typeof window.__wdApply !== 'function') {
                window.__wdApply = function() {
                    if (!window.Tracks || !window._wdOscillators) { console.warn('[WD] Tracks or _wdOscillators not ready'); return; }
                    try {
                        var track = window.Tracks.getSelectedTrack();
                        if (!track) { track = window.Tracks.addTrack('Wave', {waveform: 'sine'}); if (!track) { alert('创建轨道失败'); return; } window.Tracks.selectTrack(track.id); }
                        track.instrument.useCustomWave = true;
                        track.instrument.waveDesign = { oscillators: window._wdOscillators.map(function(o) { return Object.assign({}, o, {harmonics: Array.from(o.harmonics)}); }) };
                        var avg = new Float32Array(32);
                        window._wdOscillators.forEach(function(o) { if (!o.enabled) return; for (var i = 0; i < 32; i++) avg[i] += (o.harmonics[i] || 0) * o.gain; });
                        var maxA = 0; for (var i = 0; i < 32; i++) maxA = Math.max(maxA, Math.abs(avg[i]));
                        if (maxA > 0) for (var i = 0; i < 32; i++) avg[i] /= maxA;
                        track.instrument.timbre = Array.from(avg);
                        if (window.App && window.App.saveState) window.App.saveState();
                        alert('✅ 已应用波形设计到轨道「' + track.name + '」！');
                    } catch(e) { console.error('[WD] Apply error:', e); alert('应用失败: ' + e.message); }
                };
            }

            if (!panel) {
                console.warn('[SpectrogramDesigner] panel 不存在，重新创建');
                createPanel();
            }
            if (!panel) {
                console.error('[SpectrogramDesigner] 面板创建失败');
                return;
            }
            panel.style.display = 'flex';
            // 确保默认显示语谱图标签页
            panel.querySelectorAll('.spd-tab').forEach(t => t.classList.remove('active'));
            const specTab = panel.querySelector('.spd-tab[data-tab="spectrogram"]');
            if (specTab) specTab.classList.add('active');
            const specContent = panel.querySelector('#spd-tab-spectrogram');
            const waveContent = panel.querySelector('#spd-tab-wave');
            if (specContent) specContent.style.display = 'flex';
            if (waveContent) waveContent.style.display = 'none';
            // 确保波形设计按钮绑定（panel 存在后才绑定）
            const _previewBtn = panel.querySelector('#wd-preview-btn');
            const _applyBtn   = panel.querySelector('#wd-apply-btn');
            const _resetBtn   = panel.querySelector('#wd-reset-btn');
            if (_previewBtn) _previewBtn.onclick = function() {
                console.log('[WD-BTN] preview clicked via onclick property');
                if (typeof window.__wdPreview === 'function') window.__wdPreview();
                else console.warn('[WD-BTN] __wdPreview not defined yet');
            };
            if (_applyBtn) _applyBtn.onclick = function() {
                console.log('[WD-BTN] apply clicked via onclick property');
                if (typeof window.__wdApply === 'function') window.__wdApply();
                else console.warn('[WD-BTN] __wdApply not defined yet');
            };
            if (_resetBtn) _resetBtn.onclick = function() {
                console.log('[WD-BTN] reset clicked via onclick property');
                if (typeof window.__wdReset === 'function') window.__wdReset();
                else console.warn('[WD-BTN] __wdReset not defined yet');
            };
            renderFull();
            drawEnvCurve();
            scheduleWaveRefresh();
        } catch(e) {
            console.error('[SpectrogramDesigner] open() 错误:', e);
            // 不弹 alert（仅控制台输出，避免干扰用户）
        }
    }

    function close() {
        stopPreview();
        panel.style.display = 'none';
    }

    function isOpen() {
        return panel && panel.style.display !== 'none';
    }

    // ==================== 坐标转换 (语谱图) ====================
    function specPos(e) {
        const rect = specCanvas.getBoundingClientRect();
        const scaleX = CANVAS_W / rect.width;
        const scaleY = CANVAS_H / rect.height;
        return {
            x: Math.round((e.clientX - rect.left) * scaleX),
            y: Math.round((e.clientY - rect.top)  * scaleY)
        };
    }

    function pixelToFreq(y) {
        const t = 1 - Math.max(0, Math.min(1, y / CANVAS_H));
        return MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, t);
    }

    function freqToPixel(freq) {
        if (freq <= MIN_FREQ) return CANVAS_H;
        if (freq >= MAX_FREQ) return 0;
        const t = Math.log(freq / MIN_FREQ) / Math.log(MAX_FREQ / MIN_FREQ);
        return CANVAS_H * (1 - t);
    }

    function pixelToTime(x) {
        return Math.max(0, Math.min(duration, (x / CANVAS_W) * duration));
    }

    function timeToPixel(t) {
        return (t / duration) * CANVAS_W;
    }

    // ==================== 渲染: 语谱图 ====================
    function renderFull() {
        renderDataCanvas();
        renderGrid();
    }

    function renderDataCanvas() {
        const imgData = specCtx.createImageData(CANVAS_W, CANVAS_H);
        for (let i = 0; i < CANVAS_W * CANVAS_H; i++) {
            const c = colormap(ampData[i]);
            const off = i * 4;
            imgData.data[off]   = c.r;
            imgData.data[off+1] = c.g;
            imgData.data[off+2] = c.b;
            imgData.data[off+3] = 255;
        }
        specCtx.putImageData(imgData, 0, 0);
    }

    function renderGrid() {
        const g = gridCtx;
        g.clearRect(0, 0, CANVAS_W, CANVAS_H);

        const freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 18000];
        g.strokeStyle = 'rgba(255,255,255,0.08)';
        g.lineWidth = 1;
        g.setLineDash([2, 8]);
        freqs.forEach(f => {
            const y = freqToPixel(f);
            g.beginPath(); g.moveTo(0, y); g.lineTo(CANVAS_W, y); g.stroke();
        });

        const timeStep = duration <= 1 ? 0.1 : duration <= 3 ? 0.25 : 0.5;
        for (let t = 0; t <= duration; t += timeStep) {
            const x = timeToPixel(t);
            g.beginPath(); g.moveTo(x, 0); g.lineTo(x, CANVAS_H); g.stroke();
        }
        g.setLineDash([]);

        g.fillStyle = 'rgba(255,255,255,0.32)';
        g.font = '10px monospace';
        g.textAlign = 'right';
        freqs.forEach(f => {
            const y = freqToPixel(f);
            const label = f >= 1000 ? (f / 1000).toFixed(0) + 'k' : f.toString();
            g.fillText(label, CANVAS_W - 6, y - 3);
        });

        g.textAlign = 'center';
        for (let t = 0; t <= duration; t += timeStep) {
            const x = timeToPixel(t);
            g.fillText(t.toFixed(duration <= 1 ? 1 : 0) + 's', x, CANVAS_H - 4);
        }
    }

    // ==================== 绘制工具 ====================
    function paintCircle(cx, cy, radius, intensity, erase) {
        const r = Math.floor(radius);
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy > r * r) continue;
                const px = cx + dx, py = cy + dy;
                if (px < 0 || px >= CANVAS_W || py < 0 || py >= CANVAS_H) continue;
                const idx = py * CANVAS_W + px;
                const dist = Math.sqrt(dx * dx + dy * dy) / r;
                const falloff = Math.cos(dist * Math.PI / 2);
                if (erase) ampData[idx] = Math.max(0, ampData[idx] - intensity * falloff);
                else       ampData[idx] = Math.min(1, ampData[idx] + intensity * falloff);
            }
        }
    }

    function paintRect(x1, y1, x2, y2, intensity, erase) {
        const lx = Math.max(0, Math.min(CANVAS_W - 1, Math.min(x1, x2)));
        const rx = Math.max(0, Math.min(CANVAS_W - 1, Math.max(x1, x2)));
        const ty = Math.max(0, Math.min(CANVAS_H - 1, Math.min(y1, y2)));
        const by = Math.max(0, Math.min(CANVAS_H - 1, Math.max(y1, y2)));
        for (let y = ty; y <= by; y++) {
            for (let x = lx; x <= rx; x++) {
                const idx = y * CANVAS_W + x;
                if (erase) ampData[idx] = Math.max(0, ampData[idx] - intensity);
                else       ampData[idx] = Math.min(1, ampData[idx] + intensity);
            }
        }
    }

    function sprayNoise(cx, cy, radius, intensity) {
        const r = Math.floor(radius);
        const count = Math.floor(r * r * 0.3);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist  = Math.random() * r;
            const px = Math.round(cx + Math.cos(angle) * dist);
            const py = Math.round(cy + Math.sin(angle) * dist);
            if (px < 0 || px >= CANVAS_W || py < 0 || py >= CANVAS_H) continue;
            ampData[py * CANVAS_W + px] = Math.min(1, ampData[py * CANVAS_W + px] + Math.random() * intensity);
        }
    }

    function paintLine(x1, y1, x2, y2, radius, intensity, erase) {
        const dist = Math.hypot(x2 - x1, y2 - y1);
        const steps = Math.ceil(dist);
        for (let i = 0; i <= steps; i++) {
            const t = steps === 0 ? 0 : i / steps;
            paintCircle(
                Math.round(x1 + (x2 - x1) * t),
                Math.round(y1 + (y2 - y1) * t),
                radius, intensity * 0.6, erase
            );
        }
    }

    // ==================== 语谱图指针事件 ====================
    function onSpecPointerDown(e) {
        e.preventDefault();
        const pos = specPos(e);
        if (tool === 'line') {
            lineStart = pos;
        } else if (tool === 'rect') {
            rectStart = pos;
        } else {
            isDrawing = true;
            specCanvas.setPointerCapture(e.pointerId);
            applyTool(pos);
        }
    }

    function onSpecPointerMove(e) {
        const pos = specPos(e);
        if (!isDrawing && tool !== 'line' && tool !== 'rect') return;
        if (tool === 'line' || tool === 'rect') return;
        e.preventDefault();
        applyTool(pos);
    }

    function onSpecPointerUp(e) {
        const pos = specPos(e);
        if (tool === 'line' && lineStart) {
            paintLine(lineStart.x, lineStart.y, pos.x, pos.y, brushSize / 2, 0.6, false);
            lineStart = null;
            renderFull();
        } else if (tool === 'rect' && rectStart) {
            paintRect(rectStart.x, rectStart.y, pos.x, pos.y, 0.5, false);
            rectStart = null;
            renderFull();
        }
        isDrawing = false;
        scheduleWaveRefresh();
    }

    function applyTool(pos) {
        switch (tool) {
            case 'brush':  paintCircle(pos.x, pos.y, brushSize / 2, 0.4, false); break;
            case 'eraser': paintCircle(pos.x, pos.y, brushSize / 2, 0.6, true);  break;
            case 'noise':  sprayNoise(pos.x, pos.y, brushSize / 1.5, 0.7);        break;
        }
        renderFull();
    }

    function onSpecHover(e) {
        if (!isOpen()) return;
        const pos = specPos(e);
        const freq = pixelToFreq(pos.y);
        const time = pixelToTime(pos.x);
        const amp  = (pos.x >= 0 && pos.x < CANVAS_W && pos.y >= 0 && pos.y < CANVAS_H)
            ? ampData[pos.y * CANVAS_W + pos.x] : 0;
        const dB = amp > 0.001 ? (20 * Math.log10(amp)).toFixed(1) : '-∞';
        const elFreq = panel.querySelector('#spec-hud-freq');
        const elTime = panel.querySelector('#spec-hud-time');
        const elAmp  = panel.querySelector('#spec-hud-amp');
        if (elFreq) elFreq.textContent = freq >= 1000 ? (freq / 1000).toFixed(1) + ' kHz' : freq.toFixed(0) + ' Hz';
        if (elTime) elTime.textContent = time.toFixed(2) + ' s';
        if (elAmp)  elAmp.textContent  = dB + ' dB';
    }

    // ==================== 包络曲线 ====================

    /** 节点归一化坐标 → 画布像素 */
    function envNodeToCanvas(node) {
        return { x: node.x * ENV_W, y: (1 - node.y) * ENV_H };
    }

    /** 画布像素 → 节点归一化坐标 */
    function envCanvasToNode(cx, cy) {
        return {
            x: Math.max(0, Math.min(1, cx / ENV_W)),
            y: Math.max(0, Math.min(1, 1 - cy / ENV_H))
        };
    }

    /** 在时间 tx (0..1) 处对包络插值 */
    function sampleEnvelope(tx) {
        const nodes = envNodes;
        if (!nodes || nodes.length === 0) return 1;
        if (tx <= nodes[0].x) return nodes[0].y;
        if (tx >= nodes[nodes.length - 1].x) return nodes[nodes.length - 1].y;
        for (let i = 0; i < nodes.length - 1; i++) {
            if (tx >= nodes[i].x && tx <= nodes[i + 1].x) {
                const t = (tx - nodes[i].x) / (nodes[i + 1].x - nodes[i].x);
                // Catmull-Rom 平滑插值
                return nodes[i].y + t * (nodes[i + 1].y - nodes[i].y);
            }
        }
        return 1;
    }

    function drawEnvCurve() {
        const c = envCtx;
        const W = ENV_W, H = ENV_H;
        c.clearRect(0, 0, W, H);

        // 背景
        c.fillStyle = '#0e1018';
        c.fillRect(0, 0, W, H);

        // 网格
        c.strokeStyle = 'rgba(255,255,255,0.05)';
        c.lineWidth = 1;
        c.setLineDash([2, 6]);
        for (let i = 1; i < 4; i++) {
            const y = i * H / 4;
            c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
        }
        const timeStep = duration <= 2 ? 0.5 : duration <= 4 ? 1 : 1.5;
        for (let t = timeStep; t < duration; t += timeStep) {
            const x = (t / duration) * W;
            c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
        }
        c.setLineDash([]);

        // 包络曲线填充
        c.beginPath();
        c.moveTo(envNodeToCanvas(envNodes[0]).x, H);
        envNodes.forEach(node => {
            const pt = envNodeToCanvas(node);
            c.lineTo(pt.x, pt.y);
        });
        c.lineTo(envNodeToCanvas(envNodes[envNodes.length - 1]).x, H);
        c.closePath();
        const grad = c.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, 'rgba(0,188,212,0.35)');
        grad.addColorStop(1, 'rgba(0,188,212,0.05)');
        c.fillStyle = grad;
        c.fill();

        // 包络曲线线条
        c.beginPath();
        envNodes.forEach((node, i) => {
            const pt = envNodeToCanvas(node);
            if (i === 0) c.moveTo(pt.x, pt.y);
            else c.lineTo(pt.x, pt.y);
        });
        c.strokeStyle = '#00bcd4';
        c.lineWidth = 2;
        c.shadowColor = '#00bcd4';
        c.shadowBlur = 6;
        c.stroke();
        c.shadowBlur = 0;

        // 控制点
        envNodes.forEach((node, i) => {
            const pt = envNodeToCanvas(node);
            const isEnd = i === 0 || i === envNodes.length - 1;

            // 控制点圆
            c.beginPath();
            c.arc(pt.x, pt.y, isEnd ? 5 : 7, 0, Math.PI * 2);
            c.fillStyle = '#ffffff';
            c.fill();
            c.strokeStyle = '#00bcd4';
            c.lineWidth = 2;
            c.stroke();

            // 内部填充
            c.beginPath();
            c.arc(pt.x, pt.y, isEnd ? 2 : 4, 0, Math.PI * 2);
            c.fillStyle = '#00bcd4';
            c.fill();

            // 数值标签（悬停时显示，这里常驻显示关键值）
            if (!isEnd) {
                c.fillStyle = 'rgba(255,255,255,0.5)';
                c.font = '9px monospace';
                c.textAlign = 'center';
                const pct = Math.round(node.y * 100);
                const sec = (node.x * duration).toFixed(2);
                c.fillText(pct + '%', pt.x, pt.y - 10);
                c.fillText(sec + 's', pt.x, pt.y + 18);
            }
        });
    }

    // --- 包络节点命中检测 ---
    function envHitTest(pos) {
        for (let i = 0; i < envNodes.length; i++) {
            const pt = envNodeToCanvas(envNodes[i]);
            const r = (i === 0 || i === envNodes.length - 1) ? 8 : 10;
            if (Math.hypot(pos.x - pt.x, pos.y - pt.y) < r) return i;
        }
        return -1;
    }

    function envPos(e) {
        const rect = envCanvas.getBoundingClientRect();
        const scaleX = ENV_W / rect.width;
        const scaleY = ENV_H / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top)  * scaleY
        };
    }

    function onEnvPointerDown(e) {
        e.preventDefault();
        const pos = envPos(e);
        const hitIdx = envHitTest(pos);
        if (hitIdx >= 0) {
            envDragging = hitIdx;
            envCanvas.setPointerCapture(e.pointerId);
        }
    }

    function onEnvPointerMove(e) {
        if (envDragging === null) return;
        e.preventDefault();
        const pos = envPos(e);
        const norm = envCanvasToNode(pos.x, pos.y);
        const node = envNodes[envDragging];
        const isFirst = envDragging === 0;
        const isLast  = envDragging === envNodes.length - 1;

        // 端点锁定 x；内部节点只允许在相邻节点间移动
        if (isFirst || isLast) {
            node.y = norm.y;
        } else {
            const prevX = envNodes[envDragging - 1].x;
            const nextX = envNodes[envDragging + 1].x;
            node.x = Math.max(prevX + 0.01, Math.min(nextX - 0.01, norm.x));
            node.y = norm.y;
        }

        drawEnvCurve();
        buildEnvXLabels();
        scheduleWaveRefresh();
    }

    function onEnvPointerUp(e) {
        envDragging = null;
    }

    function onEnvDblClick(e) {
        const pos = envPos(e);
        const norm = envCanvasToNode(pos.x, pos.y);
        // 找插入位置
        let insertIdx = envNodes.length - 1;
        for (let i = 0; i < envNodes.length - 1; i++) {
            if (norm.x >= envNodes[i].x && norm.x <= envNodes[i + 1].x) {
                insertIdx = i + 1;
                break;
            }
        }
        envNodes.splice(insertIdx, 0, { x: norm.x, y: norm.y });
        drawEnvCurve();
        scheduleWaveRefresh();
    }

    function onEnvContextMenu(e) {
        e.preventDefault();
        const pos = envPos(e);
        const hitIdx = envHitTest(pos);
        if (hitIdx > 0 && hitIdx < envNodes.length - 1) {
            envNodes.splice(hitIdx, 1);
            drawEnvCurve();
            scheduleWaveRefresh();
        }
    }

    // ==================== 波形预览 ====================
    let waveRefreshTimer = null;
    function scheduleWaveRefresh() {
        if (!isOpen()) return;
        clearTimeout(waveRefreshTimer);
        waveRefreshTimer = setTimeout(() => {
            drawWavePreview();
        }, 400); // 延迟 400ms 防止频繁重绘
    }

    function drawWavePreview() {
        const c = waveCtx;
        const W = WAVE_W, H = WAVE_H;

        // 检查是否有内容
        let hasContent = false;
        for (let i = 0; i < ampData.length; i++) {
            if (ampData[i] > 0.002) { hasContent = true; break; }
        }

        c.fillStyle = '#0e1018';
        c.fillRect(0, 0, W, H);

        if (!hasContent) {
            c.fillStyle = 'rgba(255,255,255,0.15)';
            c.font = '11px monospace';
            c.textAlign = 'center';
            c.fillText('绘制语谱图后', W / 2, H / 2 - 8);
            c.fillText('显示波形', W / 2, H / 2 + 8);
            return;
        }

        // 快速采样波形（轻量级，不做完整合成）
        const numSamples = Math.floor(duration * SAMPLE_RATE);
        const wavePoints = new Float32Array(W);
        const hopW = Math.floor(numSamples / W);

        // 用语谱图的频率内容估算波形包络
        for (let px = 0; px < W; px++) {
            const col = Math.floor((px / W) * CANVAS_W);
            // 在该时间列求加权振幅（模拟包络）
            let sumAmp = 0, totalWeight = 0;
            for (let row = 0; row < CANVAS_H; row++) {
                const a = ampData[row * CANVAS_W + col];
                if (a > 0.002) {
                    // 低频权重更大（更接近波形特征）
                    const weight = 1 - row / CANVAS_H * 0.5;
                    sumAmp += a * weight;
                    totalWeight += weight;
                }
            }
            const colAmp = totalWeight > 0 ? sumAmp / totalWeight : 0;
            // 应用包络
            const envAmp = sampleEnvelope(px / W);
            wavePoints[px] = colAmp * envAmp;
        }

        // 归一化
        let maxWave = 0;
        for (let i = 0; i < W; i++) if (wavePoints[i] > maxWave) maxWave = wavePoints[i];
        if (maxWave < 0.001) {
            c.fillStyle = 'rgba(255,255,255,0.15)';
            c.font = '10px monospace';
            c.textAlign = 'center';
            c.fillText('无有效内容', W / 2, H / 2);
            return;
        }

        // 网格
        c.strokeStyle = 'rgba(255,255,255,0.06)';
        c.lineWidth = 1;
        c.setLineDash([2, 6]);
        for (let i = 1; i < 4; i++) {
            const x = i * W / 4;
            c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
        }
        c.setLineDash([]);

        // 中线
        const mid = H / 2;
        c.strokeStyle = 'rgba(255,255,255,0.08)';
        c.beginPath(); c.moveTo(0, mid); c.lineTo(W, mid); c.stroke();

        // 波形（上下对称）
        const grad = c.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, 'rgba(124,77,255,0.9)');
        grad.addColorStop(0.5, 'rgba(0,188,212,0.95)');
        grad.addColorStop(1, 'rgba(124,77,255,0.9)');

        c.fillStyle = grad;
        c.beginPath();
        c.moveTo(0, mid);
        for (let px = 0; px < W; px++) {
            const amp = wavePoints[px] / maxWave;
            const halfH = amp * (H / 2 - 4);
            c.lineTo(px, mid - halfH);
        }
        for (let px = W - 1; px >= 0; px--) {
            const amp = wavePoints[px] / maxWave;
            const halfH = amp * (H / 2 - 4);
            c.lineTo(px, mid + halfH);
        }
        c.closePath();
        c.fill();

        // 外轮廓线
        c.strokeStyle = 'rgba(0,188,212,0.8)';
        c.lineWidth = 1.5;
        c.beginPath();
        for (let px = 0; px < W; px++) {
            const amp = wavePoints[px] / maxWave;
            const y = mid - amp * (H / 2 - 4);
            if (px === 0) c.moveTo(px, y); else c.lineTo(px, y);
        }
        c.stroke();
        c.beginPath();
        for (let px = 0; px < W; px++) {
            const amp = wavePoints[px] / maxWave;
            const y = mid + amp * (H / 2 - 4);
            if (px === 0) c.moveTo(px, y); else c.lineTo(px, y);
        }
        c.stroke();

        // 时间标签
        c.fillStyle = 'rgba(255,255,255,0.25)';
        c.font = '9px monospace';
        c.textAlign = 'center';
        const step = duration <= 2 ? 0.5 : 1;
        for (let t = 0; t <= duration; t += step) {
            const x = (t / duration) * W;
            c.fillText(t.toFixed(1) + 's', x, H - 3);
        }
    }

    // ==================== 音频合成 ====================
    function synthesize() {
        const numSamples = Math.floor(duration * SAMPLE_RATE);
        const output = new Float32Array(numSamples);

        const hann = new Float32Array(FRAME_SIZE);
        for (let i = 0; i < FRAME_SIZE; i++) {
            hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FRAME_SIZE - 1)));
        }

        const numFrames = Math.ceil(numSamples / HOP_SIZE);

        for (let frame = 0; frame < numFrames; frame++) {
            const t = frame * HOP_SIZE / SAMPLE_RATE;
            const col = Math.floor((t / duration) * CANVAS_W);
            if (col >= CANVAS_W) break;

            const partials = [];
            const bandHeight = CANVAS_H / FREQ_BANDS;

            for (let band = 0; band < FREQ_BANDS; band++) {
                const y0 = Math.floor(band * bandHeight);
                const y1 = Math.floor((band + 1) * bandHeight);
                let sum = 0, count = 0;
                for (let y = y0; y < y1; y++) {
                    sum += ampData[y * CANVAS_W + col];
                    count++;
                }
                const amp = sum / count;
                if (amp > 0.002) {
                    const yMid = (y0 + y1) / 2;
                    const freq = pixelToFreq(yMid);
                    partials.push({ freq, amp });
                }
            }

            // 应用包络
            const envAmp = sampleEnvelope(t / duration);

            for (let i = 0; i < FRAME_SIZE; i++) {
                const globalIdx = frame * HOP_SIZE + i;
                if (globalIdx >= numSamples) break;
                let sample = 0;
                const sampleTime = globalIdx / SAMPLE_RATE;
                for (const p of partials) {
                    sample += p.amp * Math.sin(2 * Math.PI * p.freq * sampleTime);
                }
                const normFactor = Math.max(1, partials.length);
                output[globalIdx] += hann[i] * sample / normFactor * envAmp;
            }
        }

        let peak = 0;
        for (let i = 0; i < output.length; i++) {
            if (Math.abs(output[i]) > peak) peak = Math.abs(output[i]);
        }
        if (peak > 0.001) {
            const scale = 0.85 / peak;
            for (let i = 0; i < output.length; i++) output[i] *= scale;
        }

        return output;
    }

    function samplesToAudioBuffer(samples) {
        const ctx = getAudioCtx();
        const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
        buffer.copyToChannel(samples, 0);
        return buffer;
    }

    // ==================== 预览播放 ====================
    function preview() {
        // 诊断 ampData
        let dnz = 0;
        if (ampData) for (let i = 0; i < ampData.length; i++) if (ampData[i] > 0.002) dnz++;
        console.log("[Preview] ampData nonZero:", dnz);

        stopPreview();
        const samples = synthesize();
        let _pk = 0;
        for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > _pk) _pk = a; }
        console.log("[Preview] peak:", _pk.toFixed(6));

        if (samples.length === 0) { showToast("语谱图为空，请先绘制内容"); return; }
        if (_pk < 0.001) { showToast("⚠️ 语谱图为空！请先在画布上绘制内容。"); return; }

        const ctx = getAudioCtx();
        const buffer = samplesToAudioBuffer(samples);
        currentSource = ctx.createBufferSource();
        currentSource.buffer = buffer;
        currentSource.connect(ctx.destination);
        currentSource.onended = () => { previewing = false; updatePlayButtons(false); };
        currentSource.start();
        previewing = true;
        updatePlayButtons(true);
        drawWavePreview();
    }

    function stopPreview() {
        if (currentSource) {
            try { currentSource.stop(); } catch (e) {}
            currentSource = null;
        }
        previewing = false;
        updatePlayButtons(false);
    }

    function updatePlayButtons(playing) {
        const previewBtn = panel.querySelector('#btn-spec-preview');
        const stopBtn    = panel.querySelector('#btn-spec-stop');
        if (previewBtn) previewBtn.textContent = playing ? '⏸ 暂停' : '▶ 预览试音';
        if (stopBtn)    stopBtn.disabled = !playing;
    }

    // ==================== WAV 导出 ====================
    function exportWAV() {
        alert("[DEBUG] exportWAV 被调用! 如果看到此弹窗，说明新代码已生效。");
        // ===== 调试模式：无论什么情况都导出测试音 =====
        // 先检查 ampData
        let info = { ampDataNull: ampData === null, ampDataLen: ampData ? ampData.length : 0 };
        if (ampData) {
            let nz = 0, mx = 0;
            for (let i = 0; i < ampData.length; i++) {
                if (ampData[i] > 0.001) nz++;
                if (ampData[i] > mx) mx = ampData[i];
            }
            info.nonZero = nz; info.max = mx;
        }
        console.log("[Export] ampData info:", info);

        // 方式1: 直接合成
        const samples = synthesize();
        let pk = 0;
        for (let i = 0; i < samples.length; i++) {
            const a = Math.abs(samples[i]);
            if (a > pk) pk = a;
        }
        console.log("[Export] synthesize peak:", pk);

        // 如果合成结果是静音，用纯正弦波代替（调试）
        let finalSamples = samples;
        if (pk < 0.001) {
            console.warn("[Export] synthesize returned silence, using fallback sine wave");
            const sr = SAMPLE_RATE;
            const dur = 2.0;
            finalSamples = new Float32Array(Math.floor(dur * sr));
            for (let i = 0; i < finalSamples.length; i++) {
                finalSamples[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
            }
            showToast("⚠️ 合成结果为静音，已导出440Hz测试音（调试）");
        }

        const wavBlob = encodeMonoWav(finalSamples, SAMPLE_RATE);
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement("a");
        a.href = url; a.download = "export_" + Date.now() + ".wav";
        document.body.appendChild(a); a.click();
        setTimeout(() => { try { document.body.removeChild(a); } catch(e) {} }, 100);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        showToast("✅ 已导出 WAV (峰值:" + pk.toFixed(3) + ")");
    }

    // ==================== 测试音导出（纯正弦波，验证 WAV 编码）====================
    function exportTestTone() {
        try {
            const sr = SAMPLE_RATE;
            const dur = 2.0;
            const freq = 440;
            const numSamples = Math.floor(dur * sr);
            const samples = new Float32Array(numSamples);
            for (let i = 0; i < numSamples; i++) {
                samples[i] = 0.5 * Math.sin(2 * Math.PI * freq * i / sr);
            }
            const wavBlob = encodeMonoWav(samples, sr);
            const url = URL.createObjectURL(wavBlob);
            const a = document.createElement("a");
            a.href = url; a.download = "test_tone_440Hz.wav";
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            if (typeof showToast === 'function') showToast("✅ 已导出测试音 test_tone_440Hz.wav");
        } catch(e) {
            console.error('[exportTestTone] Error:', e);
            if (typeof showToast === 'function') showToast('❌ 测试音导出失败: ' + e.message);
        }
    }

function encodeMonoWav(samples, sampleRate) {
        const dataLen = samples.length * 2;
        const buf = new ArrayBuffer(44 + dataLen);
        const v = new DataView(buf);
        function w(off, str) { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); }
        w(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); w(8, 'WAVE');
        w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
        v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
        v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        w(36, 'data'); v.setUint32(40, dataLen, true);
        let off = 44;
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            off += 2;
        }
        return new Blob([buf], { type: 'audio/wav' });
    }

    // ==================== 清空 ====================
    function clearCanvas() {
        resetAmpData();
        renderFull();
        drawWavePreview();
    }

    // ==================== 导入轨道音效 ====================
    function importFromTrack() {
        if (!window.Tracks) { showToast('无法访问轨道数据'); return; }
        const track = window.Tracks.getSelectedTrack();
        if (!track || !track.notes || track.notes.length === 0) {
            showToast('请先选中一个包含音符的轨道'); return;
        }

        resetAmpData();
        track.notes.forEach(note => {
            const freq = 440 * Math.pow(2, (note.pitch - 69) / 12);
            const y = freqToPixel(freq);
            const x0 = timeToPixel(note.beat * (60 / 120));
            const x1 = timeToPixel((note.beat + note.duration) * (60 / 120));
            for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
                if (x < 0 || x >= CANVAS_W) continue;
                paintCircle(x, Math.round(y), 4, 0.7, false);
            }
        });

        let maxBeat = 0;
        track.notes.forEach(n => { maxBeat = Math.max(maxBeat, n.beat + n.duration); });
        duration = Math.max(0.5, Math.min(6, maxBeat * (60 / 120)));
        panel.querySelector('#spec-duration').value = duration;
        panel.querySelector('#spec-duration-display').textContent = duration.toFixed(1) + 's';
        buildEnvXLabels();
        renderFull();
        drawEnvCurve();
        scheduleWaveRefresh();
        showToast('已导入轨道音符 → 编辑后点击「设为轨道音色」');
    }

    // ==================== 设为轨道音色 ====================
    function setAsTrackTimbre() {
        if (!window.Tracks) { showToast('无法访问轨道数据'); return; }
        let track = window.Tracks.getSelectedTrack();
        // 若无选中轨道，自动创建一条新轨道
        if (!track) {
            track = window.Tracks.addTrack('Spectrogram', { waveform: 'sawtooth' });
            if (!track) { showToast('创建轨道失败'); return; }
            window.Tracks.selectTrack(track.id);
        }

        let hasContent = false;
        for (let i = 0; i < ampData.length; i++) {
            if (ampData[i] > 0.002) { hasContent = true; break; }
        }
        if (!hasContent) { showToast('语谱图为空，请先绘制内容'); return; }

        // 构建 ADSR 数据（从包络节点提取）
        const envA = buildADSRFromEnv();

        // 深拷贝语谱图数据
        const spectrogramData = {
            ampData:    new Float32Array(ampData),
            canvasW:    CANVAS_W,
            canvasH:    CANVAS_H,
            duration:   duration,
            minFreq:    MIN_FREQ,
            maxFreq:    MAX_FREQ,
            sampleRate: SAMPLE_RATE,
            envNodes:   envNodes.map(n => ({ ...n })) // 存储包络节点
        };

        // 计算平均频谱（向后兼容）
        const avgSpectrum = new Float32Array(32);
        const colStep = Math.floor(CANVAS_W / 32);
        for (let i = 0; i < 32; i++) {
            let sum = 0, count = 0;
            for (let col = i * colStep; col < Math.min((i + 1) * colStep, CANVAS_W); col++) {
                for (let row = 0; row < CANVAS_H; row++) { sum += ampData[row * CANVAS_W + col]; count++; }
            }
            avgSpectrum[i] = count > 0 ? sum / count : 0;
        }
        let maxA = 0;
        for (let i = 0; i < 32; i++) if (avgSpectrum[i] > maxA) maxA = avgSpectrum[i];
        if (maxA > 0) for (let i = 0; i < 32; i++) avgSpectrum[i] /= maxA;

        track.instrument.spectrogramData = spectrogramData;
        track.instrument.timbreMode = 'spectrogram';
        track.instrument.timbre = Array.from(avgSpectrum);
        track.instrument.adsr = envA;

        if (window.AudioEngine && window.AudioEngine.buildSpectrogramBuffer) {
            window.AudioEngine.buildSpectrogramBuffer(track.id, spectrogramData);
        }
        if (window.Tracks.updatePropertiesPanel) {
            window.Tracks.updatePropertiesPanel(track);
        }

        showToast('✓ 已设为「' + track.name + '」的音色');
        // 同时保存波形设计数据（如果有的话）
        if (window._wdOscillators) {
            track.instrument.useCustomWave = true;
            track.instrument.waveDesign = { oscillators: window._wdOscillators.map(o => ({...o, harmonics: Array.from(o.harmonics)})) };
        }
    }

    /** 从包络节点计算 ADSR 参数 */
    function buildADSRFromEnv() {
        const nodes = envNodes;
        if (nodes.length < 2) return { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 };

        // 找峰值节点（最大 y）
        let peakIdx = 0;
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].y >= nodes[peakIdx].y) peakIdx = i;
        }

        const attack  = nodes[peakIdx].x * duration;
        // 持续电平（峰值后第一段相对平稳的 y 值）
        let sustain = 0.7;
        if (peakIdx + 1 < nodes.length - 1) {
            sustain = Math.max(0, Math.min(1, nodes[peakIdx + 1].y));
        }
        // 衰减 = 峰值→持续段时间
        const decayEndIdx = Math.min(peakIdx + 1, nodes.length - 1);
        const decay = Math.max(0.001, (nodes[decayEndIdx].x - nodes[peakIdx].x) * duration);
        // 释音 = 持续段结束→末尾
        const releaseStartIdx = nodes.length - 2;
        const release = Math.max(0.001, (nodes[nodes.length - 1].x - nodes[releaseStartIdx].x) * duration);

        return {
            attack:  Math.max(0.001, attack),
            decay:   Math.max(0.001, decay),
            sustain: Math.max(0.01, sustain),
            release: Math.max(0.001, release)
        };
    }

    // ==================== 包络预设 ====================
    function applyEnvPreset(type) {
        switch (type) {
            case 'piano':
                envNodes = [
                    { x: 0,    y: 0 },
                    { x: 0.01, y: 1 },
                    { x: 0.12, y: 0.4 },
                    { x: 0.75, y: 0.4 },
                    { x: 1,    y: 0 }
                ];
                break;
            case 'pluck':
                envNodes = [
                    { x: 0,    y: 0 },
                    { x: 0.005, y: 1 },
                    { x: 0.25, y: 0.15 },
                    { x: 0.6,  y: 0.05 },
                    { x: 1,    y: 0 }
                ];
                break;
            case 'pad':
                envNodes = [
                    { x: 0,    y: 0 },
                    { x: 0.3,  y: 0.9 },
                    { x: 0.5,  y: 0.85 },
                    { x: 0.75, y: 0.85 },
                    { x: 1,    y: 0 }
                ];
                break;
            case 'perc':
                envNodes = [
                    { x: 0,    y: 0 },
                    { x: 0.005, y: 1 },
                    { x: 0.08, y: 0.5 },
                    { x: 0.25, y: 0.1 },
                    { x: 1,    y: 0 }
                ];
                break;
        }
        drawEnvCurve();
        buildEnvXLabels();
        scheduleWaveRefresh();
        showToast('已应用包络预设: ' + type);
    }

    // ==================== 语谱图预设 ====================
    function applySpecPreset(type) {
        resetAmpData();
        const W = CANVAS_W, H = CANVAS_H;

        switch (type) {
            case 'sweep-up':
                for (let x = 0; x < W; x++) {
                    const t = x / W;
                    const freq = MIN_FREQ + (MAX_FREQ - MIN_FREQ) * t;
                    paintCircle(x, Math.round(freqToPixel(freq)), 5, 0.6, false);
                }
                break;
            case 'sweep-down':
                for (let x = 0; x < W; x++) {
                    const t = x / W;
                    const freq = MAX_FREQ - (MAX_FREQ - MIN_FREQ) * t;
                    paintCircle(x, Math.round(freqToPixel(freq)), 5, 0.6, false);
                }
                break;
            case 'noise-burst':
                for (let x = Math.floor(W * 0.1); x < Math.floor(W * 0.45); x++) {
                    for (let y = Math.floor(H * 0.15); y < Math.floor(H * 0.85); y++) {
                        if (Math.random() < 0.22) ampData[y * W + x] = Math.min(1, Math.random() * 0.7);
                    }
                }
                for (let x = Math.floor(W * 0.45); x < W; x++) {
                    const fade = 1 - (x - W * 0.45) / (W * 0.55);
                    for (let y = Math.floor(H * 0.15); y < Math.floor(H * 0.85); y++) {
                        if (Math.random() < 0.1 * fade) ampData[y * W + x] = Math.min(1, Math.random() * 0.5 * fade);
                    }
                }
                break;
            case 'harmonic':
                const fundamental = 220;
                for (let h = 1; h <= 8; h++) {
                    const freq = fundamental * h;
                    if (freq > MAX_FREQ) break;
                    const y = freqToPixel(freq);
                    const amp = 1 / h;
                    for (let x = 0; x < W; x++) {
                        const t = x / W;
                        const env = t < 0.05 ? t / 0.05 : t < 0.15 ? 1 - (t - 0.05) * 3 : t < 0.8 ? 0.4 : (1 - t) / 0.2 * 0.4;
                        const idx = Math.round(y) * W + x;
                        if (idx >= 0 && idx < W * H) ampData[idx] = Math.min(1, ampData[idx] + amp * env * 0.6);
                    }
                }
                break;
            case 'percussive':
                for (let x = 0; x < Math.floor(W * 0.2); x++) {
                    const env = 1 - x / (W * 0.2);
                    for (let y = Math.floor(H * 0.55); y < Math.floor(H * 0.95); y++) {
                        if (Math.random() < 0.45 * env) ampData[y * W + x] = Math.min(1, Math.random() * 0.8 * env);
                    }
                }
                for (let x = 0; x < Math.floor(W * 0.04); x++) {
                    for (let y = Math.floor(H * 0.1); y < Math.floor(H * 0.3); y++) {
                        if (Math.random() < 0.25) ampData[y * W + x] = Math.min(1, Math.random() * 0.5);
                    }
                }
                break;
            case 'chirp':
                for (let x = 0; x < W; x++) {
                    const t = x / W;
                    const freq = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, t * t * 1.5);
                    const env = Math.sin(t * Math.PI) * 0.7;
                    paintCircle(x, Math.round(freqToPixel(freq)), 4, env, false);
                }
                break;
        }

        renderFull();
        scheduleWaveRefresh();
        showToast('已应用预设: ' + type);
    }

    // ==================== 频率/时间标签 ====================
    function buildFreqLabels() {
        const el = panel.querySelector('#spd-freq-labels');
        if (!el) return;
        const freqs = [18000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20];
        el.innerHTML = freqs.map(f => {
            const pct = (1 - Math.log(f / MIN_FREQ) / Math.log(MAX_FREQ / MIN_FREQ)) * 100;
            const label = f >= 1000 ? (f / 1000).toFixed(0) + 'k' : f;
            return `<span style="top:${pct}%">${label}</span>`;
        }).join('');
    }

    function buildEnvXLabels() {
        const el = panel.querySelector('#spd-env-xlabels');
        if (!el) return;
        const step = duration <= 2 ? 0.5 : duration <= 4 ? 1 : 1.5;
        let html = '';
        for (let t = 0; t <= duration; t += step) {
            const pct = (t / duration) * 100;
            html += `<span style="left:${pct}%">${t.toFixed(1)}s</span>`;
        }
        el.innerHTML = html;
    }

    // ==================== Toast ====================
    function showToast(msg) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();
        const el = document.createElement('div');
        el.className = 'toast'; el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2500);
    }

    // ==================== 导出 ====================
    
    // ==================== 波形设计 WAV 导出 ====================
    window.__wdExportWAV = function() {
        if (!window._wdOscillators) { showToast("请先设计波形"); return; }
        try {
            const duration = 2.0;
            const sr = SAMPLE_RATE;
            const ctx = new OfflineAudioContext(1, Math.floor(duration * sr), sr);
            const now = 0;

            window._wdOscillators.forEach(function(osc) {
                if (!osc.enabled) return;
                var oscNode = ctx.createOscillator();
                var g = ctx.createGain();
                g.gain.value = 0;
                var N = Math.min(osc.harmonics.length, 32);
                var real = new Float32Array(N + 1);
                var imag = new Float32Array(N + 1);
                real[0] = 0;
                for (var i = 0; i < N; i++) imag[i + 1] = osc.harmonics[i] || 0;
                try { oscNode.setPeriodicWave(ctx.createPeriodicWave(real, imag)); } catch(ex) { oscNode.type = "sine"; }
                oscNode.frequency.value = 440;
                if (osc.detune) oscNode.detune.value = osc.detune;
                g.gain.setValueAtTime(0.0001, now);
                g.gain.linearRampToValueAtTime(osc.gain * 0.3, now + 0.02);
                g.gain.setValueAtTime(osc.gain * 0.3, now + duration * 0.8);
                g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
                oscNode.connect(g); g.connect(ctx.destination);
                oscNode.start(now); oscNode.stop(now + duration + 0.05);
            });

            ctx.startRendering().then(function(buffer) {
                const samples = buffer.getChannelData(0);
                const wavBlob = encodeMonoWav(samples, sr);
                const url = URL.createObjectURL(wavBlob);
                const a = document.createElement("a");
                a.href = url; a.download = "wave_design.wav";
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                showToast("已导出 wave_design.wav");
            }).catch(function(e) {
                console.error("[WD] Export WAV error:", e);
                showToast("导出失败: " + e.message);
            });
        } catch(e) {
            console.error("[WD] Export WAV error:", e);
            showToast("导出失败: " + e.message);
        }
    };

    return { init, open, close, isOpen };

})();
