/**
 * OTOMIA RH — Centre de configuration Paramètres
 * Accessible : Administrateur RH, Super Administrateur
 */

const SETTINGS_MENU = [
    { id: "entreprise", icon: "fa-building", label: "Configuration Entreprise" },
    { id: "logo", icon: "fa-image", label: "Logo & Identité visuelle" },
    { id: "bulletins", icon: "fa-file-invoice-dollar", label: "Configuration Bulletins" },
    { id: "horaires", icon: "fa-clock", label: "Horaires de Travail" },
    { id: "rapports", icon: "fa-chart-bar", label: "Configuration Rapports RH" },
    { id: "modules", icon: "fa-puzzle-piece", label: "Personnalisation Modules" },
    { id: "champs", icon: "fa-list-alt", label: "Champs Personnalisés" },
    { id: "utilisateurs", icon: "fa-users", label: "Gestion Utilisateurs" },
    { id: "roles", icon: "fa-user-shield", label: "Rôles & Permissions" },
    { id: "systeme", icon: "fa-server", label: "Paramètres Système" },
    { id: "sauvegarde", icon: "fa-database", label: "Sauvegarde & Restauration" },
    { id: "audit", icon: "fa-clipboard-list", label: "Journal d'Audit" },
];

const IDENTITY_FIELDS = [
    ["company_name", "Raison sociale"], ["company_acronym", "Sigle"],
    ["company_slogan", "Slogan"], ["company_description", "Description"],
    ["rccm", "RCCM"], ["id_nat", "ID. NAT"], ["tax_number", "N° Impôt"],
    ["cnss_number", "N° CNSS"], ["vat_number", "N° TVA"], ["approval_number", "N° agrément"],
    ["other_legal_refs", "Autres références légales"],
    ["postal_address", "Adresse postale"], ["headquarters_address", "Siège social"],
    ["commune", "Commune"], ["city", "Ville"], ["province", "Province"], ["country", "Pays"],
    ["phone_primary", "Téléphone principal"], ["phone_secondary", "Téléphone secondaire"],
    ["email", "Email"], ["website", "Site web"],
    ["director_name", "Directeur Général"], ["hr_manager_name", "Responsable RH"],
    ["payroll_manager_name", "Responsable Paie"],
    ["hr_department", "Département RH"], ["payroll_department", "Service Paie"],
    ["billing_department", "Département Facturation"],
];

let settingsCompany = null;
let settingsSystem = null;
let activeSettingsSection = "entreprise";

function canAccessSettings() {
    return currentUser.role === "ADMIN_RH" || currentUser.role === "SUPER_ADMIN";
}

function _collectByPrefix(prefix, keys) {
    const data = {};
    keys.forEach((k) => {
        const el = document.getElementById(`${prefix}-${k}`);
        if (!el) return;
        if (el.type === "checkbox") data[k] = el.checked;
        else data[k] = el.value;
    });
    return data;
}

async function renderParametres() {
    if (!canAccessSettings()) {
        contentArea.innerHTML = `<p class="error-message">Accès réservé aux Administrateurs RH.</p>`;
        return;
    }
    contentArea.innerHTML = `
        <div class="page-header">
            <h1><i class="fas fa-cog"></i> Paramètres — Centre de Configuration OTOMIA RH</h1>
            <p>Configurez entièrement l'application sans modifier le code source</p>
        </div>
        <div class="settings-center">
            <nav class="settings-sidebar panel">
                ${SETTINGS_MENU.map((m) => `
                    <button class="settings-nav-item ${m.id === activeSettingsSection ? "active" : ""}"
                        onclick="loadSettingsSection('${m.id}')">
                        <i class="fas ${m.icon}"></i> ${m.label}
                    </button>`).join("")}
            </nav>
            <div class="settings-content panel" id="settings-content">
                <div class="loader">Chargement...</div>
            </div>
        </div>`;
    await loadSettingsSection(activeSettingsSection);
}

window.loadSettingsSection = async (section) => {
    activeSettingsSection = section;
    document.querySelectorAll(".settings-nav-item").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("onclick")?.includes(`'${section}'`));
    });
    const panel = document.getElementById("settings-content");
    if (!panel) return;
    panel.innerHTML = `<div class="loader">Chargement...</div>`;
    const loaders = {
        entreprise: renderSettingsEntreprise,
        logo: renderSettingsLogo,
        bulletins: renderSettingsBulletins,
        horaires: renderSettingsHoraires,
        rapports: renderSettingsRapports,
        modules: renderSettingsModules,
        champs: renderSettingsChamps,
        utilisateurs: renderSettingsUtilisateurs,
        roles: renderSettingsRoles,
        systeme: renderSettingsSysteme,
        sauvegarde: renderSettingsSauvegarde,
        audit: renderSettingsAudit,
    };
    await (loaders[section] || (() => { panel.innerHTML = "<p>Section introuvable.</p>"; }))();
};

async function renderSettingsEntreprise() {
    settingsCompany = await apiGet("/company-settings/");
    document.getElementById("settings-content").innerHTML = `
        <h3><i class="fas fa-building"></i> Configuration de l'Entreprise</h3>
        <p class="feature-help">Ces informations apparaissent sur les bulletins, rapports et documents générés.</p>
        <div class="payroll-edit-grid" id="identity-fields"></div>
        <button class="btn btn-primary" onclick="saveIdentitySettings()"><i class="fas fa-save"></i> Enregistrer</button>
        <p id="identity-feedback" class="feature-feedback" hidden></p>`;
    document.getElementById("identity-fields").innerHTML = IDENTITY_FIELDS.map(([k, label]) => {
        const isArea = k.includes("description") || k.includes("address") || k.includes("refs");
        const val = (settingsCompany[k] ?? "").toString();
        if (isArea) return `<div><label>${label}</label><textarea id="id-${k}" rows="2">${val}</textarea></div>`;
        return `<div><label>${label}</label><input id="id-${k}" value="${val.replace(/"/g, "&quot;")}"></div>`;
    }).join("");
}

window.saveIdentitySettings = async () => {
    const data = _collectByPrefix("id", IDENTITY_FIELDS.map(([k]) => k));
    await apiFetch("/company-settings/", { method: "PATCH", body: JSON.stringify(data) });
    applyCompanyBranding();
    const fb = document.getElementById("identity-feedback");
    if (fb) { fb.textContent = "Configuration entreprise enregistrée."; fb.hidden = false; }
};

async function renderSettingsLogo() {
    settingsCompany = await apiGet("/company-settings/");
    const c = settingsCompany;
    const logoSrc = c.logo_display_url
        ? (c.logo_display_url.startsWith("http") ? c.logo_display_url : `${API_HOST}${c.logo_display_url}`)
        : "";
    document.getElementById("settings-content").innerHTML = `
        <h3><i class="fas fa-image"></i> Logo & Identité Visuelle</h3>
        <div class="portail-header" style="margin-bottom:20px">
            <div id="logo-preview-box">
                ${logoSrc ? `<img class="portail-avatar" src="${logoSrc}" id="logo-preview">`
                    : `<div class="portail-avatar" style="display:flex;align-items:center;justify-content:center;background:#eaf4ff;color:#1a5f9e;font-weight:bold">${c.company_acronym}</div>`}
            </div>
            <div>
                <p><strong>Prévisualisation en temps réel</strong></p>
                <p>Fichier : <span id="logo-filename">${c.logo_filename || "Aucun"}</span></p>
                <p>Taille : <span id="logo-size">${c.logo_size_kb ? c.logo_size_kb + " Ko" : "-"}</span></p>
            </div>
        </div>
        <h4>Option A — Téléversement local (PNG, JPG, JPEG, SVG)</h4>
        <input type="file" id="logo-file" accept=".png,.jpg,.jpeg,.svg,.webp" style="margin-bottom:12px">
        <button class="btn btn-primary" onclick="uploadLogoFile()"><i class="fas fa-upload"></i> Téléverser</button>
        <h4 style="margin-top:20px">Option B — URL HTTPS</h4>
        <div class="form-row">
            <input type="url" id="logo-url-input" placeholder="https://entreprise.com/logo.png" value="${c.logo_url || ""}">
            <button class="btn btn-secondary" onclick="uploadLogoUrl()"><i class="fas fa-link"></i> Importer</button>
        </div>
        <p class="feature-help" style="margin-top:16px">Le logo est appliqué au login, tableau de bord, bulletins, rapports et exports.</p>`;
}

async function renderSettingsBulletins() {
    settingsCompany = await apiGet("/company-settings/");
    const c = settingsCompany;
    document.getElementById("settings-content").innerHTML = `
        <h3><i class="fas fa-file-invoice-dollar"></i> Configuration des Bulletins de Paie</h3>
        <div class="form-row">
            <div><label>Titre</label><input id="bl-bulletin_title" value="${c.bulletin_title}"></div>
            <div><label>Préfixe</label><input id="bl-bulletin_prefix" value="${c.bulletin_prefix}"></div>
            <div><label>Format numérotation</label><input id="bl-bulletin_number_format" value="${c.bulletin_number_format}"></div>
        </div>
        <div><label>Pied de page</label><textarea id="bl-bulletin_footer" rows="2">${c.bulletin_footer}</textarea></div>
        <div class="form-row" style="margin-top:12px">
            <label><input type="checkbox" id="bl-bulletin_qr_enabled" ${c.bulletin_qr_enabled ? "checked" : ""}> QR Code de vérification</label>
            <label><input type="checkbox" id="bl-bulletin_signature_enabled" ${c.bulletin_signature_enabled ? "checked" : ""}> Signatures numériques</label>
            <label><input type="checkbox" id="bl-bulletin_stamp_enabled" ${c.bulletin_stamp_enabled ? "checked" : ""}> Cachet numérique</label>
            <label><input type="checkbox" id="bl-inpp_enabled" ${c.inpp_enabled !== false ? "checked" : ""}> Retenue INPP (RDC)</label>
        </div>
        <p class="feature-help">Signataires : RH = ${c.hr_manager_name} | Direction = ${c.director_name}</p>
        <button class="btn btn-primary" style="margin-top:12px" onclick="saveBulletinSettings()">Enregistrer bulletins</button>`;
}

window.saveBulletinSettings = async () => {
    const data = _collectByPrefix("bl", [
        "bulletin_title", "bulletin_prefix", "bulletin_number_format", "bulletin_footer",
        "bulletin_qr_enabled", "bulletin_signature_enabled", "bulletin_stamp_enabled", "inpp_enabled",
    ]);
    await apiFetch("/company-settings/", { method: "PATCH", body: JSON.stringify(data) });
    alert("Configuration bulletins enregistrée.");
};

let settingsWorkSchedule = null;

async function renderSettingsHoraires() {
    settingsWorkSchedule = await apiGet("/work-schedule-settings/");
    const w = settingsWorkSchedule;
    document.getElementById("settings-content").innerHTML = `
        <h3><i class="fas fa-clock"></i> Horaires de Travail — Impact sur la Paie</h3>
        <p class="feature-help">Ces paramètres sont utilisés pour calculer les heures, retards, absences et heures supplémentaires dans la paie.</p>
        <div class="form-row">
            <div><label>Heure d'entrée</label><input type="time" id="wh-work_start" value="${w.work_start || "08:00"}"></div>
            <div><label>Heure de sortie</label><input type="time" id="wh-work_end" value="${w.work_end || "17:00"}"></div>
            <div><label>Pause déjeuner (min)</label><input type="number" id="wh-lunch_break_minutes" value="${w.lunch_break_minutes || 60}"></div>
        </div>
        <div class="form-row">
            <div><label>Heures / jour</label><input type="number" step="0.5" id="wh-hours_per_day" value="${w.hours_per_day || 8}"></div>
            <div><label>Heures / semaine</label><input type="number" step="0.5" id="wh-hours_per_week" value="${w.hours_per_week || 40}"></div>
            <div><label>Jours ouvrables / semaine</label><input type="number" id="wh-working_days_per_week" value="${w.working_days_per_week || 5}"></div>
            <div><label>Heures mensuelles prévues</label><input type="number" step="0.5" id="wh-monthly_hours" value="${w.monthly_hours || 208}"></div>
        </div>
        <h4 style="margin-top:16px;color:#1a5f9e">Coefficients Heures Supplémentaires</h4>
        <div class="form-row">
            <div><label>HS jour ouvrable (×)</label><input type="number" step="0.01" id="wh-overtime_rate_weekday" value="${w.overtime_rate_weekday || 1.25}"></div>
            <div><label>HS week-end (×)</label><input type="number" step="0.01" id="wh-overtime_rate_weekend" value="${w.overtime_rate_weekend || 1.5}"></div>
            <div><label>HS jour férié (×)</label><input type="number" step="0.01" id="wh-overtime_rate_holiday" value="${w.overtime_rate_holiday || 2}"></div>
        </div>
        <h4 style="margin-top:16px;color:#1a5f9e">Retenues Retards</h4>
        <div class="form-row">
            <label><input type="radio" name="late_mode" value="NONE" ${w.late_deduction_mode !== "AUTO" ? "checked" : ""}> Option A — Aucune retenue</label>
            <label><input type="radio" name="late_mode" value="AUTO" ${w.late_deduction_mode === "AUTO" ? "checked" : ""}> Option B — Retenue automatique</label>
        </div>
        <button class="btn btn-primary" style="margin-top:12px" onclick="saveWorkScheduleSettings()">Enregistrer horaires</button>`;
}

window.saveWorkScheduleSettings = async () => {
    const data = _collectByPrefix("wh", [
        "work_start", "work_end", "lunch_break_minutes",
        "hours_per_day", "hours_per_week", "working_days_per_week", "monthly_hours",
        "overtime_rate_weekday", "overtime_rate_weekend", "overtime_rate_holiday",
    ]);
    data.late_deduction_mode = document.querySelector('input[name="late_mode"]:checked')?.value || "NONE";
    await apiFetch("/work-schedule-settings/", { method: "PATCH", body: JSON.stringify(data) });
    alert("Horaires de travail enregistrés.");
};

async function renderSettingsRapports() {
    settingsCompany = await apiGet("/company-settings/");
    const c = settingsCompany;
    document.getElementById("settings-content").innerHTML = `
        <h3><i class="fas fa-chart-bar"></i> Configuration des Rapports RH</h3>
        <div class="form-row">
            <div><label>Titre principal</label><input id="rp-report_title" value="${c.report_title}"></div>
            <div><label>Sous-titre</label><input id="rp-report_subtitle" value="${c.report_subtitle}"></div>
            <div><label>Format numérotation</label><input id="rp-report_number_format" value="${c.report_number_format || "RPT-{year}-{num:04d}"}"></div>
            <div><label>Auteur</label><input id="rp-report_author" value="${c.report_author}"></div>
        </div>
        <div><label>Texte d'entête</label><input id="rp-report_header" value="${c.report_header || c.company_name}" style="width:100%"></div>
        <div><label>Pied de page</label><input id="rp-report_footer" value="${c.report_footer}" style="width:100%"></div>
        <label style="margin-top:10px;display:block"><input type="checkbox" id="rp-report_logo_enabled" ${c.report_logo_enabled !== false ? "checked" : ""}> Afficher le logo sur les rapports</label>
        <button class="btn btn-primary" style="margin-top:12px" onclick="saveReportSettings()">Enregistrer rapports</button>`;
}

window.saveReportSettings = async () => {
    const data = _collectByPrefix("rp", [
        "report_title", "report_subtitle", "report_header", "report_footer",
        "report_author", "report_number_format", "report_logo_enabled",
    ]);
    await apiFetch("/company-settings/", { method: "PATCH", body: JSON.stringify(data) });
    alert("Configuration rapports enregistrée.");
};

async function renderSettingsModules() {
    document.getElementById("settings-content").innerHTML = `
        <h3><i class="fas fa-puzzle-piece"></i> Personnalisation des Modules</h3>
        <p class="feature-help">➕ Ajouter · ✏️ Modifier · 🗑️ Supprimer · 👁️ Activer/Désactiver · 📌 Réorganiser</p>
        <div id="customization-root"><div class="loader">Chargement...</div></div>`;
    if (typeof renderModuleCustomizationPanel === "function") await renderModuleCustomizationPanel();
};

async function renderSettingsChamps() {
    const fields = await apiGet("/settings/custom-fields/");
    document.getElementById("settings-content").innerHTML = `
        <h3><i class="fas fa-list-alt"></i> Champs Personnalisés</h3>
        <p class="feature-help">Vue globale de tous les champs dynamiques par module.</p>
        <table><thead><tr><th>Module</th><th>Champ</th><th>Type</th><th>Obligatoire</th><th>Visible</th><th>Modifiable</th><th>Actions</th></tr></thead>
        <tbody>${fields.map((f) => `<tr>
            <td>${f.module_name || "-"}</td>
            <td><strong>${f.field_name}</strong><br><small>${f.field_key}</small></td>
            <td>${f.field_type}</td>
            <td>${f.required ? "Oui" : "Non"}</td>
            <td>${f.visible ? "Oui" : "Masqué"}</td>
            <td>${f.editable ? "Oui" : "Lecture seule"}</td>
            <td>
                <button class="btn btn-small" onclick="loadSettingsSection('modules')"><i class="fas fa-edit"></i></button>
            </td></tr>`).join("") || "<tr><td colspan='7'>Aucun champ — ajoutez-en via Personnalisation Modules</td></tr>"}
        </tbody></table>
        <button class="btn btn-primary" style="margin-top:12px" onclick="loadSettingsSection('modules')">
            <i class="fas fa-plus"></i> Gérer les champs par module
        </button>`;
}

async function renderSettingsUtilisateurs() {
    const users = await apiGet("/settings/users/");
    document.getElementById("settings-content").innerHTML = `
        <h3><i class="fas fa-users"></i> Gestion des Utilisateurs</h3>
        <div class="action-bar">
            <button class="btn btn-primary" onclick="showUserModal()"><i class="fas fa-plus"></i> Ajouter utilisateur</button>
        </div>
        <table><thead><tr><th>Utilisateur</th><th>Email</th><th>Rôle</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>${users.map((u) => `<tr>
            <td><strong>${u.username}</strong><br>${u.first_name || ""} ${u.last_name || ""}</td>
            <td>${u.email || "-"}</td>
            <td>${u.role_label || "-"}</td>
            <td>${u.is_active ? '<span class="badge-status badge-validated">Actif</span>' : '<span class="badge-status badge-archived">Suspendu</span>'}</td>
            <td style="white-space:nowrap">
                <button class="btn btn-small" onclick="resetUserPassword(${u.id},'${u.username}')" title="Réinitialiser MDP"><i class="fas fa-key"></i></button>
                ${u.is_active
                    ? `<button class="btn btn-small btn-danger" onclick="suspendUser(${u.id})" title="Suspendre"><i class="fas fa-ban"></i></button>`
                    : `<button class="btn btn-small btn-primary" onclick="activateUser(${u.id})" title="Activer"><i class="fas fa-check"></i></button>`}
            </td></tr>`).join("")}
        </tbody></table>
        <div id="user-modal" class="custom-modal" hidden>
            <div class="custom-modal-content panel">
                <h3>Nouvel utilisateur</h3>
                <div class="form-row">
                    <input id="nu-username" placeholder="Nom d'utilisateur">
                    <input id="nu-email" placeholder="Email">
                    <input id="nu-password" placeholder="Mot de passe" type="password">
                    <select id="nu-role">
                        <option value="EMPLOYE">Employé</option>
                        <option value="RESPONSABLE_HIERARCHIQUE">Responsable Hiérarchique</option>
                        <option value="GESTIONNAIRE_RH">Gestionnaire RH</option>
                        <option value="GESTIONNAIRE_PAIE">Gestionnaire Paie</option>
                        <option value="ADMIN_RH">Administrateur RH</option>
                        <option value="SUPER_ADMIN">Super Administrateur</option>
                    </select>
                </div>
                <button class="btn btn-primary" onclick="createUser()">Créer</button>
                <button class="btn btn-secondary" onclick="document.getElementById('user-modal').hidden=true">Annuler</button>
            </div>
        </div>`;
}

window.showUserModal = () => { document.getElementById("user-modal").hidden = false; };
window.createUser = async () => {
    await apiPost("/settings/users/", {
        username: document.getElementById("nu-username").value,
        email: document.getElementById("nu-email").value,
        password: document.getElementById("nu-password").value,
        role: document.getElementById("nu-role").value,
    });
    document.getElementById("user-modal").hidden = true;
    renderSettingsUtilisateurs();
};
window.suspendUser = async (id) => { await apiPost(`/settings/users/${id}/suspend/`, {}); renderSettingsUtilisateurs(); };
window.activateUser = async (id) => { await apiPost(`/settings/users/${id}/activate/`, {}); renderSettingsUtilisateurs(); };
window.resetUserPassword = async (id, name) => {
    const pwd = prompt(`Nouveau mot de passe pour ${name}:`, "otomia2026");
    if (!pwd) return;
    await apiPost(`/settings/users/${id}/reset_password/`, { password: pwd });
    alert(`Mot de passe réinitialisé pour ${name}.`);
};

async function renderSettingsRoles() {
    const roles = await apiGet("/settings/roles/");
    const modules = ["dashboard", "admin-personnel", "paie", "presences", "recrutement", "formation", "performances", "portail-employe", "reporting", "parametres"];
    document.getElementById("settings-content").innerHTML = `
        <h3><i class="fas fa-user-shield"></i> Rôles & Permissions</h3>
        ${roles.map((r) => `
            <div class="panel" style="margin-bottom:12px">
                <h4>${r.name} <small>(${r.code})</small></h4>
                <p class="feature-help">${r.description || ""}</p>
                <table><thead><tr><th>Module</th><th>Lecture</th><th>Écriture</th></tr></thead>
                <tbody>${modules.map((m) => {
                    const p = (r.permissions || {})[m] || {};
                    return `<tr><td>${m}</td>
                        <td><input type="checkbox" data-role="${r.id}" data-mod="${m}" data-perm="read" ${p.read ? "checked" : ""}></td>
                        <td><input type="checkbox" data-role="${r.id}" data-mod="${m}" data-perm="write" ${p.write ? "checked" : ""}></td></tr>`;
                }).join("")}</tbody></table>
                <button class="btn btn-small btn-primary" onclick="saveRolePermissions(${r.id})">Enregistrer permissions</button>
            </div>`).join("")}`;
}

window.saveRolePermissions = async (roleId) => {
    const perms = {};
    document.querySelectorAll(`input[data-role="${roleId}"]`).forEach((cb) => {
        const mod = cb.dataset.mod;
        if (!perms[mod]) perms[mod] = {};
        perms[mod][cb.dataset.perm] = cb.checked;
    });
    await apiFetch(`/settings/roles/${roleId}/`, { method: "PATCH", body: JSON.stringify({ permissions: perms }) });
    alert("Permissions enregistrées.");
};

async function renderSettingsSysteme() {
    settingsSystem = await apiGet("/system-settings/");
    const s = settingsSystem;
    document.getElementById("settings-content").innerHTML = `
        <h3><i class="fas fa-server"></i> Paramètres Système</h3>
        <div class="form-row">
            <div><label>Devise par défaut</label>
                <select id="sys-default_currency">
                    <option value="USD" ${s.default_currency === "USD" ? "selected" : ""}>USD</option>
                    <option value="CDF" ${s.default_currency === "CDF" ? "selected" : ""}>CDF</option>
                </select></div>
            <div><label>Format de date</label>
                <select id="sys-date_format">
                    <option value="DD/MM/YYYY" ${s.date_format === "DD/MM/YYYY" ? "selected" : ""}>JJ/MM/AAAA</option>
                    <option value="MM/DD/YYYY" ${s.date_format === "MM/DD/YYYY" ? "selected" : ""}>MM/JJ/AAAA</option>
                    <option value="YYYY-MM-DD" ${s.date_format === "YYYY-MM-DD" ? "selected" : ""}>AAAA-MM-JJ</option>
                </select></div>
            <div><label>Fuseau horaire</label><input id="sys-timezone" value="${s.timezone}"></div>
            <div><label>Langue</label>
                <select id="sys-language">
                    <option value="fr" ${s.language === "fr" ? "selected" : ""}>Français</option>
                    <option value="en" ${s.language === "en" ? "selected" : ""}>English</option>
                </select></div>
            <div><label>Format export par défaut</label>
                <select id="sys-export_format">
                    <option value="pdf" ${s.export_format === "pdf" ? "selected" : ""}>PDF</option>
                    <option value="excel" ${s.export_format === "excel" ? "selected" : ""}>Excel</option>
                    <option value="word" ${s.export_format === "word" ? "selected" : ""}>Word</option>
                </select></div>
        </div>
        <p class="feature-help">Version : ${s.system_version}</p>
        <button class="btn btn-primary" onclick="saveSystemSettings()">Enregistrer</button>`;
}

window.saveSystemSettings = async () => {
    const data = {
        default_currency: document.getElementById("sys-default_currency").value,
        date_format: document.getElementById("sys-date_format").value,
        timezone: document.getElementById("sys-timezone").value,
        language: document.getElementById("sys-language").value,
        export_format: document.getElementById("sys-export_format").value,
    };
    await apiFetch("/system-settings/", { method: "PATCH", body: JSON.stringify(data) });
    alert("Paramètres système enregistrés.");
};

async function renderSettingsSauvegarde() {
    const backups = await apiGet("/settings/backups/");
    document.getElementById("settings-content").innerHTML = `
        <h3><i class="fas fa-database"></i> Sauvegarde & Restauration</h3>
        <div class="action-bar">
            <button class="btn btn-primary" onclick="createBackup()"><i class="fas fa-download"></i> Créer une sauvegarde</button>
        </div>
        <h4>Sauvegardes disponibles</h4>
        <table><thead><tr><th>Fichier</th><th>Taille</th><th>Créé par</th><th>Date</th></tr></thead>
        <tbody>${backups.map((b) => `<tr>
            <td>${b.filename}</td><td>${b.size_kb} Ko</td>
            <td>${b.created_by_name || "-"}</td>
            <td>${new Date(b.created_at).toLocaleString("fr-FR")}</td></tr>`).join("")
            || "<tr><td colspan='4'>Aucune sauvegarde</td></tr>"}
        </tbody></table>
        <h4 style="margin-top:20px">Restaurer une sauvegarde</h4>
        <input type="file" id="restore-file" accept=".json">
        <button class="btn btn-secondary" style="margin-top:8px" onclick="restoreBackup()">Restaurer</button>`;
}

window.createBackup = async () => {
    await apiPost("/settings/backups/create_backup/", { notes: "Sauvegarde manuelle" });
    alert("Sauvegarde créée.");
    renderSettingsSauvegarde();
};

window.restoreBackup = async () => {
    const file = document.getElementById("restore-file").files[0];
    if (!file) return alert("Sélectionnez un fichier JSON.");
    if (!confirm("Restaurer cette sauvegarde ? Les paramètres actuels seront écrasés.")) return;
    const fd = new FormData();
    fd.append("file", file);
    await apiFormPost("/settings/backups/restore/", fd);
    alert("Restauration effectuée.");
    applyCompanyBranding();
};

async function renderSettingsAudit() {
    const logs = await apiGet("/audit-logs/");
    document.getElementById("settings-content").innerHTML = `
        <h3><i class="fas fa-clipboard-list"></i> Journal d'Audit</h3>
        <table><thead><tr><th>Utilisateur</th><th>Action</th><th>Module</th><th>Détails</th><th>IP</th><th>Date</th></tr></thead>
        <tbody>${logs.map((l) => `<tr>
            <td>${l.username || "Système"}</td>
            <td>${l.action}</td><td>${l.module}</td>
            <td>${l.details || "-"}</td>
            <td>${l.ip_address || "-"}</td>
            <td>${new Date(l.created_at).toLocaleString("fr-FR")}</td></tr>`).join("")
            || "<tr><td colspan='6'>Aucune activité</td></tr>"}
        </tbody></table>`;
}

// Logo upload (partagé)
window.uploadLogoFile = async () => {
    const file = document.getElementById("logo-file").files[0];
    if (!file) return alert("Sélectionnez un fichier.");
    const fd = new FormData();
    fd.append("logo", file);
    const r = await apiFormPost("/company-settings/logo/upload/", fd);
    if (r.logo_display_url) {
        const url = r.logo_display_url.startsWith("http") ? r.logo_display_url : `${API_HOST}${r.logo_display_url}`;
        document.getElementById("logo-preview-box").innerHTML = `<img class="portail-avatar" src="${url}" id="logo-preview">`;
    }
    applyCompanyBranding();
    alert("Logo enregistré.");
};

window.uploadLogoUrl = async () => {
    const url = document.getElementById("logo-url-input").value.trim();
    if (!url) return alert("Entrez une URL HTTPS.");
    const r = await apiPost("/company-settings/logo/url/", { logo_url: url });
    if (r.logo_display_url) {
        const src = r.logo_display_url.startsWith("http") ? r.logo_display_url : `${API_HOST}${r.logo_display_url}`;
        document.getElementById("logo-preview-box").innerHTML = `<img class="portail-avatar" src="${src}">`;
    }
    applyCompanyBranding();
    alert("Logo importé.");
};
