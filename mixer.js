/**
 * WaveParty Mixer
 * 每轨道独立推子 + 声像旋钮 + VU 表
 */

window.Mixer = (function () {
    'use strict';

    let vuAnimId = null;
    let faderDrag = null;

    function init() {
        document.getElementById('btn-mixer').addEventListener('click', openMixer);
        document.getElementById('mixer-modal-close').addEventListener('click', () => {
            document.getElementById('mixer-modal').style.display = 'none';
            stopVU();
        });
    }

    function openMixer() {
        renderMixer();
        document.getElementById('mixer-modal').style.display = 'flex';
        startVU();
    }

    function renderMixer() {
        const body = document.getElementById('mixer-body');
        body.innerHTML = '';

        const tracks = Tracks.getAllTracks();
        // Master channel
        body.appendChild(createChannel({ id: 'master', name: 'Master', color: '#7c4dff', volume: 80, pan: 0 }, true));
        tracks.forEach(t => body.appendChild(createChannel(t, false)));
    }

    function createChannel(track, isMaster) {
        const el = document.createElement('div');
        el.className = 'mixer-channel' + (isMaster ? ' master-channel' : '');
        el.dataset.trackId = track.id;

        const vol = track.volume !== undefined ? track.volume : 80;

        el.innerHTML = `
            <div class="mixer-ch-name">${isMaster ? 'Master' : track.name}</div>
            <div class="mixer-ch-color" style="background:${track.color || '#7c4dff'}"></div>
            <div class="mixer-ch-row" style="display:flex;gap:6px;align-items:flex-end;">
                <div class="mixer-fader-track" data-track="${track.id}">
                    <div class="mixer-fader-fill" style="height:${vol}%"></div>
                    <div class="mixer-fader-thumb" style="bottom:calc(${vol}% - 4px)"></div>
                </div>
                <div class="mixer-vu">
                    <div class="mixer-vu-bar"><div class="mixer-vu-fill" data-vu="${track.id}-L"></div></div>
                    <div class="mixer-vu-bar"><div class="mixer-vu-fill" data-vu="${track.id}-R"></div></div>
                </div>
            </div>
            <div class="mixer-pan-knob" data-track="${track.id}" title="声像: ${track.pan || 0}"></div>
            <div class="mixer-ch-vol-display" data-vol="${track.id}">${vol}%</div>
            <div class="mixer-ch-buttons">
                <button class="mixer-mute-btn${track.muted ? ' active' : ''}" data-track="${track.id}">M</button>
                <button class="mixer-solo-btn${track.soloed ? ' active' : ''}" data-track="${track.id}">S</button>
            </div>
        `;

        // Fader drag
        const faderTrack = el.querySelector('.mixer-fader-track');
        let isDragging = false;
        let dragStartY = 0, dragStartVol = vol;

        faderTrack.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            isDragging = true;
            dragStartY = e.clientY;
            dragStartVol = parseFloat(faderTrack.querySelector('.mixer-fader-fill').style.height);
            faderTrack.setPointerCapture(e.pointerId);
        });
        faderTrack.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            const dy = dragStartY - e.clientY;
            const newVol = Math.max(0, Math.min(100, dragStartVol + dy * 0.7));
            updateFader(el, track.id, newVol);
        });
        faderTrack.addEventListener('pointerup', () => { isDragging = false; });
        faderTrack.addEventListener('pointercancel', () => { isDragging = false; });

        // Pan knob drag
        const panKnob = el.querySelector('.mixer-pan-knob');
        let panDrag = false, panStartX = 0, panStartVal = track.pan || 0;
        panKnob.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            panDrag = true;
            panStartX = e.clientX;
            panStartVal = track.pan || 0;
            panKnob.setPointerCapture(e.pointerId);
        });
        panKnob.addEventListener('pointermove', (e) => {
            if (!panDrag) return;
            const dx = e.clientX - panStartX;
            const newPan = Math.max(-100, Math.min(100, panStartVal + dx));
            if (!isMaster) {
                const t = Tracks.getTrackById(track.id);
                if (t) { t.pan = newPan; AudioEngine.setTrackPan(track.id, newPan); }
            }
            const angle = (newPan / 100) * 140;
            panKnob.style.transform = `rotate(${angle}deg)`;
            panKnob.title = '声像: ' + Math.round(newPan);
        });
        panKnob.addEventListener('pointerup', () => { panDrag = false; });

        // Mute/Solo
        el.querySelector('.mixer-mute-btn').addEventListener('click', e => {
            const t = Tracks.getTrackById(track.id);
            if (!t) return;
            t.muted = !t.muted;
            e.target.classList.toggle('active', t.muted);
            AudioEngine.setTrackVolume(track.id, t.muted ? 0 : t.volume);
        });
        el.querySelector('.mixer-solo-btn').addEventListener('click', e => {
            const t = Tracks.getTrackById(track.id);
            if (!t) return;
            t.soloed = !t.soloed;
            e.target.classList.toggle('active', t.soloed);
        });

        return el;
    }

    function updateFader(channelEl, trackId, vol) {
        const fill = channelEl.querySelector('.mixer-fader-fill');
        const thumb = channelEl.querySelector('.mixer-fader-thumb');
        const display = channelEl.querySelector(`[data-vol="${trackId}"]`);
        if (fill) fill.style.height = vol + '%';
        if (thumb) thumb.style.bottom = `calc(${vol}% - 4px)`;
        if (display) display.textContent = Math.round(vol) + '%';
        if (trackId === 'master') {
            AudioEngine.setMasterVolume(vol);
        } else {
            const t = Tracks.getTrackById(trackId);
            if (t) { t.volume = vol; if (!t.muted) AudioEngine.setTrackVolume(trackId, vol); }
        }
    }

    function startVU() {
        const analyser = AudioEngine.getAnalyser();
        if (!analyser) return;
        const data = new Uint8Array(analyser.frequencyBinCount);

        function animate() {
            analyser.getByteFrequencyData(data);
            const avg = data.reduce((a, b) => a + b, 0) / data.length;
            const level = Math.min(100, (avg / 128) * 100);
            // Update all VU meters
            document.querySelectorAll('.mixer-vu-fill').forEach(el => {
                const rand = level * (0.7 + Math.random() * 0.3);
                el.style.height = rand + '%';
            });
            vuAnimId = requestAnimationFrame(animate);
        }
        animate();
    }

    function stopVU() {
        if (vuAnimId) { cancelAnimationFrame(vuAnimId); vuAnimId = null; }
        document.querySelectorAll('.mixer-vu-fill').forEach(el => el.style.height = '0%');
    }

    return { init };
})();
