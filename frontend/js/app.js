const API_BASE_URL = window.OTOMIA_API_BASE
    || window.OTOMIA_API_URL
    || `${location.protocol}//${location.hostname}:8000/api`;
const API_HOST = window.OTOMIA_API_HOST || API_BASE_URL.replace(/\/api\/?$/, "");
let currentUser = null;
let contentArea = null;
let deptChart = null;
let genderChart = null;
let moduleConfig = null;
let customizationModules = [];
let selectedCustomizationModuleId = null;

const FIELD_TYPE_OPTIONS = [
    ["text", "Texte"], ["textarea", "Zone de texte"], ["number", "Nombre"],
    ["email", "Email"], ["phone", "Téléphone"], ["date", "Date"], ["time", "Heure"],
    ["select", "Liste déroulante"], ["checkbox", "Case à cocher"], ["radio", "Bouton radio"],
    ["file", "Fichier"], ["image", "Image"],
];
const FEATURE_TYPE_OPTIONS = [
    ["general", "Générale"], ["menu_tab", "Onglet / Menu"],
    ["payroll_gain", "Gain de paie"], ["payroll_retention", "Retenue de paie"],
    ["recruitment_step", "Étape recrutement"], ["training_type", "Type formation"],
    ["portal_section", "Section portail"], ["leave_type", "Type de congé"],
    ["kpi_indicator", "Indicateur KPI"], ["evaluation_method", "Méthode d'évaluation"],
    ["report_widget", "Widget reporting"],
];
let reportCharts = [];

async function loadModuleConfig() {
    try {
        moduleConfig = await apiGet("/module-config/");
    } catch (e) {
        moduleConfig = { modules: [] };
    }
}

function getModuleByKey(key) {
    return moduleConfig?.modules?.find((m) => m.key === key);
}

function canAccessModule(moduleKey, action = "read") {
    if (!currentUser) return false;
    if (["SUPER_ADMIN", "ADMIN_RH"].includes(currentUser.role)) return true;
    const mod = getModuleByKey(moduleKey);
    if (mod && !mod.is_active) return false;
    const perms = currentUser.permissions?.[moduleKey];
    if (perms) return action === "write" ? !!perms.write : !!perms.read;
    const roles = mod?.allowed_roles?.split(",") || [];
    return roles.includes(currentUser.role);
}

function canAccessDashboard() {
    return canAccessModule("dashboard", "read") || currentUser?.role === "EMPLOYE";
}

function canWriteModule(moduleKey) {
    return canAccessModule(moduleKey, "write");
}

function getActiveFeatures(moduleKey, featureType) {
    const mod = getModuleByKey(moduleKey);
    if (!mod?.features?.length) return [];
    return mod.features
        .filter((f) => {
            if (!f.is_active) return false;
            if (featureType && f.feature_type !== featureType) return false;
            const roles = f.config?.allowed_roles;
            if (roles?.length && currentUser?.role && !roles.includes(currentUser.role)) return false;
            return true;
        })
        .sort((a, b) => a.display_order - b.display_order);
}

function getModuleTitle(moduleKey, fallback) {
    return getModuleByKey(moduleKey)?.name || fallback;
}

function animateCounter(el, end, opts = {}) {
    if (!el) return;
    const duration = opts.duration || 900;
    const suffix = opts.suffix || "";
    const isMoney = opts.format === "money";
    const start = 0;
    const startTime = performance.now();
    const step = (now) => {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const val = start + (end - start) * eased;
        el.textContent = isMoney ? formatMoney(val) : `${Math.round(val)}${suffix}`;
        if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

function destroyReportCharts() {
    reportCharts.forEach((c) => c.destroy());
    reportCharts = [];
}

function renderModuleTabsHtml(tabs, containerId) {
    if (!tabs.length) return "";
    return `<div class="module-tabs" id="${containerId}">${tabs.map((t, i) =>
        `<button class="module-tab ${i === 0 ? "active" : ""}" data-tab="${t.feature_key}">
            ${t.icon ? `<i class="fas ${t.icon}"></i> ` : ""}${t.feature_name}
        </button>`).join("")}</div>`;
}

function bindModuleTabs(containerId, onSwitch) {
    document.querySelectorAll(`#${containerId} .module-tab`).forEach((tab) => {
        tab.onclick = () => {
            document.querySelectorAll(`#${containerId} .module-tab`).forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");
            onSwitch(tab.dataset.tab);
        };
    });
}

function getVisibleCustomFields(moduleKey) {
    const mod = getModuleByKey(moduleKey);
    if (!mod?.custom_fields?.length) return [];
    return mod.custom_fields
        .filter((f) => f.visible)
        .sort((a, b) => a.display_order - b.display_order);
}

function renderCustomFieldInput(field, value, prefix = "cf") {
    const id = `${prefix}-${field.field_key}`;
    const val = (value ?? field.default_value ?? "").toString().replace(/"/g, "&quot;");
    const ro = field.editable ? "" : "readonly";
    if (field.field_type === "textarea") {
        return `<div><label>${field.field_name}${field.required ? " *" : ""}</label><textarea id="${id}" rows="2" ${ro}>${value ?? field.default_value ?? ""}</textarea></div>`;
    }
    if (field.field_type === "select" || field.field_type === "radio") {
        const opts = (field.options || []).map((o) =>
            `<option value="${o}" ${val === o ? "selected" : ""}>${o}</option>`).join("");
        return `<div><label>${field.field_name}${field.required ? " *" : ""}</label><select id="${id}" ${ro}>${opts}</select></div>`;
    }
    if (field.field_type === "checkbox") {
        const checked = val === "true" || val === "1" ? "checked" : "";
        return `<div><label><input type="checkbox" id="${id}" ${checked} ${ro}> ${field.field_name}</label></div>`;
    }
    const type = { number: "number", email: "email", phone: "tel", date: "date", time: "time", file: "file", image: "file" }[field.field_type] || "text";
    return `<div><label>${field.field_name}${field.required ? " *" : ""}</label><input type="${type}" id="${id}" value="${val}" ${ro}></div>`;
}

function collectCustomFieldValues(moduleKey, prefix = "cf") {
    const data = {};
    getVisibleCustomFields(moduleKey).forEach((field) => {
        const el = document.getElementById(`${prefix}-${field.field_key}`);
        if (!el) return;
        data[field.field_key] = el.type === "checkbox" ? el.checked : el.value;
    });
    return data;
}

async function ensureCsrf() {
    if (typeof window.otomiaTryCsrf === "function") {
        return window.otomiaTryCsrf();
    }
    try {
        const r = await fetch(`${API_BASE_URL}/csrf/`, { credentials: "include" });
        if (!r.ok) return "";
        const data = await r.json();
        return data.csrfToken || "";
    } catch (e) {
        return "";
    }
}

async function getCsrfToken() {
    if (typeof window.otomiaGetCsrf === "function" && window.otomiaGetCsrf()) {
        return window.otomiaGetCsrf();
    }
    return ensureCsrf();
}

async function apiFetch(path, options = {}) {
    if (typeof window.otomiaApiFetch === "function") {
        const response = await window.otomiaApiFetch(path, options);
        if (response.status === 401) {
            sessionStorage.removeItem("otomia_user");
            sessionStorage.removeItem("otomia_fresh_login");
            if (typeof otomiaNavigate === "function") otomiaNavigate("login.html", "session expirée");
            else window.location.replace("login.html");
            throw new Error("Session expirée");
        }
        const data = response.headers.get("content-type")?.includes("json")
            ? await response.json()
            : null;
        if (!response.ok) throw new Error(data?.error || data?.detail || `Erreur ${response.status}`);
        return data;
    }

    const headers = { ...(options.headers || {}) };
    if (options.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }
    if (options.method && options.method !== "GET") {
        headers["X-CSRFToken"] = await getCsrfToken();
    }
    const method = (options.method || "GET").toUpperCase();
    let response;
    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            credentials: "include",
            cache: method === "GET" ? "no-store" : options.cache,
            ...options,
            headers: method === "GET"
                ? { "Cache-Control": "no-cache", Pragma: "no-cache", ...headers }
                : headers,
        });
    } catch (err) {
        throw typeof otomiaFormatFetchError === "function" ? otomiaFormatFetchError(err) : err;
    }
    if (response.status === 401) {
        sessionStorage.removeItem("otomia_user");
        sessionStorage.removeItem("otomia_fresh_login");
        if (typeof otomiaNavigate === "function") otomiaNavigate("login.html", "session expirée");
        else window.location.replace("login.html");
        throw new Error("Session expirée");
    }
    const data = response.headers.get("content-type")?.includes("json")
        ? await response.json()
        : null;
    if (!response.ok) throw new Error(data?.error || data?.detail || `Erreur ${response.status}`);
    return data;
}

const apiGet = (path) => apiFetch(path, { cache: "no-store" });
const apiPost = (path, data) => apiFetch(path, { method: "POST", body: JSON.stringify(data) });

/** Télécharge un blob via fetch (contourne les limites cross-origin du attribut download). */
async function downloadBlobFromResponse(response, fallbackName) {
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^";\n]+)"?/i);
    const filename = match ? match[1] : fallbackName;
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
    return filename;
}

/** Fallback : ouvre l'URL de téléchargement (session cookie envoyé par le navigateur). */
function openIndividualDownloadUrl(employeeId, month, year, format = "pdf") {
    const qs = `employee_id=${encodeURIComponent(employeeId)}&month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}&export_format=${encodeURIComponent(format)}`;
    const url = `${API_BASE_URL}/payroll/export-individual/download/?${qs}`;
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
}

/** Export individuel — téléchargement direct depuis l'API Django (un employé = un fichier). */
async function downloadIndividualPayslip(employeeId, month, year, format = "pdf") {
    console.debug("[OTOMIA] Export individuel download", { employeeId, month, year, format });
    const qs = `employee_id=${encodeURIComponent(employeeId)}&month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}&export_format=${encodeURIComponent(format)}`;
    const response = await fetch(`${API_BASE_URL}/payroll/export-individual/download/?${qs}`, {
        credentials: "include",
    });
    if (response.status === 401) {
        sessionStorage.removeItem("otomia_user");
        sessionStorage.removeItem("otomia_fresh_login");
        if (typeof otomiaNavigate === "function") otomiaNavigate("login.html", "session expirée export");
        else window.location.replace("login.html");
        throw new Error("Session expirée — reconnectez-vous.");
    }
    if (!response.ok) {
        const err = response.headers.get("content-type")?.includes("json") ? await response.json() : null;
        const msg = err?.error || err?.detail || `Erreur export (${response.status})`;
        if (response.status === 403) throw new Error(msg || "Accès refusé — rôle insuffisant pour l'export individuel.");
        throw new Error(msg);
    }
    const exportType = response.headers.get("X-Export-Type");
    if (exportType && exportType !== "individual") {
        throw new Error("Erreur : export global détecté au lieu d'un bulletin individuel.");
    }
    const ext = format === "excel" ? "xlsx" : format === "word" ? "docx" : "pdf";
    try {
        return await downloadBlobFromResponse(response, `BULLETIN_PAIE.${ext}`);
    } catch (blobErr) {
        console.warn("[OTOMIA] Blob download failed, fallback URL", blobErr);
        openIndividualDownloadUrl(employeeId, month, year, format);
        return `BULLETIN_PAIE.${ext}`;
    }
}
const apiPut = (path, data) => apiFetch(path, { method: "PUT", body: JSON.stringify(data) });
const apiDelete = (path) => apiFetch(path, { method: "DELETE" });

async function apiFormPost(path, formData) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRFToken": await getCsrfToken() },
        body: formData,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
    return data;
}

async function applyCompanyBranding() {
    try {
        const c = await apiGet("/company-settings/");
        document.querySelectorAll(".brand-name, .topbar-brand").forEach((el) => {
            el.textContent = c.company_acronym || "OTOMIA RH";
        });
        document.querySelectorAll(".brand-slogan").forEach((el) => {
            el.textContent = c.company_slogan || "";
        });
        if (c.logo_display_url) {
            const logoUrl = c.logo_display_url.startsWith("http") ? c.logo_display_url : `${API_HOST}${c.logo_display_url}`;
            document.querySelectorAll(".sidebar-header .brand-logo i").forEach((icon) => {
                const img = document.createElement("img");
                img.src = logoUrl;
                img.style.cssText = "width:36px;height:36px;object-fit:contain;border-radius:4px;";
                img.alt = "Logo";
                icon.replaceWith(img);
            });
        }
    } catch (e) { /* ignore */ }
}

function statusBadge(status) {
    const map = {
        DRAFT: "badge-draft", PENDING: "badge-pending", VALIDATED: "badge-validated",
        PAID: "badge-paid", ARCHIVED: "badge-archived",
        Pending: "badge-pending", Approved: "badge-approved", Rejected: "badge-rejected",
    };
    const labels = { DRAFT: "Brouillon", PENDING: "En attente", VALIDATED: "Validé", PAID: "Payé", ARCHIVED: "Archivé" };
    return `<span class="badge-status ${map[status] || ""}">${labels[status] || status}</span>`;
}

function formatMoney(v, currency = "USD") {
    const sym = currency === "CDF" ? "CDF" : "$";
    return `${Number(v).toLocaleString("fr-FR")} ${sym}`;
}

document.addEventListener("DOMContentLoaded", async () => {
    if (typeof otomiaLog === "function") {
        otomiaLog("Chargement app", window.location.href, "| root:", window.OTOMIA_APP_ROOT);
    }

    const redirectToLogin = (reason) => {
        sessionStorage.removeItem("otomia_user");
        sessionStorage.removeItem("otomia_fresh_login");
        if (typeof otomiaNavigate === "function") otomiaNavigate("login.html", reason);
        else window.location.replace("login.html");
    };

    try {
        if (typeof otomiaRequireAuth === "function") {
            currentUser = await otomiaRequireAuth();
        } else {
            const stored = sessionStorage.getItem("otomia_user");
            if (!stored) {
                redirectToLogin("non authentifié");
                return;
            }
            currentUser = JSON.parse(stored);
            try {
                currentUser = await apiGet("/me/");
                sessionStorage.setItem("otomia_user", JSON.stringify(currentUser));
            } catch (meErr) {
                if (meErr.message === "Session expirée") throw meErr;
                otomiaLog?.("/me/ indisponible, session locale conservée", meErr.message);
            }
        }
        if (typeof otomiaLog === "function") {
            otomiaLog("Utilisateur", currentUser.role, currentUser.username);
        }
    } catch (e) {
        if (typeof otomiaLog === "function") otomiaLog("Auth échec", e.message);
        if (e.status === 401 || e.message === "Session expirée" || e.message === "Non authentifié") {
            redirectToLogin("session invalide");
        }
        return;
    }

    contentArea = document.getElementById("content-area");
    try {
        setupUI();
        await loadModuleConfig();
        applyCompanyBranding();
        applyRoleMenu();
        loadHomeModule();
        if (typeof otomiaLog === "function") {
            otomiaLog("Module d'accueil chargé", getHomeModule(), "pour", currentUser.role);
        }
    } catch (err) {
        console.error("Init OTOMIA RH:", err);
        contentArea.innerHTML = `<div class="panel"><h2>Impossible de charger la page demandée</h2>
            <p class="error-message">${err.message || err}</p>
            <p>Vérifiez que le backend Django tourne sur <strong>${API_HOST}</strong>.</p>
            <button class="btn btn-primary" onclick="otomiaLogout()">Retour connexion</button></div>`;
    }
});

function resolveHomeModuleKey(moduleKey) {
    if (!moduleKey) return null;
    if (moduleKey === "dashboard") return canAccessDashboard() ? "dashboard" : null;
    return canAccessModule(moduleKey, "read") ? moduleKey : null;
}

function getHomeModule() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("module");
    const fromUrlResolved = resolveHomeModuleKey(fromUrl);
    if (fromUrlResolved) return fromUrlResolved;

    const fromDashboard = typeof otomiaDashboardModule === "function"
        ? otomiaDashboardModule(currentUser)
        : null;
    const fromDashboardResolved = resolveHomeModuleKey(fromDashboard);
    if (fromDashboardResolved) return fromDashboardResolved;

    if (canAccessDashboard()) return "dashboard";
    if (canAccessModule("portail-employe", "read")) return "portail-employe";
    const firstVisible = [...document.querySelectorAll(".sidebar-nav li[data-target]")]
        .find((item) => item.style.display !== "none" && canAccessModule(item.dataset.target, "read"));
    return firstVisible?.dataset?.target || "dashboard";
}

function activateSidebarModule(moduleKey) {
    document.querySelectorAll(".sidebar-nav li[data-target]").forEach((item) => {
        item.classList.toggle("active", item.getAttribute("data-target") === moduleKey);
    });
}

function loadHomeModule() {
    const home = getHomeModule();
    activateSidebarModule(home);
    loadModule(home);
}

function setupUI() {
    document.getElementById("user-name").textContent = currentUser.employee_name || currentUser.username;
    document.getElementById("user-role").textContent = currentUser.role_label;
    document.getElementById("user-avatar").src =
        `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.username)}&background=1a5f9e&color=fff`;

    const sidebar = document.getElementById("sidebar");
    const toggleBtn = document.getElementById("toggle-sidebar");
    const mainContent = document.querySelector(".main-content");
    toggleBtn.addEventListener("click", () => {
        if (window.innerWidth <= 768) sidebar.classList.toggle("active");
        else { sidebar.classList.toggle("collapsed"); mainContent.classList.toggle("expanded"); }
    });

    document.querySelectorAll(".sidebar-nav li[data-target]").forEach((item) => {
        item.addEventListener("click", () => {
            loadModule(item.getAttribute("data-target"));
            if (window.innerWidth <= 768) sidebar.classList.remove("active");
        });
    });

    document.getElementById("logout-btn").addEventListener("click", async () => {
        try { await apiPost("/logout/", {}); } catch (e) { /* ignore */ }
        if (typeof otomiaLogout === "function") otomiaLogout();
        else {
            sessionStorage.removeItem("otomia_user");
            window.location.replace("login.html");
        }
    });
}

function applyRoleMenu() {
    document.querySelectorAll(".sidebar-nav li[data-roles]").forEach((item) => {
        const key = item.getAttribute("data-target");
        const mod = key ? getModuleByKey(key) : null;
        const roleOk = key === "dashboard" ? canAccessDashboard() : (key ? canAccessModule(key, "read") : true);
        const moduleOk = !mod || mod.is_active;
        item.style.display = roleOk && moduleOk ? "flex" : "none";
        if (mod && roleOk && moduleOk) {
            const label = item.querySelector("span");
            if (label) label.textContent = mod.name;
            const icon = item.querySelector("i");
            if (icon && mod.icon) icon.className = `fas ${mod.icon}`;
        }
    });
    if (moduleConfig?.modules?.length) {
        const nav = document.querySelector(".sidebar-nav");
        const items = [...nav.querySelectorAll("li[data-target]")];
        const orderMap = Object.fromEntries(moduleConfig.modules.map((m) => [m.key, m.display_order]));
        items.sort((a, b) => (orderMap[a.dataset.target] ?? 99) - (orderMap[b.dataset.target] ?? 99));
        items.forEach((el) => nav.insertBefore(el, document.getElementById("logout-btn")));
    }
}

function loadModule(name, options = {}) {
    const allowed = name === "dashboard" ? canAccessDashboard() : canAccessModule(name, "read");
    if (name !== "parametres" && !allowed) {
        contentArea.innerHTML = `<p class="error-message">Accès non autorisé à ce module.</p>`;
        return;
    }
    activateSidebarModule(name);
    if (!options.skipLoader) {
        contentArea.innerHTML = `<div class="loader"><i class="fas fa-spinner fa-spin"></i> Chargement...</div>`;
    }
    const modules = {
        dashboard: renderDashboard,
        "admin-personnel": renderAdminPersonnel,
        paie: renderPaie,
        presences: renderPresences,
        recrutement: renderRecrutement,
        formation: renderFormation,
        performances: renderPerformances,
        "portail-employe": renderPortailEmploye,
        reporting: renderReporting,
        parametres: renderParametres,
    };
    (modules[name] || (() => { contentArea.innerHTML = "<p>Module introuvable.</p>"; }))();
    if (typeof otomiaStartPolling === "function") otomiaStartPolling(name);
}

// --- Dashboard ---
const DASHBOARD_SECTIONS = {
    rh: {
        title: "Ressources Humaines",
        icon: "fa-users",
        cards: [
            { id: "kpi-rh-total", label: "Effectif total", icon: "fa-users" },
            { id: "kpi-rh-active", label: "Employés actifs", icon: "fa-user-check" },
            { id: "kpi-rh-hires", label: "Recrutements ouverts", icon: "fa-user-plus" },
            { id: "kpi-rh-contracts", label: "Contrats à échéance", icon: "fa-file-contract" },
        ],
    },
    payroll: {
        title: "Gestion de la Paie",
        icon: "fa-money-check-alt",
        cards: [
            { id: "kpi-pay-bulletins", label: "Bulletins générés", icon: "fa-file-invoice-dollar" },
            { id: "kpi-pay-mass", label: "Masse salariale", icon: "fa-coins" },
            { id: "kpi-pay-pending", label: "Paies en attente", icon: "fa-hourglass-half" },
            { id: "kpi-pay-exports", label: "Exportations effectuées", icon: "fa-file-export" },
        ],
    },
    presences: {
        title: "Présences & Congés",
        icon: "fa-calendar-check",
        cards: [
            { id: "kpi-pres-present", label: "Présences du jour", icon: "fa-user-check" },
            { id: "kpi-pres-absent", label: "Employés absents", icon: "fa-user-times" },
            { id: "kpi-pres-leaves", label: "Congés en cours", icon: "fa-umbrella-beach" },
            { id: "kpi-pres-late", label: "Retards enregistrés", icon: "fa-clock" },
        ],
    },
    recruitment: {
        title: "Recrutement",
        icon: "fa-user-plus",
        cards: [
            { id: "kpi-rec-applicants", label: "Candidatures reçues", icon: "fa-inbox" },
            { id: "kpi-rec-interviews", label: "Entretiens programmés", icon: "fa-calendar-alt" },
            { id: "kpi-rec-accepted", label: "Candidats acceptés", icon: "fa-thumbs-up" },
            { id: "kpi-rec-rejected", label: "Candidats refusés", icon: "fa-thumbs-down" },
        ],
    },
    formation: {
        title: "Formation",
        icon: "fa-graduation-cap",
        cards: [
            { id: "kpi-form-progress", label: "Formations en cours", icon: "fa-chalkboard-teacher" },
            { id: "kpi-form-done", label: "Formations terminées", icon: "fa-certificate" },
            { id: "kpi-form-participants", label: "Participants inscrits", icon: "fa-users" },
            { id: "kpi-form-results", label: "Résultats enregistrés", icon: "fa-clipboard-check" },
        ],
    },
    performance: {
        title: "Performances",
        icon: "fa-star",
        cards: [
            { id: "kpi-perf-reviews", label: "Évaluations réalisées", icon: "fa-star-half-alt" },
            { id: "kpi-perf-objectives", label: "Objectifs atteints", icon: "fa-bullseye" },
            { id: "kpi-perf-kpis", label: "KPI suivis", icon: "fa-chart-line" },
            { id: "kpi-perf-avg", label: "Moyenne performances", icon: "fa-percentage" },
        ],
    },
    manager: {
        title: "Équipe & Management",
        icon: "fa-sitemap",
        cards: [
            { id: "kpi-mgr-team", label: "Équipe supervisée", icon: "fa-users" },
            { id: "kpi-mgr-pending", label: "Congés à valider", icon: "fa-clipboard-list" },
            { id: "kpi-mgr-reviews", label: "Évaluations", icon: "fa-star" },
            { id: "kpi-mgr-objectives", label: "Objectifs en cours", icon: "fa-flag" },
        ],
    },
    employee: {
        title: "Mon espace",
        icon: "fa-user-circle",
        cards: [
            { id: "kpi-emp-payslips", label: "Mes bulletins", icon: "fa-file-invoice-dollar" },
            { id: "kpi-emp-leaves", label: "Mes congés", icon: "fa-umbrella-beach" },
            { id: "kpi-emp-trainings", label: "Mes formations", icon: "fa-graduation-cap" },
            { id: "kpi-emp-reviews", label: "Mes évaluations", icon: "fa-star" },
            { id: "kpi-emp-objectives", label: "Mes objectifs", icon: "fa-bullseye" },
        ],
    },
};

function getDashboardSectionsForRole() {
    const role = currentUser?.role || "";
    if (["SUPER_ADMIN", "ADMIN_RH", "GESTIONNAIRE_RH"].includes(role)) {
        return ["rh", "payroll", "presences", "recruitment", "formation", "performance"];
    }
    if (role === "GESTIONNAIRE_PAIE") return ["payroll"];
    if (role === "RESPONSABLE_HIERARCHIQUE") return ["manager", "presences", "performance"];
    if (role === "EMPLOYE") return ["employee"];
    return ["rh"];
}

function renderDashboardSectionHtml(sectionKey) {
    const section = DASHBOARD_SECTIONS[sectionKey];
    if (!section) return "";
    const cards = section.cards.map((c) =>
        `<div class="stat-card"><i class="fas ${c.icon}"></i><div class="stat-info"><h3>${c.label}</h3><p id="${c.id}">--</p></div></div>`
    ).join("");
    return `<div class="dashboard-section panel"><h2><i class="fas ${section.icon}"></i> ${section.title}</h2><div class="dashboard-grid">${cards}</div></div>`;
}

function renderDashboardShortcuts() {
    const role = currentUser?.role || "";
    const shortcuts = [];
    if (canAccessModule("admin-personnel", "write")) shortcuts.push({ module: "admin-personnel", label: "Ajouter un employé", icon: "fa-user-plus" });
    if (canAccessModule("paie", "read")) shortcuts.push({ module: "paie", label: "Gestion de la paie", icon: "fa-money-check-alt" });
    if (canAccessModule("presences", "read")) shortcuts.push({ module: "presences", label: "Présences & congés", icon: "fa-calendar-check" });
    if (canAccessModule("recrutement", "read")) shortcuts.push({ module: "recrutement", label: "Recrutement", icon: "fa-user-plus" });
    if (canAccessModule("formation", "read")) shortcuts.push({ module: "formation", label: "Formation", icon: "fa-graduation-cap" });
    if (canAccessModule("performances", "read")) shortcuts.push({ module: "performances", label: "Performances", icon: "fa-star" });
    if (role === "GESTIONNAIRE_PAIE") shortcuts.push({ module: "paie", label: "Exporter les bulletins", icon: "fa-file-export" });
    if (role === "EMPLOYE") {
        shortcuts.push({ module: "portail-employe", label: "Mon portail", icon: "fa-user-circle" });
        if (canAccessModule("presences", "read")) shortcuts.push({ module: "presences", label: "Demander un congé", icon: "fa-umbrella-beach" });
    }
    if (!shortcuts.length) return "";
    return `<div class="dashboard-shortcuts panel"><h2><i class="fas fa-bolt"></i> Raccourcis</h2><div class="shortcut-grid">${
        shortcuts.map((s) => `<button type="button" class="btn btn-secondary shortcut-btn" onclick="loadModule('${s.module}')"><i class="fas ${s.icon}"></i> ${s.label}</button>`).join("")
    }</div></div>`;
}

async function renderDashboard() {
    const sections = getDashboardSectionsForRole();
    const role = currentUser?.role || "";
    const showCharts = ["SUPER_ADMIN", "ADMIN_RH", "GESTIONNAIRE_RH"].includes(role);
    const showActivities = role !== "EMPLOYE";
    contentArea.innerHTML = `
        <div class="page-header">
            <h1>Tableau de bord</h1>
            <p>Vue d'ensemble — ${currentUser.role_label || currentUser.role}</p>
        </div>
        <div id="dashboard-alerts" class="dashboard-alerts"></div>
        ${renderDashboardShortcuts()}
        ${sections.map(renderDashboardSectionHtml).join("")}
        ${showCharts ? `
        <div class="charts-grid">
            <div class="chart-card"><h3>Répartition par département</h3><canvas id="dept-chart"></canvas></div>
            <div class="chart-card"><h3>Répartition H/F</h3><canvas id="gender-chart"></canvas></div>
        </div>` : ""}
        ${showActivities ? `<div class="recent-activities panel">
            <h2><i class="fas fa-history"></i> Activités récentes</h2>
            <table><thead><tr><th>Action</th><th>Module</th><th>Utilisateur</th><th>Date</th></tr></thead>
            <tbody id="activities-body"><tr><td colspan="4"><i class="fas fa-spinner fa-spin"></i> Chargement...</td></tr></tbody></table>
        </div>` : ""}`;
    try {
        await refreshDashboardData();
    } catch (e) { contentArea.innerHTML += `<p class="error-message">${e.message}</p>`; }
}

// --- Admin Personnel ---
async function renderAdminPersonnel() {
    contentArea.innerHTML = `
        <div class="module-container">
            <div class="action-bar">
                <h2>Gestion Administrative du Personnel</h2>
                <button class="btn btn-primary" onclick="showAddEmployee()"><i class="fas fa-plus"></i> Ajouter</button>
            </div>
            <table><thead><tr><th>Matricule</th><th>Nom</th><th>Poste</th><th>Département</th><th>Salaire</th><th>Statut</th><th>Actions</th></tr></thead>
            <tbody id="emp-list"></tbody></table>
        </div>
        <div class="panel" id="add-emp-form" hidden>
            <h3>Nouvel employé</h3>
            <div class="form-row">
                <input id="new-matricule" placeholder="Matricule">
                <input id="new-name" placeholder="Nom complet">
                <input id="new-position" placeholder="Poste">
                <input id="new-salary" type="number" placeholder="Salaire base">
                <input id="new-email" placeholder="Email">
            </div>
            <div class="form-row" id="emp-custom-fields"></div>
            <button class="btn btn-primary" onclick="saveEmployee()">Enregistrer</button>
        </div>`;
    document.getElementById("emp-custom-fields").innerHTML =
        getVisibleCustomFields("admin-personnel").map((f) => renderCustomFieldInput(f, "", "new")).join("");
    await loadEmployees();
}

async function loadEmployees() {
    try {
        const emps = await apiGet("/employees/");
        document.getElementById("emp-list").innerHTML = emps.map((e) => `
            <tr>
                <td>${e.matricule}</td><td>${e.full_name}</td><td>${e.position}</td>
                <td>${e.department_name || "-"}</td><td>${formatMoney(e.salary_base)}</td>
                <td>${e.status}</td>
                <td>
                    <button class="btn btn-small btn-secondary" onclick="viewFile(${e.id})"><i class="fas fa-folder"></i></button>
                    <button class="btn btn-small btn-danger" onclick="archiveEmp(${e.id})"><i class="fas fa-archive"></i></button>
                </td>
            </tr>`).join("");
    } catch (e) { alert(e.message); }
}

window.showAddEmployee = () => { document.getElementById("add-emp-form").hidden = false; };
window.saveEmployee = async () => {
    try {
        const customVals = collectCustomFieldValues("admin-personnel", "new");
        const known = ["cnss_number", "fiscal_number", "emergency_contact_name", "emergency_contact_phone", "nationality"];
        const payload = {
            matricule: document.getElementById("new-matricule").value,
            full_name: document.getElementById("new-name").value,
            position: document.getElementById("new-position").value,
            salary_base: document.getElementById("new-salary").value || 0,
            email: document.getElementById("new-email").value,
            status: "Active",
            custom_data: {},
        };
        getVisibleCustomFields("admin-personnel").forEach((f) => {
            const v = customVals[f.field_key];
            if (known.includes(f.field_key)) payload[f.field_key] = v;
            else payload.custom_data[f.field_key] = v;
        });
        await apiPost("/employees/", payload);
        await otomiaAfterMutation("admin-personnel", "Employé enregistré");
        renderAdminPersonnel();
    } catch (e) { showToast(e.message, "error"); }
};
window.viewFile = async (id) => {
    const f = await apiGet(`/employees/${id}/employee_file/`);
    let modal = document.getElementById("employee-file-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "employee-file-modal";
        modal.className = "custom-modal";
        modal.innerHTML = `<div class="custom-modal-content panel" id="employee-file-content"></div>`;
        document.body.appendChild(modal);
        modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
    }
    const payslipRows = (f.payslips || []).map((p) => `<tr>
        <td>${p.month}</td><td>${formatMoney(p.net_salary, p.currency)}</td><td>${statusBadge(p.status)}</td>
        <td>
            <button class="btn btn-small" onclick="previewPay(${p.id})"><i class="fas fa-eye"></i></button>
            <button class="btn btn-small" onclick="dlPay(${p.id},'pdf')"><i class="fas fa-file-pdf"></i></button>
            <button class="btn btn-small" onclick="dlPay(${p.id},'excel')"><i class="fas fa-file-excel"></i></button>
            <button class="btn btn-small" onclick="dlPay(${p.id},'word')"><i class="fas fa-file-word"></i></button>
        </td></tr>`).join("") || "<tr><td colspan='4'>Aucun bulletin</td></tr>";
    const exportRows = (f.export_history || []).map((x) => `<tr>
        <td>${new Date(x.exported_at).toLocaleString("fr-FR")}</td>
        <td>${x.filename}</td><td>${x.format.toUpperCase()}</td>
        <td>${x.email_sent ? x.email_recipient : "—"}</td></tr>`).join("") || "<tr><td colspan='4'>Aucun export</td></tr>";
    const ua = f.user_account;
    const userAccountHtml = ua ? `
        <div class="panel" style="margin-bottom:16px">
            <h4><i class="fas fa-user-shield"></i> Compte utilisateur</h4>
            <p><strong>Utilisateur :</strong> ${ua.username} | <strong>Rôle :</strong> ${ua.role_label || ua.role || "—"}</p>
            <div class="form-row" style="margin-top:8px">
                <input id="emp-user-password" type="text" placeholder="Nouveau mot de passe (vide = généré auto)">
                <label><input type="checkbox" id="emp-user-send-email" checked> Envoyer par email</label>
                <label><input type="checkbox" id="emp-user-force-change" checked> Forcer changement à la connexion</label>
            </div>
            <div class="export-bar">
                <button class="btn btn-secondary" onclick="manageEmployeePassword(${id},'generate')"><i class="fas fa-key"></i> Générer mot de passe</button>
                <button class="btn btn-primary" onclick="manageEmployeePassword(${id},'set')"><i class="fas fa-save"></i> Enregistrer mot de passe</button>
            </div>
            <p id="emp-user-pwd-status" class="hint-text"></p>
        </div>` : `<p class="hint-text">Aucun compte utilisateur lié à cet employé.</p>`;

    document.getElementById("employee-file-content").innerHTML = `
        <div class="action-bar">
            <h3><i class="fas fa-folder-open"></i> Dossier — ${f.employee.full_name} (${f.employee.matricule})</h3>
            <button class="btn btn-secondary" onclick="document.getElementById('employee-file-modal').hidden=true"><i class="fas fa-times"></i></button>
        </div>
        ${userAccountHtml}
        <h4>Bulletins de paie</h4>
        <table><thead><tr><th>Période</th><th>Net</th><th>Statut</th><th>Actions</th></tr></thead><tbody>${payslipRows}</tbody></table>
        <h4 style="margin-top:16px">Historique des exports</h4>
        <table><thead><tr><th>Date</th><th>Fichier</th><th>Format</th><th>Email</th></tr></thead><tbody>${exportRows}</tbody></table>
        <h4 style="margin-top:16px">Documents RH (${f.documents.length})</h4>
        <ul>${f.documents.map((d) => `<li>${d.title} — ${d.document_type}</li>`).join("") || "<li>Aucun document</li>"}</ul>
        ${typeof renderEmployeeTalentDossier === "function" ? renderEmployeeTalentDossier(f) : ""}`;
    modal.hidden = false;
};
window.archiveEmp = async (id) => {
    if (!confirm("Archiver cet employé ?")) return;
    await apiPost(`/employees/${id}/archive_employee/`, {});
    await otomiaAfterMutation("admin-personnel", "Employé archivé");
    renderAdminPersonnel();
};
window.manageEmployeePassword = async (id, action) => {
    const status = document.getElementById("emp-user-pwd-status");
    try {
        const r = await apiPost(`/employees/${id}/manage_user_password/`, {
            action,
            password: document.getElementById("emp-user-password")?.value || "",
            send_email: document.getElementById("emp-user-send-email")?.checked ?? true,
            force_password_change: document.getElementById("emp-user-force-change")?.checked ?? true,
        });
        status.textContent = `Mot de passe mis à jour pour ${r.username}${r.email_sent ? " — email envoyé" : r.email_error ? ` — email non envoyé (${r.email_error})` : ""}`;
        if (r.password) alert(`Identifiants :\nUtilisateur : ${r.username}\nMot de passe : ${r.password}`);
    } catch (e) {
        status.textContent = "";
        alert(e.message || "Erreur mot de passe.");
    }
};

// --- Paie RDC ---
const PAYROLL_BASE = [
    ["salary_base", "Salaire de base"], ["currency", "Devise (USD/CDF)"],
];
const PAYROLL_PRIMES = [
    ["prime_fonction", "Prime fonction"], ["prime_responsabilite", "Prime responsabilité"],
    ["prime_rendement", "Prime rendement"], ["prime_risque", "Prime risque"],
    ["prime_anciennete", "Prime ancienneté"], ["prime_representation", "Prime représentation"],
    ["gratifications", "Gratification"], ["bonus_exceptionnel", "Bonus exceptionnel"],
];
const PAYROLL_INDEMNITES = [
    ["prime_transport", "Prime transport"], ["prime_logement", "Prime logement"],
    ["prime_communication", "Prime communication"], ["indemnite_fonction", "Indemnité fonction"],
    ["indemnite_speciale", "Indemnité spéciale"], ["avantages_nature", "Avantages nature"],
    ["autres_indemnites", "Autres indemnités"],
];
const PAYROLL_RETENUES = [
    ["inpp", "INPP"], ["assurance_sante", "Assurance santé"],
    ["avances_salaire", "Avance salaire"], ["prets_internes", "Prêt interne"],
    ["absences_non_justifiees", "Absence NJ"], ["retenues_disciplinaires", "Retenue disciplinaire"],
    ["cotisations_syndicales", "Cotisation syndicale"], ["autres_retenues", "Autres retenues"],
];
const PAYROLL_PERIOD = [
    ["days_working", "Jours ouvrables"], ["days_worked", "Jours travaillés"],
    ["days_absent", "Jours absence"], ["days_leave", "Jours congé"],
];
const PAYROLL_OVERTIME = [
    ["overtime_hours", "Heures supplémentaires"], ["overtime_rate", "Taux H. sup."],
    ["heures_supplementaires", "Montant H. sup. (auto)"],
];
const PAYROLL_GAINS = [...PAYROLL_BASE.slice(0, 1), ...PAYROLL_PRIMES, ...PAYROLL_INDEMNITES, ["heures_supplementaires", "Heures sup."]];

function getPayrollGains() {
    const feats = getActiveFeatures("paie", "payroll_gain");
    return feats.length ? feats.map((f) => [f.feature_key, f.feature_name]) : PAYROLL_GAINS;
}
function getPayrollRetenues() {
    const feats = getActiveFeatures("paie", "payroll_retention");
    return feats.length ? feats.map((f) => [f.feature_key, f.feature_name]) : PAYROLL_RETENUES;
}

async function renderPaie() {
    const now = new Date();
    contentArea.innerHTML = `
        <div class="page-header"><h1>Gestion de la Paie — RDC</h1><p>Calcul automatique CNSS / IRPP — Bulletins conformes</p></div>
        <div class="workflow-steps">
            <span class="workflow-step done">1. Création</span>
            <span class="workflow-step done">2. Saisie variables</span>
            <span class="workflow-step current">3. Calcul auto</span>
            <span class="workflow-step">4. Vérification</span>
            <span class="workflow-step">5. Validation RH</span>
            <span class="workflow-step">6. Génération bulletin</span>
            <span class="workflow-step">7. Archivage</span>
        </div>
        <div class="module-container">
            <div class="action-bar">
                <h2>État de paie du mois</h2>
            </div>
            <div class="export-sections">
                <div class="export-section panel">
                    <h3><i class="fas fa-users"></i> Export Global</h3>
                    <p class="feature-help">État récapitulatif mensuel — <strong>tous les employés</strong> dans un seul fichier (ETAT_GLOBAL_PAIE_…)</p>
                <div class="export-bar">
                        <button class="btn btn-secondary" onclick="exportPayrollGlobal('pdf')"><i class="fas fa-file-pdf"></i> PDF Global</button>
                        <button class="btn btn-secondary" onclick="exportPayrollGlobal('excel')"><i class="fas fa-file-excel"></i> Excel Global</button>
                        <button class="btn btn-secondary" onclick="exportPayrollGlobal('word')"><i class="fas fa-file-word"></i> Word Global</button>
                    </div>
                </div>
                <div class="export-section panel export-section-individual">
                    <h3><i class="fas fa-user-tag"></i> Export Individuel</h3>
                    <p class="feature-help">Bulletin personnel — <strong>un seul employé</strong> par fichier (BULLETIN_PAIE_MATRICULE_…)</p>
                    <button class="btn btn-primary" onclick="showIndividualExportModal()">
                        <i class="fas fa-file-invoice-dollar"></i> Ouvrir Export Individuel
                    </button>
                </div>
            </div>
            <div class="form-row" style="margin-bottom:16px">
                <select id="pay-month">${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${i===now.getMonth()?"selected":""}>Mois ${i+1}</option>`).join("")}</select>
                <input id="pay-year" type="number" value="${now.getFullYear()}">
                <select id="pay-currency"><option value="USD">USD — Dollar</option><option value="CDF">CDF — Franc congolais</option></select>
                <button class="btn btn-primary" id="btn-calc"><i class="fas fa-calculator"></i> Calculer la paie</button>
                <button class="btn btn-secondary" id="btn-refresh-pay"><i class="fas fa-sync"></i> Actualiser</button>
            </div>
            <div id="pay-stats" class="dashboard-grid"></div>
            <p class="feature-help" id="pay-export-hint">Export Global = état collectif. Export Individuel = bulletin personnel d'un seul employé.</p>
            <div id="pay-attendance-stats" class="dashboard-grid" style="margin-bottom:16px"></div>
            <table><thead><tr><th>Matricule</th><th>Employé</th><th>Devise</th><th>Brut</th><th>CNSS</th><th>IRPP</th><th>Net</th><th>Statut</th><th>Export individuel</th><th>Actions</th></tr></thead>
            <tbody id="pay-list"></tbody></table>
        </div>
        <div class="panel" id="pay-edit-panel" hidden>
            <h3 id="pay-edit-title">Modifier bulletin</h3>
            <div class="payroll-edit-grid" id="pay-edit-fields"></div>
            <div style="margin-top:12px;">
                <button class="btn btn-primary" id="btn-save-pay">Recalculer & Enregistrer</button>
                <button class="btn btn-secondary" onclick="document.getElementById('pay-edit-panel').hidden=true">Fermer</button>
            </div>
        </div>`;
    document.getElementById("btn-calc").onclick = async () => {
        await apiPost("/payroll/calculate/", {
            month: payMonth().m, year: payMonth().y,
            currency: document.getElementById("pay-currency").value,
        });
        await otomiaAfterMutation("paie", "Paie calculée — statistiques actualisées");
    };
    document.getElementById("btn-refresh-pay").onclick = refreshPayrollView;
    document.getElementById("pay-month").onchange = refreshPayrollView;
    document.getElementById("pay-year").onchange = refreshPayrollView;
    await refreshPayrollView();
}

async function refreshPayrollView() {
    await Promise.all([loadPayrollStats(), loadPayroll()]);
}

async function loadPayrollStats() {
    const { m, y } = payMonth();
    try {
        const s = await apiGet(`/payroll/summary/?month=${m}&year=${y}`);
        document.getElementById("pay-stats").innerHTML = `
            <div class="stat-card"><i class="fas fa-file-invoice"></i><div class="stat-info"><h3>Bulletins</h3><p>${s.total_bulletins}</p></div></div>
            <div class="stat-card"><i class="fas fa-check-circle"></i><div class="stat-info"><h3>Validés</h3><p>${s.validated_count}</p></div></div>
            <div class="stat-card"><i class="fas fa-money-bill-wave"></i><div class="stat-info"><h3>Masse brute</h3><p>${formatMoney(s.gross_mass)}</p></div></div>
            <div class="stat-card"><i class="fas fa-hand-holding-usd"></i><div class="stat-info"><h3>Masse nette</h3><p>${formatMoney(s.net_mass)}</p></div></div>
            <div class="stat-card"><i class="fas fa-landmark"></i><div class="stat-info"><h3>Total CNSS</h3><p>${formatMoney(s.cnss_total)}</p></div></div>
            <div class="stat-card"><i class="fas fa-percent"></i><div class="stat-info"><h3>Total IRPP</h3><p>${formatMoney(s.irpp_total)}</p></div></div>`;
        const attEl = document.getElementById("pay-attendance-stats");
        if (attEl) {
            attEl.innerHTML = `
                <div class="stat-card stat-card-animate"><i class="fas fa-user-check"></i><div class="stat-info"><h3>Taux présence</h3><p>${s.avg_presence_rate || 0} %</p></div></div>
                <div class="stat-card stat-card-animate"><i class="fas fa-user-times"></i><div class="stat-info"><h3>Absentéisme</h3><p>${s.absenteeism_rate || 0} %</p></div></div>
                <div class="stat-card stat-card-animate"><i class="fas fa-clock"></i><div class="stat-info"><h3>Heures sup.</h3><p>${s.total_overtime_hours || 0} h</p></div></div>
                <div class="stat-card stat-card-animate"><i class="fas fa-hourglass-half"></i><div class="stat-info"><h3>Retards cumulés</h3><p>${s.total_late_minutes || 0} min</p></div></div>`;
        }
        const hint = document.getElementById("pay-export-hint");
        if (hint) {
            hint.textContent = s.validated_count
                ? `${s.validated_count} bulletin(s) validé(s) exportable(s) pour ${m}/${y}.`
                : `Aucun bulletin validé pour ${m}/${y}. Validez les paies avant d'exporter.`;
        }
    } catch (e) { console.error(e); }
}

window.exportPayrollGlobal = async (fmt) => {
    const { m, y } = payMonth();
    try {
        const r = await apiGet(`/export/payroll/${fmt}/?month=${m}&year=${y}`);
        if (r.export_type !== "global") {
            alert("Erreur : ce n'est pas un export global.");
            return;
        }
        const link = document.createElement("a");
        link.href = `${API_HOST}${r.url}`;
        link.download = r.filename || `ETAT_GLOBAL_PAIE_${m}_${y}.${fmt === "excel" ? "xlsx" : fmt === "word" ? "docx" : "pdf"}`;
        link.target = "_blank";
        link.click();
        await otomiaAfterMutation("paie", "Export global généré");
    } catch (e) {
        alert(e.message || "Aucun bulletin validé à exporter pour cette période.");
    }
};
window.exportPayroll = window.exportPayrollGlobal;

function payMonth() {
    return { m: document.getElementById("pay-month")?.value, y: document.getElementById("pay-year")?.value };
}

async function loadPayroll() {
    const { m, y } = payMonth();
    const all = await apiGet("/payroll/");
    const prefix = `${y}-${String(m).padStart(2,"0")}`;
    const list = all.filter((p) => p.month && p.month.startsWith(prefix));
    document.getElementById("pay-list").innerHTML = list.map((p) => `
        <tr>
            <td>${p.employee_matricule}</td><td>${p.employee_name}</td>
            <td><span class="badge-status badge-validated">${p.currency || "USD"}</span></td>
            <td>${formatMoney(p.gross_salary, p.currency)}</td>
            <td>${formatMoney(p.cnss_salarie || p.cnss_worker, p.currency)}</td>
            <td>${formatMoney(p.irpp || p.iprp, p.currency)}</td>
            <td><strong>${formatMoney(p.net_salary, p.currency)}</strong></td>
            <td>${statusBadge(p.status)}</td>
            <td style="white-space:nowrap">
                ${["VALIDATED","PAID","ARCHIVED"].includes(p.status) ? `
                    <button class="btn btn-small btn-secondary" onclick="previewPay(${p.id})" title="Aperçu PDF"><i class="fas fa-eye"></i></button>
                    <button class="btn btn-small btn-primary" onclick="dlPay(${p.id},'pdf')" title="PDF"><i class="fas fa-file-pdf"></i></button>
                    <button class="btn btn-small btn-secondary" onclick="dlPay(${p.id},'excel')" title="Excel"><i class="fas fa-file-excel"></i></button>
                    <button class="btn btn-small btn-secondary" onclick="dlPay(${p.id},'word')" title="Word"><i class="fas fa-file-word"></i></button>
                ` : "<span style='color:#999'>—</span>"}
            </td>
            <td style="white-space:nowrap">
                ${["DRAFT","PENDING"].includes(p.status) ? `
                    <button class="btn btn-small btn-secondary" onclick="editPay(${p.id})" title="Modifier"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-small" onclick="submitPay(${p.id})">Soumettre</button>
                    <button class="btn btn-small btn-primary" onclick="validatePay(${p.id})">Valider</button>` : ""}
                ${["VALIDATED","PAID"].includes(p.status) ? `<button class="btn btn-small btn-secondary" onclick="reopenPay(${p.id})" title="Réouvrir pour modification"><i class="fas fa-undo"></i></button>` : ""}
                ${p.status === "VALIDATED" ? `<button class="btn btn-small" onclick="markPaid(${p.id})">Payé</button>` : ""}
            </td>
        </tr>`).join("") || `<tr><td colspan='10'>Aucun bulletin pour ${m}/${y} — lancez un calcul</td></tr>`;
}

function _payFieldHtml(key, label, value, type = "number") {
    if (key === "currency") {
        const v = value || "USD";
        return `<div><label>${label}</label><select id="pe-${key}"><option value="USD" ${v === "USD" ? "selected" : ""}>USD</option><option value="CDF" ${v === "CDF" ? "selected" : ""}>CDF</option></select></div>`;
    }
    return `<div><label>${label}</label><input type="${type}" step="0.01" id="pe-${key}" value="${value ?? 0}"></div>`;
}

window.editPay = async (id) => {
    const p = await apiGet(`/payroll/${id}/`);
    document.getElementById("pay-edit-panel").hidden = false;
    document.getElementById("pay-edit-title").textContent = `Saisie bulletin — ${p.employee_name} (${p.currency || "USD"})`;
    const sections = [
        { title: "Informations de base", fields: PAYROLL_BASE },
        { title: "Primes", fields: PAYROLL_PRIMES },
        { title: "Indemnités", fields: PAYROLL_INDEMNITES },
        { title: "Retenues", fields: PAYROLL_RETENUES },
        { title: "Période de paie", fields: PAYROLL_PERIOD },
        { title: "Heures supplémentaires", fields: PAYROLL_OVERTIME },
    ];
    document.getElementById("pay-edit-fields").innerHTML = sections.map((s) => `
        <div class="panel" style="margin-bottom:12px;padding:12px">
            <h4 style="color:#1a5f9e;margin:0 0 10px">${s.title}</h4>
            <div class="payroll-edit-grid">${s.fields.map(([k, l]) => _payFieldHtml(k, l, p[k], k === "currency" ? "text" : "number")).join("")}</div>
        </div>`).join("");
    document.getElementById("btn-save-pay").onclick = async () => {
        const data = {};
        sections.forEach((s) => s.fields.forEach(([k]) => {
            const el = document.getElementById(`pe-${k}`);
            data[k] = el.tagName === "SELECT" ? el.value : el.value;
        }));
        await apiFetch(`/payroll/${id}/update_elements/`, { method: "PUT", body: JSON.stringify(data) });
        document.getElementById("pay-edit-panel").hidden = true;
        await otomiaAfterMutation("paie", "Bulletin modifié et recalculé");
    };
};
window.submitPay = async (id) => {
    await apiPost(`/payroll/${id}/submit_validation/`, {});
    await otomiaAfterMutation("paie", "Bulletin soumis pour validation");
};
window.reopenPay = async (id) => {
    if (!confirm("Réouvrir ce bulletin en brouillon pour modification ?")) return;
    await apiPost(`/payroll/${id}/reopen_payroll/`, {});
    await otomiaAfterMutation("paie", "Bulletin réouvert");
};
window.validatePay = async (id) => {
    const r = await apiPost(`/payroll/${id}/validate_payroll/`, {});
    await otomiaAfterMutation("paie", "Bulletin validé");
    if (r.pdf_url && confirm("Bulletin validé. Souhaitez-vous prévisualiser le PDF ?")) {
        showPayslipPreviewModal(`${API_HOST}${r.pdf_url}`);
    }
};
window.markPaid = async (id) => {
    await apiPost(`/payroll/${id}/mark_paid/`, {});
    await otomiaAfterMutation("paie", "Bulletin marqué comme payé");
};

function showPayslipPreviewModal(url, filename = "Bulletin de paie") {
    let modal = document.getElementById("payslip-preview-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "payslip-preview-modal";
        modal.className = "custom-modal";
        modal.innerHTML = `
            <div class="custom-modal-content panel payslip-preview-panel">
                <div class="action-bar">
                    <h3 id="payslip-preview-title">Aperçu bulletin</h3>
                    <button class="btn btn-secondary" onclick="closePayslipPreview()"><i class="fas fa-times"></i> Fermer</button>
                </div>
                <iframe id="payslip-preview-frame" title="Aperçu bulletin"></iframe>
                <div class="export-bar" style="margin-top:12px">
                    <a id="payslip-preview-dl" class="btn btn-primary" href="#" target="_blank" download><i class="fas fa-download"></i> Télécharger</a>
                    <button class="btn btn-secondary" onclick="closePayslipPreview()"><i class="fas fa-print"></i> Fermer pour réimprimer</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.addEventListener("click", (e) => { if (e.target === modal) closePayslipPreview(); });
    }
    document.getElementById("payslip-preview-title").textContent = filename;
    document.getElementById("payslip-preview-frame").src = url;
    const dl = document.getElementById("payslip-preview-dl");
    dl.href = url;
    dl.download = filename;
    modal.hidden = false;
}
window.closePayslipPreview = () => {
    const modal = document.getElementById("payslip-preview-modal");
    if (modal) {
        modal.hidden = true;
        const frame = document.getElementById("payslip-preview-frame");
        if (frame) frame.src = "about:blank";
    }
};

window.previewPay = async (id) => {
    try {
        const r = await apiGet(`/export/payslip/preview/?payroll_id=${id}`);
        showPayslipPreviewModal(`${API_HOST}${r.url}`, r.filename || "Bulletin de paie");
    } catch (e) {
        alert(e.message || "Impossible de prévisualiser ce bulletin.");
    }
};

window.dlPay = async (id, fmt) => {
    const btn = event?.target?.closest("button");
    if (btn) { btn.disabled = true; btn.classList.add("loading"); }
    try {
        const r = await apiGet(`/payroll/${id}/download_payslip/?export_format=${fmt}`);
        const ext = fmt === "excel" ? "xlsx" : fmt === "word" ? "docx" : "pdf";
        const fileRes = await fetch(`${API_HOST}${r.url}`, { credentials: "include" });
        if (!fileRes.ok) throw new Error("Fichier bulletin introuvable.");
        await downloadBlobFromResponse(fileRes, r.filename || `bulletin.${ext}`);
    } catch (e) {
        try {
            const r = await apiGet(`/export/payslip/?payroll_id=${id}&export_format=${fmt}`);
            const fileRes = await fetch(`${API_HOST}${r.url}`, { credentials: "include" });
            if (fileRes.ok) await downloadBlobFromResponse(fileRes, r.filename || "bulletin.pdf");
            else window.open(`${API_HOST}${r.url}`, "_blank");
        } catch (e2) {
            alert(e2.message || e.message || "Export impossible.");
        }
    } finally {
        if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
    }
};

let _exportEmployees = [];
let _allExportEmployees = [];
let _exportPayrollsByEmployee = {};

const PAYROLL_STATUS_LABELS = {
    DRAFT: "Brouillon", PENDING: "En attente", VALIDATED: "Validé",
    PAID: "Payé", ARCHIVED: "Archivé",
};

function isPayrollExportable(status) {
    return ["VALIDATED", "PAID", "ARCHIVED"].includes(status);
}

function getSelectedExportPayroll() {
    const empId = Number(document.getElementById("indiv-export-employee")?.value);
    return _exportPayrollsByEmployee[empId] || null;
}

function updateIndividualExportActions() {
    const payroll = getSelectedExportPayroll();
    const exportable = payroll && isPayrollExportable(payroll.status);
    document.querySelectorAll("#indiv-export-modal .indiv-export-only").forEach((btn) => {
        btn.disabled = !exportable;
        btn.title = exportable ? "" : "Validez le bulletin avant d'exporter.";
    });
    const editBtn = document.getElementById("indiv-export-edit-btn");
    const validateBtn = document.getElementById("indiv-export-validate-btn");
    const reopenBtn = document.getElementById("indiv-export-reopen-btn");
    if (editBtn) editBtn.disabled = !payroll || !["DRAFT", "PENDING"].includes(payroll.status);
    if (validateBtn) validateBtn.disabled = !payroll || !["DRAFT", "PENDING"].includes(payroll.status);
    if (reopenBtn) reopenBtn.disabled = !payroll || !["VALIDATED", "PENDING", "PAID"].includes(payroll.status);
}

async function refreshIndividualExportEmployees() {
    const month = document.getElementById("indiv-export-month")?.value;
    const year = document.getElementById("indiv-export-year")?.value;
    const status = document.getElementById("indiv-export-status");
    if (!month || !year) return;
    try {
        if (!_allExportEmployees.length) {
            _allExportEmployees = await apiGet("/employees/");
        }
        const payrolls = await apiGet("/payroll/");
        const prefix = `${year}-${String(month).padStart(2, "0")}`;
        const periodPayrolls = payrolls.filter((p) => p.month?.startsWith(prefix));
        _exportPayrollsByEmployee = Object.fromEntries(periodPayrolls.map((p) => [p.employee, p]));
        _exportEmployees = _allExportEmployees.filter((e) => _exportPayrollsByEmployee[e.id]);
        renderExportEmployeeOptions(_exportEmployees);
        const validatedCount = periodPayrolls.filter((p) => isPayrollExportable(p.status)).length;
        const draftCount = periodPayrolls.filter((p) => ["DRAFT", "PENDING"].includes(p.status)).length;
        if (status) {
            if (!periodPayrolls.length) {
                status.textContent = `Aucun bulletin pour ${month}/${year}. Lancez « Calculer la paie » d'abord.`;
            } else {
                status.textContent = `${periodPayrolls.length} bulletin(s) — ${draftCount} modifiable(s), ${validatedCount} exportable(s). Modifiez puis validez avant export.`;
            }
        }
        updateIndividualExportActions();
    } catch (e) {
        if (status) status.textContent = "";
        throw e;
    }
}

function filterExportEmployees(q) {
    const s = (q || "").toLowerCase().trim();
    if (!s) return _exportEmployees;
    return _exportEmployees.filter((e) =>
        (e.matricule || "").toLowerCase().includes(s) ||
        (e.full_name || "").toLowerCase().includes(s) ||
        (e.department_name || "").toLowerCase().includes(s)
    );
}
function renderExportEmployeeOptions(list) {
    const sel = document.getElementById("indiv-export-employee");
    if (!sel) return;
    sel.innerHTML = list.length
        ? list.map((e) => {
            const p = _exportPayrollsByEmployee[e.id];
            const st = PAYROLL_STATUS_LABELS[p?.status] || p?.status || "—";
            return `<option value="${e.id}" data-matricule="${e.matricule}" data-dept="${e.department_name || "-"}" data-fonction="${e.position || "-"}" data-status="${p?.status || ""}">${e.matricule} — ${e.nom || e.full_name} ${e.prenom || ""} [${st}]</option>`;
        }).join("")
        : "<option value=''>— Aucun bulletin pour cette période —</option>";
    updateIndividualExportEmployeeInfo();
}
window.updateIndividualExportEmployeeInfo = () => {
    const sel = document.getElementById("indiv-export-employee");
    const info = document.getElementById("indiv-export-emp-info");
    if (!sel || !info) return;
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) { info.textContent = ""; updateIndividualExportActions(); return; }
    const payroll = getSelectedExportPayroll();
    const st = payroll ? (PAYROLL_STATUS_LABELS[payroll.status] || payroll.status) : "—";
    info.innerHTML = `<strong>Matricule :</strong> ${opt.dataset.matricule} | <strong>Département :</strong> ${opt.dataset.dept} | <strong>Fonction :</strong> ${opt.dataset.fonction} | <strong>Statut :</strong> ${st}`;
    updateIndividualExportActions();
};

window.showIndividualExportModal = async () => {
    const now = new Date();
    const payM = document.getElementById("pay-month")?.value;
    const payY = document.getElementById("pay-year")?.value;
    const defaultMonth = payM || String(now.getMonth() + 1);
    const defaultYear = payY || String(now.getFullYear());
    let modal = document.getElementById("indiv-export-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "indiv-export-modal";
        modal.className = "custom-modal";
        modal.innerHTML = `
            <div class="custom-modal-content panel indiv-export-panel">
                <div class="action-bar">
                    <h3><i class="fas fa-file-invoice-dollar"></i> Export Individuel — Bulletin RDC</h3>
                    <button class="btn btn-secondary" onclick="closeIndividualExportModal()"><i class="fas fa-times"></i></button>
                </div>
                <p class="feature-help"><strong>Workflow :</strong> Modifier → Valider → Exporter. Les bulletins brouillon ne sont pas exportables.</p>
                <div class="form-row">
                    <select id="indiv-export-month">${Array.from({length:12},(_,i)=>`<option value="${i+1}">${["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"][i]}</option>`).join("")}</select>
                    <input id="indiv-export-year" type="number" min="2020" max="2099">
                </div>
                <div class="form-row">
                    <input id="indiv-export-search" type="search" placeholder="Rechercher : matricule, nom, département…" oninput="onExportEmployeeSearch(this.value)">
                </div>
                <div class="form-row">
                    <select id="indiv-export-employee" size="6" class="employee-select-list" onchange="updateIndividualExportEmployeeInfo()"></select>
                </div>
                <p id="indiv-export-emp-info" class="hint-text"></p>
                <div class="export-bar" style="margin:12px 0">
                    <button class="btn btn-secondary" id="indiv-export-edit-btn" onclick="editSelectedPayrollFromExport()"><i class="fas fa-edit"></i> Modifier bulletin</button>
                    <button class="btn btn-secondary" id="indiv-export-validate-btn" onclick="validateSelectedPayrollFromExport()"><i class="fas fa-check"></i> Valider</button>
                    <button class="btn btn-secondary" id="indiv-export-reopen-btn" onclick="reopenSelectedPayrollFromExport()"><i class="fas fa-undo"></i> Réouvrir</button>
                </div>
                <div class="export-bar" style="margin:12px 0">
                    <button class="btn btn-secondary indiv-export-only" onclick="individualExportAction('preview')"><i class="fas fa-eye"></i> Prévisualiser</button>
                    <button class="btn btn-primary indiv-export-only" onclick="individualExportAction('pdf')"><i class="fas fa-file-pdf"></i> Générer PDF</button>
                    <button class="btn btn-secondary indiv-export-only" onclick="individualExportAction('word')"><i class="fas fa-file-word"></i> Générer Word</button>
                    <button class="btn btn-secondary indiv-export-only" onclick="individualExportAction('excel')"><i class="fas fa-file-excel"></i> Générer Excel</button>
                    <button class="btn btn-secondary indiv-export-only" onclick="individualExportAction('download')"><i class="fas fa-download"></i> Télécharger</button>
                    <button class="btn btn-secondary indiv-export-only" onclick="individualExportAction('reprint')"><i class="fas fa-print"></i> Imprimer</button>
                </div>
                <div class="form-row" style="align-items:flex-end">
                    <input id="indiv-export-email" type="email" placeholder="Email employé (optionnel)">
                    <button class="btn btn-secondary" onclick="individualExportAction('email')"><i class="fas fa-envelope"></i> Envoyer par email</button>
                </div>
                <p id="indiv-export-status" class="hint-text"></p>
            </div>`;
        document.body.appendChild(modal);
        modal.addEventListener("click", (e) => { if (e.target === modal) closeIndividualExportModal(); });
        document.getElementById("indiv-export-month").onchange = () => refreshIndividualExportEmployees().catch((e) => alert(e.message));
        document.getElementById("indiv-export-year").onchange = () => refreshIndividualExportEmployees().catch((e) => alert(e.message));
    }
    document.getElementById("indiv-export-month").value = defaultMonth;
    document.getElementById("indiv-export-year").value = defaultYear;
    document.getElementById("indiv-export-search").value = "";
    try {
        await refreshIndividualExportEmployees();
    } catch (e) {
        alert(e.message || "Impossible de charger les employés.");
        return;
    }
    modal.hidden = false;
};
window.closeIndividualExportModal = () => {
    const modal = document.getElementById("indiv-export-modal");
    if (modal) modal.hidden = true;
};
window.onExportEmployeeSearch = (q) => {
    renderExportEmployeeOptions(filterExportEmployees(q));
};

function _individualExportParams() {
    const empId = document.getElementById("indiv-export-employee")?.value;
    const month = document.getElementById("indiv-export-month")?.value;
    const year = document.getElementById("indiv-export-year")?.value;
    if (!empId) throw new Error("Sélectionnez un employé.");
    return { employee_id: empId, month, year };
}

window.editSelectedPayrollFromExport = async () => {
    const payroll = getSelectedExportPayroll();
    if (!payroll) { alert("Sélectionnez un employé."); return; }
    if (!["DRAFT", "PENDING"].includes(payroll.status)) {
        alert("Ce bulletin est validé. Cliquez « Réouvrir » pour le modifier.");
        return;
    }
    closeIndividualExportModal();
    await editPay(payroll.id);
};

window.validateSelectedPayrollFromExport = async () => {
    const payroll = getSelectedExportPayroll();
    if (!payroll) { alert("Sélectionnez un employé."); return; }
    if (!["DRAFT", "PENDING"].includes(payroll.status)) {
        alert("Ce bulletin est déjà validé.");
        return;
    }
    await validatePay(payroll.id);
    await refreshIndividualExportEmployees();
};

window.reopenSelectedPayrollFromExport = async () => {
    const payroll = getSelectedExportPayroll();
    if (!payroll) { alert("Sélectionnez un employé."); return; }
    if (!["VALIDATED", "PENDING", "PAID"].includes(payroll.status)) {
        alert("Ce bulletin est déjà modifiable.");
        return;
    }
    if (!confirm("Réouvrir ce bulletin en brouillon pour modification ?")) return;
    await apiPost(`/payroll/${payroll.id}/reopen_payroll/`, {});
    await refreshIndividualExportEmployees();
    alert("Bulletin réouvert — vous pouvez le modifier.");
};

window.individualExportAction = async (action) => {
    const status = document.getElementById("indiv-export-status");
    console.debug("[OTOMIA] Clic export individuel action=", action);
    try {
        const { employee_id, month, year } = _individualExportParams();
        const payroll = getSelectedExportPayroll();
        if (!payroll || !isPayrollExportable(payroll.status)) {
            throw new Error("Modifiez et validez le bulletin avant d'exporter.");
        }
        status.textContent = "Génération en cours…";
        const fmt = ["pdf", "excel", "word"].includes(action) ? action : "pdf";

        if (action === "preview") {
            const r = await apiGet(`/payroll/export-individual/?employee_id=${employee_id}&month=${month}&year=${year}&export_format=pdf`);
            console.debug("[OTOMIA] Aperçu API réponse", r);
            if (r.export_type !== "individual") throw new Error("Export global détecté — opération annulée.");
            showPayslipPreviewModal(`${API_HOST}${r.url}`, r.filename);
            status.textContent = `Aperçu — ${r.filename}`;
            return;
        }
        if (action === "reprint") {
            const r = await apiGet(`/payroll/export-individual/?employee_id=${employee_id}&month=${month}&year=${year}&export_format=pdf`);
            const w = window.open(`${API_HOST}${r.url}`, "_blank");
            if (w) setTimeout(() => { try { w.print(); } catch (_) { /* ignore */ } }, 1500);
            status.textContent = "Bulletin ouvert pour impression.";
            return;
        }
        if (action === "email") {
            const email = document.getElementById("indiv-export-email")?.value || "";
            await apiPost("/export/payslip/email/", { employee_id, month, year, export_format: "pdf", email });
            status.textContent = email ? `Bulletin envoyé à ${email}.` : "Bulletin envoyé à l'email de l'employé.";
            alert("Export généré avec succès.");
            return;
        }

        const filename = await downloadIndividualPayslip(employee_id, month, year, fmt);
        console.debug("[OTOMIA] Fichier téléchargé", filename);
        status.textContent = `Export généré avec succès — ${filename}`;
        await otomiaAfterMutation("paie", "Export individuel généré");
    } catch (e) {
        console.error("[OTOMIA] Erreur export individuel", e);
        status.textContent = "";
        alert(e.message || "Aucune paie trouvée pour cette période.");
    }
};

// --- Présences & Congés ---
async function renderPresences() {
    const tabs = getActiveFeatures("presences", "menu_tab");
    const leaveTypes = getActiveFeatures("presences", "leave_type");
    const title = getModuleTitle("presences", "Présences & Congés");
    const canWrite = canWriteModule("presences");
    const tabsHtml = renderModuleTabsHtml(tabs.length ? tabs : [
        { feature_key: "onglet_conges", feature_name: "Congés", icon: "fa-umbrella-beach" },
        { feature_key: "onglet_presences", feature_name: "Présences", icon: "fa-clock" },
        { feature_key: "onglet_missions", feature_name: "Missions", icon: "fa-briefcase" },
        { feature_key: "onglet_types", feature_name: "Types de congés", icon: "fa-list" },
    ], "pres-tabs");
    const leaveOptions = leaveTypes.map((lt) =>
        `<option value="${lt.feature_key}">${lt.feature_name}</option>`).join("");
    contentArea.innerHTML = `
        <div class="module-container animated-panel">
            <div class="action-bar"><h2>${title}</h2>
                ${canWrite ? `<button class="btn btn-primary" onclick="showLeaveRequestModal()"><i class="fas fa-plus"></i> Demander un congé</button>` : ""}
            </div>
            ${tabsHtml}
            <div id="pres-stats-bar" class="dashboard-grid" style="margin-bottom:16px"></div>
            <div class="module-tab-panel active" id="pres-panel-conges">
                <table><thead><tr><th>Employé</th><th>Type</th><th>Début</th><th>Fin</th><th>Statut</th><th>Actions</th></tr></thead>
                <tbody id="abs-list"></tbody></table>
            </div>
            <div class="module-tab-panel" id="pres-panel-presences">
                <table><thead><tr><th>Employé</th><th>Date</th><th>Entrée</th><th>Sortie</th><th>Statut</th></tr></thead>
                <tbody id="att-list"></tbody></table>
            </div>
            <div class="module-tab-panel" id="pres-panel-missions">
                <table><thead><tr><th>Employé</th><th>Titre</th><th>Destination</th><th>Période</th><th>Statut</th></tr></thead>
                <tbody id="miss-list"></tbody></table>
            </div>
            <div class="module-tab-panel" id="pres-panel-types">
                <div class="feature-grid">${leaveTypes.map((lt) => `
                    <div class="feature-card">
                        <h4>${lt.feature_name}</h4>
                        <p>${lt.description || ""}</p>
                        <small>Max: ${lt.config?.max_days ?? "-"} j | Workflow: ${lt.config?.approval_workflow ?? "rh"} | Accordés: ${lt.config?.days_granted ?? 0} j</small>
                    </div>`).join("") || "<p>Aucun type configuré — Paramètres → Personnalisation.</p>"}
                </div>
            </div>
        </div>
        <div id="leave-modal" class="custom-modal" hidden>
            <div class="custom-modal-content panel">
                <h3>Demande de congé</h3>
                <div class="form-row">
                    <div><label>Type</label><select id="leave-type">${leaveOptions}</select></div>
                    <div><label>Date début</label><input type="date" id="leave-start"></div>
                    <div><label>Date fin</label><input type="date" id="leave-end"></div>
                </div>
                <div><label>Motif</label><textarea id="leave-reason" rows="2"></textarea></div>
                <div class="action-bar"><button class="btn btn-primary" onclick="submitLeaveRequest()">Envoyer</button>
                <button class="btn btn-secondary" onclick="closeLeaveModal()">Annuler</button></div>
            </div>
        </div>`;
    const tabMap = { onglet_conges: "conges", onglet_presences: "presences", onglet_missions: "missions", onglet_types: "types" };
    bindModuleTabs("pres-tabs", (key) => {
        document.querySelectorAll(".module-tab-panel").forEach((p) => p.classList.remove("active"));
        const panel = document.getElementById(`pres-panel-${tabMap[key] || key.replace("onglet_", "")}`);
        if (panel) panel.classList.add("active");
    });
    await refreshPresencesData();
}
window.showLeaveRequestModal = () => { document.getElementById("leave-modal").hidden = false; };
window.closeLeaveModal = () => { document.getElementById("leave-modal").hidden = true; };
window.submitLeaveRequest = async () => {
    const empId = currentUser.employee_id;
    if (!empId) return alert("Profil employé non lié.");
    const typeKey = document.getElementById("leave-type").value;
    const start = document.getElementById("leave-start").value;
    const end = document.getElementById("leave-end").value;
    const reason = document.getElementById("leave-reason").value;
    if (!start || !end) return alert("Dates requises.");
    await apiPost("/absences/", { employee: empId, absence_type: typeKey, start_date: start, end_date: end, reason, status: "Pending" });
    closeLeaveModal();
    await otomiaAfterMutation("presences", "Demande de congé envoyée");
};
window.approveAbs = async (id) => {
    await apiPost(`/absences/${id}/approve_absence/`, {});
    await otomiaAfterMutation("presences", "Congé approuvé");
};
window.rejectAbs = async (id) => {
    await apiPost(`/absences/${id}/reject_absence/`, {});
    await otomiaAfterMutation("presences", "Congé refusé");
};
window.requestLeave = () => showLeaveRequestModal();

// --- Recrutement → voir recruitment.js ---

// --- Formation & Performances → voir talent.js ---

// --- Portail Employé ---
async function renderPortailEmploye() {
    contentArea.innerHTML = `<div class="loader">Chargement du portail...</div>`;
    try {
        const isRh = ["ADMIN_RH", "GESTIONNAIRE_RH"].includes(currentUser.role);
        const isEmployee = currentUser.role === "EMPLOYE";
        let employees = [];
        let selectedId = null;

        if (isRh) {
            employees = await apiGet("/employees/");
            if (!employees.length) {
                contentArea.innerHTML = `<p class="error-message">Aucun employé enregistré.</p>`;
                return;
            }
            const storedId = window._portalEmployeeId;
            selectedId = storedId && employees.some((e) => e.id === storedId) ? storedId : employees[0].id;
        } else if (!isEmployee) {
            contentArea.innerHTML = `<p class="error-message">Accès réservé aux employés et à l'équipe RH.</p>`;
            return;
        }

        const portalPath = selectedId ? `/employee-portal/?employee_id=${selectedId}` : "/employee-portal/";
        const portal = await apiGet(portalPath);
        const emp = portal.employee;
        const avatar = emp.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(emp.full_name)}&background=1a5f9e&color=fff&size=160`;
        const portalTabDefs = getActiveFeatures("portail-employe", "portal_section");
        const portalTabs = portalTabDefs.length ? portalTabDefs : [
            { feature_key: "dashboard", feature_name: "Tableau de bord", icon: "fa-chart-line" },
            { feature_key: "profil", feature_name: "Mon Profil", icon: "fa-user" },
            { feature_key: "bulletins", feature_name: "Mes Bulletins", icon: "fa-file-invoice-dollar" },
            { feature_key: "conges", feature_name: "Mes Congés", icon: "fa-umbrella-beach" },
            { feature_key: "presences", feature_name: "Mes Présences", icon: "fa-clock" },
            { feature_key: "evaluations", feature_name: "Évaluations", icon: "fa-star" },
            { feature_key: "formations", feature_name: "Formations", icon: "fa-graduation-cap" },
            { feature_key: "documents", feature_name: "Documents RH", icon: "fa-folder-open" },
            { feature_key: "notifications", feature_name: "Notifications", icon: "fa-bell" },
        ];
        const portalTabsHtml = portalTabs.map((t, i) =>
            `<button class="portail-tab ${i === 0 ? "active" : ""}" data-tab="${t.feature_key}">${t.icon ? `<i class="fas ${t.icon}"></i> ` : ""}${t.feature_name}</button>`
        ).join("");
        const activePortalKeys = new Set(portalTabs.map((t) => t.feature_key));
        const selectorHtml = isRh ? `
            <div class="action-bar panel" style="margin-bottom:16px">
                <label for="portal-employee-select"><i class="fas fa-users"></i> Prévisualiser l'espace de :</label>
                <select id="portal-employee-select" class="filter-select" onchange="changePortalEmployee(this.value)">
                    ${employees.map((e) => `<option value="${e.id}" ${e.id === selectedId ? "selected" : ""}>${e.full_name} (${e.matricule})</option>`).join("")}
                </select>
            </div>` : "";
        contentArea.innerHTML = `${selectorHtml}
            <div class="portail-header">
                <img class="portail-avatar" src="${avatar}" alt="Photo">
                <div>
                    <h1 style="color:#1a5f9e;margin:0">${emp.full_name}</h1>
                    <p>${emp.matricule} — ${emp.position} — ${emp.department_name || "-"}</p>
                    <p>Responsable : ${emp.manager_name || "-"} | Ancienneté : ${emp.seniority_years} ans</p>
                </div>
                <div style="margin-left:auto;text-align:right">
                    <span class="badge-status badge-pending">${portal.notifications.length} notification(s)</span>
                </div>
            </div>
            <div class="portail-tabs" id="portail-tabs">${portalTabsHtml}</div>

            <div class="portail-section panel" id="tab-dashboard">
                <div class="dashboard-grid">
                    <div class="stat-card"><i class="fas fa-wallet"></i><div class="stat-info"><h3>Bulletins</h3><p>${portal.payslips.length}</p></div></div>
                    <div class="stat-card"><i class="fas fa-umbrella-beach"></i><div class="stat-info"><h3>Solde congés</h3><p>${portal.leave_balance} j</p></div></div>
                    <div class="stat-card"><i class="fas fa-clock"></i><div class="stat-info"><h3>Présences (mois)</h3><p>${portal.attendance_summary.present}</p></div></div>
                    <div class="stat-card"><i class="fas fa-bell"></i><div class="stat-info"><h3>Notifications</h3><p>${portal.notifications.length}</p></div></div>
                </div>
            </div>

            <div class="portail-section panel" id="tab-profil">
                <h3>Informations personnelles</h3>
                <div class="form-row">
                    <div><strong>Nom</strong><br>${emp.nom || "-"}</div>
                    <div><strong>Postnom</strong><br>${emp.postnom || "-"}</div>
                    <div><strong>Prénom</strong><br>${emp.prenom || "-"}</div>
                    <div><strong>Sexe</strong><br>${emp.gender_label || emp.gender}</div>
                    <div><strong>Naissance</strong><br>${emp.date_of_birth || "-"}</div>
                    <div><strong>Nationalité</strong><br>${emp.nationality || "-"}</div>
                </div>
                <h3 style="margin-top:16px">Contact</h3>
                <div class="form-row">
                    <input id="prof-phone" value="${emp.phone_number || ""}" placeholder="Téléphone">
                    <input id="prof-email" value="${emp.email || ""}" placeholder="Email">
                    <input id="prof-address" value="${emp.address || ""}" placeholder="Adresse">
                    <input id="prof-urgence-nom" value="${emp.emergency_contact_name || ""}" placeholder="Contact urgence">
                    <input id="prof-urgence-tel" value="${emp.emergency_contact_phone || ""}" placeholder="Tél. urgence">
                </div>
                ${isEmployee ? `<button class="btn btn-primary" style="margin-top:12px" onclick="saveProfile()">Mettre à jour</button>` : `<p class="hint-text">La mise à jour du profil est réservée à l'employé connecté.</p>`}
                <h3 style="margin-top:20px">Informations professionnelles</h3>
                <p>Matricule: ${emp.matricule} | Fonction: ${emp.position} | Grade: ${emp.grade || "-"}</p>
                <p>Département: ${emp.department_name || "-"} | Contrat: ${emp.contract_type} | Embauche: ${emp.hire_date}</p>
                <p>CNSS: ${emp.cnss_number || "-"} | Fiscal: ${emp.fiscal_number || "-"}</p>
            </div>

            <div class="portail-section panel" id="tab-bulletins">
                <h3>Historique des bulletins de paie</h3>
                <table><thead><tr><th>Période</th><th>Devise</th><th>Brut</th><th>Net</th><th>Statut</th><th>Actions</th></tr></thead>
                <tbody>${portal.payslips.map((p) => `<tr>
                    <td>${p.month}</td>
                    <td>${p.currency || "USD"}</td>
                    <td>${formatMoney(p.gross_salary, p.currency)}</td>
                    <td><strong>${formatMoney(p.net_salary, p.currency)}</strong></td>
                    <td>${statusBadge(p.status)}</td>
                    <td style="white-space:nowrap">
                        <button class="btn btn-small btn-secondary" onclick="previewPay(${p.id})" title="Aperçu PDF"><i class="fas fa-eye"></i></button>
                        <button class="btn btn-small" onclick="dlPay(${p.id},'pdf')" title="PDF"><i class="fas fa-file-pdf"></i></button>
                        <button class="btn btn-small" onclick="dlPay(${p.id},'excel')" title="Excel"><i class="fas fa-file-excel"></i></button>
                        <button class="btn btn-small" onclick="dlPay(${p.id},'word')" title="Word"><i class="fas fa-file-word"></i></button>
                    </td></tr>`).join("") || "<tr><td colspan='6'>Aucun bulletin disponible</td></tr>"}
                </tbody></table>
                ${portal.export_history && portal.export_history.length ? `
                <h4 style="margin-top:20px">Historique des téléchargements</h4>
                <table><thead><tr><th>Date</th><th>Fichier</th><th>Format</th></tr></thead>
                <tbody>${portal.export_history.map((x) => `<tr>
                    <td>${new Date(x.exported_at).toLocaleString("fr-FR")}</td>
                    <td>${x.filename}</td><td>${x.format.toUpperCase()}</td>
                </tr>`).join("")}</tbody></table>` : ""}
            </div>

            <div class="portail-section panel" id="tab-conges">
                <div class="action-bar"><h3>Mes Congés — Solde: ${portal.leave_balance} jours</h3>
                    <button class="btn btn-primary" onclick="requestLeave()"><i class="fas fa-plus"></i> Demander un congé</button></div>
                <table><thead><tr><th>Type</th><th>Début</th><th>Fin</th><th>Statut</th><th>Motif</th></tr></thead>
                <tbody>${portal.absences.map((a) => `<tr><td>${a.absence_type}</td><td>${a.start_date}</td><td>${a.end_date}</td>
                    <td>${statusBadge(a.status)}</td><td>${a.reason || "-"}</td></tr>`).join("")}</tbody></table>
            </div>

            <div class="portail-section panel" id="tab-presences">
                <h3>Présences du mois</h3>
                <p>Présents: ${portal.attendance_summary.present} | Retards: ${portal.attendance_summary.late} | Absents: ${portal.attendance_summary.absent}</p>
                <table><thead><tr><th>Date</th><th>Entrée</th><th>Sortie</th><th>Statut</th></tr></thead>
                <tbody>${portal.attendances.map((a) => `<tr><td>${a.date}</td><td>${a.check_in || "-"}</td><td>${a.check_out || "-"}</td><td>${a.status}</td></tr>`).join("") || "<tr><td colspan='4'>Aucune donnée</td></tr>"}</tbody></table>
                <h3 style="margin-top:16px">Missions</h3>
                <table><thead><tr><th>Titre</th><th>Destination</th><th>Période</th><th>Statut</th></tr></thead>
                <tbody>${portal.missions.map((m) => `<tr><td>${m.title}</td><td>${m.destination}</td><td>${m.start_date} → ${m.end_date}</td><td>${m.status}</td></tr>`).join("") || "<tr><td colspan='4'>Aucune mission</td></tr>"}</tbody></table>
            </div>

            <div class="portail-section panel" id="tab-evaluations">
                <h3>Mes Évaluations</h3>
                ${portal.reviews.map((r) => `<div class="portail-card" style="margin-bottom:10px">
                    <strong>${r.review_date}</strong> — ${typeof starRatingHtml === "function" ? starRatingHtml(r.star_rating || Math.round(r.score / 20)) : `${r.score}/100`}
                    — ${r.result || ""} — ${statusBadge(r.status)}
                    <p><em>Période:</em> ${r.evaluation_period || "-"}</p>
                    ${r.comments_strengths ? `<p><em>Points forts:</em> ${r.comments_strengths}</p>` : ""}
                    ${r.comments_weaknesses ? `<p><em>Points faibles:</em> ${r.comments_weaknesses}</p>` : ""}
                    <p><em>Commentaires:</em> ${r.comments || "-"}</p>
                </div>`).join("") || "<p>Aucune évaluation</p>"}
            </div>

            <div class="portail-section panel" id="tab-formations">
                <h3>Mes Formations</h3>
                ${portal.trainings.map((t) => `<div class="portail-card" style="margin-bottom:10px">
                    <strong>${t.title}</strong> (${t.training_type}) — ${t.start_date} au ${t.end_date}
                    ${t.certification ? `<p>Certification: ${t.certification}</p>` : ""}
                </div>`).join("") || "<p>Aucune formation</p>"}
                ${portal.training_results?.length ? `<h4>Résultats</h4>${portal.training_results.map((r) =>
                    `<p>${r.training_title}: ${r.score || "-"}/100 — ${r.certification_obtained || ""}</p>`).join("")}` : ""}
            </div>

            <div class="portail-section panel" id="tab-documents">
                <h3>Documents RH</h3>
                <table><thead><tr><th>Titre</th><th>Type</th><th>Date</th><th>Télécharger</th></tr></thead>
                <tbody>${portal.documents.map((d) => `<tr>
                    <td>${d.title}</td><td>${d.document_type || "-"}</td>
                    <td>${new Date(d.uploaded_at).toLocaleDateString("fr-FR")}</td>
                    <td>${d.file ? `<a class="btn btn-small" href="${API_HOST}${d.file}" target="_blank"><i class="fas fa-download"></i></a>` : "—"}</td>
                </tr>`).join("") || "<tr><td colspan='4'>Aucun document</td></tr>"}</tbody></table>
            </div>

            <div class="portail-section panel" id="tab-attestations">
                <h3>Mes attestations</h3>
                <table><thead><tr><th>Titre</th><th>Type</th><th>Date</th></tr></thead>
                <tbody>${portal.documents.filter((d) => (d.document_type || "").toLowerCase().includes("attest")).map((d) =>
                    `<tr><td>${d.title}</td><td>${d.document_type}</td><td>${new Date(d.uploaded_at).toLocaleDateString("fr-FR")}</td></tr>`
                ).join("") || "<tr><td colspan='3'>Aucune attestation</td></tr>"}</tbody></table>
            </div>

            <div class="portail-section panel" id="tab-carriere">
                <h3>Mon évolution de carrière</h3>
                <div class="portail-card">
                    <p><strong>Poste actuel :</strong> ${emp.position} (${emp.grade || "-"})</p>
                    <p><strong>Département :</strong> ${emp.department_name || "-"}</p>
                    <p><strong>Date d'embauche :</strong> ${emp.hire_date} | <strong>Ancienneté :</strong> ${emp.seniority_years} ans</p>
                    <p><strong>Évaluations validées :</strong> ${portal.reviews.filter((r) => r.status === "Validated").length}</p>
                </div>
            </div>

            <div class="portail-section panel" id="tab-certifications">
                <h3>Mes certifications</h3>
                ${(portal.certifications || []).map((c) => `<div class="portail-card">
                    <strong>${c.title}</strong> — ${c.issuing_organization || ""}
                    <br>Émise: ${c.issue_date} | Expire: ${c.expiry_date || "—"}
                    ${typeof certExpiryBadge === "function" ? certExpiryBadge(c.expiry_status, c.expiry_status_label) : ""}
                </div>`).join("") || portal.training_results?.filter((r) => r.certification_obtained).map((r) =>
                    `<div class="portail-card"><strong>${r.training_title}</strong> — ${r.certification_obtained}</div>`
                ).join("") || "<p>Aucune certification</p>"}
            </div>

            <div class="portail-section panel" id="tab-historique">
                <h3>Mon historique professionnel</h3>
                <div class="timeline">
                    <div class="timeline-item"><strong>${emp.hire_date}</strong> — Embauche : ${emp.position}</div>
                    ${portal.missions.map((m) => `<div class="timeline-item"><strong>${m.start_date}</strong> — Mission : ${m.title} (${m.destination})</div>`).join("")}
                    ${portal.reviews.map((r) => `<div class="timeline-item"><strong>${r.review_date}</strong> — Évaluation : ${r.result || r.score + "/100"} ${typeof starRatingHtml === "function" ? starRatingHtml(r.star_rating || Math.round(r.score / 20)) : ""}</div>`).join("")}
                </div>
            </div>

            <div class="portail-section panel" id="tab-notifications">
                <h3>Notifications</h3>
                ${portal.notifications.map((n) => `<div class="notif-item unread">
                    <strong>${n.title}</strong><br>${n.message}<br>
                    <small>${new Date(n.created_at).toLocaleString("fr-FR")}</small>
                </div>`).join("") || "<p>Aucune notification</p>"}
            </div>`;

        document.querySelectorAll(".portail-section").forEach((s) => {
            const key = s.id.replace("tab-", "");
            const visible = activePortalKeys.has(key);
            s.classList.toggle("active", visible && key === portalTabs[0]?.feature_key);
            if (!visible) s.style.display = "none";
        });
        document.querySelectorAll(".portail-tab").forEach((tab) => {
            tab.onclick = () => {
                document.querySelectorAll(".portail-tab").forEach((t) => t.classList.remove("active"));
                document.querySelectorAll(".portail-section").forEach((s) => s.classList.remove("active"));
                tab.classList.add("active");
                const sec = document.getElementById(`tab-${tab.dataset.tab}`);
                if (sec) { sec.classList.add("active"); sec.style.display = "block"; }
            };
        });
    } catch (e) { contentArea.innerHTML = `<p class="error-message">${e.message}</p>`; }
}

window.changePortalEmployee = (id) => {
    window._portalEmployeeId = Number(id);
    renderPortailEmploye();
};

window.saveProfile = async () => {
    await apiFetch("/employee-portal/profile/", {
        method: "PUT",
        body: JSON.stringify({
            phone_number: document.getElementById("prof-phone").value,
            email: document.getElementById("prof-email").value,
            address: document.getElementById("prof-address").value,
            emergency_contact_name: document.getElementById("prof-urgence-nom").value,
            emergency_contact_phone: document.getElementById("prof-urgence-tel").value,
        }),
    });
    alert("Profil mis à jour.");
    renderPortailEmploye();
};

// --- Reporting ---
function getReportWidgetValue(stats, source, config) {
    if (source === "payroll_mass") return formatMoney(stats.payroll_mass);
    if (source === "gender_distribution") return `${stats.gender_distribution.hommes} H / ${stats.gender_distribution.femmes} F`;
    if (source === "absenteeism_rate") return `${stats.absenteeism_rate}${config?.suffix || "%"}`;
    return stats[source] ?? "-";
}

function buildReportChart(canvasId, widget, stats) {
    const cfg = widget.config || {};
    const src = cfg.data_source;
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    let chartConfig = null;
    if (src === "department_distribution") {
        chartConfig = { type: cfg.chart_type || "bar", data: {
            labels: stats.department_distribution.map((d) => d.name),
            datasets: [{ label: "Employés", data: stats.department_distribution.map((d) => d.count), backgroundColor: "#1a5f9e" }],
        }};
    } else if (src === "gender_distribution") {
        chartConfig = { type: cfg.chart_type || "doughnut", data: {
            labels: ["Hommes", "Femmes"],
            datasets: [{ data: [stats.gender_distribution.hommes, stats.gender_distribution.femmes], backgroundColor: ["#1a5f9e", "#e74c3c"] }],
        }};
    } else if (src === "monthly_headcount") {
        chartConfig = { type: "line", data: {
            labels: stats.monthly_headcount.map((m) => m.month),
            datasets: [{ label: "Effectif", data: stats.monthly_headcount.map((m) => m.count), borderColor: "#1a5f9e", tension: 0.3, fill: true, backgroundColor: "rgba(26,95,158,0.1)" }],
        }};
    } else if (src === "monthly_absences") {
        chartConfig = { type: "bar", data: {
            labels: stats.monthly_absences.map((m) => m.month),
            datasets: [{ label: "Absences", data: stats.monthly_absences.map((m) => m.count), backgroundColor: "#e67e22" }],
        }};
    } else if (src === "hr_comparison") {
        chartConfig = { type: "bar", data: {
            labels: stats.hr_comparison.labels,
            datasets: [{ label: "Indicateurs RH", data: stats.hr_comparison.values, backgroundColor: ["#1a5f9e", "#27ae60", "#8e44ad", "#e74c3c", "#f39c12"] }],
        }};
    }
    if (chartConfig) {
        const chart = new Chart(ctx, { ...chartConfig, options: { responsive: true, animation: { duration: 800 }, plugins: { legend: { display: chartConfig.type !== "bar" } } } });
        reportCharts.push(chart);
    }
}

async function renderReporting() {
    destroyReportCharts();
    const widgets = getActiveFeatures("reporting", "report_widget");
    const title = getModuleTitle("reporting", "Reporting & Statistiques");
    const currentFilter = window._reportFilter || "all";
    contentArea.innerHTML = `
        <div class="module-container animated-panel">
            <div class="action-bar"><h2>${title}</h2>
                <div class="export-bar">
                    <select id="report-filter" class="filter-select" onchange="window._reportFilter=this.value;renderReporting()">
                        <option value="all" ${currentFilter === "all" ? "selected" : ""}>Tous les indicateurs</option>
                        <option value="stat" ${currentFilter === "stat" ? "selected" : ""}>Statistiques</option>
                        <option value="chart" ${currentFilter === "chart" ? "selected" : ""}>Graphiques</option>
                    </select>
                    <button class="btn btn-primary" onclick="exportReport('pdf')"><i class="fas fa-file-pdf"></i> PDF</button>
                    <button class="btn btn-secondary" onclick="exportReport('excel')"><i class="fas fa-file-excel"></i> Excel</button>
                    <button class="btn btn-secondary" onclick="exportReport('word')"><i class="fas fa-file-word"></i> Word</button>
                </div>
            </div>
            <div id="report-widgets" class="reporting-layout"></div>
        </div>`;
    const s = await apiGet("/dashboard/");
    const filter = currentFilter;
    const activeWidgets = widgets.length ? widgets : [];
    const container = document.getElementById("report-widgets");
    let chartIdx = 0;
    container.innerHTML = activeWidgets.map((w) => {
        const cfg = w.config || {};
        if (filter === "stat" && cfg.widget_type !== "stat") return "";
        if (filter === "chart" && cfg.widget_type !== "chart") return "";
        if (cfg.widget_type === "chart") {
            const id = `report-chart-${chartIdx++}`;
            return `<div class="chart-card chart-animated"><h3>${w.icon ? `<i class="fas ${w.icon}"></i> ` : ""}${w.feature_name}</h3><canvas id="${id}"></canvas></div>`;
        }
        return `<div class="stat-card stat-animated"><i class="fas ${w.icon || "fa-chart-bar"}"></i>
            <div class="stat-info"><h3>${w.feature_name}</h3><p class="report-stat-val" data-source="${cfg.data_source}" data-format="${cfg.format || ""}" data-suffix="${cfg.suffix || ""}">--</p></div></div>`;
    }).join("") || `<p class="feature-help">Aucun widget configuré. Paramètres → Personnalisation → Reporting.</p>`;
    document.querySelectorAll(".report-stat-val").forEach((el) => {
        const src = el.dataset.source;
        const val = getReportWidgetValue(s, src, { format: el.dataset.format, suffix: el.dataset.suffix });
        if (el.dataset.format === "money") {
            animateCounter(el, s.payroll_mass, { format: "money" });
        } else if (src === "absenteeism_rate") {
            animateCounter(el, s.absenteeism_rate, { suffix: "%" });
        } else if (typeof s[src] === "number") {
            animateCounter(el, s[src]);
        } else {
            el.textContent = val;
        }
    });
    chartIdx = 0;
    activeWidgets.forEach((w) => {
        if ((w.config || {}).widget_type === "chart") {
            buildReportChart(`report-chart-${chartIdx++}`, w, s);
        }
    });
}
window.exportReport = async (fmt) => {
    const r = await apiGet(`/export/${fmt}/`);
    window.open(`${API_HOST}${r.url}`, "_blank");
};

window.loadModule = loadModule;

// --- Personnalisation des modules ---
async function renderModuleCustomizationPanel() {
    const root = document.getElementById("customization-root");
    if (!root) return;
    root.innerHTML = `<div class="loader">Chargement des modules...</div>`;
    try {
        customizationModules = await apiGet("/modules/");
        if (!selectedCustomizationModuleId && customizationModules.length) {
            selectedCustomizationModuleId = customizationModules[0].id;
        }
        root.innerHTML = `
            <div class="customization-layout">
                <div class="customization-sidebar panel">
                    <div class="action-bar">
                        <h4>Modules</h4>
                        <button class="btn btn-small btn-primary" onclick="showModuleModal()" title="Ajouter"><i class="fas fa-plus"></i></button>
                    </div>
                    <div id="custom-module-list"></div>
                </div>
                <div class="customization-main panel" id="customization-detail">
                    <p class="feature-help">Sélectionnez un module pour gérer ses fonctionnalités et champs.</p>
                </div>
            </div>
            <div id="custom-modal" class="custom-modal" hidden>
                <div class="custom-modal-content panel">
                    <h3 id="custom-modal-title">Formulaire</h3>
                    <div id="custom-modal-body"></div>
                    <div class="action-bar" style="margin-top:16px">
                        <button class="btn btn-primary" id="custom-modal-save">Enregistrer</button>
                        <button class="btn btn-secondary" onclick="closeCustomModal()">Annuler</button>
                    </div>
                </div>
            </div>`;
        renderCustomizationModuleList();
        if (selectedCustomizationModuleId) renderCustomizationDetail(selectedCustomizationModuleId);
    } catch (e) {
        root.innerHTML = `<p class="error-message">${e.message}</p>`;
    }
}

function renderCustomizationModuleList() {
    const list = document.getElementById("custom-module-list");
    if (!list) return;
    list.innerHTML = customizationModules.map((m) => `
        <div class="custom-module-item ${m.id === selectedCustomizationModuleId ? "active" : ""}" onclick="selectCustomizationModule(${m.id})">
            <div>
                <i class="fas ${m.icon || "fa-cube"}"></i>
                <strong>${m.name}</strong>
                <small>${m.is_active ? "Actif" : "Inactif"} — ${m.features_count || 0} fonc. / ${m.fields_count || 0} champs</small>
            </div>
            <div class="custom-item-actions">
                <button class="btn btn-small" onclick="event.stopPropagation();moveModuleOrder(${m.id},-1)" title="Monter"><i class="fas fa-arrow-up"></i></button>
                <button class="btn btn-small" onclick="event.stopPropagation();moveModuleOrder(${m.id},1)" title="Descendre"><i class="fas fa-arrow-down"></i></button>
                <button class="btn btn-small" onclick="event.stopPropagation();toggleModuleActive(${m.id})" title="Activer/Désactiver"><i class="fas fa-eye${m.is_active ? "" : "-slash"}"></i></button>
            </div>
        </div>`).join("");
}

async function selectCustomizationModule(id) {
    selectedCustomizationModuleId = id;
    renderCustomizationModuleList();
    await renderCustomizationDetail(id);
}

async function renderCustomizationDetail(moduleId) {
    const detail = document.getElementById("customization-detail");
    const mod = await apiGet(`/modules/${moduleId}/`);
    detail.innerHTML = `
        <div class="action-bar">
            <div>
                <h3><i class="fas ${mod.icon}"></i> ${mod.name}</h3>
                <p class="feature-help">${mod.description || "Aucune description"}</p>
            </div>
            <div>
                <button class="btn btn-small btn-secondary" onclick="showModuleModal(${mod.id})" title="Modifier"><i class="fas fa-edit"></i></button>
                <button class="btn btn-small btn-danger" onclick="deleteModule(${mod.id})" title="Supprimer"><i class="fas fa-trash"></i></button>
            </div>
        </div>
        <h4>Fonctionnalités <button class="btn btn-small btn-primary" onclick="showFeatureModal()" title="Ajouter"><i class="fas fa-plus"></i></button></h4>
        <div id="feature-list">${renderFeatureRows(mod.features)}</div>
        <h4 style="margin-top:20px">Champs personnalisés <button class="btn btn-small btn-primary" onclick="showFieldModal()" title="Ajouter"><i class="fas fa-plus"></i></button></h4>
        <div id="field-list">${renderFieldRows(mod.custom_fields)}</div>`;
}

function renderFeatureRows(features) {
    if (!features?.length) return `<p class="feature-help">Aucune fonctionnalité — cliquez sur ➕ pour en ajouter.</p>`;
    return features.sort((a, b) => a.display_order - b.display_order).map((f) => `
        <div class="custom-row">
            <div>
                <strong>${f.feature_name}</strong> <span class="badge-status badge-draft">${f.feature_type}</span>
                ${f.is_active ? "" : '<span class="badge-status badge-archived">Désactivé</span>'}
                <br><small>${f.description || f.feature_key}</small>
            </div>
            <div class="custom-item-actions">
                <button class="btn btn-small" onclick="moveFeatureOrder(${f.id},-1)" title="Monter"><i class="fas fa-arrow-up"></i></button>
                <button class="btn btn-small" onclick="moveFeatureOrder(${f.id},1)" title="Descendre"><i class="fas fa-arrow-down"></i></button>
                <button class="btn btn-small" onclick="showFeatureModal(${f.id})" title="Modifier"><i class="fas fa-edit"></i></button>
                <button class="btn btn-small" onclick="toggleFeatureActive(${f.id})" title="Activer/Désactiver"><i class="fas fa-eye${f.is_active ? "" : "-slash"}"></i></button>
                <button class="btn btn-small btn-danger" onclick="deleteFeature(${f.id})" title="Supprimer"><i class="fas fa-trash"></i></button>
            </div>
        </div>`).join("");
}

function renderFieldRows(fields) {
    if (!fields?.length) return `<p class="feature-help">Aucun champ personnalisé — cliquez sur ➕ pour en ajouter.</p>`;
    return fields.sort((a, b) => a.display_order - b.display_order).map((f) => `
        <div class="custom-row">
            <div>
                <strong>${f.field_name}</strong> <span class="badge-status badge-pending">${f.field_type}</span>
                ${f.required ? '<span class="badge-status badge-validated">Obligatoire</span>' : ""}
                ${f.visible ? "" : '<span class="badge-status badge-archived">Masqué</span>'}
                <br><small>${f.description || f.field_key}</small>
            </div>
            <div class="custom-item-actions">
                <button class="btn btn-small" onclick="moveFieldOrder(${f.id},-1)" title="Monter"><i class="fas fa-arrow-up"></i></button>
                <button class="btn btn-small" onclick="moveFieldOrder(${f.id},1)" title="Descendre"><i class="fas fa-arrow-down"></i></button>
                <button class="btn btn-small" onclick="showFieldModal(${f.id})" title="Modifier"><i class="fas fa-edit"></i></button>
                <button class="btn btn-small" onclick="toggleFieldVisible(${f.id})" title="Visible/Masqué"><i class="fas fa-eye${f.visible ? "" : "-slash"}"></i></button>
                <button class="btn btn-small btn-danger" onclick="deleteField(${f.id})" title="Supprimer"><i class="fas fa-trash"></i></button>
            </div>
        </div>`).join("");
}

function closeCustomModal() {
    const m = document.getElementById("custom-modal");
    if (m) m.hidden = true;
}

function openCustomModal(title, bodyHtml, onSave) {
    document.getElementById("custom-modal-title").textContent = title;
    document.getElementById("custom-modal-body").innerHTML = bodyHtml;
    document.getElementById("custom-modal").hidden = false;
    document.getElementById("custom-modal-save").onclick = onSave;
}

window.showModuleModal = async (id) => {
    let data = { key: "", name: "", description: "", icon: "fa-cube", allowed_roles: "ADMIN_RH", is_active: true, display_order: 0 };
    if (id) data = await apiGet(`/modules/${id}/`);
    openCustomModal(id ? "Modifier le module" : "Ajouter un module", `
        <div class="form-row">
            <div><label>Clé technique</label><input id="cm-key" value="${data.key}" ${id ? "readonly" : ""}></div>
            <div><label>Nom affiché</label><input id="cm-name" value="${data.name}"></div>
            <div><label>Icône (FontAwesome)</label><input id="cm-icon" value="${data.icon || "fa-cube"}"></div>
            <div><label>Rôles autorisés</label><input id="cm-roles" value="${data.allowed_roles}"></div>
        </div>
        <div><label>Description</label><textarea id="cm-desc" rows="2">${data.description || ""}</textarea></div>
    `, async () => {
        const payload = {
            key: document.getElementById("cm-key").value.trim(),
            name: document.getElementById("cm-name").value.trim(),
            icon: document.getElementById("cm-icon").value.trim(),
            allowed_roles: document.getElementById("cm-roles").value.trim(),
            description: document.getElementById("cm-desc").value.trim(),
            is_active: true,
        };
        if (id) await apiFetch(`/modules/${id}/`, { method: "PATCH", body: JSON.stringify(payload) });
        else await apiPost("/modules/", payload);
        closeCustomModal();
        await loadModuleConfig();
        applyRoleMenu();
        await renderModuleCustomizationPanel();
    });
};

window.showFeatureModal = async (id) => {
    const modId = selectedCustomizationModuleId;
    let data = { module: modId, feature_key: "", feature_name: "", description: "", feature_type: "general", icon: "", config: {}, is_active: true, display_order: 0 };
    if (id) data = await apiGet(`/module-features/${id}/`);
    openCustomModal(id ? "Modifier la fonctionnalité" : "Ajouter une fonctionnalité", `
        <div class="form-row">
            <div><label>Clé</label><input id="cf-key" value="${data.feature_key}" ${id ? "readonly" : ""}></div>
            <div><label>Libellé</label><input id="cf-name" value="${data.feature_name}"></div>
            <div><label>Type</label><select id="cf-type">${FEATURE_TYPE_OPTIONS.map(([v, l]) => `<option value="${v}" ${data.feature_type === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
            <div><label>Icône</label><input id="cf-icon" value="${data.icon || ""}"></div>
        </div>
        <div><label>Description</label><textarea id="cf-desc" rows="2">${data.description || ""}</textarea></div>
        <div><label>Rôles autorisés (CSV, vide = tous)</label>
            <input id="cf-roles" value="${(data.config?.allowed_roles || []).join(", ")}" placeholder="ADMIN_RH, GESTIONNAIRE_RH"></div>
        <div><label>Configuration avancée (JSON)</label><textarea id="cf-config" rows="3">${JSON.stringify(data.config || {}, null, 2)}</textarea></div>
    `, async () => {
        let config = {};
        try { config = JSON.parse(document.getElementById("cf-config").value || "{}"); } catch (e) { return alert("JSON config invalide"); }
        const rolesStr = document.getElementById("cf-roles").value.trim();
        if (rolesStr) config.allowed_roles = rolesStr.split(",").map((s) => s.trim()).filter(Boolean);
        else delete config.allowed_roles;
        const payload = {
            module: modId,
            feature_key: document.getElementById("cf-key").value.trim(),
            feature_name: document.getElementById("cf-name").value.trim(),
            feature_type: document.getElementById("cf-type").value,
            icon: document.getElementById("cf-icon").value.trim(),
            description: document.getElementById("cf-desc").value.trim(),
            config,
            is_active: true,
        };
        if (id) await apiFetch(`/module-features/${id}/`, { method: "PATCH", body: JSON.stringify(payload) });
        else await apiPost("/module-features/", payload);
        closeCustomModal();
        await loadModuleConfig();
        await renderCustomizationDetail(modId);
        customizationModules = await apiGet("/modules/");
        renderCustomizationModuleList();
    });
};

window.showFieldModal = async (id) => {
    const modId = selectedCustomizationModuleId;
    let data = { module: modId, field_key: "", field_name: "", field_type: "text", description: "", required: false, visible: true, editable: true, default_value: "", options: [], display_order: 0 };
    if (id) data = await apiGet(`/custom-fields/${id}/`);
    openCustomModal(id ? "Modifier le champ" : "Ajouter un champ personnalisé", `
        <div class="form-row">
            <div><label>Clé</label><input id="cfd-key" value="${data.field_key}" ${id ? "readonly" : ""}></div>
            <div><label>Nom du champ</label><input id="cfd-name" value="${data.field_name}"></div>
            <div><label>Type</label><select id="cfd-type">${FIELD_TYPE_OPTIONS.map(([v, l]) => `<option value="${v}" ${data.field_type === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
            <div><label>Valeur par défaut</label><input id="cfd-default" value="${data.default_value || ""}"></div>
        </div>
        <div><label>Description</label><textarea id="cfd-desc" rows="2">${data.description || ""}</textarea></div>
        <div><label>Options (liste, séparées par virgule)</label><input id="cfd-options" value="${(data.options || []).join(", ")}"></div>
        <div class="form-row">
            <label><input type="checkbox" id="cfd-required" ${data.required ? "checked" : ""}> Obligatoire</label>
            <label><input type="checkbox" id="cfd-visible" ${data.visible ? "checked" : ""}> Visible</label>
            <label><input type="checkbox" id="cfd-editable" ${data.editable ? "checked" : ""}> Modifiable</label>
        </div>
    `, async () => {
        const opts = document.getElementById("cfd-options").value.split(",").map((s) => s.trim()).filter(Boolean);
        const payload = {
            module: modId,
            field_key: document.getElementById("cfd-key").value.trim(),
            field_name: document.getElementById("cfd-name").value.trim(),
            field_type: document.getElementById("cfd-type").value,
            description: document.getElementById("cfd-desc").value.trim(),
            default_value: document.getElementById("cfd-default").value,
            options: opts,
            required: document.getElementById("cfd-required").checked,
            visible: document.getElementById("cfd-visible").checked,
            editable: document.getElementById("cfd-editable").checked,
        };
        if (id) await apiFetch(`/custom-fields/${id}/`, { method: "PATCH", body: JSON.stringify(payload) });
        else await apiPost("/custom-fields/", payload);
        closeCustomModal();
        await loadModuleConfig();
        await renderCustomizationDetail(modId);
        customizationModules = await apiGet("/modules/");
        renderCustomizationModuleList();
    });
};

window.toggleModuleActive = async (id) => {
    await apiPost(`/modules/${id}/toggle/`, {});
    await loadModuleConfig();
    applyRoleMenu();
    customizationModules = await apiGet("/modules/");
    renderCustomizationModuleList();
    if (selectedCustomizationModuleId === id) await renderCustomizationDetail(id);
};

window.deleteModule = async (id) => {
    if (!confirm("Supprimer ce module et toutes ses fonctionnalités ?")) return;
    await apiDelete(`/modules/${id}/`);
    selectedCustomizationModuleId = null;
    await loadModuleConfig();
    applyRoleMenu();
    await renderModuleCustomizationPanel();
};

window.toggleFeatureActive = async (id) => {
    await apiPost(`/module-features/${id}/toggle/`, {});
    await loadModuleConfig();
    await renderCustomizationDetail(selectedCustomizationModuleId);
};

window.deleteFeature = async (id) => {
    if (!confirm("Supprimer cette fonctionnalité ?")) return;
    await apiDelete(`/module-features/${id}/`);
    await loadModuleConfig();
    await renderCustomizationDetail(selectedCustomizationModuleId);
};

window.toggleFieldVisible = async (id) => {
    await apiPost(`/custom-fields/${id}/toggle_visible/`, {});
    await loadModuleConfig();
    await renderCustomizationDetail(selectedCustomizationModuleId);
};

window.deleteField = async (id) => {
    if (!confirm("Supprimer ce champ ?")) return;
    await apiDelete(`/custom-fields/${id}/`);
    await loadModuleConfig();
    await renderCustomizationDetail(selectedCustomizationModuleId);
};

async function _swapOrder(items, id, direction, endpoint) {
    const sorted = [...items].sort((a, b) => a.display_order - b.display_order);
    const idx = sorted.findIndex((i) => i.id === id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
    await apiPost(`${endpoint}reorder/`, { ids: sorted.map((i) => i.id) });
}

window.moveModuleOrder = async (id, dir) => {
    await _swapOrder(customizationModules, id, dir, "/modules/");
    customizationModules = await apiGet("/modules/");
    await loadModuleConfig();
    applyRoleMenu();
    renderCustomizationModuleList();
};

window.moveFeatureOrder = async (id, dir) => {
    const mod = await apiGet(`/modules/${selectedCustomizationModuleId}/`);
    await _swapOrder(mod.features, id, dir, "/module-features/");
    await loadModuleConfig();
    await renderCustomizationDetail(selectedCustomizationModuleId);
};

window.moveFieldOrder = async (id, dir) => {
    const mod = await apiGet(`/modules/${selectedCustomizationModuleId}/`);
    await _swapOrder(mod.custom_fields, id, dir, "/custom-fields/");
    await loadModuleConfig();
    await renderCustomizationDetail(selectedCustomizationModuleId);
};
