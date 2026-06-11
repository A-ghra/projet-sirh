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
    if (typeof getDashboardFilterParams === "function" && document.getElementById("dash-filter-month")) {
        getDashboardFilterParams().forEach((v, k) => params.set(k, v));
    }
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
        if (refresher) await refresher({ force: true, full: module === "presences" });
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
    const loader = document.getElementById("dashboard-loader");
    if (loader && options.force) loader.hidden = false;
    try {
        const sync = await window.otomiaFetchSync();
        const dash = sync.dashboard || {};

        if (typeof renderDashboardCharts === "function") {
            renderDashboardCharts(dash, sync);
        }

        const pres = sync.presences || {};
        const pay = sync.payroll || dash.payroll_summary || {};
        const rec = sync.recruitment || {};
        const form = sync.formation || {};
        const perf = sync.performance || {};
        const perfDetail = perf.performance || {};
        const mgr = sync.manager || {};
        const emp = sync.employee || {};
        const gender = dash.gender_distribution || {};

        setKpi("kpi-rh-total", dash.total_employees);
        setKpi("kpi-rh-active", dash.active_employees ?? dash.total_employees);
        setKpi("kpi-rh-new", dash.new_hires_month);
        setKpi("kpi-rh-contracts", dash.contracts_expiring_soon);
        const genderEl = document.getElementById("kpi-rh-gender");
        if (genderEl) {
            const autres = gender.autres ? ` / ${gender.autres} A` : "";
            genderEl.textContent = `${gender.hommes || 0} H / ${gender.femmes || 0} F${autres}`;
        }
        setKpi("kpi-rh-turnover", dash.turnover_rate_annual, { suffix: "%" });
        const seniorityEl = document.getElementById("kpi-rh-seniority");
        if (seniorityEl && dash.avg_seniority_years !== undefined) {
            seniorityEl.textContent = `${dash.avg_seniority_years} ans`;
        }
        setKpi("kpi-pay-bulletins", pay.total_bulletins);
        setKpi("kpi-pay-mass", pay.net_mass || dash.payroll_mass, { format: "money" });
        setKpi("kpi-pay-evolution", pay.payroll_evolution_pct ?? dash.payroll_evolution_pct, { suffix: "%" });
        setKpi("kpi-pay-deductions", pay.total_deductions ?? dash.total_deductions, { format: "money" });
        setKpi("kpi-pay-avg", dash.avg_cost_per_employee, { format: "money" });
        setKpi("kpi-pay-pending", pay.pending_count);
        setKpi("kpi-pay-exports", pay.exports_count);
        setKpi("kpi-pres-present", pres.present_today ?? dash.present_today);
        setKpi("kpi-pres-absent", pres.absent_today ?? dash.absences_today);
        setKpi("kpi-pres-leaves", pres.approved_leaves);
        setKpi("kpi-pres-late", pres.late_today ?? dash.late_today);
        setKpi("kpi-pres-rate", pres.attendance_rate_month ?? dash.attendance_rate_month, { suffix: "%" });
        setKpi("kpi-pres-abs-rate", dash.absenteeism_rate_month ?? pres.absenteeism_rate, { suffix: "%" });
        setKpi("kpi-pres-avg-leave", dash.avg_leave_days);
        setKpi("kpi-rec-applicants", rec.applicants_total);
        setKpi("kpi-rec-interviews", rec.interview_scheduled);
        setKpi("kpi-rec-accepted", rec.accepted);
        setKpi("kpi-rec-rejected", rec.rejected);
        setKpi("kpi-rec-open", rec.open_recruitments ?? dash.open_recruitments);
        setKpi("kpi-rec-conversion", dash.conversion_rate ?? rec.conversion_rate, { suffix: "%" });
        setKpi("kpi-rec-delay", dash.avg_recruitment_days, { suffix: " j" });
        setKpi("kpi-form-progress", form.in_progress);
        setKpi("kpi-form-done", form.completed);
        setKpi("kpi-form-participants", form.participants_registered);
        setKpi("kpi-form-results", form.results_registered);
        setKpi("kpi-form-rate", form.success_rate, { suffix: "%" });
        setKpi("kpi-form-hours", dash.training_hours_avg);
        setKpi("kpi-form-participation", dash.participation_rate ?? form.participation_rate, { suffix: "%" });
        setKpi("kpi-perf-reviews", perfDetail.total_evaluations ?? dash.evaluations_count);
        setKpi("kpi-perf-objectives", perf.objectives_completed);
        setKpi("kpi-perf-obj-rate", dash.objective_achievement_rate, { suffix: "%" });
        setKpi("kpi-perf-kpis", perf.kpis_count);
        setKpi("kpi-perf-avg", perfDetail.average_score ?? perf.avg_kpi_achievement, { suffix: perfDetail.average_score ? "/100" : "%" });
        const topPerfEl = document.getElementById("kpi-perf-top");
        if (topPerfEl) topPerfEl.textContent = dash.top_employees?.[0]?.name || "—";
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
            if (pres.pending_leaves > 0) alerts.push(`<div class="dashboard-alert warning"><i class="fas fa-exclamation-triangle"></i> ${pres.pending_leaves} demande(s) de congé à valider</div>`);
            if (pay.pending_count > 0) alerts.push(`<div class="dashboard-alert warning"><i class="fas fa-info-circle"></i> ${pay.pending_count} paie(s) en attente</div>`);
            if (perf.certifications_expiring > 0) alerts.push(`<div class="dashboard-alert warning"><i class="fas fa-certificate"></i> ${perf.certifications_expiring} certification(s) expirant bientôt</div>`);
            if (dash.contracts_expiring_soon > 0) alerts.push(`<div class="dashboard-alert warning"><i class="fas fa-file-contract"></i> ${dash.contracts_expiring_soon} contrat(s) arrivant à expiration</div>`);
            const lateCount = pres.late_today ?? dash.late_today ?? 0;
            if (lateCount >= 3) alerts.push(`<div class="dashboard-alert warning"><i class="fas fa-clock"></i> ${lateCount} retard(s) enregistré(s) aujourd'hui</div>`);
            const objPending = (perf.objectives_total || 0) - (perf.objectives_completed || 0);
            if (objPending > 0) alerts.push(`<div class="dashboard-alert info"><i class="fas fa-bullseye"></i> ${objPending} objectif(s) non atteint(s)</div>`);
            const absRate = dash.absenteeism_rate_month ?? 0;
            if (absRate > 15) alerts.push(`<div class="dashboard-alert warning"><i class="fas fa-chart-line"></i> Hausse de l'absentéisme : ${absRate}% ce mois</div>`);
            if (dash.budget_alert) alerts.push(`<div class="dashboard-alert warning"><i class="fas fa-wallet"></i> Dépassement budgétaire RH : masse salariale en hausse de ${dash.payroll_evolution_pct}%</div>`);
            alertsEl.innerHTML = alerts.join("");
        }

        const actBody = document.getElementById("activities-body");
        if (actBody) {
            actBody.innerHTML = (dash.recent_activities || []).map((a) =>
                `<tr><td>${a.action}</td><td>${a.module}</td><td>${a.username || "-"}</td><td>${new Date(a.created_at).toLocaleString("fr-FR")}</td></tr>`
            ).join("") || "<tr><td colspan='4'>Aucune activité</td></tr>";
        }

        requestAnimationFrame(() => {
            if (typeof renderDashboardDetails === "function") {
                renderDashboardDetails(dash);
            }
        });
    } catch (e) {
        console.error("[OTOMIA] Dashboard refresh:", e);
        const alertsEl = document.getElementById("dashboard-alerts");
        const msg = typeof classifyInitError === "function"
            ? classifyInitError(e)
            : (e?.message || "Données partiellement indisponibles");
        if (alertsEl) {
            alertsEl.insertAdjacentHTML("beforeend",
                `<div class="dashboard-alert warning"><i class="fas fa-exclamation-triangle"></i> ${msg}</div>`);
        }
    } finally {
        if (loader) loader.hidden = true;
    }
};

/* refreshPresencesData → presences.js */

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
