/**
 * WaveParty Tracks Manager
 * 管理所有轨道：创建/删除/显示/选中/clip编辑
 */

window.Tracks = (function () {
    'use strict';

    const TRACK_COLORS = [
        '#7c4dff', '#00bcd4', '#ff6d00', '#4caf50',
        '#e91e63', '#ffb300', '#00e676', '#ff1744',
        '#3f51b5', '#009688', '#ff5722', '#8bc34a'
    ];

    // 预设 clip 颜色（与轨道颜色区分，更柔和）
    const CLIP_COLORS = [
        '#7c4dff', '#00bcd4', '#ff6d00', '#4caf50',
        '#e91e63', '#ffb300', '#00e676', '#ff1744',
        '#3f51b5', '#009688', '#ff5722', '#8bc34a',
        '#c6a0ff', '#80deea', '#ffb74d', '#a5d6a7',
        '#f48fb1', '#ffe082', '#80cbc4', '#ef9a9a',
    ];

    const INSTRUMENTS = [
        { id: 'acoustic_guitar', name: 'Acoustic Guitar', icon: '🎸', waveform: 'sawtooth' },
        { id: 'electric_bass',   name: 'Electric Bass',   icon: '🎵', waveform: 'triangle' },
        { id: 'tenor_sax',       name: 'Tenor Saxophone', icon: '🎷', waveform: 'square'   },
        { id: 'drums',           name: 'Drums',           icon: '🥁', waveform: 'sine'     },
        { id: 'grand_piano',     name: 'Grand Piano',     icon: '🎹', waveform: 'sine'     },
        { id: 'strings',         name: 'Strings',         icon: '🎻', waveform: 'sawtooth' },
        { id: 'synth_lead',      name: 'Synth Lead',      icon: '🎛', waveform: 'sawtooth' },
        { id: 'choir',           name: 'Choir Pad',       icon: '🎤', waveform: 'sine'     },
    ];

    let tracks = [];
    let selectedTrackId = null;
    let selectedClipId = null;   // 当前选中的 clip
    let nextId = 1;
    const BEAT_W = 80; // px per beat in arrangement view at zoom=1

    // ── 拖拽排序状态 ────────────────────────────────────────────
    let dragSourceIndex = -1;
    let dropIndicator = null;
    let wasDragging = false;  // 标记本次操作是否为拖拽（防止拖拽后误触发 click）

    // 维护每个 clip 的 mini canvas 引用，供实时刷新
    const clipCanvasMap = new Map(); // clipId -> canvas
    let clipResizeState   = null;
    let clipDragPending   = null;
    let clipDragState     = null;
    let clipDragJustFinished = false;

    function init() {
        // 不再自动创建默认轨道，用户需手动点击"添加轨道"
        renderInstrumentPresets();
        bindEvents();
        _updateRightPanelVisibility();
    }

    /** 根据轨道数量控制右侧面板显示：无轨道时显示引导提示 */
    function _updateRightPanelVisibility() {
        const rp = document.getElementById('right-panel');
        const hasTracks = tracks.length > 0;
        if (hasTracks) {
            // 有轨道时，移除引导提示，恢复正常面板
            const hint = document.getElementById('rp-empty-hint');
            if (hint) hint.style.display = 'none';
            // 确保正常内容可见
            document.querySelector('.panel-tabs').style.display = '';
            document.getElementById('panel-instruments').style.display = '';
            if (document.querySelector('.panel-tab.active')?.dataset.panel === 'properties') {
                document.getElementById('panel-properties').style.display = '';
            }
        } else {
            // 无轨道时显示引导提示
            _showEmptyHint(rp);
        }
    }

    function _showEmptyHint(container) {
        let hint = document.getElementById('rp-empty-hint');
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'rp-empty-hint';
            hint.className = 'rp-empty-hint';
            container.appendChild(hint);
        }
        hint.innerHTML = `
            <div class="rp-empty-icon">🎵</div>
            <div class="rp-empty-title">开始创作</div>
            <div class="rp-empty-desc">点击左侧 <strong>「+ 添加轨道」</strong><br>选择一种乐器开始</div>
            <div class="rp-empty-presets">
                ${INSTRUMENTS.slice(0, 6).map(inst => `
                    <button class="rp-quick-inst" data-inst-id="${inst.id}">
                        <span class="rp-qi-icon">${inst.icon}</span>
                        <span class="rp-qi-name">${inst.name}</span>
                    </button>
                `).join('')}
            </div>
        `;
        hint.style.display = '';

        // 隐藏正常的 tab 和内容
        document.querySelector('.panel-tabs').style.display = 'none';
        document.getElementById('panel-instruments').style.display = 'none';
        document.getElementById('panel-properties').style.display = 'none';

        // 快捷按钮点击
        hint.querySelectorAll('.rp-quick-inst').forEach(btn => {
            btn.addEventListener('click', () => {
                const instId = btn.dataset.instId;
                const inst = INSTRUMENTS.find(i => i.id === instId);
                if (inst) addTrack(inst.name + ' ' + (tracks.length + 1), inst);
            });
        });
    }

    function addTrack(name, instrument) {
        // 保存状态（用于撤销）
        if (window.App && window.App.saveState) window.App.saveState();

        const id = 'track_' + (nextId++);
        const colorIdx = tracks.length % TRACK_COLORS.length;
        const track = {
            id,
            name,
            color: TRACK_COLORS[colorIdx],
            instrument: {
                ...instrument,
                adsr: getDefaultADSR(instrument.waveform),
                timbre: [],
                volume: 75,
                pan: 0
            },
            volume: 75,
            pan: 0,
            muted: false,
            soloed: false,
            length: 8,  // 轨道长度（拍数），默认 8 拍 = 2 小节
            notes: [],  // 不生成默认音符，让项目打开时为空白
            clips: [], // 乐段列表：{ id, startBeat, length, name, color }
            nextClipId: 1
        };
        tracks.push(track);
        renderTrack(track);
        renderTrackLane(track);
        _updateRightPanelVisibility();
        return track;
    }

    /** 删除指定轨道，包含 DOM、音频节点、迷你画布等完整清理 */
    function removeTrack(trackId) {
        // 保存状态（用于撤销）
        if (window.App && window.App.saveState) window.App.saveState();

        if (tracks.length <= 1) {
            showToast('至少保留一条轨道');
            return;
        }
        const idx = tracks.findIndex(t => t.id === trackId);
        if (idx === -1) return;

        // 1. 从数据中移除
        tracks.splice(idx, 1);

        // 2. 清理 DOM — track-header
        const header = document.querySelector(`.track-header[data-track-id="${trackId}"]`);
        if (header) header.remove();

        // 3. 清理 DOM — track-lane
        const lane = document.querySelector(`.track-lane[data-track-id="${trackId}"]`);
        if (lane) lane.remove();

        // 4. 清理 clip canvas 引用
        const removedTrack = getTrackById(trackId);
        if (removedTrack && removedTrack.clips) {
            removedTrack.clips.forEach(clip => clipCanvasMap.delete(clip.id));
        }

        // 5. 清理音频引擎资源（gain/pan 节点、语谱图 buffer）
        if (window.AudioEngine && window.AudioEngine.removeTrackNodes) {
            window.AudioEngine.removeTrackNodes(trackId);
        }

        // 6. 如果删除的是当前选中轨道，切换到第一个剩余轨道
        const wasSelected = (selectedTrackId === trackId);
        if (wasSelected) {
            const nextTrack = tracks[0] || null;
            if (nextTrack) {
                selectTrack(nextTrack.id);
                // 如果钢琴卷帘正打开着被删轨道，切换过去
                if (window.PianoRoll && window.PianoRoll.isOpen && window.PianoRoll.isOpen()) {
                    window.PianoRoll.openForTrack(nextTrack);
                }
            } else {
                selectedTrackId = null;
            }
        }

        // 7. 安全网：钢琴卷帘可能引用着一个未选中但已删除的轨道 → 切到第一个轨道
        if (!wasSelected && window.PianoRoll && window.PianoRoll.isOpen && window.PianoRoll.isOpen()) {
            if (tracks.length > 0) {
                window.PianoRoll.openForTrack(tracks[0]);
            } else {
                window.PianoRoll.closePianoRoll();
            }
        }

        showToast('轨道已删除');
        _updateRightPanelVisibility();
    }

    function showToast(msg) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();
        const el = document.createElement('div');
        el.className = 'toast'; el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2000);
    }

    function getDefaultADSR(waveform) {
        const presets = {
            sine:     { attack: 0.05, decay: 0.1, sustain: 0.7, release: 0.3 },
            square:   { attack: 0.02, decay: 0.08, sustain: 0.8, release: 0.2 },
            sawtooth: { attack: 0.01, decay: 0.12, sustain: 0.6, release: 0.25 },
            triangle: { attack: 0.03, decay: 0.1, sustain: 0.75, release: 0.2 }
        };
        return presets[waveform] || presets.sine;
    }

    // Generate some demo notes for each track
    function generateDefaultNotes(id, instrument) {
        if (instrument.id === 'drums') return generateDrumPattern();
        const scales = {
            acoustic_guitar: [60,62,64,65,67,69],
            electric_bass:   [36,38,40,41,43],
            tenor_sax:       [60,63,65,67,70],
            grand_piano:     [60,62,64,67,69,71,72],
            strings:         [55,57,59,60,62],
            synth_lead:      [60,62,65,67,70],
            choir:           [60,64,67,72]
        };
        const scale = scales[instrument.id] || [60,62,64,67];
        const notes = [];
        for (let i = 0; i < 16; i++) {
            if (Math.random() < 0.6) {
                notes.push({
                    pitch: scale[Math.floor(Math.random() * scale.length)],
                    beat: i * 0.5,
                    duration: 0.4,
                    velocity: 70 + Math.floor(Math.random() * 40)
                });
            }
        }
        return notes;
    }

    function generateDrumPattern() {
        const notes = [];
        // Kick on 0, 2; Snare on 1, 3; Hi-hat every 0.5
        for (let bar = 0; bar < 2; bar++) {
            const base = bar * 4;
            notes.push({ pitch: 36, beat: base + 0, duration: 0.2, velocity: 110 });
            notes.push({ pitch: 36, beat: base + 2, duration: 0.2, velocity: 100 });
            notes.push({ pitch: 38, beat: base + 1, duration: 0.2, velocity: 90 });
            notes.push({ pitch: 38, beat: base + 3, duration: 0.2, velocity: 85 });
            for (let h = 0; h < 8; h++) {
                notes.push({ pitch: 42, beat: base + h * 0.5, duration: 0.15, velocity: 60 + Math.random() * 20 });
            }
        }
        return notes;
    }

    function renderTrack(track) {
        const list = document.getElementById('track-header-list');
        const el = document.createElement('div');
        el.className = 'track-header';
        el.dataset.trackId = track.id;
        el.innerHTML = `
            <button class="track-delete-btn" title="删除轨道">×</button>
            <div class="track-name-row">
                <div class="track-color-dot" style="background:${track.color}"></div>
                <div class="track-name">${track.name}</div>
                <div class="track-instrument-badge">${track.instrument.icon || ''}</div>
            </div>
            <div class="track-controls">
                <button class="track-ctrl-btn btn-mute" title="静音">M</button>
                <button class="track-ctrl-btn btn-solo" title="独奏">S</button>
                <input type="range" class="track-vol-mini" min="0" max="100" value="${track.volume}" title="音量">
                <span class="track-vol-pct">${track.volume}%</span>
            </div>
        `;

        el.addEventListener('click', (e) => {
            if (wasDragging) return;  // 拖拽操作后跳过
            if (e.target.classList.contains('btn-mute')) return;
            if (e.target.classList.contains('btn-solo')) return;
            if (e.target.classList.contains('track-vol-mini')) return;
            if (e.target.classList.contains('track-delete-btn')) return;
            selectTrack(track.id);
        });
        el.addEventListener('dblclick', () => {
            selectTrack(track.id);
            PianoRoll.openForTrack(track);
        });

        // 删除轨道按钮
        el.querySelector('.track-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            removeTrack(track.id);
        });

        el.querySelector('.btn-mute').addEventListener('click', (e) => {
            e.stopPropagation();
            track.muted = !track.muted;
            e.target.classList.toggle('muted', track.muted);
            AudioEngine.setTrackVolume(track.id, track.muted ? 0 : track.volume);
        });
        el.querySelector('.btn-solo').addEventListener('click', (e) => {
            e.stopPropagation();
            track.soloed = !track.soloed;
            e.target.classList.toggle('soloed', track.soloed);
        });
        el.querySelector('.track-vol-mini').addEventListener('input', (e) => {
            e.stopPropagation();
            track.volume = parseInt(e.target.value);
            el.querySelector('.track-vol-pct').textContent = track.volume + '%';
            if (!track.muted) AudioEngine.setTrackVolume(track.id, track.volume);
        });

        // ── 拖拽排序 ─────────────────────────────────────────
        el.draggable = true;
        el.addEventListener('dragstart', (e) => {
            // 如果点击的是按钮/滑块/删除按钮，不启动拖拽
            if (e.target.closest('button') || e.target.closest('input')) {
                e.preventDefault();
                return;
            }
            dragSourceIndex = _getTrackIndex(track.id);
            wasDragging = false;
            el.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            // 设置半透明拖拽图像
            const ghost = el.cloneNode(true);
            ghost.style.position = 'absolute';
            ghost.style.top = '-9999px';
            ghost.style.width = el.offsetWidth + 'px';
            ghost.style.opacity = '0.5';
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, 0, 0);
            setTimeout(() => ghost.remove(), 10);
        });
        el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
            _removeDropIndicator();
            dragSourceIndex = -1;
            // 拖拽结束后短暂标记，阻止后续 click 事件
            if (!wasDragging) {
                // 如果没触发 drop（比如拖到外面），也清理
            }
            setTimeout(() => { wasDragging = false; }, 50);
        });

        // ── 插入/替换到正确位置 ─────────────────────────────────
        const oldHeader = list.querySelector(`.track-header[data-track-id="${track.id}"]`);
        if (oldHeader) {
            list.replaceChild(el, oldHeader);
        } else {
            // 新轨道：插入到与 tracks 数组索引一致的位置
            const trackIdx = tracks.findIndex(t => t.id === track.id);
            if (trackIdx === 0) {
                list.insertBefore(el, list.firstChild);
            } else {
                const headers = list.querySelectorAll('.track-header');
                if (trackIdx > 0 && headers.length >= trackIdx) {
                    const refHeader = headers[trackIdx - 1];
                    if (refHeader && refHeader.nextSibling) {
                        list.insertBefore(el, refHeader.nextSibling);
                    } else {
                        list.appendChild(el);
                    }
                } else {
                    list.appendChild(el);
                }
            }
        }
    }

    function renderTrackLane(track) {
        const container = document.getElementById('tracks-container');
        const lane = document.createElement('div');
        lane.className = 'track-lane';
        lane.dataset.trackId = track.id;
        lane.style.setProperty('--beat-w', BEAT_W + 'px');

        // 设置 lane 宽度为足够长，支持无限向右滚动（留 20 拍缓冲）
        const minBeats = Math.max(track.length + 20, 50);
        lane.style.width = (minBeats * BEAT_W) + 'px';
        lane.style.minWidth = '100%';

        // ── 确保乐段列表存在（向后兼容）───
        if (!track.clips) track.clips = [];
        if (track.clips.length === 0) {
            track.clips.push({
                id: track.id + '-clip-' + (track.nextClipId || 1),
                startBeat: 0,
                length: track.length || 8,
                name: 'Clip 1'
            });
            track.nextClipId = (track.nextClipId || 1) + 1;
        }

        // ── 为每条乐段创建 clip 元素 ──────────
        track.clips.forEach((clip, clipIdx) => {
            const clipEl = document.createElement('div');
            clipEl.className = 'clip';
            clipEl.dataset.clipId = clip.id;
            // 使用 clip 自定义颜色（若设置），否则使用轨道颜色
            clipEl.style.background = (clip.color && clip.color !== 'track')
                ? clip.color
                : track.color;
            clipEl.style.opacity = 0.82 + (clipIdx % 4) * 0.05;

            const clipLeft = clip.startBeat * BEAT_W + 2;
            const clipW = Math.max(BEAT_W, clip.length * BEAT_W - 4);
            clipEl.style.left = clipLeft + 'px';
            clipEl.style.width = clipW + 'px';

            clipEl.innerHTML = `
                <div class="clip-resize-handle clip-resize-left" data-edge="left"></div>
                <canvas class="clip-canvas" width="${Math.max(50, clipW)}" height="50"></canvas>
                <div class="clip-label">${clip.name || 'C' + (clipIdx + 1)}</div>
                <div class="clip-resize-handle clip-resize-right" data-edge="right"></div>
            `;
            lane.appendChild(clipEl);

            // 存储 canvas 引用（按 clipId 索引）
            const miniCanvas = clipEl.querySelector('.clip-canvas');
            clipCanvasMap.set(clip.id, miniCanvas);
            renderMiniNotesForClip(track, clip, miniCanvas);

            // 双击 clip 标签：重命名
            const label = clipEl.querySelector('.clip-label');
            if (label) {
                label.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    _renameClip(clip, clipEl, track);
                });
                // 右键 clip 标签：打开颜色选择面板
                label.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    _showClipColorPicker(clip, clipEl, track);
                });
            }

            // ── Clip 事件绑定 ─────────────────────
            // 指针按下：处理拖拽、单击打开钢琴卷帘、双击删除 clip
            // 用 pointerdown 替代 mousedown/click/dblclick，统一处理，支持触摸
            clipEl.addEventListener('pointerdown', (e) => {
                if (e.target.classList && e.target.classList.contains('clip-resize-handle')) {
                    e.preventDefault();
                    const edge = e.target.dataset.edge;
                    _startClipResize(e, track, clip, clipEl, edge);
                    return;
                }

                e.stopPropagation();
                // 不调用 preventDefault，让浏览器正常派发 click/dblclick 事件

                // ── 双击检测 ──────────────────────────────
                const now = Date.now();
                if (clipEl._lastClickTime && (now - clipEl._lastClickTime) < 400) {
                    // 双击：删除 clip
                    clipEl._lastClickTime = 0;
                    _deleteClip(track, clip);
                    return;
                }
                clipEl._lastClickTime = now;

                // ── 延迟拖拽：移动超阈值才开始拖拽 ─────
                clipEl.setPointerCapture(e.pointerId);

                clipDragPending = {
                    track, clip, clipEl, lane,
                    startX: e.clientX,
                    startY: e.clientY,
                    startLeft: parseFloat(clipEl.style.left) || 0,
                    pointerId: e.pointerId,
                    hasMoved: false,
                };

                const onMove = (e) => {
                    if (!clipDragPending) return;
                    const dx = e.clientX - clipDragPending.startX;
                    const dy = e.clientY - clipDragPending.startY;
                    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                        clipDragPending.hasMoved = true;
                        document.removeEventListener('pointermove', onMove);
                        document.removeEventListener('pointerup', onUp);
                        _startClipDrag(
                            clipDragPending.startX, clipDragPending.startLeft,
                            clipDragPending.track, clipDragPending.clip,
                            clipDragPending.clipEl, clipDragPending.lane,
                            clipDragPending.pointerId
                        );
                        _onClipDragMove(e);
                    }
                };
                const onUp = (e) => {
                    document.removeEventListener('pointermove', onMove);
                    document.removeEventListener('pointerup', onUp);
                    if (!clipDragPending) return;
                    if (!clipDragPending.hasMoved) {
                        // 单击：选中并打开钢琴卷帘
                        selectClip(clip.id, track.id);
                        if (window.PianoRoll && window.PianoRoll.openForTrack) {
                            window.PianoRoll.openForTrack(track, clip);
                        }
                    }
                    try { clipEl.releasePointerCapture(clipDragPending.pointerId); } catch(ex) {}
                    clipDragPending = null;
                };
                document.addEventListener('pointermove', onMove);
                document.addEventListener('pointerup', onUp);
            });
        });

        // ── Lane 空白区域点击：新建乐段 ─────
        lane.addEventListener('click', (e) => {
            if (e.target === lane && !clipDragJustFinished) {
                _createClipAtClick(track, lane, e);
            }
        });

        lane.addEventListener('dblclick', (e) => {
            if (e.target === lane) {
                selectTrack(track.id);
                PianoRoll.openForTrack(track);
            }
        });

        // ── 插入/替换到正确位置 ─────────────────────────────────
        const oldLane = container.querySelector(`.track-lane[data-track-id="${track.id}"]`);
        if (oldLane) {
            container.replaceChild(lane, oldLane);
        } else {
            // 新轨道：插入到与 tracks 数组索引一致的位置
            const trackIdx = tracks.findIndex(t => t.id === track.id);
            if (trackIdx === 0) {
                container.insertBefore(lane, container.firstChild);
            } else {
                const lanes = container.querySelectorAll('.track-lane');
                if (trackIdx > 0 && lanes.length >= trackIdx) {
                    const refLane = lanes[trackIdx - 1];
                    if (refLane && refLane.nextSibling) {
                        container.insertBefore(lane, refLane.nextSibling);
                    } else {
                        container.appendChild(lane);
                    }
                } else {
                    container.appendChild(lane);
                }
            }
        }
    }

    /** 在 lane 空白处单击时创建新音符 */
    function _createNoteAtClick(track, lane, e) {
        const container = document.getElementById('tracks-container');
        const rect = lane.getBoundingClientRect();
        const x = e.clientX - rect.left + container.scrollLeft;
        const beat = Math.max(0, x / BEAT_W);
        const snap = 0.25; // 1/4 拍对齐
        const snappedBeat = Math.round(beat / snap) * snap;

        // 找到该位置所属的 clip
        const targetClip = track.clips.find(c =>
            snappedBeat >= c.startBeat && snappedBeat < c.startBeat + c.length
        );

        // 默认 C4 (60)，时长 1 拍
        const note = { pitch: 60, beat: snappedBeat, duration: 1, velocity: 100 };
        if (targetClip) note.clipId = targetClip.id;
        track.notes.push(note);

        // 如果音符超出当前轨道长度，自动延长
        const endBeat = snappedBeat + 1;
        if (endBeat > track.length) {
            track.length = Math.ceil(endBeat);
            refreshTrackLaneLayout(track);
        }

        refreshMiniNotes(track.id);

        // 播放预览音
        if (window.AudioEngine) {
            AudioEngine.playNote(track.id, note.pitch, track.instrument, 0.15);
        }
    }

    /** 开始拖动 clip（延迟拖拽模式：移动超阈值后才调用） */
    function _startClipDrag(startX, startLeft, track, clip, clipEl, lane, pointerId) {
        // 保存状态（用于撤销）
        if (window.App && window.App.saveState) window.App.saveState();

        const container = document.getElementById('tracks-container');

        clipDragState = {
            trackId: track.id,
            track: track,
            clipId: clip.id,
            clip: clip,
            clipEl: clipEl,
            lane: lane,
            startX: startX,
            startLeft: startLeft,
            scrollLeft: container.scrollLeft,
            origStartBeat: clip.startBeat,
            pointerId: pointerId,
        };
        clipEl.style.cursor = 'grabbing';
        clipEl.classList.add('dragging');
        clipEl.setPointerCapture(pointerId);

        document.addEventListener('pointermove', _onClipDragMove);
        document.addEventListener('pointerup', _onClipDragEnd);
        document.addEventListener('pointercancel', _onClipDragEnd);
    }

    /** clip 拖动中 */
    function _onClipDragMove(e) {
        if (!clipDragState) return;
        const { clipEl, startX, startLeft } = clipDragState;
        const deltaX = e.clientX - startX;
        let newLeft = startLeft + deltaX;
        // 限制不超出左边界
        newLeft = Math.max(2, newLeft);
        clipEl.style.left = newLeft + 'px';
    }

    /** clip 拖动结束 */
    function _onClipDragEnd(e) {
        if (!clipDragState) return;
        const { track, clip, clipEl, startX, startLeft, pointerId } = clipDragState;

        // 释放指针捕获
        try { clipEl.releasePointerCapture(pointerId); } catch(ex) {}

        const deltaX = e.clientX - startX;
        let newLeft = startLeft + deltaX;
        newLeft = Math.max(2, newLeft);

        // 计算 beat 偏移并吸附到 1/4 拍
        const deltaBeatRaw = (newLeft - startLeft) / BEAT_W;
        const snap = 0.25;
        const deltaBeat = Math.round(deltaBeatRaw / snap) * snap;

        // 更新 clip 起始拍位（clip.notes 是相对拍位，无需修改）
        clip.startBeat = Math.max(0, clip.startBeat + deltaBeat);

        // 重新定位 clip 元素（用更新后的 startBeat）
        clipEl.style.left = (clip.startBeat * BEAT_W + 2) + 'px';
        clipEl.style.cursor = 'grab';
        clipEl.classList.remove('dragging');

        // 刷新该乐段的迷你音符
        const canvas = clipCanvasMap.get(clip.id);
        if (canvas && track) renderMiniNotesForClip(track, clip, canvas);

        // 如果乐段超出轨道长度，自动延长，并扩展 lane 宽度（支持无限向右滚动）
        const maxEnd = track.clips.reduce((max, c) => Math.max(max, c.startBeat + c.length), 0);
        if (maxEnd > track.length) {
            track.length = Math.ceil(maxEnd);
        }
        // 始终给 lane 留 20 拍的向右缓冲空间
        const lane = document.querySelector(`.track-lane[data-track-id="${track.id}"]`);
        if (lane) {
            const minBeats = Math.max(track.length + 20, 50);
            lane.style.width = (minBeats * BEAT_W) + 'px';
        }

        document.removeEventListener('pointermove', _onClipDragMove);
        document.removeEventListener('pointerup', _onClipDragEnd);
        document.removeEventListener('pointercancel', _onClipDragEnd);
        clipDragState = null;
        // 短暂标记，防止拖动结束后 lane 上的 click 误新建音符
        clipDragJustFinished = true;
        setTimeout(() => { clipDragJustFinished = false; }, 50);
    }

    /** 在 lane 空白区域单击时创建新乐段 */
    function _createClipAtClick(track, lane, e) {
        // 保存状态（用于撤销）
        if (window.App && window.App.saveState) window.App.saveState();

        const container = document.getElementById('tracks-container');
        const rect = lane.getBoundingClientRect();
        const x = e.clientX - rect.left + container.scrollLeft;
        const beat = Math.max(0, x / BEAT_W);
        const snap = 0.25;
        const snappedBeat = Math.round(beat / snap) * snap;

        // 检查是否点在已有乐段上
        const clickedClip = track.clips.find(c =>
            snappedBeat >= c.startBeat && snappedBeat < c.startBeat + c.length
        );
        if (clickedClip) return; // 点在已有乐段上，不创建新乐段

        const clipId = track.id + '-clip-' + (track.nextClipId || 1);
        track.nextClipId = (track.nextClipId || 1) + 1;

        const newClip = {
            id: clipId,
            startBeat: snappedBeat,
            length: 4,
            name: 'Clip ' + track.clips.length
        };
        track.clips.push(newClip);

        // 重新渲染整条 lane（renderTrackLane 内部会用 replaceChild 替换，无需手动 remove）
        renderTrackLane(track);

        showToast('新乐段已创建（从 ' + snappedBeat + ' 拍开始）');
    }

    /** 重命名乐段 */
    function _renameClip(clip, clipEl, track) {
        if (!clipEl || !clip) return;

        const label = clipEl.querySelector('.clip-label');
        if (!label) return;

        // 检查是否已有输入框
        if (clipEl.querySelector('.clip-rename-input')) return;

        const oldName = clip.name || label.textContent;

        // 创建内联输入框
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'clip-rename-input';
        input.value = oldName;
        clipEl.appendChild(input);
        input.focus();
        input.select();

        const finish = (commit) => {
            if (commit) {
                const newName = input.value.trim() || oldName;
                clip.name = newName;
                label.textContent = newName;
                // 更新钢琴卷帘标题
                if (window.PianoRoll && PianoRoll.isOpen && PianoRoll.isOpen() && PianoRoll.getCurrentClip) {
                    const prClip = PianoRoll.getCurrentClip();
                    if (prClip && prClip.id === clip.id) {
                        const titleEl = document.getElementById('pr-title');
                        if (titleEl && track) {
                            titleEl.textContent = '钢琴卷帘 — ' + track.name + ' — ' + newName;
                        }
                    }
                }
            }
            input.remove();
        };

        input.addEventListener('blur', () => finish(true));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        });
    }

    /** 显示 clip 颜色选择面板 */
    function _showClipColorPicker(clip, clipEl, track) {
        // 移除已存在的面板
        const oldPanel = document.querySelector('.clip-color-panel');
        if (oldPanel) oldPanel.remove();

        // 创建面板
        const panel = document.createElement('div');
        panel.className = 'clip-color-panel';
        panel.innerHTML = `
            <div class="ccp-header">🎨 选择 Clip 颜色</div>
            <div class="ccp-presets"></div>
            <div class="ccp-custom">
                <label>自定义：</label>
                <input type="color" class="ccp-color-input" value="${clip.color || track.color}">
                <button class="ccp-apply-btn">应用</button>
            </div>
            <div class="ccp-actions">
                <button class="ccp-clear-btn">恢复默认</button>
                <button class="ccp-close-btn">关闭</button>
            </div>
        `;
        document.body.appendChild(panel);

        // 填充预设颜色
        const presetsContainer = panel.querySelector('.ccp-presets');
        CLIP_COLORS.forEach(c => {
            const swatch = document.createElement('div');
            swatch.className = 'ccp-swatch' + (clip.color === c ? ' ccp-active' : '');
            swatch.style.background = c;
            swatch.title = c;
            swatch.addEventListener('click', () => {
                _applyClipColor(clip, clipEl, c);
                panel.remove();
            });
            presetsContainer.appendChild(swatch);
        });

        // 自定义取色器
        const colorInput = panel.querySelector('.ccp-color-input');
        panel.querySelector('.ccp-apply-btn').addEventListener('click', () => {
            const c = colorInput.value;
            _applyClipColor(clip, clipEl, c);
            panel.remove();
        });

        // 恢复默认（使用轨道颜色）
        panel.querySelector('.ccp-clear-btn').addEventListener('click', () => {
            clip.color = null;
            clipEl.style.background = track.color;
            panel.remove();
            showToast('已恢复默认颜色');
        });

        // 关闭按钮
        panel.querySelector('.ccp-close-btn').addEventListener('click', () => {
            panel.remove();
        });

        // 点击面板外部关闭
        setTimeout(() => {
            const outsideClick = (e) => {
                if (!panel.contains(e.target)) {
                    panel.remove();
                    document.removeEventListener('mousedown', outsideClick);
                }
            };
            document.addEventListener('mousedown', outsideClick);
        }, 0);

        // 定位面板（在鼠标位置或 clip 附近）
        const rect = clipEl.getBoundingClientRect();
        panel.style.left = Math.min(rect.left, window.innerWidth - 260) + 'px';
        panel.style.top  = Math.min(rect.bottom + 4, window.innerHeight - 200) + 'px';
    }

    /** 应用颜色到 clip */
    function _applyClipColor(clip, clipEl, color) {
        // 保存状态（用于撤销）
        if (window.App && window.App.saveState) window.App.saveState();
        clip.color = color;
        clipEl.style.background = color;
        showToast('Clip 颜色已更新');
    }

    /**
     * 供外部调用：根据 clipId 设置 clip 颜色
     * @param {string} clipId
     * @param {string} color - 十六进制颜色值，null 表示恢复默认
     */
    function setClipColor(clipId, color) {
        for (const track of tracks) {
            const clip = track.clips.find(c => c.id === clipId);
            if (!clip) continue;
            const clipEl = document.querySelector(`.clip[data-clip-id="${clipId}"]`);
            if (!clipEl) return;
            if (color === null) {
                clip.color = null;
                clipEl.style.background = track.color;
                showToast('已恢复默认颜色');
            } else {
                _applyClipColor(clip, clipEl, color);
            }
            return;
        }
    }

    /** 删除指定 clip */
    function _deleteClip(track, clip) {
        if (!confirm('确定要删除这个乐段吗？')) return;

        // 保存状态（用于撤销）
        if (window.App && window.App.saveState) window.App.saveState();

        // 1. 从数据中移除
        const clipIdx = track.clips.findIndex(c => c.id === clip.id);
        if (clipIdx === -1) return;
        track.clips.splice(clipIdx, 1);

        // 2. 清理 DOM — clip 元素
        const clipEl = document.querySelector(`.clip[data-clip-id="${clip.id}"]`);
        if (clipEl) clipEl.remove();

        // 3. 清理 clip canvas 引用
        clipCanvasMap.delete(clip.id);

        // 4. 如果删除的是当前选中的 clip，清空选中状态
        if (selectedClipId === clip.id) {
            selectedClipId = null;
            document.querySelectorAll('.clip-selected').forEach(el => el.classList.remove('clip-selected'));
        }

        showToast('乐段已删除');

        // 5. 重新渲染 lane
        renderTrackLane(track);
    }

    /** 开始改变乐段长度（拖动边缘）*/
    function _startClipResize(e, track, clip, clipEl, edge) {
        e.stopPropagation();
        e.preventDefault();

        // 保存状态（用于撤销）
        if (window.App && window.App.saveState) window.App.saveState();

        clipResizeState = {
            trackId: track.id,
            clipId: clip.id,
            clip: clip,
            clipEl: clipEl,
            edge: edge,
            startX: e.clientX,
            startWidth: parseFloat(clipEl.style.width) || (clip.length * BEAT_W),
            startLeft: parseFloat(clipEl.style.left) || (clip.startBeat * BEAT_W),
            startLength: clip.length,
            startStartBeat: clip.startBeat,
            pointerId: e.pointerId, // 保存指针 ID，用于释放捕获
        };

        clipEl.style.cursor = 'ew-resize';
        clipEl.setPointerCapture(e.pointerId); // 捕获指针，支持触摸拖拽
        document.addEventListener('pointermove', _onClipResizeMove);
        document.addEventListener('pointerup', _onClipResizeEnd);
        document.addEventListener('pointercancel', _onClipResizeEnd); // 触摸取消时也结束
    }

    /** 改变长度中 */
    function _onClipResizeMove(e) {
        if (!clipResizeState) return;
        const { clipEl, edge, startX, startWidth, startLeft } = clipResizeState;
        const deltaX = e.clientX - startX;

        if (edge === 'right') {
            let newWidth = startWidth + deltaX;
            newWidth = Math.max(BEAT_W, newWidth);
            clipEl.style.width = newWidth + 'px';
        } else if (edge === 'left') {
            let newLeft = startLeft + deltaX;
            let newWidth = startWidth - deltaX;
            newLeft = Math.max(2, newLeft);
            newWidth = Math.max(BEAT_W, newWidth);
            clipEl.style.left = newLeft + 'px';
            clipEl.style.width = newWidth + 'px';
        }
    }

    /** 改变长度结束 */
    function _onClipResizeEnd(e) {
        if (!clipResizeState) return;
        const { trackId, clipId, clip, clipEl, edge, startX, startWidth, startLeft,
              startLength, startStartBeat, pointerId } = clipResizeState;
        const track = getTrackById(trackId);
        if (!track) return;

        // 释放指针捕获
        try { clipEl.releasePointerCapture(pointerId); } catch(ex) {}

        const deltaX = e.clientX - startX;

        if (edge === 'right') {
            const newWidth = Math.max(BEAT_W, startWidth + deltaX);
            clip.length = Math.round(newWidth / BEAT_W * 4) / 4;
        } else if (edge === 'left') {
            const newLeft = Math.max(2, startLeft + deltaX);
            const newWidth = Math.max(BEAT_W, startWidth - deltaX);
            clip.startBeat = Math.round((newLeft - 2) / BEAT_W * 4) / 4;
            clip.length = Math.round(newWidth / BEAT_W * 4) / 4;
        }

        // 更新 clip 元素位置和宽度
        clipEl.style.left = (clip.startBeat * BEAT_W + 2) + 'px';
        clipEl.style.width = (clip.length * BEAT_W - 4) + 'px';
        clipEl.style.cursor = '';

        // 更新轨道总长度，并自动扩展 lane 宽度（支持无限向右滚动）
        const maxEnd = Math.max(...track.clips.map(c => c.startBeat + c.length));
        if (maxEnd > track.length) {
            track.length = Math.ceil(maxEnd);
        }
        // 始终给 lane 留 20 拍的向右缓冲空间，支持平板上无限拖拽延长
        const lane = document.querySelector(`.track-lane[data-track-id="${track.id}"]`);
        if (lane) {
            const minBeats = Math.max(track.length + 20, 50);
            lane.style.width = (minBeats * BEAT_W) + 'px';
        }

        document.removeEventListener('pointermove', _onClipResizeMove);
        document.removeEventListener('pointerup', _onClipResizeEnd);
        document.removeEventListener('pointercancel', _onClipResizeEnd);
        clipResizeState = null;

        // 重新渲染迷你音符
        const canvas = clipCanvasMap.get(clipId);
        if (canvas && track) renderMiniNotesForClip(track, clip, canvas);

        // 如果钢琴卷帘正在编辑该 clip，同步刷新画布宽度
        if (window.PianoRoll && PianoRoll.isOpen && PianoRoll.isOpen() && PianoRoll.getCurrentClip) {
            const prClip = PianoRoll.getCurrentClip();
            if (prClip && prClip.id === clipId) {
                setTimeout(() => {
                    PianoRoll.resizeCanvas();
                    PianoRoll.refresh();
                }, 0);
            }
        }
    }

    /** 渲染单条乐段的迷你音符 */
    function renderMiniNotesForClip(track, clip, canvas) {
        if (!canvas) return;
        // 同步 canvas 内部像素尺寸与实际显示尺寸（避免 CSS 缩放导致拉伸）
        const displayW = Math.max(10, canvas.offsetWidth || canvas.clientWidth || 200);
        const displayH = Math.max(20, canvas.offsetHeight || canvas.clientHeight || 50);
        if (Math.abs(canvas.width - displayW) > 2 || Math.abs(canvas.height - displayH) > 2) {
            canvas.width = displayW;
            canvas.height = displayH;
        }
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        // 优先使用 clip.notes（独立音符），兼容旧 track.notes（通过 clipId 关联）
        const clipNotes = clip.notes
            ? clip.notes
            : (track.notes || []).filter(n => n.clipId === clip.id);

        if (clipNotes.length === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.font = '10px sans-serif';
            ctx.fillText('empty', 6, H / 2 + 4);
            return;
        }

        const minPitch = Math.min(...clipNotes.map(n => n.pitch));
        const maxPitch = Math.max(...clipNotes.map(n => n.pitch));
        const pitchRange = Math.max(1, maxPitch - minPitch || 12);

        clipNotes.forEach(note => {
            // note.beat 是相对于 clip 内部的拍数（从 0 开始），直接用 note.beat / clip.length 计算相对位置
            const x = (note.beat / clip.length) * W;
            const w = Math.max((note.duration / clip.length) * W, 2);
            const y = H - 4 - ((note.pitch - minPitch) / pitchRange) * (H - 8);
            ctx.fillStyle = 'rgba(255,255,255,0.75)';
            ctx.fillRect(x, y, w, 3);
        });
    }

    function renderMiniNotes(track, canvas) {
        // 向后兼容：遍历所有乐段分别渲染
        if (!track.clips) return;
        track.clips.forEach(clip => {
            const canvas = clipCanvasMap.get(clip.id);
            if (canvas) renderMiniNotesForClip(track, clip, canvas);
        });
    }

    function selectTrack(id) {
        selectedTrackId = id;
        document.querySelectorAll('.track-header').forEach(el => {
            el.classList.toggle('active', el.dataset.trackId === id);
        });
        document.querySelectorAll('.track-lane').forEach(el => {
            el.style.background = el.dataset.trackId === id ? 'rgba(124,77,255,0.06)' : '';
        });
        const track = getTrackById(id);
        if (track) updatePropertiesPanel(track);
    }

    /** 选中指定 clip（高亮显示） */
    function selectClip(clipId, trackId) {
        selectedClipId = clipId;
        selectedTrackId = trackId;
        // 高亮对应的 track header
        document.querySelectorAll('.track-header').forEach(el => {
            el.classList.toggle('active', el.dataset.trackId === trackId);
        });
        // 高亮对应的 clip
        document.querySelectorAll('.clip').forEach(el => {
            el.classList.toggle('clip-selected', el.dataset.clipId === clipId);
        });
        // 同步选中轨道
        const track = getTrackById(trackId);
        if (track) updatePropertiesPanel(track);
    }

    /** 获取当前选中的 clip 对象 */
    function getSelectedClip() {
        if (!selectedClipId) return null;
        for (const t of tracks) {
            for (const c of t.clips) {
                if (c.id === selectedClipId) return c;
            }
        }
        return null;
    }

    /** 获取当前选中的 clipId */
    function getSelectedClipId() {
        return selectedClipId;
    }

    function updatePropertiesPanel(track) {
        const nameEl = document.getElementById('sel-track-name');
        if (nameEl) nameEl.textContent = `${track.instrument.icon || ''} ${track.name}`;
        const volEl = document.getElementById('prop-volume');
        if (volEl) volEl.value = track.volume;
        const panEl = document.getElementById('prop-pan');
        if (panEl) panEl.value = track.pan;
        const lenEl = document.getElementById('prop-length');
        if (lenEl) lenEl.value = track.length || 8;
        const lenDisp = document.getElementById('prop-length-display');
        if (lenDisp) lenDisp.textContent = (track.length || 8) + ' 拍';
        // 音色模式显示
        const modeEl = document.getElementById('prop-timbre-mode');
        if (modeEl) {
            const isSpectrogram = track.instrument.timbreMode === 'spectrogram';
            const isSample     = track.instrument.timbreMode === 'sample';
            if (isSample) {
                const fname = track.instrument.sampleData
                    ? track.instrument.sampleData.fileName : '';
                modeEl.textContent = '🎵 采样 ' + (fname ? '(' + fname.slice(0, 12) + ')' : '');
                modeEl.style.color = '#ff9800';
            } else if (isSpectrogram) {
                modeEl.textContent = '📊 语谱图';
                modeEl.style.color = '#00bcd4';
            } else {
                modeEl.textContent = '🎛 贝塞尔';
                modeEl.style.color = '#7c4dff';
            }
        }

        // ── Clip 音量渐变编辑器：选中 clip 时显示 ──
        _updateClipVolEnvUI();
    }

    function renderInstrumentPresets() {
        const list = document.getElementById('instrument-preset-list');
        INSTRUMENTS.forEach(inst => {
            const el = document.createElement('div');
            el.className = 'instrument-item';
            el.innerHTML = `
                <div class="instrument-icon">${inst.icon}</div>
                <div class="instrument-info">
                    <div class="instrument-name">${inst.name}</div>
                    <div class="instrument-desc">${inst.waveform}</div>
                </div>
            `;
            el.addEventListener('click', () => {
                // Add new track with this instrument
                addTrack(inst.name, inst);
            });
            list.appendChild(el);
        });
    }

    function bindEvents() {
        // 注意：btn-add-track 的点击已通过 HTML onclick="window.Tracks.addDefaultTrack()" 绑定，
        // 此处不再重复绑定，避免双击重复添加轨道。

        // Panel tabs
        document.querySelectorAll('.panel-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.panel-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('panel-instruments').style.display = btn.dataset.panel === 'instruments' ? '' : 'none';
                document.getElementById('panel-properties').style.display = btn.dataset.panel === 'properties' ? '' : 'none';
            });
        });

        document.getElementById('prop-volume').addEventListener('input', e => {
            const t = getSelectedTrack();
            if (t) { t.volume = parseInt(e.target.value); AudioEngine.setTrackVolume(t.id, t.volume); }
        });
        document.getElementById('prop-pan').addEventListener('input', e => {
            const t = getSelectedTrack();
            if (t) { t.pan = parseInt(e.target.value); AudioEngine.setTrackPan(t.id, t.pan); }
        });
        const lenEl = document.getElementById('prop-length');
        if (lenEl) {
            // 在拖动开始时保存状态（mousedown），避免每次 input 都保存
            lenEl.addEventListener('mousedown', () => {
                if (window.App && window.App.saveState) window.App.saveState();
            });
            lenEl.addEventListener('input', e => {
                const t = getSelectedTrack();
                if (!t) return;
                t.length = Math.max(1, Math.min(64, parseInt(e.target.value) || 8));
                const lenDisp = document.getElementById('prop-length-display');
                if (lenDisp) lenDisp.textContent = t.length + ' 拍';
                // 刷新轨道 lane 宽度和 mini 视图
                refreshTrackLaneLayout(t);
                refreshMiniNotes(t.id);
                // 刷新标尺
                if (window.App && window.App.renderRuler) window.App.renderRuler();
                // 刷新钢琴卷帘
                if (window.PianoRoll && window.PianoRoll.isOpen()) {
                    window.PianoRoll.resizeCanvas();
                    window.PianoRoll.refresh();
                }
            });
        }

        // ── 拖拽排序：容器级事件 ────────────────────────────────
        const headerList = document.getElementById('track-header-list');
        if (headerList) {
            headerList.addEventListener('dragover', _onDragOver);
            headerList.addEventListener('drop', _onDrop);
            headerList.addEventListener('dragleave', (e) => {
                // 只在真正离开容器时移除指示器
                if (!headerList.contains(e.relatedTarget)) {
                    _removeDropIndicator();
                }
            });
        }
    }

    function getTrackById(id) { return tracks.find(t => t.id === id); }
    function getSelectedTrack() { return tracks.find(t => t.id === selectedTrackId); }
    function getAllTracks() { return tracks; }

    /** 实时刷新指定轨道的所有 clip 迷你音符预览 */
    function refreshMiniNotes(trackId) {
        const track = getTrackById(trackId);
        if (!track || !track.clips) return;
        track.clips.forEach(clip => {
            const canvas = clipCanvasMap.get(clip.id);
            if (canvas) renderMiniNotesForClip(track, clip, canvas);
        });
    }

    /** 刷新轨道 lane 的 clip 宽度和 canvas 尺寸（长度改变时调用） */
    function refreshTrackLaneLayout(track) {
        const lane = document.querySelector(`.track-lane[data-track-id="${track.id}"]`);
        if (!lane) return;

        track.clips.forEach(clip => {
            const clipEl = lane.querySelector(`[data-clip-id="${clip.id}"]`);
            if (!clipEl) return;

            const clipLeft = clip.startBeat * BEAT_W + 2;
            const clipW = Math.max(BEAT_W, clip.length * BEAT_W - 4);
            clipEl.style.left = clipLeft + 'px';
            clipEl.style.width = clipW + 'px';

            const canvas = clipEl.querySelector('.clip-canvas');
            if (canvas) {
                canvas.width = clipW;
                canvas.style.width = clipW + 'px';
            }
        });

        // 更新 lane 宽度为足够长，支持无限向右滚动（留 20 拍缓冲）
        const minBeats = Math.max(track.length + 20, 50);
        lane.style.width = (minBeats * BEAT_W) + 'px';
    }

    // ── 拖拽排序：核心逻辑 ────────────────────────────────────────
    /** 获取轨道在 tracks 数组中的索引 */
    function _getTrackIndex(trackId) {
        return tracks.findIndex(t => t.id === trackId);
    }

    /** 创建拖拽插入指示线 */
    function _createDropIndicator() {
        if (dropIndicator) return dropIndicator;
        dropIndicator = document.createElement('div');
        dropIndicator.className = 'track-drop-indicator';
        return dropIndicator;
    }

    /** 在指定位置显示插入指示线 */
    function _showDropIndicator(targetIndex) {
        const list = document.getElementById('track-header-list');
        const headers = list.querySelectorAll('.track-header');
        const line = _createDropIndicator();

        // 先移除再插入（避免重复）
        if (line.parentNode) line.remove();

        if (targetIndex >= headers.length) {
            // 插入到最后
            list.appendChild(line);
        } else {
            list.insertBefore(line, headers[targetIndex]);
        }
    }

    /** 移除插入指示线 */
    function _removeDropIndicator() {
        if (dropIndicator && dropIndicator.parentNode) {
            dropIndicator.remove();
        }
    }

    /** dragover 事件：计算目标位置并显示指示线 */
    function _onDragOver(e) {
        e.preventDefault();
        if (dragSourceIndex < 0) return;
        e.dataTransfer.dropEffect = 'move';

        const list = document.getElementById('track-header-list');
        const headers = [...list.querySelectorAll('.track-header')];
        if (headers.length === 0) return;

        // 根据鼠标 Y 坐标计算目标索引
        const mouseY = e.clientY;
        let targetIndex = headers.length;
        for (let i = 0; i < headers.length; i++) {
            const rect = headers[i].getBoundingClientRect();
            if (mouseY < rect.top + rect.height / 2) {
                targetIndex = i;
                break;
            }
        }
        _showDropIndicator(targetIndex);
    }

    /** drop 事件：执行重排 */
    function _onDrop(e) {
        e.preventDefault();
        if (dragSourceIndex < 0) return;

        const list = document.getElementById('track-header-list');
        const headers = [...list.querySelectorAll('.track-header')];
        if (headers.length === 0) { _removeDropIndicator(); return; }

        // 计算目标索引（与 dragOver 相同逻辑）
        const mouseY = e.clientY;
        let targetIndex = headers.length;
        for (let i = 0; i < headers.length; i++) {
            const rect = headers[i].getBoundingClientRect();
            if (mouseY < rect.top + rect.height / 2) {
                targetIndex = i;
                break;
            }
        }

        _removeDropIndicator();

        // 计算最终插入位置
        let insertAt = targetIndex;
        if (insertAt > dragSourceIndex) insertAt--;

        // 位置没变，不操作
        if (insertAt === dragSourceIndex) { dragSourceIndex = -1; return; }

        // 1. 重排数据数组
        const [movedTrack] = tracks.splice(dragSourceIndex, 1);
        tracks.splice(insertAt, 0, movedTrack);

        // 2. 重排 track-header DOM
        const movedHeader = headers[dragSourceIndex];
        if (insertAt >= headers.length - 1) {
            list.appendChild(movedHeader);
        } else {
            const newHeaders = [...list.querySelectorAll('.track-header')];
            const refHeader = newHeaders[insertAt];
            list.insertBefore(movedHeader, refHeader);
        }

        // 3. 重排 track-lane DOM（在 #tracks-container 中）
        const lanesContainer = document.getElementById('tracks-container');
        const lanes = [...lanesContainer.querySelectorAll('.track-lane')];
        const movedLane = lanes[dragSourceIndex];
        if (insertAt >= lanes.length - 1) {
            lanesContainer.appendChild(movedLane);
        } else {
            const newLanes = [...lanesContainer.querySelectorAll('.track-lane')];
            const refLane = newLanes[insertAt];
            lanesContainer.insertBefore(movedLane, refLane);
        }

        // 4. 如果正在拖拽的/选中的轨道被移动了，更新选中索引
        if (selectedTrackId === movedTrack.id) {
            // selectedTrackId 通过 ID 引用，不需要变
            // 但需要刷新 active 类
            selectTrack(movedTrack.id);
        }

        wasDragging = true;
        dragSourceIndex = -1;
    }

    /** 获取轨道所有音符（兼容旧代码） */
    function getAllNotes(track) {
        return track.notes || [];
    }

    /** 根据拍位获取所属乐段 */
    function getClipAtBeat(track, beat) {
        return track.clips.find(c => beat >= c.startBeat && beat < c.startBeat + c.length) || null;
    }

    /** 根据 ID 获取乐段 */
    function getClipById(track, clipId) {
        return track.clips.find(c => c.id === clipId) || null;
    }

    /** 重新渲染所有轨道（撤销/重做后调用） */
    function renderAllTracks() {
        const headerList = document.getElementById('track-header-list');
        const container = document.getElementById('tracks-container');
        if (headerList) headerList.innerHTML = '';
        if (container) container.innerHTML = '';

        tracks.forEach(track => {
            renderTrack(track);
            renderTrackLane(track);
        });

        // 恢复选中状态
        if (selectedTrackId) {
            selectTrack(selectedTrackId);
        }

        // 刷新标尺
        if (window.App && window.App.renderRuler) window.App.renderRuler();

        // 恢复播放进度线（innerHTML 清空时被一并删除）
        if (window.App && window.App.ensurePlayhead) window.App.ensurePlayhead();
    }

    /** 全量替换轨道数据（项目加载用） */
    function replaceAllTracks(newTracks) {
        // 保存状态（用于撤销）
        if (window.App && window.App.saveState) window.App.saveState();

        // 1. 清理旧音频节点
        const oldTracks = tracks.slice();
        oldTracks.forEach(t => {
            if (window.AudioEngine && window.AudioEngine.removeTrackNodes) {
                window.AudioEngine.removeTrackNodes(t.id);
            }
        });

        // 2. 替换数据
        tracks.length = 0;
        newTracks.forEach(t => tracks.push(t));

        // 3. 重建 UI
        const headerList = document.getElementById('track-header-list');
        const container = document.getElementById('tracks-container');
        if (headerList) headerList.innerHTML = '';
        if (container) container.innerHTML = '';
        tracks.forEach(track => {
            renderTrack(track);
            renderTrackLane(track);
        });

        // 4. 重置选中
        selectedTrackId = tracks.length > 0 ? tracks[0].id : null;
        selectedClipId = null;
        if (selectedTrackId) selectTrack(selectedTrackId);

        // 5. 关闭钢琴卷帘
        if (window.PianoRoll && window.PianoRoll.closePianoRoll) {
            window.PianoRoll.closePianoRoll();
        }

        // 6. 恢复播放进度线（innerHTML 清空时被一并删除）
        if (window.App && window.App.ensurePlayhead) window.App.ensurePlayhead();
    }

    /**
     * 供 HTML onclick 直接调用，添加一个默认乐器轨道
     */
    function addDefaultTrack() {
        console.log('[Tracks] addDefaultTrack() 被调用, 当前轨道数:', tracks.length);
        try {
            const inst = INSTRUMENTS[tracks.length % INSTRUMENTS.length];
            const newTrack = addTrack(inst.name + ' ' + (tracks.length + 1), inst);
            console.log('[Tracks] 轨道添加成功:', newTrack.name, newTrack.id);
            return newTrack;
        } catch(e) {
            console.error('[Tracks] addDefaultTrack 失败:', e);
            showToast('添加轨道失败: ' + e.message);
        }
    }

    /* ================================================================
     *  Clip 音量渐变编辑器
     *  数据格式：clip.volumeEnvelope = [{t:0, v:1}, {t:1, v:1}]
     *  t ∈ [0,1] 相对时间，v ∈ [0,1] 音量倍率
     * ================================================================ */
    let _veCanvas   = null;   // canvas 元素
    let _veCtx      = null;   // 2d context
    let _veDragIdx  = -1;     // 正在拖拽的控制点索引
    let _veCurrentPreset = 'none'; // 当前预设名

    // 预设定义
    const _VE_PRESETS = {
        none:      [{ t:0, v:1 }, { t:1, v:1 }],
        fadein:    [{ t:0, v:0 }, { t:0.3, v:1 }, { t:1, v:1 }],
        fadeout:   [{ t:0, v:1 }, { t:0.7, v:1 }, { t:1, v:0 }],
        fadeboth:  [{ t:0, v:0 }, { t:0.2, v:1 }, { t:0.8, v:1 }, { t:1, v:0 }]
    };

    /** 更新音量渐变 UI（显示/隐藏 + 绘制） */
    function _updateClipVolEnvUI() {
        const secEl = document.getElementById('clip-vol-env-section');
        if (!secEl) return;

        const clip = getSelectedClip();
        if (!clip) {
            secEl.style.display = 'none';
            return;
        }
        secEl.style.display = '';

        // 显示 clip 名
        const nameEl = document.getElementById('clip-vol-env-name');
        if (nameEl) nameEl.textContent = '(' + (clip.name || 'Clip') + ')';

        // 初始化/获取 canvas
        _veCanvas = document.getElementById('clip-vol-env-canvas');
        if (!_veCanvas) return;

        // retina
        const W = _veCanvas.clientWidth || 360;
        const H = _veCanvas.clientHeight || 100;
        _veCanvas.width  = W * 2;
        _veCanvas.height = H * 2;
        _veCtx = _veCanvas.getContext('2d');
        _veCtx.scale(2, 2);

        // 确保 volumeEnvelope 存在
        if (!clip.volumeEnvelope || !Array.isArray(clip.volumeEnvelope)) {
            clip.volumeEnvelope = _clonePoints(_VE_PRESETS.none);
            _veCurrentPreset = 'none';
        }

        // 绑定事件（只绑一次）
        if (!_veCanvas._veBound) {
            _bindVolEnvEvents();
            _veCanvas._veBound = true;
        }

        // 绘制
        _drawVolEnv(clip.volumeEnvelope);
    }

    function _clonePoints(pts) { return pts.map(p => ({ t: p.t, v: p.v })); }

    function _bindVolEnvEvents() {
        // 预设按钮
        document.querySelectorAll('.ve-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = btn.dataset.preset;
                _applyVolEnvPreset(preset);
                document.querySelectorAll('.ve-preset-btn').forEach(b =>
                    b.classList.toggle('active', b === btn));
            });
        });

        // Canvas 交互
        _veCanvas.addEventListener('pointerdown', _vePointerDown);
        window.addEventListener('pointermove', _vePointerMove);
        window.addEventListener('pointerup',   _vePointerUp);
    }

    function _applyVolEnvPreset(name) {
        const clip = getSelectedClip();
        if (!clip) return;
        _veCurrentPreset = name;
        if (_VE_PRESETS[name]) {
            clip.volumeEnvelope = _clonePoints(_VE_PRESETS[name]);
        }
        if (window.App && window.App.saveState) window.App.saveState();
        _drawVolEnv(clip.volumeEnvelope);
    }

    function _getVePointAt(x, y, W, H) {
        const pad = 10;
        const cw = W - pad * 2, ch = H - pad * 2;
        const points = (getSelectedClip() && getSelectedClip().volumeEnvelope) || [];
        for (let i = 0; i < points.length; i++) {
            const px = pad + points[i].t * cw;
            const py = pad + (1 - points[i].v) * ch;
            if (Math.abs(x - px) < 12 && Math.abs(y - py) < 12) return i;
        }
        return -1;
    }

    function _vePointerDown(e) {
        e.preventDefault();
        const rect = _veCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const W = rect.width, H = rect.height;
        const clip = getSelectedClip();
        if (!clip) return;

        _veDragIdx = _getVePointAt(x, y, W, H);

        if (_veDragIdx === -1 && x > 10 && x < W - 10) {
            // 点击空白处 → 插入新控制点
            const pad = 10, cw = W - pad * 2;
            const newT = Math.max(0, Math.min(1, (x - pad) / cw));
            const newV = Math.max(0, Math.min(1, 1 - (y - pad) / (H - pad * 2)));
            const pts = clip.volumeEnvelope;
            // 按 t 排序插入
            let inserted = false;
            for (let i = 0; i < pts.length - 1; i++) {
                if (newT >= pts[i].t && newT <= pts[i + 1].t) {
                    pts.splice(i + 1, 0, { t: newT, v: newV });
                    inserted = true;
                    break;
                }
            }
            if (!inserted) pts.push({ t: newT, v: newV });
            _veCurrentPreset = 'custom';
            _updatePresetButtons();
            _veDragIdx = pts.length - 1; // 立即开始拖拽新点
        }
        _drawVolEnv(clip.volumeEnvelope);
    }

    function _vePointerMove(e) {
        if (_veDragIdx < 0) return;
        const rect = _veCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const W = rect.width, H = rect.height;
        const clip = getSelectedClip();
        if (!clip || !clip.volumeEnvelope) return;

        const pad = 10, cw = W - pad * 2, ch = H - pad * 2;
        const pt = clip.volumeEnvelope[_veDragIdx];

        if (_veDragIdx === 0) pt.t = 0;           // 起点固定在左端
        else if (_veDragIdx === clip.volumeEnvelope.length - 1) pt.t = 1;  // 终点固定在右端
        else pt.t = Math.max(0, Math.min(1, (x - pad) / cw));

        pt.v = Math.max(0, Math.min(1, 1 - (y - pad) / ch));
        _veCurrentPreset = 'custom';
        _updatePresetButtons();
        _drawVolEnv(clip.volumeEnvelope);
    }

    function _vePointerUp() {
        if (_veDragIdx >= 0) {
            if (window.App && window.App.saveState) window.App.saveState();
            _veDragIdx = -1;
        }
    }

    function _updatePresetButtons() {
        document.querySelectorAll('.ve-preset-btn').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.preset === _veCurrentPreset));
    }

    function _drawVolEnv(points) {
        if (!_veCtx || !_veCanvas) return;
        const W = _veCanvas.clientWidth || 360;
        const H = _veCanvas.clientHeight || 100;
        const ctx = _veCtx;
        const pad = 10;
        const cw = W - pad * 2, ch = H - pad * 2;

        // 清空
        ctx.clearRect(0, 0, W, H);

        // 背景
        ctx.fillStyle = '#151922';
        ctx.fillRect(0, 0, W, H);

        // 网格线
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        for (let g = 0; g <= 4; g++) {
            const gy = pad + (g / 4) * ch;
            ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(W - pad, gy); ctx.stroke();
        }
        for (let g = 0; g <= 8; g++) {
            const gx = pad + (g / 8) * cw;
            ctx.beginPath(); ctx.moveTo(gx, pad); ctx.lineTo(gx, H - pad); ctx.stroke();
        }

        // 填充区域
        if (points && points.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(pad, H - pad); // 左下角
            for (let i = 0; i < points.length; i++) {
                ctx.lineTo(pad + points[i].t * cw, pad + (1 - points[i].v) * ch);
            }
            ctx.lineTo(pad + points[points.length - 1].t * cw, H - pad); // 右下角
            ctx.closePath();
            ctx.fillStyle = 'rgba(124,77,255,0.15)';
            ctx.fill();

            // 曲线
            ctx.beginPath();
            for (let i = 0; i < points.length; i++) {
                const px = pad + points[i].t * cw;
                const py = pad + (1 - points[i].v) * ch;
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.strokeStyle = '#7c4dff';
            ctx.lineWidth = 2;
            ctx.stroke();

            // 控制点
            for (let i = 0; i < points.length; i++) {
                const px = pad + points[i].t * cw;
                const py = pad + (1 - points[i].v) * ch;
                ctx.beginPath();
                ctx.arc(px, py, i === _veDragIdx ? 6 : 4.5, 0, Math.PI * 2);
                ctx.fillStyle = (i === _veDragIdx) ? '#fff' : '#7c4dff';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }

        // Y轴标签
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '9px sans-serif';
        ctx.fillText('100%', 1, 14);
        ctx.fillText('50%', 1, H / 2 + 3);
        ctx.fillText('0%', 1, H - 3);
    }

    /**
     * 根据时间比例 [0..1] 从包络曲线插值得到音量倍率
     * @param {Array} envelope - [{t,v}, ...]
     * @param {number} t - 时间比例 0~1
     * @returns {number} 音量倍率 0~1
     */
    function getClipVolumeAt(envelope, t) {
        if (!envelope || envelope.length < 2) return 1;
        t = Math.max(0, Math.min(1, t));
        // 找到 t 所在的段
        for (let i = 0; i < envelope.length - 1; i++) {
            if (t >= envelope[i].t && t <= envelope[i + 1].t) {
                const segLen = envelope[i + 1].t - envelope[i].t;
                if (segLen <= 0) return envelope[i].v;
                const ratio = (t - envelope[i].t) / segLen;
                return envelope[i].v + (envelope[i + 1].v - envelope[i].v) * ratio;
            }
        }
        return envelope[envelope.length - 1].v;
    }

    return {
        init, addTrack, removeTrack, getTrackById, getSelectedTrack,
        getAllTracks, getAllNotes, getClipAtBeat, getClipById,
        refreshMiniNotes, updatePropertiesPanel,
        selectTrack, renderTrackLane, refreshTrackLaneLayout,
        renderMiniNotesForClip, renderAllTracks,
        // clip 选中/颜色/删除
        getSelectedClip, getSelectedClipId, selectClip,
        setClipColor,
        // 音量渐变
        getClipVolumeAt,
        // 供 HTML onclick 直接调用
        addDefaultTrack
    };
})();
