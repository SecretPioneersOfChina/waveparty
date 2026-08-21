/**
 * WaveParty Piano Roll
 * - 88 键显示
 * - 绘制 / 选择 / 删除音符
 * - 量化网格
 * - 缩放
 * - 触屏友好
 */

window.PianoRoll = (function () {
    'use strict';

    const NOTE_COUNT = 88;    // 21(A0) ~ 108(C8)
    const MIDI_MIN = 21;
    const KEY_W = 60;         // Piano key width
    const NOTE_H = 18;        // Height per pitch row (increased from 14)
    const BAR_W = 320;        // Width of one bar at zoom=1 (increased from 240)
    const NUM_BARS = 8;

    let canvas = null, ctx = null;
    let keysCanvas = null, keysCtx = null;
    let scrollArea = null;
    let currentTrack = null;
    let currentClip = null;   // 当前正在编辑的乐段（clip），音符存在 clip.notes 中
    let tool = 'draw';
    let zoom = 1;
    let quantize = 4; // divisions per beat
    let rangeSelectToolActive = false; // 框选工具模式（平板专用）

    // Drag state
    let dragging = null;
    let dragStartBeat = 0, dragStartPitch = 0;
    let selectedNotes = new Set();

    // Hover state for resize cursor
    let hoverNoteIdx = -1;   // 鼠标悬停的音符索引
    let hoverEdge = '';       // '' | 'right' | 'left' — 悬停在边缘时可拖拽改变长度

    // Pitch drag state: track original pitches of selected notes when drag starts
    let dragOrigPitches = new Map(); // noteIdx -> original pitch
    let dragOrigBeats  = new Map(); // noteIdx -> original beat
    let dragStartRow = 0;           // row index at drag start (for pitch delta)

    // ---- 矩形框选 (Rubber band selection) ----
    let rangeSelecting = false;      // 是否正在拖拽框选
    let rangeStart = { x: 0, y: 0 }; // 框选起始（画布坐标）
    let rangeEnd   = { x: 0, y: 0 }; // 框选结束（画布坐标）
    let rangeAddMode = false;        // Shift 追加模式

    /** 获取当前编辑的音符数组（优先 clip.notes，兼容旧 track.notes） */
    function getNotes() {
        if (currentClip) {
            if (!currentClip.notes) currentClip.notes = [];
            return currentClip.notes;
        }
        if (currentTrack) {
            if (!currentTrack.notes) currentTrack.notes = [];
            return currentTrack.notes;
        }
        return [];
    }

    function init() {
        canvas = document.getElementById('pr-grid-canvas');
        ctx = canvas.getContext('2d');
        keysCanvas = document.getElementById('piano-keys-canvas');
        keysCtx = keysCanvas.getContext('2d');
        scrollArea = document.getElementById('pr-scroll-area');

        resizeCanvas();
        bindEvents();

        // 同步琴键与网格的垂直滚动
        if (scrollArea && keysCanvas) {
            scrollArea.addEventListener('scroll', () => {
                keysCanvas.style.transform = `translateY(${-scrollArea.scrollTop}px)`;
            });
        }
    }

    function resizeCanvas() {
        if (!canvas || !scrollArea) return; // 防御：init 前调用时直接返回
        // 优先使用 clip 长度；若无 clip 则回退到 track 长度
        const clipBeats = currentClip ? currentClip.length : null;
        const trackBeats = (currentTrack && currentTrack.length) ? currentTrack.length : 16;
        const beats = clipBeats || trackBeats;
        // 画布宽度 = 内容所需宽度，且至少 2 倍可视区宽（方便滚动到空白区域）
        const viewW = scrollArea.clientWidth > 0 ? scrollArea.clientWidth : 800;
        const contentW = BAR_W * (beats / 4) * zoom;
        const totalW = Math.max(contentW, viewW * 2);
        const totalH = NOTE_COUNT * NOTE_H;
        canvas.width = totalW;
        canvas.height = totalH;
        canvas.style.width = totalW + 'px';
        canvas.style.height = totalH + 'px';

        // 注意：不要设置 scrollArea.style.width！
        // 让 pr-scroll-area 的宽度由 flex 布局决定（flex:1），
        // 画布比可视区宽时自然出现横向滚动条。

        keysCanvas.width = KEY_W;
        keysCanvas.height = totalH;
        keysCanvas.style.height = totalH + 'px';

        drawKeys();
        drawGrid();
    }

    function drawKeys() {
        const c = keysCtx;
        const W = KEY_W;
        c.clearRect(0, 0, W, NOTE_COUNT * NOTE_H);

        for (let i = 0; i < NOTE_COUNT; i++) {
            const midi = MIDI_MIN + (NOTE_COUNT - 1 - i);
            const y = i * NOTE_H;
            const isBlack = isBlackKey(midi);

            if (isBlack) {
                c.fillStyle = '#222';
                c.fillRect(0, y, W * 0.65, NOTE_H);
                c.fillStyle = '#333';
                c.fillRect(W * 0.65, y, W * 0.35, NOTE_H);
            } else {
                c.fillStyle = '#e8e8e8';
                c.fillRect(0, y, W, NOTE_H);
                // Key border
                c.fillStyle = '#bbb';
                c.fillRect(0, y + NOTE_H - 1, W, 1);
            }

            // Labels: C notes
            const noteName = midiToName(midi);
            if (noteName.startsWith('C') && !isBlack) {
                c.fillStyle = '#555';
                c.font = '9px monospace';
                c.fillText(noteName, 2, y + NOTE_H - 3);
            }

            // Hover highlight area
            if (isBlack) {
                c.fillStyle = 'rgba(0,188,212,0.05)';
                c.fillRect(0, y, W, NOTE_H);
            }
        }
    }

    function drawGrid() {
        if (!canvas || !ctx) return;
        const c = ctx;
        const W = canvas.width;
        const H = canvas.height;
        const beatW = BAR_W * zoom / 4;
        const subdivW = beatW / quantize;

        c.clearRect(0, 0, W, H);

        // Row backgrounds
        for (let i = 0; i < NOTE_COUNT; i++) {
            const midi = MIDI_MIN + (NOTE_COUNT - 1 - i);
            const y = i * NOTE_H;
            const isBlack = isBlackKey(midi);
            c.fillStyle = isBlack ? '#1a1d23' : '#1e2128';
            c.fillRect(0, y, W, NOTE_H);
        }

        // Horizontal lines
        for (let i = 0; i <= NOTE_COUNT; i++) {
            const y = i * NOTE_H;
            const midi = MIDI_MIN + (NOTE_COUNT - i);
            const isC = !isBlackKey(midi) && midiToName(midi).startsWith('C');
            c.fillStyle = isC ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)';
            c.fillRect(0, y, W, 1);
        }

        // Vertical lines
        for (let b = 0; b * subdivW <= W; b++) {
            const x = b * subdivW;
            const isBar = b % (4 * quantize) === 0;
            const isBeat = b % quantize === 0;
            c.fillStyle = isBar ? 'rgba(255,255,255,0.2)' : isBeat ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)';
            c.fillRect(x, 0, 1, H);
        }

        // Draw notes（注意：beat 相对于 clip 起始位置的偏移）
        const notes = getNotes();
        const clipOffset = currentClip ? currentClip.startBeat : 0;
        notes.forEach((note, idx) => {
            // 在 clip 模式下，note.beat 存储的是相对于 clip 起始的 beat
            drawNote(note, idx, 0);
        });

        // Draw playhead
        if (window.App && window.App.getPlaybackBeat) {
            const pb = window.App.getPlaybackBeat();
            // 减去 clip 偏移，换算成 clip 内部坐标
            const localBeat = pb - clipOffset;
            const px = localBeat * beatW;
            if (px >= 0 && px <= W) {
                c.fillStyle = '#ff4081';
                c.fillRect(px, 0, 2, H);
            }
        }

        // Draw range selection rectangle
        if (rangeSelecting && rangeStart && rangeEnd) {
            const rx = Math.min(rangeStart.x, rangeEnd.x);
            const ry = Math.min(rangeStart.y, rangeEnd.y);
            const rw = Math.abs(rangeEnd.x - rangeStart.x);
            const rh = Math.abs(rangeEnd.y - rangeStart.y);
            c.fillStyle = 'rgba(0, 188, 212, 0.12)';
            c.fillRect(rx, ry, rw, rh);
            c.strokeStyle = '#00bcd4';
            c.lineWidth = 1;
            c.setLineDash([4, 2]);
            c.strokeRect(rx, ry, rw, rh);
            c.setLineDash([]);
        }

        // 同步刷新轨道 mini 音符预览
        if (currentTrack && window.Tracks && window.Tracks.refreshMiniNotes) {
            window.Tracks.refreshMiniNotes(currentTrack.id);
        }
    }

    function drawNote(note, idx) {
        const c = ctx;
        const beatW = BAR_W * zoom / 4;
        const x = note.beat * beatW;
        const w = note.duration * beatW;
        const rowIdx = (MIDI_MIN + NOTE_COUNT - 1) - note.pitch;
        const y = rowIdx * NOTE_H;
        const isSelected = selectedNotes.has(idx);

        const trackColor = currentTrack ? currentTrack.color : '#7c4dff';
        c.fillStyle = isSelected ? '#ffffff' : trackColor;
        c.globalAlpha = 0.9;
        c.beginPath();
        roundRect(c, x + 1, y + 1, Math.max(w - 2, 4), NOTE_H - 2, 2);
        c.fill();
        c.globalAlpha = 1;

        // Velocity shade
        const velAlpha = 0.3 + (note.velocity / 127) * 0.3;
        c.fillStyle = `rgba(255,255,255,${velAlpha})`;
        c.fillRect(x + 1, y + 1, 3, NOTE_H - 2);

        // Right-edge resize handle（选中时或悬停时显示）
        if (isSelected || idx === hoverNoteIdx) {
            const handleX = x + Math.max(w - 2, 4);
            c.fillStyle = isSelected ? '#ff4081' : 'rgba(255,255,255,0.5)';
            c.fillRect(handleX - 2, y + 3, 3, NOTE_H - 6);
        }

        // Border
        c.strokeStyle = isSelected ? '#ff4081' : 'rgba(255,255,255,0.3)';
        c.lineWidth = isSelected ? 1.5 : 0.5;
        c.beginPath();
        roundRect(c, x + 1, y + 1, Math.max(w - 2, 4), NOTE_H - 2, 2);
        c.stroke();
    }

    function roundRect(c, x, y, w, h, r) {
        c.moveTo(x + r, y);
        c.lineTo(x + w - r, y);
        c.quadraticCurveTo(x + w, y, x + w, y + r);
        c.lineTo(x + w, y + h - r);
        c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        c.lineTo(x + r, y + h);
        c.quadraticCurveTo(x, y + h, x, y + h - r);
        c.lineTo(x, y + r);
        c.quadraticCurveTo(x, y, x + r, y);
    }

    function getPointerPos(e) {
        const rect = canvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return { x: src.clientX - rect.left, y: src.clientY - rect.top };
    }

    function posToBeatPitch(pos) {
        const beatW = BAR_W * zoom / 4;
        const rawBeat = pos.x / beatW;
        const subdivW = 1 / quantize;
        const beat = Math.floor(rawBeat / subdivW) * subdivW;
        const rowIdx = Math.floor(pos.y / NOTE_H);
        const pitch = (MIDI_MIN + NOTE_COUNT - 1) - rowIdx;
        return { beat, pitch: Math.max(MIDI_MIN, Math.min(108, pitch)) };
    }

    function bindEvents() {
        canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
        canvas.addEventListener('pointermove', onPointerMove, { passive: false });
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);

        keysCanvas.addEventListener('pointerdown', onKeyPress, { passive: false });

        // 鼠标滚轮 → 横向滚动（Shift+滚轮 → 纵向滚动）
        scrollArea.addEventListener('wheel', onWheel, { passive: false });

        // Tool buttons
        document.querySelectorAll('.pr-tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const btnTool = btn.dataset.tool;
                if (btnTool) {
                    // 切换工具模式
                    document.querySelectorAll('.pr-tool-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    tool = btnTool;
                    rangeSelectToolActive = false; // 关闭框选工具模式
                }
            });
        });

        // ---- 框选工具按钮（平板专用）----
        const rangeSelectBtn = document.getElementById('btn-range-select');
        if (rangeSelectBtn) {
            rangeSelectBtn.addEventListener('click', () => {
                rangeSelectToolActive = !rangeSelectToolActive;
                rangeSelectBtn.classList.toggle('active', rangeSelectToolActive);
                if (rangeSelectToolActive) {
                    tool = 'select'; // 切换到选择模式
                    document.querySelectorAll('.pr-tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                    rangeSelectBtn.classList.add('active');
                }
            });
        }

        // Zoom
        document.getElementById('pr-zoom').addEventListener('input', e => {
            zoom = parseFloat(e.target.value);
            resizeCanvas();
        });

        // Quantize
        document.getElementById('pr-quantize').addEventListener('change', e => {
            quantize = parseInt(e.target.value);
            drawGrid();
        });

        // Fit to content
        document.getElementById('btn-pr-fit').addEventListener('click', fitToContent);

        // Close
        document.getElementById('btn-close-pr').addEventListener('click', closePianoRoll);

        // ---- Keyboard shortcuts ----
        document.addEventListener('keydown', (e) => {
            const panel = document.getElementById('piano-roll-panel');
            if (!panel || panel.style.display === 'none') return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

            // Delete
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNotes.size > 0) {
                e.preventDefault();
                deleteSelectedNotes();
                return;
            }

            // Ctrl+A → 全选
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                e.preventDefault();
                const notes = getNotes();
                selectedNotes.clear();
                notes.forEach((_, i) => selectedNotes.add(i));
                drawGrid();
                updatePitchDisplay();
                return;
            }

            // Escape → 取消选择
            if (e.key === 'Escape') {
                selectedNotes.clear();
                drawGrid();
                updatePitchDisplay();
                return;
            }

            // ↑ / ↓ 音高调整
            if (selectedNotes.size > 0 && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                const semitones = e.shiftKey ? 12 : 1;  // Shift = 八度
                const delta = e.key === 'ArrowUp' ? semitones : -semitones;
                shiftPitch(delta);
                return;
            }

            // ← / → 时间位移
            if (selectedNotes.size > 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                e.preventDefault();
                const beatDelta = (e.key === 'ArrowRight' ? 1 : -1) / quantize;
                shiftBeat(beatDelta);
                return;
            }

            // Alt + ← / → 时长微调
            if (selectedNotes.size > 0 && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                e.preventDefault();
                const ratio = e.key === 'ArrowRight' ? 1.5 : 1 / 1.5;
                scaleDuration(ratio);
                return;
            }

            // Ctrl + D → 重复选中音符
            if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
                e.preventDefault();
                repeatSelectedNotes();
                return;
            }

            // Ctrl + Shift + A → 反选（删除未选中，保留选中）
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'a') {
                e.preventDefault();
                deleteUnselectedNotes();
                return;
            }
        });

        // ---- Delete button in toolbar ----
        const deleteBtn = document.getElementById('btn-delete-notes');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                if (selectedNotes.size > 0) deleteSelectedNotes();
            });
        }

        // ---- Repeat button ----
        const repeatBtn = document.getElementById('btn-repeat-notes');
        if (repeatBtn) {
            repeatBtn.addEventListener('click', () => {
                if (selectedNotes.size > 0) repeatSelectedNotes();
            });
        }

        // ---- Delete unselected button ----
        const delUnselectedBtn = document.getElementById('btn-delete-unselected');
        if (delUnselectedBtn) {
            delUnselectedBtn.addEventListener('click', () => {
                deleteUnselectedNotes();
            });
        }

        // ---- Clear all button ----
        const clearAllBtn = document.getElementById('btn-clear-all');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                if (getNotes().length > 0) clearAllNotes();
            });
        }

        // ---- Duration buttons ----
        const durBtns = [
            { id: 'btn-duration-half',  ratio: 0.5 },
            { id: 'btn-duration-double', ratio: 2   },
        ];
        durBtns.forEach(({ id, ratio }) => {
            const btn = document.getElementById(id);
            if (btn) btn.addEventListener('click', () => {
                if (selectedNotes.size > 0) scaleDuration(ratio);
            });
        });

        // ---- Pitch shift buttons ----
        const pitchBtns = [
            { id: 'btn-pitch-oct-up',   delta: +12 },
            { id: 'btn-pitch-up',       delta: +1  },
            { id: 'btn-pitch-down',     delta: -1  },
            { id: 'btn-pitch-oct-down', delta: -12 },
        ];
        pitchBtns.forEach(({ id, delta }) => {
            const btn = document.getElementById(id);
            if (btn) btn.addEventListener('click', () => {
                if (selectedNotes.size > 0) shiftPitch(delta);
            });
        });

        // ---- Left/Right scroll buttons ----
        document.getElementById('btn-pr-scroll-left').addEventListener('click', () => {
            if (!scrollArea) return;
            const step = BAR_W * zoom; // one bar width
            scrollArea.scrollLeft = Math.max(0, scrollArea.scrollLeft - step);
        });
        document.getElementById('btn-pr-scroll-right').addEventListener('click', () => {
            if (!scrollArea) return;
            const step = BAR_W * zoom; // one bar width
            const maxScroll = scrollArea.scrollWidth - scrollArea.clientWidth;
            scrollArea.scrollLeft = Math.min(maxScroll, scrollArea.scrollLeft + step);
        });

        // ---- 浮动左右滚动按钮（支持按住连续滚动）----
        ['btn-pr-float-scroll-left', 'btn-pr-float-scroll-right'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            let scrollTimer = null;
            const doScroll = () => {
                if (!scrollArea) return;
                const step = BAR_W * zoom;
                if (id.includes('left')) {
                    scrollArea.scrollLeft = Math.max(0, scrollArea.scrollLeft - step);
                } else {
                    const maxScroll = scrollArea.scrollWidth - scrollArea.clientWidth;
                    scrollArea.scrollLeft = Math.min(maxScroll, scrollArea.scrollLeft + step);
                }
            };
            const stopScroll = () => {
                if (scrollTimer) { clearInterval(scrollTimer); scrollTimer = null; }
                btn.releasePointerCapture && btn.releasePointerCapture();
            };
            btn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                doScroll();
                scrollTimer = setInterval(doScroll, 150);
                btn.setPointerCapture(e.pointerId);
            });
            btn.addEventListener('pointerup', stopScroll);
            btn.addEventListener('pointercancel', stopScroll);
        });
    }

    /** 删除选中的音符 */
    function deleteSelectedNotes() {
        const notes = getNotes();
        if (notes.length === 0) return;
        if (selectedNotes.size === 0) return;

        // 保存状态（用于撤销）
        if (window.App && window.App.saveState) window.App.saveState();

        const indices = Array.from(selectedNotes).sort((a, b) => b - a); // 从大到小删
        indices.forEach(i => {
            if (i >= 0 && i < notes.length) {
                notes.splice(i, 1);
            }
        });
        selectedNotes.clear();
        drawGrid();
        updatePitchDisplay();
        updateDurationDisplay();
    }

    /** 删除未选中的音符（保留选中音符） */
    function deleteUnselectedNotes() {
        const notes = getNotes();
        if (notes.length === 0) return;
        if (selectedNotes.size === 0) {
            // 没有选中任何音符 → 等同于清空全部
            if (window.App && window.App.saveState) window.App.saveState();
            notes.length = 0;
            selectedNotes.clear();
            drawGrid();
            updatePitchDisplay();
            updateDurationDisplay();
            return;
        }

        if (window.App && window.App.saveState) window.App.saveState();

        // 只保留选中的音符
        const keep = [];
        const newSelected = new Set();
        notes.forEach((note, idx) => {
            if (selectedNotes.has(idx)) {
                keep.push(note);
                newSelected.add(keep.length - 1);
            }
        });
        notes.length = 0;
        notes.push(...keep);
        selectedNotes = newSelected;
        drawGrid();
        updatePitchDisplay();
        updateDurationDisplay();
    }

    /** 清空全部音符 */
    function clearAllNotes() {
        const notes = getNotes();
        if (notes.length === 0) return;

        if (window.App && window.App.saveState) window.App.saveState();

        notes.length = 0;
        selectedNotes.clear();
        drawGrid();
        updatePitchDisplay();
        updateDurationDisplay();
    }

    /**
     * 重复选中音符
     * - 计算选中音符的时间跨度（minBeat → maxEnd）
     * - 将所有选中音符复制一份，beat 偏移 span 后放入
     * - 若复制后超出 clip 长度，自动扩展 clip
     * - 选中新复制的音符（方便继续 Ctrl+D 多次重复）
     */
    function repeatSelectedNotes() {
        const notes = getNotes();
        if (notes.length === 0 || selectedNotes.size === 0) return;

        if (window.App && window.App.saveState) window.App.saveState();

        // 计算选中音符的时间跨度
        let minBeat = Infinity, maxEnd = -Infinity;
        selectedNotes.forEach(idx => {
            const n = notes[idx];
            if (!n) return;
            if (n.beat < minBeat) minBeat = n.beat;
            const end = n.beat + n.duration;
            if (end > maxEnd) maxEnd = end;
        });

        const span = maxEnd - minBeat; // 时间跨度
        if (span <= 0) return;

        // 复制选中音符，偏移 span 后插入
        const newNotes = [];
        selectedNotes.forEach(idx => {
            const n = notes[idx];
            if (!n) return;
            newNotes.push({
                pitch: n.pitch,
                beat: n.beat + span,
                duration: n.duration,
                velocity: n.velocity
            });
        });

        // 检查是否需要扩展 clip / track 长度
        if (currentClip) {
            const newEnd = minBeat + span + span;
            if (newEnd > currentClip.length) {
                currentClip.length = Math.ceil(newEnd + 2);
                if (currentTrack && currentTrack.length < currentClip.length) {
                    currentTrack.length = currentClip.length;
                }
                resizeCanvas();
            }
        } else if (currentTrack) {
            // 旧格式（无 clip）：扩展 track.length
            const newEnd = minBeat + span + span;
            if (newEnd > currentTrack.length) {
                currentTrack.length = Math.ceil(newEnd + 2);
                resizeCanvas();
            }
        }

        // 将新音符加入数组
        const newSelected = new Set();
        newNotes.forEach(n => {
            notes.push(n);
            newSelected.add(notes.length - 1);
        });

        // 选中新复制的音符（方便继续 Ctrl+D）
        selectedNotes = newSelected;

        drawGrid();
        updatePitchDisplay();
        updateDurationDisplay();

        // 滚动到新复制的区域
        if (scrollArea) {
            const beatW = BAR_W * zoom / 4;
            const targetX = (minBeat + span) * beatW;
            scrollArea.scrollLeft = Math.max(0, targetX - scrollArea.clientWidth / 3);
        }
    }

    /** 将选中音符的音高统一偏移 delta 半音 */
    function shiftPitch(delta) {
        const notes = getNotes();
        if (notes.length === 0) return;

        // 保存状态（用于撤销）
        if (window.App && window.App.saveState) window.App.saveState();

        selectedNotes.forEach(idx => {
            const note = notes[idx];
            if (!note) return;
            note.pitch = Math.max(MIDI_MIN, Math.min(108, note.pitch + delta));
        });
        drawGrid();
        updatePitchDisplay();
        // 试听最后选中的音符
        if (window.AudioEngine && currentTrack) {
            const lastIdx = Array.from(selectedNotes).pop();
            if (lastIdx !== undefined && notes[lastIdx]) {
                AudioEngine.playNote(currentTrack.id, notes[lastIdx].pitch, currentTrack.instrument, 0.15);
            }
        }
    }

    /** 将选中音符的时间位置统一偏移 delta 拍 */
    function shiftBeat(delta) {
        const notes = getNotes();
        if (notes.length === 0) return;

        // 保存状态（用于撤销）
        if (window.App && window.App.saveState) window.App.saveState();

        selectedNotes.forEach(idx => {
            const note = notes[idx];
            if (!note) return;
            note.beat = Math.max(0, note.beat + delta);
        });
        drawGrid();
    }

    /** 在工具栏里显示当前选中音符的持续时间 */
    function updateDurationDisplay() {
        const el = document.getElementById('pr-duration-display');
        if (!el) return;
        const notes = getNotes();
        if (notes.length === 0 || selectedNotes.size === 0) {
            el.textContent = '';
            return;
        }
        const indices = Array.from(selectedNotes);
        if (indices.length === 1) {
            const note = notes[indices[0]];
            if (note) el.textContent = formatDuration(note.duration);
        } else {
            // 多选：显示最短~最长
            const durs = indices.map(i => notes[i] && notes[i].duration).filter(d => d != null);
            if (durs.length) {
                const lo = formatDuration(Math.min(...durs));
                const hi = formatDuration(Math.max(...durs));
                el.textContent = lo === hi ? lo : `${lo}–${hi}`;
            }
        }
    }

    /** 将拍数格式化为可读字符串 */
    function formatDuration(dur) {
        if (dur >= 4) return `${dur}拍`;
        if (dur >= 1) return `${dur}拍`;
        // 小于1拍：显示为 1/4拍、1/8拍 等
        const frac = Math.round(1 / dur);
        if (frac > 0 && frac <= 16) return `1/${frac}拍`;
        return `${Math.round(dur * 100)}%`;
    }

    /** 将选中音符的时长乘以 ratio */
    function scaleDuration(ratio) {
        const notes = getNotes();
        if (notes.length === 0 || selectedNotes.size === 0) return;
        if (window.App && window.App.saveState) window.App.saveState();
        selectedNotes.forEach(idx => {
            const note = notes[idx];
            if (!note) return;
            note.duration = Math.max(1 / quantize, note.duration * ratio);
        });
        drawGrid();
        updateDurationDisplay();
    }

    /** 在工具栏里显示当前选中音符的音高 */
    function updatePitchDisplay() {
        const el = document.getElementById('pr-pitch-display');
        if (!el) return;
        const notes = getNotes();
        if (notes.length === 0 || selectedNotes.size === 0) {
            el.textContent = '';
            return;
        }
        const indices = Array.from(selectedNotes);
        if (indices.length === 1) {
            const note = notes[indices[0]];
            if (note) el.textContent = midiToName(note.pitch);
        } else {
            // 多选：显示最高~最低
            const pitches = indices.map(i => notes[i] && notes[i].pitch).filter(p => p != null);
            if (pitches.length) {
                const lo = midiToName(Math.min(...pitches));
                const hi = midiToName(Math.max(...pitches));
                el.textContent = lo === hi ? lo : `${lo}–${hi}`;
            }
        }
    }

    function onPointerDown(e) {
        // 触摸设备上不 preventDefault —— 否则触摸滚动手势被阻止
        if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
            e.preventDefault();
        }
        if (!currentTrack) return;

        const pos = getPointerPos(e);
        const { beat, pitch } = posToBeatPitch(pos);
        const curRow = Math.floor(pos.y / NOTE_H);
        const notes = getNotes();
        const hit = hitTestNote(pos);

        // ── Shift+点击空白 → 框选模式（任何工具模式都支持）────
        if (e.shiftKey && hit.idx === -1) {
            rangeSelecting = true;
            rangeStart = { x: pos.x, y: pos.y };
            rangeEnd = { x: pos.x, y: pos.y };
            rangeAddMode = true; // Shift 模式 = 追加选择
            dragging = null;
            canvas.setPointerCapture(e.pointerId);
            drawGrid();
            return;
        }

        if (tool === 'draw' || tool === 'select' || rangeSelectToolActive) {
            if (hit.idx !== -1) {
                // 框选工具模式下：点击音符 = 选中音符（不框选）
                if (rangeSelectToolActive) {
                    if (!e.shiftKey && !selectedNotes.has(hit.idx)) {
                        selectedNotes.clear();
                    }
                    selectedNotes.add(hit.idx);
                    drawGrid();
                    updatePitchDisplay();
                    updateDurationDisplay();
                    return;
                }
                // 检查是否点在边缘 → 拖拽改变长度
                if (hit.edge === 'right' || hit.edge === 'left') {
                    // 保存状态
                    if (window.App && window.App.saveState) window.App.saveState();
                    // 确保该音符被选中
                    if (!e.shiftKey && !selectedNotes.has(hit.idx)) {
                        selectedNotes.clear();
                    }
                    selectedNotes.add(hit.idx);
                    dragging = {
                        type: 'resize',
                        noteIdx: hit.idx,
                        edge: hit.edge,
                        startBeat: notes[hit.idx].beat,
                        startDuration: notes[hit.idx].duration
                    };
                    canvas.setPointerCapture(e.pointerId);
                    drawGrid();
                    updateDurationDisplay();
                    return;
                }

                // 普通点击音符主体 → 移动
                if (!selectedNotes.has(hit.idx)) {
                    if (!e.shiftKey) selectedNotes.clear();
                    selectedNotes.add(hit.idx);
                }
                // Store original beats & pitches of all selected notes for drag
                dragOrigPitches.clear();
                dragOrigBeats.clear();
                selectedNotes.forEach(idx => {
                    dragOrigPitches.set(idx, notes[idx].pitch);
                    dragOrigBeats.set(idx,  notes[idx].beat);
                });
                dragStartRow = curRow;
                dragging = { type: 'move', noteIdx: hit.idx, startX: pos.x, startY: pos.y };
                canvas.setPointerCapture(e.pointerId);
            } else {
                // 框选工具模式：空白区域 → 直接开始框选
                if (rangeSelectToolActive) {
                    rangeSelecting = true;
                    rangeStart = { x: pos.x, y: pos.y };
                    rangeEnd = { x: pos.x, y: pos.y };
                    rangeAddMode = false;
                    dragging = null;
                } else if (tool === 'draw') {
                    // 创建新音符，保存状态
                    if (window.App && window.App.saveState) window.App.saveState();
                    const defaultDur = 1 / quantize;
                    const note = { pitch, beat, duration: defaultDur, velocity: 100 };
                    if (currentClip) note.clipId = currentClip.id;
                    notes.push(note);
                    const newIdx = notes.length - 1;
                    dragging = { type: 'resize', noteIdx: newIdx, edge: 'right', startBeat: beat, startDuration: defaultDur };
                    selectedNotes.clear();
                    selectedNotes.add(newIdx);
                    if (window.AudioEngine) {
                        AudioEngine.playNote(currentTrack.id, pitch, currentTrack.instrument, 0.15);
                    }
                } else {
                    // select 模式：点击空白 → 开始框选
                    rangeSelecting = true;
                    rangeStart = { x: pos.x, y: pos.y };
                    rangeEnd = { x: pos.x, y: pos.y };
                    rangeAddMode = !!e.shiftKey;
                    dragging = null;
                }
                canvas.setPointerCapture(e.pointerId);
            }
            drawGrid();
            updatePitchDisplay();
            updateDurationDisplay();
        } else if (tool === 'erase') {
            // erase 模式：点击音符删除；点击空白 → 框选
            if (hit.idx !== -1) {
                if (window.App && window.App.saveState) window.App.saveState();
                notes.splice(hit.idx, 1);
                selectedNotes.clear();
                drawGrid();
                updatePitchDisplay();
                updateDurationDisplay();
            } else {
                // 空白区域 → 开始框选
                rangeSelecting = true;
                rangeStart = { x: pos.x, y: pos.y };
                rangeEnd = { x: pos.x, y: pos.y };
                rangeAddMode = !!e.shiftKey;
                dragging = null;
                canvas.setPointerCapture(e.pointerId);
                drawGrid();
            }
        }
    }

    function onPointerMove(e) {
        // 非拖拽状态不阻止默认行为 → 允许触摸滚动
        if (dragging || rangeSelecting) {
            e.preventDefault();
        }
        if (!currentTrack) return;

        const pos = getPointerPos(e);
        const notes = getNotes();
        const beatW = BAR_W * zoom / 4;
        const subdivW = 1 / quantize;

        // -- 更新光标样式（悬停检测）--
        if (!dragging && !rangeSelecting) {
            const hit = hitTestNote(pos);
            if (hit.idx !== -1 && (hit.edge === 'right' || hit.edge === 'left')) {
                canvas.style.cursor = 'col-resize';
                hoverNoteIdx = hit.idx;
                hoverEdge = hit.edge;
            } else {
                canvas.style.cursor = (tool === 'erase') ? 'crosshair' : 'default';
                hoverNoteIdx = -1;
                hoverEdge = '';
            }
        }

        // -- 框选拖拽中 --
        if (rangeSelecting) {
            rangeEnd = { x: pos.x, y: pos.y };
            updateRangeSelection();
            drawGrid();
            updatePitchDisplay();
            updateDurationDisplay();
            return;
        }

        if (!dragging) return;

        if (dragging.type === 'resize') {
            const note = notes[dragging.noteIdx];
            if (!note) return;
            const curBeat = pos.x / beatW;
            if (dragging.edge === 'right') {
                const newDur = Math.max(subdivW, Math.round((curBeat - note.beat) / subdivW) * subdivW);
                note.duration = newDur;
            } else if (dragging.edge === 'left') {
                const oldEnd = note.beat + note.duration;
                const newBeat = Math.max(0, Math.round(curBeat / subdivW) * subdivW);
                const newDur = Math.max(subdivW, oldEnd - newBeat);
                note.beat = newBeat;
                note.duration = newDur;
            }
        } else if (dragging.type === 'move') {
            const dx = pos.x - dragging.startX;
            const dy = pos.y - dragging.startY;
            const dBeat   = dx / beatW;
            const dRows   = Math.round(dy / NOTE_H);

            selectedNotes.forEach(idx => {
                const note = notes[idx];
                if (!note) return;
                const origBeat = dragOrigBeats.get(idx) ?? note.beat;
                const origPitch = dragOrigPitches.get(idx) ?? note.pitch;
                note.beat = Math.max(0, origBeat + Math.round(dBeat / subdivW) * subdivW);
                note.pitch = Math.max(MIDI_MIN, Math.min(108, origPitch - dRows));
            });
        }
        drawGrid();
        updatePitchDisplay();
        updateDurationDisplay();
    }

    function onPointerUp(e) {
        // 框选完成：选区已由 updateRangeSelection 实时更新
        if (rangeSelecting) {
            rangeSelecting = false;
            drawGrid();
            updatePitchDisplay();
            updateDurationDisplay();
        }
        dragging = null;
        dragOrigPitches.clear();
        dragOrigBeats.clear();
        // 恢复光标
        canvas.style.cursor = (tool === 'erase') ? 'crosshair' : 'default';
        hoverNoteIdx = -1;
        hoverEdge = '';
    }

    function onWheel(e) {
        e.preventDefault();
        if (!scrollArea) return;
        // Shift+滚轮 → 纵向滚动；普通滚轮 → 横向滚动
        if (e.shiftKey) {
            scrollArea.scrollTop += e.deltaY;
        } else {
            scrollArea.scrollLeft += e.deltaX + e.deltaY;
        }
    }

    function onKeyPress(e) {
        e.preventDefault();
        const rect = keysCanvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        const y = src.clientY - rect.top;
        const rowIdx = Math.floor(y / NOTE_H);
        const pitch = (MIDI_MIN + NOTE_COUNT - 1) - rowIdx;
        if (window.AudioEngine && currentTrack) {
            AudioEngine.playNote(currentTrack.id, pitch, currentTrack.instrument, 0.5);
        }
    }

    /**
     * 命中检测：返回 { idx, edge }
     * edge: '' | 'right' | 'left'
     */
    function hitTestNote(pos) {
        const notes = getNotes();
        if (notes.length === 0) return { idx: -1, edge: '' };
        const beatW = BAR_W * zoom / 4;
        const EDGE_SIZE = 6; // 边缘感应区像素大小
        for (let i = notes.length - 1; i >= 0; i--) {
            const note = notes[i];
            const x = note.beat * beatW;
            const w = Math.max(note.duration * beatW, 8);
            const rowIdx = (MIDI_MIN + NOTE_COUNT - 1) - note.pitch;
            const y = rowIdx * NOTE_H;
            if (pos.x >= x && pos.x <= x + w && pos.y >= y && pos.y <= y + NOTE_H) {
                // 检测是否在右边缘
                if (pos.x >= x + w - EDGE_SIZE && pos.x <= x + w + 2) {
                    return { idx: i, edge: 'right' };
                }
                // 检测是否在左边缘
                if (pos.x <= x + EDGE_SIZE && pos.x >= x - 2) {
                    return { idx: i, edge: 'left' };
                }
                return { idx: i, edge: '' };
            }
        }
        return { idx: -1, edge: '' };
    }

    /** 根据当前框选矩形更新 selectedNotes */
    function updateRangeSelection() {
        if (!rangeSelecting) return;
        const notes = getNotes();
        if (notes.length === 0) return;

        const inRect = notesInRect(rangeStart, rangeEnd);
        if (rangeAddMode) {
            // 追加模式：保留原有 + 加入框内
            inRect.forEach(idx => selectedNotes.add(idx));
        } else {
            selectedNotes.clear();
            inRect.forEach(idx => selectedNotes.add(idx));
        }
    }

    /** 返回与框选矩形相交的音符索引（按矩形坐标转为 beat/pitch 后检测） */
    function notesInRect(start, end) {
        const notes = getNotes();
        if (notes.length === 0) return [];
        const beatW = BAR_W * zoom / 4;

        // 转为 beat/pitch 空间
        const rLeft   = Math.min(start.x, end.x);
        const rRight  = Math.max(start.x, end.x);
        const rTop    = Math.min(start.y, end.y);
        const rBottom = Math.max(start.y, end.y);

        const result = [];
        notes.forEach((note, idx) => {
            const nx = note.beat * beatW;
            const nw = Math.max(note.duration * beatW, 4);
            const rowIdx = (MIDI_MIN + NOTE_COUNT - 1) - note.pitch;
            const ny = rowIdx * NOTE_H;
            const nh = NOTE_H;

            // 矩形相交检测
            if (nx + nw >= rLeft && nx <= rRight && ny + nh >= rTop && ny <= rBottom) {
                result.push(idx);
            }
        });
        return result;
    }

    /**
     * 打开钢琴卷帘
     * @param {Object} track - 轨道对象
     * @param {Object} [clip] - 可选，指定要编辑的乐段；若不传则编辑轨道第一个乐段（或旧 track.notes）
     */
    function openForTrack(track, clip) {
        currentTrack = track;

        // 确定当前 clip
        if (clip) {
            currentClip = clip;
        } else if (track.clips && track.clips.length > 0) {
            currentClip = track.clips[0];
        } else {
            currentClip = null; // 兼容旧轨道（无 clips）
        }

        // 确保 clip.notes 存在
        if (currentClip && !currentClip.notes) {
            currentClip.notes = [];
        }

        // 更新标题
        const clipName = currentClip ? ` — ${currentClip.name || 'Clip'}` : '';
        document.getElementById('pr-title').textContent = '钢琴卷帘 — ' + track.name + clipName;
        document.getElementById('piano-roll-panel').style.display = 'flex';
        selectedNotes.clear();
        resizeCanvas();
        drawKeys();
        drawGrid();
        // 自动滚动到音符所在音高区域
        setTimeout(() => _scrollToNotes(), 0);
    }

    function closePianoRoll() {
        document.getElementById('piano-roll-panel').style.display = 'none';
        currentTrack = null;
        currentClip = null;
    }

    function isOpen() {
        const panel = document.getElementById('piano-roll-panel');
        return panel && panel.style.display !== 'none';
    }

    function refresh() {
        drawGrid();
    }

    // Helpers
    function isBlackKey(midi) {
        const n = midi % 12;
        return [1,3,6,8,10].includes(n);
    }

    function midiToName(midi) {
        const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
        const oct = Math.floor(midi / 12) - 1;
        return names[midi % 12] + oct;
    }

    // ── 自动滚动到音符所在音高区域 ───────────────────────────────

    /** 根据当前 clip（或轨道）的音符计算最佳垂直滚动位置，使音符居中显示 */
    function _scrollToNotes() {
        const notes = getNotes();
        if (notes.length === 0) {
            // 若没有音符，默认滚动到 C4 (MIDI 60) 位置
            if (scrollArea) {
                const c4Row = (MIDI_MIN + NOTE_COUNT - 1) - 60;
                const centerY = c4Row * NOTE_H + NOTE_H / 2;
                const viewH = scrollArea.clientHeight;
                scrollArea.scrollTop = Math.max(0, centerY - viewH / 2);
            }
            return;
        }
        if (!scrollArea) return;

        const pitches = notes.map(n => n.pitch);
        const minP = Math.min(...pitches);
        const maxP = Math.max(...pitches);
        const centerP = Math.round((minP + maxP) / 2);

        // MIDI → 行索引（0 = C8 顶部, 87 = A0 底部）
        const centerRow = (MIDI_MIN + NOTE_COUNT - 1) - centerP;
        const centerY = centerRow * NOTE_H + NOTE_H / 2;

        const viewH = scrollArea.clientHeight;
        let targetScroll = centerY - viewH / 2;

        // 限制边界
        const maxScroll = scrollArea.scrollHeight - viewH;
        targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));

        scrollArea.scrollTop = targetScroll;
        // 同步琴键
        if (keysCanvas) {
            keysCanvas.style.transform = `translateY(${-targetScroll}px)`;
        }
    }

    /** 公开：手动触发适配到音符 */
    function fitToContent() {
        _scrollToNotes();
    }

    /** 获取当前正在编辑的 clip（供外部查询）*/
    function getCurrentClip() {
        return currentClip;
    }

    return { init, openForTrack, closePianoRoll, isOpen, refresh, resizeCanvas, fitToContent, getCurrentClip };
})();
