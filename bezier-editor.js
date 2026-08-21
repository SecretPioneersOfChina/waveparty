/**
 * WaveParty Bezier Editor
 * 支持多条曲线（timbre / attack / decay / sustain / release）的交互式贝塞尔编辑器
 * - 拖拽控制点
 * - 双击添加节点
 * - 右键删除节点
 * - 贝塞尔曲线采样
 * - ADSR 合并预览
 */

window.BezierEditor = (function () {
    'use strict';

    const CANVAS_W = 600;
    const CANVAS_H = 360;
    const POINT_RADIUS = 8;
    const CTRL_RADIUS = 5;
    const GRID_COLOR = 'rgba(255,255,255,0.05)';
    const CURVE_COLORS = {
        timbre:  '#7c4dff',
        attack:  '#00bcd4',
        decay:   '#ffb300',
        sustain: '#4caf50',
        release: '#ff4081'
    };

    // Each curve: array of { x, y, cp1x, cp1y, cp2x, cp2y }
    // x,y in [0,1] normalized
    const curves = {
        timbre:  null,
        attack:  null,
        decay:   null,
        sustain: null,
        release: null
    };

    // ADSR values in seconds/percent
    const adsr = {
        attack:  0.05,
        decay:   0.1,
        sustain: 0.7,
        release: 0.2
    };

    let currentCurve = 'timbre';
    let canvas = null;
    let ctx2d = null;
    let previewCanvas = null;
    let previewCtx = null;
    let dpr = window.devicePixelRatio || 1;

    // Drag state
    let dragging = null; // { pointIndex, type: 'anchor'|'cp1'|'cp2' }
    let lastPointer = null;

    function init() {
        canvas = document.getElementById('bezier-canvas');
        ctx2d = canvas.getContext('2d');
        previewCanvas = document.getElementById('adsr-preview-canvas');
        previewCtx = previewCanvas.getContext('2d');

        // Init default curves
        Object.keys(curves).forEach(k => {
            curves[k] = getDefaultCurve(k);
        });

        resizeCanvas();
        bindEvents();
        draw();
        drawADSRPreview();
        bindUI();
    }

    function resizeCanvas() {
        const rect = canvas.parentElement.getBoundingClientRect();
        const w = Math.min(CANVAS_W, rect.width - 20);
        const h = CANVAS_H;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx2d.scale(dpr, dpr);
        // canvas logical size
        canvas._logW = w;
        canvas._logH = h;
    }

    function getDefaultCurve(type) {
        switch (type) {
            case 'timbre':
                return [
                    { x: 0, y: 0.2,  cp1x: 0.1,  cp1y: 0.8,  cp2x: 0.3, cp2y: 0.8 },
                    { x: 0.4, y: 0.7, cp1x: 0.5, cp1y: 0.9, cp2x: 0.6, cp2y: 0.5 },
                    { x: 0.7, y: 0.4, cp1x: 0.8, cp1y: 0.3, cp2x: 0.9, cp2y: 0.1 },
                    { x: 1,   y: 0.1, cp1x: 1,    cp1y: 0.05, cp2x: 1,  cp2y: 0.05 }
                ];
            case 'attack':
                return [
                    { x: 0, y: 0, cp1x: 0, cp1y: 0, cp2x: 0.3, cp2y: 0 },
                    { x: 1, y: 1, cp1x: 0.7, cp1y: 1, cp2x: 1, cp2y: 1 }
                ];
            case 'decay':
                return [
                    { x: 0, y: 1, cp1x: 0, cp1y: 1, cp2x: 0.4, cp2y: 1 },
                    { x: 1, y: 0.3, cp1x: 0.6, cp1y: 0.3, cp2x: 1, cp2y: 0.3 }
                ];
            case 'sustain':
                return [
                    { x: 0, y: 0.7, cp1x: 0, cp1y: 0.7, cp2x: 0.5, cp2y: 0.7 },
                    { x: 1, y: 0.7, cp1x: 0.5, cp1y: 0.7, cp2x: 1, cp2y: 0.7 }
                ];
            case 'release':
                return [
                    { x: 0, y: 0.7, cp1x: 0, cp1y: 0.7, cp2x: 0.5, cp2y: 0 },
                    { x: 1, y: 0, cp1x: 0.5, cp1y: 0, cp2x: 1, cp2y: 0 }
                ];
        }
    }

    function toCanvas(nx, ny) {
        const W = canvas._logW || CANVAS_W;
        const H = canvas._logH || CANVAS_H;
        return { x: nx * W, y: (1 - ny) * H };
    }

    function fromCanvas(cx, cy) {
        const W = canvas._logW || CANVAS_W;
        const H = canvas._logH || CANVAS_H;
        return { x: Math.max(0, Math.min(1, cx / W)), y: Math.max(0, Math.min(1, 1 - cy / H)) };
    }

    function draw() {
        if (!canvas || !ctx2d) return;
        const W = canvas._logW || CANVAS_W;
        const H = canvas._logH || CANVAS_H;
        const c = ctx2d;

        c.clearRect(0, 0, W, H);

        // Background
        c.fillStyle = '#0e1018';
        c.fillRect(0, 0, W, H);

        // Grid
        c.strokeStyle = GRID_COLOR;
        c.lineWidth = 1;
        for (let i = 1; i < 10; i++) {
            c.beginPath(); c.moveTo(i * W / 10, 0); c.lineTo(i * W / 10, H); c.stroke();
            c.beginPath(); c.moveTo(0, i * H / 10); c.lineTo(W, i * H / 10); c.stroke();
        }

        // Axes labels
        c.fillStyle = 'rgba(255,255,255,0.25)';
        c.font = '10px monospace';
        if (currentCurve === 'timbre') {
            c.fillText('频率→', W - 38, H - 4);
            c.fillText('↑幅度', 4, 14);
        } else {
            c.fillText('时间→', W - 38, H - 4);
            c.fillText('↑电平', 4, 14);
        }

        const pts = curves[currentCurve];
        if (!pts || pts.length < 2) return;

        const color = CURVE_COLORS[currentCurve];

        // Draw control handles
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const pc = toCanvas(p.x, p.y);

            if (i < pts.length - 1) {
                const cp1 = toCanvas(p.cp1x, p.cp1y);
                c.beginPath();
                c.moveTo(pc.x, pc.y);
                c.lineTo(cp1.x, cp1.y);
                c.strokeStyle = 'rgba(255,255,255,0.2)';
                c.lineWidth = 1;
                c.stroke();

                c.beginPath();
                c.arc(cp1.x, cp1.y, CTRL_RADIUS, 0, Math.PI * 2);
                c.fillStyle = color + '99';
                c.fill();
                c.strokeStyle = color;
                c.lineWidth = 1;
                c.stroke();
            }

            if (i > 0) {
                const cp2 = toCanvas(p.cp2x, p.cp2y);
                c.beginPath();
                c.moveTo(pc.x, pc.y);
                c.lineTo(cp2.x, cp2.y);
                c.strokeStyle = 'rgba(255,255,255,0.2)';
                c.lineWidth = 1;
                c.stroke();

                c.beginPath();
                c.arc(cp2.x, cp2.y, CTRL_RADIUS, 0, Math.PI * 2);
                c.fillStyle = color + '99';
                c.fill();
                c.strokeStyle = color;
                c.lineWidth = 1;
                c.stroke();
            }
        }

        // Draw the bezier curve
        c.beginPath();
        const p0c = toCanvas(pts[0].x, pts[0].y);
        c.moveTo(p0c.x, p0c.y);

        for (let i = 0; i < pts.length - 1; i++) {
            const p = pts[i];
            const pn = pts[i + 1];
            const cp1 = toCanvas(p.cp1x, p.cp1y);
            const cp2 = toCanvas(pn.cp2x, pn.cp2y);
            const pnc = toCanvas(pn.x, pn.y);
            c.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, pnc.x, pnc.y);
        }

        // Glow effect
        c.shadowColor = color;
        c.shadowBlur = 8;
        c.strokeStyle = color;
        c.lineWidth = 2.5;
        c.stroke();
        c.shadowBlur = 0;

        // Filled area under curve
        c.lineTo((canvas._logW || CANVAS_W), (canvas._logH || CANVAS_H));
        c.lineTo(0, (canvas._logH || CANVAS_H));
        c.closePath();
        const grad = c.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, color + '44');
        grad.addColorStop(1, color + '05');
        c.fillStyle = grad;
        c.fill();

        // Draw anchor points
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const pc = toCanvas(p.x, p.y);

            c.beginPath();
            c.arc(pc.x, pc.y, POINT_RADIUS, 0, Math.PI * 2);
            c.fillStyle = '#ffffff';
            c.fill();
            c.strokeStyle = color;
            c.lineWidth = 2;
            c.stroke();

            // Lock first and last x
            if (i === 0 || i === pts.length - 1) {
                c.beginPath();
                c.arc(pc.x, pc.y, 4, 0, Math.PI * 2);
                c.fillStyle = color;
                c.fill();
            }
        }
    }

    function drawADSRPreview() {
        if (!previewCanvas || !previewCtx) return;
        const c = previewCtx;
        const W = previewCanvas.width;
        const H = previewCanvas.height;
        c.clearRect(0, 0, W, H);
        c.fillStyle = '#0e1018';
        c.fillRect(0, 0, W, H);

        const totalT = adsr.attack + adsr.decay + 0.3 + adsr.release;
        const scale = W / totalT;

        c.strokeStyle = '#00bcd4';
        c.lineWidth = 2;
        c.shadowColor = '#00bcd4';
        c.shadowBlur = 6;
        c.beginPath();

        // Attack
        const aX = adsr.attack * scale;
        c.moveTo(0, H - 4);
        c.lineTo(aX, 4);

        // Decay
        const dX = aX + adsr.decay * scale;
        const sY = H - (adsr.sustain * (H - 8)) - 4;
        c.lineTo(dX, sY);

        // Sustain
        const holdX = dX + 0.3 * scale;
        c.lineTo(holdX, sY);

        // Release
        const rX = holdX + adsr.release * scale;
        c.lineTo(Math.min(rX, W), H - 4);

        c.stroke();
        c.shadowBlur = 0;

        // Labels
        c.fillStyle = 'rgba(255,255,255,0.4)';
        c.font = '9px monospace';
        c.fillText('A', aX / 2 - 3, H - 6);
        c.fillText('D', aX + (dX - aX) / 2 - 3, H - 6);
        c.fillText('S', dX + (holdX - dX) / 2 - 3, sY - 4);
        c.fillText('R', holdX + (rX - holdX) / 2 - 3, H - 6);
    }

    // ===== Event binding =====
    function getPointerPos(e) {
        const rect = canvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return { x: src.clientX - rect.left, y: src.clientY - rect.top };
    }

    function hitTest(pos) {
        const pts = curves[currentCurve];
        const R = POINT_RADIUS + 4;
        const CR = CTRL_RADIUS + 6;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const pc = toCanvas(p.x, p.y);
            if (dist(pos, pc) < R) return { pointIndex: i, type: 'anchor' };

            if (i < pts.length - 1) {
                const cp1 = toCanvas(p.cp1x, p.cp1y);
                if (dist(pos, cp1) < CR) return { pointIndex: i, type: 'cp1' };
            }
            if (i > 0) {
                const cp2 = toCanvas(p.cp2x, p.cp2y);
                if (dist(pos, cp2) < CR) return { pointIndex: i, type: 'cp2' };
            }
        }
        return null;
    }

    function dist(a, b) { return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2); }

    function bindEvents() {
        const el = canvas;

        el.addEventListener('pointerdown', onPointerDown, { passive: false });
        el.addEventListener('pointermove', onPointerMove, { passive: false });
        el.addEventListener('pointerup', onPointerUp);
        el.addEventListener('pointercancel', onPointerUp);
        el.addEventListener('dblclick', onDblClick);
        el.addEventListener('contextmenu', onContextMenu);
    }

    function onPointerDown(e) {
        e.preventDefault();
        const pos = getPointerPos(e);
        const hit = hitTest(pos);
        if (hit) {
            dragging = hit;
            canvas.setPointerCapture(e.pointerId);
        }
    }

    function onPointerMove(e) {
        e.preventDefault();
        if (!dragging) return;
        const pos = getPointerPos(e);
        const norm = fromCanvas(pos.x, pos.y);
        const pts = curves[currentCurve];
        const p = pts[dragging.pointIndex];

        if (dragging.type === 'anchor') {
            // Lock x for first/last
            const isFirst = dragging.pointIndex === 0;
            const isLast  = dragging.pointIndex === pts.length - 1;
            const oldX = p.x;
            const newX = isFirst ? 0 : isLast ? 1 : Math.max(0, Math.min(1, norm.x));
            const newY = Math.max(0, Math.min(1, norm.y));
            const dx = newX - oldX;
            const dy = newY - p.y;
            p.x = newX; p.y = newY;
            p.cp1x += dx; p.cp1y += dy;
            p.cp2x += dx; p.cp2y += dy;
        } else if (dragging.type === 'cp1') {
            p.cp1x = Math.max(0, Math.min(1, norm.x));
            p.cp1y = Math.max(0, Math.min(1, norm.y));
        } else if (dragging.type === 'cp2') {
            p.cp2x = Math.max(0, Math.min(1, norm.x));
            p.cp2y = Math.max(0, Math.min(1, norm.y));
        }
        draw();
        updateADSRFromCurve();
        drawADSRPreview();
    }

    function onPointerUp(e) {
        dragging = null;
    }

    function onDblClick(e) {
        const pos = getPointerPos(e);
        const norm = fromCanvas(pos.x, pos.y);
        const pts = curves[currentCurve];
        // Find insertion index
        let insertIdx = pts.length - 1;
        for (let i = 0; i < pts.length - 1; i++) {
            if (norm.x >= pts[i].x && norm.x <= pts[i+1].x) { insertIdx = i + 1; break; }
        }
        const newPt = {
            x: norm.x, y: norm.y,
            cp1x: norm.x + 0.05, cp1y: Math.min(1, norm.y + 0.1),
            cp2x: Math.max(0, norm.x - 0.05), cp2y: Math.max(0, norm.y - 0.1)
        };
        pts.splice(insertIdx, 0, newPt);
        draw();
    }

    function onContextMenu(e) {
        e.preventDefault();
        const pos = getPointerPos(e);
        const hit = hitTest(pos);
        if (hit && hit.type === 'anchor') {
            const pts = curves[currentCurve];
            if (pts.length > 2 && hit.pointIndex !== 0 && hit.pointIndex !== pts.length - 1) {
                pts.splice(hit.pointIndex, 1);
                draw();
            }
        }
    }

    // ===== ADSR from curve =====
    function updateADSRFromCurve() {
        const sampled = sampleCurve(currentCurve, 64);
        // Update ADSR display
        const A = adsr.attack * 1000;
        const D = adsr.decay * 1000;
        const S = adsr.sustain;
        const R = adsr.release * 1000;
        const el_a = document.getElementById('disp-attack');
        const el_d = document.getElementById('disp-decay');
        const el_s = document.getElementById('disp-sustain');
        const el_r = document.getElementById('disp-release');
        if (el_a) el_a.textContent = Math.round(A);
        if (el_d) el_d.textContent = Math.round(D);
        if (el_s) el_s.textContent = Math.round(S * 100);
        if (el_r) el_r.textContent = Math.round(R);
    }

    /**
     * Sample a curve into N points
     * Returns Float32Array of y values at evenly spaced x
     */
    function sampleCurve(type, N) {
        const pts = curves[type];
        if (!pts || pts.length < 2) return new Float32Array(N).fill(0.5);
        const out = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            const tx = i / (N - 1);
            out[i] = sampleBezierAtX(pts, tx);
        }
        return out;
    }

    function sampleBezierAtX(pts, targetX) {
        // Find segment
        let segIdx = 0;
        for (let i = 0; i < pts.length - 1; i++) {
            if (targetX >= pts[i].x && targetX <= pts[i+1].x) { segIdx = i; break; }
            if (i === pts.length - 2) segIdx = i;
        }
        const p0 = pts[segIdx];
        const p1 = pts[segIdx + 1];
        // Numerically find t such that bezierX(t) = targetX
        let lo = 0, hi = 1, t = 0.5;
        for (let iter = 0; iter < 20; iter++) {
            const bx = cubicBezier1D(p0.x, p0.cp1x, p1.cp2x, p1.x, t);
            if (Math.abs(bx - targetX) < 0.0001) break;
            if (bx < targetX) lo = t; else hi = t;
            t = (lo + hi) / 2;
        }
        return cubicBezier1D(p0.y, p0.cp1y, p1.cp2y, p1.y, t);
    }

    function cubicBezier1D(p0, p1, p2, p3, t) {
        const mt = 1 - t;
        return mt*mt*mt*p0 + 3*mt*mt*t*p1 + 3*mt*t*t*p2 + t*t*t*p3;
    }

    // ===== Presets =====
    const PRESETS = {
        piano: {
            attack:  { pts: [{ x:0, y:0, cp1x:0, cp1y:0, cp2x:0.1, cp2y:0 }, { x:1, y:1, cp1x:0.9, cp1y:1, cp2x:1, cp2y:1 }], adsr: [0.01, 0.15, 0.4, 0.3] },
            decay:   { pts: [{ x:0, y:1, cp1x:0, cp1y:1, cp2x:0.5, cp2y:1 }, { x:1, y:0.4, cp1x:0.5, cp1y:0.4, cp2x:1, cp2y:0.4 }] },
            sustain: { pts: [{ x:0, y:0.4, cp1x:0, cp1y:0.4, cp2x:0.5, cp2y:0.4 }, { x:1, y:0.4, cp1x:0.5, cp1y:0.4, cp2x:1, cp2y:0.4 }] },
            release: { pts: [{ x:0, y:0.4, cp1x:0.3, cp1y:0.4, cp2x:0.7, cp2y:0 }, { x:1, y:0, cp1x:0.9, cp1y:0, cp2x:1, cp2y:0 }] },
            timbre:  [0.9, 0.6, 0.3, 0.15, 0.08, 0.04, 0.02, 0.01]
        },
        pluck: {
            attack:  { adsr: [0.005, 0.1, 0.2, 0.2] },
            timbre:  [0.8, 0.7, 0.5, 0.3, 0.2, 0.1, 0.05, 0.02]
        },
        pad: {
            attack:  { adsr: [0.8, 0.2, 0.8, 1.2] },
            timbre:  [0.5, 0.3, 0.1, 0.05, 0.02, 0.01]
        },
        organ: {
            attack:  { adsr: [0.02, 0.02, 1.0, 0.05] },
            timbre:  [0.7, 0.7, 0.3, 0.7, 0.1, 0.1, 0.05, 0.05]
        },
        bell: {
            attack:  { adsr: [0.005, 0.8, 0.1, 1.5] },
            timbre:  [0.5, 0.1, 0.6, 0.1, 0.4, 0.05, 0.02]
        },
        bass: {
            attack:  { adsr: [0.01, 0.05, 0.9, 0.15] },
            timbre:  [1.0, 0.5, 0.1, 0.05, 0.02, 0.01]
        }
    };

    function applyPreset(name) {
        const preset = PRESETS[name];
        if (!preset) return;
        const a = preset.attack && preset.attack.adsr ? preset.attack.adsr : null;
        if (a) {
            adsr.attack = a[0]; adsr.decay = a[1]; adsr.sustain = a[2]; adsr.release = a[3];
        }
        if (preset.attack && preset.attack.pts) curves.attack = preset.attack.pts.map(p => ({...p}));
        else curves.attack = getDefaultCurve('attack');

        if (preset.decay && preset.decay.pts) curves.decay = preset.decay.pts.map(p => ({...p}));
        else curves.decay = getDefaultCurve('decay');

        curves.sustain = getDefaultCurve('sustain');
        curves.release = getDefaultCurve('release');

        if (preset.timbre) {
            const tl = preset.timbre.length;
            curves.timbre = preset.timbre.map((v, i) => ({
                x: i / (tl - 1),
                y: v,
                cp1x: Math.min(1, i / (tl - 1) + 0.05),
                cp1y: v,
                cp2x: Math.max(0, i / (tl - 1) - 0.05),
                cp2y: v
            }));
        }
        draw();
        updateADSRFromCurve();
        drawADSRPreview();
    }

    // ===== UI bindings =====
    function bindUI() {
        // Curve type buttons
        document.querySelectorAll('.curve-type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.curve-type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentCurve = btn.dataset.curve;
                document.getElementById('bezier-canvas-title').textContent = btn.textContent + ' 曲线';
                draw();
            });
        });

        // Preset buttons
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
        });

        // Actions
        document.getElementById('btn-curve-reset').addEventListener('click', () => {
            curves[currentCurve] = getDefaultCurve(currentCurve);
            draw(); drawADSRPreview();
        });
        document.getElementById('btn-curve-smooth').addEventListener('click', smoothCurve);
        document.getElementById('btn-curve-linear').addEventListener('click', linearizeCurve);

        // ADSR display initial update
        updateADSRFromCurve();

        // Preview sound
        document.getElementById('btn-preview-sound').addEventListener('click', previewSound);

        // Open/close modal
        document.getElementById('btn-bezier-editor').addEventListener('click', () => {
            document.getElementById('bezier-modal').style.display = 'flex';
            setTimeout(() => { resizeCanvas(); draw(); drawADSRPreview(); }, 50);
        });
        document.getElementById('bezier-modal-close').addEventListener('click', () => {
            document.getElementById('bezier-modal').style.display = 'none';
        });

        // Apply to track
        document.getElementById('btn-apply-bezier').addEventListener('click', () => {
            if (window.Tracks && window.Tracks.getSelectedTrack) {
                const t = window.Tracks.getSelectedTrack();
                if (t) {
                    t.instrument.adsr = getADSRValues();
                    t.instrument.timbre = Array.from(sampleCurve('timbre', 32));
                    t.instrument.attackCurve = Array.from(sampleCurve('attack', 64));
                    t.instrument.decayCurve = Array.from(sampleCurve('decay', 64));
                    t.instrument.releaseCurve = Array.from(sampleCurve('release', 64));
                    t.instrument.timbreMode = 'bezier';  // 切回贝塞尔模式
                    delete t.instrument.spectrogramData;  // 清除语谱图数据
                    // 刷新属性面板
                    if (window.Tracks.updatePropertiesPanel) {
                        window.Tracks.updatePropertiesPanel(t);
                    }
                    showToast('✓ 音色已应用到: ' + t.name);
                }
            }
            document.getElementById('bezier-modal').style.display = 'none';
        });
    }

    function smoothCurve() {
        const pts = curves[currentCurve];
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const prevP = i > 0 ? pts[i-1] : null;
            const nextP = i < pts.length - 1 ? pts[i+1] : null;
            if (prevP && nextP) {
                const dx = nextP.x - prevP.x;
                const dy = nextP.y - prevP.y;
                p.cp2x = p.x - dx * 0.15;
                p.cp2y = p.y - dy * 0.15;
                p.cp1x = p.x + dx * 0.15;
                p.cp1y = p.y + dy * 0.15;
            }
        }
        draw(); drawADSRPreview();
    }

    function linearizeCurve() {
        const pts = curves[currentCurve];
        for (let i = 0; i < pts.length - 1; i++) {
            const p = pts[i];
            const pn = pts[i+1];
            p.cp1x = p.x + (pn.x - p.x) / 3;
            p.cp1y = p.y + (pn.y - p.y) / 3;
            pn.cp2x = p.x + (pn.x - p.x) * 2 / 3;
            pn.cp2y = p.y + (pn.y - p.y) * 2 / 3;
        }
        draw(); drawADSRPreview();
    }

    function previewSound() {
        AudioEngine.ensureContext();
        const attackC = Array.from(sampleCurve('attack', 64));
        const decayC  = Array.from(sampleCurve('decay', 64));
        const releaseC = Array.from(sampleCurve('release', 64));
        const timbreC = Array.from(sampleCurve('timbre', 32));
        const instrument = {
            adsr: getADSRValues(),
            timbre: timbreC,
            attackCurve: attackC,
            decayCurve: decayC,
            releaseCurve: releaseC
        };
        AudioEngine.playNote('preview', 69, instrument, adsr.attack + adsr.decay + 0.3 + 0.05);
    }

    function getADSRValues() {
        return {
            attack:  adsr.attack,
            decay:   adsr.decay,
            sustain: adsr.sustain,
            release: adsr.release,
            attackCurve: Array.from(sampleCurve('attack', 64)),
            decayCurve:  Array.from(sampleCurve('decay', 64)),
            releaseCurve: Array.from(sampleCurve('release', 64))
        };
    }

    function showToast(msg) {
        const t = document.createElement('div');
        t.className = 'toast';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2500);
    }

    return { init, sampleCurve, getADSRValues, applyPreset };
})();
