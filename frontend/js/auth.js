const LOGIN_ERROR_MESSAGE = "Identifiant ou mot de passe incorrect.";

let _loginInProgress = false;

const OTOMIA_LOGIN_API = "http://127.0.0.1:8000/api";

function getApiBase() {
    return typeof otomiaGetApiBase === "function"
        ? otomiaGetApiBase()
        : (window.OTOMIA_API_BASE || OTOMIA_LOGIN_API);
}

function logErr(context, err) {
    if (typeof otomiaLogError === "function") otomiaLogError(context, err);
    else console.error("[OTOMIA ERROR]", context, err);
}

async function apiLogin(username, password) {
    console.log("[LOGIN REQUEST]", username, getApiBase());
    let response;
    try {
        if (typeof otomiaApiFetch === "function") {
            response = await otomiaApiFetch("/login/", {
                method: "POST",
                body: { username, password },
            });
        } else {
            const api = getApiBase();
            const csrf = typeof otomiaTryCsrf === "function" ? await otomiaTryCsrf() : "";
            const loginUrl = `${api}/login/`;
            console.log("[OTOMIA FETCH]", "POST", loginUrl);
            response = await fetch(loginUrl, {
                method: "POST",
                credentials: "include",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "X-Requested-With": "XMLHttpRequest",
                    ...(csrf ? { "X-CSRFToken": csrf } : {}),
                },
                body: JSON.stringify({ username, password }),
            });
            console.log("[OTOMIA FETCH]", "POST", loginUrl, "→", response.status);
        }
    } catch (err) {
        logErr("apiLogin fetch", err);
        const isNet = typeof otomiaIsNetworkFetchError === "function"
            ? otomiaIsNetworkFetchError(err)
            : true;
        const net = typeof otomiaFormatFetchError === "function"
            ? otomiaFormatFetchError(err)
            : new Error(`Connexion impossible vers ${OTOMIA_LOGIN_API}. Démarrez Django : python manage.py runserver 127.0.0.1:8000`);
        net.isNetwork = isNet;
        throw net;
    }

    console.log("[LOGIN RESPONSE]", response.status, response.statusText);

    const data = typeof otomiaParseResponseBody === "function"
        ? await otomiaParseResponseBody(response)
        : {};
    console.log("[LOGIN RESPONSE BODY]", data);

    if (!response.ok) {
        const msg = typeof otomiaApiErrorMessage === "function"
            ? otomiaApiErrorMessage(data, response.status)
            : (data?.error || LOGIN_ERROR_MESSAGE);
        const err = new Error(msg === `Erreur API ${response.status}` ? LOGIN_ERROR_MESSAGE : msg);
        err.status = response.status;
        err.isNetwork = false;
        logErr(`apiLogin HTTP ${response.status}`, err);
        throw err;
    }

    if (typeof otomiaResetCsrf === "function") otomiaResetCsrf();
    return data;
}

function completeLogin(loginPayload) {
    if (typeof otomiaCancelAuthCheck === "function") otomiaCancelAuthCheck();

    const user = loginPayload?.user;
    if (!user) {
        const err = new Error(LOGIN_ERROR_MESSAGE);
        logErr("completeLogin sans user", err);
        throw err;
    }

    if (typeof otomiaPersistUser === "function") {
        otomiaPersistUser(user);
    } else {
        sessionStorage.setItem("otomia_user", JSON.stringify(user));
    }
    sessionStorage.setItem("otomia_fresh_login", "1");

    if (typeof otomiaLog === "function") {
        otomiaLog("Connexion OK → tableau de bord", user.role);
    }

    const target = typeof otomiaAppEntryUrl === "function"
        ? otomiaAppEntryUrl()
        : "index.html?module=dashboard";

    console.log("[LOGIN REDIRECT]", target);
    window.location.replace(target);
}

async function applyLoginBranding() {
    try {
        const api = getApiBase();
        const brandingUrl = `${api}/public-branding/`;
        console.log("[OTOMIA FETCH]", "GET", brandingUrl);
        const r = await fetch(brandingUrl, {
            credentials: "include",
            headers: { Accept: "application/json" },
        });
        console.log("[OTOMIA FETCH]", "GET", brandingUrl, "→", r.status);
        if (!r.ok) return;
        const b = typeof otomiaParseResponseBody === "function"
            ? await otomiaParseResponseBody(r)
            : null;
        if (!b || b.error) return;
        const logoBox = document.querySelector(".logo-box");
        if (logoBox && b.logo_display_url) {
            const host = window.OTOMIA_API_HOST || "http://127.0.0.1:8000";
            const src = b.logo_display_url.startsWith("http") ? b.logo_display_url : `${host}${b.logo_display_url}`;
            if (!logoBox.querySelector("img")) {
                const icon = logoBox.querySelector("i");
                if (icon?.parentNode) {
                    const img = document.createElement("img");
                    img.src = src;
                    img.style.cssText = "width:48px;height:48px;object-fit:contain;border-radius:6px;";
                    try { icon.replaceWith(img); } catch (e) { logErr("login logo replace", e); }
                }
            }
        }
        const h1 = document.querySelector(".login-brand h1");
        const slogan = document.querySelector(".login-brand p");
        if (h1 && b.company_acronym) h1.textContent = b.company_acronym;
        if (slogan && b.company_slogan) slogan.textContent = b.company_slogan;
    } catch (e) {
        logErr("applyLoginBranding", e);
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
    const meUrl = `${api}/me/`;
    console.log("[OTOMIA FETCH]", "GET", meUrl, "(session check)");
    fetch(meUrl, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
        headers: {
            Accept: "application/json",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
        },
    })
        .then(async (r) => {
            console.log("[OTOMIA FETCH]", "GET", meUrl, "→", r.status);
            if (_loginInProgress) return;
            if (r.status === 401) {
                sessionStorage.removeItem("otomia_user");
                return;
            }
            if (!r.ok) return;
            const me = typeof otomiaParseResponseBody === "function"
                ? await otomiaParseResponseBody(r)
                : null;
            if (!me || me.error) return;
            if (_loginInProgress) return;
            if (typeof otomiaPersistUser === "function") otomiaPersistUser(me);
            const target = typeof otomiaAppEntryUrl === "function"
                ? otomiaAppEntryUrl()
                : "index.html?module=dashboard";
            window.location.replace(target);
        })
        .catch((e) => {
            if (e?.name === "AbortError") {
                console.log("[OTOMIA] Session check annulée (login en cours)");
                return;
            }
            logErr("checkExistingSession /me/", e);
        });
}

document.addEventListener("DOMContentLoaded", () => {
    console.log("[LOGIN PAGE]", "origin:", window.location.origin, "| API:", window.OTOMIA_API_BASE);
    applyLoginBranding();

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
            errorEl.textContent = "Accès non autorisé depuis un fichier local. Contactez l'administrateur.";
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
            logErr("login form submit", err);
            errorEl.textContent = err.isNetwork
                ? err.message
                : (err.message || LOGIN_ERROR_MESSAGE);
            errorEl.hidden = false;
            if (typeof otomiaLog === "function") otomiaLog("Login échoué", err.status || err.message);
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
