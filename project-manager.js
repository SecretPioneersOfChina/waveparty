/**
 * WaveParty Project Manager
 * 保存 / 加载 / 新建项目
 * - 支持下载为 .wp 文件（导出）
 * - 支持保存到软件内部项目库（localStorage）
 * - 打开时显示项目列表面板
 */
(function () {
    'use strict';

    const PROJECT_EXT   = '.wp';
    const PROJECT_VERSION = 1;
    const STORAGE_KEY     = 'waveparty_projects';   // { [id]: { id, name, createdAt, updatedAt, data } }
    const ACTIVE_KEY      = 'waveparty_active_project'; // 当前打开的项目 ID

    /* ===== 收集当前项目完整状态 ===== */
    function collectProjectData() {
        const tempo = window.App && window.App.getTempo ? window.App.getTempo() : 120;
        const tracks = window.Tracks ? window.Tracks.getAllTracks() : [];
        const tracksCopy = JSON.parse(JSON.stringify(tracks));

        let tuning = null;
        try {
            if (window.AudioEngine && window.AudioEngine.getTuning) {
                tuning = window.AudioEngine.getTuning();
            }
        } catch(e) { /* ignore */ }

        const data = {
            version   : PROJECT_VERSION,
            app       : 'WaveParty',
            generatedAt: new Date().toISOString(),
            tempo     : tempo,
            timeSig   : {
                num: parseInt(document.getElementById('ts-num')?.value) || 4,
                den: parseInt(document.getElementById('ts-den')?.value) || 4,
            },
            tuning : tuning,
            tracks : tracksCopy,
        };
        return data;
    }

    /* ===== 下载项目为 .wp 文件（导出） ===== */
    function downloadProject(data, filename) {
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download  = filename.endsWith(PROJECT_EXT) ? filename : filename + PROJECT_EXT;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    }

    /* ===== localStorage 项目库操作 ===== */

    /** 获取所有已保存项目（按更新时间倒序） */
    function getSavedProjects() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const map = raw ? JSON.parse(raw) : {};
            return Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt);
        } catch(e) {
            return [];
        }
    }

    /** 保存项目到 localStorage */
    function saveToLibrary(name, data) {
        const id = 'proj_' + Date.now().toString(36);
        const now = Date.now();
        const record = {
            id       : id,
            name     : name || '未命名项目',
            createdAt : now,
            updatedAt : now,
            data     : data,
        };
        const raw = localStorage.getItem(STORAGE_KEY) || '{}';
        const map = JSON.parse(raw);
        map[id] = record;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
        localStorage.setItem(ACTIVE_KEY, id);
        return id;
    }

    /** 更新已有项目 */
    function updateProjectInLibrary(id, data) {
        const raw = localStorage.getItem(STORAGE_KEY) || '{}';
        const map = JSON.parse(raw);
        if (!map[id]) return false;
        map[id].updatedAt = Date.now();
        map[id].data       = data;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
        localStorage.setItem(ACTIVE_KEY, id);
        return true;
    }

    /** 从 localStorage 加载项目 */
    function loadFromLibrary(id) {
        const raw = localStorage.getItem(STORAGE_KEY) || '{}';
        const map = JSON.parse(raw);
        return map[id] || null;
    }

    /** 从 localStorage 删除项目 */
    function deleteFromLibrary(id) {
        const raw = localStorage.getItem(STORAGE_KEY) || '{}';
        const map = JSON.parse(raw);
        delete map[id];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    }

    /* ===== 恢复项目数据到当前会话 ===== */
    function restoreProjectData(data) {
        // 1. 恢复 tempo
        if (data.tempo) {
            const tempoInput = document.getElementById('tempo-input');
            if (tempoInput) tempoInput.value = data.tempo;
            if (window.App && window.App.setTempo) window.App.setTempo(data.tempo);
        }

        // 2. 恢复拍号
        if (data.timeSig) {
            const tsNum = document.getElementById('ts-num');
            const tsDen = document.getElementById('ts-den');
            if (tsNum) tsNum.value = data.timeSig.num;
            if (tsDen) tsDen.value = data.timeSig.den;
        }

        // 3. 恢复音律设置
        if (data.tuning && window.AudioEngine && window.AudioEngine.setTuning) {
            window.AudioEngine.setTuning(data.tuning.preset || null, data.tuning.customCents || null);
        }

        // 4. 恢复轨道数据
        if (window.Tracks && window.Tracks.replaceAllTracks) {
            window.Tracks.replaceAllTracks(data.tracks);
        } else {
            const tracks = window.Tracks.getAllTracks();
            while (tracks.length > 0) tracks.pop();
            data.tracks.forEach(t => tracks.push(t));
            if (window.Tracks.renderAllTracks) window.Tracks.renderAllTracks();
        }

        // 5. 刷新标尺
        if (window.App && window.App.renderRuler) window.App.renderRuler();
    }

    /* ===== 新建空白项目 ===== */
    function newProject() {
        if (!confirm('新建项目将丢失当前所有未保存的内容，是否继续？')) return;

        // 重置 tempo
        const tempoInput = document.getElementById('tempo-input');
        if (tempoInput) tempoInput.value = 120;

        // 清空所有轨道（保留第一条）
        const tracks = window.Tracks.getAllTracks();
        while (tracks.length > 1) tracks.pop();
        const first = tracks[0];
        if (first) {
            first.clips  = [];
            first.notes = [];
            first.length = 8;
        }

        // 重新渲染
        if (window.Tracks.renderAllTracks) window.Tracks.renderAllTracks();
        if (window.App && window.App.renderRuler) window.App.renderRuler();
        if (window.PianoRoll && window.PianoRoll.closePianoRoll) window.PianoRoll.closePianoRoll();

        // 清除当前激活项目
        localStorage.removeItem(ACTIVE_KEY);

        showProjectToast('已新建空白项目');
    }

    /* ===== 保存项目（主入口）===== */
    function saveProject() {
        const data = collectProjectData();

        // 检查是否已有激活项目（更新），否则新建
        const activeId = localStorage.getItem(ACTIVE_KEY);
        const saved = activeId ? loadFromLibrary(activeId) : null;

        let name = '';
        if (saved) {
            name = saved.name;
            updateProjectInLibrary(activeId, data);
            showProjectToast('✅ 项目「' + name + '」已更新');
        } else {
            name = prompt('请输入项目名称：', '我的项目 ' + new Date().toLocaleDateString());
            if (!name || !name.trim()) {
                showProjectToast('⚠️ 已取消保存');
                return;
            }
            name = name.trim();
            saveToLibrary(name, data);
            showProjectToast('✅ 项目「' + name + '」已保存到软件内');
        }
    }

    /* ===== 另存为（强制命名） ===== */
    function saveProjectAs() {
        const data = collectProjectData();
        const name = prompt('请输入项目名称：', '我的项目 ' + new Date().toLocaleDateString());
        if (!name || !name.trim()) {
            showProjectToast('⚠️ 已取消保存');
            return;
        }
        saveToLibrary(name.trim(), data);
        showProjectToast('✅ 项目「' + name.trim() + '」已保存到软件内');
    }

    /* ===== 导出为 .wp 文件 ===== */
    function exportProject() {
        const data = collectProjectData();
        const name = (loadFromLibrary(localStorage.getItem(ACTIVE_KEY))?.name || 'WaveParty_Project');
        downloadProject(data, name + PROJECT_EXT);
        showProjectToast('📥 项目已导出为 ' + name + PROJECT_EXT);
    }

    /* ===== 打开项目（显示项目列表面板） ===== */
    function openProject() {
        _showProjectListPanel();
    }

    /* ===== 从文件加载项目（兼容旧逻辑） ===== */
    function loadProjectFromFile(file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = JSON.parse(e.target.result);
                if (!data || !data.tracks) throw new Error('无效的项目文件');
                restoreProjectData(data);
                showProjectToast('项目已从文件加载');
            } catch (err) {
                alert('加载项目失败：' + err.message);
            }
        };
        reader.readAsText(file);
    }

    /* ===== 项目列表面板 ===== */
    function _showProjectListPanel() {
        // 如果已存在则直接显示
        let panel = document.getElementById('project-list-panel');
        if (panel) {
            panel.style.display = 'flex';
            _refreshProjectList();
            return;
        }

        panel = document.createElement('div');
        panel.id = 'project-list-panel';
        panel.className = 'project-list-panel';
        panel.innerHTML = `
            <div class="project-list-inner">
                <div class="project-list-header">
                    <span class="project-list-title">📂 我的项目</span>
                    <button class="project-list-close" id="project-list-close">✕</button>
                </div>
                <div class="project-list-actions">
                    <button class="project-list-btn" id="project-list-new">📄 新建空白项目</button>
                    <button class="project-list-btn" id="project-list-import">📂 从文件导入</button>
                </div>
                <div class="project-list-items" id="project-list-items">
                    <!-- JS 填充 -->
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        document.getElementById('project-list-close').addEventListener('click', () => {
            panel.style.display = 'none';
        });
        document.getElementById('project-list-new').addEventListener('click', () => {
            panel.style.display = 'none';
            newProject();
        });
        document.getElementById('project-list-import').addEventListener('click', () => {
            _triggerOpenFile(panel);
        });

        // 点击面板外部关闭
        panel.addEventListener('click', (e) => {
            if (e.target === panel) panel.style.display = 'none';
        });

        _refreshProjectList();
    }

    function _refreshProjectList() {
        const container = document.getElementById('project-list-items');
        if (!container) return;

        const projects = getSavedProjects();
        if (projects.length === 0) {
            container.innerHTML = '<div class="project-list-empty">暂无保存的项目<br>点击「保存项目」创建第一个项目</div>';
            return;
        }

        container.innerHTML = '';
        projects.forEach(proj => {
            const item = document.createElement('div');
            item.className = 'project-list-item';
            if (localStorage.getItem(ACTIVE_KEY) === proj.id) {
                item.classList.add('active');
            }

            const dateStr = new Date(proj.updatedAt).toLocaleString('zh-CN', {
                month: '2-digit', day: '2-digit',
                hour : '2-digit', minute: '2-digit'
            });

            item.innerHTML = `
                <div class="project-item-name" title="${proj.name}">${proj.name}</div>
                <div class="project-item-date">${dateStr}</div>
                <div class="project-item-actions">
                    <button class="project-item-btn project-item-open" title="打开">📂</button>
                    <button class="project-item-btn project-item-rename" title="重命名">✏️</button>
                    <button class="project-item-btn project-item-export" title="导出">📥</button>
                    <button class="project-item-btn project-item-delete" title="删除">🗑️</button>
                </div>
            `;

            // 打开
            item.querySelector('.project-item-open').addEventListener('click', (e) => {
                e.stopPropagation();
                _openProjectById(proj.id);
                document.getElementById('project-list-panel').style.display = 'none';
            });

            // 重命名
            item.querySelector('.project-item-rename').addEventListener('click', (e) => {
                e.stopPropagation();
                const newName = prompt('输入新名称：', proj.name);
                if (newName && newName.trim()) {
                    const raw = localStorage.getItem(STORAGE_KEY) || '{}';
                    const map = JSON.parse(raw);
                    if (map[proj.id]) {
                        map[proj.id].name = newName.trim();
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
                        _refreshProjectList();
                    }
                }
            });

            // 导出
            item.querySelector('.project-item-export').addEventListener('click', (e) => {
                e.stopPropagation();
                const raw = localStorage.getItem(STORAGE_KEY) || '{}';
                const map = JSON.parse(raw);
                if (map[proj.id]) {
                    downloadProject(map[proj.id].data, proj.name + PROJECT_EXT);
                }
            });

            // 删除
            item.querySelector('.project-item-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                if (!confirm('确定删除项目「' + proj.name + '」？')) return;
                deleteFromLibrary(proj.id);
                if (localStorage.getItem(ACTIVE_KEY) === proj.id) {
                    localStorage.removeItem(ACTIVE_KEY);
                }
                _refreshProjectList();
            });

            container.appendChild(item);
        });
    }

    function _openProjectById(id) {
        const proj = loadFromLibrary(id);
        if (!proj) {
            alert('项目不存在或已损坏');
            return;
        }
        restoreProjectData(proj.data);
        localStorage.setItem(ACTIVE_KEY, id);
        showProjectToast('📂 已打开项目：「' + proj.name + '」');
    }

    function _triggerOpenFile(panel) {
        let input = document.getElementById('project-file-input');
        if (!input) {
            input = document.createElement('input');
            input.type    = 'file';
            input.accept  = '.wp,.json,application/json';
            input.id      = 'project-file-input';
            input.style.display = 'none';
            input.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    loadProjectFromFile(e.target.files[0]);
                    if (panel) panel.style.display = 'none';
                }
            });
            document.body.appendChild(input);
        }
        input.click();
    }

    /* ===== Toast 提示 ===== */
    function showProjectToast(msg) {
        const existing = document.querySelector('.project-toast');
        if (existing) existing.remove();
        const el = document.createElement('div');
        el.className = 'project-toast';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2500);
    }

    /* ===== 绑定"项目"按钮菜单 ===== */
    function initProjectMenu() {
        const btn = document.getElementById('btn-project');
        if (!btn) return;

        let menu = document.getElementById('project-menu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id       = 'project-menu';
            menu.className = 'project-menu';
            menu.innerHTML = `
                <div class="project-menu-item" data-action="open">📂 打开项目</div>
                <div class="project-menu-item" data-action="save">💾 保存项目</div>
                <div class="project-menu-item" data-action="saveas">📝 另存为...</div>
                <div class="project-menu-item" data-action="export">📥 导出为文件</div>
                <div class="project-menu-item" data-action="new">📄 新建项目</div>
            `;
            menu.style.display = 'none';
            btn.style.position = 'relative';
            btn.appendChild(menu);

            menu.querySelectorAll('.project-menu-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = item.dataset.action;
                    if (action === 'new')    newProject();
                    if (action === 'open')   openProject();
                    if (action === 'save')   saveProject();
                    if (action === 'saveas') saveProjectAs();
                    if (action === 'export') exportProject();
                    menu.style.display = 'none';
                });
            });
        }

        // 切换菜单显示
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });

        // 点击其他地方关闭菜单
        document.addEventListener('click', () => {
            if (menu) menu.style.display = 'none';
        });
    }

    /* ===== 初始化 ===== */
    function init() {
        initProjectMenu();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 暴露 API
    window.ProjectManager = {
        save      : saveProject,
        load      : loadProjectFromFile,
        new       : newProject,
        openList  : openProject,
        collectData: collectProjectData,
    };
})();
