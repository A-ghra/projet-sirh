/**
 * OTOMIA RH — Modules Formation, Performances, Compétences, Certifications, Objectifs, KPI
 */
const STAR_LABELS = { 1: "Très insuffisant", 2: "Insuffisant", 3: "Satisfaisant", 4: "Très bon", 5: "Excellent" };
const TRAINING_STATUS = { Planned: "Planifiée", InProgress: "En cours", Completed: "Terminée", Cancelled: "Annulée" };
const OBJ_PRIORITY = { Low: "Basse", Medium: "Moyenne", High: "Haute" };
const OBJ_STATUS = { NotStarted: "Non commencé", InProgress: "En cours", Completed: "Réalisé", Late: "En retard" };
const KPI_UNITS = [
    ["FC", "FC"], ["USD", "USD ($)"], ["PERCENT", "%"], ["SALES", "Ventes"],
    ["CLIENTS", "Clients"], ["HOURS", "Heures"], ["DAYS", "Jours"],
    ["FILES", "Dossiers"], ["PROJECTS", "Projets"],
];
const SKILL_LEVELS = [["debutant", "Débutant"], ["intermediaire", "Intermédiaire"], ["expert", "Expert"]];

let _talentCharts = [];
let _talentEmployees = [];
let _talentDepartments = [];

function destroyTalentCharts() {
    _talentCharts.forEach((c) => c.destroy());
    _talentCharts = [];
}

function talentChart(canvasId, config) {
    const el = document.getElementById(canvasId);
    if (!el) return null;
    const existing = _talentCharts.find((c) => c.canvas?.id === canvasId);
    if (existing?.canvas?.isConnected) {
        try {
            existing.data.labels = config.data.labels;
            existing.data.datasets = config.data.datasets;
            existing.update("none");
            return existing;
        } catch (e) {
            try { existing.destroy(); } catch (_) { /* ignore */ }
            _talentCharts = _talentCharts.filter((c) => c !== existing);
        }
    }
    const chart = new Chart(el, config);
    _talentCharts.push(chart);
    return chart;
}

function setTalentKpi(id, value, options = {}) {
    const el = document.getElementById(id);
    if (!el || value === undefined || value === null) return;
    if (typeof animateCounter === "function") animateCounter(el, value, options);
    else el.textContent = `${value}${options.suffix || ""}`;
}

function starRatingHtml(rating, { inputId = null, size = "md" } = {}) {
    const cls = size === "lg" ? "star-rating star-rating-lg" : "star-rating";
    const stars = [1, 2, 3, 4, 5].map((n) => {
        const filled = n <= (rating || 0);
        const click = inputId ? `onclick="setStarRating('${inputId}',${n})"` : "";
        return `<span class="star ${filled ? "filled" : ""}" data-value="${n}" ${click}>★</span>`;
    }).join("");
    const label = rating ? `<small class="star-label">${STAR_LABELS[rating] || ""}</small>` : "";
    const hidden = inputId ? `<input type="hidden" id="${inputId}" value="${rating || 3}">` : "";
    return `<div class="${cls}" id="${inputId ? inputId + "-wrap" : ""}">${stars}${label}${hidden}</div>`;
}

window.setStarRating = (inputId, value) => {
    const input = document.getElementById(inputId);
    if (input) input.value = value;
    const wrap = document.getElementById(`${inputId}-wrap`);
    if (!wrap) return;
    wrap.querySelectorAll(".star").forEach((s) => {
        const n = parseInt(s.dataset.value, 10);
        s.classList.toggle("filled", n <= value);
    });
    let lbl = wrap.querySelector(".star-label");
    if (!lbl) { lbl = document.createElement("small"); lbl.className = "star-label"; wrap.appendChild(lbl); }
    lbl.textContent = STAR_LABELS[value] || "";
};

function priorityBadge(p) {
    const cls = { Low: "badge-draft", Medium: "badge-pending", High: "badge-rejected" };
    return `<span class="badge-status ${cls[p] || "badge-draft"}">${OBJ_PRIORITY[p] || p}</span>`;
}

function objectiveStatusBadge(s) {
    const cls = { NotStarted: "badge-draft", InProgress: "badge-pending", Completed: "badge-validated", Late: "badge-rejected" };
    return `<span class="badge-status ${cls[s] || "badge-draft"}">${OBJ_STATUS[s] || s}</span>`;
}

function certExpiryBadge(status, label) {
    const cls = { valid: "badge-validated", expiring_90: "badge-pending", expiring_30: "badge-rejected", expired: "badge-archived" };
    return `<span class="badge-status ${cls[status] || "badge-draft"}">${label || status}</span>`;
}

function getActiveFormationTab() {
    return document.querySelector("#formation-tabs .module-tab.active")?.dataset?.tab || "dashboard";
}

function getActivePerformanceTab() {
    return document.querySelector("#performance-tabs .module-tab.active")?.dataset?.tab || "dashboard";
}

function switchFormationTab(key) {
    document.querySelectorAll("#content-area .module-tab-panel").forEach((p) => p.classList.remove("active"));
    const panel = document.getElementById(`formation-panel-${key}`);
    if (panel) panel.classList.add("active");
}

function switchPerformanceTab(key) {
    document.querySelectorAll("#content-area .module-tab-panel").forEach((p) => p.classList.remove("active"));
    const panel = document.getElementById(`performance-panel-${key}`);
    if (panel) panel.classList.add("active");
}

async function safeTalentRender(fn, panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    try {
        await fn(panel);
    } catch (e) {
        console.error("Talent render error:", e);
        panel.innerHTML = `<p class="error-message">Erreur de chargement : ${e.message}</p>`;
    }
}

async function loadTalentRefs() {
    [_talentEmployees, _talentDepartments] = await Promise.all([
        apiGet("/employees/"), apiGet("/departments/"),
    ]);
}

function empOptions(selected = "") {
    return _talentEmployees.map((e) => `<option value="${e.id}" ${String(e.id) === String(selected) ? "selected" : ""}>${e.full_name}</option>`).join("");
}

function deptOptions(selected = "") {
    return _talentDepartments.map((d) => `<option value="${d.id}" ${String(d.id) === String(selected) ? "selected" : ""}>${d.name}</option>`).join("");
}

// ===================== FORMATION =====================

const FORMATION_TABS = [
    { feature_key: "dashboard", feature_name: "Tableau de bord", icon: "fa-chart-pie" },
    { feature_key: "list", feature_name: "Formations", icon: "fa-graduation-cap" },
    { feature_key: "tracking", feature_name: "Suivi", icon: "fa-tasks" },
];

async function renderFormation() {
    destroyTalentCharts();
    const title = getModuleTitle("formation", "Formation");
    const canWrite = canWriteModule("formation");
    contentArea.innerHTML = `<div class="module-container animated-panel">
        <div class="action-bar">
            <h2>${title}</h2>
            ${canWrite ? `<button class="btn btn-primary" onclick="showTrainingForm()"><i class="fas fa-plus"></i> Nouvelle formation</button>` : ""}
        </div>
        ${renderModuleTabsHtml(FORMATION_TABS, "formation-tabs")}
        <div class="module-tab-panel active" id="formation-panel-dashboard"></div>
        <div class="module-tab-panel" id="formation-panel-list"></div>
        <div class="module-tab-panel" id="formation-panel-tracking"></div>
    </div>`;
    bindModuleTabs("formation-tabs", switchFormationTab);
    await loadTalentRefs();
    await refreshFormationData();
}

window.refreshFormationData = async function refreshFormationData(options = {}) {
    if (!document.getElementById("formation-panel-dashboard")) return;
    const tab = getActiveFormationTab();
    const silent = options.silent && !options.force;
    if (silent && document.getElementById("form-stat-total")) {
        await updateFormationStatsInPlace();
        if (document.getElementById("form-track-ongoing")) await updateFormationTrackingInPlace();
        return;
    }
    destroyTalentCharts();
    await Promise.all([
        safeTalentRender(renderFormationDashboard, "formation-panel-dashboard"),
        safeTalentRender(renderFormationList, "formation-panel-list"),
        safeTalentRender(renderFormationTracking, "formation-panel-tracking"),
    ]);
    document.querySelectorAll("#formation-tabs .module-tab").forEach((t) => {
        t.classList.toggle("active", t.dataset.tab === tab);
    });
    switchFormationTab(tab);
};

async function updateFormationStatsInPlace() {
    const stats = await apiGet("/trainings/dashboard/");
    setTalentKpi("form-stat-total", stats.total_trainings);
    setTalentKpi("form-stat-progress", stats.in_progress);
    setTalentKpi("form-stat-done", stats.completed);
    setTalentKpi("form-stat-participants", stats.participants_registered ?? stats.participation_rate);
    setTalentKpi("form-stat-success", stats.success_rate, { suffix: "%" });
    talentChart("training-status-chart", {
        type: "doughnut",
        data: {
            labels: stats.by_status.map((x) => x.status),
            datasets: [{ data: stats.by_status.map((x) => x.count), backgroundColor: ["#3498db", "#27ae60", "#f39c12"] }],
        },
        options: { animation: { animateRotate: true } },
    });
    talentChart("training-kpi-chart", {
        type: "bar",
        data: {
            labels: ["Participation %", "Réussite %"],
            datasets: [{ label: "Taux", data: [stats.participation_rate, stats.success_rate], backgroundColor: ["#1a5f9e", "#8e44ad"] }],
        },
        options: { scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { display: false } } },
    });
}

async function updateFormationTrackingInPlace() {
    try {
        const sync = await window.otomiaFetchSync?.();
        const form = sync?.formation;
        if (form) {
            setTalentKpi("form-track-ongoing", form.in_progress);
            setTalentKpi("form-track-done", form.completed);
            setTalentKpi("form-track-results", form.results_registered);
            return;
        }
    } catch (e) { /* fallback ci-dessous */ }
    const [trainings, results] = await Promise.all([
        apiGet("/trainings/"), apiGet("/training-results/"),
    ]);
    setTalentKpi("form-track-ongoing", trainings.filter((t) => t.status === "InProgress").length);
    setTalentKpi("form-track-done", trainings.filter((t) => t.status === "Completed").length);
    setTalentKpi("form-track-results", results.length);
}

async function renderFormationDashboard(panel) {
    const stats = await apiGet("/trainings/dashboard/");
    if (!panel) panel = document.getElementById("formation-panel-dashboard");
    if (!panel) return;
    panel.innerHTML = `
        <div class="dashboard-grid" style="margin-bottom:20px">
            <div class="stat-card stat-animated"><i class="fas fa-graduation-cap"></i><div class="stat-info"><h3>Total formations</h3><p id="form-stat-total">${stats.total_trainings}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-play-circle"></i><div class="stat-info"><h3>En cours</h3><p id="form-stat-progress">${stats.in_progress}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-check-circle"></i><div class="stat-info"><h3>Terminées</h3><p id="form-stat-done">${stats.completed}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-users"></i><div class="stat-info"><h3>Participants inscrits</h3><p id="form-stat-participants">${stats.participants_registered ?? stats.participation_rate}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-trophy"></i><div class="stat-info"><h3>Taux de réussite</h3><p id="form-stat-success">${stats.success_rate}%</p></div></div>
        </div>
        <div class="charts-grid">
            <div class="chart-card chart-animated"><h3>Répartition par statut</h3><canvas id="training-status-chart"></canvas></div>
            <div class="chart-card chart-animated"><h3>Indicateurs clés</h3><canvas id="training-kpi-chart"></canvas></div>
        </div>`;
    talentChart("training-status-chart", {
        type: "doughnut",
        data: {
            labels: stats.by_status.map((x) => x.status),
            datasets: [{ data: stats.by_status.map((x) => x.count), backgroundColor: ["#3498db", "#27ae60", "#f39c12"] }],
        },
        options: { animation: { animateRotate: true } },
    });
    talentChart("training-kpi-chart", {
        type: "bar",
        data: {
            labels: ["Participation %", "Réussite %"],
            datasets: [{ label: "Taux", data: [stats.participation_rate, stats.success_rate], backgroundColor: ["#1a5f9e", "#8e44ad"] }],
        },
        options: { scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { display: false } } },
    });
}

async function renderFormationList(panel) {
    const trainings = await apiGet("/trainings/");
    if (!panel) panel = document.getElementById("formation-panel-list");
    if (!panel) return;
    const canWrite = canWriteModule("formation");
    panel.innerHTML = `<table><thead><tr>
        <th>Titre</th><th>Instructeur</th><th>Organisme</th><th>Période</th><th>Lieu</th>
        <th>Participants</th><th>Coût</th><th>Statut</th><th>Actions</th>
    </tr></thead><tbody>${trainings.map((t) => `<tr>
        <td><strong>${t.title}</strong><br><small>${t.description || ""}</small></td>
        <td>${t.instructor || "—"}</td><td>${t.organization || "—"}</td>
        <td>${t.start_date} → ${t.end_date}</td><td>${t.location || "—"}</td>
        <td>${t.employees_count}</td><td>${formatMoney(t.cost)}</td>
        <td>${statusBadge(t.status)}</td>
        <td style="white-space:nowrap">
            ${canWrite ? `<button class="btn btn-small" onclick="showTrainingForm(${t.id})" title="Modifier"><i class="fas fa-edit"></i></button>
            <button class="btn btn-small btn-secondary" onclick="showEnrollModal(${t.id})" title="Participants"><i class="fas fa-users"></i></button>` : ""}
        </td>
    </tr>`).join("") || "<tr><td colspan='9'>Aucune formation</td></tr>"}</tbody></table>`;
}

async function renderFormationTracking(panel) {
    if (!panel) panel = document.getElementById("formation-panel-tracking");
    if (!panel) return;
    panel.innerHTML = `<div class="loader"><i class="fas fa-spinner fa-spin"></i> Chargement du suivi...</div>`;
    const [trainings, results] = await Promise.all([
        apiGet("/trainings/"), apiGet("/training-results/"),
    ]);
    const ongoing = trainings.filter((t) => t.status === "InProgress");
    const done = trainings.filter((t) => t.status === "Completed");
    const canWrite = canWriteModule("formation");
    panel.innerHTML = `
        <div class="feature-grid" style="margin-bottom:16px">
            <div class="feature-card"><h4>Formations en cours</h4><p id="form-track-ongoing" style="font-size:1.5rem;font-weight:700;color:#1a5f9e">${ongoing.length}</p></div>
            <div class="feature-card"><h4>Formations terminées</h4><p id="form-track-done" style="font-size:1.5rem;font-weight:700;color:#27ae60">${done.length}</p></div>
            <div class="feature-card"><h4>Résultats enregistrés</h4><p id="form-track-results" style="font-size:1.5rem;font-weight:700">${results.length}</p></div>
        </div>
        <h3>Participants inscrits</h3>
        <table><thead><tr><th>Formation</th><th>Employé</th><th>Score</th><th>Certification</th><th>Terminé</th><th>Actions</th></tr></thead>
        <tbody>${results.map((r) => `<tr>
            <td>${r.training_title || r.training}</td>
            <td>${r.employee_name || r.employee}</td>
            <td>${r.score ?? "—"}</td>
            <td>${r.certification_obtained || "—"}</td>
            <td>${r.completed ? "✓" : "—"}</td>
            <td>${canWrite ? `<button class="btn btn-small" onclick="showResultForm(${r.id})" title="Modifier résultat"><i class="fas fa-edit"></i></button>` : ""}</td>
        </tr>`).join("") || "<tr><td colspan='6'>Aucun participant</td></tr>"}</tbody></table>`;
}

window.showResultForm = async (id) => {
    const data = await apiGet(`/training-results/${id}/`);
    let modal = document.getElementById("talent-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "talent-modal";
        modal.className = "custom-modal";
        document.body.appendChild(modal);
        modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
    }
    modal.innerHTML = `<div class="custom-modal-content panel">
        <div class="action-bar"><h3>Résultat — ${data.employee_name}</h3>
            <button class="btn btn-secondary" onclick="document.getElementById('talent-modal').hidden=true"><i class="fas fa-times"></i></button></div>
        <p><strong>Formation :</strong> ${data.training_title}</p>
        <div class="form-row">
            <div><label>Score (/100)</label><input type="number" id="res-score" min="0" max="100" value="${data.score ?? ""}"></div>
            <div><label>Certification obtenue</label><input id="res-cert" value="${data.certification_obtained || ""}"></div>
            <div><label><input type="checkbox" id="res-completed" ${data.completed ? "checked" : ""}> Formation terminée</label></div>
        </div>
        <button class="btn btn-primary" onclick="saveTrainingResult(${id})"><i class="fas fa-save"></i> Enregistrer le résultat</button>
    </div>`;
    modal.hidden = false;
};

window.saveTrainingResult = async (id) => {
    const current = await apiGet(`/training-results/${id}/`);
    const payload = {
        employee: current.employee,
        training: current.training,
        score: document.getElementById("res-score").value ? parseInt(document.getElementById("res-score").value, 10) : null,
        certification_obtained: document.getElementById("res-cert").value,
        completed: document.getElementById("res-completed").checked,
    };
    try {
        await apiPut(`/training-results/${id}/`, payload);
        document.getElementById("talent-modal").hidden = true;
        await otomiaAfterMutation("formation", "Résultat mis à jour");
    } catch (e) { showToast(e.message, "error"); }
};

window.showTrainingForm = async (id = null) => {
    await loadTalentRefs();
    let data = { training_type: "Internal", status: "Planned", cost: 0 };
    if (id) data = await apiGet(`/trainings/${id}/`);
    let modal = document.getElementById("talent-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "talent-modal";
        modal.className = "custom-modal";
        document.body.appendChild(modal);
        modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
    }
    modal.innerHTML = `<div class="custom-modal-content panel" style="max-width:700px">
        <div class="action-bar"><h3>${id ? "Modifier" : "Nouvelle"} formation</h3>
            <button class="btn btn-secondary" onclick="document.getElementById('talent-modal').hidden=true"><i class="fas fa-times"></i></button></div>
        <div class="form-row">
            <input id="tr-title" placeholder="Titre *" value="${data.title || ""}">
            <select id="tr-status">${Object.entries(TRAINING_STATUS).map(([k, v]) =>
                `<option value="${k}" ${data.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        </div>
        <textarea id="tr-desc" placeholder="Description" rows="3">${data.description || ""}</textarea>
        <div class="form-row">
            <input id="tr-instructor" placeholder="Instructeur" value="${data.instructor || ""}">
            <input id="tr-org" placeholder="Organisme de formation" value="${data.organization || ""}">
            <input id="tr-location" placeholder="Lieu" value="${data.location || ""}">
        </div>
        <div class="form-row">
            <input id="tr-start" type="date" value="${data.start_date || ""}">
            <input id="tr-end" type="date" value="${data.end_date || ""}">
            <input id="tr-cost" type="number" placeholder="Coût" value="${data.cost || 0}">
        </div>
        <div class="form-row">
            <label>Participants (sélection multiple)</label>
            <select id="tr-participants" multiple size="5" style="min-height:100px">
                ${empOptions()}
            </select>
        </div>
        <button class="btn btn-primary" onclick="saveTraining(${id || "null"})"><i class="fas fa-save"></i> Enregistrer</button>
    </div>`;
    modal.hidden = false;
    if (data.employees?.length) {
        const sel = document.getElementById("tr-participants");
        data.employees.forEach((eid) => { const o = sel.querySelector(`option[value="${eid}"]`); if (o) o.selected = true; });
    }
};

window.saveTraining = async (id) => {
    const participants = [...document.getElementById("tr-participants").selectedOptions].map((o) => parseInt(o.value, 10));
    const payload = {
        title: document.getElementById("tr-title").value.trim(),
        description: document.getElementById("tr-desc").value,
        instructor: document.getElementById("tr-instructor").value,
        organization: document.getElementById("tr-org").value,
        location: document.getElementById("tr-location").value,
        start_date: document.getElementById("tr-start").value,
        end_date: document.getElementById("tr-end").value,
        cost: document.getElementById("tr-cost").value || 0,
        status: document.getElementById("tr-status").value,
        training_type: "Internal",
        employees: participants,
    };
    if (!payload.title || !payload.start_date || !payload.end_date) { alert("Titre et dates requis."); return; }
    try {
        if (id) await apiPut(`/trainings/${id}/`, payload);
        else await apiPost("/trainings/", payload);
        document.getElementById("talent-modal").hidden = true;
        await otomiaAfterMutation("formation", id ? "Formation mise à jour" : "Formation enregistrée avec succès");
    } catch (e) { showToast(e.message, "error"); }
};

window.showEnrollModal = async (trainingId) => {
    await loadTalentRefs();
    let modal = document.getElementById("talent-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "talent-modal";
        modal.className = "custom-modal";
        document.body.appendChild(modal);
        modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
    }
    modal.innerHTML = `<div class="custom-modal-content panel">
        <div class="action-bar"><h3>Inscrire des participants</h3>
            <button class="btn btn-secondary" onclick="document.getElementById('talent-modal').hidden=true"><i class="fas fa-times"></i></button></div>
        <div class="form-row">
            <label>Par département</label>
            <select id="enroll-dept"><option value="">— Choisir —</option>${deptOptions()}</select>
            <button class="btn btn-secondary" onclick="enrollByDept(${trainingId})">Inscrire le département</button>
        </div>
        <div class="form-row">
            <label>Individuel / multiple</label>
            <select id="enroll-emps" multiple size="6" style="min-height:120px">${empOptions()}</select>
        </div>
        <button class="btn btn-primary" onclick="enrollSelected(${trainingId})"><i class="fas fa-user-plus"></i> Inscrire la sélection</button>
    </div>`;
    modal.hidden = false;
};

window.enrollByDept = async (trainingId) => {
    const dept = document.getElementById("enroll-dept").value;
    if (!dept) { alert("Sélectionnez un département."); return; }
    await apiPost(`/trainings/${trainingId}/enroll_participants/`, { department_id: parseInt(dept, 10) });
    document.getElementById("talent-modal").hidden = true;
    await otomiaAfterMutation("formation", "Participant(s) inscrit(s)");
};

window.enrollSelected = async (trainingId) => {
    const ids = [...document.getElementById("enroll-emps").selectedOptions].map((o) => parseInt(o.value, 10));
    if (!ids.length) { alert("Sélectionnez au moins un employé."); return; }
    await apiPost(`/trainings/${trainingId}/enroll_participants/`, { employee_ids: ids });
    document.getElementById("talent-modal").hidden = true;
    await otomiaAfterMutation("formation", "Participant(s) ajouté(s)");
};

// ===================== PERFORMANCES =====================

const PERFORMANCE_TABS = [
    { feature_key: "dashboard", feature_name: "Tableau de bord", icon: "fa-chart-line" },
    { feature_key: "reviews", feature_name: "Évaluations", icon: "fa-star" },
    { feature_key: "skills", feature_name: "Compétences", icon: "fa-cogs" },
    { feature_key: "certs", feature_name: "Certifications", icon: "fa-award" },
    { feature_key: "objectives", feature_name: "Objectifs", icon: "fa-bullseye" },
    { feature_key: "kpis", feature_name: "KPI", icon: "fa-chart-bar" },
];

async function renderPerformances() {
    destroyTalentCharts();
    const title = getModuleTitle("performances", "Performances");
    const canWrite = canWriteModule("performances");
    contentArea.innerHTML = `<div class="module-container animated-panel">
        <div class="action-bar"><h2>${title}</h2></div>
        ${renderModuleTabsHtml(PERFORMANCE_TABS, "performance-tabs")}
        <div class="module-tab-panel active" id="performance-panel-dashboard"></div>
        <div class="module-tab-panel" id="performance-panel-reviews">
            ${canWrite ? `<div class="export-bar" style="margin-bottom:12px"><button class="btn btn-primary" onclick="showReviewForm()"><i class="fas fa-plus"></i> Nouvelle évaluation</button></div>` : ""}
            <div id="perf-reviews-list"></div>
        </div>
        <div class="module-tab-panel" id="performance-panel-skills">
            ${canWrite ? `<div class="export-bar" style="margin-bottom:12px">
                <button class="btn btn-secondary" onclick="showCategoryForm()"><i class="fas fa-folder"></i> Catégorie</button>
                <button class="btn btn-secondary" onclick="showSkillForm()"><i class="fas fa-plus"></i> Compétence</button>
                <button class="btn btn-primary" onclick="showEmployeeSkillForm()"><i class="fas fa-user-tag"></i> Affecter</button>
            </div>` : ""}
            <div id="perf-skills-list"></div>
        </div>
        <div class="module-tab-panel" id="performance-panel-certs">
            ${canWrite ? `<div class="export-bar" style="margin-bottom:12px"><button class="btn btn-primary" onclick="showCertForm()"><i class="fas fa-plus"></i> Nouvelle certification</button></div>` : ""}
            <div id="perf-certs-list"></div>
        </div>
        <div class="module-tab-panel" id="performance-panel-objectives">
            ${canWrite ? `<div class="export-bar" style="margin-bottom:12px"><button class="btn btn-primary" onclick="showObjectiveForm()"><i class="fas fa-plus"></i> Nouvel objectif</button></div>` : ""}
            <div id="perf-objectives-list"></div>
        </div>
        <div class="module-tab-panel" id="performance-panel-kpis">
            ${canWrite ? `<div class="export-bar" style="margin-bottom:12px"><button class="btn btn-primary" onclick="showKPIForm()"><i class="fas fa-plus"></i> Nouvel indicateur KPI</button></div>` : ""}
            <div id="perf-kpis-list"></div>
        </div>
    </div>`;
    bindModuleTabs("performance-tabs", switchPerformanceTab);
    await loadTalentRefs();
    await refreshPerformanceData();
}

window.refreshPerformanceData = async function refreshPerformanceData(options = {}) {
    if (!document.getElementById("performance-panel-dashboard")) return;
    const tab = getActivePerformanceTab();
    const silent = options.silent && !options.force;
    if (silent && document.getElementById("perf-stat-reviews")) {
        await updatePerformanceStatsInPlace();
        return;
    }
    destroyTalentCharts();
    await Promise.all([
        safeTalentRender(renderPerfDashboard, "performance-panel-dashboard"),
        safeTalentRender(renderPerfReviews, "performance-panel-reviews"),
        safeTalentRender(renderPerfSkills, "performance-panel-skills"),
        safeTalentRender(renderPerfCerts, "performance-panel-certs"),
        safeTalentRender(renderPerfObjectives, "performance-panel-objectives"),
        safeTalentRender(renderPerfKPIs, "performance-panel-kpis"),
    ]);
    document.querySelectorAll("#performance-tabs .module-tab").forEach((t) => {
        t.classList.toggle("active", t.dataset.tab === tab);
    });
    switchPerformanceTab(tab);
};

async function updatePerformanceStatsInPlace() {
    const [perf, overview] = await Promise.all([
        apiGet("/performance-reviews/dashboard/"), apiGet("/talent-dashboard/"),
    ]);
    setTalentKpi("perf-stat-reviews", perf.total_evaluations);
    setTalentKpi("perf-stat-avg", perf.average_score, { suffix: "/100" });
    setTalentKpi("perf-stat-certs", overview.certifications_count);
    setTalentKpi("perf-stat-objectives", overview.objectives_completed);
    setTalentKpi("perf-stat-kpi", overview.avg_kpi_achievement, { suffix: "%" });
    setTalentKpi("perf-stat-expiring", overview.certifications_expiring);
    talentChart("perf-stars-chart", {
        type: "bar",
        data: {
            labels: ["1★", "2★", "3★", "4★", "5★"],
            datasets: [{ label: "Évaluations", data: [1, 2, 3, 4, 5].map((i) => perf.star_distribution[String(i)] || 0), backgroundColor: "#f39c12" }],
        },
        options: { plugins: { legend: { display: false } } },
    });
    talentChart("perf-monthly-chart", {
        type: "line",
        data: {
            labels: perf.monthly_evolution.map((m) => m.month),
            datasets: [
                { label: "Score moyen", data: perf.monthly_evolution.map((m) => m.avg_score), borderColor: "#1a5f9e", tension: 0.3, fill: false },
                { label: "Étoiles moy.", data: perf.monthly_evolution.map((m) => m.avg_stars * 20), borderColor: "#8e44ad", tension: 0.3, fill: false },
            ],
        },
        options: { animation: { duration: 800 } },
    });
}

async function renderPerfDashboard(panel) {
    const [perf, overview] = await Promise.all([
        apiGet("/performance-reviews/dashboard/"), apiGet("/talent-dashboard/"),
    ]);
    if (!panel) panel = document.getElementById("performance-panel-dashboard");
    if (!panel) return;
    panel.innerHTML = `
        <div class="dashboard-grid" style="margin-bottom:20px">
            <div class="stat-card stat-animated"><i class="fas fa-star"></i><div class="stat-info"><h3>Moyenne générale</h3><p id="perf-stat-avg">${perf.average_stars}/5 (${perf.average_score}/100)</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-clipboard-list"></i><div class="stat-info"><h3>Évaluations</h3><p id="perf-stat-reviews">${perf.total_evaluations}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-award"></i><div class="stat-info"><h3>Certifications</h3><p id="perf-stat-certs">${overview.certifications_count}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-bullseye"></i><div class="stat-info"><h3>Objectifs atteints</h3><p id="perf-stat-objectives">${overview.objectives_completed}/${overview.objectives_total}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-chart-bar"></i><div class="stat-info"><h3>KPI moyen</h3><p id="perf-stat-kpi">${overview.avg_kpi_achievement}%</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-exclamation-triangle"></i><div class="stat-info"><h3>Certif. à renouveler</h3><p id="perf-stat-expiring">${overview.certifications_expiring}</p></div></div>
        </div>
        <div class="charts-grid">
            <div class="chart-card chart-animated"><h3>Répartition des notes</h3><canvas id="perf-stars-chart"></canvas></div>
            <div class="chart-card chart-animated"><h3>Évolution mensuelle</h3><canvas id="perf-monthly-chart"></canvas></div>
        </div>
        <div class="charts-grid" style="margin-top:16px">
            <div class="chart-card chart-animated"><h3>Vue d'ensemble talent</h3><canvas id="perf-overview-chart"></canvas></div>
        </div>`;
    talentChart("perf-stars-chart", {
        type: "bar",
        data: {
            labels: ["1★", "2★", "3★", "4★", "5★"],
            datasets: [{ label: "Évaluations", data: [1, 2, 3, 4, 5].map((i) => perf.star_distribution[String(i)] || 0), backgroundColor: "#f39c12" }],
        },
        options: { plugins: { legend: { display: false } } },
    });
    talentChart("perf-monthly-chart", {
        type: "line",
        data: {
            labels: perf.monthly_evolution.map((m) => m.month),
            datasets: [
                { label: "Score moyen", data: perf.monthly_evolution.map((m) => m.avg_score), borderColor: "#1a5f9e", tension: 0.3, fill: false },
                { label: "Étoiles moy.", data: perf.monthly_evolution.map((m) => m.avg_stars * 20), borderColor: "#8e44ad", tension: 0.3, fill: false },
            ],
        },
        options: { animation: { duration: 800 } },
    });
    talentChart("perf-overview-chart", {
        type: "radar",
        data: {
            labels: ["Formations", "Compétences", "Certifications", "Objectifs", "KPI"],
            datasets: [{
                label: "Indicateurs",
                data: [
                    overview.training?.total_trainings || 0,
                    overview.skills_count,
                    overview.certifications_count,
                    overview.objectives_completed,
                    overview.kpis_count,
                ],
                backgroundColor: "rgba(26,95,158,0.2)",
                borderColor: "#1a5f9e",
            }],
        },
    });
}

async function renderPerfReviews() {
    const reviews = await apiGet("/performance-reviews/");
    const canWrite = canWriteModule("performances");
    const el = document.getElementById("perf-reviews-list");
    if (!el) return;
    el.innerHTML = `<table><thead><tr>
        <th>Employé</th><th>Évaluateur</th><th>Département</th><th>Date</th><th>Période</th>
        <th>Note</th><th>Résultat</th><th>Statut</th><th>Actions</th>
    </tr></thead><tbody>${reviews.map((r) => `<tr>
        <td>${r.employee_name}</td><td>${r.reviewer_name || "—"}</td><td>${r.department_name || "—"}</td>
        <td>${r.review_date}</td><td>${r.evaluation_period || "—"}</td>
        <td>${starRatingHtml(r.star_rating)}</td><td>${r.result || "—"}</td>
        <td>${statusBadge(r.status)}</td>
        <td style="white-space:nowrap">
            <button class="btn btn-small btn-secondary" onclick="viewReviewDetail(${r.id})" title="Détail"><i class="fas fa-eye"></i></button>
            ${canWrite && r.status !== "Validated" ? `<button class="btn btn-small btn-primary" onclick="validateReview(${r.id})">Valider</button>` : ""}
            ${canWrite ? `<button class="btn btn-small" onclick="showReviewForm(${r.id})"><i class="fas fa-edit"></i></button>` : ""}
        </td>
    </tr>`).join("") || "<tr><td colspan='9'>Aucune évaluation</td></tr>"}</tbody></table>`;
}

window.viewReviewDetail = async (id) => {
    const r = await apiGet(`/performance-reviews/${id}/`);
    let modal = document.getElementById("talent-modal");
    if (!modal) { modal = document.createElement("div"); modal.id = "talent-modal"; modal.className = "custom-modal"; document.body.appendChild(modal); }
    modal.innerHTML = `<div class="custom-modal-content panel" style="max-width:700px">
        <div class="action-bar"><h3>Évaluation — ${r.employee_name}</h3>
            <button class="btn btn-secondary" onclick="document.getElementById('talent-modal').hidden=true"><i class="fas fa-times"></i></button></div>
        <p>${starRatingHtml(r.star_rating, { size: "lg" })} — <strong>${r.result}</strong></p>
        <p><em>Période :</em> ${r.evaluation_period || "—"} | <em>Date :</em> ${r.review_date}</p>
        ${r.comments_strengths ? `<div class="portail-card"><strong>Points forts</strong><p>${r.comments_strengths}</p></div>` : ""}
        ${r.comments_weaknesses ? `<div class="portail-card"><strong>Points faibles</strong><p>${r.comments_weaknesses}</p></div>` : ""}
        ${r.comments_recommendations ? `<div class="portail-card"><strong>Recommandations</strong><p>${r.comments_recommendations}</p></div>` : ""}
        ${r.comments_improvement ? `<div class="portail-card"><strong>Axes d'amélioration</strong><p>${r.comments_improvement}</p></div>` : ""}
        ${r.comments_future_goals ? `<div class="portail-card"><strong>Objectifs futurs</strong><p>${r.comments_future_goals}</p></div>` : ""}
        ${r.comments ? `<div class="portail-card"><strong>Commentaire général</strong><p>${r.comments}</p></div>` : ""}
    </div>`;
    modal.hidden = false;
};

window.showReviewForm = async (id = null) => {
    await loadTalentRefs();
    let data = { star_rating: 3, status: "Draft", score: 60 };
    if (id) data = await apiGet(`/performance-reviews/${id}/`);
    let modal = document.getElementById("talent-modal");
    if (!modal) { modal = document.createElement("div"); modal.id = "talent-modal"; modal.className = "custom-modal"; document.body.appendChild(modal); }
    modal.innerHTML = `<div class="custom-modal-content panel" style="max-width:750px;max-height:90vh;overflow-y:auto">
        <div class="action-bar"><h3>${id ? "Modifier" : "Nouvelle"} évaluation</h3>
            <button class="btn btn-secondary" onclick="document.getElementById('talent-modal').hidden=true"><i class="fas fa-times"></i></button></div>
        <div class="form-row">
            <select id="rv-employee"><option value="">Employé *</option>${empOptions(data.employee)}</select>
            <select id="rv-reviewer"><option value="">Évaluateur</option>${empOptions(data.reviewer)}</select>
            <select id="rv-dept"><option value="">Département</option>${deptOptions(data.department)}</select>
        </div>
        <div class="form-row">
            <input id="rv-date" type="date" value="${data.review_date || new Date().toISOString().slice(0, 10)}">
            <input id="rv-period" placeholder="Période d'évaluation" value="${data.evaluation_period || ""}">
            <select id="rv-status">${["Draft", "Pending", "Validated"].map((s) =>
                `<option value="${s}" ${data.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        </div>
        <label>Note de performance</label>
        <div id="rv-stars-container">${starRatingHtml(data.star_rating || 3, { inputId: "rv-stars", size: "lg" })}</div>
        <h4 style="margin-top:12px">Commentaires et feedback</h4>
        <textarea id="rv-strengths" placeholder="Points forts" rows="2">${data.comments_strengths || ""}</textarea>
        <textarea id="rv-weaknesses" placeholder="Points faibles" rows="2">${data.comments_weaknesses || ""}</textarea>
        <textarea id="rv-recommendations" placeholder="Recommandations" rows="2">${data.comments_recommendations || ""}</textarea>
        <textarea id="rv-improvement" placeholder="Axes d'amélioration" rows="2">${data.comments_improvement || ""}</textarea>
        <textarea id="rv-future" placeholder="Objectifs futurs" rows="2">${data.comments_future_goals || ""}</textarea>
        <textarea id="rv-comments" placeholder="Commentaire général" rows="3">${data.comments || ""}</textarea>
        <button class="btn btn-primary" style="margin-top:12px" onclick="saveReview(${id || "null"})"><i class="fas fa-save"></i> Enregistrer</button>
    </div>`;
    modal.hidden = false;
    setStarRating("rv-stars", data.star_rating || 3);
};

window.saveReview = async (id) => {
    const stars = parseInt(document.getElementById("rv-stars").value, 10) || 3;
    const payload = {
        employee: parseInt(document.getElementById("rv-employee").value, 10),
        reviewer: document.getElementById("rv-reviewer").value ? parseInt(document.getElementById("rv-reviewer").value, 10) : null,
        department: document.getElementById("rv-dept").value ? parseInt(document.getElementById("rv-dept").value, 10) : null,
        review_date: document.getElementById("rv-date").value,
        evaluation_period: document.getElementById("rv-period").value,
        status: document.getElementById("rv-status").value,
        star_rating: stars,
        score: stars * 20,
        comments_strengths: document.getElementById("rv-strengths").value,
        comments_weaknesses: document.getElementById("rv-weaknesses").value,
        comments_recommendations: document.getElementById("rv-recommendations").value,
        comments_improvement: document.getElementById("rv-improvement").value,
        comments_future_goals: document.getElementById("rv-future").value,
        comments: document.getElementById("rv-comments").value,
    };
    if (!payload.employee || !payload.review_date) { alert("Employé et date requis."); return; }
    try {
        if (id) await apiPut(`/performance-reviews/${id}/`, payload);
        else await apiPost("/performance-reviews/", payload);
        document.getElementById("talent-modal").hidden = true;
        await otomiaAfterMutation("performances", id ? "Évaluation mise à jour" : "Évaluation enregistrée");
    } catch (e) { showToast(e.message, "error"); }
};

window.validateReview = async (id) => {
    await apiPost(`/performance-reviews/${id}/validate_review/`, {});
    await otomiaAfterMutation("performances", "Évaluation validée");
};

async function renderPerfSkills() {
    const [categories, assignments] = await Promise.all([
        apiGet("/skill-categories/"), apiGet("/employee-skills/"),
    ]);
    const el = document.getElementById("perf-skills-list");
    if (!el) return;
    const canWrite = canWriteModule("performances");
    el.innerHTML = `
        <h3>Catégories et compétences</h3>
        <div class="feature-grid" style="margin-bottom:16px">
            ${categories.map((c) => `<div class="feature-card">
                <h4>${c.name}</h4><p>${c.description || ""}</p><small>${c.skills_count} compétence(s)</small>
                ${canWrite ? `<button class="btn btn-small" style="margin-top:6px" onclick="showCategoryForm(${c.id})"><i class="fas fa-edit"></i></button>
                <button class="btn btn-small btn-danger" onclick="deleteCategory(${c.id})"><i class="fas fa-trash"></i></button>` : ""}
            </div>`).join("") || "<p>Aucune catégorie</p>"}
        </div>
        <h3>Affectations employés</h3>
        <table><thead><tr><th>Employé</th><th>Compétence</th><th>Catégorie</th><th>Niveau</th><th>Date acquisition</th>
        ${canWrite ? "<th>Actions</th>" : ""}</tr></thead>
        <tbody>${assignments.map((a) => `<tr>
            <td>${a.employee_name}</td><td>${a.skill_name}</td><td>${a.category_name}</td>
            <td>${a.level_label}</td><td>${a.acquired_date}</td>
            ${canWrite ? `<td><button class="btn btn-small btn-danger" onclick="deleteEmployeeSkill(${a.id})"><i class="fas fa-trash"></i></button></td>` : ""}
        </tr>`).join("") || `<tr><td colspan="${canWrite ? 6 : 5}">Aucune affectation</td></tr>`}</tbody></table>`;
}

window.showCategoryForm = async (id = null) => {
    let data = { name: "", description: "" };
    if (id) data = await apiGet(`/skill-categories/${id}/`);
    showSimpleModal(`${id ? "Modifier" : "Nouvelle"} catégorie`, `
        <input id="cat-name" placeholder="Nom *" value="${data.name}">
        <textarea id="cat-desc" placeholder="Description" rows="2">${data.description || ""}</textarea>
        <button class="btn btn-primary" onclick="saveCategory(${id || "null"})">Enregistrer</button>
    `);
};

window.saveCategory = async (id) => {
    const payload = { name: document.getElementById("cat-name").value.trim(), description: document.getElementById("cat-desc").value };
    if (!payload.name) { alert("Nom requis."); return; }
    if (id) await apiPut(`/skill-categories/${id}/`, payload);
    else await apiPost("/skill-categories/", payload);
    closeTalentModal();
    await otomiaAfterMutation("performances", "Catégorie enregistrée");
};

window.deleteCategory = async (id) => {
    if (!confirm("Supprimer cette catégorie ?")) return;
    await apiFetch(`/skill-categories/${id}/`, { method: "DELETE" });
    await otomiaAfterMutation("performances", "Catégorie supprimée");
};

window.showSkillForm = async () => {
    const cats = await apiGet("/skill-categories/");
    showSimpleModal("Nouvelle compétence", `
        <select id="sk-category">${cats.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}</select>
        <input id="sk-name" placeholder="Nom de la compétence *">
        <textarea id="sk-desc" placeholder="Description" rows="2"></textarea>
        <select id="sk-level">${SKILL_LEVELS.map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <button class="btn btn-primary" onclick="saveSkill()">Enregistrer</button>
    `);
};

window.saveSkill = async () => {
    const payload = {
        category: parseInt(document.getElementById("sk-category").value, 10),
        name: document.getElementById("sk-name").value.trim(),
        description: document.getElementById("sk-desc").value,
        required_level: document.getElementById("sk-level").value,
    };
    if (!payload.name) { alert("Nom requis."); return; }
    await apiPost("/skills/", payload);
    closeTalentModal();
    await otomiaAfterMutation("performances", "Compétence enregistrée");
};

window.showEmployeeSkillForm = async () => {
    await loadTalentRefs();
    const skills = await apiGet("/skills/");
    showSimpleModal("Affecter une compétence", `
        <select id="es-employee"><option value="">Employé *</option>${empOptions()}</select>
        <select id="es-skill">${skills.map((s) => `<option value="${s.id}">${s.name} (${s.category_name})</option>`).join("")}</select>
        <select id="es-level">${SKILL_LEVELS.map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <input id="es-date" type="date" value="${new Date().toISOString().slice(0, 10)}">
        <button class="btn btn-primary" onclick="saveEmployeeSkill()">Enregistrer</button>
    `);
};

window.saveEmployeeSkill = async () => {
    const payload = {
        employee: parseInt(document.getElementById("es-employee").value, 10),
        skill: parseInt(document.getElementById("es-skill").value, 10),
        level: document.getElementById("es-level").value,
        acquired_date: document.getElementById("es-date").value,
    };
    if (!payload.employee) { alert("Employé requis."); return; }
    await apiPost("/employee-skills/", payload);
    closeTalentModal();
    await otomiaAfterMutation("performances", "Compétence affectée");
};

window.deleteEmployeeSkill = async (id) => {
    if (!confirm("Retirer cette compétence ?")) return;
    await apiFetch(`/employee-skills/${id}/`, { method: "DELETE" });
    await otomiaAfterMutation("performances", "Compétence retirée");
};

async function renderPerfCerts() {
    const certs = await apiGet("/certifications/");
    const el = document.getElementById("perf-certs-list");
    if (!el) return;
    el.innerHTML = `<table><thead><tr>
        <th>Employé</th><th>Titre</th><th>Organisme</th><th>Émission</th><th>Expiration</th>
        <th>N° certif.</th><th>Alerte</th><th>Document</th>
    </tr></thead><tbody>${certs.map((c) => `<tr>
        <td>${c.employee_name}</td><td>${c.title}</td><td>${c.issuing_organization || "—"}</td>
        <td>${c.issue_date}</td><td>${c.expiry_date || "—"}</td>
        <td>${c.certificate_number || "—"}</td>
        <td>${certExpiryBadge(c.expiry_status, c.expiry_status_label)}</td>
        <td>${c.document_url ? `<a class="btn btn-small" href="${API_HOST}${c.document_url}" target="_blank"><i class="fas fa-download"></i></a>` : "—"}</td>
    </tr>`).join("") || "<tr><td colspan='8'>Aucune certification</td></tr>"}</tbody></table>`;
}

window.showCertForm = async () => {
    await loadTalentRefs();
    showSimpleModal("Nouvelle certification", `
        <select id="cert-employee"><option value="">Employé *</option>${empOptions()}</select>
        <input id="cert-title" placeholder="Titre de la certification *">
        <input id="cert-org" placeholder="Organisation émettrice">
        <div class="form-row">
            <input id="cert-issue" type="date" value="${new Date().toISOString().slice(0, 10)}">
            <input id="cert-expiry" type="date">
        </div>
        <input id="cert-number" placeholder="Numéro de certification">
        <input id="cert-file" type="file" accept=".pdf,.jpg,.png,.doc,.docx">
        <button class="btn btn-primary" onclick="saveCert()">Enregistrer</button>
    `);
};

window.saveCert = async () => {
    const fd = new FormData();
    fd.append("employee", document.getElementById("cert-employee").value);
    fd.append("title", document.getElementById("cert-title").value);
    fd.append("issuing_organization", document.getElementById("cert-org").value);
    fd.append("issue_date", document.getElementById("cert-issue").value);
    const exp = document.getElementById("cert-expiry").value;
    if (exp) fd.append("expiry_date", exp);
    fd.append("certificate_number", document.getElementById("cert-number").value);
    const file = document.getElementById("cert-file").files[0];
    if (file) fd.append("document", file);
    if (!fd.get("employee") || !fd.get("title")) { alert("Employé et titre requis."); return; }
    await apiFormPost("/certifications/", fd);
    closeTalentModal();
    await otomiaAfterMutation("performances", "Certification enregistrée");
};

async function renderPerfObjectives() {
    const objs = await apiGet("/objectives/");
    const el = document.getElementById("perf-objectives-list");
    if (!el) return;
    el.innerHTML = `<table><thead><tr>
        <th>Employé</th><th>Titre</th><th>Priorité</th><th>Date cible</th><th>Statut</th><th>Avancement</th>
    </tr></thead><tbody>${objs.map((o) => `<tr>
        <td>${o.employee_name}</td><td>${o.title}<br><small>${o.description || ""}</small></td>
        <td>${priorityBadge(o.priority)}</td><td>${o.target_date}</td>
        <td>${objectiveStatusBadge(o.status)}</td>
        <td><div class="progress-bar-wrap"><div class="progress-bar" style="width:${o.progress_percent}%"></div></div> ${o.progress_percent}%</td>
    </tr>`).join("") || "<tr><td colspan='6'>Aucun objectif</td></tr>"}</tbody></table>`;
}

window.showObjectiveForm = async () => {
    await loadTalentRefs();
    showSimpleModal("Nouvel objectif", `
        <select id="obj-employee"><option value="">Employé *</option>${empOptions()}</select>
        <input id="obj-title" placeholder="Titre de l'objectif *">
        <textarea id="obj-desc" placeholder="Description" rows="2"></textarea>
        <div class="form-row">
            <input id="obj-date" type="date">
            <select id="obj-priority">${Object.entries(OBJ_PRIORITY).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
            <select id="obj-status">${Object.entries(OBJ_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        </div>
        <input id="obj-progress" type="number" min="0" max="100" value="0" placeholder="Avancement %">
        <button class="btn btn-primary" onclick="saveObjective()">Enregistrer</button>
    `);
};

window.saveObjective = async () => {
    const payload = {
        employee: parseInt(document.getElementById("obj-employee").value, 10),
        title: document.getElementById("obj-title").value.trim(),
        description: document.getElementById("obj-desc").value,
        target_date: document.getElementById("obj-date").value,
        priority: document.getElementById("obj-priority").value,
        status: document.getElementById("obj-status").value,
        progress_percent: parseInt(document.getElementById("obj-progress").value, 10) || 0,
    };
    if (!payload.employee || !payload.title || !payload.target_date) { alert("Champs requis manquants."); return; }
    await apiPost("/objectives/", payload);
    closeTalentModal();
    await otomiaAfterMutation("performances", "Objectif enregistré");
};

async function renderPerfKPIs() {
    const kpis = await apiGet("/employee-kpis/");
    const el = document.getElementById("perf-kpis-list");
    if (!el) return;
    el.innerHTML = `<table><thead><tr>
        <th>Employé</th><th>Indicateur</th><th>Actuel</th><th>Cible</th><th>Unité</th><th>Écart</th><th>Réalisation</th>
    </tr></thead><tbody>${kpis.map((k) => `<tr>
        <td>${k.employee_name}</td><td>${k.name}<br><small>${k.description || ""}</small></td>
        <td>${Number(k.current_value).toLocaleString("fr-FR")}</td>
        <td>${Number(k.target_value).toLocaleString("fr-FR")}</td>
        <td>${k.unit_label}</td>
        <td>${Number(k.gap).toLocaleString("fr-FR")}</td>
        <td><strong>${k.achievement_percent}%</strong>
            <div class="progress-bar-wrap"><div class="progress-bar ${k.achievement_percent >= 100 ? "progress-success" : ""}" style="width:${Math.min(k.achievement_percent, 100)}%"></div></div>
        </td>
    </tr>`).join("") || "<tr><td colspan='7'>Aucun KPI</td></tr>"}</tbody></table>`;
}

window.showKPIForm = async () => {
    await loadTalentRefs();
    showSimpleModal("Nouvel indicateur KPI", `
        <select id="kpi-employee"><option value="">Employé *</option>${empOptions()}</select>
        <input id="kpi-name" placeholder="Nom de l'indicateur *">
        <textarea id="kpi-desc" placeholder="Description" rows="2"></textarea>
        <div class="form-row">
            <input id="kpi-current" type="number" step="0.01" placeholder="Valeur actuelle" value="0">
            <input id="kpi-target" type="number" step="0.01" placeholder="Valeur cible" value="100">
            <select id="kpi-unit">${KPI_UNITS.map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        </div>
        <button class="btn btn-primary" onclick="saveKPI()">Enregistrer</button>
    `);
};

window.saveKPI = async () => {
    const payload = {
        employee: parseInt(document.getElementById("kpi-employee").value, 10),
        name: document.getElementById("kpi-name").value.trim(),
        description: document.getElementById("kpi-desc").value,
        current_value: document.getElementById("kpi-current").value || 0,
        target_value: document.getElementById("kpi-target").value || 0,
        unit: document.getElementById("kpi-unit").value,
    };
    if (!payload.employee || !payload.name) { alert("Employé et nom requis."); return; }
    await apiPost("/employee-kpis/", payload);
    closeTalentModal();
    await otomiaAfterMutation("performances", "KPI enregistré");
};

function showSimpleModal(title, bodyHtml) {
    let modal = document.getElementById("talent-modal");
    if (!modal) { modal = document.createElement("div"); modal.id = "talent-modal"; modal.className = "custom-modal"; document.body.appendChild(modal); }
    modal.innerHTML = `<div class="custom-modal-content panel" style="max-width:550px">
        <div class="action-bar"><h3>${title}</h3>
            <button class="btn btn-secondary" onclick="closeTalentModal()"><i class="fas fa-times"></i></button></div>
        ${bodyHtml}
    </div>`;
    modal.hidden = false;
    modal.onclick = (e) => { if (e.target === modal) closeTalentModal(); };
}

window.closeTalentModal = () => {
    const m = document.getElementById("talent-modal");
    if (m) m.hidden = true;
};

// Dossier employé — section talent pour viewFile
window.renderEmployeeTalentDossier = (f) => {
    const ts = f.talent_summary || {};
    const reviews = (f.performance_reviews || []).map((r) => `
        <tr><td>${r.review_date}</td><td>${r.reviewer_name || "—"}</td>
        <td>${starRatingHtml(r.star_rating)}</td><td>${r.result || "—"}</td>
        <td><small>${r.comments || r.comments_strengths || "—"}</small></td></tr>`).join("") || "<tr><td colspan='5'>Aucune évaluation</td></tr>";
    const skills = (f.skills || []).map((s) =>
        `<li>${s.skill_name} (${s.category_name}) — ${s.level_label} — ${s.acquired_date}</li>`).join("") || "<li>Aucune compétence</li>";
    const certs = (f.certifications || []).map((c) =>
        `<li>${c.title} — ${certExpiryBadge(c.expiry_status, c.expiry_status_label)}</li>`).join("") || "<li>Aucune certification</li>";
    const trainings = (f.trainings || []).map((t) => `<li>${t.title} (${t.start_date})</li>`).join("") || "<li>Aucune formation</li>";
    const objs = (f.objectives || []).map((o) =>
        `<li>${o.title} — ${priorityBadge(o.priority)} ${objectiveStatusBadge(o.status)} (${o.progress_percent}%)</li>`).join("") || "<li>Aucun objectif</li>";
    const kpis = (f.kpis || []).map((k) =>
        `<li>${k.name}: ${k.achievement_percent}% (${Number(k.current_value).toLocaleString("fr-FR")} / ${Number(k.target_value).toLocaleString("fr-FR")} ${k.unit_label})</li>`).join("") || "<li>Aucun KPI</li>";
    return `
        <div class="panel talent-dossier" style="margin-top:16px">
            <h4><i class="fas fa-user-graduate"></i> Dossier talent — évolution professionnelle</h4>
            <div class="dashboard-grid" style="margin:12px 0">
                <div class="stat-card"><div class="stat-info"><h3>Note moyenne</h3><p>${ts.average_stars || 0}/5</p></div></div>
                <div class="stat-card"><div class="stat-info"><h3>Évaluations</h3><p>${ts.evaluations_count || 0}</p></div></div>
                <div class="stat-card"><div class="stat-info"><h3>Formations</h3><p>${ts.trainings_count || 0}</p></div></div>
                <div class="stat-card"><div class="stat-info"><h3>Compétences</h3><p>${ts.skills_count || 0}</p></div></div>
            </div>
            <h4>Historique des évaluations</h4>
            <table><thead><tr><th>Date</th><th>Évaluateur</th><th>Note</th><th>Résultat</th><th>Commentaires</th></tr></thead><tbody>${reviews}</tbody></table>
            <div class="form-row" style="margin-top:16px">
                <div><h4>Formations</h4><ul>${trainings}</ul></div>
                <div><h4>Compétences</h4><ul>${skills}</ul></div>
            </div>
            <div class="form-row">
                <div><h4>Certifications</h4><ul>${certs}</ul></div>
                <div><h4>Objectifs</h4><ul>${objs}</ul></div>
            </div>
            <h4>KPI</h4><ul>${kpis}</ul>
        </div>`;
};

window.renderFormation = renderFormation;
window.renderPerformances = renderPerformances;
