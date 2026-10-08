
/* ======================================================
   LIONBEAT PERFORMANCE SYSTEM
   Comunicación con Google Apps Script
   ====================================================== */

   const API_URL = 'https://script.google.com/macros/s/AKfycbzQI2yQyWnssPar_JXTB44dxqeA9LpHfsX7pKRvxgbQW6OodEwh_V_AQPfHlifPfuEnyg/exec';

   /* ======================================================
      CONFIGURACIÓN DE ACCIONES
      ====================================================== */
   
   const GET_ACTIONS = new Set([
       'getWod',
       'getLeaderboard',
       'getUserHistory',
       'getWodRadarForCoach',
       'getBoxCode'
   ]);
   
   const OFFLINE_ACTIONS = new Set([
       'saveResult',
       'saveReadiness'
   ]);
   
   /* ======================================================
      COLA DE OPERACIONES SIN CONEXIÓN
      ====================================================== */
   
   function getOfflineQueue() {
       try {
           const queue = JSON.parse(
               localStorage.getItem('offlineResults') || '[]'
           );
   
           return Array.isArray(queue) ? queue : [];
       } catch (error) {
           console.warn(
               'LIONBEAT: no se pudo leer la cola sin conexión.',
               error
           );
   
           return [];
       }
   }
   
   function saveOfflinePayload(payload) {
       try {
           const queue = getOfflineQueue();
   
           queue.push(payload);
   
           localStorage.setItem(
               'offlineResults',
               JSON.stringify(queue)
           );
   
           if (
               typeof App !== 'undefined' &&
               typeof App.showToast === 'function'
           ) {
               App.showToast(
                   'Sin conexión: datos guardados localmente.'
               );
           }
   
           return {
               success: true,
               offline: true,
               message: 'Datos guardados localmente.'
           };
       } catch (error) {
           console.error(
               'LIONBEAT: error guardando datos sin conexión.',
               error
           );
   
           return {
               success: false,
               message: 'No se pudieron guardar los datos localmente.'
           };
       }
   }
   
   /* ======================================================
      CONSTRUCCIÓN DE URL PARA PETICIONES GET
      ====================================================== */
   
   function buildGetUrl(payload) {
       const url = new URL(API_URL);
   
       Object.entries(payload).forEach(([key, value]) => {
           if (value !== undefined && value !== null) {
               url.searchParams.set(key, String(value));
           }
       });
   
       return url.toString();
   }
   
   /* ======================================================
      PETICIÓN PRINCIPAL A GOOGLE APPS SCRIPT
      ====================================================== */
   
   /**
    * Ejecuta una petición a Google Apps Script.
    *
    * Las acciones de lectura registradas en GET_ACTIONS
    * se envían mediante GET.
    *
    * El resto de acciones se envían mediante POST.
    *
    * @param {Object} payload
    * @returns {Promise<Object>}
    */
   
   async function apiCall(payload) {
       if (!payload || typeof payload !== 'object') {
           return {
               success: false,
               message: 'La petición no contiene datos válidos.'
           };
       }
   
       if (!payload.action) {
           return {
               success: false,
               message: 'La petición no especifica ninguna acción.'
           };
       }
   
       if (!navigator.onLine) {
           console.warn(
               'LIONBEAT: dispositivo sin conexión.'
           );
   
           if (OFFLINE_ACTIONS.has(payload.action)) {
               return saveOfflinePayload(payload);
           }
   
           return {
               success: false,
               message: 'Sin conexión a internet.'
           };
       }
   
       try {
           let response;
   
           if (GET_ACTIONS.has(payload.action)) {
               const url = buildGetUrl(payload);
   
               response = await fetch(url, {
                   method: 'GET',
                   cache: 'no-store'
               });
           } else {
               response = await fetch(API_URL, {
                   method: 'POST',
                   headers: {
                       'Content-Type': 'text/plain;charset=utf-8'
                   },
                   body: JSON.stringify(payload)
               });
           }
   
           if (!response.ok) {
               throw new Error(
                   `Error HTTP: ${response.status}`
               );
           }
   
           const data = await response.json();
   
           if (
               data &&
               data.success === false
           ) {
               console.warn(
                   'LIONBEAT: el servidor ha rechazado la petición.',
                   {
                       action: payload.action,
                       message: data.message
                   }
               );
           }
   
           return data;
   
       } catch (error) {
           console.error(
               'LIONBEAT: error en la llamada API:',
               error
           );
   
           if (OFFLINE_ACTIONS.has(payload.action)) {
               return saveOfflinePayload(payload);
           }
   
           return {
               success: false,
               message: error.message || 'Error de conexión.'
           };
       }
   }
   
   /* ======================================================
      SINCRONIZACIÓN DE DATOS PENDIENTES
      ====================================================== */
   
   /**
    * Envía las operaciones guardadas localmente.
    *
    * Se elimina cada operación de la cola únicamente
    * cuando el servidor confirma success: true.
    */
   
   async function syncOfflineResults() {
       if (!navigator.onLine) {
           return {
               success: false,
               message: 'Sin conexión a internet.'
           };
       }
   
       const queue = getOfflineQueue();
   
       if (queue.length === 0) {
           return {
               success: true,
               synced: 0
           };
       }
   
       const pending = [...queue];
       const remaining = [];
       let synced = 0;
   
       for (const payload of pending) {
           try {
               const result = await sendPostRequest(payload);
   
               if (result && result.success === true) {
                   synced++;
               } else {
                   remaining.push(payload);
               }
           } catch (error) {
               console.error(
                   'LIONBEAT: no se pudo sincronizar una operación.',
                   error
               );
   
               remaining.push(payload);
           }
       }
   
       try {
           localStorage.setItem(
               'offlineResults',
               JSON.stringify(remaining)
           );
       } catch (error) {
           console.error(
               'LIONBEAT: error actualizando la cola local.',
               error
           );
       }
   
       return {
           success: remaining.length === 0,
           synced,
           pending: remaining.length
       };
   }
   
   /* ======================================================
      PETICIÓN POST INTERNA
      ====================================================== */
   
   async function sendPostRequest(payload) {
       const response = await fetch(API_URL, {
           method: 'POST',
           headers: {
               'Content-Type': 'text/plain;charset=utf-8'
           },
           body: JSON.stringify(payload)
       });
   
       if (!response.ok) {
           throw new Error(
               `Error HTTP: ${response.status}`
           );
       }
   
       return await response.json();
   }
   
   /* ======================================================
      RECONEXIÓN AUTOMÁTICA
      ====================================================== */
   
   window.addEventListener('online', async () => {
       const queue = getOfflineQueue();
   
       if (queue.length === 0) {
           return;
       }
   
       console.info(
           'LIONBEAT: conexión recuperada. Sincronizando datos pendientes.'
       );
   
       const result = await syncOfflineResults();
   
       if (
           result.synced > 0 &&
           typeof App !== 'undefined' &&
           typeof App.showToast === 'function'
       ) {
           App.showToast(
               `Se han sincronizado ${result.synced} operaciones.`
           );
       }
   });
   
   /* ======================================================
      EXPORTACIÓN GLOBAL
      ====================================================== */
   
   window.apiCall = apiCall;
   window.syncOfflineResults = syncOfflineResults;
   