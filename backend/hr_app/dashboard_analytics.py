"""Agrégations tableau de bord OTOMIA RH — KPI, graphiques, statistiques, alertes."""
from datetime import timedelta
from calendar import monthrange

from django.db.models import Avg, Count, Sum, Q, Min, Max
from django.utils import timezone

from .models import (
    Employee, Department, Contract, Absence, Attendance, Mission,
    Recruitment, Applicant, Training, PerformanceReview, EmployeeKPI,
    Objective, Certification, Payroll, AuditLog, EmployeeMovement,
    EmployeeTrainingResult,
)
from .serializers import AuditLogSerializer
from .talent_service import performance_dashboard_stats, training_dashboard_stats
from .models import PayrollExportLog

AGE_BRACKETS = [
    ('18-25', 18, 25),
    ('26-35', 26, 35),
    ('36-45', 36, 45),
    ('46-55', 46, 55),
    ('55+', 56, 120),
]


def _employee_age(dob, today):
    if not dob:
        return None
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def _apply_employee_filters(
    qs,
    department_id=None,
    employee_id=None,
    contract_type=None,
    gender=None,
    age_range=None,
    site=None,
):
    if department_id:
        qs = qs.filter(department_id=department_id)
    if employee_id:
        qs = qs.filter(pk=employee_id)
    if contract_type:
        qs = qs.filter(contract_type=contract_type)
    if gender:
        qs = qs.filter(gender=gender)
    if site:
        qs = qs.filter(
            Q(custom_data__site__icontains=site)
            | Q(address__icontains=site)
            | Q(department__name__icontains=site),
        )
    if age_range:
        bracket = next((b for b in AGE_BRACKETS if b[0] == age_range), None)
        if bracket:
            today = timezone.now().date()
            _, min_age, max_age = bracket
            ids = [
                e.id for e in qs.only('id', 'date_of_birth')
                if (age := _employee_age(e.date_of_birth, today)) is not None
                and min_age <= age <= max_age
            ]
            qs = qs.filter(pk__in=ids) if ids else qs.none()
    return qs


def _avg_seniority(emp_qs, today):
    dates = list(emp_qs.values_list('hire_date', flat=True))
    if not dates:
        return 0
    return round(sum((today - d).days / 365.25 for d in dates) / len(dates), 1)


def _age_distribution(emp_qs, today):
    buckets = {label: 0 for label, _, _ in AGE_BRACKETS}
    buckets['Non renseigné'] = 0
    for emp in emp_qs.only('date_of_birth'):
        age = _employee_age(emp.date_of_birth, today)
        if age is None:
            buckets['Non renseigné'] += 1
            continue
        placed = False
        for label, min_a, max_a in AGE_BRACKETS:
            if min_a <= age <= max_a:
                buckets[label] += 1
                placed = True
                break
        if not placed:
            buckets['Non renseigné'] += 1
    total = sum(buckets.values()) or 1
    return [
        {'label': k, 'count': v, 'percent': round(v / total * 100, 1)}
        for k, v in buckets.items() if v > 0
    ]


def _contract_distribution(emp_qs):
    rows = emp_qs.values('contract_type').annotate(count=Count('id')).order_by('-count')
    total = sum(r['count'] for r in rows) or 1
    labels = dict(Employee.CONTRACT_CHOICES)
    return [
        {
            'label': labels.get(r['contract_type'], r['contract_type']),
            'count': r['count'],
            'percent': round(r['count'] / total * 100, 1),
        }
        for r in rows
    ]


def _training_hours(trainings):
    total = 0
    for t in trainings:
        if t.start_date and t.end_date:
            days = (t.end_date - t.start_date).days + 1
            total += days * 8
    return total


def collect_dashboard_analytics(
    month=None,
    year=None,
    department_id=None,
    employee_id=None,
    contract_type=None,
    gender=None,
    age_range=None,
    site=None,
):
    today = timezone.now().date()
    month = int(month) if month else today.month
    year = int(year) if year else today.year
    dept_id = int(department_id) if department_id else None
    emp_id = int(employee_id) if employee_id else None

    emp_qs = _apply_employee_filters(
        Employee.objects.filter(status='Active'),
        dept_id, emp_id, contract_type, gender, age_range, site,
    )
    total = emp_qs.count()
    month_start = today.replace(year=year, month=month, day=1)
    last_day = monthrange(year, month)[1]
    month_end = month_start.replace(day=last_day)
    year_start = today.replace(month=1, day=1)

    new_hires = emp_qs.filter(hire_date__gte=month_start, hire_date__lte=month_end).count()
    payroll_mass = float(emp_qs.aggregate(t=Sum('salary_base'))['t'] or 0)
    avg_cost = round(payroll_mass / total, 2) if total else 0
    avg_seniority = _avg_seniority(emp_qs, today)

    departures_year = EmployeeMovement.objects.filter(
        movement_type='Departure', date__gte=year_start,
    )
    if dept_id:
        departures_year = departures_year.filter(employee__department_id=dept_id)
    turnover_rate = round(departures_year.count() / total * 100, 1) if total else 0

    gender_stats = {
        'hommes': emp_qs.filter(gender='M').count(),
        'femmes': emp_qs.filter(gender='F').count(),
        'autres': emp_qs.exclude(gender__in=['M', 'F']).count(),
    }
    gender_total = sum(gender_stats.values()) or 1
    gender_stats['hommes_pct'] = round(gender_stats['hommes'] / gender_total * 100, 1)
    gender_stats['femmes_pct'] = round(gender_stats['femmes'] / gender_total * 100, 1)
    gender_stats['autres_pct'] = round(gender_stats['autres'] / gender_total * 100, 1)

    dept_qs = Department.objects.annotate(
        count=Count('employees', filter=Q(employees__status='Active')),
    )
    if dept_id:
        dept_qs = dept_qs.filter(pk=dept_id)
    dept_stats = list(dept_qs.values('name', 'count'))
    total_for_pct = sum(d['count'] for d in dept_stats) or 1
    for d in dept_stats:
        d['percent'] = round(d['count'] / total_for_pct * 100, 1)

    contracts_expiring = Contract.objects.filter(
        is_active=True, end_date__gte=today, end_date__lte=today + timedelta(days=60),
    )
    if dept_id:
        contracts_expiring = contracts_expiring.filter(employee__department_id=dept_id)
    if emp_id:
        contracts_expiring = contracts_expiring.filter(employee_id=emp_id)

    absences_today = Absence.objects.filter(
        start_date__lte=today, end_date__gte=today, status='Approved',
    )
    if dept_id:
        absences_today = absences_today.filter(employee__department_id=dept_id)
    if emp_id:
        absences_today = absences_today.filter(employee_id=emp_id)

    monthly_headcount = []
    monthly_payroll = []
    monthly_trends = []
    prev_net = None
    for i in range(11, -1, -1):
        m = month - i
        y = year
        while m < 1:
            m += 12
            y -= 1
        ms = today.replace(year=y, month=m, day=1)
        ld = monthrange(y, m)[1]
        me = ms.replace(day=ld)
        label = ms.strftime('%b %Y')
        hc_qs = Employee.objects.filter(status='Active', hire_date__lte=me)
        if dept_id:
            hc_qs = hc_qs.filter(department_id=dept_id)
        entries = Employee.objects.filter(hire_date__gte=ms, hire_date__lte=me)
        exits_qs = EmployeeMovement.objects.filter(movement_type='Departure', date__gte=ms, date__lte=me)
        if dept_id:
            entries = entries.filter(department_id=dept_id)
            exits_qs = exits_qs.filter(employee__department_id=dept_id)
        monthly_headcount.append({
            'month': label,
            'count': hc_qs.count(),
            'entries': entries.count(),
            'exits': exits_qs.count(),
        })
        prefix = f'{y}-{m:02d}'
        pay_qs = Payroll.objects.filter(month__startswith=prefix)
        if dept_id:
            pay_qs = pay_qs.filter(employee__department_id=dept_id)
        if emp_id:
            pay_qs = pay_qs.filter(employee_id=emp_id)
        net = float(pay_qs.aggregate(t=Sum('net_salary'))['t'] or 0)
        gross = float(pay_qs.aggregate(t=Sum('gross_salary'))['t'] or 0)
        monthly_payroll.append({'month': label, 'gross': gross, 'net': net})
        abs_count = Absence.objects.filter(
            start_date__gte=ms, start_date__lte=me, status='Approved',
        )
        if dept_id:
            abs_count = abs_count.filter(employee__department_id=dept_id)
        monthly_trends.append({
            'month': label,
            'headcount': hc_qs.count(),
            'payroll_net': net,
            'absences': abs_count.count(),
            'payroll_change_pct': round((net - prev_net) / prev_net * 100, 1) if prev_net else 0,
        })
        prev_net = net if net else prev_net

    attendances_today = Attendance.objects.filter(date=today)
    att_month = Attendance.objects.filter(date__gte=month_start, date__lte=month_end)
    missions_month = Mission.objects.filter(start_date__lte=month_end, end_date__gte=month_start)
    if dept_id:
        attendances_today = attendances_today.filter(employee__department_id=dept_id)
        att_month = att_month.filter(employee__department_id=dept_id)
        missions_month = missions_month.filter(employee__department_id=dept_id)
    if emp_id:
        attendances_today = attendances_today.filter(employee_id=emp_id)
        att_month = att_month.filter(employee_id=emp_id)
        missions_month = missions_month.filter(employee_id=emp_id)

    abs_month = Absence.objects.filter(
        start_date__lte=month_end, end_date__gte=month_start, status='Approved',
    )
    if dept_id:
        abs_month = abs_month.filter(employee__department_id=dept_id)
    if emp_id:
        abs_month = abs_month.filter(employee_id=emp_id)

    presences_chart = {
        'labels': ['Présences', 'Absences', 'Retards', 'Congés', 'Missions'],
        'values': [
            att_month.filter(status='Present').count(),
            att_month.filter(status='Absent').count(),
            att_month.filter(status='Late').count(),
            abs_month.count(),
            missions_month.count(),
        ],
    }

    applicants = Applicant.objects.all()
    if dept_id:
        applicants = applicants.filter(
            Q(department_id=dept_id) | Q(recruitment__department_id=dept_id),
        )
    total_app = applicants.count() or 1
    accepted_count = applicants.filter(status='ACCEPTED').count()
    rejected_count = applicants.filter(status='REJECTED').count()
    hired_count = applicants.exclude(employee__isnull=True).count()
    conversion_rate = round(accepted_count / total_app * 100, 1)
    rejection_rate = round(rejected_count / total_app * 100, 1)

    hired_apps = applicants.exclude(employee__isnull=True).exclude(created_at__isnull=True)
    recruitment_days = []
    for ap in hired_apps[:100]:
        end = ap.converted_at or ap.updated_at
        if end and ap.created_at:
            recruitment_days.append((end.date() - ap.created_at.date()).days)
    avg_recruitment_days = round(sum(recruitment_days) / len(recruitment_days), 1) if recruitment_days else 0

    recruitment_funnel = {
        'labels': ['Candidatures', 'Présélection', 'Entretiens', 'Acceptés', 'Intégrés'],
        'values': [
            applicants.count(),
            applicants.filter(status='EVALUATING').count(),
            applicants.filter(status__in=['INTERVIEW_SCHEDULED', 'INTERVIEW_DONE']).count(),
            accepted_count,
            hired_count,
        ],
    }

    recruitment_monthly = []
    for i in range(5, -1, -1):
        m = month - i
        y = year
        while m < 1:
            m += 12
            y -= 1
        ms = today.replace(year=y, month=m, day=1)
        recruitment_monthly.append({
            'month': ms.strftime('%b %Y'),
            'count': applicants.filter(created_at__year=y, created_at__month=m).count(),
        })

    training = training_dashboard_stats()
    trainings_qs = Training.objects.all()
    cancelled = trainings_qs.filter(status='Cancelled').count()
    formation_comparison = [
        {'status': 'Planifiées', 'count': trainings_qs.filter(status='Planned').count()},
        {'status': 'Réalisées', 'count': trainings_qs.filter(status='Completed').count()},
        {'status': 'Annulées', 'count': cancelled},
    ]
    training_hours = _training_hours(trainings_qs.filter(status='Completed'))
    certs_obtained = EmployeeTrainingResult.objects.exclude(
        certification_obtained='',
    ).count()

    perf = performance_dashboard_stats()
    prefix = f'{year}-{month:02d}'
    pay_qs = Payroll.objects.filter(month__startswith=prefix)
    if dept_id:
        pay_qs = pay_qs.filter(employee__department_id=dept_id)
    if emp_id:
        pay_qs = pay_qs.filter(employee_id=emp_id)

    total_deductions = float(pay_qs.aggregate(t=Sum('total_retenues'))['t'] or 0)
    prev_prefix_m = month - 1 if month > 1 else 12
    prev_prefix_y = year if month > 1 else year - 1
    prev_prefix = f'{prev_prefix_y}-{prev_prefix_m:02d}'
    prev_pay_qs = Payroll.objects.filter(month__startswith=prev_prefix)
    if dept_id:
        prev_pay_qs = prev_pay_qs.filter(employee__department_id=dept_id)
    prev_net_mass = float(prev_pay_qs.aggregate(t=Sum('net_salary'))['t'] or 0)
    current_net = float(pay_qs.aggregate(t=Sum('net_salary'))['t'] or 0)
    payroll_evolution_pct = round(
        (current_net - prev_net_mass) / prev_net_mass * 100, 1,
    ) if prev_net_mass else 0

    pay = {
        'total_bulletins': pay_qs.count(),
        'pending_count': pay_qs.filter(status='PENDING').count(),
        'exports_count': PayrollExportLog.objects.filter(payroll__month__startswith=prefix).count(),
        'net_mass': current_net,
        'total_deductions': total_deductions,
        'payroll_evolution_pct': payroll_evolution_pct,
    }

    total_month_att = att_month.count()
    attendance_rate_month = round(
        att_month.filter(status='Present').count() / total_month_att * 100, 1,
    ) if total_month_att else 0
    absenteeism_rate_month = round(
        att_month.filter(status='Absent').count() / total_month_att * 100, 1,
    ) if total_month_att else 0

    leave_days_month = 0
    for a in abs_month:
        start = max(a.start_date, month_start)
        end = min(a.end_date, month_end)
        leave_days_month += (end - start).days + 1
    avg_leave_days = round(leave_days_month / total, 1) if total else 0

    hours_worked = att_month.filter(status='Present').count() * 8

    objectives = Objective.objects.all()
    if dept_id:
        objectives = objectives.filter(employee__department_id=dept_id)
    obj_total = objectives.count() or 1
    obj_completed = objectives.filter(status='Completed').count()
    objective_achievement_rate = round(obj_completed / obj_total * 100, 1)

    emp_filter = {}
    if dept_id:
        emp_filter['employee__department_id'] = dept_id
    if emp_id:
        emp_filter['employee_id'] = emp_id

    top_employees_perf = list(
        PerformanceReview.objects.filter(**emp_filter)
        .values('employee__full_name', 'employee_id')
        .annotate(avg_score=Avg('score'), reviews=Count('id'))
        .order_by('-avg_score')[:10],
    )
    top_employees = []
    for e in top_employees_perf[:5]:
        eid = e['employee_id']
        att_e = Attendance.objects.filter(
            employee_id=eid, date__gte=month_start, date__lte=month_end,
        )
        att_total = att_e.count()
        att_rate = round(att_e.filter(status='Present').count() / att_total * 100, 1) if att_total else 0
        obj_done = Objective.objects.filter(employee_id=eid, status='Completed').count()
        composite = round((e['avg_score'] or 0) * 0.5 + att_rate * 0.3 + obj_done * 4, 1)
        top_employees.append({
            'name': e['employee__full_name'],
            'score': round(e['avg_score'] or 0, 1),
            'reviews': e['reviews'],
            'attendance_rate': att_rate,
            'objectives_done': obj_done,
            'composite': composite,
        })
    top_employees.sort(key=lambda x: x['composite'], reverse=True)

    top_departments = []
    for dept in Department.objects.annotate(
        emp_count=Count('employees', filter=Q(employees__status='Active')),
    ).order_by('-emp_count')[:10]:
        if dept_id and dept.id != dept_id:
            continue
        att = Attendance.objects.filter(
            employee__department=dept, date__gte=month_start, date__lte=month_end,
        )
        total_att = att.count()
        present = att.filter(status='Present').count()
        presence_rate = round(present / total_att * 100, 1) if total_att else 0
        kpi_avg = round(float(
            EmployeeKPI.objects.filter(employee__department=dept).aggregate(avg=Avg('current_value'))['avg'] or 0,
        ), 1)
        perf_avg = round(float(
            PerformanceReview.objects.filter(employee__department=dept).aggregate(avg=Avg('score'))['avg'] or 0,
        ), 1)
        global_score = round((presence_rate + kpi_avg + perf_avg) / 3, 1)
        top_departments.append({
            'name': dept.name,
            'employees': dept.emp_count,
            'presence_rate': presence_rate,
            'kpi_avg': kpi_avg,
            'performance_avg': perf_avg,
            'global_score': global_score,
        })
    top_departments.sort(key=lambda x: x['global_score'], reverse=True)
    top_departments = top_departments[:5]

    kpi_samples = []
    kpi_qs = EmployeeKPI.objects.select_related('employee')
    if dept_id:
        kpi_qs = kpi_qs.filter(employee__department_id=dept_id)
    for kpi in kpi_qs[:8]:
        kpi_samples.append({
            'label': f"{kpi.employee.full_name} — {kpi.name}",
            'current': float(kpi.current_value or 0),
            'target': float(kpi.target_value or 0),
            'percent': kpi.achievement_percent(),
        })

    salary_agg = emp_qs.aggregate(avg=Avg('salary_base'), mn=Min('salary_base'), mx=Max('salary_base'))
    annual_payroll = float(
        Payroll.objects.filter(month__year=year).aggregate(t=Sum('net_salary'))['t'] or payroll_mass * 12,
    )
    salary_by_dept = []
    for dept in Department.objects.annotate(
        avg_salary=Avg('employees__salary_base', filter=Q(employees__status='Active')),
        emp_count=Count('employees', filter=Q(employees__status='Active')),
    ).filter(emp_count__gt=0):
        if dept_id and dept.id != dept_id:
            continue
        salary_by_dept.append({
            'name': dept.name,
            'avg_salary': round(float(dept.avg_salary or 0), 2),
            'employees': dept.emp_count,
        })

    perf_by_dept = []
    for dept in Department.objects.all():
        if dept_id and dept.id != dept_id:
            continue
        avg_p = PerformanceReview.objects.filter(employee__department=dept).aggregate(avg=Avg('score'))['avg']
        if avg_p:
            perf_by_dept.append({'name': dept.name, 'avg_score': round(avg_p, 1)})

    detailed_stats = {
        'personnel': {
            'total': total,
            'by_department': dept_stats,
            'by_gender': [
                {'label': 'Hommes', 'count': gender_stats['hommes'], 'percent': gender_stats.get('hommes_pct', 0)},
                {'label': 'Femmes', 'count': gender_stats['femmes'], 'percent': gender_stats.get('femmes_pct', 0)},
                {'label': 'Autres', 'count': gender_stats['autres'], 'percent': gender_stats.get('autres_pct', 0)},
            ],
            'by_age': _age_distribution(emp_qs, today),
            'by_contract': _contract_distribution(emp_qs),
            'avg_seniority_years': avg_seniority,
            'turnover_rate_annual': turnover_rate,
        },
        'salary': {
            'avg_salary': round(float(salary_agg['avg'] or 0), 2),
            'min_salary': round(float(salary_agg['mn'] or 0), 2),
            'max_salary': round(float(salary_agg['mx'] or 0), 2),
            'annual_mass': round(annual_payroll, 2),
            'monthly_mass': payroll_mass,
            'by_department': salary_by_dept,
            'payroll_evolution_pct': payroll_evolution_pct,
        },
        'presences': {
            'attendance_rate': attendance_rate_month,
            'absenteeism_rate': absenteeism_rate_month,
            'late_count': att_month.filter(status='Late').count(),
            'hours_worked': hours_worked,
            'leave_days_total': leave_days_month,
            'avg_leave_days': avg_leave_days,
        },
        'recruitment': {
            'monthly': recruitment_monthly,
            'acceptance_rate': conversion_rate,
            'rejection_rate': rejection_rate,
            'avg_processing_days': avg_recruitment_days,
            'open_positions': Recruitment.objects.filter(status='Open').count(),
        },
        'formation': {
            'total_trainings': training.get('total_trainings', 0),
            'participants': training.get('participants_registered', 0),
            'success_rate': training.get('success_rate', 0),
            'certifications_obtained': certs_obtained,
            'training_hours': training_hours,
            'participation_rate': training.get('participation_rate', 0),
        },
        'performance': {
            'star_distribution': perf.get('star_distribution', {}),
            'by_department': perf_by_dept,
            'objectives_achievement_pct': objective_achievement_rate,
            'monthly_evolution': perf.get('monthly_evolution', []),
            'avg_score': perf.get('average_score', 0),
        },
    }

    calendar_events = []
    for a in Absence.objects.filter(status='Approved', end_date__gte=today - timedelta(days=7))[:20]:
        calendar_events.append({
            'date': a.start_date.isoformat(),
            'title': f"Congé — {a.employee.full_name}",
            'type': 'leave',
        })
    for t in Training.objects.filter(start_date__gte=today - timedelta(days=7))[:15]:
        calendar_events.append({
            'date': t.start_date.isoformat() if t.start_date else today.isoformat(),
            'title': f"Formation — {t.title}",
            'type': 'training',
        })
    for r in PerformanceReview.objects.filter(review_date__gte=today - timedelta(days=7))[:15]:
        calendar_events.append({
            'date': r.review_date.isoformat(),
            'title': f"Évaluation — {r.employee.full_name}",
            'type': 'review',
        })
    for c in Contract.objects.filter(is_active=True, end_date__gte=today, end_date__lte=today + timedelta(days=90))[:15]:
        calendar_events.append({
            'date': c.end_date.isoformat(),
            'title': f"Fin contrat — {c.employee.full_name}",
            'type': 'contract',
        })
    for ap in Applicant.objects.filter(status='INTERVIEW_SCHEDULED')[:10]:
        calendar_events.append({
            'date': ap.created_at.date().isoformat(),
            'title': f"Entretien — {ap.full_name}",
            'type': 'interview',
        })
    calendar_events.sort(key=lambda x: x['date'])

    total_attendance = Attendance.objects.count()
    absent_count = Attendance.objects.filter(status='Absent').count()
    budget_alert = payroll_evolution_pct > 15

    return {
        'total_employees': total,
        'active_employees': total,
        'new_hires_month': new_hires,
        'payroll_mass': payroll_mass,
        'avg_cost_per_employee': avg_cost,
        'avg_seniority_years': avg_seniority,
        'turnover_rate_annual': turnover_rate,
        'payroll_evolution_pct': payroll_evolution_pct,
        'total_deductions': total_deductions,
        'absences_today': absences_today.count(),
        'open_recruitments': Recruitment.objects.filter(status='Open').count(),
        'trainings_count': Training.objects.count(),
        'evaluations_count': PerformanceReview.objects.count(),
        'absenteeism_rate': round(absent_count / total_attendance * 100, 1) if total_attendance else 0,
        'absenteeism_rate_month': absenteeism_rate_month,
        'avg_leave_days': avg_leave_days,
        'conversion_rate': conversion_rate,
        'avg_recruitment_days': avg_recruitment_days,
        'training_hours_avg': round(training_hours / max(training.get('completed', 1), 1), 1),
        'participation_rate': training.get('participation_rate', 0),
        'objective_achievement_rate': objective_achievement_rate,
        'contracts_expiring_soon': contracts_expiring.count(),
        'department_distribution': dept_stats,
        'gender_distribution': gender_stats,
        'monthly_headcount': monthly_headcount,
        'monthly_payroll': monthly_payroll,
        'monthly_trends': monthly_trends,
        'presences_chart': presences_chart,
        'attendance_rate_month': attendance_rate_month,
        'present_today': attendances_today.filter(status='Present').count(),
        'late_today': attendances_today.filter(status='Late').count(),
        'recruitment_funnel': recruitment_funnel,
        'formation_comparison': formation_comparison,
        'performance_stars': perf.get('star_distribution', {}),
        'performance_monthly': perf.get('monthly_evolution', []),
        'kpi_progress': kpi_samples,
        'top_employees': top_employees,
        'top_departments': top_departments,
        'detailed_stats': detailed_stats,
        'calendar_events': calendar_events[:30],
        'recent_activities': AuditLogSerializer(AuditLog.objects.all()[:10], many=True).data,
        'payroll_summary': pay,
        'budget_alert': budget_alert,
        'filters': {
            'month': month, 'year': year, 'department_id': dept_id,
            'employee_id': emp_id, 'contract_type': contract_type,
            'gender': gender, 'age_range': age_range, 'site': site,
        },
    }
