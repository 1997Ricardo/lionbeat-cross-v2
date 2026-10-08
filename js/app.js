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
                            <div style="width: 100%; height: ${heightPercent}%; background: ${barColor}; border-radius: 4px 4px 0 0;"></div>
                        </div>
                        <span style="font-size: 0.65rem; color: var(--text-muted);">${item.fecha}</span>
                        <span style="font-size: 0.7rem; font-weight: 800; color: var(--text-main);">${rpeVal || '-'}</span>
                    </div>`;
            });
            container.innerHTML = `
                <div style="display:flex; gap:8px; align-items:flex-end; width:100%;">
                    ${barsHTML}
                </div>`;
        } catch (error) {
            console.error('Error renderizando gráfico de fatiga:', error);
            container.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-muted); text-align: center;">No se pudo cargar el gráfico.</p>`;
        }
    },

    // --- BANDEJA DE FEEDBACK DEL COACH ---
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