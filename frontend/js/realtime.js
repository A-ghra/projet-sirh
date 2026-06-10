/**
 * OTOMIA RH — Synchronisation temps réel (polling + rafraîchissement après mutations)
 */
const OTOMIA_POLL_MS = 15000;
let _otomiaPollTimer = null;
let _otomiaCurrentModule = null;
let _otomiaPollInFlight = false;

function otomiaEnsureToastContainer() {
    let el = document.getElementById("otomia-toast-container");
    if (!el) {
        el = document.createElement("div");
        el.id = "otomia-toast-container";
        el.className = "otomia-toast-container";
        document.body.appendChild(el);
    }
    return el;
}

window.showToast = function showToast(message, type = "success", duration = 3500) {
    const container = otomiaEnsureToastContainer();
    const icons = { success: "fa-check-circle", error: "fa-exclamation-circle", info: "fa-info-circle" };
    const toast = document.createElement("div");
    toast.className = `otomia-toast otomia-toast-${type}`;
    toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
    }, duration);
};

window.otomiaFetchSync = async function otomiaFetchSync() {
    const params = new URLSearchParams();
    params.set("_", String(Date.now()));
    const payMonth = document.getElementById("pay-month");
    const payYear = document.getElementById("pay-year");
    if (payMonth?.value) params.set("month", payMonth.value);
    if (payYear?.value) params.set("year", payYear.value);
    return apiFetch(`/sync/?${params}`, { cache: "no-store" });
};

const OTOMIA_MODULE_REFRESHERS = {
    dashboard: (opts) => window.refreshDashboardData?.(opts),
    formation: (opts) => window.refreshFormationData?.(opts),
    performances: (opts) => window.refreshPerformanceData?.(opts),
    recrutement: (opts) => window.refreshRecruitmentData?.(opts),
    presences: (opts) => window.refreshPresencesData?.(opts),
    paie: (opts) => window.refreshPayrollView?.(opts),
    reporting: (opts) => window.refreshReportingData?.(opts),
};

window.otomiaAfterMutation = async function otomiaAfterMutation(module, message, options = {}) {
    if (message) showToast(message, options.error ? "error" : "success");
    try {
        const refresher = OTOMIA_MODULE_REFRESHERS[module];
        if (refresher) await refresher({ force: true });
        if (!options.skipDashboard && module !== "dashboard") {
            await window.refreshDashboardData?.({ force: true });
        }
    } catch (e) {
        console.warn("otomiaAfterMutation:", e.message);
        if (!options.error) showToast("Action enregistrée — rafraîchissement partiel", "info", 2500);
    }
};

let _kpiAnimate = true;

function setKpi(id, value, options = {}) {
    const el = document.getElementById(id);
    if (!el || value === undefined || value === null) return;
    const text = options.format === "money" ? formatMoney(value) : `${value}${options.suffix || ""}`;
    try {
        if (_kpiAnimate && typeof animateCounter === "function") animateCounter(el, value, options);
        else el.textContent = text;
    } catch (e) {
        el.textContent = text;
    }
}

function safeChartUpdate(chart, updateFn) {
    if (!chart?.canvas?.isConnected) return false;
    try {
        updateFn(chart);
        chart.update("none");
        return true;
    } catch (e) {
        console.warn("Chart update:", e.message);
        return false;
    }
}

window.refreshDashboardData = async function refreshDashboardData(options = {}) {
    if (!document.getElementById("kpi-rh-total") && !document.getElementById("kpi-emp-payslips") && !document.getElementById("kpi-pay-bulletins")) return;
    _kpiAnimate = !options.silent;
    try {
        const ts = Date.now();
        const [dash, sync] = await Promise.all([
            apiFetch(`/dashboard/?_=${ts}`, { cache: "no-store" }),
            window.otomiaFetchSync(),
        ]);
        const pres = sync.presences || {};
        const pay = sync.payroll || {};
        const rec = sync.recruitment || {};
        const form = sync.formation || {};
        const perf = sync.performance || {};
        const perfDetail = perf.performance || {};
        const mgr = sync.manager || {};
        const emp = sync.employee || {};

        setKpi("kpi-rh-total", dash.total_employees);
        setKpi("kpi-rh-active", dash.total_employees);
        setKpi("kpi-rh-hires", dash.open_recruitments);
        setKpi("kpi-rh-contracts", dash.contracts_expiring_soon);
        setKpi("kpi-pay-bulletins", pay.total_bulletins);
        setKpi("kpi-pay-mass", pay.net_mass || dash.payroll_mass, { format: "money" });
        setKpi("kpi-pay-pending", pay.pending_count);
        setKpi("kpi-pay-exports", pay.exports_count);
        setKpi("kpi-pres-present", pres.present_today);
        setKpi("kpi-pres-absent", pres.absent_today ?? dash.absences_today);
        setKpi("kpi-pres-leaves", pres.approved_leaves);
        setKpi("kpi-pres-late", pres.late_today);
        setKpi("kpi-rec-applicants", rec.applicants_total);
        setKpi("kpi-rec-interviews", rec.interview_scheduled);
        setKpi("kpi-rec-accepted", rec.accepted);
        setKpi("kpi-rec-rejected", rec.rejected);
        setKpi("kpi-form-progress", form.in_progress);
        setKpi("kpi-form-done", form.completed);
        setKpi("kpi-form-participants", form.participants_registered);
        setKpi("kpi-form-results", form.results_registered);
        setKpi("kpi-perf-reviews", perfDetail.total_evaluations ?? dash.evaluations_count);
        setKpi("kpi-perf-objectives", perf.objectives_completed);
        setKpi("kpi-perf-kpis", perf.kpis_count);
        setKpi("kpi-perf-avg", perfDetail.average_score ?? perf.avg_kpi_achievement, { suffix: perfDetail.average_score ? "/100" : "%" });
        setKpi("kpi-mgr-team", mgr.team_size);
        setKpi("kpi-mgr-pending", mgr.pending_leaves ?? pres.pending_leaves);
        setKpi("kpi-mgr-reviews", mgr.team_reviews ?? perfDetail.total_evaluations ?? dash.evaluations_count);
        setKpi("kpi-mgr-objectives", mgr.team_objectives ?? ((perf.objectives_total || 0) - (perf.objectives_completed || 0)));
        setKpi("kpi-emp-payslips", emp.payslips_count);
        setKpi("kpi-emp-leaves", emp.leaves_count);
        setKpi("kpi-emp-trainings", emp.trainings_count);
        setKpi("kpi-emp-reviews", emp.reviews_count);
        setKpi("kpi-emp-objectives", emp.objectives_count);

        const alertsEl = document.getElementById("dashboard-alerts");
        if (alertsEl) {
            const alerts = [];
            if (emp.notifications_count > 0) alerts.push(`<div class="dashboard-alert info"><i class="fas fa-bell"></i> ${emp.notifications_count} notification(s) non lue(s)</div>`);
            if (emp.leave_balance !== undefined) alerts.push(`<div class="dashboard-alert info"><i class="fas fa-umbrella-beach"></i> Solde congés : ${emp.leave_balance} jour(s)</div>`);
            if (pres.pending_leaves > 0) alerts.push(`<div class="dashboard-alert warning"><i class="fas fa-exclamation-triangle"></i> ${pres.pending_leaves} demande(s) de congé en attente</div>`);
            if (pay.pending_count > 0) alerts.push(`<div class="dashboard-alert info"><i class="fas fa-info-circle"></i> ${pay.pending_count} paie(s) en attente</div>`);
            if (perf.certifications_expiring > 0) alerts.push(`<div class="dashboard-alert warning"><i class="fas fa-certificate"></i> ${perf.certifications_expiring} certification(s) à renouveler</div>`);
            if (dash.contracts_expiring_soon > 0) alerts.push(`<div class="dashboard-alert warning"><i class="fas fa-file-contract"></i> ${dash.contracts_expiring_soon} contrat(s) à échéance</div>`);
            alertsEl.innerHTML = alerts.join("");
        }

        const actBody = document.getElementById("activities-body");
        if (actBody) {
            actBody.innerHTML = (dash.recent_activities || []).map((a) =>
                `<tr><td>${a.action}</td><td>${a.module}</td><td>${a.username || "-"}</td><td>${new Date(a.created_at).toLocaleString("fr-FR")}</td></tr>`
            ).join("") || "<tr><td colspan='4'>Aucune activité</td></tr>";
        }

        const deptCanvas = document.getElementById("dept-chart");
        if (dash.department_distribution && deptCanvas) {
            const labels = dash.department_distribution.map((d) => d.name);
            const values = dash.department_distribution.map((d) => d.count);
            if (!safeChartUpdate(deptChart, (c) => {
                c.data.labels = labels;
                c.data.datasets[0].data = values;
            })) {
                if (deptChart) { try { deptChart.destroy(); } catch (_) { /* ignore */ } deptChart = null; }
                deptChart = new Chart(deptCanvas, {
                    type: "bar",
                    data: { labels, datasets: [{ label: "Employés", data: values, backgroundColor: "#1a5f9e" }] },
                    options: { plugins: { legend: { display: false } }, animation: { duration: 400 } },
                });
            }
        }
        const genderCanvas = document.getElementById("gender-chart");
        if (dash.gender_distribution && genderCanvas) {
            const gData = [dash.gender_distribution.hommes, dash.gender_distribution.femmes];
            if (!safeChartUpdate(genderChart, (c) => { c.data.datasets[0].data = gData; })) {
                if (genderChart) { try { genderChart.destroy(); } catch (_) { /* ignore */ } genderChart = null; }
                genderChart = new Chart(genderCanvas, {
                    type: "doughnut",
                    data: { labels: ["Hommes", "Femmes"], datasets: [{ data: gData, backgroundColor: ["#1a5f9e", "#e74c3c"] }] },
                    options: { animation: { duration: 400 } },
                });
            }
        }
    } catch (e) {
        console.warn("Dashboard refresh:", e.message);
    }
};

window.refreshPresencesData = async function refreshPresencesData(options = {}) {
    if (!document.getElementById("abs-list")) return;
    if (options.silent && !options.force) {
        try {
            const sync = await otomiaFetchSync();
            const presStats = document.getElementById("pres-stats-bar");
            if (presStats && sync.presences) {
                const p = sync.presences;
                presStats.innerHTML = `
                    <div class="stat-card stat-animated"><i class="fas fa-user-check"></i><div class="stat-info"><h3>Présents aujourd'hui</h3><p>${p.present_today}</p></div></div>
                    <div class="stat-card stat-animated"><i class="fas fa-clock"></i><div class="stat-info"><h3>Retards</h3><p>${p.late_today}</p></div></div>
                    <div class="stat-card stat-animated"><i class="fas fa-user-times"></i><div class="stat-info"><h3>Absents</h3><p>${p.absent_today}</p></div></div>
                    <div class="stat-card stat-animated"><i class="fas fa-umbrella-beach"></i><div class="stat-info"><h3>Congés en attente</h3><p>${p.pending_leaves}</p></div></div>
                    <div class="stat-card stat-animated"><i class="fas fa-percentage"></i><div class="stat-info"><h3>Taux présence (mois)</h3><p>${p.attendance_rate_month}%</p></div></div>`;
            }
        } catch (e) { console.warn("Presences silent refresh:", e.message); }
        return;
    }
    try {
        const [absences, attendances, missions] = await Promise.all([
            apiGet("/absences/"), apiGet("/attendance/"), apiGet("/missions/"),
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
        const attEl = document.getElementById("att-list");
        if (attEl) {
            attEl.innerHTML = attendances.map((a) => `
                <tr><td>${a.employee_name}</td><td>${a.date}</td><td>${a.check_in || "-"}</td>
                <td>${a.check_out || "-"}</td><td>${a.status}</td></tr>`).join("") || "<tr><td colspan='5'>Aucune donnée</td></tr>";
        }
        const missEl = document.getElementById("miss-list");
        if (missEl) {
            missEl.innerHTML = missions.map((m) => `
                <tr><td>${m.employee_name}</td><td>${m.title}</td><td>${m.destination}</td>
                <td>${m.start_date} → ${m.end_date}</td><td>${m.status}</td></tr>`).join("") || "<tr><td colspan='5'>Aucune mission</td></tr>";
        }
        const sync = await otomiaFetchSync();
        const presStats = document.getElementById("pres-stats-bar");
        if (presStats && sync.presences) {
            const p = sync.presences;
            presStats.innerHTML = `
                <div class="stat-card stat-animated"><i class="fas fa-user-check"></i><div class="stat-info"><h3>Présents aujourd'hui</h3><p>${p.present_today}</p></div></div>
                <div class="stat-card stat-animated"><i class="fas fa-clock"></i><div class="stat-info"><h3>Retards</h3><p>${p.late_today}</p></div></div>
                <div class="stat-card stat-animated"><i class="fas fa-user-times"></i><div class="stat-info"><h3>Absents</h3><p>${p.absent_today}</p></div></div>
                <div class="stat-card stat-animated"><i class="fas fa-umbrella-beach"></i><div class="stat-info"><h3>Congés en attente</h3><p>${p.pending_leaves}</p></div></div>
                <div class="stat-card stat-animated"><i class="fas fa-percentage"></i><div class="stat-info"><h3>Taux présence (mois)</h3><p>${p.attendance_rate_month}%</p></div></div>`;
        }
    } catch (e) {
        console.warn("Presences refresh:", e.message);
    }
};

async function otomiaPollTick() {
    if (_otomiaPollInFlight || document.hidden) return;
    _otomiaPollInFlight = true;
    try {
        const mod = _otomiaCurrentModule;
        const refresher = mod ? OTOMIA_MODULE_REFRESHERS[mod] : null;
        if (refresher) await refresher({ silent: true });
        if (mod !== "dashboard") await window.refreshDashboardData?.({ silent: true });
    } catch (e) {
        console.warn("Poll refresh:", e.message);
    } finally {
        _otomiaPollInFlight = false;
    }
}

window.otomiaStartPolling = function otomiaStartPolling(module) {
    window.otomiaStopPolling();
    _otomiaCurrentModule = module;
    _otomiaPollTimer = setInterval(otomiaPollTick, OTOMIA_POLL_MS);
};

window.otomiaStopPolling = function otomiaStopPolling() {
    if (_otomiaPollTimer) clearInterval(_otomiaPollTimer);
    _otomiaPollTimer = null;
};

/** @deprecated — le polling module inclut déjà le tableau de bord */
window.otomiaStartDashboardPolling = function otomiaStartDashboardPolling() { /* noop */ };
