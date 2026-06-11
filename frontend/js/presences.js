/**
 * OTOMIA RH — Module Présences & Congés
 * Pointage, Récapitulatif, Rapport, Grille, Congés, Missions
 */
(function () {
    const EVENT_LABELS = {
        presence: "Présence",
        absence: "Absence",
        leave: "Congé",
        mission: "Mission",
        late: "Retard",
    };
    /** Actions autorisées dans le formulaire Nouveau pointage (pas d'absence manuelle). */
    const POINTAGE_EVENT_LABELS = {
        presence: "Présence",
        leave: "Congé",
        mission: "Mission",
    };
    const WORKFLOW_LABELS = {
        pending_validation: "En attente de validation",
        confirmed: "Confirmée",
        regularized: "Régularisée",
        contested: "Contestée",
    };
    let _presEmployeesCache = [];
    const EVENT_CODES = { presence: "P", absence: "A", leave: "C", mission: "M", late: "R" };
    const DEFAULT_LEAVE_TYPES = [
        { feature_key: "conge_annuel", feature_name: "Congé annuel" },
        { feature_key: "conge_maladie", feature_name: "Congé maladie" },
        { feature_key: "conge_exceptionnel", feature_name: "Congé exceptionnel" },
        { feature_key: "conge_sans_solde", feature_name: "Congé sans solde" },
    ];
    const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
        new Date(2000, i, 1).toLocaleString("fr-FR", { month: "long" }));

    function presNow() {
        const d = new Date();
        return { month: d.getMonth() + 1, year: d.getFullYear() };
    }

    function presFilters() {
        const { month, year } = presNow();
        return {
            month: Number(window._presMonth) || month,
            year: Number(window._presYear) || year,
            search: window._presSearch || "",
            employee: window._presEmployee || "",
            department: window._presDepartment || "",
        };
    }

    function monthYearOptions(selectedMonth, selectedYear) {
        const { year: cy } = presNow();
        const months = MONTH_NAMES.map((name, i) => {
            const v = i + 1;
            return `<option value="${v}" ${v === selectedMonth ? "selected" : ""}>${name}</option>`;
        }).join("");
        const years = [cy - 1, cy, cy + 1].map((y) =>
            `<option value="${y}" ${y === selectedYear ? "selected" : ""}>${y}</option>`).join("");
        return { months, years };
    }

    function canManagePresences() {
        return ["SUPER_ADMIN", "ADMIN_RH", "GESTIONNAIRE_RH", "RESPONSABLE_HIERARCHIQUE"].includes(currentUser?.role);
    }

    function canEditPresences() {
        return canManagePresences();
    }

    function canPointPresence() {
        return canManagePresences() || currentUser?.role === "EMPLOYE";
    }

    function filterBarHtml(prefix, opts = {}) {
        const f = presFilters();
        const { months, years } = monthYearOptions(f.month, f.year);
        const extra = opts.extra || "";
        const search = opts.search !== false ? `
            <input type="search" class="filter-search" placeholder="🔍 ${opts.searchPlaceholder || "Rechercher..."}"
                value="${f.search.replace(/"/g, "&quot;")}"
                oninput="window._presSearch=this.value;${opts.searchHandler || `refreshPresencesData({force:true})`}">` : "";
        return `
            <div class="pres-filters action-bar">
                <label>Mois <select id="${prefix}-month" onchange="window._presMonth=this.value;${opts.changeHandler || "refreshPresencesData({force:true})"}">${months}</select></label>
                <label>Année <select id="${prefix}-year" onchange="window._presYear=this.value;${opts.changeHandler || "refreshPresencesData({force:true})"}">${years}</select></label>
                ${extra}
                ${search}
            </div>`;
    }

    function eventTypeBadge(type) {
        const code = EVENT_CODES[type] || type;
        return `<span class="pres-code pres-code-${type || "presence"}">${code}</span>`;
    }

    window.renderPresences = async function renderPresences() {
        if (!contentArea) contentArea = document.getElementById("content-area");
        if (!contentArea) return;

        const dbTabs = getActiveFeatures("presences", "menu_tab");
        const leaveTypes = getActiveFeatures("presences", "leave_type");
        const title = getModuleTitle("presences", "Présences & Congés");
        const canWrite = canWriteModule("presences");
        const defaultTabs = [
            { feature_key: "onglet_pointage", feature_name: "Pointage", icon: "fa-fingerprint" },
            { feature_key: "onglet_recap", feature_name: "Récapitulatif", icon: "fa-chart-pie" },
            { feature_key: "onglet_presences", feature_name: "Présences", icon: "fa-clock" },
            { feature_key: "onglet_grille", feature_name: "Grille de présence", icon: "fa-table" },
            { feature_key: "onglet_conges", feature_name: "Congés", icon: "fa-umbrella-beach" },
            { feature_key: "onglet_missions", feature_name: "Missions", icon: "fa-briefcase" },
            { feature_key: "onglet_absences_auto", feature_name: "Absences auto", icon: "fa-robot" },
        ];
        const tabs = dbTabs.some((t) => t.feature_key === "onglet_pointage") ? dbTabs : defaultTabs;
        const firstTabKey = (tabs[0]?.feature_key || "onglet_pointage").replace("onglet_", "");
        const tabsHtml = renderModuleTabsHtml(tabs, "pres-tabs");
        const activeLeaveTypes = leaveTypes.length ? leaveTypes : DEFAULT_LEAVE_TYPES;
        const leaveOptions = activeLeaveTypes.map((lt) =>
            `<option value="${lt.feature_key}">${lt.feature_name}</option>`).join("");
        const f = presFilters();

        contentArea.innerHTML = `
            <div class="module-container animated-panel presences-module">
                <div class="action-bar"><h2>${title}</h2>
                    <div class="export-bar">
                        ${canWrite ? `<button class="btn btn-primary" onclick="showLeaveRequestModal()"><i class="fas fa-plus"></i> Demander un congé</button>` : ""}
                        ${canPointPresence() ? `<button type="button" id="btn-new-pointage" class="btn btn-secondary" onclick="window.openPointageForm()"><i class="fas fa-fingerprint"></i> Nouveau pointage</button>` : ""}
                    </div>
                </div>
                ${tabsHtml}
                <div id="pres-stats-bar" class="dashboard-grid pres-stats-bar"></div>

                <div class="module-tab-panel ${firstTabKey === "pointage" ? "active" : ""}" id="pres-panel-pointage">
                    ${filterBarHtml("pres-point", { changeHandler: "loadPointagePanel()" })}
                    <div class="table-responsive">
                        <table class="pres-table"><thead><tr>
                            <th>Employé</th><th>Matricule</th><th>Poste</th><th>Département</th>
                            <th>Date</th><th>Type</th><th>Entrée</th><th>Sortie</th><th>Commentaire</th>
                            ${canEditPresences() ? "<th>Actions</th>" : ""}
                        </tr></thead><tbody id="pointage-list"><tr><td colspan="10"><i class="fas fa-spinner fa-spin"></i> Chargement...</td></tr></tbody></table>
                    </div>
                </div>

                <div class="module-tab-panel ${firstTabKey === "recap" ? "active" : ""}" id="pres-panel-recap">
                    ${filterBarHtml("pres-recap", { searchPlaceholder: "Nom, matricule, département, poste...", searchHandler: "loadRecapPanel()" })}
                    <div id="recap-totals" class="dashboard-grid pres-recap-totals"></div>
                    <div class="table-responsive">
                        <table class="pres-table"><thead><tr>
                            <th>Employé</th><th>Matricule</th><th>Département</th><th>Poste</th>
                            <th>Présences</th><th>Absences</th><th>Congés</th><th>Missions</th><th>Retards</th><th>Heures</th>
                        </tr></thead><tbody id="recap-list"><tr><td colspan="10"><i class="fas fa-spinner fa-spin"></i> Chargement...</td></tr></tbody></table>
                    </div>
                </div>

                <div class="module-tab-panel ${firstTabKey === "presences" ? "active" : ""}" id="pres-panel-presences">
                    ${filterBarHtml("pres-report", { searchPlaceholder: "Entrer votre recherche...", searchHandler: "loadReportPanel()" })}
                    <p class="feature-help">Rapport mensuel — mise à jour réservée aux rôles RH et managers.</p>
                    <div class="table-responsive">
                        <table class="pres-table"><thead><tr>
                            <th>Employé(e)</th><th>Matricule</th><th>Poste</th><th>Département</th>
                            <th>Présences</th><th>Absences</th><th>Congés</th><th>Missions</th><th>Retards</th><th>Heures travaillées</th>
                        </tr></thead><tbody id="report-list"><tr><td colspan="10"><i class="fas fa-spinner fa-spin"></i> Chargement...</td></tr></tbody></table>
                    </div>
                </div>

                <div class="module-tab-panel ${firstTabKey === "grille" ? "active" : ""}" id="pres-panel-grille">
                    <div class="pres-filters action-bar">
                        <label>Mois <select id="pres-grid-month" onchange="window._presMonth=this.value;loadGridPanel()">${monthYearOptions(f.month, f.year).months}</select></label>
                        <label>Année <select id="pres-grid-year" onchange="window._presYear=this.value;loadGridPanel()">${monthYearOptions(f.month, f.year).years}</select></label>
                        <label>Employé <select id="pres-grid-employee" onchange="window._presEmployee=this.value;loadGridPanel()"><option value="">Tous</option></select></label>
                        <label>Département <select id="pres-grid-dept" onchange="window._presDepartment=this.value;loadGridPanel()"><option value="">Tous</option></select></label>
                        <button class="btn btn-secondary" onclick="printPresenceGrid()"><i class="fas fa-print"></i> Imprimer</button>
                        <button class="btn btn-primary" onclick="exportPresenceGridPdf()"><i class="fas fa-file-pdf"></i> PDF</button>
                    </div>
                    <div class="pres-legend">
                        <span><span class="pres-code pres-code-presence">P</span> Présence</span>
                        <span><span class="pres-code pres-code-absence">A</span> Absence</span>
                        <span><span class="pres-code pres-code-leave">C</span> Congé</span>
                        <span><span class="pres-code pres-code-mission">M</span> Mission</span>
                    </div>
                    <div id="grid-wrap" class="table-responsive pres-grid-wrap">
                        <p class="hint-text"><i class="fas fa-spinner fa-spin"></i> Chargement de la grille...</p>
                    </div>
                </div>

                <div class="module-tab-panel ${firstTabKey === "conges" ? "active" : ""}" id="pres-panel-conges">
                    <table class="pres-table"><thead><tr><th>Employé</th><th>Type</th><th>Début</th><th>Fin</th><th>Statut</th><th>Actions</th></tr></thead>
                    <tbody id="abs-list"></tbody></table>
                </div>

                <div class="module-tab-panel ${firstTabKey === "missions" ? "active" : ""}" id="pres-panel-missions">
                    <table class="pres-table"><thead><tr><th>Employé</th><th>Titre</th><th>Destination</th><th>Période</th><th>Statut</th></tr></thead>
                    <tbody id="miss-list"></tbody></table>
                </div>

                <div class="module-tab-panel ${firstTabKey === "absences_auto" ? "active" : ""}" id="pres-panel-absences-auto">
                    ${filterBarHtml("pres-auto", { changeHandler: "loadAutoAbsencesPanel()" })}
                    <p class="feature-help">Absences détectées automatiquement après absence de pointage. Le manager est notifié avant la clôture.</p>
                    <div class="table-responsive">
                        <table class="pres-table"><thead><tr>
                            <th>Employé</th><th>Matricule</th><th>Département</th><th>Poste</th>
                            <th>Date</th><th>Générée le</th><th>Manager</th><th>Statut</th><th>Motif</th><th>Actions</th>
                        </tr></thead><tbody id="auto-abs-list"><tr><td colspan="10"><i class="fas fa-spinner fa-spin"></i> Chargement...</td></tr></tbody></table>
                    </div>
                </div>
            </div>
            <div id="pointage-modal" class="custom-modal" hidden>
                <div class="custom-modal-content panel pres-pointage-modal">
                    <div id="pointage-modal-body"><p class="hint-text"><i class="fas fa-spinner fa-spin"></i> Chargement...</p></div>
                </div>
            </div>
            <div id="leave-modal" class="custom-modal" hidden>
                <div class="custom-modal-content panel">
                    <h3>Demande de congé</h3>
                    <div class="form-row">
                        <div id="leave-employee-wrap" hidden><label>Employé <span class="req">*</span></label>
                            <select id="leave-employee"></select></div>
                        <div><label>Type de congé <span class="req">*</span></label><select id="leave-type">${leaveOptions}</select></div>
                        <div><label>Date début <span class="req">*</span></label><input type="date" id="leave-start"></div>
                        <div><label>Date fin <span class="req">*</span></label><input type="date" id="leave-end"></div>
                    </div>
                    <div><label>Motif / commentaire</label><textarea id="leave-reason" rows="2" placeholder="Motif de la demande"></textarea></div>
                    <div class="action-bar">
                        <button type="button" class="btn btn-primary" onclick="window.submitLeaveRequest()">Envoyer</button>
                        <button type="button" class="btn btn-secondary" onclick="window.closeLeaveModal()">Annuler</button>
                    </div>
                </div>
            </div>`;

        const tabMap = {
            onglet_pointage: "pointage",
            onglet_recap: "recap",
            onglet_presences: "presences",
            onglet_grille: "grille",
            onglet_conges: "conges",
            onglet_missions: "missions",
            onglet_types: "types",
        };
        bindModuleTabs("pres-tabs", (key) => {
            document.querySelectorAll(".presences-module .module-tab-panel").forEach((p) => p.classList.remove("active"));
            const panelKey = tabMap[key] || key.replace("onglet_", "");
            const panel = document.getElementById(`pres-panel-${panelKey}`);
            if (panel) panel.classList.add("active");
            if (panelKey === "pointage") loadPointagePanel();
            if (panelKey === "recap") loadRecapPanel();
            if (panelKey === "presences") loadReportPanel();
            if (panelKey === "grille") loadGridPanel();
        });

        try {
            _presEmployeesCache = await apiGet("/employees/");
            if (currentUser?.role === "EMPLOYE" && currentUser.employee_id) {
                _presEmployeesCache = _presEmployeesCache.filter((e) => e.id === currentUser.employee_id);
            }
        } catch (e) {
            console.warn("[OTOMIA] cache employés présences", e);
            _presEmployeesCache = [];
        }

        await refreshPresencesData({ force: true });
        await loadGridFilters();
    };

    function switchToPresTab(panelKey) {
        const tabMapRev = {
            pointage: "onglet_pointage",
            recap: "onglet_recap",
            presences: "onglet_presences",
            grille: "onglet_grille",
            conges: "onglet_conges",
            missions: "onglet_missions",
        };
        document.querySelectorAll(".presences-module .module-tab-panel").forEach((p) => p.classList.remove("active"));
        const panel = document.getElementById(`pres-panel-${panelKey}`);
        if (panel) panel.classList.add("active");
        document.querySelectorAll("#pres-tabs .module-tab").forEach((btn) => {
            const key = btn.dataset?.tab || btn.getAttribute("data-tab") || "";
            btn.classList.toggle("active", key === tabMapRev[panelKey] || key.replace("onglet_", "") === panelKey);
        });
    }

    function getEmployeeById(id) {
        return _presEmployeesCache.find((e) => String(e.id) === String(id));
    }

    function renderPointageFormHtml(record, employees) {
        const today = new Date().toISOString().slice(0, 10);
        const empId = record?.employee || currentUser?.employee_id || employees[0]?.id || "";
        const selected = getEmployeeById(empId) || employees[0] || {};
        const eventType = record?.status === "Late" && (record?.event_type === "presence" || !record?.event_type)
            ? "late"
            : (record?.event_type || "presence");
        const deptName = selected.department_name || selected.department?.name || "-";
        return `
            <h3><i class="fas fa-fingerprint"></i> ${record?.id ? "Modifier le pointage" : "Nouveau pointage"}</h3>
            <input type="hidden" id="pointage-id" value="${record?.id || ""}">
            <div class="form-row">
                <div><label>Employé <span class="req">*</span></label>
                    <select id="pointage-employee" onchange="window.updatePointageEmployeeInfo()" ${currentUser?.role === "EMPLOYE" ? "disabled" : ""}>
                        ${employees.length
                            ? employees.map((e) => `<option value="${e.id}" ${String(e.id) === String(empId) ? "selected" : ""}>${e.full_name}</option>`).join("")
                            : "<option value=\"\">— Aucun employé —</option>"}
                    </select>
                </div>
                <div><label>Matricule</label><input type="text" id="pointage-matricule" readonly value="${selected.matricule || "-"}"></div>
                <div><label>Poste</label><input type="text" id="pointage-position" readonly value="${selected.position || "-"}"></div>
                <div><label>Département</label><input type="text" id="pointage-department" readonly value="${deptName}"></div>
            </div>
            <div class="form-row">
                <div><label>Type d'action <span class="req">*</span></label>
                    <select id="pointage-event-type">
                        ${Object.entries(POINTAGE_EVENT_LABELS).map(([k, v]) =>
                            `<option value="${k}" ${(eventType === k || (eventType === "late" && k === "presence")) ? "selected" : ""}>${v}</option>`).join("")}
                    </select>
                </div>
                <div><label>Date <span class="req">*</span></label><input type="date" id="pointage-date" value="${record?.date || today}"></div>
                <div><label>Heure d'entrée</label><input type="time" id="pointage-check-in" value="${(record?.check_in || "08:00").toString().slice(0, 5)}"></div>
                <div><label>Heure de sortie</label><input type="time" id="pointage-check-out" value="${record?.check_out ? record.check_out.toString().slice(0, 5) : ""}"></div>
            </div>
            <div><label>Commentaire</label><textarea id="pointage-notes" rows="2" placeholder="Ex. Absence justifiée pour raison médicale.">${record?.notes || ""}</textarea></div>
            <div class="action-bar">
                <button type="button" class="btn btn-primary" onclick="window.savePointage()"><i class="fas fa-save"></i> Enregistrer</button>
                ${record?.id && canEditPresences() ? `<button type="button" class="btn btn-danger" onclick="window.deletePointage(${record.id})"><i class="fas fa-trash"></i> Supprimer</button>` : ""}
                <button type="button" class="btn btn-secondary" onclick="window.closePointageForm()">Annuler</button>
            </div>`;
    }

    window.updatePointageEmployeeInfo = function updatePointageEmployeeInfo() {
        const sel = document.getElementById("pointage-employee");
        if (!sel) return;
        const emp = getEmployeeById(sel.value);
        const mat = document.getElementById("pointage-matricule");
        const pos = document.getElementById("pointage-position");
        const dep = document.getElementById("pointage-department");
        if (mat) mat.value = emp?.matricule || "-";
        if (pos) pos.value = emp?.position || "-";
        if (dep) dep.value = emp?.department_name || emp?.department?.name || "-";
    };

    async function loadGridFilters() {
        if (!canManagePresences()) return;
        try {
            const [employees, departments] = await Promise.all([
                apiGet("/employees/"),
                apiGet("/departments/"),
            ]);
            const empSel = document.getElementById("pres-grid-employee");
            const deptSel = document.getElementById("pres-grid-dept");
            if (empSel) {
                empSel.innerHTML = `<option value="">Tous</option>${employees.map((e) =>
                    `<option value="${e.id}" ${String(e.id) === String(presFilters().employee) ? "selected" : ""}>${e.full_name}</option>`).join("")}`;
            }
            if (deptSel) {
                deptSel.innerHTML = `<option value="">Tous</option>${departments.map((d) =>
                    `<option value="${d.id}" ${String(d.id) === String(presFilters().department) ? "selected" : ""}>${d.name}</option>`).join("")}`;
            }
        } catch (e) {
            console.warn("[OTOMIA] loadGridFilters", e);
        }
    }

    window.openPointageForm = async function openPointageForm(record = null) {
        console.log("[OTOMIA] Bouton Nouveau Pointage cliqué");
        const modal = document.getElementById("pointage-modal");
        const body = document.getElementById("pointage-modal-body");
        if (!modal || !body) {
            console.error("[OTOMIA] pointage-modal introuvable — ouvrez le module Présences & Congés");
            if (typeof showToast === "function") showToast("Impossible d'ouvrir le formulaire. Rechargez le module.", "error");
            return;
        }

        switchToPresTab("pointage");
        modal.hidden = false;
        body.innerHTML = `<p class="hint-text"><i class="fas fa-spinner fa-spin"></i> Chargement du formulaire...</p>`;

        let employees = _presEmployeesCache;
        if (!employees.length) {
            try {
                employees = await apiGet("/employees/");
                if (currentUser?.role === "EMPLOYE" && currentUser.employee_id) {
                    employees = employees.filter((e) => e.id === currentUser.employee_id);
                }
                _presEmployeesCache = employees;
            } catch (e) {
                console.error("[OTOMIA] Erreur chargement employés pointage", e);
                body.innerHTML = `<p class="error-message">Impossible de charger les employés.</p>
                    <button type="button" class="btn btn-secondary" onclick="window.closePointageForm()">Fermer</button>`;
                return;
            }
        }

        if (!employees.length) {
            body.innerHTML = `<p class="error-message">Aucun employé disponible pour le pointage.</p>
                <button type="button" class="btn btn-secondary" onclick="window.closePointageForm()">Fermer</button>`;
            return;
        }

        body.innerHTML = renderPointageFormHtml(record, employees);
        window.updatePointageEmployeeInfo();
    };

    window.closePointageForm = function closePointageForm() {
        const modal = document.getElementById("pointage-modal");
        const body = document.getElementById("pointage-modal-body");
        if (modal) modal.hidden = true;
        if (body) body.innerHTML = "";
    };

    function buildPointagePayload() {
        const empSel = document.getElementById("pointage-employee");
        const empId = empSel?.disabled && currentUser?.employee_id
            ? currentUser.employee_id
            : Number(empSel?.value);
        const payload = {
            employee: empId,
            event_type: document.getElementById("pointage-event-type")?.value,
            date: document.getElementById("pointage-date")?.value,
            notes: document.getElementById("pointage-notes")?.value?.trim() || "",
        };
        const checkIn = document.getElementById("pointage-check-in")?.value;
        const checkOut = document.getElementById("pointage-check-out")?.value;
        if (checkIn) payload.check_in = checkIn;
        if (checkOut) payload.check_out = checkOut;
        return payload;
    }

    window.savePointage = async function savePointage() {
        const payload = buildPointagePayload();
        const id = document.getElementById("pointage-id")?.value;
        if (!payload.employee || !payload.date || !payload.event_type) {
            const msg = "Veuillez compléter tous les champs obligatoires.";
            if (typeof showToast === "function") showToast(msg, "error");
            else alert(msg);
            return;
        }
        console.log("[OTOMIA] Données pointage envoyées :", payload);
        try {
            let response;
            if (id) {
                response = await apiFetch(`/attendance/${id}/`, { method: "PATCH", body: payload });
            } else {
                response = await apiPost("/attendance/pointages/", payload);
            }
            console.log("[OTOMIA] Réponse API pointage :", response);
            closePointageForm();
            await otomiaAfterMutation("presences", id ? "Pointage modifié avec succès." : "Pointage enregistré avec succès.");
            await refreshAllPresencesPanels();
        } catch (e) {
            console.error("[OTOMIA] Erreur Pointage :", e, e?.data);
            const msg = (typeof otomiaFormatValidationErrors === "function" && otomiaFormatValidationErrors(e?.data))
                || (e?.message?.includes("média") || e?.message?.includes("media type")
                    ? "Impossible d'enregistrer le pointage. Veuillez réessayer."
                    : (e.message || "Impossible d'enregistrer le pointage. Veuillez réessayer."));
            if (typeof showToast === "function") showToast(msg, "error");
            else alert(msg);
        }
    };

    window.deletePointage = async function deletePointage(id) {
        if (!confirm("Supprimer ce pointage ?")) return;
        try {
            await apiFetch(`/attendance/${id}/`, { method: "DELETE" });
            closePointageForm();
            await otomiaAfterMutation("presences", "Pointage supprimé");
            loadPointagePanel();
        } catch (e) {
            alert(e.message || "Suppression impossible.");
        }
    };

    window.editPointage = async function editPointage(id) {
        try {
            const record = await apiGet(`/attendance/${id}/`);
            if (record.record_source === "auto") {
                alert("Cette absence automatique se gère depuis l'onglet « Absences auto ».");
                return;
            }
            openPointageForm(record);
        } catch (e) {
            alert(e.message || "Impossible de charger le pointage.");
        }
    };

    async function refreshAllPresencesPanels() {
        await Promise.allSettled([
            loadPointagePanel(),
            loadRecapPanel(),
            loadReportPanel(),
            loadGridPanel(),
            loadAutoAbsencesPanel(),
        ]);
    }

    function workflowBadge(status) {
        const label = WORKFLOW_LABELS[status] || status || "-";
        const cls = status ? `wf-${status}` : "";
        return `<span class="pres-wf-badge ${cls}">${label}</span>`;
    }

    window.loadAutoAbsencesPanel = async function loadAutoAbsencesPanel() {
        const tbody = document.getElementById("auto-abs-list");
        if (!tbody) return;
        const f = presFilters();
        const isManager = canManagePresences();
        const isEmployee = currentUser?.role === "EMPLOYE";
        try {
            const rows = await apiGet(`/attendance/auto-absences/?month=${f.month}&year=${f.year}`);
            tbody.innerHTML = rows.map((a) => {
                const canManage = isManager;
                const canJustify = isEmployee && currentUser?.employee_id === a.employee;
                const actions = [];
                if (canManage && a.absence_workflow_status === "pending_validation") {
                    actions.push(`<button class="btn btn-small btn-primary" onclick="window.confirmAutoAbsence(${a.id})" title="Confirmer">Confirmer</button>`);
                    actions.push(`<button class="btn btn-small btn-secondary" onclick="window.regularizeAutoAbsence(${a.id})" title="Régulariser">Régulariser</button>`);
                }
                if (canManage || canJustify) {
                    actions.push(`<button class="btn btn-small" onclick="window.showJustificationModal(${a.id})" title="Justifier">Justifier</button>`);
                }
                return `<tr>
                    <td>${a.employee_name}</td>
                    <td>${a.employee_matricule || "-"}</td>
                    <td>${a.employee_department || "-"}</td>
                    <td>${a.employee_position || "-"}</td>
                    <td>${a.date}</td>
                    <td>${a.generated_at ? new Date(a.generated_at).toLocaleString("fr-FR") : "-"}</td>
                    <td>${a.manager_name || "-"}</td>
                    <td>${workflowBadge(a.absence_workflow_status)}</td>
                    <td>${a.notes || "-"}</td>
                    <td>${actions.join(" ") || "-"}</td>
                </tr>`;
            }).join("") || `<tr><td colspan="10">Aucune absence automatique pour cette période.</td></tr>`;
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="10" class="error-message">Impossible de charger les absences automatiques.</td></tr>`;
        }
    };

    window.confirmAutoAbsence = async (id) => {
        const note = prompt("Commentaire de confirmation (optionnel) :") || "";
        await apiPost(`/attendance/${id}/confirm-absence/`, { note });
        await otomiaAfterMutation("presences", "Absence confirmée");
        await loadAutoAbsencesPanel();
    };

    window.regularizeAutoAbsence = async (id) => {
        const note = prompt("Motif de régularisation :") || "";
        await apiPost(`/attendance/${id}/regularize-absence/`, { note });
        await otomiaAfterMutation("presences", "Absence régularisée");
        await loadAutoAbsencesPanel();
    };

    window.contestAutoAbsence = async (id) => {
        const note = prompt("Motif de contestation :") || "";
        await apiPost(`/attendance/${id}/contest-absence/`, { note });
        await otomiaAfterMutation("presences", "Absence contestée");
        await loadAutoAbsencesPanel();
    };

    window.showJustificationModal = async (id) => {
        const note = prompt("Votre justification :");
        if (note === null) return;
        const attachFile = confirm("Joindre un justificatif (PDF, JPG, PNG) ?");
        if (attachFile) {
            const fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.accept = ".pdf,.jpg,.jpeg,.png";
            fileInput.onchange = async () => {
                const file = fileInput.files[0];
                if (!file) return;
                const formData = new FormData();
                formData.append("note", note);
                formData.append("file", file);
                try {
                    await apiFetch(`/attendance/${id}/submit-justification/`, { method: "POST", body: formData, isFormData: true });
                    await otomiaAfterMutation("presences", "Justification envoyée");
                    await loadAutoAbsencesPanel();
                } catch (e) {
                    alert(e.message || "Impossible d'envoyer la justification.");
                }
            };
            fileInput.click();
            return;
        }
        try {
            await apiPost(`/attendance/${id}/submit-justification/`, { note });
            await otomiaAfterMutation("presences", "Justification envoyée");
            await loadAutoAbsencesPanel();
        } catch (e) {
            alert(e.message || "Impossible d'envoyer la justification.");
        }
    };

    window.loadPointagePanel = async function loadPointagePanel() {
        const tbody = document.getElementById("pointage-list");
        if (!tbody) return;
        const f = presFilters();
        try {
            const rows = await apiGet(`/attendance/?month=${f.month}&year=${f.year}`);
            tbody.innerHTML = rows.map((a) => `
                <tr>
                    <td>${a.employee_name}</td>
                    <td>${a.employee_matricule || "-"}</td>
                    <td>${a.employee_position || "-"}</td>
                    <td>${a.employee_department || "-"}</td>
                    <td>${a.date}</td>
                    <td>${eventTypeBadge(a.event_type)} ${EVENT_LABELS[a.event_type] || a.status}${a.record_source === "auto" ? ' <span class="pres-auto-tag" title="Absence automatique">AUTO</span>' : ""}</td>
                    <td>${a.check_in ? a.check_in.slice(0, 5) : "-"}</td>
                    <td>${a.check_out ? a.check_out.slice(0, 5) : "-"}</td>
                    <td>${a.notes || "-"}</td>
                    ${canEditPresences() ? `<td>
                        <button type="button" class="btn btn-small" onclick="window.editPointage(${a.id})" title="Modifier"><i class="fas fa-edit"></i></button>
                        <button type="button" class="btn btn-small btn-danger" onclick="window.deletePointage(${a.id})" title="Supprimer"><i class="fas fa-trash"></i></button>
                    </td>` : ""}
                </tr>`).join("") || `<tr><td colspan="10">Aucun pointage pour cette période.</td></tr>`;
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="10" class="error-message">Les données de pointage ne peuvent pas être chargées.</td></tr>`;
        }
    };

    function renderSummaryRows(rows, targetId) {
        const el = document.getElementById(targetId);
        if (!el) return;
        el.innerHTML = rows.map((r) => `
            <tr>
                <td>${r.full_name}</td>
                <td>${r.matricule}</td>
                <td>${r.department}</td>
                <td>${r.position}</td>
                <td>${r.present_count}</td>
                <td>${r.absent_count}</td>
                <td>${r.leave_count}</td>
                <td>${r.mission_count}</td>
                <td>${r.late_count}</td>
                <td>${Number(r.hours_worked).toFixed(1)} h</td>
            </tr>`).join("") || `<tr><td colspan="10">Aucune donnée disponible pour la période sélectionnée.</td></tr>`;
    }

    function renderRecapTotals(totals) {
        const el = document.getElementById("recap-totals");
        if (!el || !totals) return;
        el.innerHTML = `
            <div class="stat-card stat-animated"><i class="fas fa-user-check"></i><div class="stat-info"><h3>Présences</h3><p>${totals.present}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-user-times"></i><div class="stat-info"><h3>Absences</h3><p>${totals.absent}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-umbrella-beach"></i><div class="stat-info"><h3>Congés</h3><p>${totals.leave}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-briefcase"></i><div class="stat-info"><h3>Missions</h3><p>${totals.mission}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-clock"></i><div class="stat-info"><h3>Retards</h3><p>${totals.late}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-hourglass-half"></i><div class="stat-info"><h3>Heures travaillées</h3><p>${totals.hours_worked} h</p></div></div>`;
    }

    window.loadRecapPanel = async function loadRecapPanel() {
        const f = presFilters();
        try {
            const data = await apiGet(`/attendance/summary/?month=${f.month}&year=${f.year}&search=${encodeURIComponent(f.search)}`);
            renderRecapTotals(data.totals);
            renderSummaryRows(data.rows, "recap-list");
        } catch (e) {
            const el = document.getElementById("recap-list");
            if (el) el.innerHTML = `<tr><td colspan="10" class="error-message">Les statistiques ne peuvent pas être chargées pour le moment.</td></tr>`;
        }
    };

    window.loadReportPanel = async function loadReportPanel() {
        const f = presFilters();
        try {
            const data = await apiGet(`/attendance/report/?month=${f.month}&year=${f.year}&search=${encodeURIComponent(f.search)}`);
            renderSummaryRows(data.rows, "report-list");
        } catch (e) {
            const el = document.getElementById("report-list");
            if (el) el.innerHTML = `<tr><td colspan="10" class="error-message">Le rapport de présence ne peut pas être chargé.</td></tr>`;
        }
    };

    window.loadGridPanel = async function loadGridPanel() {
        const wrap = document.getElementById("grid-wrap");
        if (!wrap) return;
        const f = presFilters();
        wrap.innerHTML = `<p class="hint-text"><i class="fas fa-spinner fa-spin"></i> Chargement...</p>`;
        try {
            const params = new URLSearchParams({ month: f.month, year: f.year });
            if (f.employee) params.set("employee", f.employee);
            if (f.department) params.set("department", f.department);
            const data = await apiGet(`/attendance/grid/?${params}`);
            const dayHeaders = Array.from({ length: data.days_in_month }, (_, i) => `<th class="pres-day-col">${i + 1}</th>`).join("");
            const rows = data.rows.map((r) => `
                <tr>
                    <td class="pres-emp-col">${r.full_name}</td>
                    ${r.days.map((d) => `<td class="pres-day-cell ${d.weekend ? "weekend" : ""} ${d.code ? `code-${d.code}` : ""}" title="${d.code || ""}">${d.code || ""}</td>`).join("")}
                    <td>${r.present_count}</td><td>${r.absent_count}</td><td>${r.leave_count}</td><td>${r.mission_count}</td>
                </tr>`).join("");
            wrap.innerHTML = `
                <table class="pres-grid-table" id="presence-grid-table">
                    <thead><tr>
                        <th class="pres-emp-col">Employé</th>${dayHeaders}
                        <th>Prés.</th><th>Abs.</th><th>Cong.</th><th>Miss.</th>
                    </tr></thead>
                    <tbody>${rows || `<tr><td colspan="${data.days_in_month + 5}">Aucune donnée.</td></tr>`}</tbody>
                </table>`;
        } catch (e) {
            wrap.innerHTML = `<p class="error-message">La grille de présence ne peut pas être chargée.</p>`;
        }
    };

    window.printPresenceGrid = function printPresenceGrid() {
        const table = document.getElementById("presence-grid-table");
        if (!table) return alert("Chargez d'abord la grille de présence.");
        const f = presFilters();
        const title = `Grille de présence — ${MONTH_NAMES[f.month - 1]} ${f.year}`;
        const w = window.open("", "_blank");
        w.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
            <style>
                body{font-family:Arial,sans-serif;font-size:10px;margin:12px}
                h2{text-align:center;color:#1a5f9e}
                table{border-collapse:collapse;width:100%}
                th,td{border:1px solid #ccc;padding:3px;text-align:center}
                th{background:#1a5f9e;color:#fff}
                .pres-emp-col{text-align:left;min-width:120px}
                .weekend{background:#f0f0f0}
            </style></head><body>
            <h2>${title}</h2>${table.outerHTML}
            <p style="margin-top:8px"><small>P=Présence A=Absence C=Congé M=Mission — OTOMIA RH</small></p>
            </body></html>`);
        w.document.close();
        w.focus();
        w.print();
    };

    window.exportPresenceGridPdf = function exportPresenceGridPdf() {
        printPresenceGrid();
    };

    function renderPresStats(p) {
        const presStats = document.getElementById("pres-stats-bar");
        if (!presStats || !p) return;
        presStats.innerHTML = `
            <div class="stat-card stat-animated"><i class="fas fa-user-check"></i><div class="stat-info"><h3>Présents aujourd'hui</h3><p>${p.present_today}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-clock"></i><div class="stat-info"><h3>Retards</h3><p>${p.late_today}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-user-times"></i><div class="stat-info"><h3>Absents</h3><p>${p.absent_today}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-robot"></i><div class="stat-info"><h3>Absences auto</h3><p>${p.auto_absences_today ?? 0}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-check-double"></i><div class="stat-info"><h3>Régularisées</h3><p>${p.auto_absences_regularized ?? 0}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-umbrella-beach"></i><div class="stat-info"><h3>Congés en attente</h3><p>${p.pending_leaves}</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-percentage"></i><div class="stat-info"><h3>Taux présence (mois)</h3><p>${p.attendance_rate_month}%</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-chart-line"></i><div class="stat-info"><h3>Absentéisme</h3><p>${p.absenteeism_rate ?? 0}%</p></div></div>
            <div class="stat-card stat-animated"><i class="fas fa-hourglass-half"></i><div class="stat-info"><h3>Heures travaillées</h3><p>${p.hours_worked_month || 0} h</p></div></div>`;
    }

    window.showLeaveRequestModal = async () => {
        const m = document.getElementById("leave-modal");
        if (!m) return;
        const empWrap = document.getElementById("leave-employee-wrap");
        const empSel = document.getElementById("leave-employee");
        const isRh = canManagePresences();
        if (isRh && empWrap && empSel) {
            empWrap.hidden = false;
            if (!_presEmployeesCache.length) {
                try { _presEmployeesCache = await apiGet("/employees/"); } catch (e) { /* ignore */ }
            }
            empSel.innerHTML = _presEmployeesCache.map((e) =>
                `<option value="${e.id}">${e.full_name} (${e.matricule})</option>`).join("");
        } else if (empWrap) {
            empWrap.hidden = true;
        }
        m.hidden = false;
    };
    window.closeLeaveModal = () => {
        const m = document.getElementById("leave-modal");
        if (m) m.hidden = true;
    };
    window.submitLeaveRequest = async () => {
        const empSel = document.getElementById("leave-employee");
        const isRh = canManagePresences();
        const empId = isRh && empSel && !empSel.closest("[hidden]")
            ? Number(empSel.value)
            : currentUser?.employee_id;
        const typeKey = document.getElementById("leave-type")?.value;
        const start = document.getElementById("leave-start")?.value;
        const end = document.getElementById("leave-end")?.value;
        const reason = document.getElementById("leave-reason")?.value?.trim() || "";
        if (!empId) {
            const msg = "Veuillez sélectionner un employé ou lier votre profil employé.";
            if (typeof showToast === "function") showToast(msg, "error");
            else alert(msg);
            return;
        }
        if (!typeKey || !start || !end) {
            const msg = "Veuillez compléter tous les champs obligatoires.";
            if (typeof showToast === "function") showToast(msg, "error");
            else alert(msg);
            return;
        }
        if (end < start) {
            const msg = "La date de fin doit être postérieure ou égale à la date de début.";
            if (typeof showToast === "function") showToast(msg, "error");
            else alert(msg);
            return;
        }
        const payload = { employee: empId, absence_type: typeKey, start_date: start, end_date: end, reason, status: "Pending" };
        console.log("[OTOMIA] Données congé envoyées :", payload);
        try {
            const response = await apiPost("/absences/leave-request/", payload);
            console.log("[OTOMIA] Réponse API congé :", response);
            closeLeaveModal();
            await otomiaAfterMutation("presences", "Demande de congé envoyée avec succès.");
            await refreshAllPresencesPanels();
        } catch (e) {
            console.error("[OTOMIA] Erreur congé :", e, e?.data);
            const msg = (typeof otomiaFormatValidationErrors === "function" && otomiaFormatValidationErrors(e?.data))
                || (e.message || "Impossible d'enregistrer la demande de congé. Veuillez réessayer.");
            if (typeof showToast === "function") showToast(msg, "error");
            else alert(msg);
        }
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

    window.portalClockIn = async function portalClockIn() {
        const empId = currentUser?.employee_id;
        if (!empId) return alert("Profil employé non lié.");
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const time = now.toTimeString().slice(0, 5);
        try {
            await apiPost("/attendance/pointages/", {
                employee: empId,
                event_type: "presence",
                date: today,
                check_in: time,
                notes: "Pointage portail employé",
            });
            if (typeof showToast === "function") showToast("Présence enregistrée", "success");
            else alert("Présence enregistrée.");
            if (document.getElementById("tab-presences")) {
                await otomiaAfterMutation("presences", null, { skipDashboard: false });
                if (typeof renderPortailEmploye === "function") renderPortailEmploye();
            }
        } catch (e) {
            const msg = e?.message?.includes("média") || e?.message?.includes("media type")
                ? "Impossible d'enregistrer les données. Veuillez réessayer."
                : (e.message || "Impossible d'enregistrer le pointage.");
            if (typeof showToast === "function") showToast(msg, "error");
            else alert(msg);
        }
    };

    window.refreshPresencesData = async function refreshPresencesData(options = {}) {
        if (!document.getElementById("pres-stats-bar")) return;

        if (options.silent && !options.force) {
            try {
                const sync = await otomiaFetchSync();
                renderPresStats(sync.presences);
            } catch (e) { console.warn("Presences silent refresh:", e.message); }
            return;
        }

        try {
            const [absences, missions] = await Promise.all([
                apiGet("/absences/"),
                apiGet("/missions/"),
            ]);
            const canValidate = canWriteModule("presences") && currentUser?.role !== "EMPLOYE";
            const absEl = document.getElementById("abs-list");
            if (absEl) {
                absEl.innerHTML = absences.map((a) => `
                    <tr>
                        <td>${a.employee_name}</td><td>${a.absence_type}</td>
                        <td>${a.start_date}</td><td>${a.end_date}</td><td>${statusBadge(a.status)}</td>
                        <td>${a.status === "Pending" && canValidate ? `
                            <button class="btn btn-small btn-primary" onclick="approveAbs(${a.id})">Approuver</button>
                            <button class="btn btn-small btn-danger" onclick="rejectAbs(${a.id})">Refuser</button>` : "-"}
                        </td>
                    </tr>`).join("") || "<tr><td colspan='6'>Aucune demande</td></tr>";
            }
            const missEl = document.getElementById("miss-list");
            if (missEl) {
                missEl.innerHTML = missions.map((m) => `
                    <tr><td>${m.employee_name}</td><td>${m.title}</td><td>${m.destination}</td>
                    <td>${m.start_date} → ${m.end_date}</td><td>${m.status}</td></tr>`).join("") || "<tr><td colspan='5'>Aucune mission</td></tr>";
            }

            const sync = await otomiaFetchSync();
            renderPresStats(sync.presences);

            if (options.force || options.full) {
                await refreshAllPresencesPanels();
            } else {
                const activePanel = document.querySelector(".presences-module .module-tab-panel.active");
                if (activePanel?.id === "pres-panel-pointage") await loadPointagePanel();
                if (activePanel?.id === "pres-panel-recap") await loadRecapPanel();
                if (activePanel?.id === "pres-panel-presences") await loadReportPanel();
                if (activePanel?.id === "pres-panel-grille") await loadGridPanel();
            }
        } catch (e) {
            console.warn("Presences refresh:", e.message);
        }
    };
})();
