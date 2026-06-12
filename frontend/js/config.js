/**
 * OTOMIA RH — config API (backend Django FIXE : port 8000 uniquement)
 */
(function () {
    const OTOMIA_API_FIXED = "http://127.0.0.1:8000/api";
    const OTOMIA_HOST_FIXED = "http://127.0.0.1:8000";

    function resolveApiBase() {
        return OTOMIA_API_FIXED;
    }

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

    const appRoot = detectAppRoot();

    window.OTOMIA_APP_ROOT = appRoot;
    Object.defineProperty(window, "OTOMIA_API_BASE", {
        value: OTOMIA_API_FIXED,
        writable: false,
        configurable: false,
    });
    Object.defineProperty(window, "OTOMIA_API_FIXED", {
        value: OTOMIA_API_FIXED,
        writable: false,
        configurable: false,
    });
    Object.defineProperty(window, "OTOMIA_API_HOST", {
        value: OTOMIA_HOST_FIXED,
        writable: false,
        configurable: false,
    });
    window.OTOMIA_DEBUG = window.OTOMIA_DEBUG !== false;

    let _csrfToken = null;
    let _authCheckController = null;

    window.otomiaGetApiBase = () => OTOMIA_API_FIXED;
    window.getApiBaseUrl = () => OTOMIA_API_FIXED;
    window.getApiHost = () => OTOMIA_HOST_FIXED;

    window.otomiaIsHttpContext = () =>
        window.location.protocol === "http:" || window.location.protocol === "https:";

    window.otomiaLog = (...args) => {
        if (window.OTOMIA_DEBUG) console.info("[OTOMIA]", ...args);
    };

    window.otomiaLogError = function otomiaLogError(context, err) {
        console.error("[OTOMIA ERROR]", context, {
            name: err?.name,
            message: err?.message,
            status: err?.status,
            stack: err?.stack,
            raw: err,
        });
    };

    /** Parse sécurisé — ne lève jamais sur JSON invalide ou Content-Type text/plain */
    window.otomiaParseResponseBody = async function otomiaParseResponseBody(response) {
        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        let text = "";
        try {
            text = await response.text();
        } catch (e) {
            otomiaLogError("lecture corps réponse", e);
            return { error: true, parseError: true, message: "Impossible de lire la réponse du serveur." };
        }

        const trimmed = text.trim();
        if (!trimmed) {
            return response.ok ? null : { error: true, raw: "", message: `Erreur HTTP ${response.status}` };
        }

        const looksJson = contentType.includes("json")
            || trimmed.startsWith("{")
            || trimmed.startsWith("[");

        if (looksJson) {
            try {
                return JSON.parse(text);
            } catch (e) {
                otomiaLogError(`parse JSON (${contentType || "sans type"})`, e);
                return {
                    error: true,
                    parseError: true,
                    raw: text.slice(0, 2000),
                    message: trimmed.slice(0, 300) || "Réponse serveur illisible.",
                };
            }
        }

        if (!response.ok) {
            return { error: true, raw: text.slice(0, 2000), message: trimmed.slice(0, 300) };
        }

        otomiaLog("Réponse non-JSON (succès)", contentType, trimmed.slice(0, 120));
        return { raw: text, parsed: false };
    };

    window.otomiaFormatValidationErrors = function otomiaFormatValidationErrors(data) {
        if (!data || typeof data !== "object" || Array.isArray(data)) return null;
        const labels = {
            employee: "Employé",
            employee_id: "Employé",
            event_type: "Type d'action",
            date: "Date",
            check_in: "Heure d'entrée",
            check_out: "Heure de sortie",
            absence_type: "Congé",
            start_date: "Date de début",
            end_date: "Date de fin",
            reason: "Motif",
            non_field_errors: "Erreur",
        };
        const parts = [];
        Object.entries(data).forEach(([key, val]) => {
            const label = labels[key] || key;
            if (Array.isArray(val)) parts.push(`${label} : ${val.join(", ")}`);
            else if (typeof val === "string") parts.push(`${label} : ${val}`);
        });
        return parts.length ? parts.join(" — ") : null;
    };

    window.otomiaApiErrorMessage = function otomiaApiErrorMessage(data, status) {
        const fieldMsg = otomiaFormatValidationErrors(data);
        if (fieldMsg) return fieldMsg;
        if (status === 404) {
            return "Service API introuvable (404). Vérifiez que Django tourne sur http://127.0.0.1:8000";
        }
        if (!data) return `Erreur API ${status}`;
        if (typeof data === "string") return data;
        if (data.message) return data.message;
        if (typeof data.error === "string") return data.error;
        if (data.detail) return typeof data.detail === "string" ? data.detail : String(data.detail);
        return `Erreur API ${status}`;
    };

    window.otomiaHandleApiResponse = async function otomiaHandleApiResponse(response, context = "") {
        const data = await otomiaParseResponseBody(response);
        if (!response.ok) {
            const err = new Error(otomiaApiErrorMessage(data, response.status));
            err.status = response.status;
            err.data = data;
            otomiaLogError(context || `API HTTP ${response.status}`, err);
            throw err;
        }
        if (data?.error && data?.parseError) {
            const err = new Error(data.message || "Réponse serveur invalide.");
            err.parseError = true;
            err.data = data;
            otomiaLogError(context || "parse API", err);
            throw err;
        }
        return data;
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

    window.otomiaTryCsrf = async function otomiaTryCsrf() {
        if (_csrfToken) return _csrfToken;
        const csrfUrl = `${OTOMIA_API_FIXED}/csrf/`;
        console.log("[OTOMIA FETCH]", "GET", csrfUrl);
        try {
            const r = await fetch(csrfUrl, {
                method: "GET",
                credentials: "include",
                cache: "no-store",
                headers: { Accept: "application/json" },
            });
            console.log("[OTOMIA FETCH]", "GET", csrfUrl, "→", r.status);
            if (!r.ok) {
                otomiaLog("CSRF non disponible (HTTP", r.status + ")");
                return "";
            }
            const data = await otomiaParseResponseBody(r);
            _csrfToken = data?.csrfToken || "";
            return _csrfToken;
        } catch (e) {
            otomiaLogError("CSRF /csrf/", e);
            otomiaLog("CSRF best-effort ignoré :", e.message);
            return "";
        }
    };

    window.otomiaEnsureCsrf = window.otomiaTryCsrf;

    /** Vrai échec réseau/CORS — pas une erreur HTTP ou de parsing déjà reçue */
    window.otomiaIsNetworkFetchError = function otomiaIsNetworkFetchError(err) {
        if (!err) return false;
        if (err.status != null || err.response != null || err.parseError) return false;
        const msg = err?.message || String(err);
        return err?.name === "TypeError" && /failed to fetch|networkerror|load failed/i.test(msg);
    };

    window.otomiaFormatFetchError = function otomiaFormatFetchError(err, hint) {
        if (!otomiaIsHttpContext()) {
            return new Error(
                "Ouvrez OTOMIA RH via le serveur frontend (./demarrer-frontend.sh). Le mode fichier local (file://) ne fonctionne pas."
            );
        }
        const msg = err?.message || String(err);
        if (hint === "csrf") {
            return new Error("Jeton CSRF indisponible — vérifiez que Django tourne sur http://127.0.0.1:8000");
        }
        if (err?.status != null || err?.parseError) {
            return err instanceof Error ? err : new Error(msg);
        }
        if (otomiaIsNetworkFetchError(err)) {
            otomiaLogError("otomiaFormatFetchError réseau/CORS", err);
            const origin = window.location.origin;
            const originHint = origin.includes(":5500") ? "" : ` (frontend: ${origin})`;
            return new Error(
                `Connexion impossible vers ${OTOMIA_API_FIXED}${originHint}. Vérifiez que Django tourne : python manage.py runserver 127.0.0.1:8000`
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

    window.otomiaDashboardModule = () => "dashboard";

    window.otomiaAppEntryUrl = () => {
        const url = new URL("index.html", appRoot);
        url.searchParams.set("module", "dashboard");
        return url.href;
    };

    window.otomiaNormalizeApiPath = function otomiaNormalizeApiPath(path) {
        if (!path || /^https?:\/\//i.test(path)) return path;
        const qIndex = path.indexOf("?");
        const pathname = qIndex >= 0 ? path.slice(0, qIndex) : path;
        const query = qIndex >= 0 ? path.slice(qIndex) : "";
        let normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
        if (!normalized.endsWith("/")) normalized += "/";
        return `${normalized}${query}`;
    };

    window.otomiaApiFetch = async function otomiaApiFetch(path, options = {}) {
        const apiPath = otomiaNormalizeApiPath(path);
        const url = /^https?:\/\//i.test(apiPath)
            ? apiPath
            : `${OTOMIA_API_FIXED}${apiPath.startsWith("/") ? apiPath : `/${apiPath}`}`;
        const method = (options.method || "GET").toUpperCase();
        const headers = { ...(options.headers || {}) };

        let body = options.body;
        if (body != null && !(body instanceof FormData)) {
            if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
            if (typeof body === "object") body = JSON.stringify(body);
        }

        if (method !== "GET" && method !== "HEAD" && !options.skipCsrf) {
            const csrf = await otomiaTryCsrf();
            if (csrf) headers["X-CSRFToken"] = csrf;
        }
        if (method === "GET") {
            headers["Cache-Control"] = "no-cache";
            headers["Pragma"] = "no-cache";
        }
        if (!headers["Accept"]) headers["Accept"] = "application/json";
        if (!headers["X-Requested-With"]) headers["X-Requested-With"] = "XMLHttpRequest";

        console.log("[OTOMIA FETCH]", method, url);
        try {
            const { headers: _ignoredHeaders, credentials: _ignoredCreds, ...fetchOpts } = options;
            const response = await fetch(url, {
                ...fetchOpts,
                method,
                body,
                credentials: "include",
                cache: method === "GET" ? "no-store" : options.cache,
                headers,
            });
            console.log("[OTOMIA FETCH]", method, url, "→", response.status);
            return response;
        } catch (err) {
            otomiaLogError(`fetch ${method} ${url}`, err);
            throw otomiaFormatFetchError(err);
        }
    };

    window.otomiaApiJson = async function otomiaApiJson(path, options = {}) {
        const response = await otomiaApiFetch(path, options);
        return otomiaHandleApiResponse(response, `otomiaApiJson ${path}`);
    };

    window.otomiaCheckApiReachable = async function otomiaCheckApiReachable() {
        if (!otomiaIsHttpContext()) {
            return { ok: false, warn: true, message: otomiaFormatFetchError(new TypeError("file")).message };
        }
        try {
            const r = await fetch(`${OTOMIA_API_FIXED}/csrf/`, {
                credentials: "include",
                cache: "no-store",
                headers: { Accept: "application/json" },
            });
            if (!r.ok) {
                return { ok: false, warn: true, message: `API répond HTTP ${r.status} sur ${OTOMIA_API_FIXED}` };
            }
            return { ok: true, api: OTOMIA_API_FIXED };
        } catch (e) {
            return { ok: false, warn: true, message: otomiaFormatFetchError(e).message };
        }
    };

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
            const user = await otomiaParseResponseBody(response);
            if (user?.error) {
                otomiaLog("/me/ corps invalide — session locale");
                return stored;
            }
            otomiaPersistUser(user);
            return user;
        } catch (e) {
            if (e.status === 401) throw e;
            if (e.parseError) throw e;
            if (otomiaIsNetworkFetchError(e)) {
                otomiaLog("/me/ réseau/CORS — session locale", e.message);
            } else {
                otomiaLog("/me/ indisponible — session locale", e.message);
            }
            if (stored) return stored;
            throw otomiaFormatFetchError(e);
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

    window.addEventListener("unhandledrejection", (event) => {
        const msg = event.reason?.message || String(event.reason || "");
        if (/json|média|media type|unexpected token/i.test(msg)) {
            otomiaLogError("unhandledrejection (parse API)", event.reason);
            if (typeof showToast === "function") {
                showToast("Erreur de lecture des données serveur.", "error", 5000);
            }
            event.preventDefault();
        }
    });

    window.addEventListener("error", (event) => {
        const msg = event.message || "";
        if (/insertBefore|removeChild|not a child of this node/i.test(msg)) {
            otomiaLogError("DOM error", { message: msg, filename: event.filename, lineno: event.lineno });
            event.preventDefault();
        }
    });

    console.log("OTOMIA_API_FIXED :", window.OTOMIA_API_FIXED);
    console.log("OTOMIA API :", window.OTOMIA_API_BASE);
    otomiaLog("API:", OTOMIA_API_FIXED, "| Page:", window.location.href);
})();
