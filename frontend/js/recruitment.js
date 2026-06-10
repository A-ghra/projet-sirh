/**
 * Module Recrutement OTOMIA RH — gestion candidats, import, intégration employé.
 */
const APPLICANT_STATUS = {
    PENDING: "En attente",
    EVALUATING: "En cours d'évaluation",
    INTERVIEW_SCHEDULED: "Entretien programmé",
    INTERVIEW_DONE: "Entretien effectué",
    ACCEPTED: "Accepté",
    REJECTED: "Refusé",
};

const CONTRACT_TYPES = ["CDI", "CDD", "Stage", "Consultant", "Freelance", "Intérim"];
const USER_ROLES = [
    ["EMPLOYE", "Employé"],
    ["RESPONSABLE_HIERARCHIQUE", "Manager"],
    ["GESTIONNAIRE_RH", "Responsable RH"],
    ["GESTIONNAIRE_PAIE", "Gestionnaire Paie"],
    ["ADMIN_RH", "Administrateur RH"],
];

let _recApplicants = [];
let _recDepartments = [];
let _recRecruitments = [];
let _recSearchTimer = null;

function applicantStatusBadge(st) {
    const cls = { ACCEPTED: "badge-validated", REJECTED: "badge-archived", PENDING: "badge-pending" };
    return `<span class="badge-status ${cls[st] || "badge-draft"}">${APPLICANT_STATUS[st] || st}</span>`;
}

async function renderRecrutement() {
    const steps = getActiveFeatures("recrutement", "recruitment_step");
    const title = getModuleTitle("recrutement", "Recrutement");
    const canWrite = canWriteModule("recrutement");
    const stepsHtml = steps.length ? `
        <div class="workflow-steps animated-panel" style="margin-bottom:16px">
            ${steps.map((s, i) => `<span class="workflow-step ${i === 0 ? "current" : "done"}">${s.feature_name}</span>`).join("")}
        </div>` : "";

    contentArea.innerHTML = `
        <div class="module-container animated-panel">
            <div class="action-bar">
                <h2>${title}</h2>
                <div class="export-bar">
                    ${canWrite ? `
                        <button class="btn btn-secondary" onclick="showImportCandidatesModal()"><i class="fas fa-file-import"></i> Importer</button>
                        <button class="btn btn-primary" onclick="showApplicantForm()"><i class="fas fa-user-plus"></i> Nouveau candidat</button>
                    ` : ""}
                </div>
            </div>
            ${stepsHtml}
            <div id="rec-stats-bar" class="dashboard-grid" style="margin-bottom:16px"></div>
            <div class="form-row" style="margin-bottom:16px">
                <input id="rec-search" type="search" placeholder="🔍 Rechercher : nom, email, téléphone, poste, département, statut…" style="flex:1">
                <select id="rec-filter-status"><option value="">Tous statuts</option>
                    ${Object.entries(APPLICANT_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
                </select>
            </div>
            <table>
                <thead><tr>
                    <th>Photo</th><th>Candidat</th><th>Contact</th><th>Poste</th><th>Département</th>
                    <th>Statut</th><th>Score</th><th>Actions</th>
                </tr></thead>
                <tbody id="cand-list"></tbody>
            </table>
        </div>
        <div class="panel" style="margin-top:16px">
            <h3>Offres de recrutement</h3>
            <table><thead><tr><th>Poste</th><th>Statut</th><th>Candidats</th><th>Date</th></tr></thead>
            <tbody id="rec-list"></tbody></table>
        </div>`;

    document.getElementById("rec-search").oninput = () => {
        clearTimeout(_recSearchTimer);
        _recSearchTimer = setTimeout(loadApplicants, 300);
    };
    document.getElementById("rec-filter-status").onchange = loadApplicants;
    await refreshRecruitmentData();
}

window.refreshRecruitmentData = async function refreshRecruitmentData(options = {}) {
    if (!document.getElementById("cand-list")) return;
    await Promise.all([loadApplicants(), loadRecruitmentsList()]);
    try {
        const sync = await otomiaFetchSync();
        const r = sync.recruitment || {};
        const bar = document.getElementById("rec-stats-bar");
        if (bar) {
            bar.innerHTML = `
                <div class="stat-card stat-animated"><i class="fas fa-briefcase"></i><div class="stat-info"><h3>Offres ouvertes</h3><p>${r.open_recruitments || 0}</p></div></div>
                <div class="stat-card stat-animated"><i class="fas fa-users"></i><div class="stat-info"><h3>Candidatures</h3><p>${r.applicants_total || 0}</p></div></div>
                <div class="stat-card stat-animated"><i class="fas fa-calendar-check"></i><div class="stat-info"><h3>Entretiens</h3><p>${r.interview_scheduled || 0}</p></div></div>
                <div class="stat-card stat-animated"><i class="fas fa-check"></i><div class="stat-info"><h3>Acceptés</h3><p>${r.accepted || 0}</p></div></div>
                <div class="stat-card stat-animated"><i class="fas fa-times"></i><div class="stat-info"><h3>Refusés</h3><p>${r.rejected || 0}</p></div></div>
                <div class="stat-card stat-animated"><i class="fas fa-user-check"></i><div class="stat-info"><h3>Intégrés</h3><p>${r.hired || 0}</p></div></div>`;
        }
    } catch (e) { console.warn("Recruitment stats:", e.message); }
};

async function loadRecruitmentsList() {
    _recRecruitments = await apiGet("/recruitments/");
    const el = document.getElementById("rec-list");
    if (!el) return;
    el.innerHTML = _recRecruitments.map((r) =>
        `<tr><td>${r.job_title}</td><td>${r.status}</td><td>${r.applicants_count}</td><td>${r.posted_date || "—"}</td></tr>`
    ).join("") || "<tr><td colspan='4'>Aucune offre</td></tr>";
}

async function loadApplicants() {
    const q = document.getElementById("rec-search")?.value || "";
    const st = document.getElementById("rec-filter-status")?.value || "";
    let path = "/applicants/?";
    if (q) path += `q=${encodeURIComponent(q)}&`;
    if (st) path += `status=${encodeURIComponent(st)}&`;
    _recApplicants = await apiGet(path);
    renderApplicantsTable();
}

function renderApplicantsTable() {
    const el = document.getElementById("cand-list");
    if (!el) return;
    const canWrite = canWriteModule("recrutement");
    el.innerHTML = _recApplicants.map((c) => {
        const photo = c.photo_url
            ? `<img src="${API_HOST}${c.photo_url}" class="applicant-thumb" alt="">`
            : `<span class="applicant-thumb-placeholder"><i class="fas fa-user"></i></span>`;
        return `<tr>
            <td>${photo}</td>
            <td><strong>${c.full_name || `${c.prenom} ${c.nom}`}</strong><br><small>${c.email}</small></td>
            <td>${c.phone || "—"}</td>
            <td>${c.position || c.job_title || "—"}</td>
            <td>${c.department_name || "—"}</td>
            <td>${applicantStatusBadge(c.status)}</td>
            <td>${c.score ?? 0}</td>
            <td style="white-space:nowrap">
                ${c.resume_url ? `<button class="btn btn-small btn-secondary" onclick="viewApplicantCV(${c.id})" title="Consulter CV"><i class="fas fa-file-alt"></i></button>` : ""}
                ${canWrite ? `<button class="btn btn-small" onclick="showApplicantForm(${c.id})" title="Modifier"><i class="fas fa-edit"></i></button>` : ""}
                ${canWrite && c.status === "ACCEPTED" && !c.employee ? `<button class="btn btn-small btn-primary" onclick="hireApplicant(${c.id})" title="Intégrer comme employé"><i class="fas fa-user-check"></i></button>` : ""}
                ${c.employee_matricule ? `<span class="badge-status badge-validated">${c.employee_matricule}</span>` : ""}
            </td>
        </tr>`;
    }).join("") || "<tr><td colspan='8'>Aucun candidat trouvé</td></tr>";
}

window.viewApplicantCV = (id) => {
    const url = `${API_BASE_URL}/applicants/${id}/resume_file/?inline=1`;
    let modal = document.getElementById("cv-preview-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "cv-preview-modal";
        modal.className = "custom-modal";
        modal.innerHTML = `
            <div class="custom-modal-content panel cv-preview-panel">
                <div class="action-bar">
                    <h3><i class="fas fa-file-alt"></i> CV du candidat</h3>
                    <button class="btn btn-secondary" onclick="closeCVPreview()"><i class="fas fa-times"></i></button>
                </div>
                <iframe id="cv-preview-frame" title="Aperçu CV"></iframe>
                <div class="export-bar" style="margin-top:12px">
                    <a id="cv-preview-dl" class="btn btn-primary" href="#" target="_blank"><i class="fas fa-download"></i> Télécharger</a>
                    <button class="btn btn-secondary" onclick="printCVPreview()"><i class="fas fa-print"></i> Imprimer</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.addEventListener("click", (e) => { if (e.target === modal) closeCVPreview(); });
    }
    document.getElementById("cv-preview-frame").src = url;
    document.getElementById("cv-preview-dl").href = `${API_BASE_URL}/applicants/${id}/resume_file/`;
    modal.hidden = false;
};
window.closeCVPreview = () => {
    const m = document.getElementById("cv-preview-modal");
    if (m) { m.hidden = true; document.getElementById("cv-preview-frame").src = "about:blank"; }
};
window.printCVPreview = () => {
    const f = document.getElementById("cv-preview-frame");
    if (f?.contentWindow) f.contentWindow.print();
};

window.showImportCandidatesModal = () => {
    let modal = document.getElementById("import-cand-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "import-cand-modal";
        modal.className = "custom-modal";
        modal.innerHTML = `
            <div class="custom-modal-content panel">
                <div class="action-bar"><h3><i class="fas fa-file-import"></i> Importer des candidats</h3>
                    <button class="btn btn-secondary" onclick="document.getElementById('import-cand-modal').hidden=true"><i class="fas fa-times"></i></button>
                </div>
                <p class="feature-help">Formats : Excel (.xlsx), CSV, PDF (1 CV = 1 candidat)</p>
                <div class="form-row">
                    <input type="file" id="import-cand-file" accept=".xlsx,.xls,.csv,.pdf">
                </div>
                <button class="btn btn-primary" onclick="submitImportCandidates()"><i class="fas fa-upload"></i> Importer</button>
                <p id="import-cand-status" class="hint-text"></p>
            </div>`;
        document.body.appendChild(modal);
    }
    document.getElementById("import-cand-file").value = "";
    document.getElementById("import-cand-status").textContent = "";
    modal.hidden = false;
};

window.submitImportCandidates = async () => {
    const file = document.getElementById("import-cand-file")?.files?.[0];
    const status = document.getElementById("import-cand-status");
    if (!file) { alert("Sélectionnez un fichier."); return; }
    status.textContent = "Import en cours…";
    try {
        const fd = new FormData();
        fd.append("file", file);
        const r = await apiFormPost("/applicants/import_candidates/", fd);
        status.textContent = `${r.created} candidat(s) importé(s).${r.errors?.length ? ` ${r.errors.length} erreur(s).` : ""}`;
        await otomiaAfterMutation("recrutement", `${r.created} candidat(s) importé(s)`);
        if (!r.errors?.length) document.getElementById("import-cand-modal").hidden = true;
    } catch (e) {
        status.textContent = "";
        alert(e.message || "Import impossible.");
    }
};

window.hireApplicant = async (id) => {
    if (!confirm("Intégrer ce candidat comme employé ?\n\nFiche employé, contrat et compte utilisateur (si demandé) seront créés automatiquement.")) return;
    try {
        const r = await apiPost(`/applicants/${id}/hire/`, { send_email: true, force_password_change: true });
        let msg = r.message;
        if (r.credentials) {
            msg += `\n\nCompte créé :\nUtilisateur : ${r.credentials.username}\nMot de passe : ${r.credentials.password}`;
        }
        showToast("Employé intégré avec succès");
        if (r.credentials) showToast(`Compte : ${r.credentials.username}`, "info", 5000);
        await otomiaAfterMutation("recrutement", "Candidat intégré comme employé", { skipDashboard: false });
    } catch (e) { showToast(e.message || "Intégration impossible.", "error"); }
};

function _benefitRowHtml(b = {}, idx = 0) {
    return `<div class="benefit-row form-row" data-idx="${idx}">
        <input class="benefit-label" placeholder="Avantage (ex: Transport)" value="${b.label || ""}">
        <input class="benefit-amount" type="number" step="0.01" placeholder="Montant" value="${b.amount || 0}">
        <input class="benefit-desc" placeholder="Description" value="${b.description || ""}">
        <button type="button" class="btn btn-small btn-danger" onclick="this.closest('.benefit-row').remove()"><i class="fas fa-trash"></i></button>
    </div>`;
}

function collectBenefits() {
    return [...document.querySelectorAll("#cand-benefits .benefit-row")].map((row) => ({
        label: row.querySelector(".benefit-label")?.value || "",
        amount: row.querySelector(".benefit-amount")?.value || 0,
        description: row.querySelector(".benefit-desc")?.value || "",
    })).filter((b) => b.label.trim());
}

window.addBenefitRow = () => {
    const box = document.getElementById("cand-benefits");
    const idx = box.querySelectorAll(".benefit-row").length;
    box.insertAdjacentHTML("beforeend", _benefitRowHtml({}, idx));
};

async function loadDepartmentManagers(deptId) {
    const sel = document.getElementById("cand-manager");
    if (!sel) return;
    sel.innerHTML = "<option value=''>— Chargement… —</option>";
    if (!deptId) { sel.innerHTML = "<option value=''>— Sélectionnez un département —</option>"; return; }
    const managers = await apiGet(`/departments/${deptId}/managers/`);
    sel.innerHTML = "<option value=''>— Responsable —</option>" + managers.map((m) =>
        `<option value="${m.id}">${m.full_name} — ${m.position}</option>`
    ).join("");
}

window.onCandDeptChange = async () => {
    const deptId = document.getElementById("cand-department")?.value;
    await loadDepartmentManagers(deptId);
    const posSel = document.getElementById("cand-position-ref");
    if (posSel && deptId) {
        const positions = await apiGet("/positions/");
        posSel.innerHTML = "<option value=''>— Poste —</option>" + positions
            .filter((p) => String(p.department) === String(deptId))
            .map((p) => `<option value="${p.id}">${p.title}</option>`).join("");
    }
};

window.onCandPhotoChange = (input) => {
    const preview = document.getElementById("cand-photo-preview");
    const hint = document.getElementById("cand-photo-hint");
    const file = input.files?.[0];
    if (!file) {
        if (preview) preview.innerHTML = "";
        if (hint) hint.textContent = "Aucune image choisie";
        return;
    }
    if (hint) hint.textContent = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
        if (preview) preview.innerHTML = `<img src="${e.target.result}" alt="Aperçu photo" class="photo-preview-img">`;
    };
    reader.readAsDataURL(file);
};

window.onCandUserAccountChange = () => {
    const yes = document.getElementById("cand-create-user")?.value === "yes";
    document.getElementById("cand-user-role-row").hidden = !yes;
};

window.showApplicantForm = async (id = null) => {
    [_recDepartments, _recRecruitments] = await Promise.all([
        apiGet("/departments/"),
        apiGet("/recruitments/"),
    ]);
    let data = {};
    if (id) data = await apiGet(`/applicants/${id}/`);

    let modal = document.getElementById("cand-form-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "cand-form-modal";
        modal.className = "custom-modal";
        document.body.appendChild(modal);
        modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
    }

    modal.innerHTML = `
        <div class="custom-modal-content panel cand-form-panel">
            <div class="action-bar">
                <h3><i class="fas fa-user-tie"></i> <span id="cand-form-title">Fiche candidat</span></h3>
                <button class="btn btn-secondary" onclick="document.getElementById('cand-form-modal').hidden=true"><i class="fas fa-times"></i></button>
            </div>
            <form id="cand-form" class="cand-form-sections">
                <input type="hidden" id="cand-id" value="${data.id || ""}">

                <fieldset class="panel"><legend>Informations personnelles</legend>
                    <div class="form-row">
                        <select id="cand-civility"><option value="M">Monsieur</option><option value="Mme">Madame</option><option value="Mlle">Mademoiselle</option></select>
                        <select id="cand-gender"><option value="M">Homme</option><option value="F">Femme</option><option value="O">Autre</option></select>
                    </div>
                    <div class="form-row">
                        <input id="cand-nom" placeholder="Nom *" required>
                        <input id="cand-postnom" placeholder="Postnom">
                        <input id="cand-prenom" placeholder="Prénom *" required>
                    </div>
                    <div class="form-row">
                        <input id="cand-dob" type="date" placeholder="Date naissance">
                        <input id="cand-nationality" placeholder="Nationalité" value="Congolaise">
                        <select id="cand-civil-status">
                            <option>Célibataire</option><option>Marié(e)</option><option>Divorcé(e)</option><option>Veuf(ve)</option>
                        </select>
                        <input id="cand-children" type="number" min="0" placeholder="Enfants" value="0">
                    </div>
                    <div class="form-row">
                        <input id="cand-phone" placeholder="Téléphone">
                        <input id="cand-email" type="email" placeholder="Email *" required>
                    </div>
                    <div class="form-row">
                        <input id="cand-address" placeholder="Adresse" style="flex:2">
                        <input id="cand-city" placeholder="Ville">
                        <input id="cand-province" placeholder="Province">
                    </div>
                    <div class="form-row">
                        <input id="cand-country" placeholder="Pays" value="RDC">
                        <input id="cand-postal" placeholder="Code postal">
                    </div>
                </fieldset>

                <fieldset class="panel"><legend>Photo du candidat</legend>
                    <div class="form-row" style="align-items:center">
                        <input type="file" id="cand-photo" accept=".png,.jpg,.jpeg" onchange="onCandPhotoChange(this)">
                        <span id="cand-photo-hint" class="hint-text">Aucune image choisie</span>
                    </div>
                    <div id="cand-photo-preview"></div>
                </fieldset>

                <fieldset class="panel"><legend>Département & affectation</legend>
                    <div class="form-row">
                        <select id="cand-department" onchange="onCandDeptChange()">
                            <option value="">— Département —</option>
                            ${_recDepartments.map((d) => `<option value="${d.id}">${d.name}</option>`).join("")}
                        </select>
                        <select id="cand-manager"><option value="">— Responsable —</option></select>
                    </div>
                    <div class="form-row">
                        <select id="cand-recruitment"><option value="">— Offre —</option>
                            ${_recRecruitments.map((r) => `<option value="${r.id}">${r.job_title}</option>`).join("")}
                        </select>
                        <select id="cand-status">
                            ${Object.entries(APPLICANT_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
                        </select>
                        <input id="cand-score" type="number" min="0" max="100" placeholder="Score" value="0">
                    </div>
                </fieldset>

                <fieldset class="panel"><legend>Contrat prévu</legend>
                    <div class="form-row">
                        <input id="cand-position" placeholder="Poste">
                        <select id="cand-position-ref"><option value="">— Réf. poste —</option></select>
                        <input id="cand-salary" type="number" step="0.01" placeholder="Salaire de base">
                    </div>
                    <div class="form-row">
                        <select id="cand-contract-type">${CONTRACT_TYPES.map((t) => `<option>${t}</option>`).join("")}</select>
                        <input id="cand-contract-start" type="date" placeholder="Date début">
                        <input id="cand-contract-end" type="date" placeholder="Date fin">
                    </div>
                    <div class="form-row">
                        <input id="cand-work-days" type="number" min="1" max="7" value="5" placeholder="Jours/semaine">
                        <input id="cand-work-schedule" placeholder="Horaires" value="08h00 - 17h00">
                    </div>
                </fieldset>

                <fieldset class="panel"><legend>Avantages en nature</legend>
                    <div id="cand-benefits"></div>
                    <button type="button" class="btn btn-secondary" onclick="addBenefitRow()"><i class="fas fa-plus"></i> Ajouter un avantage</button>
                </fieldset>

                <fieldset class="panel"><legend>CV & compte utilisateur</legend>
                    <div class="form-row">
                        <input type="file" id="cand-resume" accept=".pdf,.docx,.doc">
                        <span class="hint-text">${data.resume_url ? `<a href="${API_HOST}${data.resume_url}" target="_blank">CV actuel</a>` : "PDF ou DOCX"}</span>
                    </div>
                    <div class="form-row">
                        <label>Compte utilisateur ?</label>
                        <select id="cand-create-user" onchange="onCandUserAccountChange()">
                            <option value="no">Non</option><option value="yes">Oui</option>
                        </select>
                    </div>
                    <div class="form-row" id="cand-user-role-row" hidden>
                        <select id="cand-user-role">${USER_ROLES.map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
                    </div>
                </fieldset>

                <div class="export-bar" style="margin-top:16px">
                    <button type="button" class="btn btn-primary" onclick="saveApplicantForm()"><i class="fas fa-save"></i> Enregistrer</button>
                    ${data.status === "ACCEPTED" && !data.employee ? `<button type="button" class="btn btn-secondary" onclick="hireApplicant(${data.id})"><i class="fas fa-user-check"></i> Intégrer comme employé</button>` : ""}
                </div>
            </form>
        </div>`;

    if (id && data) {
        document.getElementById("cand-form-title").textContent = `Modifier — ${data.full_name}`;
        const set = (elId, val) => { const el = document.getElementById(elId); if (el && val != null) el.value = val; };
        set("cand-civility", data.civility);
        set("cand-gender", data.gender);
        set("cand-nom", data.nom);
        set("cand-postnom", data.postnom);
        set("cand-prenom", data.prenom);
        set("cand-dob", data.date_of_birth);
        set("cand-nationality", data.nationality);
        set("cand-civil-status", data.civil_status);
        set("cand-children", data.children_count);
        set("cand-phone", data.phone);
        set("cand-email", data.email);
        set("cand-address", data.address);
        set("cand-city", data.city);
        set("cand-province", data.province);
        set("cand-country", data.country);
        set("cand-postal", data.postal_code);
        set("cand-department", data.department);
        set("cand-recruitment", data.recruitment);
        set("cand-status", data.status);
        set("cand-score", data.score);
        set("cand-position", data.position);
        set("cand-salary", data.salary_base);
        set("cand-contract-type", data.contract_type);
        set("cand-contract-start", data.contract_start);
        set("cand-contract-end", data.contract_end);
        set("cand-work-days", data.work_days_per_week);
        set("cand-work-schedule", data.work_schedule);
        set("cand-create-user", data.create_user_account ? "yes" : "no");
        set("cand-user-role", data.user_role);
        if (data.photo_url) {
            document.getElementById("cand-photo-hint").textContent = "Photo enregistrée";
            document.getElementById("cand-photo-preview").innerHTML =
                `<img src="${API_HOST}${data.photo_url}" class="photo-preview-img" alt="Photo">`;
        }
        document.getElementById("cand-benefits").innerHTML =
            (data.benefits || []).map((b, i) => _benefitRowHtml(b, i)).join("");
        onCandUserAccountChange();
        if (data.department) {
            await onCandDeptChange();
            set("cand-manager", data.manager);
            set("cand-position-ref", data.position_ref);
        }
    } else {
        document.getElementById("cand-benefits").innerHTML = "";
    }
    modal.hidden = false;
};

window.saveApplicantForm = async () => {
    const id = document.getElementById("cand-id")?.value;
    const fd = new FormData();
    const fields = {
        nom: "cand-nom", postnom: "cand-postnom", prenom: "cand-prenom",
        civility: "cand-civility", gender: "cand-gender", date_of_birth: "cand-dob",
        nationality: "cand-nationality", civil_status: "cand-civil-status",
        children_count: "cand-children", phone: "cand-phone", email: "cand-email",
        address: "cand-address", city: "cand-city", province: "cand-province",
        country: "cand-country", postal_code: "cand-postal",
        department: "cand-department", manager: "cand-manager", recruitment: "cand-recruitment",
        status: "cand-status", score: "cand-score", position: "cand-position",
        position_ref: "cand-position-ref", salary_base: "cand-salary",
        contract_type: "cand-contract-type", contract_start: "cand-contract-start",
        contract_end: "cand-contract-end", work_days_per_week: "cand-work-days",
        work_schedule: "cand-work-schedule",
        create_user_account: () => document.getElementById("cand-create-user")?.value === "yes",
        user_role: "cand-user-role",
    };
    for (const [key, elId] of Object.entries(fields)) {
        let val = typeof elId === "function" ? elId() : document.getElementById(elId)?.value;
        if (val !== "" && val != null) fd.append(key, val);
    }
    fd.append("benefits_json", JSON.stringify(collectBenefits()));
    const photo = document.getElementById("cand-photo")?.files?.[0];
    if (photo) fd.append("photo", photo);
    const resume = document.getElementById("cand-resume")?.files?.[0];
    if (resume) fd.append("resume", resume);

    try {
        if (id) {
            await apiFormPut(`/applicants/${id}/`, fd);
        } else {
            await apiFormPost("/applicants/", fd);
        }
        document.getElementById("cand-form-modal").hidden = true;
        await otomiaAfterMutation("recrutement", id ? "Candidat mis à jour" : "Candidat enregistré");
    } catch (e) { showToast(e.message || "Enregistrement impossible.", "error"); }
};

async function apiFormPut(path, formData) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: "PUT",
        credentials: "include",
        headers: { "X-CSRFToken": await getCsrfToken() },
        body: formData,
    });
    const data = response.headers.get("content-type")?.includes("json") ? await response.json() : null;
    if (!response.ok) throw new Error(data?.error || data?.detail || `Erreur ${response.status}`);
    return data;
}
