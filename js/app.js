// js/app.js

const App = {
    user: null,
    
    // --- MOTOR TIMER 2.0 (DRIFT-FREE) ---
    timerRAF: null,
    timerStartTime: 0,
    timerSeconds: 0,
    isTimerRunning: false,
    currentTimerType: null,
    
    wodCache: {},
    audioCtx: null, 
    wakeLock: null, 
    currentInboxData: {}, // Almacén seguro para evitar rupturas de texto en botones

    // CREDENCIALES CLOUDINARY
    cloudinaryCloudName: 'dbekfqd9s',
    cloudinaryPreset: 'lionbeat_videos',

    // VARIABLES PARA EL MOTOR DE INTERVALOS / EMOM
    timerRoundDuration: 0,
    timerCurrentRoundTime: 0,
    timerTotalRounds: 0,

    // VARIABLES PARA EL MOTOR WORK/REST
    timerWorkDuration: 0,
    timerRestDuration: 0,
    timerCurrentPhaseTime: 0,
    isWorkingPhase: true,
    timerCurrentRound: 1,

    // VARIABLES PARA LA CUENTA ATRÁS
    isCountingDown: true,
    countdownSeconds: 10,

    init: () => {
        const savedUser = localStorage.getItem('user');
        if (savedUser && savedUser !== "undefined") {
            try {
                App.user = JSON.parse(savedUser);
                
                // REDIRECCIÓN INTELIGENTE DE INICIO SEGÚN ROL
                if (App.user && App.user.rol === 'coach') {
                    App.renderCoachPanel(); // El administrador va directo a su panel limpio
                } else {
                    App.renderDashboard();  // El atleta va a su WOD y cuestionarios
                }
            } catch (e) {
                localStorage.removeItem('user');
                App.renderLogin();
            }
        } else {
            App.renderLogin();
        }

        App.syncOfflineQueue();
        window.addEventListener('online', App.syncOfflineQueue);
    },

    // --- MOTOR DE SINCRONIZACIÓN OFFLINE ---
    syncOfflineQueue: async () => {
        let offlineQ = JSON.parse(localStorage.getItem('offlineResults') || '[]');
        if (offlineQ.length === 0 || !navigator.onLine) return; 
        
        console.log(`⚡ Sincronizando ${offlineQ.length} marcas offline...`);
        let remainingQ = []; 
        
        for (let payload of offlineQ) {
            try {
                let res = await apiCall(payload);
                if (!res.success) remainingQ.push(payload); 
            } catch(e) {
                remainingQ.push(payload); 
            }
        }
        
        localStorage.setItem('offlineResults', JSON.stringify(remainingQ));
        if(remainingQ.length === 0 && offlineQ.length > 0) {
            App.showToast("✅ Sincronización offline completada con éxito.");
            App.renderDashboard();
        }
    },

    // --- SISTEMA NATIVO DE TOASTS / NOTIFICACIONES FLOTANTES ---
    showToast: (message) => {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'custom-toast';
        const icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '●';
        const text = document.createElement('div');
        text.textContent = String(message ?? '');
        toast.append(icon, text);
        container.appendChild(toast);

        // Forzado de reflow controlado para disparar la animación acelerada por hardware
        toast.getBoundingClientRect();
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 5000);
    },

    // --- DETECTOR INTELIGENTE DE NOTIFICACIONES (SEPARA ATLETA Y COACH) ---
    checkCoachNotifications: (historyData) => {
        if (!historyData || historyData.length === 0 || !App.user) return;

        if (App.user.rol === 'atleta') {
            const latestWithReply = historyData.find(item => item.feedback && item.feedback.includes('[COACH:'));
            if (!latestWithReply) return;

            const replyMatch = latestWithReply.feedback.match(/\[COACH:\s*([^\]]+)\]/);
            if (!replyMatch || !replyMatch[1]) return;

            const currentReplyText = replyMatch[1].trim();
            const storageKey = `last_read_coach_reply_${App.user.id}`;
            const lastReadReply = localStorage.getItem(storageKey);

            if (lastReadReply !== currentReplyText) {
                setTimeout(() => {
                    App.showToast(`¡El Coach ha respondido a tu entreno del ${latestWithReply.fecha}!`);
                }, 1000);
                localStorage.setItem(storageKey, currentReplyText);
            }
        } 
        else if (App.user.rol === 'coach') {
            const pendingFeedback = historyData.find(item => item.feedback && !item.feedback.includes('[COACH:'));
            if (!pendingFeedback) return;

            const storageKeyCoach = `last_notified_feedback_to_coach`;
            const lastNotifiedUid = localStorage.getItem(storageKeyCoach);
            const currentUid = `${pendingFeedback.id_usuario}_${pendingFeedback.fecha.replace(/\//g,'')}`;

            if (lastNotifiedUid !== currentUid) {
                setTimeout(() => {
                    App.showToast(`📥 Nuevo feedback recibido de ${pendingFeedback.nombre.toUpperCase()} (${pendingFeedback.fecha})`);
                }, 1000);
                localStorage.setItem(storageKeyCoach, currentUid);
            }
        }
    },

    // --- ACCIÓN CENTRALIZED: ENVIAR REPORTE MATUTINO A GOOGLE ---
    saveReadiness: async (dateES) => {
        const sleepVal = document.getElementById('ready-sleep').value;
        const domsVal = document.getElementById('ready-doms').value;
        const energyVal = document.getElementById('ready-energy').value;

        const totalScore = parseInt(sleepVal) + parseInt(domsVal) + parseInt(energyVal);
        const readinessKey = `readiness_${App.user.id}_${dateES}`;

        App.showToast("⏳ Transmitiendo reporte matutino...");

        const response = await apiCall({
            action: 'saveReadiness',
            id_usuario: App.user.id,
            nombre: App.user.nombre,
            fecha: dateES,
            sleep: sleepVal,
            doms: domsVal,
            energy: energyVal
        });

        if (response && response.success) {
            localStorage.setItem(readinessKey, totalScore.toString());
            App.showToast("🟢 Reporte enviado al Coach con éxito.");
            
            setTimeout(() => { 
                const picker = document.getElementById('datePicker');
                App.renderDashboard(picker ? picker.value.split('-').reverse().join('/') : null); 
            }, 1000);
        } else {
            App.showToast("❌ Error al conectar con el servidor central.");
        }
    },

    // --- CALCULADORA 1RM ---
    calculate1RM: (val) => {
        const resDiv = document.getElementById('calc-results');
        if (!resDiv || !val || val <= 0) { if(resDiv) resDiv.innerHTML = ''; return; }
        const weight = parseFloat(val);
        const percentages = [50, 55, 60, 65, 70, 75, 80, 82.5, 85, 87.5, 90, 92.5, 95, 97.5, 100, 105];
        resDiv.innerHTML = percentages.map(p => `
            <div style="background: var(--bg-dark); padding: 10px 4px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
                <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700;">${p}%</div>
                <div style="font-weight: 700; color: var(--text-main); font-family: var(--font-title); font-size: 1.1rem; margin-top: 2px;">${(weight * p / 100).toFixed(1)}</div>
            </div>
        `).join('');
    },

    // --- GESTIÓN DE BENCHMARKS LOCALES ---
    getBenchmarks: () => JSON.parse(localStorage.getItem(`benchmarks_${App.user.id}`) || '{"snatch":"-","cj":"-","squat":"-","deadlift":"-","fran":"-","run5k":"-"}'),

    updateBenchmark: (key, name) => {
        const currentBenchs = App.getBenchmarks();
        const currentVal = currentBenchs[key] && currentBenchs[key] !== '-' ? currentBenchs[key] : '';
        const newVal = prompt(`Actualizar marca de ${name}:`, currentVal);
        
        if (newVal !== null && newVal.trim() !== "") {
            currentBenchs[key] = newVal.trim();
            localStorage.setItem(`benchmarks_${App.user.id}`, JSON.stringify(currentBenchs));
            App.renderUserHistory(); 
        }
    },

    // --- GRÁFICO DE FATIGA (RPE) ---
    renderFatigueChart: async () => {
        const container = document.getElementById('fatigue-chart-container');
        if (!container) return;
        
        try {
            const res = await apiCall({ action: 'getUserHistory', userId: App.user.id });
            if (!res.success || !res.data || res.data.length === 0) {
                container.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-muted); text-align: center;">Sin datos suficientes de RPE.</p>`;
                return;
            }
            
            App.checkCoachNotifications(res.data);

            const recentHistory = res.data.slice(0, 7).reverse(); 
            let barsHTML = '';
            recentHistory.forEach(item => {
                let rpeVal = 0; 
                const rpeMatch = (item.feedback || '').match(/rpe[:\s]*(\d+)/i) || (item.score || '').match(/rpe[:\s]*(\d+)/i);
                if (rpeMatch && rpeMatch[1]) rpeVal = parseInt(rpeMatch[1]);
                if (rpeVal > 10) rpeVal = 10;
                let barColor = 'var(--bg-surface)';
                if (rpeVal > 0 && rpeVal <= 6) barColor = 'var(--success)';
                if (rpeVal >= 7 && rpeVal <= 8) barColor = 'var(--warning)';
                if (rpeVal >= 9) barColor = 'var(--danger)';
                const heightPercent = rpeVal === 0 ? 10 : (rpeVal * 10); 
                barsHTML += `
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1;">
                        <div style="width: 100%; height: 60px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; align-items: flex-end; overflow: hidden;">
                            <div style="width: 100%; height: ${heightPercent}%; background: ${barColor};"></div>
                        </div>
                        <span style="font-size: 0.65rem; color: var(--text-muted); font-weight: 700;">${rpeVal > 0 ? rpeVal : '-'}</span>
                    </div>`;
            });
            container.innerHTML = `
                <div style="background: var(--bg-surface); padding: 16px; border-radius: var(--radius-sm); margin-bottom: 24px; border-left: 3px solid #888;">
                    <h3 style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px; letter-spacing: 1px;">CNS FATIGUE RADAR</h3>
                    <div style="display: flex; gap: 8px; justify-content: space-between; width: 100%;">${barsHTML}</div>
                </div>`;
        } catch (err) {
            console.error("Error cargando el radar de fatiga:", err);
            container.innerHTML = '';
        }
    },

    // --- RECEPTOR DE VÍDEOS (CLOUDINARY) ---
    uploadVideosToCloudinary: async (files) => {
        const statusDiv = document.getElementById('upload-status');
        if (!statusDiv) return [];
        statusDiv.style.display = 'block';
        let uploadedUrls = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const formData = new FormData();
            formData.append('file', file);
            formData.append('upload_preset', App.cloudinaryPreset);
            try {
                statusDiv.innerHTML = `Subiendo vídeo ${i + 1} de ${files.length}...`;
                const response = await fetch(`https://api.cloudinary.com/v1_1/${App.cloudinaryCloudName}/video/upload`, { method: 'POST', body: formData });
                const data = await response.json();
                if (data.secure_url) uploadedUrls.push(data.secure_url);
            } catch (err) { console.error(err); }
        }
        statusDiv.innerHTML = `✅ Vídeos listos.`;
        return uploadedUrls;
    },

    // --- REPRODUCIR VÍDEO COMPACTO MODAL ---
    openVideoModal: (url) => {
        let modal = document.getElementById('video-modal');
        if (!modal) {
            modal = document.createElement('div'); modal.id = 'video-modal';
            modal.style = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:9999; display:flex; flex-direction:column; justify-content:center; align-items:center; padding:16px;";
            document.body.appendChild(modal);
        }
        modal.innerHTML = `
            <div style="width:100%; max-width:500px; display:flex; justify-content:flex-end; margin-bottom:12px;">
                <button onclick="document.getElementById('video-modal').style.display='none'; document.getElementById('app-modal-player').pause();" class="logout-mini" style="width:auto; margin:0; background:var(--danger); color:#fff;">✕ CERRAR</button>
            </div>
            <video id="app-modal-player" src="${url}" controls autoplay playsinline style="width:100%; max-width:500px; aspect-ratio:9/16; background:#000; border-radius:var(--radius-sm); object-fit:contain;"></video>
        `;
        modal.style.display = 'flex';
    },

    // --- PARSEO MULTIMEDIA ---
    extractVideoButtonsHTML: (feedbackString) => {
        if (!feedbackString) return { cleanFeedback: '', buttonsHTML: '', coachReply: '' };
        let cleanFeedback = feedbackString;
        let buttonsHTML = ''; let coachReply = '';

        const coachMatch = cleanFeedback.match(/\[COACH:\s*([^\]]+)\]/);
        if (coachMatch && coachMatch[1]) {
            coachReply = coachMatch[1].trim();
            cleanFeedback = cleanFeedback.replace(/\[COACH:\s*[^\]]+\]/, '').trim();
        }
        const videoMatch = cleanFeedback.match(/\[VIDEO:\s*([^\]]+)\]/);
        if (videoMatch && videoMatch[1]) {
            cleanFeedback = cleanFeedback.replace(/\[VIDEO:\s*[^\]]+\]/, '').trim();
            const urls = videoMatch[1].split(',').map(u => u.trim());
            buttonsHTML = `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">` + urls.map((url, idx) => `
                <button type="button" onclick="App.openVideoModal('${url}')" class="logout-mini" style="background:#0056b3; color:#fff; border-radius:var(--radius-sm); padding:6px 12px; font-size:0.75rem; width:auto; min-height:auto; margin:0;">▶️ TÉCNICA ${urls.length > 1 ? idx + 1 : ''}</button>
            `).join('') + `</div>`;
        }
        cleanFeedback = cleanFeedback.replace(/\[RPE:\s*\d+\]/, '').trim();
        return { cleanFeedback, buttonsHTML, coachReply };
    },

    // --- ENVIAR FEEDBACK DEL COACH ---
    submitCoachReply: async (btn, idUsuario, fechaOriginal) => {
        const parentCard = btn.closest('.card-glass');
        if (!parentCard) return;

        const replyInput = parentCard.querySelector('input[id^="reply-input-"]');
        if (!replyInput || replyInput.value.trim() === "") {
            App.showToast("⚠️ Escribe un comentario antes de enviar.");
            return;
        }

        const textoRespuestaCoach = replyInput.value.trim();
        const blockKey = replyInput.id.replace('reply-input-', '');

        btn.disabled = true;
        btn.innerText = "ENVIANDO...";

        const originalText = App.currentInboxData[blockKey] || "";
        let cleanedBase = originalText.replace(/\[COACH:\s*[^\]]+\]/, '').trim();
        let updatedFeedback = `${cleanedBase} [COACH: ${textoRespuestaCoach}]`;

        const payload = {
            action: 'saveResult',
            id_usuario: String(idUsuario),
            fecha: String(fechaOriginal),
            feedback: updatedFeedback,
            overwriteCoach: true
        };

        try {
            const res = await apiCall(payload);
            if (res && res.success) {
                App.showToast("🚀 ¡Feedback enviado al atleta!");
                
                Object.keys(sessionStorage).forEach(key => {
                    if (key.includes('getGlobalFeedback')) {
                        sessionStorage.removeItem(key);
                    }
                });

                const wrapPendientes = document.getElementById('wrapper-feedbacks-pendientes');
                const wrapHistorial = document.getElementById('wrapper-feedbacks-historial');
                const tabPendientes = document.getElementById('coach-tab-pendientes');
                const tabHistorial = document.getElementById('coach-tab-historial');

                if (wrapHistorial && parentCard) {
                    parentCard.style.borderLeft = "3px solid var(--text-muted)";
                    
                    const tagScore = parentCard.querySelector('.tag');
                    if (tagScore) {
                        tagScore.style.background = "rgba(255,255,255,0.1)";
                        tagScore.style.color = "var(--text-muted)";
                    }

                    const quickReplies = parentCard.querySelector('.quick-replies-container');
                    if (quickReplies) quickReplies.remove();
                    const inputRow = replyInput.closest('div'); 
                    if (inputRow) inputRow.remove();

                    const respuestaHTML = document.createElement('div');
                    respuestaHTML.style.cssText = "margin-top:12px; background:rgba(46,204,113,0.05); padding:10px; border-left:2px solid var(--success); border-radius:0 4px 4px 0; text-align: left;";
                    respuestaHTML.innerHTML = `
                        <p style="font-size:0.75rem; color:var(--success); margin:0; font-weight:800; text-transform:uppercase; letter-spacing:0.5px;">Tu Respuesta:</p>
                        <p style="font-size:0.85rem; color:var(--text-main); margin:4px 0 0 0; text-align: left;">${textoRespuestaCoach}</p>
                    `;
                    parentCard.appendChild(respuestaHTML);

                    wrapHistorial.insertBefore(parentCard, wrapHistorial.firstChild);

                    if (tabPendientes && tabHistorial) {
                        let numPendientes = parseInt(tabPendientes.innerText.match(/\d+/)[0]) - 1;
                        let numHistorial = parseInt(tabHistorial.innerText.match(/\d+/)[0]) + 1;

                        tabPendientes.innerText = `📥 Pendientes (${numPendientes})`;
                        tabHistorial.innerText = `📁 Historial (${numHistorial})`;

                        if (numPendientes === 0 && wrapPendientes) {
                            wrapPendientes.innerHTML = '<p style="font-size:0.85rem; color:var(--text-muted); text-align:center; padding: 25px 0; margin:0;">🎉 ¡Al día! No tienes feedbacks pendientes de revisión.</p>';
                        }
                        
                        if (wrapHistorial.innerHTML.includes("El historial de respuestas está vacío.")) {
                            wrapHistorial.innerHTML = "";
                            wrapHistorial.appendChild(parentCard);
                        }
                    }
                }

            } else {
                App.showToast("❌ El servidor no ha podido guardar la respuesta: " + (res.message || "Error desconocido"));
                btn.disabled = false;
                btn.innerText = "RESPONDER";
            }
        } catch (error) {
            console.error("Error en la conexión apiCall:", error);
            App.showToast("❌ Error de conexión con Google Sheets.");
            btn.disabled = false;
            btn.innerText = "RESPONDER";
        }
    },

    formatDateToES: (date) => { const d = String(date.getDate()).padStart(2, '0'); const m = String(date.getMonth() + 1).padStart(2, '0'); return `${d}/${m}/${date.getFullYear()}`; },
    formatDateToISO: (date) => { const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0'); return `${date.getFullYear()}-${m}-${d}`; },
    requestWakeLock: async () => { if ('wakeLock' in navigator) { try { App.wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {} } },
    releaseWakeLock: () => { if (App.wakeLock !== null) { App.wakeLock.release().then(() => { App.wakeLock = null; }); } },

    renderHeader: (title, subtitle) => `
        <header class="main-header">
            <div class="user-info">
                <div class="avatar" style="display:flex; align-items:center; justify-content:center; font-size:1.8rem; font-family:var(--font-title); color:var(--accent-color);">${App.user.nombre.charAt(0).toUpperCase()}</div>
                <div><p class="welcome">${title}</p><p class="status">${subtitle}</p></div>
            </div>
            <div style="display:flex; gap:12px; align-items:center;">
                ${App.user.rol === 'coach' ? '<button onclick="App.renderCoachPanel()" class="btn-primary" style="padding: 10px 16px; font-size: 0.8rem; width: auto; min-height: auto;">+ PANEL COACH</button>' : ''}
                <button onclick="App.logout()" class="logout-mini">SALIR</button>
            </div>
        </header>`,

    renderNav: (activeTab, dateES = '') => `
        <div class="nav-tabs">
            <button class="tab-btn ${activeTab === 'entreno' ? 'active' : ''}" onclick="App.renderDashboard()">ENTRENO</button>
            <button class="tab-btn ${activeTab === 'ranking' ? 'active' : ''}" onclick="App.renderLeaderboard('${dateES}')">RANKING</button>
            <button class="tab-btn ${activeTab === 'marcas' ? 'active' : ''}" onclick="App.renderUserHistory()">MARCAS</button>
            <button class="tab-btn ${activeTab === 'timer' ? 'active' : ''}" onclick="App.renderTimer()">RELOJ</button>
            <button class="tab-btn ${activeTab === 'perfil' ? 'active' : ''}" onclick="App.renderProfile()">PERFIL</button>
        </div>`,

    renderView: (title, subtitle, activeTab, dateES, contentHTML) => {
        const appContainer = document.getElementById('app');
        let dashboardContainer = document.querySelector('.dashboard-container');
        if (!dashboardContainer) {
            appContainer.innerHTML = `
                <div class="dashboard-container">
                    <div id="shell-header">${App.renderHeader(title, subtitle)}</div>
                    <div id="shell-nav">${App.renderNav(activeTab, dateES)}</div>
                    <div id="main-content">${contentHTML}</div>
                </div>`;
        } else {
            document.getElementById('shell-header').innerHTML = App.renderHeader(title, subtitle);
            document.getElementById('shell-nav').innerHTML = App.renderNav(activeTab, dateES);
            document.getElementById('main-content').innerHTML = contentHTML;
        }
    },
    renderDashboard: async (targetDateStr = null) => {
        let currentDate = targetDateStr ? new Date(targetDateStr.split('/').reverse().join('-')) : new Date();
        const dateES = App.formatDateToES(currentDate); 
        const dateISO = App.formatDateToISO(currentDate);
        
        let response;
        if (App.wodCache[dateES] && App.wodCache[dateES].success) {
            response = App.wodCache[dateES];
        } else {
            App.renderView(`Hola, ${App.user.nombre}`, App.user.rol === 'coach' ? 'MODO COACH' : 'ATLETA', 'entreno', dateES, `<div style="text-align:center; margin-top:50px;"><div class="loader"></div></div>`);
            
            response = await apiCall({ 
                action: 'getWod', 
                date: dateES, 
                id_usuario: App.user.id 
            }); 
            
            if (response && response.success) {
                App.wodCache[dateES] = response;
            }
        }

        // --- CUESTIONARIO MATUTINO ---
        let readinessHTML = ''; 
        const readinessKey = `readiness_${App.user.id}_${dateES}`; 
        const savedReadiness = localStorage.getItem(readinessKey);
        
        if (!savedReadiness) {
            readinessHTML = `
                <details class="accordion-panel fade-in" style="text-align: left !important;">
                    <summary style="color: var(--accent-color);">🧠 CONTROL DE PREPARACIÓN MATUTINO</summary>
                    <div class="card-inner-content readiness-container">
                        <div class="readiness-matrix">
                            <div class="readiness-cell">
                                <label>SUEÑO</label>
                                <select id="ready-sleep">
                                    <option value="5">5 - Excelente</option>
                                    <option value="4">4 - Bueno</option>
                                    <option value="3">3 - Regular</option>
                                    <option value="2">2 - Malo</option>
                                    <option value="1">1 - Fatal</option>
                                </select>
                            </div>
                            <div class="readiness-cell">
                                <label>DOMS</label>
                                <select id="ready-doms">
                                    <option value="5">5 - Sin dolor</option>
                                    <option value="4">4 - Leve</option>
                                    <option value="3">3 - Moderado</option>
                                    <option value="2">2 - Intenso</option>
                                    <option value="1">1 - Roto</option>
                                </select>
                            </div>
                            <div class="readiness-cell">
                                <label>ENERGÍA</label>
                                <select id="ready-energy">
                                    <option value="5">5 - A tope</option>
                                    <option value="4">4 - Alta</option>
                                    <option value="3">3 - Normal</option>
                                    <option value="2">2 - Baja</option>
                                    <option value="1">1 - Agotado</option>
                                </select>
                            </div>
                        </div>
                        <button class="btn-primary" style="padding: 12px 20px; font-size: 0.8rem; width: auto; font-weight:800; min-height: auto; margin:0;" onclick="App.saveReadiness('${dateES}')">ENVIAR REPORTE</button>
                    </div>
                </details>`;
        } else if (parseInt(savedReadiness) <= 8) {
            readinessHTML = `
                <div class="alert-cns-critical fade-in" style="text-align: left !important;">
                    <p class="alert-cns-title">⚠️ ALERTA: FATIGA CENTRAL ALTA (CNS)</p>
                    <p style="font-size: 0.85rem; color: var(--text-main); line-height: 1.4; margin:0;">
                        Tu nivel hoy es crítico (${savedReadiness}/15). Auto-regula la sesión: reduce los porcentajes de carga un 5-10% u optimiza los descansos.
                    </p>
                </div>`;
        }

        // --- DETECTOR AUTOMÁTICO DE RENOVACIÓN DE TARIFA ---
        let paymentAlertHTML = '';
        if (App.user && App.user.rol === 'atleta' && App.user.fecha_pago) {
            try {
                const parts = App.user.fecha_pago.split('/');
                const fechaRenovacion = new Date(parts[2], parts[1] - 1, parts[0]);
                const fechaHoy = new Date();
                
                fechaRenovacion.setHours(0,0,0,0);
                fechaHoy.setHours(0,0,0,0);
                
                const diferenciaTiempo = fechaRenovacion.getTime() - fechaHoy.getTime();
                const diasRestantes = Math.ceil(diferenciaTiempo / (1000 * 60 * 60 * 24));

                if (diasRestantes <= 3) {
                    let mensajeTarifa = '';
                    if (diasRestantes > 0) {
                        mensajeTarifa = `Tu tarifa vence en ${diasRestantes} ${diasRestantes === 1 ? 'día' : 'días'} (${App.user.fecha_pago}).`;
                    } else if (diasRestantes === 0) {
                        mensajeTarifa = `¡ÚLTIMO DÍA! Tu tarifa vence hoy. Recuerda realizar tu renovación para mantener activa la consola.`;
                    } else {
                        mensajeTarifa = `ACCESO EXPIRADO: Tu tarifa venció el ${App.user.fecha_pago}. Contacta con tu coach para renovar tu plaza.`;
                    }

                    paymentAlertHTML = `
                        <div class="alert-payment-panel fade-in" style="text-align: left !important;">
                            <p class="alert-payment-title">💳 CONTROL DE SUSCRIPCIÓN</p>
                            <p style="font-size:0.85rem; color:var(--text-main); line-height:1.4; margin:0;">${mensajeTarifa}</p>
                        </div>`;
                }
            } catch (err) {
                console.log("Error en el cálculo de la suscripción:", err);
            }
        }

        if (!response || !response.success) {
            App.renderView(`Hola, ${App.user.nombre}`, App.user.rol === 'coach' ? 'MODO COACH' : 'ATLETA', 'entreno', dateES, `
                <div class="calendar-nav">
                    <button onclick="App.changeDate(-1)" aria-label="Día anterior"><span style="transform: translateX(-1px); display: inline-block;">❮</span></button>
                    <input type="date" id="datePicker" value="${dateISO}">
                    <button onclick="App.changeDate(1)" aria-label="Día siguiente"><span style="transform: translateX(1px); display: inline-block;">❯</span></button>
                </div>
                ${paymentAlertHTML}
                ${readinessHTML}
                <div id="fatigue-chart-container"></div>
                <div class="accordion-panel" style="padding: 24px; text-align:center; color:var(--text-muted); font-weight:500;">
                    Día de descanso activo o sin programación registrada.
                </div>
            `);
        } else {
            let helperVideosHTML = '';
            if (response.data.video) {
                let insideVideosHTML = '';
                const links = response.data.video.split(',');
                
                links.forEach((link, idx) => {
                    let currentLink = link.trim();
                    let exerciseName = "";

                    const nameMatch = currentLink.match(/^\[([^\]]+)\]/);
                    if (nameMatch && nameMatch[1]) {
                        exerciseName = nameMatch[1].trim().toUpperCase();
                        currentLink = currentLink.replace(/^\[[^\]]+\]/, '').trim();
                    } else {
                        exerciseName = `VÍDEO DE AYUDA ${links.length > 1 ? idx + 1 : ''}`;
                    }

                    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
                    const match = currentLink.match(regExp);
                    const videoId = (match && match[2].length === 11) ? match[2] : null;
                    
                    if (videoId) {
                        insideVideosHTML += `
                            <div style="margin-top: 16px; text-align: left !important; width: 100%;">
                                <p style="font-size: 0.75rem; color: var(--accent-color); margin-bottom: 6px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                                    📹 ${exerciseName}
                                </p>
                                <iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen style="width: 100%; aspect-ratio: 16/9; border-radius: var(--radius-sm); background: #000; margin-top: 0px;"></iframe>
                            </div>`;
                    }
                });

                if (insideVideosHTML.trim() !== "") {
                    helperVideosHTML = `
                        <details class="accordion-panel" style="margin-top: 20px; text-align: left !important;">
                            <summary>🎬 MOSTRAR VÍDEOS DE LA SESIÓN (${links.length})</summary>
                            <div class="card-inner-content" style="margin-top: 4px;">
                                ${insideVideosHTML}
                            </div>
                        </details>
                    `;
                }
            }

            const renderFormattedWod = (rawContent) => {
                if (!rawContent) return '';
                let generalPart = ""; let individualPart = "";
            
                if (rawContent.includes("🌍") && rawContent.includes("🎯")) {
                    const parts = rawContent.split(/───────────────────────/g);
                    if (parts.length >= 2) { generalPart = parts[0]; individualPart = parts[1]; }
                }
            
                const makeResponsiveHeader = (emoji, text, typeClass) => `
                    <div class="wod-header-group ${typeClass}">
                        <span class="wod-header-emoji">${emoji}</span>
                        <h3 class="wod-header-title">${text}</h3>
                    </div>
                `;
                
                const applyWodHighlights = (text) => {
                    if (!text) return '';
                    let formatted = text
                        .replace(/\*\*/g, '')
                        .replace(/([A-Z]\d?\))/g, '<strong>$1</strong>')
                        .replace(/(EMOM \d+|AMRAP \d+|TABATA|\d+ Rondas:|\d+ Rounds:)/gi, '<strong>$1</strong>')
                        .replace(/(Min \d+:|Minuto \d+:)/gi, '<strong>$1</strong>')
                        .replace(/(Ola \d+)/gi, '<strong>$1</strong>')
                        .replace(/(RPE \d+\.?\d*)/gi, '<strong>$1</strong>')
                        .replace(/(\d+\s?m\s|Run|Row|Ski|Burpees)/gi, '<strong>$1</strong>');
                    return formatted.replace(/\n/g, '<br>');
                };
            
                let finalHtml = "";
            
                if (generalPart && individualPart) {
                    let cleanIndiv = individualPart.replace(/🎯\s*\*\*\[\s*PROGRAMACIÓN ESPECÍFICA\s*]\*\*/gi, '').replace(/<br>/g, '\n').trim();
                    let cleanGen = generalPart.replace(/🌍\s*\*\*\[\s*PROGRAMACIÓN GENERAL\s*]\*\*/gi, '').replace(/<br>/g, '\n').trim();
            
                    finalHtml += makeResponsiveHeader("🎯", "PROGRAMACIÓN ESPECÍFICA", "specific");
                    finalHtml += `<div class="wod-content" style="border-left-color: #E63946;"><div class="wod-text-block">${applyWodHighlights(cleanIndiv)}</div></div>`;
                    finalHtml += makeResponsiveHeader("🌍", "PROGRAMACIÓN GENERAL", "general");
                    finalHtml += `<div class="wod-content"><div class="wod-text-block">${applyWodHighlights(cleanGen)}</div></div>`;
                } else {
                    let cleanContent = rawContent.replace(/<br>/g, '\n').trim();
                    const esEspecifico = (App.user && App.user.rol === 'atleta') && !cleanContent.includes("🌍");
            
                    if (esEspecifico) {
                        cleanContent = cleanContent.replace(/🎯\s*\*\*\[\s*PROGRAMACIÓN ESPECÍFICA\s*]\*\*/gi, '').replace(/🎯/g, '').trim();
                        finalHtml += makeResponsiveHeader("🎯", "PROGRAMACIÓN ESPECÍFICA", "specific");
                        finalHtml += `<div class="wod-content" style="border-left-color: #E63946;"><div class="wod-text-block">${applyWodHighlights(cleanContent)}</div></div>`;
                    } else {
                        cleanContent = cleanContent.replace(/🌍\s*\*\*\[\s*PROGRAMACIÓN GENERAL\s*]\*\*/gi, '').replace(/🌍/g, '').trim();
                        finalHtml += makeResponsiveHeader("🌍", "PROGRAMACIÓN GENERAL", "general");
                        finalHtml += `<div class="wod-content"><div class="wod-text-block">${applyWodHighlights(cleanContent)}</div></div>`;
                    }
                }
                return finalHtml;
            };

            App.renderView(`Hola, ${App.user.nombre}`, App.user.rol === 'coach' ? 'MODO COACH' : 'ATLETA', 'entreno', dateES, `
                <div class="calendar-nav">
                    <button onclick="App.changeDate(-1)" aria-label="Día anterior"><span style="transform: translateX(-1px); display: inline-block;">❮</span></button>
                    <input type="date" id="datePicker" value="${dateISO}">
                    <button onclick="App.changeDate(1)" aria-label="Día siguiente"><span style="transform: translateX(1px); display: inline-block;">❯</span></button>
                </div>
                
                ${paymentAlertHTML}
                ${readinessHTML} 
                <div id="fatigue-chart-container"></div>
                
                <div class="card-glass fade-in">
                    ${renderFormattedWod(response.data.content)}
                    <div class="card-inner-content" style="margin-top: 20px;">
                        ${helperVideosHTML}
                        <details class="accordion-panel" style="margin-top: 24px;">
                            <summary>🧮 CALCULADORA PORCENTAJES (1RM)</summary>
                            <div class="card-inner-content" style="padding-top: 12px;">
                                <input type="number" placeholder="Introduce tu 1RM" style="margin-bottom: 16px;" oninput="App.calculate1RM(this.value)">
                                <div id="calc-results" style="display:grid; grid-template-columns: repeat(4, 1fr); gap: 8px;"></div>
                            </div>
                        </details>
                        <button class="btn-action-wod" onclick="App.renderFeedbackForm()"><span>⚡ AÑADE TU RESULTADO</span></button>
                    </div>
                </div>
            `);
        }
        App.renderFatigueChart(); 
        App.initCalendarEvents();
    },

    renderLeaderboard: async (dateES) => {
        const targetDate = dateES || App.formatDateToES(new Date());
        App.renderView('Leaderboard', 'Comunidad', 'ranking', targetDate, `
            <div class="card-glass">
                <div id="leaderboard-list"><div style="text-align:center;"><div class="loader"></div></div></div>
            </div>
        `);
        
        const res = await apiCall({ 
            action: 'getLeaderboard', 
            date: targetDate,
            id_usuario: (App.user && App.user.id) ? App.user.id : "" 
        }); 
        
        const list = document.getElementById('leaderboard-list'); 
        if (!list) return;
        
        if (res.success && res.data && res.data.length > 0) {
            list.innerHTML = `
                <div class="leaderboard-list">
                    ${res.data.map((item, i) => `
                        <div class="leaderboard-item" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
                            <span class="athlete-name" style="font-weight: 700; color: var(--text-main);">${i + 1}. ${item.nombre.toUpperCase()}</span>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span class="athlete-score" style="color: var(--accent-color); font-weight: 800; font-size: 0.9rem;">${item.score}</span>
                                ${item.rpe ? `<span style="font-size: 0.7rem; color: var(--text-muted); background: rgba(255,255,255,0.04); padding: 2px 6px; border-radius: 4px; font-weight: 600;">RPE ${item.rpe}</span>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            list.innerHTML = "<p style='text-align:center; color:var(--text-muted); padding: 16px 0; margin:0; font-size:0.85rem;'>No hay marcas registradas en tu modalidad hoy.</p>";
        }
    },

    renderUserHistory: async () => {
        const benchs = App.getBenchmarks();
        App.renderView('PR Tracker', 'Tus marcas', 'marcas', '', `
            <h3 style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px; letter-spacing: 1px; font-weight: 700; text-transform: uppercase;">BENCHMARKS OFICIALES</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">
                <div class="card-glass" style="padding: 14px; text-align: center; cursor: pointer;" onclick="App.updateBenchmark('snatch', 'Snatch')">
                    <div style="font-size: 0.65rem; color: var(--accent-color); font-weight: 700; text-transform: uppercase;">Snatch</div>
                    <div style="font-family: var(--font-title); font-size: 1.3rem; font-weight: 700; color: var(--text-main); margin-top: 4px;">${benchs.snatch || '-'}</div>
                </div>
                <div class="card-glass" style="padding: 14px; text-align: center; cursor: pointer;" onclick="App.updateBenchmark('cj', 'Clean & Jerk')">
                    <div style="font-size: 0.65rem; color: var(--accent-color); font-weight: 700; text-transform: uppercase;">Clean & Jerk</div>
                    <div style="font-family: var(--font-title); font-size: 1.3rem; font-weight: 700; color: var(--text-main); margin-top: 4px;">${benchs.cj || '-'}</div>
                </div>
                <div class="card-glass" style="padding: 14px; text-align: center; cursor: pointer;" onclick="App.updateBenchmark('squat', 'Back Squat')">
                    <div style="font-size: 0.65rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Back Squat</div>
                    <div style="font-family: var(--font-title); font-size: 1.1rem; font-weight: 700; color: var(--text-main); margin-top: 4px;">${benchs.squat || '-'}</div>
                </div>
                <div class="card-glass" style="padding: 14px; text-align: center; cursor: pointer;" onclick="App.updateBenchmark('deadlift', 'Deadlift')">
                    <div style="font-size: 0.65rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Deadlift</div>
                    <div style="font-family: var(--font-title); font-size: 1.1rem; font-weight: 700; color: var(--text-main); margin-top: 4px;">${benchs.deadlift || '-'}</div>
                </div>
                <div class="card-glass" style="padding: 14px; text-align: center; cursor: pointer;" onclick="App.updateBenchmark('fran', 'Fran')">
                    <div style="font-size: 0.65rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Fran</div>
                    <div style="font-family: var(--font-title); font-size: 1.1rem; font-weight: 700; color: var(--text-main); margin-top: 4px;">${benchs.fran || '-'}</div>
                </div>
                <div class="card-glass" style="padding: 14px; text-align: center; cursor: pointer;" onclick="App.updateBenchmark('run5k', '5K Run')">
                    <div style="font-size: 0.65rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">5K Run</div>
                    <div style="font-family: var(--font-title); font-size: 1.1rem; font-weight: 700; color: var(--text-main); margin-top: 4px;">${benchs.run5k || '-'}</div>
                </div>
            </div>
            <div id="custom-benchmarks-container" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px;"></div>
            <button type="button" onclick="App.addCustomExercisePR()" class="logout-mini" style="width:100%; margin:0 0 32px 0; background:var(--bg-surface); border:1px dashed var(--warning); color:var(--warning); font-weight:700; letter-spacing:0.5px;">➕ AÑADIR EJERCICIO PERSONALIZADO</button>
            <h3 style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px; letter-spacing: 1px; font-weight: 700; text-transform: uppercase;">HISTORIAL DE WODS</h3>
            <div style="margin-bottom: 24px;">
                <input type="text" id="prSearch" placeholder="🔍 Buscar marca o movimiento...">
            </div>
            <div id="history-list"><div style="text-align:center;"><div class="loader"></div></div></div>
        `);

        App.renderCustomExerciseCards();

        const res = await apiCall({ action: 'getUserHistory', userId: App.user.id });
        const list = document.getElementById('history-list');
        if(!list) return;

        App.checkCoachNotifications(res.data);

        const renderItems = (data) => {
            if(data.length === 0) { list.innerHTML = "<p style='text-align:center; color:var(--text-muted);'>No hay registros guardados.</p>"; return; }
            list.innerHTML = data.map(item => {
                const decoded = App.extractVideoButtonsHTML(item.feedback);
                return `
                <div class="card-glass" style="padding: 20px; margin-bottom:12px; border-left: 4px solid var(--bg-surface);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <strong>${item.fecha}</strong><span class="tag">${item.score}</span>
                    </div>
                    ${decoded.cleanFeedback ? `
                        <p style="font-size:0.75rem; color:var(--accent-color); font-weight:700; margin-top:12px; text-transform:uppercase;">Notas:</p>
                        <p style="color:var(--text-muted); margin-top:2px; font-size:0.95rem;">${decoded.cleanFeedback}</p>` : ''}
                    ${decoded.coachReply ? `<div style="background:rgba(242,153,74,0.06); padding:10px; margin-top:12px; border-left:2px solid var(--warning);"><p style="font-size:0.85rem; color:var(--text-main);"><strong>Coach:</strong> ${decoded.coachReply}</p></div>` : ''}
                    ${decoded.buttonsHTML}
                </div>`;
            }).join('');
        };

        if(res.success) { 
            renderItems(res.data); 
            const searchInput = document.getElementById('prSearch');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    const term = e.target.value.toLowerCase();
                    renderItems(res.data.filter(i => (i.feedback || '').toLowerCase().includes(term) || i.fecha.includes(term) || i.score.toLowerCase().includes(term)));
                });
            }
        }
    },

    addCustomExercisePR: () => {
        const name = prompt("Nombre del ejercicio personalizado (Ej: 1 km Run, Shoulder Press...):");
        if (!name || name.trim() === "") return;
        
        const score = prompt(`Introduce la marca para "${name}":`);
        if (!score || score.trim() === "") return;

        const customKey = `custom_benchs_${App.user.id}`;
        let currentList = JSON.parse(localStorage.getItem(customKey) || "[]");
        
        const index = currentList.findIndex(i => i.name.toLowerCase() === name.trim().toLowerCase());
        if (index !== -1) {
            currentList[index].score = score.trim();
        } else {
            currentList.push({ name: name.trim(), score: score.trim() });
        }

        localStorage.setItem(customKey, JSON.stringify(currentList));
        App.renderCustomExerciseCards();
    },

    renderCustomExerciseCards: () => {
        const container = document.getElementById('custom-benchmarks-container');
        if (!container) return;
        
        const customKey = `custom_benchs_${App.user.id}`;
        const list = JSON.parse(localStorage.getItem(customKey) || "[]");
        
        container.innerHTML = list.map(item => `
            <div class="card-glass" style="padding: 14px; text-align: center; border-left: 2px solid var(--warning); position: relative; cursor:pointer;" data-exercise="${item.name}">
                <div style="font-size: 0.65rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 4px;">${item.name}</div>
                <div style="font-family: var(--font-title); font-size: 1.2rem; font-weight: 700; color: var(--warning); margin-top: 4px;">${item.score}</div>
            </div>
        `).join('');

        container.querySelectorAll('[data-exercise]').forEach(card => {
            card.addEventListener('click', () => {
                App.editOrDeleteCustomPR(card.getAttribute('data-exercise'));
            });
        });
    },

    editOrDeleteCustomPR: (name) => {
        const customKey = `custom_benchs_${App.user.id}`;
        let list = JSON.parse(localStorage.getItem(customKey) || "[]");
        const index = list.findIndex(i => i.name === name);
        if (index === -1) return;

        const option = prompt(`¿Qué quieres hacer con "${name}"?\n1. Modificar marca\n2. Eliminar tarjeta\n(Escribe 1 o 2):`, "1");
        
        if (option === "1") {
            const newScore = prompt(`Nueva marca para "${name}":`, list[index].score);
            if (newScore && newScore.trim() !== "") {
                list[index].score = newScore.trim();
                localStorage.setItem(customKey, JSON.stringify(list));
                App.renderCustomExerciseCards();
            }
        } else if (option === "2") {
            if (confirm(`¿Seguro que quieres borrar la tarjeta de "${name}"?`)) {
                list.splice(index, 1);
                localStorage.setItem(customKey, JSON.stringify(list));
                App.renderCustomExerciseCards();
            }
        }
    },

    renderTimer: () => {
        App.renderView('WOD Timer', 'Reloj', 'timer', '', `
            <div class="card-glass fade-in" style="padding: 24px 16px;">
                <div class="timer-crono-box">
                    <div id="timer-display" class="timer-digits">00:00</div>
                    <div id="timer-subtitle" style="font-size: 0.85rem; color: var(--accent-color); margin-top: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; height: 18px;"></div>
                </div>
                <div style="text-align: left; padding: 0 4px;">
                    <label style="font-size: 0.65rem; color: var(--text-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">⚙️ SELECCIONA EL TIPO DE CONTADOR</label>
                    <div class="timer-modes-grid">
                        <button id="btn-mode-fortime" class="btn-timer-mode" data-mode="fortime">FOR TIME</button>
                        <button id="btn-mode-amrap" class="btn-timer-mode" data-mode="amrap">AMRAP</button>
                        <button id="btn-mode-emom" class="btn-timer-mode" data-mode="emom">EMOM</button>
                        <button id="btn-mode-intervals" class="btn-timer-mode" data-mode="intervals">INTERVALOS</button>
                    </div>
                </div>
                <div id="action-controls" style="display: none; margin-top: 24px; padding: 0 4px;">
                    <div class="timer-actions-row">
                        <button id="startBtn" onclick="App.startTimer()" class="btn-primary btn-control-start" style="margin: 0;">START</button>
                        <button onclick="App.resetTimer()" class="btn-primary btn-control-reset" style="margin: 0;">RESET</button>
                    </div>
                </div>
            </div>
        `);

        document.querySelectorAll('.btn-timer-mode').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.btn-timer-mode').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                App.setupTimer(this.getAttribute('data-mode'));
            });
        });

        App.updateTimerDisplay();
    },

    setupTimer: (type) => { 
        App.resetTimer(); 
        App.currentTimerType = type; 
        
        const subtitleEl = document.getElementById('timer-subtitle');
        const controlsEl = document.getElementById('action-controls');
        
        if (subtitleEl) subtitleEl.innerText = type.toUpperCase();
        if (controlsEl) controlsEl.style.display = 'none';

        if (type === 'fortime') {
            App.startCountdownSequence();
        } 
        else if (type === 'amrap') {
            App.injectTimerConfigForm(`
                <span style="font-size:0.65rem; color:var(--text-muted); font-weight:800; display:block; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">⏳ DURACIÓN DEL AMRAP</span>
                <div style="display:flex; gap:8px;">
                    <input type="number" id="input-amrap-min" value="10" placeholder="Minutos" style="text-align:center;">
                    <button class="btn-primary" id="btn-fix-amrap" style="width:auto; padding:0 20px; margin:0;">FIJAR</button>
                </div>
            `);
            document.getElementById('btn-fix-amrap').addEventListener('click', () => {
                const m = document.getElementById('input-amrap-min').value;
                if(m && parseInt(m) > 0) {
                    App.timerSeconds = parseInt(m) * 60;
                    App.startCountdownSequence();
                } else { App.resetTimer(); }
            });
        } 
        else if (type === 'emom') {
            App.injectTimerConfigForm(`
                <span style="font-size:0.65rem; color:var(--text-muted); font-weight:800; display:block; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">⏳ MINUTOS TOTALES EMOM</span>
                <div style="display:flex; gap:8px;">
                    <input type="number" id="input-emom-min" value="10" placeholder="Minutos" style="text-align:center;">
                    <button class="btn-primary" id="btn-fix-emom" style="width:auto; padding:0 20px; margin:0;">FIJAR</button>
                </div>
            `);
            document.getElementById('btn-fix-emom').addEventListener('click', () => {
                const m = document.getElementById('input-emom-min').value;
                if(m && parseInt(m) > 0) {
                    App.timerSeconds = parseInt(m) * 60;
                    App.timerRoundDuration = 60;
                    App.timerCurrentRoundTime = 60;
                    App.startCountdownSequence();
                } else { App.resetTimer(); }
            });
        } 
        else if (type === 'intervals') {
            App.injectTimerConfigForm(`
                <span style="font-size:0.65rem; color:var(--text-muted); font-weight:800; display:block; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.5px;">⚙️ CONFIGURACIÓN DE INTERVALOS</span>
                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin-bottom:12px;">
                    <div>
                        <label style="font-size:0.6rem; color:var(--text-muted); display:block; margin-bottom:4px;">TRABAJO (s)</label>
                        <input type="number" id="input-int-w" value="40" style="text-align:center; padding:10px;">
                    </div>
                    <div>
                        <label style="font-size:0.6rem; color:var(--text-muted); display:block; margin-bottom:4px;">DESCANSO (s)</label>
                        <input type="number" id="input-int-r" value="20" style="text-align:center; padding:10px;">
                    </div>
                    <div>
                        <label style="font-size:0.6rem; color:var(--text-muted); display:block; margin-bottom:4px;">RONDAS</label>
                        <input type="number" id="input-int-rnd" value="8" style="text-align:center; padding:10px;">
                    </div>
                </div>
                <button class="btn-primary" id="btn-fix-intervals" style="padding:14px; margin:0;">CONFIRMAR INTERVALOS</button>
            `);
            document.getElementById('btn-fix-intervals').addEventListener('click', () => {
                const w = document.getElementById('input-int-w').value;
                const r = document.getElementById('input-int-r').value;
                const rnd = document.getElementById('input-int-rnd').value;
                if(w && r && rnd && parseInt(w)>0 && parseInt(rnd)>0) {
                    App.timerWorkDuration = parseInt(w);
                    App.timerRestDuration = parseInt(r);
                    App.timerTotalRounds = parseInt(rnd);
                    App.timerCurrentPhaseTime = App.timerWorkDuration;
                    App.timerCurrentRound = 1;
                    App.isWorkingPhase = true;
                    App.startCountdownSequence();
                } else { App.resetTimer(); }
            });
        }
    },

    startCountdownSequence: () => {
        const tempForm = document.getElementById('timer-temp-form');
        if (tempForm) tempForm.remove();

        const controlsEl = document.getElementById('action-controls');
        const subtitleEl = document.getElementById('timer-subtitle');

        if (controlsEl) controlsEl.style.display = 'block';
        if (subtitleEl) subtitleEl.innerText = 'PREPARACIÓN';

        App.isCountingDown = true; 
        App.countdownSeconds = 10; 
        App.updateTimerDisplay(); 
    },

    injectTimerConfigForm: (htmlContent) => {
        const tempForm = document.getElementById('timer-temp-form');
        if (tempForm) tempForm.remove();

        const formDiv = document.createElement('div');
        formDiv.id = 'timer-temp-form';
        formDiv.className = 'fade-in'; 
        formDiv.innerHTML = htmlContent;

        const actionControls = document.getElementById('action-controls');
        if (actionControls) {
            actionControls.parentNode.insertBefore(formDiv, actionControls);
        }
    },

    updateTimerDisplay: () => { 
        const d = document.getElementById('timer-display'); 
        if (!d) return;

        if (App.isCountingDown) { 
            d.innerText = `-00:${String(Math.max(App.countdownSeconds, 0)).padStart(2, '0')}`; 
            d.style.color = "var(--warning)"; 
            return; 
        }
        
        let secs = App.timerSeconds;
        if (App.currentTimerType === 'emom') { 
            secs = App.timerCurrentRoundTime; 
            d.style.color = "var(--accent-color)"; 
        } 
        else if (App.currentTimerType === 'intervals') { 
            secs = App.timerCurrentPhaseTime; 
            d.style.color = App.isWorkingPhase ? "var(--accent-color)" : "var(--success)"; 
        } 
        else {
            d.style.color = "var(--accent-color)";
        }

        const m = Math.floor(Math.abs(secs) / 60); 
        const s = Math.abs(secs) % 60; 
        d.innerText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; 
    },

    // --- REFACTORIZACIÓN A REQUEST_ANIMATION_FRAME ---
    startTimer: () => {
        if (!App.audioCtx) App.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        const btn = document.getElementById('startBtn');
        const subtitleEl = document.getElementById('timer-subtitle');
        
        if (App.isTimerRunning) { 
            if (App.timerRAF) cancelAnimationFrame(App.timerRAF); 
            App.isTimerRunning = false;
            btn.innerText = "START"; 
            
            if (subtitleEl) {
                App.savedSubtitleState = subtitleEl.innerText;
                subtitleEl.innerText = "PAUSADO";
            }
            App.releaseWakeLock(); 
        } 
        else {
            btn.innerText = "PAUSE"; 
            App.requestWakeLock();
            App.isTimerRunning = true;
            
            if (subtitleEl && App.savedSubtitleState) {
                subtitleEl.innerText = App.savedSubtitleState;
                App.savedSubtitleState = null;
            }

            // Ancla de tiempo absoluto inicial (Inmune a suspensión de pantalla)
            App.timerStartTime = Date.now();

            const tick = () => {
                if (!App.isTimerRunning) return;
                
                const now = Date.now();
                const deltaMs = now - App.timerStartTime;

                // Solo procesar la lógica si ha transcurrido 1 segundo (1000ms) o más
                if (deltaMs >= 1000) {
                    const elapsedSecs = Math.floor(deltaMs / 1000);
                    App.timerStartTime += elapsedSecs * 1000; // Ajustamos el ancla sin perder restos de milisegundos
                    App.processTimerTick(elapsedSecs);
                }
                
                App.timerRAF = requestAnimationFrame(tick);
            };
            App.timerRAF = requestAnimationFrame(tick);
        }
    },

    // --- LÓGICA DE PROCESAMIENTO POR SEGUNDO ---
    processTimerTick: (deltaSecs) => {
        const subtitleEl = document.getElementById('timer-subtitle');

        for (let i = 0; i < deltaSecs; i++) {
            if (App.isCountingDown) {
                App.countdownSeconds--; 
                if (App.countdownSeconds <= 3 && App.countdownSeconds > 0) App.playSound('short');
                
                if (App.countdownSeconds <= 0) { 
                    App.isCountingDown = false; 
                    App.playSound('final'); 
                    if (subtitleEl) {
                        subtitleEl.innerText = App.currentTimerType === 'intervals' ? 'WORK - RND 1' : 'WORK';
                    }
                }
            } else {
                if (App.currentTimerType === 'fortime') {
                    App.timerSeconds++;
                } 
                else if (App.currentTimerType === 'amrap') { 
                    App.timerSeconds--; 
                    if (App.timerSeconds <= 0) { App.playSound('final'); App.resetTimer(); return; } 
                } 
                else if (App.currentTimerType === 'emom') {
                    App.timerSeconds--; 
                    App.timerCurrentRoundTime--;
                    if (App.timerSeconds <= 0) { App.playSound('final'); App.resetTimer(); return; }
                    else if (App.timerCurrentRoundTime <= 0) { App.playSound('final'); App.timerCurrentRoundTime = 60; }
                } 
                else if (App.currentTimerType === 'intervals') {
                    App.timerCurrentPhaseTime--; 
                    if (App.timerCurrentPhaseTime <= 3 && App.timerCurrentPhaseTime > 0) App.playSound('short');
                    
                    if (App.timerCurrentPhaseTime <= 0) {
                        if (App.isWorkingPhase) {
                            if (App.timerCurrentRound >= App.timerTotalRounds) { 
                                App.playSound('final'); 
                                App.resetTimer(); 
                                return;
                            } else { 
                                App.isWorkingPhase = false; 
                                App.timerCurrentPhaseTime = App.timerRestDuration; 
                                App.playSound('final'); 
                                if (subtitleEl) subtitleEl.innerText = `REST - RND ${App.timerCurrentRound}`; 
                            }
                        } else {
                            App.isWorkingPhase = true; 
                            App.timerCurrentRound++; 
                            App.timerCurrentPhaseTime = App.timerWorkDuration; 
                            App.playSound('final'); 
                            if (subtitleEl) subtitleEl.innerText = `WORK - RND ${App.timerCurrentRound}`;
                        }
                    }
                }
            }
        }
        App.updateTimerDisplay();
    },

    resetTimer: () => { 
        if (App.timerRAF) {
            cancelAnimationFrame(App.timerRAF); 
            App.timerRAF = null;
        }
        App.isTimerRunning = false; 
        App.isCountingDown = true; 
        App.countdownSeconds = 10; 
        App.timerSeconds = 0; 
        App.timerRoundDuration = 0; 
        App.timerCurrentRoundTime = 0; 
        App.timerTotalRounds = 0;
        App.timerWorkDuration = 0; 
        App.timerRestDuration = 0; 
        App.timerCurrentPhaseTime = 0;
        App.timerCurrentRound = 1; 
        App.isWorkingPhase = true;
        App.savedSubtitleState = null;
        App.releaseWakeLock(); 

        const sub = document.getElementById('timer-subtitle'); 
        if (sub) sub.innerText = ''; 
        
        const tempForm = document.getElementById('timer-temp-form');
        if (tempForm) tempForm.remove();

        const actControls = document.getElementById('action-controls'); 
        if (actControls) actControls.style.display = 'none'; 
        
        const startBtn = document.getElementById('startBtn');
        if (startBtn) startBtn.innerText = "START"; 

        document.querySelectorAll('.btn-timer-mode').forEach(btn => btn.classList.remove('active'));
        App.updateTimerDisplay(); 
    },

    playSound: (t) => { 
        if (!App.audioCtx) return; 
        const o = App.audioCtx.createOscillator(); 
        const g = App.audioCtx.createGain(); 
        const duration = t === 'short' ? 0.2 : 0.8; 
        
        o.frequency.value = t === 'short' ? 880 : 440; 
        g.gain.exponentialRampToValueAtTime(0.0001, App.audioCtx.currentTime + duration); 
        
        o.connect(g); 
        g.connect(App.audioCtx.destination); 
        o.start(); 
        o.stop(App.audioCtx.currentTime + duration); 
    },

    renderProfile: async () => {
        const fechaPagoAtleta = App.user.fecha_pago || '';
        let estadoPago = (App.user.estado_pago || 'Pendiente').toUpperCase();
        let colorEstado = '#27AE60'; 

        if (fechaPagoAtleta && fechaPagoAtleta.includes('/')) {
            const parts = fechaPagoAtleta.split('/');
            const fechaVencimiento = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]), 23, 59, 59);
            const hoy = new Date();

            if (hoy > fechaVencimiento) {
                estadoPago = 'VENCIDO / PENDIENTE';
                colorEstado = '#EB5757'; 
            } else if (estadoPago === 'AL DÍA' || estadoPago === 'AL DIA') {
                colorEstado = '#27AE60';
            } else {
                colorEstado = '#F2994A'; 
            }
        } else {
            colorEstado = '#EB5757';
            estadoPago = 'SIN REGISTRAR';
        }

        let entrenosMesActual = 0;
        let marcasHtml = '<p style="font-size:0.8rem; color:var(--text-muted); text-align:center; padding:15px 0; margin:0;">No tienes marcas registradas todavía.</p>';
        
        let chartFechas = [];
        let chartRPE = [];
        let chartReadiness = [];
        
        try {
            const [resHistorial, resUsersList] = await Promise.all([
                apiCall({ action: 'getUserHistory', userId: App.user.id }),
                apiCall({ action: 'getUsersList' })
            ]);
            
            let rachaSemaforosHTML = '<span style="color:var(--text-muted);">Sin histórico semanal</span>';
            if (resUsersList && resUsersList.success && resUsersList.data) {
                const metatablaAtleta = resUsersList.data.find(u => String(u.id) === String(App.user.id));
                if (metatablaAtleta && metatablaAtleta.tendencia_readiness) {
                    rachaSemaforosHTML = `<span style="letter-spacing: 2px;">${metatablaAtleta.tendencia_readiness}</span>`;
                }
            }
            
            if (resHistorial && resHistorial.success && resHistorial.data && resHistorial.data.length > 0) {
                const mesActualIdx = new Date().getMonth(); 
                const anyoActualIdx = new Date().getFullYear();

                resHistorial.data.forEach(item => {
                    if (item.fecha && item.fecha.includes('/')) {
                        const parts = item.fecha.split('/');
                        if (parseInt(parts[1]) - 1 === mesActualIdx && parseInt(parts[2]) === anyoActualIdx) {
                            entrenosMesActual++;
                        }
                    }
                });

                marcasHtml = resHistorial.data.slice(0, 3).map(item => `
                    <div style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.02); padding: 12px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <div style="text-align: left;">
                            <span style="font-size: 0.65rem; color: var(--text-muted); display: block; margin-bottom: 2px;">${item.fecha}</span>
                            <strong style="color: var(--text-main); font-size: 0.85rem; font-weight: 700; text-transform:uppercase;">${item.score}</strong>
                        </div>
                        ${item.rpe ? `<span style="background: rgba(255,24,56,0.06); color: var(--accent-color); font-weight: 700; font-size: 0.75rem; padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(255,24,56,0.15);">RPE ${item.rpe}</span>` : ''}
                    </div>
                `).join('');

                const datosGrafica = [...resHistorial.data].slice(0, 7).reverse();
                
                datosGrafica.forEach(item => {
                    chartFechas.push(item.fecha ? item.fecha.substring(0, 5) : ''); 
                    chartRPE.push(item.rpe ? parseInt(item.rpe) : null);
                    
                    const readinessKey = `readiness_${App.user.id}_${item.fecha}`;
                    const scoreLocal = localStorage.getItem(readinessKey);
                    
                    if (scoreLocal) {
                        const scoreNormalizado = (parseInt(scoreLocal) / 15) * 10;
                        chartReadiness.push(Math.round(scoreNormalizado * 10) / 10);
                    } else {
                        chartReadiness.push(7.0);
                    }
                });
            }

            const objetivoMes = 16;
            const porcentajeConsistencia = Math.min(Math.round((entrenosMesActual / objetivoMes) * 100), 100);
            
            let badgeMotivacional = "🚀 ¡A por el mes!";
            if (porcentajeConsistencia >= 100) badgeMotivacional = "👑 ¡NIVEL ELITE COMPLETADO!";
            else if (porcentajeConsistencia >= 75) badgeMotivacional = "🔥 ¡Estás desatado!";
            else if (porcentajeConsistencia >= 50) badgeMotivacional = "💪 Mitad de camino superado";

            App.renderView(`Hola, ${App.user.nombre.split(' ')[0]}`, 'MI PERFIL', 'perfil', '', `
                <div class="card-glass fade-in" style="border-left: 4px solid ${colorEstado}; padding: 20px 16px; text-align: left !important;">
                    <h3 style="font-size: 0.75rem; color: var(--text-muted); font-weight: 800; letter-spacing: 1px; margin-bottom: 14px;">💳 CONTROL DE SUSCRIPCIÓN</h3>
                    <div style="display: flex; flex-direction: column;">
                        <div class="profile-meta-row">
                            <span class="profile-meta-label">Estado de tarifa</span>
                            <span class="profile-meta-value" style="color: ${colorEstado}; background: rgba(255,255,255,0.01); padding: 2px 8px; border-radius: 4px; font-size:0.8rem;">${estadoPago}</span>
                        </div>
                        <div class="profile-meta-row">
                            <span class="profile-meta-label">Próxima renovación</span>
                            <span class="profile-meta-value" style="color: var(--accent-color);">${fechaPagoAtleta || 'Consúltalo con tu Coach'}</span>
                        </div>
                    </div>
                </div>

                <details class="accordion-panel fade-in" open style="text-align: left !important;">
                    <summary>📊 RENDIMIENTO HISTÓRICO</summary>
                    <div class="card-inner-content">
                        
                        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 16px; border-radius: 10px; margin-bottom: 20px; box-sizing: border-box; width: 100%;">
                            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 8px;">
                                <div>
                                    <span style="font-size: 0.65rem; color: var(--text-muted); display: block; text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px; margin-bottom: 2px;">TERMÓMETRO DE CONSISTENCIA</span>
                                    <strong style="color: var(--text-main); font-size: 1rem; font-weight: 900;">${entrenosMesActual} <span style="font-size:0.8rem; font-weight:500; color:var(--text-muted);">/ ${objetivoMes} WODs</span></strong>
                                </div>
                                <div style="text-align: right;">
                                    <span style="font-size: 0.75rem; color: var(--accent-color); font-weight: 900;">${porcentajeConsistencia}%</span>
                                </div>
                            </div>
                            
                            <div style="width: 100%; height: 10px; background: rgba(255,255,255,0.05); border-radius: 50px; overflow: hidden; margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.02);">
                                <div style="width: ${porcentajeConsistencia}%; height: 100%; background: linear-gradient(90deg, #FF1838 0%, #FFA447 100%); border-radius: 50px; transition: width 0.5s ease-out;"></div>
                            </div>
                            
                            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.7rem; color: var(--text-muted); padding-top: 2px;">
                                <span style="font-weight: 700; color: var(--text-muted);">${badgeMotivacional}</span>
                                <span style="font-weight: 700;">Estado RPE: ${rachaSemaforosHTML}</span>
                            </div>
                        </div>
                        
                        <div style="background: rgba(0,0,0,0.2); padding: 14px; border-radius: 8px; border: 1px solid var(--border-color); position: relative; width: 100%; box-sizing: border-box; margin-bottom: 20px;">
                            <span style="font-size: 0.65rem; color: var(--text-muted); display: block; text-transform: uppercase; font-weight: 800; margin-bottom: 12px; letter-spacing: 0.5px;">📈 Carga (RPE) vs Recuperación (Readiness Normalizado)</span>
                            <canvas id="analyticsChart" style="max-height: 180px; width: 100%;"></canvas>
                        </div>
                        
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; font-weight: 800; margin-bottom: 10px; letter-spacing: 0.5px;">🏋️‍♂️ ÚLTIMOS RESULTADOS REGISTRADOS</span>
                            ${marcasHtml}
                        </div>
                    </div>
                </details>

                <div class="card-glass fade-in" style="padding: 20px 16px; text-align: left !important; margin-bottom:14px;">
                    <h3 style="font-size: 0.75rem; color: var(--text-muted); font-weight: 800; letter-spacing: 1px; margin-bottom: 14px;">👤 CUENTA DE ATLETA</h3>
                    <div style="display: flex; flex-direction: column;">
                        <div class="profile-meta-row">
                            <span class="profile-meta-label">Nombre Completo</span>
                            <span class="profile-meta-value">${App.user.nombre.toUpperCase()}</span>
                        </div>
                        <div class="profile-meta-row">
                            <span class="profile-meta-label">Email Registrado</span>
                            <span class="profile-meta-value" style="font-weight: 500; color:var(--text-muted); font-size:0.85rem;">${App.user.email}</span>
                        </div>
                    </div>
                </div>

                <details class="accordion-panel fade-in" style="text-align: left !important;">
                    <summary>🔒 SEGURIDAD DE LA CUENTA</summary>
                    <div class="card-inner-content" style="padding-top: 4px;">
                        <form id="profilePassForm" style="display: flex; flex-direction: column; gap: 14px;">
                            <div style="display: flex; flex-direction: column; gap: 6px;">
                                <label style="font-size: 0.65rem; color: var(--text-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Nueva Contraseña de Acceso</label>
                                <input type="password" id="newProfilePassword" placeholder="Escribe tu nueva clave secreta..." required>
                            </div>
                            <button type="submit" id="btnUpdatePassProfile" class="btn-primary" style="padding: 14px; font-weight:800; font-size:0.95rem; letter-spacing:0.5px;">ACTUALIZAR CONTRASEÑA</button>
                        </form>
                    </div>
                </details>

                <details class="accordion-panel fade-in" style="text-align: left !important;">
                    <summary>📲 INSTALAR APP EN EL MÓVIL</summary>
                    <div class="card-inner-content" style="padding-top: 4px;">
                        <p style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.5; margin: 0 0 12px 0;">
                            Lanza la plataforma a pantalla completa sin barras de navegación para una experiencia de alta velocidad:
                        </p>
                        <div class="pwa-grid">
                            <div class="pwa-card">
                                <strong style="color: #62B6CB;">🍏 APPLE IOS (SAFARI)</strong>
                                <p>Pulsa compartir ⎋ y elige <span style="color:var(--accent-color); font-weight:700;">"Añadir a pantalla de inicio"</span>.</p>
                            </div>
                            <div class="pwa-card">
                                <strong style="color: #48CAE4;">🤖 ANDROID (CHROME)</strong>
                                <p>Pulsa los puntos ⋮ y selecciona <span style="color:var(--accent-color); font-weight:700;">"Instalar aplicación"</span>.</p>
                            </div>
                        </div>
                    </div>
                </details>
                
                <button onclick="App.logout()" class="logout-mini" style="width: 100%; margin-top: 20px; border-color: rgba(235, 87, 87, 0.15); color: #EB5757; background: rgba(235, 87, 87, 0.03); padding:14px; font-weight:800; letter-spacing:0.5px; border-radius:8px;">CERRAR SESIÓN TOTAL</button>
            `);

        } catch (e) {
            console.error("Error cargando analíticas de perfil:", e);
        }

        const ctx = document.getElementById('analyticsChart');
        if (ctx && chartFechas.length > 0) {
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: chartFechas,
                    datasets: [
                        {
                            label: 'Intensidad (RPE)',
                            data: chartRPE,
                            borderColor: '#FF1838', 
                            backgroundColor: 'rgba(255, 24, 56, 0.04)',
                            borderWidth: 2.5,
                            tension: 0.25,
                            pointRadius: 4,
                            pointBackgroundColor: '#FF1838',
                            zIndex: 10
                        },
                        {
                            label: 'Descanso (Readiness)',
                            data: chartReadiness,
                            borderColor: '#27AE60', 
                            backgroundColor: 'rgba(39, 174, 96, 0.02)',
                            borderWidth: 1.5,
                            borderDash: [3, 3], 
                            tension: 0.25,
                            pointRadius: 3,
                            pointBackgroundColor: '#27AE60',
                            zIndex: 9
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#888', font: { size: 9 } } },
                        y: { 
                            min: 0, 
                            max: 10, 
                            ticks: { stepSize: 2, color: '#888', font: { size: 9 } }, 
                            grid: { color: 'rgba(255,255,255,0.03)' } 
                        }
                    },
                    plugins: [{
                        id: 'zoneBackgrounds',
                        beforeDraw: (chart) => {
                            const { ctx, scales: { y } } = chart;
                            const xRange = chart.chartArea;
                            if(!xRange) return;

                            ctx.fillStyle = 'rgba(235, 87, 87, 0.02)';
                            ctx.fillRect(xRange.left, y.getPixelForValue(10), xRange.right - xRange.left, y.getPixelForValue(8.5) - y.getPixelForValue(10));

                            ctx.fillStyle = 'rgba(242, 153, 74, 0.01)';
                            ctx.fillRect(xRange.left, y.getPixelForValue(8.5), xRange.right - xRange.left, y.getPixelForValue(5.5) - y.getPixelForValue(8.5));

                            ctx.fillStyle = 'rgba(39, 174, 96, 0.015)';
                            ctx.fillRect(xRange.left, y.getPixelForValue(5.5), xRange.right - xRange.left, y.getPixelForValue(0) - y.getPixelForValue(5.5));
                        }
                    }]
                }
            });
        }

        const passForm = document.getElementById('profilePassForm');
        if (passForm) {
            passForm.onsubmit = async (e) => {
                e.preventDefault();
                const btn = document.getElementById('btnUpdatePassProfile');
                const newPassInput = document.getElementById('newProfilePassword');
                
                if (!newPassInput.value.trim()) return;

                btn.disabled = true;
                btn.innerText = "ACTUALIZANDO...";

                const res = await apiCall({
                    action: 'updatePassword',
                    userId: App.user.id,
                    newPassword: newPassInput.value.trim()
                });

                if (res && res.success) {
                    App.showToast("🔒 ¡Contraseña modificada con éxito!");
                    newPassInput.value = "";
                } else {
                    App.showToast("❌ Error al modificar la contraseña en el servidor");
                }

                btn.disabled = false;
                btn.innerText = "ACTUALIZAR CONTRASEÑA";
            };
        }
    },
    
    loadCoachHistory: async (baseDateISO, idUsuario) => {
        const contentDiv = document.getElementById('coach-history-content');
        if (!contentDiv) return;
        
        const tituloSeccion = contentDiv.previousElementSibling;
        if (tituloSeccion && tituloSeccion.tagName === 'H4') {
            tituloSeccion.innerHTML = `👁️ Planificación de la Semana Actual`;
        }
        
        contentDiv.innerHTML = '<div style="text-align:center; padding:12px;"><div class="loader" style="width:20px;height:20px;border-width:2px;"></div><p style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">Cargando cuadrante...</p></div>';
        
        const current = new Date(baseDateISO);
        const dayOfWeek = current.getDay();
        const distanceToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; 
        
        const lunes = new Date(current);
        lunes.setDate(current.getDate() + distanceToMonday);
        
        const diasSemana = [];
        const nombresDias = ['LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO'];
        
        for (let i = 0; i < 7; i++) {
            const tempDate = new Date(lunes);
            tempDate.setDate(lunes.getDate() + i);
            
            const iso = App.formatDateToISO(tempDate);
            const es = iso.split('-').reverse().join('/');
            diasSemana.push({ iso, es, nombre: nombresDias[i] });
        }
        
        try {
            const peticiones = diasSemana.map(dia => 
                apiCall({ action: 'getWod', date: dia.es, id_usuario: idUsuario || "" })
            );
            
            const respuestas = await Promise.all(peticiones);
            let tarjetasHTML = '';
            
            diasSemana.forEach((dia, index) => {
                const res = respuestas[index];
                let contenidoWod = '';
                let videoWod = '';
                
                if (res && res.success && res.data && res.data.content) {
                    contenidoWod = res.data.content;
                    videoWod = res.data.video || '';
                }
                
                const tieneEntreno = contenidoWod.trim() !== "";
                const bgStyle = tieneEntreno ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.005)';
                const borderStyle = tieneEntreno ? '2px solid var(--accent-color)' : '1px dashed rgba(255,255,255,0.08)';

                tarjetasHTML += `
                <div style="background: ${bgStyle}; padding: 14px; margin-bottom: 12px; border-radius: var(--radius-sm); border-left: ${borderStyle}; text-align: left; display: flex; flex-direction: column; gap: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="font-weight: 800; color: ${tieneEntreno ? 'var(--accent-color)' : 'var(--text-muted)'}; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px;">
                            📆 ${dia.nombre} (${dia.es})
                        </div>
                        <button type="button" 
                                data-load-iso="${dia.iso}"
                                data-load-video="${videoWod.replace(/"/g, '&quot;')}"
                                class="btn-load-wod-trigger btn-primary" 
                                style="width:auto; padding: 4px 10px; font-size: 0.65rem; background: ${tieneEntreno ? 'rgba(255,24,56,0.1)' : 'rgba(255,255,255,0.03)'} !important; border: 1px solid ${tieneEntreno ? 'var(--accent-color)' : 'rgba(255,255,255,0.1)'}; color: ${tieneEntreno ? 'var(--accent-color)' : 'var(--text-muted)'}; margin:0; font-weight: 800; border-radius: 4px;">
                            ${tieneEntreno ? '📝 EDITAR' : '➕ AÑADIR'}
                        </button>
                    </div>
                    <div id="raw-text-storage-${dia.iso}" style="display:none;">${contenidoWod}</div>
                    <div style="font-size: 0.85rem; color: ${tieneEntreno ? 'var(--text-main)' : 'var(--text-muted)'}; white-space: pre-wrap; line-height: 1.4; text-align: left; font-style: ${tieneEntreno ? 'normal' : 'italic'};">
                        ${tieneEntreno ? contenidoWod : 'Día de descanso o sin sesión programada.'}
                    </div>
                </div>`;
            });
            
            contentDiv.innerHTML = tarjetasHTML;

            contentDiv.querySelectorAll('.btn-load-wod-trigger').forEach(btn => {
                btn.addEventListener('click', function() {
                    const isoKey = this.getAttribute('data-load-iso');
                    const videoVal = this.getAttribute('data-load-video');
                    const textNode = document.getElementById(`raw-text-storage-${isoKey}`);
                    App.cargarWodEnFormulario(isoKey, textNode ? textNode.innerText : '', videoVal);
                });
            });
            
        } catch (err) {
            console.error("Error cargando cuadrante semanal:", err);
            contentDiv.innerHTML = '<p style="font-size:0.8rem; color:var(--text-muted); text-align:center;">Error al estructurar la semana en curso.</p>';
        }
    },

    cargarWodEnFormulario: (fechaISO, contenido, video) => {
        const inputFecha = document.getElementById('wod-date');
        const inputContenido = document.getElementById('wod-content-input');
        const inputVideo = document.getElementById('wod-video');
        const formBlock = document.getElementById('block-wod-programming');

        if (inputFecha) inputFecha.value = fechaISO;
        if (inputContenido) {
            inputContenido.value = contenido;
            inputContenido.focus();
        }
        if (inputVideo) inputVideo.value = (video === 'undefined' || video === 'null') ? '' : video;

        if (formBlock) {
            formBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        App.showToast("📋 Sesión cargada en el editor superior.");
    },

    renderCoachPanel: async () => {
        const initialDateISO = App.formatDateToISO(new Date());
        const appContainer = document.getElementById('app');
        if (appContainer) appContainer.innerHTML = `<div style="text-align:center; margin-top:50px;"><div class="loader"></div></div>`;

        const [resFeed, resUsers] = await Promise.all([
            apiCall({ action: 'getGlobalFeedback' }),
            apiCall({ action: 'getUsersList' })
        ]);

        if (resFeed && resFeed.success && resFeed.data) {
            App.checkCoachNotifications(resFeed.data);
        }

        App.coachUsersIndexed = {};
        if (resUsers && resUsers.success && resUsers.data) {
            resUsers.data.forEach(u => { App.coachUsersIndexed[u.id] = u; });
        }

        App.currentInboxData = {};
        let pendientesHTML = '';
        let historialHTML = '';
        let contPendientes = 0;
        let contHistorial = 0;

        if (resFeed && resFeed.success && resFeed.data && resFeed.data.length > 0) {
            resFeed.data.forEach((item, idx) => {
                const decoded = App.extractVideoButtonsHTML(item.feedback);
                const blockKey = `${item.id_usuario}-${item.fecha.replace(/\//g,'')}-${idx}`;
                App.currentInboxData[blockKey] = item.feedback;

                const cardHTML = `
                <div class="card-glass" style="margin-bottom:16px; padding:16px; border-left:3px solid ${decoded.coachReply ? 'var(--text-muted)' : 'var(--accent-color)'}; text-align: left;">
                    <div style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:6px;">
                        <strong>${item.nombre}</strong>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <span style="font-size:0.75rem; color:var(--text-muted); font-weight:700;">${item.fecha}</span>
                            <span class="tag" style="${decoded.coachReply ? 'background:rgba(255,255,255,0.1); color:var(--text-muted);' : ''}">${item.score}</span>
                        </div>
                    </div>
                    <p style="font-size:0.9rem; margin-top:8px; color:var(--text-main); text-align: left;">"${decoded.cleanFeedback || 'Sin comentarios'}"</p>
                    ${decoded.buttonsHTML}
                    
                    ${decoded.coachReply ? `
                        <div style="margin-top:12px; background:rgba(46,204,113,0.05); padding:10px; border-left:2px solid var(--success); border-radius:0 4px 4px 0; text-align: left;">
                            <p style="font-size:0.75rem; color:var(--success); margin:0; font-weight:800; text-transform:uppercase; letter-spacing:0.5px;">Tu Respuesta:</p>
                            <p style="font-size:0.85rem; color:var(--text-main); margin:4px 0 0 0; text-align: left;">${decoded.coachReply}</p>
                        </div>
                    ` : `
                        <div class="quick-replies-container" data-block="${blockKey}" style="margin-top:12px;">
                            <div class="quick-pill" data-reply="¡Buen entreno! Ojo con la extensión de cadera en las últimas repeticiones, asegúrate de bloquear por completo antes de tirar.">⚙️ Cadera</div>
                            <div class="quick-pill" data-reply="Ritmo brutal. Mantén el pecho arriba y el core bien compacto en la sentadilla para no perder la verticalidad cuando entre la fatiga.">🏋️‍♂️ Postura</div>
                            <div class="quick-pill" data-reply="Buenísima gestión, pero recuerda regular más en la primera ronda. Interesa mantener los ritmos estables en lugar de salir a fuego.">⏱️ Ritmo</div>
                            <div class="quick-pill" data-reply="Sólido. En los movimientos gimnásticos/burs, prioriza la fluidez de las transiciones y respira en cada repetición.">🤸‍♂️ Fluidez</div>
                        </div>

                        <div style="margin-top:4px; display:flex; gap:8px;">
                            <input type="text" id="reply-input-${blockKey}" placeholder="Escribe corrección técnica..." style="font-size:0.85rem; margin:0; background:var(--bg-dark); border:1px solid var(--border-color); color:var(--text-main); border-radius:6px; padding:8px 12px; flex-grow:1;">
                            <button type="button" class="btn-coach-send-reply btn-primary" data-user="${item.id_usuario}" data-date="${item.fecha}" style="width:auto; padding:0 16px; background:var(--success); margin:0;">RESPONDER</button>
                        </div>
                    `}
                </div>`;

                if (decoded.coachReply) {
                    historialHTML += cardHTML;
                    contHistorial++;
                } else {
                    pendientesHTML += cardHTML;
                    contPendientes++;
                }
            });
        }

        if (contPendientes === 0) pendientesHTML = '<p style="font-size:0.85rem; color:var(--text-muted); text-align:center; padding: 25px 0; margin:0;">🎉 ¡Al día! No tienes feedbacks pendientes de revisión.</p>';
        if (contHistorial === 0) historialHTML = '<p style="font-size:0.85rem; color:var(--text-muted); text-align:center; padding: 25px 0; margin:0;">El historial de respuestas está vacío.</p>';

        let listaGestionAtletasHTML = '';
        let burbujasAtletasHTML = `
            <div class="bubble-item" data-athlete-bubble="">
                <div id="bubble-circle-global" style="width:52px; height:52px; border-radius:50%; background:var(--accent-color); display:flex; align-items:center; justify-content:center; font-weight:900; font-size:0.8rem; color:#000; border:2px solid var(--accent-color); box-shadow:0 4px 10px rgba(0,0,0,0.3); transition:all 0.2s;">🌍</div>
                <span style="font-size:0.65rem; color:var(--text-main); font-weight:800; display:block; margin-top:6px; text-transform:uppercase; letter-spacing:0.5px;">GENERAL</span>
            </div>
        `;

        if (resUsers && resUsers.success && resUsers.data && resUsers.data.length > 0) {
            resUsers.data.forEach(atleta => {
                const fechaActual = atleta.fecha_pago || 'Sin registrar';
                const rpeValor = atleta.ultimo_rpe || 'Sin datos';
                const tendenciaSemaforos = atleta.tendencia_readiness || 'Sin histórico';
                const grupoActual = atleta.grupo || 'General';
                
                const hoyES = initialDateISO.split('-').reverse().join('/');
                const readinessKey = `readiness_${atleta.id}_${hoyES}`;
                const scoreHoy = localStorage.getItem(readinessKey); 
                
                let badgeSemaforo = `⚪`;
                if (scoreHoy) {
                    const scoreNum = parseInt(scoreHoy);
                    if (scoreNum <= 8) badgeSemaforo = `🔴`;
                    else if (scoreNum <= 11) badgeSemaforo = `🟡`;
                    else badgeSemaforo = `🟢`;
                }

                const iniciales = atleta.nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                burbujasAtletasHTML += `
                    <div id="bubble-${atleta.id}" class="bubble-item" data-athlete-bubble="${atleta.id}">
                        <div id="bubble-circle-${atleta.id}" style="width:52px; height:52px; border-radius:50%; background:var(--bg-dark); display:flex; align-items:center; justify-content:center; font-weight:800; font-size:0.85rem; color:var(--text-main); border:2px solid var(--border-color); transition:all 0.2s; position:relative;">
                            ${iniciales}
                            <span class="bubble-badge">${badgeSemaforo}</span>
                        </div>
                        <span style="font-size:0.65rem; color:var(--text-muted); font-weight:700; display:block; margin-top:6px; text-transform:uppercase; letter-spacing:0.5px; max-width:60px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${atleta.nombre.split(' ')[0]}</span>
                    </div>
                `;
                
                let grupoLabelVisual = "Todo el Box (General)";
                if (grupoActual === 'Crossfit-Program') grupoLabelVisual = "Crossfit Program";
                if (grupoActual === 'Hyrox-Program') grupoLabelVisual = "Hyrox Program";

                listaGestionAtletasHTML += `
                    <details class="accordion-panel" style="margin-bottom: 10px; background: var(--bg-dark); text-align: left !important;">
                        <summary style="font-size: 0.85rem; font-weight: 700; color: var(--text-main); cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none;">
                            <span style="display:flex; align-items:center; gap:8px;">
                                <span>👤 ${atleta.nombre.toUpperCase()}</span>
                                <button type="button" class="btn-inner-program-trigger" data-athlete="${atleta.id}" style="background:rgba(255,24,56,0.08); border:1px solid rgba(255,24,56,0.2); color:var(--accent-color); padding:2px 8px; font-size:0.7rem; border-radius:4px; font-weight:800; cursor:pointer; text-transform:uppercase; margin:0;">📝 Programar</button>
                            </span>
                            <span style="display:flex; align-items:center; gap:6px; font-size:0.75rem; font-weight:800; padding-right:12px;">
                                <span style="color:var(--text-muted); font-size:0.65rem;">RPE:</span> <span style="color:${rpeValor.includes('9') || rpeValor.includes('10') ? '#EB5757' : 'var(--text-main)'}">${rpeValor}</span>
                                <span style="margin-left:4px;">${tendenciaSemaforos}</span>
                            </span>
                        </summary>
                        <div class="card-inner-content" style="border-top: 1px solid rgba(255,255,255,0.04); display: flex; flex-direction: column; gap: 12px; padding-top:14px !important;">
                            
                            <div style="border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 12px;">
                                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; margin-bottom:6px;">
                                    <span style="color: var(--text-muted);">Próxima Renovación:</span>
                                    <span style="color: var(--accent-color); font-weight: 700;">${fechaActual}</span>
                                </div>
                                <div style="display: flex; gap: 6px; align-items: center; width: 100%; box-sizing: border-box;">
                                    <input type="date" id="date-pay-${atleta.id}" style="padding: 8px 12px; font-size: 0.8rem; background: var(--bg-surface); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 6px; flex-grow: 1; color-scheme: dark; margin: 0; min-width:0;">
                                    <button class="btn-save-pay-trigger btn-primary" data-athlete="${atleta.id}" style="padding: 8px 14px; min-height: auto; font-size: 0.75rem; width: auto; background: var(--accent-color) !important; margin: 0 !important; font-weight:800; flex-shrink:0;">💾 RENOVAR TARIFA</button>
                                </div>
                            </div>

                            <div>
                                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; margin-bottom:6px;">
                                    <span style="color: var(--text-muted);">Grupo Asignado Actual:</span>
                                    <span style="color: var(--warning); font-weight: 700; text-transform:uppercase;">${grupoLabelVisual}</span>
                                </div>
                                <div style="display: flex; gap: 6px; align-items: center; width: 100%; box-sizing: border-box;">
                                    <select id="select-group-${atleta.id}" style="padding: 8px 12px; font-size: 0.8rem; background: var(--bg-surface); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 6px; flex-grow: 1; margin: 0; height: 35px;">
                                        <option value="General" ${grupoActual === 'General' ? 'selected' : ''}>🌍 Todo el Box (General)</option>
                                        <option value="Hyrox-Program" ${grupoActual === 'Hyrox-Program' ? 'selected' : ''}>🔥 Hyrox Program</option>
                                        <option value="Crossfit-Program" ${grupoActual === 'Crossfit-Program' ? 'selected' : ''}>🏋️‍♂️ Crossfit Program</option>
                                    </select>
                                    <button class="btn-save-group-trigger btn-primary" data-athlete="${atleta.id}" style="padding: 8px 14px; min-height: auto; font-size: 0.75rem; width: auto; background: var(--success) !important; margin: 0 !important; font-weight:800; flex-shrink:0;">💾 CAMBIAR GRUPO</button>
                                </div>
                            </div>

                        </div>
                    </details>
                `;
            });
        }

        appContainer.innerHTML = `
            <div style="padding: 24px 16px; background: var(--bg-body); min-height: 100vh; color: var(--text-main); box-sizing: border-box; width: 100%; overflow-x: hidden;">
                
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid rgba(255,255,255,0.02); padding-bottom: 16px; width: 100%;">
                    <div>
                        <h2 style="font-family: var(--font-title); font-size: 1.6rem; font-weight: 900; letter-spacing: -0.5px; color: var(--text-main); margin: 0; text-align: left;">COACH PANEL</h2>
                        <p style="font-size: 0.75rem; color: var(--accent-color); margin: 4px 0 0 0; text-transform: uppercase; font-weight: 800; text-align: left; letter-spacing: 1px;">Consola Central de Operaciones</p>
                    </div>
                    <button id="btn-coach-logout" style="background: rgba(235, 87, 87, 0.06); border: 1px solid rgba(235, 87, 87, 0.15); color: var(--danger); padding: 8px 14px; border-radius: 6px; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer; flex-shrink:0;">SALIR</button>
                </div>

                <details class="accordion-panel" id="block-wod-programming" open>
                    <summary><span>PROGRAMACIÓN DE SESIONES <span style="color: var(--accent-color); margin-left:2px;">WOD</span></span></summary>
                    <div class="card-inner-content">
                        <div style="margin-bottom: 14px; width: 100%;">
                            <label style="font-size: 0.65rem; color: var(--text-muted); font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 10px; display: block;">🎯 DESTINATARIO DE LA SESIÓN</label>
                            <div class="stories-container">${burbujasAtletasHTML}</div>
                            <div id="label-ultima-sesion"></div>
                        </div>

                        <form id="coachForm">
                            <input type="hidden" id="wod-destinatario" value="">
                            <div class="input-group" style="width:100%;"><label style="font-size: 0.65rem; color: var(--text-muted); font-weight: 800; display: block; margin-bottom:6px;">FECHA DEL ENTRENAMIENTO</label><input type="date" id="wod-date" value="${initialDateISO}" required style="padding:14px; border-radius:8px; box-sizing: border-box; width:100%;"></div>
                            
                            <div class="input-group" id="wrapper-visibilidad-grupo" style="margin-top:14px; width:100%;">
                                <label style="font-size: 0.65rem; color: var(--text-muted); font-weight: 800; display: block; margin-bottom:6px;">VISIBILIDAD DE GRUPO (Si se publica de forma General)</label>
                                <select id="wod-visibilidad" style="padding:14px; border-radius:8px; box-sizing: border-box; width:100%; background: var(--bg-dark); color: var(--text-main); border: 1px solid var(--border-color);">
                                    <option value="">🌍 Todo el Box (Público Abierto)</option>
                                    <option value="Hyrox-Program">🔥 Hyrox Program</option>
                                    <option value="Crossfit-Program">🏋️‍♂️ Crossfit Program</option>
                                </select>
                            </div>

                            <div class="input-group" style="margin-top:14px; width:100%;"><label style="font-size: 0.65rem; color: var(--text-muted); font-weight: 800; display: block; margin-bottom:6px;">BLOQUE DE ENTRENAMIENTO</label><textarea id="wod-content-input" rows="6" placeholder="Escribe la sesión específica o general aquí..." style="padding:14px; border-radius:8px; background:var(--bg-dark); border:1px solid var(--border-color); color:var(--text-main); width:100%; box-sizing:border-box; font-family:inherit; font-size:0.9rem; transition: border-color 0.2s;"></textarea></div>
                            <div class="input-group" style="margin-top:14px; width:100%;"><label style="font-size: 0.65rem; color: var(--text-muted); font-weight: 800; display: block; margin-bottom:6px;">VIDEO DE AYUDA (Opcional)</label><input type="text" id="wod-video" placeholder="[Snatch] link, [Burpee] link" style="padding:14px; border-radius:8px; width:100%; box-sizing: border-box; transition: border-color 0.2s;"></div>
                            <button type="submit" id="publishWodBtn" class="btn-primary" style="margin-top: 18px; padding: 14px; font-weight:800; letter-spacing:0.5px; width:100%;">PUBLICAR SESIÓN</button>
                        </form>
                        
                        <div style="margin-top: 24px; border-top: 1px solid rgba(255,255,255,0.03); padding-top: 16px; width:100%;">
                            <h4 style="font-size: 0.7rem; color: var(--text-muted); font-weight: 800; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.5px;">👁️ Planificación de la Semana Actual</h4>
                            <div id="coach-history-content"></div>
                        </div>
                    </div>
                </details>

                <details class="accordion-panel">
                    <summary><span>MONITOR DE RENDIMIENTO Y SOCIOS</span></summary>
                    <div class="card-inner-content">
                        <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0 0 16px 0; line-height: 1.5; text-align: left;">Supervisión de fatiga neuromuscular mediante RPE y renovaciones de cuota.</p>
                        ${listaGestionAtletasHTML || '<p style="font-size:0.85rem; color:var(--text-muted); text-align:center; padding:10px 0;">No hay atletas activos registrados.</p>'}
                    </div>
                </details>

                <details class="accordion-panel" open>
                    <summary><span>BANDEJA DE FEEDBACKS ATLETAS</span></summary>
                    <div class="card-inner-content" style="padding-top:10px !important;">
                        
                        <div style="display:flex; background:var(--bg-dark); padding:3px; border-radius:6px; margin-bottom:16px; border:1px solid var(--border-color);">
                            <button id="coach-tab-pendientes" type="button" style="flex:1; background:var(--accent-color); border:none; color:#000; padding:8px; font-size:0.75rem; font-weight:800; border-radius:4px; cursor:pointer; text-transform:uppercase; letter-spacing:0.5px; transition:all 0.15s;">
                                📥 Pendientes (${contPendientes})
                            </button>
                            <button id="coach-tab-historial" type="button" style="flex:1; background:transparent; border:none; color:var(--text-muted); padding:8px; font-size:0.75rem; font-weight:800; border-radius:4px; cursor:pointer; text-transform:uppercase; letter-spacing:0.5px; transition:all 0.15s;">
                                📁 Historial (${contHistorial})
                            </button>
                        </div>

                        <div id="wrapper-feedbacks-pendientes" style="display:block;">${pendientesHTML}</div>
                        <div id="wrapper-feedbacks-historial" style="display:none;">${historialHTML}</div>

                    </div>
                </details>

                <details class="accordion-panel" style="margin-bottom: 16px;">
                    <summary>⚙️ AJUSTES GLOBALES DEL BOX</summary>
                    <div class="card-inner-content" style="padding-top:12px !important;">
                        <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0 0 14px 0; line-height: 1.5; text-align: left;">
                            Control de seguridad del Box. Modifica el código de acceso dinámico para autorizar o bloquear nuevos registros de atletas autónomos.
                        </p>
                        <div style="display: flex; flex-direction: column; gap: 6px; width: 100%; text-align:left;">
                            <label style="font-size: 0.65rem; color: var(--text-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Código de Registro Activo</label>
                            <div style="display: flex; gap: 8px; width: 100%; box-sizing: border-box;">
                                <input type="text" id="input-global-box-code" placeholder="Cargando código..." style="padding: 12px; font-size: 0.9rem; flex-grow: 1; margin: 0; background: var(--bg-dark); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 6px;">
                                <button id="btn-save-box-code" class="btn-primary" style="width: auto; padding: 0 20px; font-size: 0.8rem; font-weight: 800; margin: 0; min-height: auto;">💾 GUARDAR</button>
                            </div>
                        </div>
                    </div>
                </details>
            </div>
        `;

        document.getElementById('btn-coach-logout').addEventListener('click', App.logout);

        const tabPendientes = document.getElementById('coach-tab-pendientes');
        const tabHistorial = document.getElementById('coach-tab-historial');
        const wrapPendientes = document.getElementById('wrapper-feedbacks-pendientes');
        const wrapHistorial = document.getElementById('wrapper-feedbacks-historial');

        if (tabPendientes && tabHistorial) {
            tabPendientes.addEventListener('click', () => {
                tabPendientes.style.background = 'var(--accent-color)';
                tabPendientes.style.color = '#000';
                tabHistorial.style.background = 'transparent';
                tabHistorial.style.color = 'var(--text-muted)';
                wrapPendientes.style.display = 'block';
                wrapHistorial.style.display = 'none';
            });

            tabHistorial.addEventListener('click', () => {
                tabHistorial.style.background = 'var(--accent-color)';
                tabHistorial.style.color = '#000';
                tabPendientes.style.background = 'transparent';
                tabPendientes.style.color = 'var(--text-muted)';
                wrapHistorial.style.display = 'block';
                wrapPendientes.style.display = 'none';
            });
        }

        appContainer.querySelectorAll('[data-athlete-bubble]').forEach(bubble => {
            bubble.addEventListener('click', function() {
                App.selectAthleteWod(this.getAttribute('data-athlete-bubble'));
            });
        });

        appContainer.querySelectorAll('.btn-inner-program-trigger').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                App.selectAthleteWod(this.getAttribute('data-athlete'));
            });
        });

        appContainer.querySelectorAll('.btn-save-pay-trigger').forEach(btn => {
            btn.addEventListener('click', function() {
                App.actualizarPagoAtleta(this.getAttribute('data-athlete'));
            });
        });

        appContainer.querySelectorAll('.btn-save-group-trigger').forEach(btn => {
            btn.addEventListener('click', function() {
                App.actualizarGrupoAtleta(this.getAttribute('data-athlete'));
            });
        });

        appContainer.querySelectorAll('.quick-pill').forEach(pill => {
            pill.addEventListener('click', function() {
                const bKey = this.parentNode.getAttribute('data-block');
                const targetInput = document.getElementById(`reply-input-${bKey}`);
                if (targetInput) {
                    targetInput.value = this.getAttribute('data-reply');
                    targetInput.focus();
                    App.showToast("⚡ Corrección inyectada con éxito.");
                }
            });
        });

        appContainer.querySelectorAll('.btn-coach-send-reply').forEach(btn => {
            btn.addEventListener('click', function() {
                App.submitCoachReply(this, this.getAttribute('data-user'), this.getAttribute('data-date'));
            });
        });

        apiCall({ action: 'getBoxCode' }).then(res => {
            const inputCode = document.getElementById('input-global-box-code');
            if (res && res.success && inputCode) {
                inputCode.value = res.code;
            }
        });

        const btnSaveCode = document.getElementById('btn-save-box-code');
        if (btnSaveCode) {
            btnSaveCode.addEventListener('click', async function() {
                const inputCode = document.getElementById('input-global-box-code');
                if (!inputCode || !inputCode.value.trim()) return;
                
                this.disabled = true;
                this.innerText = "GUARDANDO...";
                
                const res = await apiCall({ action: 'updateBoxCode', newCode: inputCode.value.trim() });
                if (res && res.success) {
                    App.showToast("🔒 Código del Box actualizado en el servidor central.");
                } else {
                    App.showToast("❌ Error al guardar el nuevo código.");
                }
                this.disabled = false;
                this.innerText = "GUARDAR";
            });
        }

        if (typeof App.loadCoachHistory === 'function') {
            App.loadCoachHistory(initialDateISO, "");
        }
        
        document.getElementById('coachForm').onsubmit = async (e) => {
            e.preventDefault();
            const btn = document.getElementById('publishWodBtn');
            const txtInput = document.getElementById('wod-content-input');
            const videoInput = document.getElementById('wod-video');
            const visibilidadInput = document.getElementById('wod-visibilidad');
            
            btn.disabled = true;
            btn.innerText = "PUBLICANDO...";
            App.showToast("⏳ Sincronizando sesión con el servidor...");

            const dateInputVal = document.getElementById('wod-date').value;
            const dateES = dateInputVal.split('-').reverse().join('/');
            const destId = document.getElementById('wod-destinatario').value; 
            
            const res = await apiCall({ 
                action: 'saveWod', 
                date: dateES, 
                content: txtInput.value, 
                video: videoInput.value,
                id_usuario: destId,
                visibilidad: visibilidadInput ? visibilidadInput.value : ""
            });
            
            if (res && res.success) {
                App.showToast("🚀 ¡Entrenamiento publicado correctamente!");
                txtInput.value = "";
                if (videoInput) videoInput.value = "";
                btn.disabled = false;
                btn.innerText = "PUBLICAR SESIÓN";
                
                const labelSesion = document.getElementById('label-ultima-sesion');
                if (labelSesion && destId) {
                    labelSesion.innerHTML = `<span class="atleta-last-wod-info">📅 Última sesión programada: <strong style="color: var(--text-main);">${dateES}</strong></span>`;
                    if (App.coachUsersIndexed[destId]) {
                        App.coachUsersIndexed[destId].ultima_fecha_wod = dateES;
                    }
                }

                if (typeof App.loadCoachHistory === 'function') {
                    App.loadCoachHistory(dateInputVal, destId);
                }
            } else {
                App.showToast("❌ Error al publicar la sesión");
                btn.disabled = false;
                btn.innerText = "PUBLICAR SESIÓN";
            }
        };
    },

    actualizarGrupoAtleta: async (idAtleta) => {
        const selectGroup = document.getElementById(`select-group-${idAtleta}`);
        if (!selectGroup) {
            App.showToast("❌ No se localizó el selector de grupo en la interfaz.");
            return;
        }

        const grupoSeleccionado = selectGroup.value;
        App.showToast("⏳ Cambiando perfil del atleta en Google...");

        try {
            const response = await apiCall({
                action: 'updateUserGroup',
                id_usuario: idAtleta,
                nuevo_grupo: grupoSeleccionado
            });

            if (response && response.success) {
                App.showToast("🚀 ¡Grupo actualizado con éxito!");
                App.wodCache = {}; 
                
                setTimeout(() => { 
                    App.renderCoachPanel(); 
                }, 1000);
            } else {
                App.showToast("❌ Error: " + (response.message || "Cambio rechazado por el servidor."));
            }
        } catch (error) {
            console.error("Error al actualizar grupo:", error);
            App.showToast("❌ Error crítico de comunicación con el Box.");
        }
    },

    selectAthleteWod: (idAtleta) => {
        const inputDestinatario = document.getElementById('wod-destinatario');
        if (inputDestinatario) inputDestinatario.value = idAtleta;

        document.querySelectorAll('[data-athlete-bubble]').forEach(b => {
            const circle = b.querySelector('div');
            if (circle) {
                circle.style.border = "2px solid var(--border-color)";
                circle.style.boxShadow = "none";
            }
        });

        if (idAtleta === "") {
            const globalCircle = document.getElementById('bubble-circle-global');
            if (globalCircle) {
                globalCircle.style.border = "2px solid var(--accent-color)";
                globalCircle.style.boxShadow = "0 4px 12px rgba(255,24,56,0.2)";
            }
        } else {
            const athleteCircle = document.getElementById(`bubble-circle-${idAtleta}`);
            if (athleteCircle) {
                athleteCircle.style.border = "2px solid var(--accent-color)";
                athleteCircle.style.boxShadow = "0 4px 12px rgba(255,24,56,0.2)";
            }
        }

        const wrapperVisibilidad = document.getElementById('wrapper-visibilidad-grupo');
        const selectVisibilidad = document.getElementById('wod-visibilidad');

        if (wrapperVisibilidad) {
            if (idAtleta === "") {
                wrapperVisibilidad.style.display = "block";
            } else {
                wrapperVisibilidad.style.display = "none";
                if (selectVisibilidad) selectVisibilidad.value = "";
            }
        }

        const targetDateISO = document.getElementById('wod-date') ? document.getElementById('wod-date').value : App.formatDateToISO(new Date());
        if (typeof App.loadCoachHistory === 'function') {
            App.loadCoachHistory(targetDateISO, idAtleta);
        }
        
        if (idAtleta === "") {
            App.showToast("🌍 Programando bloque para el Box General");
        } else {
            const nombreAtleta = App.coachUsersIndexed[idAtleta] ? App.coachUsersIndexed[idAtleta].nombre : "Atleta";
            App.showToast(`🎯 Programando entreno exclusivo para: ${nombreAtleta.toUpperCase()}`);
        }
    },

    actualizarPagoAtleta: async (idAtleta) => {
        const inputDate = document.getElementById(`date-pay-${idAtleta}`).value;
        if (!inputDate) {
            App.showToast("❌ Selecciona la fecha base primero");
            return;
        }

        const parts = inputDate.split('-');
        const fechaFormateada = `${parts[2]}/${parts[1]}/${parts[0]}`;

        App.showToast("⏳ Procesando mes siguiente en Google...");

        const response = await apiCall({
            action: 'updatePaymentDate',
            id_usuario: idAtleta,
            nueva_fecha: fechaFormateada
        });

        if (response && response.success) {
            App.showToast("✅ ¡Suscripción renovada con éxito!");
            App.wodCache = {};
            setTimeout(() => { App.renderCoachPanel(); }, 1000);
        } else {
            App.showToast("❌ Error al guardar la fecha en el servidor");
        }
    },

    renderFeedbackForm: () => {
        App.renderView('Log Result', 'Registro', 'entreno', '', `
            <div class="card-glass fade-in" style="text-align: left;"><form id="feedbackForm">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
                    <div class="input-group"><label>TIEMPO</label><input type="text" id="res-tiempo" placeholder="Ej: 14:20"></div>
                    <div class="input-group"><label>REPS</label><input type="text" id="res-reps" placeholder="Ej: 150"></div>
                </div>
                <div class="input-group"><label>PESO (KG)</label><input type="text" id="res-peso" placeholder="Ej: 60"></div>
                <div class="input-group"><label>ESFUERZO PERCIBIDO (RPE 1-10)</label><input type="number" id="res-rpe" min="1" max="10" required></div>
                <div class="input-group">
                    <label>🎬 VÍDEOS DE TÉCNICA (DESDE GALERÍA)</label>
                    <input type="file" id="res-video-files" accept="video/*" multiple style="display:none;">
                    <button type="button" id="btn-select-videos-trigger" class="logout-mini" style="border:1px dashed var(--accent-color); font-weight:700;">📎 SELECCIONAR VÍDEOS</button>
                    <p id="file-count-label" style="font-size:0.8rem; margin-top:4px; color:var(--accent-color); font-weight:700; text-align: left;"></p>
                    <p id="upload-status" style="display:none; font-size:0.85rem; color:var(--warning); font-weight:700; text-align: left;"></p>
                </div>
                <div class="input-group"><label>NOTAS DEL ATLETA</label><textarea id="res-feedback" rows="3" placeholder="Buenas sensaciones..."></textarea></div>
                <button type="submit" id="saveResultBtn" class="btn-primary">GUARDAR MARCA</button>
                <button type="button" id="btn-feedback-back" class="logout-mini" style="width:100%; margin-top:12px;">Volver</button>
            </form></div>`);

        document.getElementById('btn-select-videos-trigger').addEventListener('click', () => {
            document.getElementById('res-video-files').click();
        });

        document.getElementById('res-video-files').addEventListener('change', function() {
            document.getElementById('file-count-label').innerText = this.files.length + ' vídeo(s) seleccionado(s)';
        });

        document.getElementById('btn-feedback-back').addEventListener('click', App.renderDashboard);

        document.getElementById('feedbackForm').onsubmit = async (e) => {
            e.preventDefault(); 
            document.getElementById('saveResultBtn').disabled = true; 
            document.getElementById('saveResultBtn').innerText = "GUARDANDO...";
            
            let feedbackText = document.getElementById('res-feedback').value; 
            const rpeVal = document.getElementById('res-rpe').value;
            const fileInput = document.getElementById('res-video-files');
            
            let videoUrls = []; 
            if (fileInput && fileInput.files.length > 0) videoUrls = await App.uploadVideosToCloudinary(fileInput.files);
            
            if(rpeVal) feedbackText = `[RPE: ${rpeVal}] ` + feedbackText;
            if(videoUrls.length > 0) feedbackText += ` [VIDEO: ${videoUrls.join(', ')}]`;
            
            await apiCall({ 
                action: 'saveResult', 
                id_usuario: App.user.id, 
                nombre: App.user.nombre, 
                fecha: App.formatDateToES(new Date()), 
                tiempo: document.getElementById('res-tiempo').value, 
                reps: document.getElementById('res-reps').value, 
                peso: document.getElementById('res-peso').value, 
                rpe: rpeVal, 
                feedback: feedbackText 
            });
            App.renderDashboard();
        };
    },

renderLogin: () => {
        const appNode = document.getElementById('app');
        if (!appNode) return;
        appNode.innerHTML = `
            <div class="auth-wrapper">
                <div class="auth-card fade-in">
                    <img src="./asset/logo.png" alt="LionBeat Logo" class="auth-logo" onerror="this.style.display='none';">
                    <p class="auth-subtitle">ELITE PROGRAMMING</p>
                    
                    <form id="loginForm">
                        <div class="input-group">
                            <label>EMAIL</label>
                            <input type="email" id="email" required placeholder="atleta@email.com">
                        </div>
                        <div class="input-group">
                            <label>PASSWORD</label>
                            <input type="password" id="password" required placeholder="••••••••">
                        </div>
                        <button type="submit" class="btn-primary">ENTRAR</button>
                    </form>
                    <p style="text-align:center; margin-top:24px; font-size:0.85rem; color:var(--text-muted);">
                        ¿No tienes cuenta? <a href="#" id="link-go-register" class="auth-link">Solicita acceso</a>
                    </p>
                </div>
            </div>`;
        
        document.getElementById('link-go-register').addEventListener('click', (e) => {
            e.preventDefault();
            App.renderRegister();
        });

        document.getElementById('loginForm').onsubmit = async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            Auth.loginAtleta(document.getElementById('email').value, document.getElementById('password').value, btn);
        };
    },

    renderRegister: () => {
        const appNode = document.getElementById('app');
        if (!appNode) return;
        appNode.innerHTML = `
            <div class="auth-wrapper">
                <div class="auth-card fade-in">
                    <img src="./asset/logo.png" alt="LionBeat Logo" class="auth-logo" onerror="this.style.display='none';">
                    <p class="auth-subtitle">SOLICITUD DE ACCESO</p>
                    
                    <form id="registerForm">
                        <div class="input-group">
                            <label>NOMBRE COMPLETO</label>
                            <input type="text" id="reg-nombre" required placeholder="Ej: Laura">
                        </div>
                        <div class="input-group">
                            <label>EMAIL</label>
                            <input type="email" id="reg-email" required placeholder="tu@email.com">
                        </div>
                        <div class="input-group">
                            <label>CONTRASEÑA</label>
                            <input type="password" id="reg-password" required placeholder="Crea tu clave secreta">
                        </div>
                        <div class="input-group">
                            <label>CÓDIGO DEL BOX</label>
                            <input type="text" id="reg-code" required placeholder="Solicítalo a tu Coach">
                        </div>
                        <button type="submit" id="btnRegisterSubmit" class="btn-primary">REGISTRARSE</button>
                    </form>
                    <p style="text-align:center; margin-top:24px; font-size:0.85rem; color:var(--text-muted);">
                        ¿Ya tienes cuenta? <a href="#" id="link-go-login" class="auth-link">Inicia sesión</a>
                    </p>
                </div>
            </div>`;
            
        document.getElementById('link-go-login').addEventListener('click', (e) => {
            e.preventDefault();
            App.renderLogin();
        });

        document.getElementById('registerForm').onsubmit = async (e) => {
            e.preventDefault(); 
            
            const btn = document.getElementById('btnRegisterSubmit');
            btn.disabled = true;
            btn.innerText = "PROCESANDO ACCESO...";

            try {
                const res = await apiCall({ 
                    action: 'registerUser', 
                    nombre: document.getElementById('reg-nombre').value.trim(), 
                    email: document.getElementById('reg-email').value.trim(), 
                    password: document.getElementById('reg-password').value,
                    code: document.getElementById('reg-code').value.trim()
                }); 
                
                if (res && res.success) {
                    App.showToast("✅ ¡Registro completado! Ya puedes iniciar sesión.");
                    App.renderLogin();
                } else {
                    App.showToast("❌ " + (res.message || "Error al registrar la cuenta."));
                    btn.disabled = false;
                    btn.innerText = "REGISTRARSE";
                }
            } catch (err) {
                App.showToast("❌ Error de conexión al procesar el alta.");
                btn.disabled = false;
                btn.innerText = "REGISTRARSE";
            }
        };
    },

    logout: () => { 
        localStorage.removeItem('user'); 
        App.user = null;
        App.wodCache = {};
        
        const appView = document.getElementById('app-view');
        if (appView) appView.innerHTML = '';
        
        const appMain = document.getElementById('app');
        if (appMain) appMain.innerHTML = '';
        
        App.renderLogin(); 
    },

    changeDate: (days) => { 
        const p = document.getElementById('datePicker'); 
        if(!p) return; 
        const [y,m,d] = p.value.split('-').map(Number); 
        const date = new Date(y, m-1, d); 
        date.setDate(date.getDate() + days); 
        App.renderDashboard(App.formatDateToES(date)); 
    },
    
    initCalendarEvents: () => { 
        const p = document.getElementById('datePicker'); 
        if(p) {
            p.addEventListener('change', (e) => {
                App.renderDashboard(e.target.value.split('-').reverse().join('/'));
            });
        }
    }
};

document.addEventListener('DOMContentLoaded', App.init);