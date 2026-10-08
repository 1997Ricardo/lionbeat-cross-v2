// ======================================================
// LIONBEAT PERFORMANCE SYSTEM
// Service Worker
// ======================================================

const CACHE_NAME = 'lionbeat-performance-v8';

const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json'
];

// Instalar nueva versión.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activar y retirar las cachés antiguas.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                const oldCaches = cacheNames
                    .filter((name) => name !== CACHE_NAME);

                return Promise.all(
                    oldCaches.map((name) => caches.delete(name))
                );
            })
            .then(() => self.clients.claim())
    );
});

// Gestionar únicamente peticiones GET del mismo origen.
self.addEventListener('fetch', (event) => {
    const request = event.request;

    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);

    // Nunca interceptar la API ni recursos de otros orígenes.
    if (url.origin !== self.location.origin) {
        return;
    }

    // Para la navegación, intentar primero la red.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response && response.ok) {
                        const responseCopy = response.clone();

                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put('./index.html', responseCopy);
                            })
                            .catch(() => {});
                    }

                    return response;
                })
                .catch(async () => {
                    return (
                        await caches.match('./index.html')
                    ) || Response.error();
                })
        );

        return;
    }

    // Para recursos estáticos, priorizar la red y usar caché
    // como alternativa si no hay conexión.
    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response && response.ok) {
                    const responseCopy = response.clone();

                    caches.open(CACHE_NAME)
                        .then((cache) => {
                            cache.put(request, responseCopy);
                        })
                        .catch(() => {});
                }

                return response;
            })
            .catch(async () => {
                const cachedResponse = await caches.match(request);

                return cachedResponse || Response.error();
            })
    );
});