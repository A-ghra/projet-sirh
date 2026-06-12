/**
 * OTOMIA RH — Module Contrats
 */
(function () {
    const STATUS_LABELS = {
        DRAFT: "Brouillon",
        PENDING_SIGNATURE: "En attente de signature",
        SIGNED: "Signé",
        LOCKED: "Verrouillé",
        CANCELLED: "Annulé",
        ARCHIVED: "Archivé",
    };
    const LIFECYCLE_LABELS = {
        ACTIVE: "Actif",
        EXPIRING_SOON: "Expirant bientôt",
        EXPIRED: "Expiré",
        TERMINATED: "Résilié",
    };
    const DEFAULT_BENEFITS = ["Transport", "Logement", "Téléphone", "Internet", "Assurance santé", "Véhicule", "Prime spéciale"];

    let _employeesCache = [];
    let _typesCache = [];
    let _dashboardCache = null;
    let _departmentsCache = [];
    let _contractsCache = [];

    async function downloadContractExport(apiPath, fallbackName, expectedType) {
        const response = await otomiaApiFetch(apiPath, {
            headers: {
                Accept: "application/octet-stream, application/pdf, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/zip, */*",
            },
        });
        if (response.status === 401) {
            sessionStorage.removeItem("otomia_user");
            if (typeof otomiaNavigate === "function") otomiaNavigate("login.html", "session expirée export contrat");
            throw new Error("Session expirée — reconnectez-vous.");
        }
        if (!response.ok) {
            const err = typeof otomiaParseResponseBody === "function"
                ? await otomiaParseResponseBody(response)
                : null;
            const msg = err?.error || err?.detail
                || (response.status === 404
                    ? "Aucun contrat disponible pour les critères sélectionnés."
                    : "Une erreur est survenue lors de l'exportation du contrat.");
            throw new Error(msg);
        }
        const exportType = response.headers.get("X-Export-Type");
        if (expectedType && exportType && exportType !== expectedType) {
            throw new Error(`Erreur : export ${exportType} détecté au lieu de ${expectedType}.`);
        }
        if (typeof downloadBlobFromResponse === "function") {
            return await downloadBlobFromResponse(response, fallbackName);
        }
        const blob = await response.blob();
        const disposition = response.headers.get("Content-Disposition") || "";
        const match = disposition.match(/filename="?([^";\n]+)"?/i);
        const filename = match ? match[1] : fallbackName;
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

    function ensureContractModal() {
        let modal = document.getElementById("contract-modal");
        if (!modal) {
            modal = document.createElement("div");
            modal.id = "contract-modal";
            modal.className = "custom-modal";
            modal.hidden = true;
            modal.innerHTML = `<div class="custom-modal-content panel contract-modal-panel"><div id="contract-modal-body"></div></div>`;
            modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
            document.body.appendChild(modal);
        }
        return modal;
    }

    function canWriteContracts() {
        return canWriteModule("contrats") && ["SUPER_ADMIN", "ADMIN_RH", "GESTIONNAIRE_RH"].includes(currentUser?.role);
    }

    function canManageContracts() {
        return ["SUPER_ADMIN", "ADMIN_RH", "GESTIONNAIRE_RH"].includes(currentUser?.role);
    }

    function statusBadge(status) {
        const label = STATUS_LABELS[status] || status;
        const cls = (status || "").toLowerCase();
        return `<span class="contract-status contract-status-${cls}">${label}${status === "LOCKED" ? " 🔒" : ""}</span>`;
    }

    function lifecycleBadge(lc) {
        const label = LIFECYCLE_LABELS[lc] || lc || "-";
        return `<span class="contract-lifecycle contract-lc-${(lc || "").toLowerCase()}">${label}</span>`;
    }

    function buildContractsPanelHtml(opts = {}) {
        const title = opts.title || getModuleTitle("contrats", "Contrats");
        const canWrite = canWriteContracts();
        const heading = opts.embedded
            ? `<div class="action-bar"><h3><i class="fas fa-file-contract"></i> ${title}</h3>`
            : `<div class="action-bar"><h2><i class="fas fa-file-contract"></i> ${title}</h2>`;
        return `
            <div class="contracts-module ${opts.embedded ? "contracts-embedded" : ""}">
                ${heading}
                    <div class="export-bar">
                        ${canWrite ? `
                            <button class="btn btn-primary" onclick="window.openContractForm()"><i class="fas fa-plus"></i> Nouveau contrat</button>
                            <button class="btn btn-secondary" onclick="window.importContractDocument()"><i class="fas fa-file-import"></i> Importer un contrat</button>
                        ` : ""}
                        <button class="btn btn-secondary" onclick="window.exportContractIndividualModal()"><i class="fas fa-user-tag"></i> Export individuel</button>
                        ${canManageContracts() ? `
                            <button class="btn btn-secondary" onclick="window.exportContractsGlobal()"><i class="fas fa-file-export"></i> Export global</button>
                            <button class="btn btn-secondary" onclick="window.manageContractTypes()"><i class="fas fa-cog"></i> Types</button>
                        ` : ""}
                    </div>
                </div>
                <div id="contracts-stats" class="dashboard-grid pres-stats-bar"></div>
                <div class="pres-filters action-bar">
                    <input type="search" id="contract-search" class="filter-search" placeholder="🔍 Rechercher (nom, matricule, n° contrat...)"
                        oninput="window._contractSearch=this.value;loadContractsList()">
                    <label>Type <select id="contract-filter-type" onchange="loadContractsList()"><option value="">Tous</option></select></label>
                    <label>Statut <select id="contract-filter-lifecycle" onchange="loadContractsList()">
                        <option value="">Tous</option>
                        ${Object.entries(LIFECYCLE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
                    </select></label>
                    <label><input type="checkbox" id="contract-filter-expiring" onchange="loadContractsList()"> Expirant bientôt</label>
                </div>
                <div class="contracts-charts dashboard-grid" id="contracts-charts"></div>
                <div class="table-responsive">
                    <table class="pres-table"><thead><tr>
                        <th>N° contrat</th><th>Employé</th><th>Matricule</th><th>Département</th>
                        <th>Type</th><th>Début</th><th>Fin</th><th>Statut</th><th>Document</th><th>Actions</th>
                    </tr></thead><tbody id="contracts-list"><tr><td colspan="10"><i class="fas fa-spinner fa-spin"></i> Chargement...</td></tr></tbody></table>
                </div>
            </div>`;
    }

    async function initContractsPanel() {
        await Promise.all([loadContractsDashboard(), loadContractTypes(), loadContractsList()]);
    }

    window.renderContrats = async function renderContrats() {
        if (!contentArea) contentArea = document.getElementById("content-area");
        if (!contentArea) return;
        contentArea.innerHTML = `<div class="module-container animated-panel">${buildContractsPanelHtml()}</div>`;
        ensureContractModal();
        await initContractsPanel();
    };

    window.renderAdminPersonnelContracts = async function renderAdminPersonnelContracts() {
        const panel = document.getElementById("admin-panel-contrats");
        if (!panel) return;
        if (!panel.dataset.mounted) {
            panel.innerHTML = buildContractsPanelHtml({ embedded: true, title: "Contrats de travail" });
            panel.dataset.mounted = "1";
        }
        ensureContractModal();
        await initContractsPanel();
    };

    async function loadContractTypes() {
        try {
            _typesCache = await apiGet("/contracts/types/");
            const sel = document.getElementById("contract-filter-type");
            if (sel) {
                sel.innerHTML = `<option value="">Tous</option>${_typesCache.map((t) =>
                    `<option value="${t.code}">${t.label}</option>`).join("")}`;
            }
        } catch (e) { console.warn("Types contrats:", e.message); }
    }

    async function loadContractsDashboard() {
        try {
            _dashboardCache = await apiGet("/contracts/dashboard/");
            const el = document.getElementById("contracts-stats");
            if (!el || !_dashboardCache) return;
            const d = _dashboardCache;
            el.innerHTML = `
                <div class="stat-card stat-animated"><i class="fas fa-file-contract"></i><div class="stat-info"><h3>Total</h3><p>${d.total}</p></div></div>
                <div class="stat-card stat-animated"><i class="fas fa-infinity"></i><div class="stat-info"><h3>CDI</h3><p>${d.cdi}</p></div></div>
                <div class="stat-card stat-animated"><i class="fas fa-calendar-alt"></i><div class="stat-info"><h3>CDD</h3><p>${d.cdd}</p></div></div>
                <div class="stat-card stat-animated"><i class="fas fa-exclamation-triangle"></i><div class="stat-info"><h3>Expirent bientôt</h3><p>${d.expiring_soon}</p></div></div>
                <div class="stat-card stat-animated"><i class="fas fa-signature"></i><div class="stat-info"><h3>Signés</h3><p>${d.signed}</p></div></div>
                <div class="stat-card stat-animated"><i class="fas fa-hourglass-half"></i><div class="stat-info"><h3>En attente signature</h3><p>${d.pending_signature}</p></div></div>`;
            const charts = document.getElementById("contracts-charts");
            if (charts && d.by_type?.length) {
                charts.innerHTML = `<div class="panel chart-card"><h3>Répartition par type</h3>
                    <div class="contract-type-bars">${d.by_type.map((t) =>
                        `<div class="bar-row"><span>${t.contract_type}</span><div class="bar-fill" style="width:${Math.min(100, t.count * 10)}%"></div><span>${t.count}</span></div>`
                    ).join("")}</div></div>`;
            }
        } catch (e) { console.warn("Dashboard contrats:", e.message); }
    }

    window.loadContractsList = async function loadContractsList() {
        const tbody = document.getElementById("contracts-list");
        if (!tbody) return;
        const params = new URLSearchParams();
        const search = window._contractSearch || document.getElementById("contract-search")?.value;
        const type = document.getElementById("contract-filter-type")?.value;
        const lifecycle = document.getElementById("contract-filter-lifecycle")?.value;
        const expiring = document.getElementById("contract-filter-expiring")?.checked;
        if (search) params.set("search", search);
        if (type) params.set("contract_type", type);
        if (lifecycle) params.set("lifecycle", lifecycle);
        if (expiring) params.set("expiring", "1");
        try {
            const rows = await apiGet(`/contracts/?${params}`);
            _contractsCache = rows;
            const canWrite = canWriteContracts();
            tbody.innerHTML = rows.map((c) => {
                const locked = c.is_locked || c.status === "LOCKED";
                const actions = [];
                actions.push(`<button class="btn btn-small" onclick="window.viewContract(${c.id})" title="Voir"><i class="fas fa-eye"></i></button>`);
                if (canWrite && !locked) {
                    actions.push(`<button class="btn btn-small" onclick="window.editContract(${c.id})" title="Modifier"><i class="fas fa-edit"></i></button>`);
                }
                actions.push(`<button class="btn btn-small btn-secondary" onclick="window.exportContractModal(${c.id})" title="Exporter"><i class="fas fa-file-export"></i></button>`);
                if (c.file_url) {
                    actions.push(`<a class="btn btn-small" href="${c.file_url}" target="_blank" title="Document importé"><i class="fas fa-paperclip"></i></a>`);
                }
                if (canManageContracts() && c.status !== "ARCHIVED") {
                    actions.push(`<button class="btn btn-small" onclick="window.signContractRh(${c.id})" title="Signer RH"><i class="fas fa-signature"></i></button>`);
                }
                return `<tr>
                    <td>${c.contract_number || "-"}</td>
                    <td>${c.employee_name}</td>
                    <td>${c.employee_matricule || "-"}</td>
                    <td>${c.employee_department || "-"}</td>
                    <td>${c.contract_type}</td>
                    <td>${c.start_date}</td>
                    <td>${c.end_date || "—"}</td>
                    <td>${lifecycleBadge(c.lifecycle_status)}</td>
                    <td>${c.source === "IMPORTED" ? '<span class="pres-auto-tag">Importé</span>' : (c.file_url ? "📎" : "—")}</td>
                    <td>${actions.join(" ")}</td>
                </tr>`;
            }).join("") || `<tr><td colspan="10">Aucun contrat trouvé.</td></tr>`;
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="9" class="error-message">Impossible de charger les contrats.</td></tr>`;
        }
    };

    function renderBenefitsHtml(benefits, locked) {
        const list = benefits.length ? benefits : [];
        if (!list.length) return `<p class="hint-text">Aucun avantage — cliquez sur Ajouter.</p>`;
        return list.map((b, i) => {
            const label = b.label || b.type || "";
            const amount = b.amount ?? "";
            return `<div class="form-row contract-benefit-row" data-idx="${i}">
                <div><label>Type</label><select class="benefit-label" ${locked ? "disabled" : ""}>
                    ${DEFAULT_BENEFITS.map((t) => `<option value="${t}" ${label === t ? "selected" : ""}>${t}</option>`).join("")}
                </select></div>
                <div><label>Montant</label><input type="number" step="0.01" class="benefit-amount" value="${amount}" ${locked ? "readonly" : ""}></div>
                ${!locked ? `<button type="button" class="btn btn-small btn-danger" onclick="this.closest('.contract-benefit-row').remove()"><i class="fas fa-trash"></i></button>` : ""}
            </div>`;
        }).join("");
    }

    window.addContractBenefit = () => {
        const wrap = document.getElementById("contract-benefits-list");
        if (!wrap) return;
        if (wrap.querySelector(".hint-text")) wrap.innerHTML = "";
        const div = document.createElement("div");
        div.className = "form-row contract-benefit-row";
        div.innerHTML = `<div><label>Type</label><select class="benefit-label">${DEFAULT_BENEFITS.map((t) => `<option value="${t}">${t}</option>`).join("")}</select></div>
            <div><label>Montant</label><input type="number" step="0.01" class="benefit-amount" value="0"></div>
            <button type="button" class="btn btn-small btn-danger" onclick="this.closest('.contract-benefit-row').remove()"><i class="fas fa-trash"></i></button>`;
        wrap.appendChild(div);
    };

    function collectBenefits() {
        return Array.from(document.querySelectorAll(".contract-benefit-row")).map((row) => ({
            label: row.querySelector(".benefit-label")?.value,
            amount: row.querySelector(".benefit-amount")?.value || 0,
        })).filter((b) => b.label);
    }

    function archiveLogsHtml(logs) {
        if (!logs?.length) return `<p class="hint-text">Aucune entrée d'archivage.</p>`;
        return `<table class="pres-table"><thead><tr><th>Action</th><th>Utilisateur</th><th>Date</th><th>Note</th></tr></thead>
            <tbody>${logs.map((l) => `<tr>
                <td>${l.action_label || l.action}</td>
                <td>${l.user || "-"}</td>
                <td>${new Date(l.created_at).toLocaleString("fr-FR")}</td>
                <td>${l.note || "—"}</td>
            </tr>`).join("")}</tbody></table>`;
    }

    function contractFormHtml(record, employees, types, archiveLogs) {
        const empId = record?.employee || employees[0]?.id || "";
        const emp = employees.find((e) => String(e.id) === String(empId)) || employees[0] || {};
        const typeOpts = types.map((t) =>
            `<option value="${t.code}" ${record?.contract_type === t.code ? "selected" : ""}>${t.label}</option>`).join("");
        const locked = record?.is_locked || record?.status === "LOCKED";
        return `
            <h3><i class="fas fa-file-contract"></i> ${record?.id ? "Modifier le contrat" : "Nouveau contrat"}</h3>
            <input type="hidden" id="contract-id" value="${record?.id || ""}">
            <h4>Informations employé</h4>
            <div class="form-row">
                <div><label>Employé <span class="req">*</span></label>
                    <select id="contract-employee" ${locked ? "disabled" : ""}>${employees.map((e) =>
                        `<option value="${e.id}" ${String(e.id) === String(empId) ? "selected" : ""}>${e.full_name} (${e.matricule})</option>`).join("")}</select></div>
                <div><label>Matricule</label><input readonly value="${emp.matricule || "-"}"></div>
                <div><label>Département</label><input readonly value="${emp.department_name || "-"}"></div>
                <div><label>Poste</label><input id="contract-position" value="${record?.position_title || emp.position || ""}" ${locked ? "readonly" : ""}></div>
                <div><label>Responsable</label><input readonly value="${record?.manager_name || emp.manager_name || "-"}"></div>
            </div>
            <h4>Informations contractuelles</h4>
            <div class="form-row">
                <div><label>N° contrat</label><input id="contract-number" value="${record?.contract_number || ""}" placeholder="Auto" ${locked ? "readonly" : ""}></div>
                <div><label>Type <span class="req">*</span></label><select id="contract-type" ${locked ? "disabled" : ""}>${typeOpts}</select></div>
                <div><label>Date début <span class="req">*</span></label><input type="date" id="contract-start" value="${record?.start_date || ""}" ${locked ? "readonly" : ""}></div>
                <div><label>Date fin</label><input type="date" id="contract-end" value="${record?.end_date || ""}" ${locked ? "readonly" : ""}></div>
            </div>
            <div class="form-row">
                <div><label>Période d'essai (fin)</label><input type="date" id="contract-probation" value="${record?.probation_end_date || ""}" ${locked ? "readonly" : ""}></div>
                <div><label>Lieu d'affectation</label><input id="contract-location" value="${record?.assignment_location || ""}" ${locked ? "readonly" : ""}></div>
                <div><label>Devise</label><select id="contract-currency" ${locked ? "disabled" : ""}>
                    <option value="USD" ${record?.currency === "USD" ? "selected" : ""}>USD</option>
                    <option value="CDF" ${record?.currency === "CDF" ? "selected" : ""}>CDF</option></select></div>
            </div>
            <h4>Rémunération</h4>
            <div class="form-row">
                <div><label>Salaire base</label><input type="number" step="0.01" id="contract-salary" value="${record?.salary_base || ""}" ${locked ? "readonly" : ""}></div>
                <div><label>Prime transport</label><input type="number" step="0.01" id="contract-transport" value="${record?.transport_allowance || 0}" ${locked ? "readonly" : ""}></div>
                <div><label>Prime logement</label><input type="number" step="0.01" id="contract-housing" value="${record?.housing_allowance || 0}" ${locked ? "readonly" : ""}></div>
                <div><label>Prime responsabilité</label><input type="number" step="0.01" id="contract-responsibility" value="${record?.responsibility_bonus || 0}" ${locked ? "readonly" : ""}></div>
            </div>
            <h4>Conditions de travail</h4>
            <div class="form-row">
                <div><label>Jours/semaine</label><input type="number" id="contract-days" value="${record?.work_days_per_week || 5}" ${locked ? "readonly" : ""}></div>
                <div><label>Horaires</label><input id="contract-schedule" value="${record?.work_schedule || "08h00 - 17h00"}" ${locked ? "readonly" : ""}></div>
                <div><label>Congés annuels</label><input type="number" step="0.5" id="contract-leave-days" value="${record?.annual_leave_days || 25}" ${locked ? "readonly" : ""}></div>
            </div>
            <div><label>Description du poste</label><textarea id="contract-job-desc" rows="2" ${locked ? "readonly" : ""}>${record?.job_description || ""}</textarea></div>
            <h4>Avantages liés au contrat</h4>
            <div id="contract-benefits-list">${renderBenefitsHtml(record?.benefits || [], locked)}</div>
            ${!locked ? `<button type="button" class="btn btn-small btn-secondary" onclick="window.addContractBenefit()"><i class="fas fa-plus"></i> Ajouter un avantage</button>` : ""}
            <h4>Clauses</h4>
            <div><label>Obligations employé</label><textarea id="contract-emp-oblig" rows="2" ${locked ? "readonly" : ""}>${record?.employee_obligations || ""}</textarea></div>
            <div><label>Obligations employeur</label><textarea id="contract-empr-oblig" rows="2" ${locked ? "readonly" : ""}>${record?.employer_obligations || ""}</textarea></div>
            <div><label>Confidentialité</label><textarea id="contract-confidential" rows="2" ${locked ? "readonly" : ""}>${record?.confidentiality_clause || ""}</textarea></div>
            <div><label>Conditions de résiliation</label><textarea id="contract-termination" rows="2" ${locked ? "readonly" : ""}>${record?.termination_conditions || ""}</textarea></div>
            ${record?.id ? `<div class="signature-block"><h4>Signatures</h4>
                <p>Employé : ${record.employee_signed_at ? "✅ " + new Date(record.employee_signed_at).toLocaleString("fr-FR") : "⏳ En attente"}</p>
                <p>RH : ${record.hr_signed_at ? "✅ " + record.hr_signatory_name : "⏳ En attente"}</p>
                <p>Direction : ${record.direction_signed_at ? "✅ " + record.direction_signatory_name : "⏳ En attente"}</p>
            </div>
            <h4><i class="fas fa-archive"></i> Journal d'archivage</h4>
            ${archiveLogsHtml(archiveLogs)}
            ${record.imported_at ? `<p class="hint-text">Importé le ${new Date(record.imported_at).toLocaleString("fr-FR")}${record.imported_by_name ? " par " + record.imported_by_name : ""}</p>` : ""}` : ""}
            <div class="action-bar">
                ${!locked ? `<button type="button" class="btn btn-primary" onclick="window.saveContract()"><i class="fas fa-save"></i> Enregistrer</button>` : ""}
                ${record?.id && canManageContracts() && !locked ? `<button type="button" class="btn btn-secondary" onclick="window.createAmendment(${record.id})"><i class="fas fa-file-medical"></i> Nouvel avenant</button>` : ""}
                <button type="button" class="btn btn-secondary" onclick="window.closeContractModal()">Fermer</button>
            </div>`;
    }

    window.openContractForm = async (record, archiveLogs) => {
        const modal = ensureContractModal();
        const body = document.getElementById("contract-modal-body");
        if (!body) return;
        modal.hidden = false;
        body.innerHTML = `<p class="hint-text"><i class="fas fa-spinner fa-spin"></i> Chargement...</p>`;
        if (!_employeesCache.length) {
            _employeesCache = await apiGet("/employees/");
        }
        if (!_typesCache.length) {
            _typesCache = await apiGet("/contracts/types/");
        }
        body.innerHTML = contractFormHtml(record, _employeesCache, _typesCache, archiveLogs);
    };

    window.closeContractModal = () => {
        const modal = document.getElementById("contract-modal");
        if (modal) modal.hidden = true;
    };

    function buildContractPayload() {
        return {
            employee: Number(document.getElementById("contract-employee")?.value),
            contract_number: document.getElementById("contract-number")?.value?.trim() || undefined,
            contract_type: document.getElementById("contract-type")?.value,
            start_date: document.getElementById("contract-start")?.value,
            end_date: document.getElementById("contract-end")?.value || null,
            probation_end_date: document.getElementById("contract-probation")?.value || null,
            assignment_location: document.getElementById("contract-location")?.value || "",
            position_title: document.getElementById("contract-position")?.value || "",
            currency: document.getElementById("contract-currency")?.value || "USD",
            salary_base: document.getElementById("contract-salary")?.value || 0,
            transport_allowance: document.getElementById("contract-transport")?.value || 0,
            housing_allowance: document.getElementById("contract-housing")?.value || 0,
            responsibility_bonus: document.getElementById("contract-responsibility")?.value || 0,
            work_days_per_week: document.getElementById("contract-days")?.value || 5,
            work_schedule: document.getElementById("contract-schedule")?.value || "",
            annual_leave_days: document.getElementById("contract-leave-days")?.value || 25,
            job_description: document.getElementById("contract-job-desc")?.value || "",
            employee_obligations: document.getElementById("contract-emp-oblig")?.value || "",
            employer_obligations: document.getElementById("contract-empr-oblig")?.value || "",
            confidentiality_clause: document.getElementById("contract-confidential")?.value || "",
            termination_conditions: document.getElementById("contract-termination")?.value || "",
            benefits: collectBenefits(),
            status: "DRAFT",
        };
    }

    window.saveContract = async () => {
        const payload = buildContractPayload();
        const id = document.getElementById("contract-id")?.value;
        if (!payload.employee || !payload.contract_type || !payload.start_date) {
            alert("Veuillez compléter tous les champs obligatoires.");
            return;
        }
        try {
            if (id) {
                await apiFetch(`/contracts/${id}/`, { method: "PATCH", body: payload });
            } else {
                await apiPost("/contracts/", payload);
            }
            closeContractModal();
            await loadContractsDashboard();
            await loadContractsList();
            if (typeof showToast === "function") showToast("Contrat enregistré", "success");
        } catch (e) {
            alert(e.message || "Erreur lors de l'enregistrement.");
        }
    };

    window.viewContract = async (id) => {
        const [record, logs] = await Promise.all([
            apiGet(`/contracts/${id}/`),
            apiGet(`/contracts/${id}/archive-logs/`).catch(() => []),
        ]);
        openContractForm(record, logs);
    };

    window.editContract = window.viewContract;

    window.exportContract = async (id, format) => {
        const fmt = format || "pdf";
        const path = `/contracts/${id}/export/?export_format=${encodeURIComponent(fmt)}`;
        try {
            const name = await downloadContractExport(path, `CONTRAT.${fmt === "docx" ? "docx" : fmt === "xlsx" ? "xlsx" : "pdf"}`, "individual");
            if (typeof showToast === "function") showToast(`Contrat exporté avec succès (${name})`, "success");
            return name;
        } catch (e) {
            const msg = e.message || "Une erreur est survenue lors de l'exportation du contrat.";
            if (typeof showToast === "function") showToast(msg, "error");
            else alert(msg);
            throw e;
        }
    };

    window.exportContractModal = (contractId, contractLabel) => {
        const modal = ensureContractModal();
        const body = document.getElementById("contract-modal-body");
        if (!body) return;
        modal.hidden = false;
        body.innerHTML = `
            <h3><i class="fas fa-file-export"></i> Exporter le contrat</h3>
            ${contractLabel ? `<p class="hint-text">Contrat : <strong>${contractLabel}</strong></p>` : ""}
            <div class="form-row">
                <div><label>Format <span class="req">*</span></label>
                    <select id="export-contract-format">
                        <option value="pdf">PDF (.pdf)</option>
                        <option value="docx">Word (.docx)</option>
                        <option value="xlsx">Excel (.xlsx)</option>
                    </select></div>
            </div>
            <p class="feature-help">Ex. CONTRAT_EMP0001_GAELLE_NEEMA_CDI.pdf</p>
            <div class="action-bar">
                <button type="button" class="btn btn-primary" id="btn-export-contract-submit">
                    <i class="fas fa-download"></i> Télécharger
                </button>
                <button type="button" class="btn btn-secondary" onclick="window.closeContractModal()">Annuler</button>
            </div>`;
        document.getElementById("btn-export-contract-submit").onclick = async () => {
            const btn = document.getElementById("btn-export-contract-submit");
            const fmt = document.getElementById("export-contract-format")?.value || "pdf";
            btn.disabled = true;
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Génération...`;
            try {
                await window.exportContract(contractId, fmt);
                closeContractModal();
            } finally {
                btn.disabled = false;
                btn.innerHTML = `<i class="fas fa-download"></i> Télécharger`;
            }
        };
    };

    function contractsForEmployee(employeeId) {
        return _contractsCache.filter((c) => String(c.employee) === String(employeeId));
    }

    window.exportContractIndividualModal = async () => {
        if (!_employeesCache.length) {
            try { _employeesCache = await apiGet("/employees/"); } catch (e) { _employeesCache = []; }
        }
        if (!_contractsCache.length) {
            try { _contractsCache = await apiGet("/contracts/"); } catch (e) { _contractsCache = []; }
        }
        const modal = ensureContractModal();
        const body = document.getElementById("contract-modal-body");
        if (!body) return;
        modal.hidden = false;
        const empOpts = _employeesCache.map((e) =>
            `<option value="${e.id}">${e.full_name} (${e.matricule})</option>`).join("");
        const firstEmp = _employeesCache[0]?.id || "";
        const contractOpts = contractsForEmployee(firstEmp).map((c) =>
            `<option value="${c.id}">${c.contract_number || "—"} — ${c.contract_type} (${c.start_date})</option>`
        ).join("") || `<option value="">Aucun contrat</option>`;
        body.innerHTML = `
            <h3><i class="fas fa-user-tag"></i> Export individuel</h3>
            <p class="feature-help">Sélectionnez l'employé, le contrat et le format — un seul fichier sera généré.</p>
            <div class="form-row">
                <div><label>Employé <span class="req">*</span></label>
                    <select id="export-ind-employee">${empOpts}</select></div>
                <div><label>Contrat <span class="req">*</span></label>
                    <select id="export-ind-contract">${contractOpts}</select></div>
                <div><label>Format <span class="req">*</span></label>
                    <select id="export-ind-format">
                        <option value="pdf">PDF (.pdf)</option>
                        <option value="docx">Word (.docx)</option>
                        <option value="xlsx">Excel (.xlsx)</option>
                    </select></div>
            </div>
            <div class="action-bar">
                <button type="button" class="btn btn-primary" id="btn-export-ind-submit"><i class="fas fa-download"></i> Télécharger</button>
                <button type="button" class="btn btn-secondary" onclick="window.closeContractModal()">Annuler</button>
            </div>`;
        const empSel = document.getElementById("export-ind-employee");
        const ctrSel = document.getElementById("export-ind-contract");
        const refreshContracts = () => {
            const list = contractsForEmployee(empSel.value);
            ctrSel.innerHTML = list.length
                ? list.map((c) => `<option value="${c.id}">${c.contract_number || "—"} — ${c.contract_type} (${c.start_date})</option>`).join("")
                : `<option value="">Aucun contrat pour cet employé</option>`;
        };
        empSel.onchange = refreshContracts;
        document.getElementById("btn-export-ind-submit").onclick = async () => {
            const btn = document.getElementById("btn-export-ind-submit");
            const empId = empSel.value;
            const contractId = ctrSel.value;
            const fmt = document.getElementById("export-ind-format")?.value || "pdf";
            if (!empId || !contractId) {
                alert("Veuillez sélectionner un employé et un contrat.");
                return;
            }
            btn.disabled = true;
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Génération...`;
            const qs = new URLSearchParams({
                employee_id: empId,
                contract_id: contractId,
                export_format: fmt,
            });
            try {
                await downloadContractExport(`/contracts/export-individual/?${qs}`, `CONTRAT.${fmt}`, "individual");
                if (typeof showToast === "function") showToast("Contrat exporté avec succès", "success");
                closeContractModal();
            } catch (e) {
                const msg = e.message || "Une erreur est survenue lors de l'exportation du contrat.";
                if (typeof showToast === "function") showToast(msg, "error");
                else alert(msg);
            } finally {
                btn.disabled = false;
                btn.innerHTML = `<i class="fas fa-download"></i> Télécharger`;
            }
        };
    };

    window.signContractRh = async (id) => {
        const name = prompt("Nom du signataire RH :");
        if (!name) return;
        await apiPost(`/contracts/${id}/sign/`, { role: "hr", signatory_name: name, signature: name });
        await loadContractsList();
        if (typeof showToast === "function") showToast("Signature RH enregistrée", "success");
    };

    window.createAmendment = async (contractId) => {
        const desc = prompt("Description de l'avenant :");
        if (!desc) return;
        const effective = prompt("Date d'effet (AAAA-MM-JJ) :", new Date().toISOString().slice(0, 10));
        await apiPost(`/contracts/${contractId}/amendments/`, { description: desc, effective_date: effective });
        alert("Avenant créé.");
    };

    window.importContractDocument = async () => {
        if (!_employeesCache.length) _employeesCache = await apiGet("/employees/");
        if (!_typesCache.length) _typesCache = await apiGet("/contracts/types/");
        const modal = ensureContractModal();
        const body = document.getElementById("contract-modal-body");
        if (!body) return;
        modal.hidden = false;
        body.innerHTML = `
            <h3><i class="fas fa-file-import"></i> Importer un contrat</h3>
            <p class="feature-help">PDF, Word (.docx) ou image (JPG, PNG) — le document sera lié au dossier RH de l'employé.</p>
            <div class="form-row">
                <div><label>Employé <span class="req">*</span></label>
                    <select id="import-contract-employee">${_employeesCache.map((e) =>
                        `<option value="${e.id}">${e.full_name} (${e.matricule})</option>`).join("")}</select></div>
                <div><label>Type de contrat</label>
                    <select id="import-contract-type">${_typesCache.map((t) =>
                        `<option value="${t.code}">${t.label}</option>`).join("")}</select></div>
                <div><label>Date de début</label><input type="date" id="import-contract-start" value="${new Date().toISOString().slice(0, 10)}"></div>
            </div>
            <div><label>Description / commentaire</label><textarea id="import-contract-desc" rows="2" placeholder="Ex. Contrat signé en 2024"></textarea></div>
            <div><label>Fichier <span class="req">*</span></label><input type="file" id="import-contract-file" accept=".pdf,.docx,.doc,.jpg,.jpeg,.png"></div>
            <div class="action-bar">
                <button type="button" class="btn btn-primary" onclick="window.submitImportContractDocument()">Importer</button>
                <button type="button" class="btn btn-secondary" onclick="window.closeContractModal()">Annuler</button>
            </div>`;
    };

    window.submitImportContractDocument = async () => {
        const file = document.getElementById("import-contract-file")?.files[0];
        const empId = document.getElementById("import-contract-employee")?.value;
        if (!file || !empId) {
            alert("Veuillez sélectionner un employé et un fichier.");
            return;
        }
        const fd = new FormData();
        fd.append("employee", empId);
        fd.append("file", file);
        fd.append("contract_type", document.getElementById("import-contract-type")?.value || "CDI");
        fd.append("start_date", document.getElementById("import-contract-start")?.value || "");
        fd.append("description", document.getElementById("import-contract-desc")?.value || "");
        try {
            await apiFetch("/contracts/import-document/", { method: "POST", body: fd });
            closeContractModal();
            await loadContractsDashboard();
            await loadContractsList();
            if (typeof showToast === "function") showToast("Contrat importé et archivé", "success");
        } catch (e) {
            alert(e.message || "Import échoué.");
        }
    };

    window.exportContractsGlobal = async () => {
        if (!_departmentsCache.length) {
            try { _departmentsCache = await apiGet("/departments/"); } catch (e) { _departmentsCache = []; }
        }
        if (!_employeesCache.length) {
            try { _employeesCache = await apiGet("/employees/"); } catch (e) { _employeesCache = []; }
        }
        if (!_typesCache.length) {
            try { _typesCache = await apiGet("/contracts/types/"); } catch (e) { _typesCache = []; }
        }
        const modal = ensureContractModal();
        const body = document.getElementById("contract-modal-body");
        if (!body) return;
        modal.hidden = false;
        const deptOpts = _departmentsCache.map((d) =>
            `<option value="${d.id}">${d.name}</option>`).join("");
        const empOpts = _employeesCache.map((e) =>
            `<option value="${e.id}">${e.full_name}</option>`).join("");
        const typeOpts = _typesCache.map((t) =>
            `<option value="${t.code}">${t.label}</option>`).join("");
        const months = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
            "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
        const monthOpts = months.map((m, i) =>
            i ? `<option value="${i}">${m}</option>` : `<option value="">Tous</option>`).join("");
        body.innerHTML = `
            <h3><i class="fas fa-file-export"></i> Export global des contrats</h3>
            <p class="feature-help">Filtrez puis exportez la liste. Réservé aux administrateurs RH — actions journalisées.</p>
            <div class="form-row">
                <div><label>Département</label>
                    <select id="export-global-dept"><option value="">Tous</option>${deptOpts}</select></div>
                <div><label>Type de contrat</label>
                    <select id="export-global-type"><option value="">Tous</option>${typeOpts}</select></div>
                <div><label>Employé</label>
                    <select id="export-global-employee"><option value="">Tous</option>${empOpts}</select></div>
            </div>
            <div class="form-row">
                <div><label>Statut métier</label>
                    <select id="export-global-lifecycle">
                        <option value="">Tous</option>
                        ${Object.entries(LIFECYCLE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
                    </select></div>
                <div><label>Mois (début)</label><select id="export-global-month">${monthOpts}</select></div>
                <div><label>Année (début)</label>
                    <input type="number" id="export-global-year" min="2000" max="2100" placeholder="Ex. 2026"></div>
                <div><label>Format</label>
                    <select id="export-global-format">
                        <option value="xlsx">Excel (.xlsx)</option>
                        <option value="pdf">PDF (document unique)</option>
                        <option value="docx">Word (archive ZIP)</option>
                    </select></div>
            </div>
            <div class="action-bar">
                <button type="button" class="btn btn-primary" id="btn-export-global-submit"><i class="fas fa-download"></i> Télécharger</button>
                <button type="button" class="btn btn-secondary" onclick="window.closeContractModal()">Annuler</button>
            </div>`;
        document.getElementById("btn-export-global-submit").onclick = () => window.submitExportContractsGlobal();
    };

    window.submitExportContractsGlobal = async () => {
        const btn = document.getElementById("btn-export-global-submit");
        const dept = document.getElementById("export-global-dept")?.value || "";
        const ctype = document.getElementById("export-global-type")?.value || "";
        const employee = document.getElementById("export-global-employee")?.value || "";
        const lifecycle = document.getElementById("export-global-lifecycle")?.value || "";
        const month = document.getElementById("export-global-month")?.value || "";
        const year = document.getElementById("export-global-year")?.value || "";
        const format = document.getElementById("export-global-format")?.value || "xlsx";
        const params = new URLSearchParams({ export_format: format });
        if (dept) params.set("department", dept);
        if (ctype) params.set("contract_type", ctype);
        if (employee) params.set("employee_id", employee);
        if (lifecycle) params.set("lifecycle", lifecycle);
        if (month) params.set("month", month);
        if (year) params.set("year", year);
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Génération...`;
        }
        try {
            await downloadContractExport(`/contracts/export-global/?${params}`, `EXPORT_CONTRATS.${format === "docx" ? "zip" : format}`, "global");
            if (typeof showToast === "function") showToast("Export global réussi", "success");
            closeContractModal();
        } catch (e) {
            const msg = e.message || "Une erreur est survenue lors de l'exportation du contrat.";
            if (typeof showToast === "function") showToast(msg, "error");
            else alert(msg);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i class="fas fa-download"></i> Télécharger`;
            }
        }
    };

    window.manageContractTypes = async () => {
        const types = await apiGet("/contract-types/");
        const modal = ensureContractModal();
        const body = document.getElementById("contract-modal-body");
        if (!body) return;
        modal.hidden = false;
        body.innerHTML = `
            <h3><i class="fas fa-cog"></i> Types de contrat</h3>
            <p class="feature-help">Ajouter, modifier ou supprimer les types de contrats proposés à la création.</p>
            <table class="pres-table"><thead><tr><th>Code</th><th>Libellé</th><th>Actif</th><th>Actions</th></tr></thead>
            <tbody>${types.map((t) => `<tr id="ctype-row-${t.id}">
                <td><input id="ctype-code-${t.id}" value="${t.code}" class="filter-search"></td>
                <td><input id="ctype-label-${t.id}" value="${t.label}" class="filter-search"></td>
                <td><input type="checkbox" id="ctype-active-${t.id}" ${t.is_active ? "checked" : ""}></td>
                <td style="white-space:nowrap">
                    <button class="btn btn-small" onclick="window.updateContractType(${t.id})" title="Enregistrer"><i class="fas fa-save"></i></button>
                    <button class="btn btn-small btn-danger" onclick="window.deleteContractType(${t.id})" title="Supprimer"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`).join("")}</tbody></table>
            <div class="form-row" style="margin-top:12px">
                <input id="new-type-code" placeholder="Code (ex. CDI)">
                <input id="new-type-label" placeholder="Libellé">
                <button class="btn btn-primary" onclick="window.addContractType()"><i class="fas fa-plus"></i> Ajouter</button>
            </div>
            <button class="btn btn-secondary" onclick="window.closeContractModal()">Fermer</button>`;
    };

    window.updateContractType = async (id) => {
        const code = document.getElementById(`ctype-code-${id}`)?.value?.trim();
        const label = document.getElementById(`ctype-label-${id}`)?.value?.trim();
        const is_active = document.getElementById(`ctype-active-${id}`)?.checked;
        if (!code || !label) return alert("Code et libellé requis.");
        await apiFetch(`/contract-types/${id}/`, { method: "PATCH", body: { code, label, is_active } });
        await loadContractTypes();
        if (typeof showToast === "function") showToast("Type mis à jour", "success");
    };

    window.addContractType = async () => {
        const code = document.getElementById("new-type-code")?.value?.trim();
        const label = document.getElementById("new-type-label")?.value?.trim();
        if (!code || !label) return alert("Code et libellé requis.");
        await apiPost("/contract-types/", { code, label, is_active: true });
        manageContractTypes();
        loadContractTypes();
    };

    window.deleteContractType = async (id) => {
        if (!confirm("Supprimer ce type de contrat ?")) return;
        await apiFetch(`/contract-types/${id}/`, { method: "DELETE" });
        manageContractTypes();
        loadContractTypes();
    };

    window.refreshContractsData = async function refreshContractsData() {
        if (!document.getElementById("contracts-list")) return;
        await loadContractsDashboard();
        await loadContractsList();
    };

    window.importContractForEmployee = async (employeeId) => {
        window._importPreselectEmployee = employeeId;
        await importContractDocument();
        const sel = document.getElementById("import-contract-employee");
        if (sel && employeeId) sel.value = String(employeeId);
    };

    window.portalSignContract = async function portalSignContract(id) {
        if (!confirm("Confirmer votre signature électronique sur ce contrat ?")) return;
        try {
            await apiPost(`/contracts/${id}/sign/`, { role: "employee", signature: currentUser?.full_name || "Signature employé" });
            if (typeof showToast === "function") showToast("Signature enregistrée", "success");
            if (typeof renderPortailEmploye === "function") renderPortailEmploye();
        } catch (e) {
            alert(e.message || "Signature impossible.");
        }
    };
})();
