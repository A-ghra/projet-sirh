const LOGIN_ERROR_MESSAGE = "Nom d'utilisateur ou mot de passe incorrect.";

let _loginInProgress = false;

function getApiBase() {
    return typeof otomiaGetApiBase === "function"
        ? otomiaGetApiBase()
        : (window.OTOMIA_API_BASE || `http://${location.hostname || "127.0.0.1"}:8000/api`);
}

/**
 * Login direct — pas de verifySession, CSRF best-effort uniquement.
 */
async function apiLogin(username, password) {
    const api = getApiBase();
    const csrf = typeof otomiaTryCsrf === "function" ? await otomiaTryCsrf() : "";

    let response;
    try {
        response = await fetch(`${api}/login/`, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                ...(csrf ? { "X-CSRFToken": csrf } : {}),
            },
            body: JSON.stringify({ username, password }),
        });
    } catch (err) {
        throw typeof otomiaFormatFetchError === "function"
            ? otomiaFormatFetchError(err)
            : err;
    }

    const data = await response.json().catch(() => ({}));

    if (response.status === 403 && !csrf) {
        throw typeof otomiaFormatFetchError === "function"
            ? otomiaFormatFetchError(new Error("csrf"), "csrf")
            : new Error("Accès refusé (CSRF). Rechargez la page et réessayez.");
    }

    if (!response.ok) {
        const err = new Error(data.error || LOGIN_ERROR_MESSAGE);
        err.status = response.status;
        throw err;
    }

    if (typeof otomiaResetCsrf === "function") otomiaResetCsrf();
    return data;
}

/** Redirection immédiate avec les données du login (sans /me/ obligatoire). */
function completeLogin(loginPayload) {
    if (typeof otomiaCancelAuthCheck === "function") otomiaCancelAuthCheck();

    const user = loginPayload?.user;
    if (!user) throw new Error("Réponse login invalide (utilisateur manquant).");

    if (typeof otomiaPersistUser === "function") {
        otomiaPersistUser(user);
    } else {
        sessionStorage.setItem("otomia_user", JSON.stringify(user));
    }

    if (typeof otomiaLog === "function") {
        otomiaLog("Connexion OK", user.username, user.role, user.dashboard);
    }

    const target = typeof otomiaAppEntryUrl === "function"
        ? otomiaAppEntryUrl(user)
        : "index.html";

    window.location.replace(target);
}

async function applyLoginBranding() {
    try {
        const host = window.OTOMIA_API_HOST || getApiBase().replace(/\/api\/?$/, "");
        const r = await fetch(`${host}/api/public-branding/`, { credentials: "include" });
        if (!r.ok) return;
        const b = await r.json();
        const logoBox = document.querySelector(".logo-box");
        if (logoBox && b.logo_display_url) {
            const src = b.logo_display_url.startsWith("http") ? b.logo_display_url : `${host}${b.logo_display_url}`;
            const icon = logoBox.querySelector("i");
            if (icon) {
                const img = document.createElement("img");
                img.src = src;
                img.style.cssText = "width:48px;height:48px;object-fit:contain;border-radius:6px;";
                icon.replaceWith(img);
            }
        }
        const h1 = document.querySelector(".login-brand h1");
        const slogan = document.querySelector(".login-brand p");
        if (h1 && b.company_acronym) h1.textContent = b.company_acronym;
        if (slogan && b.company_slogan) slogan.textContent = b.company_slogan;
    } catch (e) { /* non bloquant */ }
}

function showApiWarning(message) {
    const el = document.getElementById("api-status");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
}

/** Warning seulement — ne bloque jamais le login */
async function checkApiOnLoad() {
    if (typeof otomiaCheckApiReachable !== "function") return;
    const status = await otomiaCheckApiReachable();
    if (!status.ok && status.warn) {
        showApiWarning("Avertissement : " + status.message);
    } else if (status.ok && typeof otomiaLog === "function") {
        otomiaLog("API joignable", status.api);
    }
}

function checkExistingSession() {
    if (_loginInProgress) return;
    const stored = typeof otomiaGetStoredUser === "function"
        ? otomiaGetStoredUser()
        : null;
    if (!stored) return;

    const controller = typeof otomiaCreateAuthCheck === "function"
        ? otomiaCreateAuthCheck()
        : new AbortController();

    const api = getApiBase();
    fetch(`${api}/me/`, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
    })
        .then(async (r) => {
            if (_loginInProgress) return;
            if (r.status === 401) {
                sessionStorage.removeItem("otomia_user");
                return;
            }
            if (!r.ok) return;
            const me = await r.json();
            if (_loginInProgress) return;
            if (typeof otomiaPersistUser === "function") otomiaPersistUser(me);
            const target = typeof otomiaAppEntryUrl === "function"
                ? otomiaAppEntryUrl(me)
                : "index.html";
            window.location.replace(target);
        })
        .catch((err) => {
            if (err.name === "AbortError" || _loginInProgress) return;
            /* erreur réseau : ne pas effacer la session */
        });
}

document.addEventListener("DOMContentLoaded", () => {
    applyLoginBranding();
    checkApiOnLoad();

    const form = document.getElementById("login-form");
    const errorEl = document.getElementById("login-error");
    const btn = document.getElementById("login-btn");
    const forgotLink = document.getElementById("forgot-password-link");

    if (!form) return;

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errorEl.hidden = true;

        const username = form.username.value.trim();
        const password = form.password.value;
        if (!username || !password) {
            errorEl.textContent = LOGIN_ERROR_MESSAGE;
            errorEl.hidden = false;
            return;
        }

        if (typeof otomiaIsHttpContext === "function" && !otomiaIsHttpContext()) {
            errorEl.textContent = "Utilisez http://127.0.0.1:5500/login.html (pas file://).";
            errorEl.hidden = false;
            return;
        }

        _loginInProgress = true;
        if (typeof otomiaCancelAuthCheck === "function") otomiaCancelAuthCheck();

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connexion...';

        try {
            const result = await apiLogin(username, password);
            completeLogin(result);
        } catch (err) {
            _loginInProgress = false;
            const isAuth = err.status === 401
                || /incorrect|mot de passe|invalid/i.test(err.message || "");
            errorEl.textContent = isAuth
                ? (err.message || LOGIN_ERROR_MESSAGE)
                : (err.message || "Erreur de connexion.");
            errorEl.hidden = false;
            if (typeof otomiaLog === "function") otomiaLog("Erreur login", err);
        } finally {
            if (!_loginInProgress) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Se connecter';
            }
        }
    });

    forgotLink?.addEventListener("click", (e) => {
        e.preventDefault();
        alert("Pour réinitialiser votre mot de passe, contactez votre administrateur système ou le service RH.");
    });

    checkExistingSession();
});
