// ======================================================
// LIONBEAT PERFORMANCE SYSTEM
// Comunicación con Google Apps Script
// ======================================================

const API_URL = 'https://script.google.com/macros/s/AKfycbzn2IGndOqAKhRMUB0W1240GnxhXTmai8VJDpKGTgK2oxFID8hXoj13RMJfvyMbGnsbXA/exec';

/**
 * Ejecuta una petición a Google Apps Script.
 *
 * Mantiene el formato de datos y las acciones del backend.
 *
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
async function apiCall(payload) {
    if (!navigator.onLine) {
        console.warn(
            'LIONBEAT: dispositivo sin conexión.'
        );

        if (
            payload.action === 'saveResult' ||
            payload.action === 'saveReadiness'
        ) {
            let offlineQueue = [];

            try {
                offlineQueue = JSON.parse(
                    localStorage.getItem('offlineResults') || '[]'
                );

                if (!Array.isArray(offlineQueue)) {
                    offlineQueue = [];
                }
            } catch (error) {
                offlineQueue = [];
            }

            offlineQueue.push(payload);

            localStorage.setItem(
                'offlineResults',
                JSON.stringify(offlineQueue)
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
                offline: true
            };
        }

        return {
            success: false,
            message: 'Sin conexión a internet.'
        };
    }

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            mode: 'cors',
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

        const data = await response.json();

        return data;

    } catch (error) {
        console.error(
            'LIONBEAT: error en la llamada API:',
            error
        );

        if (
            payload.action === 'saveResult' ||
            payload.action === 'saveReadiness'
        ) {
            let offlineQueue = [];

            try {
                offlineQueue = JSON.parse(
                    localStorage.getItem('offlineResults') || '[]'
                );

                if (!Array.isArray(offlineQueue)) {
                    offlineQueue = [];
                }
            } catch (storageError) {
                offlineQueue = [];
            }

            offlineQueue.push(payload);

            localStorage.setItem(
                'offlineResults',
                JSON.stringify(offlineQueue)
            );

            if (
                typeof App !== 'undefined' &&
                typeof App.showToast === 'function'
            ) {
                App.showToast(
                    'Error de red. Datos guardados en la cola local.'
                );
            }

            return {
                success: true,
                offline: true
            };
        }

        return {
            success: false,
            message: error.message || 'Error de conexión.'
        };
    }
}