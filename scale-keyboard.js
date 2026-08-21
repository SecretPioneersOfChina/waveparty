window.ScaleKeyboard = (function () {
    'use strict';
    const AudioEngine = window.AudioEngine || {};
    
    // ─── 调式分类 ─────────────────────────────────────────────────
    const SCALE_CATEGORIES = [
        { key:'classical',  name:'古典调式',       icon:'🎼' },
        { key:'chinese',    name:'中国民族',       icon:'🏯' },
        { key:'japanese',   name:'日本调式',       icon:'🌸' },
        { key:'indian',     name:'印度拉格',       icon:'🕉️' },
        { key:'arabic',     name:'阿拉伯马卡姆',    icon:'🕌' },
        { key:'european',   name:'欧洲民族',       icon:'🎻' },
        { key:'asian',      name:'亚洲其他',       icon:'🌏' },
        { key:'modern',     name:'现代风格',       icon:'🎵' },
    ];

    // ─── 调式定义（半音偏移，从根音开始）──────────────────────────
    const SCALE_DEFS = {
        // ========= 古典调式 =========
        major:           { name:'大调 Major',           intervals:[0,2,4,5,7,9,11],       category:'classical', icon:'☀️', desc:'明亮欢快，西方音乐基石', formula:'全全半全全半' },
        natural_minor:   { name:'自然小调 Minor',       intervals:[0,2,3,5,7,8,10],       category:'classical', icon:'🌙', desc:'忧伤柔和，最常见的小调', formula:'全半全全半全全' },
        harmonic_minor:  { name:'和声小调 Harm.Minor',  intervals:[0,2,3,5,7,8,11],       category:'classical', icon:'✨', desc:'异域神秘，增二度特有色彩' },
        melodic_minor:   { name:'旋律小调 Mel.Minor',   intervals:[0,2,3,5,7,9,11],       category:'classical', icon:'🎭', desc:'上行大调感，下行自然小调' },
        dorian:          { name:'多利亚 Dorian',        intervals:[0,2,3,5,7,9,10],       category:'classical', icon:'🎷', desc:'爵士R&B最爱，小调带大六度' },
        phrygian:        { name:'弗里吉亚 Phrygian',    intervals:[0,1,3,5,7,8,10],       category:'classical', icon:'🏛️', desc:'暗黑西班牙风味，半音开篇' },
        lydian:          { name:'利底亚 Lydian',        intervals:[0,2,4,6,7,9,11],       category:'classical', icon:'🌈', desc:'梦幻升四级，电影配乐神器' },
        mixolydian:      { name:'Mixolydian',           intervals:[0,2,4,5,7,9,10],       category:'classical', icon:'🎸', desc:'蓝调摇滚，降七级松弛感' },
        locrian:         { name:'洛克里亚 Locrian',     intervals:[0,1,3,5,6,8,10],       category:'classical', icon:'🌑', desc:'阴暗紧张，减五度不协和' },
        pentatonic_maj:  { name:'五声大调 Penta.Maj',   intervals:[0,2,4,7,9],            category:'classical', icon:'🎋', desc:'简洁明亮，流行音乐最爱' },
        pentatonic_min:  { name:'五声小调 Penta.Min',   intervals:[0,3,5,7,10],           category:'classical', icon:'🎋', desc:'布鲁斯灵魂，永远不跑调' },
        whole_tone:      { name:'全音阶 Whole Tone',    intervals:[0,2,4,6,8,10],         category:'classical', icon:'🌀', desc:'梦幻悬浮，德彪西最爱' },
        chromatic:       { name:'半音阶 Chromatic',     intervals:[0,1,2,3,4,5,6,7,8,9,10,11], category:'classical', icon:'🎹', desc:'全部12音，无调性音乐' },
        custom:          { name:'自定义 Custom',        intervals:[0,2,4,5,7,9,11],       category:'classical', icon:'🔧', desc:'自由定义音程' },

        // ========= 中国民族调式 =========
        cn_gong:         { name:'宫调式 Gong',           intervals:[0,2,4,7,9],         category:'chinese', icon:'🏯', desc:'庄重典雅，五声之君', formula:'宫商角徵羽' },
        cn_shang:        { name:'商调式 Shang',          intervals:[0,2,5,7,10],        category:'chinese', icon:'🏯', desc:'悲凉慷慨，金声玉振', formula:'商角徵羽宫' },
        cn_jue:          { name:'角调式 Jue',            intervals:[0,3,5,8,10],        category:'chinese', icon:'🏯', desc:'柔和温润，木声春意', formula:'角徵羽宫商' },
        cn_zhi:          { name:'徵调式 Zhi',            intervals:[0,2,5,7,9],         category:'chinese', icon:'🏯', desc:'欢快热烈，火声激情', formula:'徵羽宫商角' },
        cn_yu:           { name:'羽调式 Yu',             intervals:[0,3,5,7,10],        category:'chinese', icon:'🏯', desc:'清幽深远，水声静谧', formula:'羽宫商角徵' },
        cn_yayue:        { name:'雅乐七声 Yayue',       intervals:[0,2,4,6,7,9,11],   category:'chinese', icon:'🏯', desc:'宫廷雅乐，升四级庄严' },
        cn_qingyue:      { name:'清乐七声 Qingyue',     intervals:[0,2,4,5,7,9,11],   category:'chinese', icon:'🏯', desc:'燕乐清乐，与自然大调同构' },

        // ========= 日本调式 =========
        jp_minyo:        { name:'民谣音阶 Minyo',        intervals:[0,2,5,7,9],         category:'japanese', icon:'⛩️', desc:'日本民歌，朴素质朴' },
        jp_miyakobushi:  { name:'都节音阶 Miyakobushi',  intervals:[0,1,5,7,8],         category:'japanese', icon:'🌸', desc:'正宗和风，樱花旋律', formula:'含小二+增四度' },
        jp_ryukyu:       { name:'琉球音阶 Ryukyu',       intervals:[0,4,5,7,11],        category:'japanese', icon:'🏝️', desc:'冲绳海岛风情，大三度' },
        jp_in:           { name:'阴音阶 In',              intervals:[0,1,5,7,8],         category:'japanese', icon:'🌧️', desc:'暗沉内敛，冬季感' },
        jp_yo:           { name:'阳音阶 Yo',              intervals:[0,2,5,7,9],         category:'japanese', icon:'🌤️', desc:'明亮开朗，与民谣同构' },

        // ========= 印度调式（Raga）==========
        ind_bhairav:     { name:'拜拉夫 Bhairav',        intervals:[0,1,4,5,7,8,11],   category:'indian', icon:'🕉️', desc:'清晨拉格，庄严肃穆', formula:'含小二+增二度' },
        ind_bhairavi:    { name:'拜拉维 Bhairavi',       intervals:[0,1,3,5,7,8,10],   category:'indian', icon:'🕉️', desc:'柔和女声拉格，深情婉转' },
        ind_todi:        { name:'妥蒂 Todi',              intervals:[0,1,3,6,7,8,11],   category:'indian', icon:'🕉️', desc:'悲怆清晨拉格，哀而不伤' },
        ind_yaman:       { name:'雅曼 Yaman',             intervals:[0,2,4,6,7,9,11],   category:'indian', icon:'🕉️', desc:'黄昏浪漫拉格，等于利底亚' },
        ind_kafi:        { name:'卡菲 Kafi',              intervals:[0,2,3,5,7,9,10],   category:'indian', icon:'🕉️', desc:'午夜拉格，等于多利亚' },
        ind_marwa:       { name:'马尔瓦 Marwa',           intervals:[0,1,4,6,7,9,11],   category:'indian', icon:'🕉️', desc:'不安黄昏拉格，小三度缺失' },

        // ========= 阿拉伯调式（Maqam）==========
        ar_hijaz:        { name:'希贾兹 Hijaz',           intervals:[0,1,4,5,7,8,11],   category:'arabic', icon:'🕌', desc:'标志性阿拉伯音阶，增二度', formula:'半增半全半增半' },
        ar_bayati:       { name:'巴亚提 Bayati',         intervals:[0,1,3,5,7,9,11],   category:'arabic', icon:'🕌', desc:'深情忧伤，中东灵魂音阶' },
        ar_nahawand:     { name:'纳哈万德 Nahawand',     intervals:[0,2,3,5,7,8,11],   category:'arabic', icon:'🕌', desc:'等于和声小调，阿拉伯古典' },
        ar_rast:         { name:'拉斯特 Rast',            intervals:[0,2,4,5,7,9,11],   category:'arabic', icon:'🕌', desc:'阿拉伯大调，阳刚明朗' },
        ar_kurd:         { name:'库尔德 Kurd',             intervals:[0,1,3,5,7,8,10],   category:'arabic', icon:'🕌', desc:'等于弗里吉亚，沙漠苍凉' },
        ar_saba:         { name:'萨巴 Saba',              intervals:[0,1,3,5,7,8,11],   category:'arabic', icon:'🕌', desc:'极度哀伤，悲情叙事' },

        // ========= 欧洲民族 =========
        hu_gypsy:        { name:'吉普赛 Gypsy',           intervals:[0,2,3,6,7,8,11],   category:'european', icon:'🎻', desc:'热情奔放，吉普赛灵魂', formula:'含两个增二度' },
        es_flamenco:     { name:'弗拉门戈 Flamenco',     intervals:[0,1,4,5,7,8,10],   category:'european', icon:'💃', desc:'西班牙炽热，弗里吉亚属' },
        ie_celtic:       { name:'凯尔特 Celtic',          intervals:[0,2,4,5,7,9,11],   category:'european', icon:'🍀', desc:'爱尔兰绿野，=自然大调' },
        ie_dorian:       { name:'凯尔特Dorian',           intervals:[0,2,3,5,7,9,10],   category:'european', icon:'🍀', desc:'凯尔特民谣最爱，轻盈感' },
        ie_mixolydian:   { name:'凯尔特Mixolydian',      intervals:[0,2,4,5,7,9,10],   category:'european', icon:'🍀', desc:'凯尔特摇滚，降七级张力' },
        ru_melodic:      { name:'俄罗斯调式 Russian',     intervals:[0,2,3,5,7,9,11],   category:'european', icon:'🪗', desc:'旋律小调式，俄罗斯民歌' },

        // ========= 亚洲其他民族 =========
        id_slendro:      { name:'斯连德罗 Slendro',      intervals:[0,2,4,7,9],         category:'asian', icon:'🌴', desc:'爪哇甘美兰，五声平均' },
        id_pelog:        { name:'佩洛格 Pelog',            intervals:[0,1,4,5,7,10],       category:'asian', icon:'🌴', desc:'巴厘甘美兰，五声不等距' },
        kr_gugak:        { name:'韩国宫廷 Gugak',         intervals:[0,2,4,6,7,9,11],   category:'asian', icon:'🇰🇷', desc:'韩国雅乐，等于利底亚' },
        hebrew_ahavah:   { name:'犹太Ahavah Rabbah',     intervals:[0,1,4,5,7,8,11],   category:'asian', icon:'✡️', desc:'犹太教音乐，即希贾兹' },
        mongol:          { name:'蒙古长调 Mongolian',     intervals:[0,2,4,5,7,9,11],   category:'asian', icon:'🐴', desc:'草原长调，等于自然大调' },

        // ========= 现代风格调式 =========
        cyber_punk:      { name:'赛博朋克 Cyberpunk',    intervals:[0,1,4,5,7,8,10],   category:'modern', icon:'🤖', desc:'暗黑未来，弗里吉亚合成器', formula:'霓虹暗街，半音压迫' },
        cyber_lydian:    { name:'赛博Lydian Synthwave',  intervals:[0,2,4,6,7,9,11],   category:'modern', icon:'🌆', desc:'赛博升四级，霓虹天际线' },
        pop_dorian:      { name:'流行Dorian',             intervals:[0,2,3,5,7,9,10],   category:'modern', icon:'🎤', desc:'R&B/流行，Groovy大六度' },
        pop_mixolydian:  { name:'流行Mixolydian',         intervals:[0,2,4,5,7,9,10],   category:'modern', icon:'🎤', desc:'摇滚流行，蓝调味降七级' },
        pop_major:       { name:'流行大调 Pop Major',    intervals:[0,2,4,5,7,9,11],   category:'modern', icon:'🎤', desc:'经典流行，永远不过时' },
        dream_lydian:    { name:'梦核Lydian',             intervals:[0,2,4,6,7,9,11],   category:'modern', icon:'💭', desc:'梦核迷幻，升四级超脱感' },
        dream_mixolydian:{ name:'梦核Mixolydian',         intervals:[0,2,4,5,7,9,10],   category:'modern', icon:'💭', desc:'空旷迷离，梦境回响' },
        dream_major7:    { name:'梦核Maj7 Dream Pop',    intervals:[0,2,4,7,11],        category:'modern', icon:'💭', desc:'大七和弦感，朦胧梦幻', formula:'省略三级五级' },
        funk_minor:      { name:'放克五声 Funk Penta',   intervals:[0,3,5,7,10],        category:'modern', icon:'🕺', desc:'Funk五声，律动灵魂' },
    };

    // 根音名称
    const ROOT_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

    // ─── 状态 ──────────────────────────────────────────────────────
    let currentScale    = 'major';
    let rootNote        = 0;          // 0=C
    let octaveOffset    = 4;          // 起始八度
    let customIntervals = [0,2,4,5,7,9,11];
    let panel           = null;
    let canvas          = null;
    let ctx             = null;
    let isRecording     = false;      // 只有录制模式下才写入音符
    let isPanelVisible  = false;
    let activeKeys      = new Map();  // midi → { startTime, startBeat }
    let noteOnCallbacks  = [];        // 外部订阅
    let noteOffCallbacks = [];
    let scalePickActive  = false;     // 调式选择面板是否打开
    let scalePickCat     = 'classical'; // 当前选中的分类

    // ===== Tuning System (non-12TET) =====
    let currentTuningPreset = '12tet';
    let tuningCentsCustom = {};        // { pc: cents } for custom tuning
    let showTuningPanel  = false;

    // ── 圆形音律编辑器（圆周 = 一个八度 = 1200 cents）───
    let tuningCirclePoints = {};   // { id (0..n-1): angle in radians, 0 = 12 o'clock, 顺时针 }
    let tuningCircleN = 12;        // 圆上点的数量（默认 12）
    let draggingCirclePoint = null; // 当前拖动的点 id
    const TUNING_CIRCLE_R = 140;   // 圆半径（与 SVG 中一致）
    const TUNING_CIRCLE_N_MAX = 72;

    // 渲染缓存
    let keyLayout     = [];   // { midi, x, y, w, h, inScale, isRoot }
    let canvasW = 0, canvasH = 0;
    const KEY_ROWS = 2;

    // 电脑键盘映射
    const PC_KEY_ROWS = [
        ['q','w','e','r','t','y','u','i','o','p','[',']'],
        ['a','s','d','f','g','h','j','k','l',';',"'"]
    ];
    const pcKeyMap = new Map();
    const pcKeyActive = new Set();

    // ─── 初始化 ──────────────────────────────────────────────────
    function init() {
        _buildPanel();
        _bindControls();
        _loadCustomTuningsFromStorage();
        _layoutKeys();
        _updateScaleDisplay();
        // 初始化圆形音律编辑器为 12 等分（默认）
        _applyNTuning(12);
    }

    function _buildPanel() {
        panel = document.getElementById('scale-keyboard-panel');
        if (!panel) return;

        canvas = document.getElementById('scale-kb-canvas');
        ctx    = canvas.getContext('2d');

        canvas.addEventListener('pointerdown',  _onKeyDown,   { passive: false });
        canvas.addEventListener('pointermove',  _onKeyMove,   { passive: false });
        canvas.addEventListener('pointerup',    _onKeyUp,     { passive: false });
        canvas.addEventListener('pointercancel',_onKeyUp,     { passive: false });
        canvas.addEventListener('contextmenu',  e => e.preventDefault());

        document.addEventListener('keydown',  _onPcKeyDown);
        document.addEventListener('keyup',    _onPcKeyUp);

        window.addEventListener('resize', () => { _layoutKeys(); });

        // 初始化调式选择面板
        _buildScalePicker();
    }

    // ─── 调式选择面板（分类 + 列表 + 右侧信息卡片）───────────────
    function _buildScalePicker() {
        const pickerEl = document.getElementById('kb-scale-picker');
        if (!pickerEl) return;

        // 分类标签
        const catBar = pickerEl.querySelector('.scale-pick-cats');
        if (catBar) {
            SCALE_CATEGORIES.forEach(cat => {
                const btn = document.createElement('button');
                btn.className = 'scale-cat-btn';
                btn.dataset.cat = cat.key;
                btn.innerHTML = `<span class="cat-icon">${cat.icon}</span><span class="cat-name">${cat.name}</span>`;
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    scalePickCat = cat.key;
                    _renderScaleList();
                });
                catBar.appendChild(btn);
            });
        }

        // 渲染初始列表
        _renderScaleList();

        // 事件委托：点击调式项（绑定在容器上，innerHTML 替换后依然有效）
        const listEl = document.getElementById('kb-scale-list');
        if (listEl) {
            listEl.addEventListener('click', (e) => {
                const item = e.target.closest('.scale-item');
                if (!item) return;
                e.stopPropagation();
                const scaleKey = item.dataset.scale;
                if (scaleKey && SCALE_DEFS[scaleKey]) {
                    currentScale = scaleKey;
                    const customArea = document.getElementById('kb-custom-area');
                    if (customArea) customArea.style.display = (scaleKey === 'custom') ? 'block' : 'none';
                    _updateScaleDisplay();
                    // 只更新 active 状态，不重建整个列表
                    const prevActive = listEl.querySelector('.scale-item.active');
                    if (prevActive) prevActive.classList.remove('active');
                    item.classList.add('active');
                    _renderScaleInfo();
                    _layoutKeys();
                }
            });
            // 事件委托：hover 更新信息面板（节流：只在调式变化时更新）
            let _lastHoverScale = null;
            listEl.addEventListener('mouseover', (e) => {
                const item = e.target.closest('.scale-item');
                if (!item) return;
                const scaleKey = item.dataset.scale;
                if (scaleKey && SCALE_DEFS[scaleKey] && scaleKey !== _lastHoverScale) {
                    _lastHoverScale = scaleKey;
                    _renderScaleInfo(scaleKey);
                }
            });
            listEl.addEventListener('mouseleave', () => { _lastHoverScale = null; });
        }
    }

    function _renderScaleList() {
        const listEl = document.getElementById('kb-scale-list');
        const infoEl = document.getElementById('kb-scale-info');
        if (!listEl) return;

        // 高亮当前分类标签
        const catBtns = document.querySelectorAll('.scale-cat-btn');
        catBtns.forEach(b => b.classList.toggle('active', b.dataset.cat === scalePickCat));

        // 获取当前分类的调式
        const entries = Object.entries(SCALE_DEFS)
            .filter(([, def]) => def.category === scalePickCat);

        listEl.innerHTML = entries.map(([key, def]) => {
            const isActive = currentScale === key;
            return `<div class="scale-item${isActive ? ' active' : ''}" data-scale="${key}"
                        title="${def.desc || ''}">
                <span class="scale-item-icon">${def.icon || '🎵'}</span>
                <span class="scale-item-name">${def.name}</span>
                <span class="scale-item-desc">${def.desc || ''}</span>
            </div>`;
        }).join('');

        // 初始化信息面板
        _renderScaleInfo(currentScale);
    }

    /** 更新头部的调式显示按钮 */
    function _updateScaleDisplay() {
        const def = SCALE_DEFS[currentScale];
        const iconEl = document.getElementById('kb-scale-icon');
        const nameEl = document.getElementById('kb-scale-name');
        if (iconEl && def) iconEl.textContent = def.icon || '🎵';
        if (nameEl && def) nameEl.textContent = def.name;
    }

    /** 渲染右侧 info 面板 */
    function _renderScaleInfo(scaleKey) {
        const infoEl = document.getElementById('kb-scale-info');
        if (!infoEl) return;

        scaleKey = scaleKey || currentScale;
        const def = SCALE_DEFS[scaleKey];
        if (!def) return;

        // 计算 C 调音符
        const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
        const notesInC = def.intervals.map(i => noteNames[i]).join(' ');

        // 找分类名
        const cat = SCALE_CATEGORIES.find(c => c.key === def.category);

        infoEl.innerHTML = `
            <div class="scale-info-card">
                <div class="scale-info-header">
                    <span class="scale-info-icon">${def.icon || '🎵'}</span>
                    <span class="scale-info-name">${def.name}</span>
                </div>
                <div class="scale-info-cat">
                    <span class="info-label">分类</span>
                    <span>${cat ? cat.icon + ' ' + cat.name : ''}</span>
                </div>
                <div class="scale-info-desc">
                    <span class="info-label">特点</span>
                    <span>${def.desc || '—'}</span>
                </div>
                ${def.formula ? `<div class="scale-info-formula">
                    <span class="info-label">结构</span><span class="info-mono">${def.formula}</span>
                </div>` : ''}
                <div class="scale-info-notes">
                    <span class="info-label">C调音名</span>
                    <span class="info-mono">${notesInC}</span>
                </div>
                <div class="scale-info-intervals">
                    <span class="info-label">半音偏移</span>
                    <span class="info-mono">${def.intervals.join(', ')}</span>
                </div>
            </div>
        `;
    }

    // ─── 音律音分偏差编辑器（滑块版）─────────────────────────────
    function _renderTuningCentsGrid() {
        const gridEl = document.getElementById('kb-tuning-cents-grid');
        if (!gridEl) return;

        const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
        let html = '';
        noteNames.forEach((name, pc) => {
            const val = tuningCentsCustom[pc] || 0;
            const displayVal = val >= 0 ? '+' + val : '' + val;
            html += `
                <div class="tuning-cent-item">
                    <label class="tuning-cent-label">${name}</label>
                    <input type="range" class="tuning-cent-slider" data-pc="${pc}"
                           min="-100" max="100" value="${val}" step="1">
                    <span class="tuning-cent-value" data-pc="${pc}">${displayVal}</span>
                </div>
            `;
        });
        gridEl.innerHTML = html;

        // 绑定滑块事件
        gridEl.querySelectorAll('.tuning-cent-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const pc = parseInt(e.target.dataset.pc);
                const val = parseInt(e.target.value) || 0;
                if (val === 0) {
                    delete tuningCentsCustom[pc];
                } else {
                    tuningCentsCustom[pc] = val;
                }
                // 更新显示
                const displayVal = val >= 0 ? '+' + val : '' + val;
                const valueSpan = gridEl.querySelector(`.tuning-cent-value[data-pc="${pc}"]`);
                if (valueSpan) valueSpan.textContent = displayVal;
                // 同步到圆上对应点（仅当圆已渲染）
                if (tuningCirclePoints[pc] !== undefined) {
                    tuningCirclePoints[pc] = _centsToAngle(val);
                    _renderTuningCircle();
                }
            });
        });
    }

    // ═══ 圆形音律编辑器（核心：圆周 = 一个八度 = 1200 cents）═══

    /** 角度(弧度, 0=12点钟方向, 顺时针) → 圆上 (x, y)，圆心在 (0,0)，半径 R */
    function _circleXY(angleRad, R) {
        return {
            x: Math.sin(angleRad) * R,
            y: -Math.cos(angleRad) * R
        };
    }

    /** 给定点在 SVG 中的 clientX/Y，计算角度（弧度，0=12点钟方向，顺时针为正） */
    function _pointToAngle(svg, clientX, clientY) {
        const rect = svg.getBoundingClientRect();
        // SVG viewBox 是 -160 -160 320 320；计算点在 SVG 坐标系中的位置
        const scale = 320 / rect.width; // viewBox 宽 / 实际宽
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const dx = (clientX - rect.left - cx) * scale;
        const dy = (clientY - rect.top  - cy) * scale;
        // atan2(x, -y): 0=上方(12点钟), 顺时针为正
        let angle = Math.atan2(dx, -dy);
        if (angle < 0) angle += Math.PI * 2;
        return angle;
    }

    /** 圆上的角度 → cent 偏差（圆周 = 1200 cents） */
    function _angleToCents(angleRad) {
        return (angleRad / (Math.PI * 2)) * 1200;
    }

    /** cent 偏差 → 圆上的角度 */
    function _centsToAngle(cents) {
        return (cents / 1200) * Math.PI * 2;
    }

    /** 绘制圆形编辑器：刻度线 + N 个点（每个点可拖动）*/
    function _renderTuningCircle() {
        const svg       = document.getElementById('kb-tuning-circle-svg');
        const pointsG   = document.getElementById('kb-tuning-circle-points');
        const ticksG    = document.getElementById('kb-tuning-circle-ticks');
        const infoEl    = document.getElementById('tuning-circle-current');
        if (!svg || !pointsG || !ticksG) return;

        const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
        const R = TUNING_CIRCLE_R;

        // ── 1. 绘制 n 等分刻度线 ──
        let ticksHtml = '';
        for (let i = 0; i < tuningCircleN; i++) {
            const a = (i / tuningCircleN) * Math.PI * 2;
            const p1 = _circleXY(a, R - 4);
            const p2 = _circleXY(a, R + (i % (tuningCircleN / 12 || 1) === 0 ? 8 : 4));
            const isMajor = i % 12 === 0;
            ticksHtml += `<line class="tuning-circle-tick${isMajor ? ' major' : ''}" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}"/>`;
        }
        ticksG.innerHTML = ticksHtml;

        // ── 2. 绘制所有点 ──
        let pointsHtml = '';
        for (let id = 0; id < tuningCircleN; id++) {
            const a = tuningCirclePoints[id] !== undefined
                ? tuningCirclePoints[id]
                : (id / tuningCircleN) * Math.PI * 2;
            const p = _circleXY(a, R);
            const isKeyboard = id < 12; // 前 12 个点对应键盘 12 个键
            const color = isKeyboard ? '#7c4dff' : '#78909c';
            const cents = _angleToCents(a);
            const centsDisp = Math.round(cents) + '¢';
            const label = isKeyboard ? noteNames[id] : (id + 1);

            pointsHtml += `
                <g class="tuning-circle-group" data-id="${id}">
                    <circle class="tuning-circle-point" data-id="${id}"
                            cx="${p.x}" cy="${p.y}" r="8"
                            fill="${color}" stroke="#fff" stroke-width="2"/>
                    <text class="tuning-circle-point-label"
                          x="${p.x}" y="${p.y - 14}" text-anchor="middle">${label}</text>
                    <text class="tuning-circle-point-label"
                          x="${p.x}" y="${p.y + 20}" text-anchor="middle"
                          font-size="9" fill="${isKeyboard ? '#ff4081' : 'rgba(255,255,255,0.5)'}">${centsDisp}</text>
                </g>
            `;
        }
        pointsG.innerHTML = pointsHtml;

        // ── 3. 绑定拖动事件 ──
        _bindCircleInteraction(svg);

        // 更新信息显示
        if (infoEl) {
            infoEl.textContent = `${tuningCircleN} 个点 · 12 个键对应编号 0~11`;
        }
    }

    /** 绑定圆上点的拖动事件 + 整体 svg 点击（空白处）事件 */
    function _bindCircleInteraction(svg) {
        // 阻止浏览器默认右键菜单
        svg.addEventListener('contextmenu', e => e.preventDefault());

        // mousedown on a point
        svg.querySelectorAll('.tuning-circle-point').forEach(pt => {
            pt.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                draggingCirclePoint = parseInt(pt.dataset.id);
                pt.classList.add('dragging');
                _updateCircleCurrentInfo(draggingCirclePoint);
            });
            // 鼠标悬停显示信息
            pt.addEventListener('mouseenter', () => {
                if (draggingCirclePoint === null) {
                    _updateCircleCurrentInfo(parseInt(pt.dataset.id));
                }
            });
        });

        // mousemove on svg (拖动中)
        svg.addEventListener('mousemove', (e) => {
            if (draggingCirclePoint === null) return;
            const newAngle = _pointToAngle(svg, e.clientX, e.clientY);
            tuningCirclePoints[draggingCirclePoint] = newAngle;

            // 视觉更新：只更新当前拖动的点和它的标签
            const group = svg.querySelector(`.tuning-circle-group[data-id="${draggingCirclePoint}"]`);
            if (group) {
                const circleEl = group.querySelector('circle');
                const labels   = group.querySelectorAll('text');
                const p = _circleXY(newAngle, TUNING_CIRCLE_R);
                if (circleEl) {
                    circleEl.setAttribute('cx', p.x);
                    circleEl.setAttribute('cy', p.y);
                }
                labels[0] && labels[0].setAttribute('x', p.x) && labels[0].setAttribute('y', p.y - 14);
                labels[1] && labels[1].setAttribute('x', p.x) && labels[1].setAttribute('y', p.y + 20);
                if (labels[1]) {
                    const cents = Math.round(_angleToCents(newAngle));
                    labels[1].textContent = cents + '¢';
                }
            }
            _updateCircleCurrentInfo(draggingCirclePoint);
        });

        // mouseup anywhere
        const onUp = () => {
            if (draggingCirclePoint !== null) {
                // 同步到 tuningCentsCustom（仅 pc 0~11）
                _syncCircleToCentsCustom();
                // 重绘滑块（辅助参考）
                _renderTuningCentsGrid();
                // 移除高亮
                svg.querySelectorAll('.tuning-circle-point.dragging').forEach(el => el.classList.remove('dragging'));
                draggingCirclePoint = null;
            }
        };
        document.addEventListener('mouseup', onUp);
        // 注意：这里每次调用都会加新的 mouseup 监听。但因为 onUp 内部检查 draggingCirclePoint，
        // 且事件绑定是同一引用，不会有问题。
    }

    /** 更新圆下方信息显示 */
    function _updateCircleCurrentInfo(id) {
        const infoEl = document.getElementById('tuning-circle-current');
        if (!infoEl) return;
        const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
        const a = tuningCirclePoints[id];
        if (a === undefined) { infoEl.textContent = '未选中'; return; }
        const cents = Math.round(_angleToCents(a));
        const disp  = cents >= 0 ? '+' + cents : '' + cents;
        const label = id < 12 ? noteNames[id] : ('#' + (id + 1));
        infoEl.innerHTML = `选中 <b>${label}</b> (#${id})　音分 = <b>${disp}</b> cents`;
    }

    /** 把圆上点同步到 tuningCentsCustom（仅 pc 0~11） */
    function _syncCircleToCentsCustom() {
        tuningCentsCustom = {};
        for (let pc = 0; pc < 12; pc++) {
            if (tuningCirclePoints[pc] === undefined) continue;
            const cents = Math.round(_angleToCents(tuningCirclePoints[pc]));
            if (cents === 0) {
                delete tuningCentsCustom[pc];
            } else {
                // 把超过 ±600 的 wrap 到 (-600, +600]
                let c = cents;
                while (c > 600) c -= 1200;
                while (c <= -600) c += 1200;
                tuningCentsCustom[pc] = c;
            }
        }
    }

    /** 把 tuningCentsCustom 同步到圆上点（用于加载预设时） */
    function _syncCentsCustomToCircle() {
        // 确保 tuningCircleN 至少 12
        if (tuningCircleN < 12) tuningCircleN = 12;
        for (let pc = 0; pc < 12; pc++) {
            const cents = tuningCentsCustom[pc] || 0;
            tuningCirclePoints[pc] = _centsToAngle(cents);
        }
    }

    /** n 等分：把圆重新分成 n 个点 */
    function _applyNTuning(n) {
        n = Math.max(2, Math.min(TUNING_CIRCLE_N_MAX, parseInt(n) || 12));
        tuningCircleN = n;

        // 等分设置：点 id 的初始角度 = (id / n) * 2π
        tuningCirclePoints = {};
        for (let i = 0; i < n; i++) {
            tuningCirclePoints[i] = (i / n) * Math.PI * 2;
        }
        _syncCircleToCentsCustom();
        _renderTuningCircle();
        _renderTuningCentsGrid();

        // 同步 n 输入框的值
        const nInput = document.getElementById('kb-tuning-n-input');
        if (nInput) nInput.value = n;
    }

    // ─── 控件绑定 ────────────────────────────────────────────────
    function _bindControls() {
        const rootSelect  = document.getElementById('kb-root-select');
        const octaveUp    = document.getElementById('kb-octave-up');
        const octaveDown  = document.getElementById('kb-octave-down');
        const customArea  = document.getElementById('kb-custom-area');
        const customInput = document.getElementById('kb-custom-input');
        const toggleBtn   = document.getElementById('btn-toggle-scale-kb');
        const closeBtn    = document.getElementById('btn-close-scale-kb');
        const scaleBtn    = document.getElementById('kb-scale-btn');
        const pickerPanel = document.getElementById('kb-scale-picker');

        // 音律相关控件
        const tuningBtn        = document.getElementById('kb-tuning-btn');
        const tuningPicker     = document.getElementById('kb-tuning-picker');
        const tuningPresetSel  = document.getElementById('kb-tuning-preset-select');
        const tuningCentsGrid = document.getElementById('kb-tuning-cents-grid');
        const tuningApplyBtn  = document.getElementById('kb-tuning-apply');
        const tuningResetBtn  = document.getElementById('kb-tuning-reset');
        const tuningTestBtn   = document.getElementById('kb-tuning-test');
        const tuningNInput    = document.getElementById('kb-tuning-n-input');
        const tuningNApplyBtn = document.getElementById('kb-tuning-n-apply');

        // 填充根音选择
        if (rootSelect) {
            ROOT_NAMES.forEach((name, i) => {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = name;
                rootSelect.appendChild(opt);
            });
        }

        // 调式选择按钮 → 打开/关闭选择面板
        if (scaleBtn && pickerPanel) {
            scaleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                scalePickActive = !scalePickActive;
                pickerPanel.classList.toggle('open', scalePickActive);
                scaleBtn.classList.toggle('open', scalePickActive);
                if (scalePickActive) {
                    // 打开时同步分类
                    const def = SCALE_DEFS[currentScale];
                    if (def && def.category) scalePickCat = def.category;
                    _renderScaleList();
                }
            });
        }

        // 点击面板外部关闭
        document.addEventListener('click', (e) => {
            if (scalePickActive && pickerPanel) {
                if (!pickerPanel.contains(e.target) && e.target !== scaleBtn) {
                    scalePickActive = false;
                    pickerPanel.classList.remove('open');
                    if (scaleBtn) scaleBtn.classList.remove('open');
                }
            }
        });

        if (rootSelect) rootSelect.addEventListener('change', e => {
            rootNote = parseInt(e.target.value);
            _layoutKeys();
        });

        if (octaveUp) octaveUp.addEventListener('click', () => {
            octaveOffset = Math.min(7, octaveOffset + 1);
            document.getElementById('kb-octave-display').textContent = octaveOffset;
            _layoutKeys();
        });

        if (octaveDown) octaveDown.addEventListener('click', () => {
            octaveOffset = Math.max(1, octaveOffset - 1);
            document.getElementById('kb-octave-display').textContent = octaveOffset;
            _layoutKeys();
        });

        if (customInput) customInput.addEventListener('change', e => {
            const parts = e.target.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 0 && n <= 11);
            if (parts.length > 0) {
                customIntervals = [...new Set(parts)].sort((a, b) => a - b);
                _layoutKeys();
            }
        });

        // 音律按钮 → 打开/关闭音律面板
        if (tuningBtn && tuningPicker) {
            tuningBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showTuningPanel = !showTuningPanel;
                tuningPicker.style.display = showTuningPanel ? 'block' : 'none';
                tuningBtn.classList.toggle('open', showTuningPanel);
                if (showTuningPanel) {
                    // 打开面板时同步：从当前预设的 cents 同步到圆上
                    _syncCentsCustomToCircle();
                    _renderTuningCircle();
                    _renderTuningCentsGrid();
                }
            });
        }

        // 点击面板外部关闭
        document.addEventListener('click', (e) => {
            if (showTuningPanel && tuningPicker) {
                if (!tuningPicker.contains(e.target) && e.target !== tuningBtn) {
                    showTuningPanel = false;
                    tuningPicker.style.display = 'none';
                    if (tuningBtn) tuningBtn.classList.remove('open');
                }
            }
        });

        // 音律预设选择
        if (tuningPresetSel) {
            tuningPresetSel.addEventListener('change', (e) => {
                currentTuningPreset = e.target.value;
                if (currentTuningPreset !== 'custom') {
                    if (window.AudioEngine && AudioEngine.setTuning) {
                        AudioEngine.setTuning(currentTuningPreset);
                    }
                    // 更新按钮显示
                    const tuningNameEl = document.getElementById('kb-tuning-name');
                    if (tuningNameEl) {
                        const names = { '12tet': '十二平均律', 'arabic_24': '阿拉伯24律', 'indian_22': '印度22 Shruti', 'chinese_pure': '中国古琴纯律', 'indonesian_s': '印尼Slendro' };
                        tuningNameEl.textContent = names[currentTuningPreset] || '自定义音律';
                    }
                }
                _syncCentsCustomToCircle();
                _renderTuningCircle();
                _renderTuningCentsGrid();
            });
        }

        // n 等分应用按钮
        if (tuningNApplyBtn) {
            tuningNApplyBtn.addEventListener('click', () => {
                const v = tuningNInput ? tuningNInput.value : 12;
                _applyNTuning(v);
                showToast(`🎼 已应用 ${tuningCircleN} 等分（${tuningCircleN} 平均律）`);
            });
        }
        // n 输入框回车也触发
        if (tuningNInput) {
            tuningNInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    _applyNTuning(e.target.value);
                    showToast(`🎼 已应用 ${tuningCircleN} 等分（${tuningCircleN} 平均律）`);
                }
            });
        }

        // 应用音律按钮（从圆读取数据，优先；滑块作辅助参考）
        if (tuningApplyBtn) {
            tuningApplyBtn.addEventListener('click', () => {
                // 优先从圆同步 cents
                _syncCircleToCentsCustom();
                const cents = Object.entries(tuningCentsCustom).map(([k, v]) => [parseInt(k), v]);
                if (window.AudioEngine && AudioEngine.setTuning) {
                    AudioEngine.setTuning(null, cents);
                }
                currentTuningPreset = 'custom';
                const tuningNameEl = document.getElementById('kb-tuning-name');
                if (tuningNameEl) tuningNameEl.textContent = '自定义音律';
                _renderTuningCentsGrid();
                showToast('✅ 音律已应用');
            });
        }

        // 重置音律按钮
        if (tuningResetBtn) {
            tuningResetBtn.addEventListener('click', () => {
                if (window.AudioEngine && AudioEngine.setTuning) {
                    AudioEngine.setTuning('12tet');
                }
                currentTuningPreset = '12tet';
                if (tuningPresetSel) tuningPresetSel.value = '12tet';
                const tuningNameEl = document.getElementById('kb-tuning-name');
                if (tuningNameEl) tuningNameEl.textContent = '十二平均律';
                // 重置圆：回到 12 等分
                _applyNTuning(12);
                showToast('↺ 已重置为十二平均律');
            });
        }

        // 测试播放按钮
        if (tuningTestBtn) {
            tuningTestBtn.addEventListener('click', () => {
                _testTuning();
            });
        }

        // 保存到调式列表按钮
        const tuningSaveBtn = document.getElementById('kb-tuning-save');
        if (tuningSaveBtn) {
            tuningSaveBtn.addEventListener('click', () => {
                _saveCustomTuning();
            });
        }

        // 一键转换音轨为当前调式
        const convertBtn = document.getElementById('btn-convert-to-scale');
        if (convertBtn) convertBtn.addEventListener('click', () => _convertTrackToScale());

        if (toggleBtn) toggleBtn.addEventListener('click', () => {
            const p = document.getElementById('scale-keyboard-panel');
            if (p) {
                const isHidden = p.style.display === 'none' || p.style.display === '';
                isPanelVisible = isHidden;
                p.style.display = isHidden ? 'flex' : 'none';
                toggleBtn.classList.toggle('active', isHidden);
                if (isHidden) { _layoutKeys(); _updateScaleDisplay(); }
                if (!isHidden) _releaseAllPcNotes();
            }
        });

        if (closeBtn) closeBtn.addEventListener('click', () => {
            const p = document.getElementById('scale-keyboard-panel');
            if (p) p.style.display = 'none';
            isPanelVisible = false;
            _releaseAllPcNotes();
            const tb = document.getElementById('btn-toggle-scale-kb');
            if (tb) tb.classList.remove('active');
        });

        // 录制状态同步
        document.getElementById('btn-record') && document.getElementById('btn-record').addEventListener('click', () => {
            isRecording = document.getElementById('btn-record').classList.contains('active');
        });
    }

    /** 测试播放当前音律效果 */
    function _testTuning() {
        if (!window.AudioEngine) return;
        AudioEngine.ensureContext();

        // 播放 C 大调音阶（C D E F G A B C）
        const scaleNotes = [60, 62, 64, 65, 67, 69, 71, 72];
        const now = AudioEngine.getCurrentTime ? AudioEngine.getCurrentTime() : 0;
        const noteDur = 0.3;

        scaleNotes.forEach((midi, i) => {
            const start = now + i * (noteDur + 0.05);
            setTimeout(() => {
                if (window.AudioEngine && AudioEngine.playNote) {
                    AudioEngine.playNote('tuning-test', midi, { waveform: 'sine' }, noteDur);
                }
            }, i * (noteDur + 0.05) * 1000);
        });

        showToast('🔊 正在播放测试音阶...');
    }

    // ─── 音阶计算 ──────────────────────────────────────────────────
    function _getScaleIntervals() {
        if (currentScale === 'custom') return customIntervals;
        return SCALE_DEFS[currentScale]?.intervals || SCALE_DEFS.major.intervals;
    }

    function _inScale(midi) {
        const intervals = _getScaleIntervals();
        const pc = ((midi - rootNote) % 12 + 12) % 12;
        return intervals.includes(pc);
    }

    function _isRoot(midi) {
        return ((midi - rootNote) % 12 + 12) % 12 === 0;
    }

    // ─── 布局计算 ─────────────────────────────────────────────────
    function _layoutKeys() {
        if (!canvas) return;
        const rect = canvas.parentElement.getBoundingClientRect();
        canvasW = Math.floor(rect.width);
        canvasH = parseInt(canvas.dataset.height || 130);

        canvas.width  = canvasW;
        canvas.height = canvasH;
        canvas.style.width  = canvasW + 'px';
        canvas.style.height = canvasH + 'px';

        keyLayout = [];
        const intervals     = _getScaleIntervals();
        const numIntervals  = intervals.length;
        const octavesPerRow = 3;
        const keysPerRow    = numIntervals * octavesPerRow;
        const keyW          = Math.floor(canvasW / keysPerRow);
        const keyH          = Math.floor((canvasH - 6) / KEY_ROWS);
        const gap           = 2;

        for (let row = 0; row < KEY_ROWS; row++) {
            const oct = octaveOffset + (KEY_ROWS - 1 - row);
            for (let i = 0; i < numIntervals * octavesPerRow; i++) {
                const octShift = Math.floor(i / numIntervals);
                const interval = intervals[i % numIntervals];
                const midi     = (oct + octShift) * 12 + rootNote + interval;
                if (midi < 21 || midi > 108) continue;
                const x = i * keyW;
                const y = row * (keyH + gap);
                keyLayout.push({
                    midi, x, y,
                    w: keyW - 1, h: keyH,
                    inScale: true,
                    isRoot: _isRoot(midi),
                    octShift, row
                });
            }
        }

        _buildPcKeyMap();
        _render();
    }

    function _buildPcKeyMap() {
        pcKeyMap.clear();
        const rowOffsets = [0, 0];
        for (let i = 0; i < keyLayout.length; i++) {
            if (keyLayout[i].row === 0 && rowOffsets[0] === 0 && i > 0) rowOffsets[0] = i;
            if (keyLayout[i].row === 1 && rowOffsets[1] === 0) { rowOffsets[1] = i; break; }
        }
        if (rowOffsets[0] > 0) rowOffsets[0] = 0;

        for (let r = 0; r < 2; r++) {
            const keys = PC_KEY_ROWS[r];
            const base  = rowOffsets[r];
            for (let k = 0; k < keys.length; k++) {
                const idx = base + k;
                if (idx < keyLayout.length && keyLayout[idx].row === r) {
                    pcKeyMap.set(keys[k], idx);
                }
            }
        }
    }

    // ─── 渲染 ─────────────────────────────────────────────────────
    function _render() {
        if (!ctx || !canvas) return;
        ctx.clearRect(0, 0, canvasW, canvasH);
        ctx.fillStyle = '#14161b';
        ctx.fillRect(0, 0, canvasW, canvasH);

        keyLayout.forEach((key, idx) => {
            const isActive = activeKeys.has(key.midi);
            const isRoot   = key.isRoot;

            let fill;
            if (isActive) {
                fill = '#ff4081';
            } else if (isRoot) {
                fill = '#7c4dff';
            } else {
                fill = key.row === 0 ? '#2a2d38' : '#1e2128';
            }

            ctx.fillStyle = fill;
            _roundRect(ctx, key.x, key.y, key.w, key.h, 4);
            ctx.fill();

            ctx.strokeStyle = isActive ? '#ff80ab' : isRoot ? '#aa80ff' : '#373b47';
            ctx.lineWidth   = isActive ? 1.5 : 0.8;
            _roundRect(ctx, key.x, key.y, key.w, key.h, 4);
            ctx.stroke();

            const noteName = _midiToName(key.midi);
            const fontSize = Math.max(9, Math.min(13, Math.floor(key.w * 0.3)));
            ctx.fillStyle  = isActive ? '#fff' : isRoot ? '#e0d0ff' : '#8890a8';
            ctx.font       = `${fontSize}px -apple-system, sans-serif`;
            ctx.textAlign  = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(noteName, key.x + key.w / 2, key.y + key.h / 2 - 2);

            const pcKey = _getPcKeyForIndex(idx);
            if (pcKey) {
                const hintSize = Math.max(8, Math.min(11, Math.floor(key.w * 0.25)));
                ctx.fillStyle = 'rgba(255,255,255,0.35)';
                ctx.font      = `${hintSize}px -apple-system, sans-serif`;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'bottom';
                ctx.fillText(pcKey.toUpperCase(), key.x + key.w - 4, key.y + key.h - 4);
            }
        });
    }

    function _getPcKeyForIndex(idx) {
        for (const [k, i] of pcKeyMap) {
            if (i === idx) return k;
        }
        return null;
    }

    // ─── 交互事件 ─────────────────────────────────────────────────
    const _pointerKeys = new Map();

    function _hitKey(x, y) {
        for (const key of keyLayout) {
            if (x >= key.x && x <= key.x + key.w && y >= key.y && y <= key.y + key.h) {
                return key.midi;
            }
        }
        return null;
    }

    function _onKeyDown(e) {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const midi = _hitKey(x, y);
        if (midi !== null) {
            _triggerNote(midi, e.pointerId);
        }
    }

    function _onKeyMove(e) {
        e.preventDefault();
        if (!_pointerKeys.has(e.pointerId)) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const midi = _hitKey(x, y);
        const prevMidi = _pointerKeys.get(e.pointerId);
        if (midi !== prevMidi) {
            if (prevMidi !== undefined) _releaseNote(prevMidi, e.pointerId);
            if (midi !== null) _triggerNote(midi, e.pointerId);
        }
    }

    function _onKeyUp(e) {
        e.preventDefault();
        const midi = _pointerKeys.get(e.pointerId);
        if (midi !== undefined) _releaseNote(midi, e.pointerId);
    }

    function _triggerNote(midi, pointerId) {
        if (activeKeys.has(midi)) return;
        _pointerKeys.set(pointerId, midi);

        const now = window.AudioEngine ? AudioEngine.getCurrentTime() : 0;
        const beat = window.App ? App.getPlaybackBeat() : 0;
        activeKeys.set(midi, { startTime: now, startBeat: beat });

        const track = window.Tracks ? Tracks.getSelectedTrack() : null;
        if (window.AudioEngine) {
            AudioEngine.ensureContext();
            AudioEngine.playNote(track ? track.id : 'preview', midi, track ? track.instrument : 'piano', 0);
        }

        noteOnCallbacks.forEach(cb => cb(midi, beat));
        _render();
    }

    function _releaseNote(midi, pointerId) {
        _pointerKeys.delete(pointerId);
        if (!activeKeys.has(midi)) return;

        const startData = activeKeys.get(midi);
        const endBeat   = window.App ? App.getPlaybackBeat() : 0;
        activeKeys.delete(midi);

        if (window.AudioEngine) {
            AudioEngine.stopNote(midi);
        }

        const duration = Math.max(endBeat - startData.startBeat, 1/16);
        noteOffCallbacks.forEach(cb => cb(midi, startData.startBeat, duration));

        const pr = window.PianoRoll;
        const track = window.Tracks ? Tracks.getSelectedTrack() : null;
        const recordActive = document.getElementById('btn-record') &&
                             document.getElementById('btn-record').classList.contains('active');

        if (recordActive && track) {
            // 确定写入目标：优先当前 clip，其次轨道首个 clip，兼容旧轨道
            let targetClip = null;
            if (pr && pr.getCurrentClip) {
                targetClip = pr.getCurrentClip();
            }
            if (!targetClip && track.clips && track.clips.length > 0) {
                targetClip = track.clips[0];
            }

            let targetNotes;
            if (targetClip) {
                targetClip.notes = targetClip.notes || [];
                targetNotes = targetClip.notes;
            } else {
                // 兼容旧轨道（无 clips）
                track.notes = track.notes || [];
                targetNotes = track.notes;
            }

            const quantDur = _quantizeDuration(duration);
            const quantBeat = _quantizeBeat(startData.startBeat);
            targetNotes.push({
                pitch: midi,
                beat: quantBeat,
                duration: quantDur,
                velocity: 100
            });

            if (pr && pr.refresh) pr.refresh();
        }

        _render();
    }

    function _quantizeBeat(beat) {
        const q = 1 / 4;
        return Math.round(beat / q) * q;
    }

    function _quantizeDuration(dur) {
        if (dur < 0.1) return 0.25;
        const steps = [0.25, 0.5, 0.75, 1, 1.5, 2];
        return steps.reduce((prev, s) => Math.abs(s - dur) < Math.abs(prev - dur) ? s : prev, 0.25);
    }

    // ─── 工具函数 ─────────────────────────────────────────────────
    function _roundRect(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y);
        c.lineTo(x + w - r, y);
        c.quadraticCurveTo(x + w, y, x + w, y + r);
        c.lineTo(x + w, y + h - r);
        c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        c.lineTo(x + r, y + h);
        c.quadraticCurveTo(x, y + h, x, y + h - r);
        c.lineTo(x, y + r);
        c.quadraticCurveTo(x, y, x + r, y);
        c.closePath();
    }

    function _midiToName(midi) {
        const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
        const oct   = Math.floor(midi / 12) - 1;
        return names[midi % 12] + oct;
    }

    // ─── 电脑键盘映射 ─────────────────────────────────────────────
    function _onPcKeyDown(e) {
        if (!isPanelVisible) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;

        const key = e.key.toLowerCase();
        if (!pcKeyMap.has(key)) return;
        if (pcKeyActive.has(key)) return;

        e.preventDefault();
        const idx = pcKeyMap.get(key);
        if (idx >= 0 && idx < keyLayout.length) {
            const midi = keyLayout[idx].midi;
            _triggerNote(midi, 'pc_' + key);
            pcKeyActive.add(key);
        }
    }

    function _onPcKeyUp(e) {
        if (!isPanelVisible) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;

        const key = e.key.toLowerCase();
        if (!pcKeyMap.has(key)) return;
        if (!pcKeyActive.has(key)) return;

        e.preventDefault();
        const idx = pcKeyMap.get(key);
        if (idx >= 0 && idx < keyLayout.length) {
            const midi = keyLayout[idx].midi;
            _releaseNote(midi, 'pc_' + key);
            pcKeyActive.delete(key);
        }
    }

    function _releaseAllPcNotes() {
        pcKeyActive.forEach(key => {
            const idx = pcKeyMap.get(key);
            if (idx >= 0 && idx < keyLayout.length) {
                _releaseNote(keyLayout[idx].midi, 'pc_' + key);
            }
        });
        pcKeyActive.clear();
    }

    // ─── 一键转换音轨为当前调式 ────────────────────────────────
    /** 将单个音高量化到当前调式的最近合法音高 */
    function _snapPitchToScale(midi) {
        const intervals = _getScaleIntervals();
        const pc = ((midi - rootNote) % 12 + 12) % 12;
        if (intervals.includes(pc)) return midi;

        // 双向搜索最近合法半音偏移
        let bestDelta = 0;
        for (let d = 1; d <= 6; d++) {
            const up = (pc + d) % 12;
            const down = (pc - d + 12) % 12;
            const upOk = intervals.includes(up);
            const downOk = intervals.includes(down);
            if (upOk && downOk) { bestDelta = d; break; }
            if (upOk) { bestDelta = d; break; }
            if (downOk) { bestDelta = -d; break; }
        }
        return midi + bestDelta;
    }

    /** 将选中音轨的所有音符量化到当前调式 */
    function _convertTrackToScale() {
        const track = window.Tracks.getSelectedTrack();
        if (!track || !track.notes || track.notes.length === 0) {
            const def = SCALE_DEFS[currentScale];
            alert(`请先选中一个有音符的音轨！\n\n当前调式: ${def.icon} ${def.name}\n根音: ${ROOT_NAMES[rootNote]}`);
            return;
        }

        let changed = 0;
        track.notes.forEach(note => {
            const newPitch = _snapPitchToScale(note.pitch);
            if (newPitch !== note.pitch) {
                note.pitch = newPitch;
                changed++;
            }
        });

        // 刷新 UI
        window.Tracks.refreshMiniNotes(track.id);
        if (window.PianoRoll && window.PianoRoll.isOpen()) {
            window.PianoRoll.refresh();
        }

        // 按钮反馈
        const btn = document.getElementById('btn-convert-to-scale');
        const def = SCALE_DEFS[currentScale];
        if (btn) {
            btn.textContent = `✅ 已调整 ${changed} 个音符`;
            btn.classList.add('converting');
            setTimeout(() => {
                btn.textContent = '🎯 转为该调式';
                btn.classList.remove('converting');
            }, 1500);
        }
    }

    // ─── 音律相关公开 API ──────────────────────────────────
    function setTuning(presetKey, customCents) {
        currentTuningPreset = presetKey || '12tet';
        if (window.AudioEngine && AudioEngine.setTuning) {
            AudioEngine.setTuning(presetKey, customCents);
        }
        if (presetKey && presetKey !== 'custom') {
            const names = { '12tet': '十二平均律', 'arabic_24': '阿拉伯24律', 'indian_22': '印度22 Shruti', 'chinese_pure': '中国古琴纯律', 'indonesian_s': '印尼Slendro' };
            const nameEl = document.getElementById('kb-tuning-name');
            if (nameEl) nameEl.textContent = names[presetKey] || presetKey;
        }
    }

    function getTuning() {
        return {
            preset: currentTuningPreset,
            cents: { ...tuningCentsCustom },
            presets: ['12tet', 'arabic_24', 'indian_22', 'chinese_pure', 'indonesian_s']
        };
    }

    // ─── 公开 API ────────────────────────────────────────────────
    function onNoteOn(cb)  { noteOnCallbacks.push(cb); }
    function onNoteOff(cb) { noteOffCallbacks.push(cb); }
    function getScaleDefs() { return SCALE_DEFS; }

    // ─── 自定义音律保存 / 加载 ───────────────────────────────────
    const CUSTOM_TUNING_KEY = 'waveparty_custom_tunings';

    /** 弹出对话框，将当前自定义音分保存为新预设 */
    function _saveCustomTuning() {
        // 收集当前音分
        const cents = {};
        const sliders = document.querySelectorAll('.tuning-cent-slider');
        sliders.forEach(slider => {
            const pc = parseInt(slider.dataset.pc);
            const val = parseInt(slider.value) || 0;
            if (val !== 0) cents[pc] = val;
        });

        if (Object.keys(cents).length === 0) {
            showToast('⚠️ 请先调整音分滑块，再保存');
            return;
        }

        const name = prompt('请输入调式名称（如"我的微分音律"）：', '我的自定义调式');
        if (!name || !name.trim()) return;
        const desc = prompt('请输入描述（可选）：', '') || '';

        // 生成唯一 key
        const key = 'custom_' + Date.now().toString(36);
        const preset = { name: name.trim(), desc, cents };

        // 1. 存入 AudioEngine
        if (window.AudioEngine && AudioEngine.addTuningPreset) {
            AudioEngine.addTuningPreset(key, preset);
        }

        // 2. 存入 localStorage
        const stored = JSON.parse(localStorage.getItem(CUSTOM_TUNING_KEY) || '{}');
        stored[key] = preset;
        localStorage.setItem(CUSTOM_TUNING_KEY, JSON.stringify(stored));

        // 3. 更新下拉框
        _refreshTuningPresetSelect();
        const tuningPresetSel = document.getElementById('kb-tuning-preset-select');
        if (tuningPresetSel) tuningPresetSel.value = key;

        showToast('✅ 调式「' + name.trim() + '」已保存到调式列表');
    }

    /** 从 localStorage 恢复自定义预设，并注册到 AudioEngine */
    function _loadCustomTuningsFromStorage() {
        const stored = JSON.parse(localStorage.getItem(CUSTOM_TUNING_KEY) || '{}');
        const entries = Object.entries(stored);
        if (entries.length === 0) return;

        entries.forEach(([key, preset]) => {
            if (window.AudioEngine && AudioEngine.addTuningPreset) {
                AudioEngine.addTuningPreset(key, preset);
            }
        });

        _refreshTuningPresetSelect();
        console.log('[ScaleKeyboard] Restored custom tunings:', entries.length);
    }

    /** 刷新音律预设下拉框（内置 + 自定义） */
    function _refreshTuningPresetSelect() {
        const sel = document.getElementById('kb-tuning-preset-select');
        if (!sel) return;

        // 内置预设（与 index.html 中 option 同步）
        const builtin = [
            { key: '12tet',       label: '十二平均律 (Western Standard)' },
            { key: 'arabic_24',   label: '阿拉伯 24 平均律 (Quarter Tones)' },
            { key: 'indian_22',   label: '印度 22 Shruti (近似)' },
            { key: 'chinese_pure', label: '中国古琴纯律 (Just Intonation)' },
            { key: 'indonesian_s', label: '印尼 Slendro 五声' },
        ];

        // 读取 localStorage 中的自定义预设
        const stored = JSON.parse(localStorage.getItem(CUSTOM_TUNING_KEY) || '{}');
        const customEntries = Object.entries(stored);

        // 重建 option（保留当前选中值）
        const currentVal = sel.value;
        let html = '';
        builtin.forEach(p => {
            html += '<option value="' + p.key + '">' + p.label + '</option>';
        });
        if (customEntries.length > 0) {
            html += '<option disabled>── 自定义 ──</option>';
            customEntries.forEach(([key, preset]) => {
                html += '<option value="' + key + '">⭐ ' + preset.name + '</option>';
            });
        }
        sel.innerHTML = html;

        // 恢复选中值（如果还在选项中）
        if ([...sel.options].some(o => o.value === currentVal)) {
            sel.value = currentVal;
        }
    }

    // ─── Toast 提示（独立实现，不依赖其他模块）───
    function showToast(msg) {
        const existing = document.querySelector('.kb-toast');
        if (existing) existing.remove();
        const el = document.createElement('div');
        el.className = 'kb-toast';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2200);
    }

    return { init, onNoteOn, onNoteOff, getScaleDefs,
             setTuning, getTuning };
})();
