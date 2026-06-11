/**
 * OTOMIA RH — Cockpit tableau de bord (graphiques Chart.js + statistiques détaillées)
 */
const dashboardCharts = {};

function destroyDashboardCharts() {
    Object.keys(dashboardCharts).forEach((key) => {
        try { dashboardCharts[key]?.destroy(); } catch (e) { /* ignore */ }
        delete dashboardCharts[key];
    });
}

function upsertChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !canvas.isConnected) {
        console.warn("[OTOMIA Chart] canvas absent ou détaché:", canvasId);
        return null;
    }
    const existing = dashboardCharts[canvasId];
    if (existing?.canvas?.isConnected) {
        try {
            existing.data = config.data;
            if (config.options) existing.options = config.options;
            existing.update("none");
            return existing;
        } catch (e) {
            try { existing.destroy(); } catch (_) { /* ignore */ }
        }
    }
    const chart = new Chart(canvas, {
        ...config,
        options: {
            responsive: true,
            maintainAspectRatio: true,
            animation: { duration: 500 },
            plugins: { legend: { position: "bottom" }, tooltip: { enabled: true } },
            ...config.options,
        },
    });
    dashboardCharts[canvasId] = chart;
    return chart;
}

function fmtMoney(v) {
    return typeof formatMoney === "function" ? formatMoney(v) : `${Number(v || 0).toLocaleString("fr-FR")} $`;
}

function renderStatBlock(title, rows) {
    const items = rows.map(([label, value]) =>
        `<div class="detail-stat-row"><span>${label}</span><strong>${value ?? "—"}</strong></div>`
    ).join("");
    return `<div class="detail-stat-block"><h4>${title}</h4>${items}</div>`;
}

window.renderDetailedStats = function renderDetailedStats(dash) {
    const el = document.getElementById("detailed-stats-grid");
    const s = dash?.detailed_stats;
    if (!el || !s) return;
    el.innerHTML = [
        renderStatBlock("Personnel", [
            ["Effectif total", s.personnel?.total],
            ["Ancienneté moyenne", `${s.personnel?.avg_seniority_years ?? 0} ans`],
            ["Taux de rotation annuel", `${s.personnel?.turnover_rate_annual ?? 0}%`],
            ["Par département", (s.personnel?.by_department || []).map((d) => `${d.name}: ${d.count}`).join(", ") || "—"],
            ["Par sexe", (s.personnel?.by_gender || []).map((g) => `${g.label}: ${g.count} (${g.percent}%)`).join(" · ") || "—"],
            ["Par contrat", (s.personnel?.by_contract || []).map((c) => `${c.label}: ${c.count}`).join(" · ") || "—"],
        ]),
        renderStatBlock("Salaires", [
            ["Salaire moyen", fmtMoney(s.salary?.avg_salary)],
            ["Salaire minimum", fmtMoney(s.salary?.min_salary)],
            ["Salaire maximum", fmtMoney(s.salary?.max_salary)],
            ["Masse salariale annuelle", fmtMoney(s.salary?.annual_mass)],
            ["Évolution coûts RH", `${s.salary?.payroll_evolution_pct ?? 0}%`],
            ["Par département", (s.salary?.by_department || []).map((d) => `${d.name}: ${fmtMoney(d.avg_salary)}`).join(" · ") || "—"],
        ]),
        renderStatBlock("Présences", [
            ["Taux de présence", `${s.presences?.attendance_rate ?? 0}%`],
            ["Taux d'absentéisme", `${s.presences?.absenteeism_rate ?? 0}%`],
            ["Total retards", s.presences?.late_count],
            ["Heures travaillées", s.presences?.hours_worked],
            ["Jours de congé (période)", s.presences?.leave_days_total],
            ["Congé moyen / employé", s.presences?.avg_leave_days],
        ]),
        renderStatBlock("Recrutement", [
            ["Taux d'acceptation", `${s.recruitment?.acceptance_rate ?? 0}%`],
            ["Taux de refus", `${s.recruitment?.rejection_rate ?? 0}%`],
            ["Délai moyen traitement", `${s.recruitment?.avg_processing_days ?? 0} jours`],
            ["Postes ouverts", s.recruitment?.open_positions],
            ["Par mois", (s.recruitment?.monthly || []).map((m) => `${m.month}: ${m.count}`).join(" · ") || "—"],
        ]),
        renderStatBlock("Formations", [
            ["Total formations", s.formation?.total_trainings],
            ["Participants", s.formation?.participants],
            ["Taux de réussite", `${s.formation?.success_rate ?? 0}%`],
            ["Certifications obtenues", s.formation?.certifications_obtained],
            ["Heures dispensées", s.formation?.training_hours],
            ["Taux de participation", `${s.formation?.participation_rate ?? 0}%`],
        ]),
        renderStatBlock("Performances", [
            ["Moyenne générale", `${s.performance?.avg_score ?? 0}/100`],
            ["Objectifs atteints", `${s.performance?.objectives_achievement_pct ?? 0}%`],
            ["Par département", (s.performance?.by_department || []).map((d) => `${d.name}: ${d.avg_score}/100`).join(" · ") || "—"],
            ["Notes 1-5★", Object.entries(s.performance?.star_distribution || {}).map(([k, v]) => `${k}★: ${v}`).join(" · ") || "—"],
        ]),
    ].join("");
};

window.renderDashboardCharts = function renderDashboardCharts(dash, sync = {}) {
    if (!dash) return;
    const perf = sync.performance || {};
    const perfDetail = perf.performance || {};

    if (dash.monthly_headcount?.length) {
        upsertChart("chart-headcount", {
            type: "line",
            data: {
                labels: dash.monthly_headcount.map((m) => m.month),
                datasets: [
                    { label: "Effectif", data: dash.monthly_headcount.map((m) => m.count), borderColor: "#1a5f9e", tension: 0.3 },
                    { label: "Entrées", data: dash.monthly_headcount.map((m) => m.entries), borderColor: "#27ae60", tension: 0.3 },
                    { label: "Sorties", data: dash.monthly_headcount.map((m) => m.exits), borderColor: "#e74c3c", tension: 0.3 },
                ],
            },
        });
    }

    if (dash.department_distribution?.length) {
        upsertChart("chart-dept-pie", {
            type: "pie",
            data: {
                labels: dash.department_distribution.map((d) => `${d.name} (${d.count} — ${d.percent || 0}%)`),
                datasets: [{
                    data: dash.department_distribution.map((d) => d.count),
                    backgroundColor: ["#1a5f9e", "#2980b9", "#3498db", "#5dade2", "#85c1e9", "#aed6f1", "#d4e6f1", "#7f8c8d"],
                }],
            },
            options: { plugins: { legend: { position: "bottom" } } },
        });
    }

    if (dash.gender_distribution) {
        const g = dash.gender_distribution;
        const labels = ["Hommes", "Femmes", "Autres"];
        const data = [g.hommes || 0, g.femmes || 0, g.autres || 0];
        const pcts = [g.hommes_pct, g.femmes_pct, g.autres_pct];
        upsertChart("chart-gender", {
            type: "pie",
            data: {
                labels: labels.map((l, i) => `${l} (${pcts[i] || 0}%)`),
                datasets: [{ data, backgroundColor: ["#1a5f9e", "#e74c3c", "#95a5a6"] }],
            },
        });
    }

    if (dash.monthly_payroll?.length) {
        upsertChart("chart-payroll", {
            type: "bar",
            data: {
                labels: dash.monthly_payroll.map((m) => m.month),
                datasets: [
                    { label: "Masse nette", data: dash.monthly_payroll.map((m) => m.net), backgroundColor: "#1a5f9e" },
                    { label: "Masse brute", data: dash.monthly_payroll.map((m) => m.gross), backgroundColor: "#85c1e9" },
                ],
            },
        });
    }

    if (dash.presences_chart) {
        upsertChart("chart-presences", {
            type: "bar",
            data: {
                labels: dash.presences_chart.labels,
                datasets: [{ data: dash.presences_chart.values, backgroundColor: ["#27ae60", "#e74c3c", "#f39c12", "#3498db", "#9b59b6"] }],
            },
            options: { plugins: { legend: { display: false } } },
        });
    }

    if (dash.recruitment_funnel) {
        upsertChart("chart-recruitment", {
            type: "bar",
            data: {
                labels: dash.recruitment_funnel.labels,
                datasets: [{ data: dash.recruitment_funnel.values, backgroundColor: "#1a5f9e" }],
            },
            options: { indexAxis: "y", plugins: { legend: { display: false } } },
        });
    }

    if (dash.formation_comparison?.length) {
        upsertChart("chart-formation", {
            type: "bar",
            data: {
                labels: dash.formation_comparison.map((f) => f.status),
                datasets: [{ data: dash.formation_comparison.map((f) => f.count), backgroundColor: ["#3498db", "#27ae60", "#95a5a6"] }],
            },
            options: { plugins: { legend: { display: false } } },
        });
    }

    const stars = dash.performance_stars || perfDetail.star_distribution || {};
    const starValues = [1, 2, 3, 4, 5].map((i) => stars[String(i)] || 0);
    if (starValues.some((v) => v > 0)) {
        upsertChart("chart-performance", {
            type: "radar",
            data: {
                labels: ["1★", "2★", "3★", "4★", "5★"],
                datasets: [{ label: "Évaluations", data: starValues, backgroundColor: "rgba(26,95,158,0.2)", borderColor: "#1a5f9e" }],
            },
        });
    }

    if (dash.kpi_progress?.length) {
        upsertChart("chart-kpi", {
            type: "bar",
            data: {
                labels: dash.kpi_progress.map((k) => k.label.slice(0, 20)),
                datasets: [{ label: "Réalisation %", data: dash.kpi_progress.map((k) => k.percent), backgroundColor: "#27ae60" }],
            },
            options: { plugins: { legend: { display: false } }, scales: { y: { max: 100 } } },
        });
    }

    if (dash.monthly_trends?.length) {
        upsertChart("chart-trends", {
            type: "line",
            data: {
                labels: dash.monthly_trends.map((t) => t.month),
                datasets: [
                    { label: "Effectif", data: dash.monthly_trends.map((t) => t.headcount), borderColor: "#1a5f9e", yAxisID: "y" },
                    { label: "Masse nette", data: dash.monthly_trends.map((t) => t.payroll_net), borderColor: "#27ae60", yAxisID: "y1" },
                    { label: "Absences", data: dash.monthly_trends.map((t) => t.absences), borderColor: "#e74c3c", yAxisID: "y" },
                ],
            },
            options: {
                scales: {
                    y: { type: "linear", position: "left", title: { display: true, text: "Effectif / Absences" } },
                    y1: { type: "linear", position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Masse salariale" } },
                },
            },
        });
    }

    const ageData = dash.detailed_stats?.personnel?.by_age;
    if (ageData?.length) {
        upsertChart("chart-age", {
            type: "bar",
            data: {
                labels: ageData.map((a) => `${a.label} (${a.percent}%)`),
                datasets: [{ data: ageData.map((a) => a.count), backgroundColor: "#3498db" }],
            },
            options: { plugins: { legend: { display: false } } },
        });
    }

    const contractData = dash.detailed_stats?.personnel?.by_contract;
    if (contractData?.length) {
        upsertChart("chart-contract", {
            type: "doughnut",
            data: {
                labels: contractData.map((c) => `${c.label} (${c.percent}%)`),
                datasets: [{ data: contractData.map((c) => c.count), backgroundColor: ["#1a5f9e", "#2980b9", "#5dade2", "#85c1e9", "#aed6f1", "#d4e6f1"] }],
            },
        });
    }

    const perfMonthly = dash.performance_monthly || dash.detailed_stats?.performance?.monthly_evolution;
    if (perfMonthly?.length) {
        upsertChart("chart-perf-evolution", {
            type: "line",
            data: {
                labels: perfMonthly.map((m) => m.month),
                datasets: [
                    { label: "Score moyen", data: perfMonthly.map((m) => m.avg_score), borderColor: "#1a5f9e", tension: 0.3 },
                    { label: "Nb évaluations", data: perfMonthly.map((m) => m.count), borderColor: "#f39c12", tension: 0.3 },
                ],
            },
        });
    }

};

window.renderDashboardDetails = function renderDashboardDetails(dash) {
    if (!dash) return;
    renderTopLists(dash);
    renderCalendar(dash.calendar_events || []);
    renderDetailedStats(dash);
};

function renderTopLists(dash) {
    const topEmp = document.getElementById("top-employees-list");
    if (topEmp) {
        topEmp.innerHTML = (dash.top_employees || []).map((e, i) =>
            `<li title="Performance: ${e.score}/100 · Présence: ${e.attendance_rate}% · Objectifs: ${e.objectives_done}">
                <span class="rank">${i + 1}</span><span>${e.name}</span>
                <strong>${e.score}/100</strong></li>`
        ).join("") || "<li>Aucune donnée</li>";
    }
    const topDept = document.getElementById("top-departments-list");
    if (topDept) {
        topDept.innerHTML = (dash.top_departments || []).map((d, i) =>
            `<li title="Présence: ${d.presence_rate}% · KPI: ${d.kpi_avg} · Perf: ${d.performance_avg}/100">
                <span class="rank">${i + 1}</span><span>${d.name}</span>
                <strong>${d.global_score} pts</strong></li>`
        ).join("") || "<li>Aucune donnée</li>";
    }
}

function renderCalendar(events) {
    const el = document.getElementById("rh-calendar-list");
    if (!el) return;
    const icons = { leave: "fa-umbrella-beach", training: "fa-graduation-cap", review: "fa-star", contract: "fa-file-contract", interview: "fa-user-tie" };
    el.innerHTML = events.slice(0, 15).map((ev) =>
        `<div class="calendar-event cal-${ev.type}"><i class="fas ${icons[ev.type] || "fa-calendar"}"></i>
         <div><small>${new Date(ev.date).toLocaleDateString("fr-FR")}</small><span>${ev.title}</span></div></div>`
    ).join("") || "<p class='hint-text'>Aucun événement à venir</p>";
}

window.getDashboardFilterParams = function getDashboardFilterParams() {
    const params = new URLSearchParams();
    const fields = [
        ["dash-filter-month", "month"],
        ["dash-filter-year", "year"],
        ["dash-filter-dept", "department"],
        ["dash-filter-employee", "employee"],
        ["dash-filter-contract", "contract_type"],
        ["dash-filter-gender", "gender"],
        ["dash-filter-age", "age_range"],
        ["dash-filter-site", "site"],
    ];
    fields.forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el?.value) params.set(key, el.value.trim());
    });
    return params;
};

window.onDashboardFilterChange = async function onDashboardFilterChange() {
    if (typeof refreshDashboardData === "function") {
        await refreshDashboardData({ force: true });
    }
};

window.destroyDashboardCharts = destroyDashboardCharts;
