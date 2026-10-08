// ======================================================
// LIONBEAT PERFORMANCE SYSTEM
// Autenticación y gestión de sesión
// ======================================================

const Auth = {
    /**
     * Inicia sesión para un atleta o entrenador.
     *
     * @param {string} email
     * @param {string} password
     * @param {HTMLButtonElement|null} btnEl
     */
    loginAtleta: async (email, password, btnEl) => {
        const emailNormalizado = String(email || '').trim();

        if (!emailNormalizado || !password) {
            if (typeof App !== 'undefined') {
                App.showToast('Introduce tu email y contraseña.');
            }
            return;
        }

        const textoOriginal = btnEl
            ? btnEl.innerText
            : '';

        if (btnEl) {
            btnEl.disabled = true;
            btnEl.setAttribute('aria-busy', 'true');
            btnEl.innerText = 'VERIFICANDO...';
        }

        try {
            const response = await apiCall({
                action: 'login',
                email: emailNormalizado,
                password: password
            });

            if (response && response.success && response.user) {
                localStorage.setItem(
                    'user',
                    JSON.stringify(response.user)
                );

                if (typeof App !== 'undefined') {
                    App.user = response.user;

                    App.showToast(
                        `Bienvenido de nuevo, ${response.user.nombre}.`
                    );

                    if (response.user.rol === 'coach') {
                        App.renderCoachPanel();
                    } else {
                        App.renderDashboard();
                    }
                }

                return;
            }

            if (typeof App !== 'undefined') {
                App.showToast(
                    response && response.message
                        ? response.message
                        : 'No se ha podido iniciar sesión.'
                );
            }
        } catch (error) {
            console.error('Error al iniciar sesión:', error);

            if (typeof App !== 'undefined') {
                App.showToast(
                    'Error de conexión. Inténtalo de nuevo.'
                );
            }
        } finally {
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.removeAttribute('aria-busy');
                btnEl.innerText = textoOriginal || 'ENTRAR';
            }
        }
    },

    /**
     * Cierra la sesión local del usuario.
     */
    logout: () => {
        localStorage.removeItem('user');

        if (typeof App !== 'undefined') {
            App.user = null;
            App.wodCache = {};
            App.renderLogin();
        } else {
            window.location.reload();
        }
    }
};