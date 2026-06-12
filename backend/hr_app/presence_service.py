"""Logique métier Présences & Congés — rapports, grilles, droits d'accès."""
import calendar
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.db.models import Q
from django.utils import timezone

from .models import Absence, Attendance, Employee, Mission, WorkScheduleSettings
from .permissions import (
    ROLE_ADMIN, ROLE_EMPLOYE, ROLE_GESTIONNAIRE, ROLE_MANAGER,
    get_user_role,
)

D = Decimal

EVENT_CODES = {
    'presence': 'P',
    'absence': 'A',
    'leave': 'C',
    'mission': 'M',
}

LEAVE_FEATURE_TO_ABSENCE = {
    'conge_annuel': 'CP',
    'conge_maladie': 'Maladie',
    'conge_maternite': 'Maladie',
    'conge_paternite': 'CP',
    'conge_exceptionnel': 'Autre',
    'conge_sans_solde': 'Autre',
    'autorisation_absence': 'Autre',
    'mission_professionnelle': 'Mission',
    'deplacement_professionnel': 'Mission',
}


def get_user_employee(user):
    return getattr(getattr(user, 'profile', None), 'employee', None)


def map_leave_feature_key(feature_key):
    return LEAVE_FEATURE_TO_ABSENCE.get(feature_key, 'Autre')


def can_manage_all_presences(user):
    role = get_user_role(user)
    return user.is_superuser or role in (ROLE_ADMIN, ROLE_GESTIONNAIRE)


def can_manage_team_presences(user):
    role = get_user_role(user)
    return can_manage_all_presences(user) or role == ROLE_MANAGER


def filter_employees_queryset(user, qs=None):
    qs = qs or Employee.objects.filter(status='Active').select_related('department', 'position_ref')
    if can_manage_all_presences(user):
        return qs
    emp = get_user_employee(user)
    if not emp:
        return qs.none()
    role = get_user_role(user)
    if role == ROLE_MANAGER:
        return qs.filter(Q(id=emp.id) | Q(manager=emp))
    if role == ROLE_EMPLOYE:
        return qs.filter(id=emp.id)
    return qs


def filter_attendance_queryset(user, qs=None):
    qs = qs or Attendance.objects.select_related('employee', 'employee__department')
    emp_ids = filter_employees_queryset(user).values_list('id', flat=True)
    return qs.filter(employee_id__in=emp_ids)


def filter_absence_queryset(user, qs=None):
    qs = qs or Absence.objects.select_related('employee', 'employee__department')
    emp_ids = filter_employees_queryset(user).values_list('id', flat=True)
    return qs.filter(employee_id__in=emp_ids)


def filter_mission_queryset(user, qs=None):
    from .mission_service import filter_missions_queryset
    return filter_missions_queryset(user, qs)


def user_can_edit_attendance(user, attendance=None, employee_id=None):
    if can_manage_all_presences(user):
        return True
    emp = get_user_employee(user)
    if not emp:
        return False
    target_id = attendance.employee_id if attendance else employee_id
    if get_user_role(user) == ROLE_MANAGER:
        if target_id == emp.id:
            return True
        return Employee.objects.filter(id=target_id, manager=emp).exists()
    if get_user_role(user) == ROLE_EMPLOYE:
        return target_id == emp.id
    return False


def user_can_delete_attendance(user, attendance):
    return user_can_edit_attendance(user, attendance=attendance)


def user_can_create_attendance_for(user, employee_id):
    emp = get_user_employee(user)
    if not emp:
        return can_manage_team_presences(user)
    if can_manage_team_presences(user):
        return user_can_edit_attendance(user, employee_id=employee_id)
    if get_user_role(user) == ROLE_EMPLOYE:
        return employee_id == emp.id
    return False


def _month_bounds(year, month):
    last = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


def _parse_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _employee_payload(emp):
    return {
        'id': emp.id,
        'full_name': emp.full_name,
        'matricule': emp.matricule,
        'position': emp.position or (emp.position_ref.name if emp.position_ref else '-'),
        'department': emp.department.name if emp.department else '-',
        'department_id': emp.department_id,
    }


def detect_attendance_status(event_type, check_in, att_date, schedule=None):
    if event_type == 'absence':
        return 'Absent'
    if event_type in ('leave', 'mission'):
        return 'Present'
    if check_in and schedule:
        expected = datetime.combine(att_date, schedule.work_start)
        actual = datetime.combine(att_date, check_in)
        if actual > expected:
            return 'Late'
    return 'Present'


def compute_hours_worked(check_in, check_out, att_date, schedule):
    if not check_in or not check_out:
        return D('0')
    start_dt = datetime.combine(att_date, check_in)
    end_dt = datetime.combine(att_date, check_out)
    if end_dt < start_dt:
        end_dt += timedelta(days=1)
    lunch = schedule.lunch_break_minutes if schedule else 0
    worked_mins = (end_dt - start_dt).total_seconds() / 60 - lunch
    return D(str(max(worked_mins, 0) / 60)).quantize(D('0.01'))


def sync_attendance_related_records(attendance):
    """Synchronise Congés / Missions lorsqu'un pointage est de type congé ou mission."""
    emp = attendance.employee
    d = attendance.date
    if attendance.event_type == 'leave':
        Absence.objects.update_or_create(
            employee=emp,
            start_date=d,
            end_date=d,
            defaults={
                'absence_type': 'CP',
                'status': 'Pending',
                'reason': attendance.notes or 'Enregistré via pointage',
            },
        )
    elif attendance.event_type == 'mission':
        Mission.objects.update_or_create(
            employee=emp,
            start_date=d,
            end_date=d,
            defaults={
                'title': (attendance.notes or 'Mission')[:200],
                'destination': attendance.notes or '—',
                'status': 'Approved',
                'description': attendance.notes or '',
            },
        )


def notify_leave_request_created(absence):
    """Notifie l'employé que sa demande a bien été enregistrée."""
    from .utils import notify_employee
    notify_employee(
        absence.employee,
        'Demande de congé enregistrée',
        f'Votre demande du {absence.start_date} au {absence.end_date} est en attente de validation.',
        'leave_pending',
    )


def prepare_attendance_payload(data, instance=None):
    schedule = WorkScheduleSettings.get_settings()
    event_type = data.get('event_type', getattr(instance, 'event_type', 'presence'))
    force_late = event_type == 'late'
    if force_late:
        event_type = 'presence'
    att_date = data.get('date', getattr(instance, 'date', timezone.now().date()))
    check_in = data.get('check_in', getattr(instance, 'check_in', None))
    if isinstance(att_date, str):
        att_date = date.fromisoformat(att_date)
    if event_type == 'presence' and not check_in:
        check_in = timezone.now().time().replace(second=0, microsecond=0)
        data['check_in'] = check_in
    status = 'Late' if force_late else detect_attendance_status(event_type, check_in, att_date, schedule)
    data['status'] = status
    data['event_type'] = event_type
    return data


def _search_employees(qs, search):
    if not search:
        return qs
    term = search.strip()
    if not term:
        return qs
    return qs.filter(
        Q(full_name__icontains=term)
        | Q(matricule__icontains=term)
        | Q(position__icontains=term)
        | Q(department__name__icontains=term)
    )


def _day_code_for_employee(emp, day, att_map, leave_ranges, mission_ranges):
    att = att_map.get((emp.id, day))
    if att:
        return EVENT_CODES.get(att.event_type, 'P'), att
    d = date(day.year, day.month, day.day) if hasattr(day, 'day') else day
    for start, end in leave_ranges.get(emp.id, []):
        if start <= d <= end:
            return 'C', None
    for start, end in mission_ranges.get(emp.id, []):
        if start <= d <= end:
            return 'M', None
    return '', None


def _build_leave_ranges(employee_ids, start, end):
    ranges = {eid: [] for eid in employee_ids}
    for absence in Absence.objects.filter(
        employee_id__in=employee_ids, status='Approved',
        start_date__lte=end, end_date__gte=start,
    ):
        ranges.setdefault(absence.employee_id, []).append(
            (max(absence.start_date, start), min(absence.end_date, end))
        )
    return ranges


def _build_mission_ranges(employee_ids, start, end):
    ranges = {eid: [] for eid in employee_ids}
    from .mission_service import MISSION_ACTIVE_STATUSES
    for mission in Mission.objects.filter(
        employee_id__in=employee_ids, status__in=MISSION_ACTIVE_STATUSES,
        start_date__lte=end, end_date__gte=start,
    ):
        ranges.setdefault(mission.employee_id, []).append(
            (max(mission.start_date, start), min(mission.end_date, end))
        )
    return ranges


def _aggregate_employee_month(emp, start, end, att_map, leave_ranges, mission_ranges, schedule):
    counts = {'P': 0, 'A': 0, 'C': 0, 'M': 0}
    late_count = 0
    hours_worked = D('0')
    d = start
    while d <= end:
        code, att = _day_code_for_employee(emp, d, att_map, leave_ranges, mission_ranges)
        if code:
            counts[code] = counts.get(code, 0) + 1
        if att:
            if att.status == 'Late':
                late_count += 1
            hours_worked += compute_hours_worked(att.check_in, att.check_out, att.date, schedule)
        elif code == 'P' and not att:
            pass
        d += timedelta(days=1)
    return {
        **_employee_payload(emp),
        'present_count': counts['P'],
        'absent_count': counts['A'],
        'leave_count': counts['C'],
        'mission_count': counts['M'],
        'late_count': late_count,
        'hours_worked': float(hours_worked),
    }


def build_attendance_report(user, month=None, year=None, search=None, department_id=None):
    today = timezone.now().date()
    month = _parse_int(month, today.month)
    year = _parse_int(year, today.year)
    start, end = _month_bounds(year, month)
    schedule = WorkScheduleSettings.get_settings()

    qs = filter_employees_queryset(user)
    if department_id:
        qs = qs.filter(department_id=department_id)
    qs = _search_employees(qs, search)
    employees = list(qs.order_by('full_name'))
    emp_ids = [e.id for e in employees]

    attendances = Attendance.objects.filter(employee_id__in=emp_ids, date__gte=start, date__lte=end)
    att_map = {(a.employee_id, a.date): a for a in attendances}
    leave_ranges = _build_leave_ranges(emp_ids, start, end)
    mission_ranges = _build_mission_ranges(emp_ids, start, end)

    rows = [
        _aggregate_employee_month(emp, start, end, att_map, leave_ranges, mission_ranges, schedule)
        for emp in employees
    ]
    return {
        'month': month,
        'year': year,
        'rows': rows,
        'totals': {
            'present': sum(r['present_count'] for r in rows),
            'absent': sum(r['absent_count'] for r in rows),
            'leave': sum(r['leave_count'] for r in rows),
            'mission': sum(r['mission_count'] for r in rows),
            'late': sum(r['late_count'] for r in rows),
            'hours_worked': round(sum(r['hours_worked'] for r in rows), 2),
        },
    }


def build_attendance_summary(user, month=None, year=None, search=None):
    report = build_attendance_report(user, month, year, search)
    return {
        'month': report['month'],
        'year': report['year'],
        'totals': report['totals'],
        'rows': report['rows'],
    }


def build_attendance_grid(user, month=None, year=None, employee_id=None, department_id=None):
    today = timezone.now().date()
    month = _parse_int(month, today.month)
    year = _parse_int(year, today.year)
    start, end = _month_bounds(year, month)
    days_in_month = calendar.monthrange(year, month)[1]
    schedule = WorkScheduleSettings.get_settings()

    qs = filter_employees_queryset(user)
    if department_id:
        qs = qs.filter(department_id=department_id)
    if employee_id:
        qs = qs.filter(id=employee_id)
    employees = list(qs.order_by('full_name'))
    emp_ids = [e.id for e in employees]

    attendances = Attendance.objects.filter(employee_id__in=emp_ids, date__gte=start, date__lte=end)
    att_map = {(a.employee_id, a.date): a for a in attendances}
    leave_ranges = _build_leave_ranges(emp_ids, start, end)
    mission_ranges = _build_mission_ranges(emp_ids, start, end)

    rows = []
    for emp in employees:
        days = []
        counts = {'P': 0, 'A': 0, 'C': 0, 'M': 0}
        late_count = 0
        hours_worked = D('0')
        for day_num in range(1, days_in_month + 1):
            d = date(year, month, day_num)
            code, att = _day_code_for_employee(emp, d, att_map, leave_ranges, mission_ranges)
            if code:
                counts[code] = counts.get(code, 0) + 1
            if att:
                if att.status == 'Late':
                    late_count += 1
                hours_worked += compute_hours_worked(att.check_in, att.check_out, att.date, schedule)
            days.append({'day': day_num, 'code': code, 'weekend': d.weekday() >= 5})
        rows.append({
            **_employee_payload(emp),
            'days': days,
            'present_count': counts['P'],
            'absent_count': counts['A'],
            'leave_count': counts['C'],
            'mission_count': counts['M'],
            'late_count': late_count,
            'hours_worked': float(hours_worked),
        })

    return {
        'month': month,
        'year': year,
        'days_in_month': days_in_month,
        'rows': rows,
        'legend': EVENT_CODES,
    }
