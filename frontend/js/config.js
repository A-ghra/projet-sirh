/**
 * OTOMIA RH — config API + fetch (CSRF best-effort, login stable)
 */
(function () {
    const apiPort = window.OTOMIA_API_PORT || "8000";

    function detectAppRoot() {
        const scripts = document.getElementsByTagName("script");
        for (let i = 0; i < scripts.length; i++) {
            const src = scripts[i].src;
            if (src && /\/js\/config\.js(\?|$)/.test(src)) {
                return new URL("../", src).href;
            }
        }
        const path = window.location.pathname.replace(/[^/]*$/, "");
        return `${window.location.origin}${path}`;
    }

    function resolveApiBase() {
        if (window.OTOMIA_API_URL) return String(window.OTOMIA_API_URL).replace(/\/$/, "");
        const pageProto = window.location.protocol;
        const pageHost = window.location.hostname;
        if (pageProto === "file:" || !pageHost) {
            return `http://127.0.0.1:${apiPort}/api`;
        }
        return `${pageProto}//${pageHost}:${apiPort}/api`;
    }

    const appRoot = detectAppRoot();
    const apiBase = resolveApiBase();
    const apiHost = apiBase.replace(/\/api\/?$/, "");

    window.OTOMIA_APP_ROOT = appRoot;
    window.OTOMIA_API_BASE = apiBase;
    window.OTOMIA_API_HOST = apiHost;
    window.OTOMIA_DEBUG = window.OTOMIA_DEBUG !== false;

    let _csrfToken = null;
    let _authCheckController = null;

    window.otomiaGetApiBase = () => window.OTOMIA_API_BASE || apiBase;

    window.otomiaIsHttpContext = () =>
        window.location.protocol === "http:" || window.location.protocol === "https:";

    window.otomiaLog = (...args) => {
        if (window.OTOMIA_DEBUG) console.info("[OTOMIA]", ...args);
    };

    window.otomiaUrl = (page) => new URL(page, appRoot).href;

    window.otomiaNavigate = (page, reason) => {
        const url = otomiaUrl(page);
        otomiaLog("Navigation", reason || "", "→", url);
        window.location.replace(url);
    };

    window.otomiaLogout = () => {
        sessionStorage.removeItem("otomia_user");
        window.otomiaNavigate("login.html", "déconnexion");
    };

    window.otomiaPersistUser = (user) => {
        if (user) sessionStorage.setItem("otomia_user", JSON.stringify(user));
    };

    window.otomiaGetStoredUser = () => {
        try {
            const raw = sessionStorage.getItem("otomia_user");
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    };

    window.otomiaResetCsrf = () => { _csrfToken = null; };

    window.otomiaGetCsrf = () => _csrfToken || "";

    /** CSRF best-effort : ne lève jamais d'exception, retourne "" si échec */
    window.otomiaTryCsrf = async function otomiaTryCsrf() {
        if (_csrfToken) return _csrfToken;
        try {
            const r = await fetch(`${apiBase}/csrf/`, {
                method: "GET",
                credentials: "include",
                cache: "no-store",
            });
            if (!r.ok) {
                otomiaLog("CSRF non disponible (HTTP", r.status + ")");
                return "";
            }
            const data = await r.json();
            _csrfToken = data.csrfToken || "";
            return _csrfToken;
        } catch (e) {
            otomiaLog("CSRF best-effort ignoré :", e.message);
            return "";
        }
    };

    window.otomiaEnsureCsrf = window.otomiaTryCsrf;

    window.otomiaFormatFetchError = function otomiaFormatFetchError(err, hint) {
        if (!otomiaIsHttpContext()) {
            return new Error(
                "Ouvrez OTOMIA RH via http://127.0.0.1:5500/login.html (./demarrer-frontend.sh). Le mode fichier local (file://) ne fonctionne pas."
            );
        }
        const msg = err?.message || String(err);
        if (hint === "csrf") {
            return new Error("Jeton CSRF indisponible — vérifiez que Django tourne sur le port 8000.");
        }
        if (err?.name === "TypeError" || /networkerror|failed to fetch/i.test(msg)) {
            return new Error(
                `Connexion réseau impossible vers ${otomiaGetApiBase()}. Démarrez Django : python manage.py runserver 127.0.0.1:8000`
            );
        }
        return err instanceof Error ? err : new Error(msg);
    };

    window.otomiaCancelAuthCheck = () => {
        if (_authCheckController) {
            _authCheckController.abort();
            _authCheckController = null;
        }
    };

    window.otomiaCreateAuthCheck = () => {
        otomiaCancelAuthCheck();
        _authCheckController = new AbortController();
        return _authCheckController;
    };

    const DASHBOARD_MODULE_MAP = {
        "admin-dashboard": "dashboard",
        "rh-dashboard": "dashboard",
        "manager-dashboard": "dashboard",
        "employee-portal": "portail-employe",
    };

    window.otomiaDashboardModule = (user) =>
        DASHBOARD_MODULE_MAP[user?.dashboard] || "dashboard";

    window.otomiaAppEntryUrl = (user) => {
        const url = new URL("index.html", appRoot);
        url.searchParams.set("module", otomiaDashboardModule(user));
        return url.href;
    };

    /**
     * Fetch API — credentials: include, CSRF best-effort (jamais bloquant).
     * options.skipCsrf : true pour forcer l'absence de CSRF
     */
    window.otomiaApiFetch = async function otomiaApiFetch(path, options = {}) {
        const base = otomiaGetApiBase();
        const url = /^https?:\/\//i.test(path)
            ? path
            : `${base}${path.startsWith("/") ? path : `/${path}`}`;
        const method = (options.method || "GET").toUpperCase();
        const headers = { ...(options.headers || {}) };

        let body = options.body;
        if (body != null && typeof body === "object" && !(body instanceof FormData)) {
            if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
            body = JSON.stringify(body);
        }

        if (method !== "GET" && method !== "HEAD" && !options.skipCsrf) {
            const csrf = await otomiaTryCsrf();
            if (csrf) headers["X-CSRFToken"] = csrf;
        }
        if (method === "GET") {
            headers["Cache-Control"] = "no-cache";
            headers["Pragma"] = "no-cache";
        }

        try {
            return await fetch(url, {
                ...options,
                method,
                body,
                credentials: "include",
                cache: method === "GET" ? "no-store" : options.cache,
                headers,
            });
        } catch (err) {
            throw otomiaFormatFetchError(err);
        }
    };

    window.otomiaApiJson = async function otomiaApiJson(path, options = {}) {
        const response = await otomiaApiFetch(path, options);
        const data = response.headers.get("content-type")?.includes("json")
            ? await response.json().catch(() => ({}))
            : null;
        if (!response.ok) {
            const err = new Error(data?.error || data?.detail || `Erreur API ${response.status}`);
            err.status = response.status;
            err.data = data;
            throw err;
        }
        return data;
    };

    /** Diagnostic non bloquant — warning uniquement */
    window.otomiaCheckApiReachable = async function otomiaCheckApiReachable() {
        if (!otomiaIsHttpContext()) {
            return { ok: false, warn: true, message: otomiaFormatFetchError(new TypeError("file")).message };
        }
        try {
            const r = await fetch(`${apiBase}/csrf/`, { credentials: "include", cache: "no-store" });
            if (!r.ok) {
                return { ok: false, warn: true, message: `API répond HTTP ${r.status} — connexion peut quand même fonctionner.` };
            }
            return { ok: true, api: apiBase };
        } catch (e) {
            return { ok: false, warn: true, message: otomiaFormatFetchError(e).message };
        }
    };

    /** Vérifie /me/ — 401 = déconnecté ; erreur réseau = conserve session locale */
    window.otomiaVerifySession = async function otomiaVerifySession() {
        const stored = otomiaGetStoredUser();
        try {
            const response = await otomiaApiFetch("/me/");
            if (response.status === 401) {
                const err = new Error("Session expirée");
                err.status = 401;
                throw err;
            }
            if (!response.ok) {
                otomiaLog("/me/ HTTP", response.status, "— session locale");
                return stored;
            }
            const user = await response.json();
            otomiaPersistUser(user);
            return user;
        } catch (e) {
            if (e.status === 401) throw e;
            otomiaLog("/me/ indisponible — session locale", e.message);
            if (stored) return stored;
            throw e;
        }
    };

    window.otomiaRequireAuth = async function otomiaRequireAuth() {
        const stored = otomiaGetStoredUser();
        if (!stored) {
            const err = new Error("Non authentifié");
            err.status = 401;
            throw err;
        }
        return otomiaVerifySession();
    };

    otomiaLog("API:", apiBase, "| Page:", window.location.href);
})();
