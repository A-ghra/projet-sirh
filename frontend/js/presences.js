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
    const MISSION_STATUS_LABELS = {
        PENDING_APPROVAL: "En attente d'approbation",
        APPROVED: "Approuvée",
        IN_PROGRESS: "En cours",
        COMPLETED: "Terminée",
        CANCELLED: "Annulée",
        Pending: "En attente d'approbation",
        Approved: "Approuvée",
        Rejected: "Annulée",
        Completed: "Terminée",
    };
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
        const isLeaveTypesTab = (t) => {
            const key = (t.feature_key || "").toLowerCase();
            const name = (t.feature_name || "").toLowerCase();
            return key === "onglet_types" || key.includes("types_cong") || name.includes("types de cong");
        };
        const rawTabs = dbTabs.some((t) => t.feature_key === "onglet_pointage") ? dbTabs : defaultTabs;
        const tabs = rawTabs.filter((t) => !isLeaveTypesTab(t));
        const firstTabKey = (tabs[0]?.feature_key || "onglet_pointage").replace("onglet_", "");
        const tabsHtml = renderModuleTabsHtml(tabs, "pres-tabs");
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
                    <table class="pres-table"><thead><tr><th>Employé</th><th>Début</th><th>Fin</th><th>Jours</th><th>Motif</th><th>Statut</th><th>Actions</th></tr></thead>
                    <tbody id="abs-list"></tbody></table>
                </div>

                <div class="module-tab-panel ${firstTabKey === "missions" ? "active" : ""}" id="pres-panel-missions">
                    <div class="action-bar">
                        ${canWrite ? `<button class="btn btn-primary" onclick="window.openMissionForm()"><i class="fas fa-plus"></i> Nouvelle mission</button>` : ""}
                        <div class="export-bar">
                            <button class="btn btn-secondary" onclick="window.printMissionsList()"><i class="fas fa-print"></i> Imprimer</button>
                            <button class="btn btn-secondary" onclick="window.exportMissions('pdf')"><i class="fas fa-file-pdf"></i> PDF</button>
                            <button class="btn btn-secondary" onclick="window.exportMissions('xlsx')"><i class="fas fa-file-excel"></i> Excel</button>
                            <button class="btn btn-secondary" onclick="window.exportMissions('docx')"><i class="fas fa-file-word"></i> Word</button>
                        </div>
                    </div>
                    <div class="pres-filters action-bar">
                        <input type="search" id="mission-search" class="filter-search" placeholder="🔍 Entrer votre recherche (nom, matricule, lieu, objet...)"
                            oninput="window._missionSearch=this.value;loadMissionsPanel()">
                        <label>Mois <select id="mission-filter-month" onchange="loadMissionsPanel()">${monthYearOptions(f.month, f.year).months}</select></label>
                        <label>Année <select id="mission-filter-year" onchange="loadMissionsPanel()">${monthYearOptions(f.month, f.year).years}</select></label>
                        <label>Département <select id="mission-filter-dept" onchange="loadMissionsPanel()"><option value="">Tous</option></select></label>
                        <label>État <select id="mission-filter-status" onchange="loadMissionsPanel()">
                            <option value="">Tous</option>
                            <option value="PENDING_APPROVAL">En attente d'approbation</option>
                            <option value="APPROVED">Approuvée</option>
                            <option value="IN_PROGRESS">En cours</option>
                            <option value="COMPLETED">Terminée</option>
                            <option value="CANCELLED">Annulée</option>
                        </select></label>
                    </div>
                    <div class="table-responsive" id="missions-print-area">
                        <table class="pres-table"><thead><tr>
                            <th>N°</th><th>Employé</th><th>Matricule</th><th>Département</th>
                            <th>Objet</th><th>Lieu</th><th>Début</th><th>Fin</th><th>Jours</th><th>État</th><th>Actions</th>
                        </tr></thead>
                        <tbody id="miss-list"><tr><td colspan="11"><i class="fas fa-spinner fa-spin"></i> Chargement...</td></tr></tbody></table>
                    </div>
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
            <div id="mission-modal" class="custom-modal" hidden>
                <div class="custom-modal-content panel mission-modal-panel">
                    <div id="mission-modal-body"></div>
                </div>
            </div>
            <div id="leave-modal" class="custom-modal" hidden>
                <div class="custom-modal-content panel">
                    <h3><i class="fas fa-umbrella-beach"></i> Demande de congé</h3>
                    <div class="form-row">
                        <div id="leave-employee-wrap" hidden><label>Employé <span class="req">*</span></label>
                            <select id="leave-employee"></select></div>
                        <div><label>Date début <span class="req">*</span></label><input type="date" id="leave-start" onchange="window.updateLeaveDaysCount()"></div>
                        <div><label>Date fin <span class="req">*</span></label><input type="date" id="leave-end" onchange="window.updateLeaveDaysCount()"></div>
                        <div><label>Nombre de jours</label><input type="number" id="leave-days" readonly min="1" placeholder="—"></div>
                    </div>
                    <div><label>Motif / commentaire</label><textarea id="leave-reason" rows="2" placeholder="Motif de la demande"></textarea></div>
                    <div><label>Pièce justificative (optionnelle)</label><input type="file" id="leave-justif" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"></div>
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
            if (panelKey === "missions") loadMissionsPanel();
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
        const tasks = [
            loadPointagePanel(),
            loadRecapPanel(),
            loadReportPanel(),
            loadGridPanel(),
            loadAutoAbsencesPanel(),
        ];
        if (document.getElementById("miss-list")) tasks.push(loadMissionsPanel());
        await Promise.allSettled(tasks);
    }

    async function refreshAfterMissionMutation(message) {
        await loadMissionsPanel();
        await refreshAllPresencesPanels();
        await otomiaAfterMutation("presences", message);
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

    window.updateLeaveDaysCount = () => {
        const start = document.getElementById("leave-start")?.value;
        const end = document.getElementById("leave-end")?.value;
        const daysEl = document.getElementById("leave-days");
        if (!daysEl || !start || !end) {
            if (daysEl) daysEl.value = "";
            return;
        }
        if (end < start) {
            daysEl.value = "";
            return;
        }
        const s = new Date(start + "T12:00:00");
        const e = new Date(end + "T12:00:00");
        daysEl.value = Math.round((e - s) / 86400000) + 1;
    };

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
        const today = new Date().toISOString().slice(0, 10);
        const startEl = document.getElementById("leave-start");
        const endEl = document.getElementById("leave-end");
        const reasonEl = document.getElementById("leave-reason");
        const justifEl = document.getElementById("leave-justif");
        if (startEl) startEl.value = today;
        if (endEl) endEl.value = today;
        if (reasonEl) reasonEl.value = "";
        if (justifEl) justifEl.value = "";
        window.updateLeaveDaysCount();
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
        const start = document.getElementById("leave-start")?.value;
        const end = document.getElementById("leave-end")?.value;
        const reason = document.getElementById("leave-reason")?.value?.trim() || "";
        const justifFile = document.getElementById("leave-justif")?.files?.[0];
        if (!empId) {
            const msg = "Veuillez sélectionner un employé ou lier votre profil employé.";
            if (typeof showToast === "function") showToast(msg, "error");
            else alert(msg);
            return;
        }
        if (!start || !end) {
            const msg = "Veuillez compléter les dates de congé.";
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
        const fd = new FormData();
        fd.append("employee", String(empId));
        fd.append("start_date", start);
        fd.append("end_date", end);
        fd.append("reason", reason);
        fd.append("status", "Pending");
        fd.append("absence_type", "CP");
        if (justifFile) fd.append("justification_file", justifFile);
        console.log("[OTOMIA] Données congé envoyées :", { employee: empId, start_date: start, end_date: end, reason });
        try {
            const response = await apiFetch("/absences/leave-request/", { method: "POST", body: fd });
            if (!response.ok) {
                const err = typeof otomiaParseResponseBody === "function"
                    ? await otomiaParseResponseBody(response)
                    : null;
                throw new Error(err?.error || err?.detail || `Erreur (${response.status})`);
            }
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

    function canDeleteMission() {
        return ["SUPER_ADMIN", "ADMIN_RH", "GESTIONNAIRE_RH"].includes(currentUser?.role);
    }

    function missionStatusBadge(status) {
        const label = MISSION_STATUS_LABELS[status] || status;
        return `<span class="contract-lifecycle contract-lc-${(status || "").toLowerCase()}">${label}</span>`;
    }

    window.loadMissionsPanel = async function loadMissionsPanel() {
        const tbody = document.getElementById("miss-list");
        if (!tbody) return;
        const params = new URLSearchParams();
        const search = window._missionSearch || document.getElementById("mission-search")?.value;
        const month = document.getElementById("mission-filter-month")?.value;
        const year = document.getElementById("mission-filter-year")?.value;
        const dept = document.getElementById("mission-filter-dept")?.value;
        const status = document.getElementById("mission-filter-status")?.value;
        if (search) params.set("search", search);
        if (month) params.set("month", month);
        if (year) params.set("year", year);
        if (dept) params.set("department", dept);
        if (status) params.set("status", status);
        try {
            if (!document.getElementById("mission-filter-dept")?.options?.length > 1) {
                try {
                    const depts = await apiGet("/departments/");
                    const sel = document.getElementById("mission-filter-dept");
                    if (sel) sel.innerHTML = `<option value="">Tous</option>${depts.map((d) =>
                        `<option value="${d.id}">${d.name}</option>`).join("")}`;
                } catch (e) { /* ignore */ }
            }
            const missions = await apiGet(`/missions/?${params}`);
            const canWrite = canWriteModule("presences") && canManagePresences();
            tbody.innerHTML = missions.map((m) => {
                const actions = [];
                actions.push(`<button class="btn btn-small" onclick="window.viewMission(${m.id})" title="Voir"><i class="fas fa-eye"></i></button>`);
                if (canWrite) actions.push(`<button class="btn btn-small" onclick="window.openMissionForm(${m.id})" title="Modifier"><i class="fas fa-edit"></i></button>`);
                if (canWrite && m.status === "PENDING_APPROVAL") {
                    actions.push(`<button class="btn btn-small btn-primary" onclick="window.approveMission(${m.id})" title="Approuver"><i class="fas fa-check"></i></button>`);
                }
                if (canWrite && ["APPROVED", "IN_PROGRESS"].includes(m.status)) {
                    actions.push(`<button class="btn btn-small btn-secondary" onclick="window.startMission(${m.id})" title="Démarrer"><i class="fas fa-play"></i></button>`);
                    actions.push(`<button class="btn btn-small" onclick="window.openCloseMission(${m.id})" title="Clôturer"><i class="fas fa-flag-checkered"></i></button>`);
                }
                if (canDeleteMission()) {
                    actions.push(`<button class="btn btn-small btn-danger" onclick="window.deleteMission(${m.id})" title="Supprimer"><i class="fas fa-trash"></i></button>`);
                }
                return `<tr>
                    <td>${m.mission_number || "-"}</td>
                    <td>${m.employee_name}</td><td>${m.employee_matricule || "-"}</td>
                    <td>${m.employee_department || "-"}</td>
                    <td>${m.title}</td><td>${m.destination}${m.city ? ", " + m.city : ""}</td>
                    <td>${m.start_date}</td><td>${m.end_date}</td><td>${m.days_count || "-"}</td>
                    <td>${missionStatusBadge(m.status)}</td>
                    <td style="white-space:nowrap">${actions.join(" ")}</td>
                </tr>`;
            }).join("") || `<tr><td colspan="11">Aucune mission trouvée.</td></tr>`;
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="11" class="error-message">Impossible de charger les missions.</td></tr>`;
        }
    };

    function missionFormHtml(record, employees) {
        const empId = record?.employee || employees[0]?.id || "";
        const emp = employees.find((e) => String(e.id) === String(empId)) || employees[0] || {};
        const readonly = record?.status === "COMPLETED";
        return `
            <h3><i class="fas fa-briefcase"></i> ${record?.id ? "Modifier la mission" : "Nouvelle mission"}</h3>
            <input type="hidden" id="mission-id" value="${record?.id || ""}">
            <h4>Informations employé</h4>
            <div class="form-row">
                <div><label>Employé <span class="req">*</span></label>
                    <select id="mission-employee" ${readonly ? "disabled" : ""} onchange="window.updateMissionEmployeeInfo()">
                        ${employees.map((e) => `<option value="${e.id}" ${String(e.id) === String(empId) ? "selected" : ""}>${e.full_name} (${e.matricule})</option>`).join("")}
                    </select></div>
                <div><label>Matricule</label><input id="mission-matricule" readonly value="${emp.matricule || "-"}"></div>
                <div><label>Département</label><input id="mission-department" readonly value="${emp.department_name || "-"}"></div>
                <div><label>Poste</label><input id="mission-position" readonly value="${emp.position || "-"}"></div>
                <div><label>Responsable</label><input id="mission-manager" readonly value="${record?.manager_name || emp.manager_name || "-"}"></div>
            </div>
            <h4>Informations sur la mission</h4>
            <div class="form-row">
                <div><label>Objet <span class="req">*</span></label><input id="mission-title" value="${record?.title || ""}" ${readonly ? "readonly" : ""}></div>
                <div><label>Lieu <span class="req">*</span></label><input id="mission-destination" value="${record?.destination || ""}" ${readonly ? "readonly" : ""}></div>
            </div>
            <div><label>Description</label><textarea id="mission-description" rows="2" ${readonly ? "readonly" : ""}>${record?.description || ""}</textarea></div>
            <div class="form-row">
                <div><label>Ville</label><input id="mission-city" value="${record?.city || ""}" ${readonly ? "readonly" : ""}></div>
                <div><label>Province</label><input id="mission-province" value="${record?.province || ""}" ${readonly ? "readonly" : ""}></div>
                <div><label>Pays</label><input id="mission-country" value="${record?.country || "RDC"}" ${readonly ? "readonly" : ""}></div>
                <div><label>Organisme visité</label><input id="mission-org" value="${record?.visited_organization || ""}" ${readonly ? "readonly" : ""}></div>
            </div>
            <h4>Période</h4>
            <div class="form-row">
                <div><label>Date début <span class="req">*</span></label><input type="date" id="mission-start" value="${record?.start_date || ""}" ${readonly ? "readonly" : ""}></div>
                <div><label>Heure départ</label><input type="time" id="mission-start-time" value="${(record?.start_time || "").slice(0, 5)}" ${readonly ? "readonly" : ""}></div>
                <div><label>Date fin <span class="req">*</span></label><input type="date" id="mission-end" value="${record?.end_date || ""}" ${readonly ? "readonly" : ""}></div>
                <div><label>Heure retour</label><input type="time" id="mission-end-time" value="${(record?.end_time || "").slice(0, 5)}" ${readonly ? "readonly" : ""}></div>
            </div>
            <h4>Conditions</h4>
            <div class="form-row">
                <div><label>Transport</label><input id="mission-transport" value="${record?.transport_mode || ""}" ${readonly ? "readonly" : ""}></div>
                <div><label>Hébergement</label><input id="mission-accommodation" value="${record?.accommodation || ""}" ${readonly ? "readonly" : ""}></div>
                <div><label>Avance</label><input type="number" step="0.01" id="mission-advance" value="${record?.advance_amount || 0}" ${readonly ? "readonly" : ""}></div>
                <div><label>Indemnité/jour</label><input type="number" step="0.01" id="mission-daily" value="${record?.daily_allowance || 0}" ${readonly ? "readonly" : ""}></div>
                <div><label>Budget</label><input type="number" step="0.01" id="mission-budget" value="${record?.budget_allocated || 0}" ${readonly ? "readonly" : ""}></div>
            </div>
            <div><label>Commentaires</label><textarea id="mission-comments" rows="2" ${readonly ? "readonly" : ""}>${record?.comments || ""}</textarea></div>
            ${!readonly ? `<div><label>Pièce jointe</label><input type="file" id="mission-file" accept=".pdf,.jpg,.jpeg,.png,.docx"></div>` : ""}
            ${record?.documents?.length ? `<h4>Documents</h4><ul>${record.documents.map((d) =>
                `<li><a href="${d.file_url}" target="_blank">${d.doc_type_label || d.label}</a></li>`).join("")}</ul>` : ""}
            <div class="action-bar">
                ${!readonly ? `<button type="button" class="btn btn-primary" onclick="window.saveMission()"><i class="fas fa-save"></i> Enregistrer</button>` : ""}
                <button type="button" class="btn btn-secondary" onclick="window.closeMissionModal()">Fermer</button>
            </div>`;
    }

    window.updateMissionEmployeeInfo = () => {
        const emp = getEmployeeById(document.getElementById("mission-employee")?.value);
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        set("mission-matricule", emp?.matricule || "-");
        set("mission-department", emp?.department_name || "-");
        set("mission-position", emp?.position || "-");
        set("mission-manager", emp?.manager_name || "-");
    };

    window.openMissionForm = async (id) => {
        const modal = document.getElementById("mission-modal");
        const body = document.getElementById("mission-modal-body");
        if (!modal || !body) return;
        console.log("Mission à modifier :", id || "(nouvelle)");
        modal.hidden = false;
        body.innerHTML = `<p class="hint-text"><i class="fas fa-spinner fa-spin"></i> Chargement...</p>`;
        if (!_presEmployeesCache.length) {
            try { _presEmployeesCache = await apiGet("/employees/"); } catch (e) { _presEmployeesCache = []; }
        }
        try {
            const record = id ? await apiGet(`/missions/${id}/`) : null;
            body.innerHTML = missionFormHtml(record, _presEmployeesCache);
        } catch (e) {
            console.error("openMissionForm:", e);
            body.innerHTML = `<p class="error-message">Impossible de charger la mission.</p>`;
        }
    };

    window.viewMission = window.openMissionForm;

    window.closeMissionModal = () => {
        const m = document.getElementById("mission-modal");
        if (m) m.hidden = true;
    };

    function buildMissionPayload(isCreate) {
        const payload = {
            employee: Number(document.getElementById("mission-employee")?.value),
            title: document.getElementById("mission-title")?.value?.trim(),
            destination: document.getElementById("mission-destination")?.value?.trim(),
            description: document.getElementById("mission-description")?.value || "",
            city: document.getElementById("mission-city")?.value || "",
            province: document.getElementById("mission-province")?.value || "",
            country: document.getElementById("mission-country")?.value || "RDC",
            visited_organization: document.getElementById("mission-org")?.value || "",
            start_date: document.getElementById("mission-start")?.value,
            start_time: document.getElementById("mission-start-time")?.value || null,
            end_date: document.getElementById("mission-end")?.value,
            end_time: document.getElementById("mission-end-time")?.value || null,
            transport_mode: document.getElementById("mission-transport")?.value || "",
            accommodation: document.getElementById("mission-accommodation")?.value || "",
            advance_amount: document.getElementById("mission-advance")?.value || 0,
            daily_allowance: document.getElementById("mission-daily")?.value || 0,
            budget_allocated: document.getElementById("mission-budget")?.value || 0,
            comments: document.getElementById("mission-comments")?.value || "",
        };
        if (isCreate) payload.status = "PENDING_APPROVAL";
        return payload;
    }

    window.saveMission = async () => {
        const id = document.getElementById("mission-id")?.value;
        const isEdit = Boolean(id);
        const payload = buildMissionPayload(!isEdit);
        console.log("Mission à modifier :", id || "(nouvelle)");
        console.log("Données envoyées :", payload);
        if (!payload.employee || !payload.title || !payload.destination || !payload.start_date || !payload.end_date) {
            alert("Veuillez compléter les champs obligatoires.");
            return;
        }
        try {
            let missionId = id;
            let response;
            if (isEdit) {
                response = await apiFetch(`/missions/${id}/`, { method: "PATCH", body: payload });
                console.log("Réponse API :", response);
                missionId = response?.id || id;
            } else {
                response = await apiPost("/missions/", payload);
                console.log("Réponse API :", response);
                missionId = response?.id;
            }
            const file = document.getElementById("mission-file")?.files?.[0];
            if (file && missionId) {
                const fd = new FormData();
                fd.append("file", file);
                fd.append("doc_type", "order");
                await apiFetch(`/missions/${missionId}/documents/`, { method: "POST", body: fd });
            }
            closeMissionModal();
            const msg = isEdit
                ? "Mission mise à jour avec succès."
                : "Mission enregistrée avec succès.";
            await refreshAfterMissionMutation(msg);
            if (typeof showToast === "function") showToast(msg, "success");
        } catch (e) {
            console.error("saveMission:", e);
            const msg = isEdit
                ? "Impossible d'enregistrer les modifications. Veuillez réessayer."
                : (e.message || "Impossible d'enregistrer la mission. Veuillez réessayer.");
            alert(msg);
        }
    };

    window.approveMission = async (id) => {
        try {
            await apiPost(`/missions/${id}/approve/`, {});
            await refreshAfterMissionMutation("Mission approuvée.");
            if (typeof showToast === "function") showToast("Mission approuvée", "success");
        } catch (e) {
            console.error("approveMission:", e);
            alert(e.message || "Impossible d'approuver la mission.");
        }
    };

    window.startMission = async (id) => {
        try {
            await apiPost(`/missions/${id}/start/`, {});
            await refreshAfterMissionMutation("Mission démarrée.");
            if (typeof showToast === "function") showToast("Mission démarrée", "success");
        } catch (e) {
            console.error("startMission:", e);
            alert(e.message || "Impossible de démarrer la mission.");
        }
    };

    window.openCloseMission = async (id) => {
        const modal = document.getElementById("mission-modal");
        const body = document.getElementById("mission-modal-body");
        if (!modal || !body) return;
        modal.hidden = false;
        body.innerHTML = `
            <h3><i class="fas fa-flag-checkered"></i> Clôturer la mission</h3>
            <input type="hidden" id="close-mission-id" value="${id}">
            <div><label>Résumé</label><textarea id="close-summary" rows="2"></textarea></div>
            <div><label>Résultats obtenus</label><textarea id="close-results" rows="2"></textarea></div>
            <div><label>Difficultés</label><textarea id="close-difficulties" rows="2"></textarea></div>
            <div><label>Recommandations</label><textarea id="close-recommendations" rows="2"></textarea></div>
            <div><label>Dépenses réelles</label><input type="number" step="0.01" id="close-expenses"></div>
            <div><label>Justificatifs</label><input type="file" id="close-file" accept=".pdf,.jpg,.jpeg,.png,.docx" multiple></div>
            <div class="action-bar">
                <button class="btn btn-primary" onclick="window.submitCloseMission()">Clôturer</button>
                <button class="btn btn-secondary" onclick="window.closeMissionModal()">Annuler</button>
            </div>`;
    };

    window.submitCloseMission = async () => {
        const id = document.getElementById("close-mission-id")?.value;
        await apiPost(`/missions/${id}/close/`, {
            closure_summary: document.getElementById("close-summary")?.value || "",
            closure_results: document.getElementById("close-results")?.value || "",
            closure_difficulties: document.getElementById("close-difficulties")?.value || "",
            closure_recommendations: document.getElementById("close-recommendations")?.value || "",
            actual_expenses: document.getElementById("close-expenses")?.value || 0,
        });
        const files = document.getElementById("close-file")?.files;
        if (files?.length) {
            for (const file of files) {
                const fd = new FormData();
                fd.append("file", file);
                fd.append("doc_type", "closure");
                await apiFetch(`/missions/${id}/documents/`, { method: "POST", body: fd });
            }
        }
        closeMissionModal();
        await refreshAfterMissionMutation("Mission clôturée.");
        if (typeof showToast === "function") showToast("Mission clôturée", "success");
    };

    window.deleteMission = async (id) => {
        if (!confirm("Êtes-vous sûr de vouloir supprimer cette mission ?")) return;
        try {
            await apiDelete(`/missions/${id}/`);
            await refreshAfterMissionMutation("Mission supprimée.");
            if (typeof showToast === "function") showToast("Mission supprimée", "success");
        } catch (e) {
            console.error("deleteMission:", e);
            alert(e.message || "Impossible de supprimer la mission.");
        }
    };

    window.exportMissions = async (format) => {
        const params = new URLSearchParams({ export_format: format });
        const search = document.getElementById("mission-search")?.value;
        const month = document.getElementById("mission-filter-month")?.value;
        const year = document.getElementById("mission-filter-year")?.value;
        const dept = document.getElementById("mission-filter-dept")?.value;
        const status = document.getElementById("mission-filter-status")?.value;
        if (search) params.set("search", search);
        if (month) params.set("month", month);
        if (year) params.set("year", year);
        if (dept) params.set("department", dept);
        if (status) params.set("status", status);
        try {
            const response = await otomiaApiFetch(`/missions/export/?${params}`, {
                headers: { Accept: "application/octet-stream, */*" },
            });
            if (!response.ok) throw new Error("Export impossible.");
            if (typeof downloadBlobFromResponse === "function") {
                await downloadBlobFromResponse(response, `MISSIONS.${format === "docx" ? "docx" : format}`);
            }
            if (typeof showToast === "function") showToast("Export réussi", "success");
        } catch (e) {
            alert(e.message || "Erreur d'export.");
        }
    };

    window.printMissionsList = () => {
        const area = document.getElementById("missions-print-area");
        if (!area) return window.print();
        const w = window.open("", "_blank");
        w.document.write(`<html><head><title>Missions</title><style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px;font-size:11px}th{background:#1a5f9e;color:#fff}</style></head><body>${area.innerHTML}</body></html>`);
        w.document.close();
        w.print();
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
            const absences = await apiGet("/absences/");
            const canValidate = canWriteModule("presences") && currentUser?.role !== "EMPLOYE";
            const absEl = document.getElementById("abs-list");
            if (absEl) {
                absEl.innerHTML = absences.map((a) => {
                    const days = a.days_count || (a.start_date && a.end_date
                        ? Math.round((new Date(a.end_date) - new Date(a.start_date)) / 86400000) + 1
                        : "—");
                    const justif = a.justification_file_url
                        ? ` <a href="${a.justification_file_url}" target="_blank" title="Justificatif"><i class="fas fa-paperclip"></i></a>` : "";
                    return `<tr>
                        <td>${a.employee_name}</td>
                        <td>${a.start_date}</td><td>${a.end_date}</td><td>${days}</td>
                        <td>${(a.reason || "—").slice(0, 80)}${justif}</td>
                        <td>${statusBadge(a.status)}</td>
                        <td>${a.status === "Pending" && canValidate ? `
                            <button class="btn btn-small btn-primary" onclick="approveAbs(${a.id})">Approuver</button>
                            <button class="btn btn-small btn-danger" onclick="rejectAbs(${a.id})">Refuser</button>` : "-"}
                        </td>
                    </tr>`;
                }).join("") || "<tr><td colspan='7'>Aucune demande</td></tr>";
            }
            if (document.getElementById("miss-list")) await loadMissionsPanel();

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
