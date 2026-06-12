"""Intégration Présences & Congés → calcul de paie."""
import calendar
from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP

from .models import WorkScheduleSettings

D = Decimal


def _d(value):
    return D(str(value or 0)).quantize(D('0.01'), rounding=ROUND_HALF_UP)


def _month_bounds(month_date):
    last = calendar.monthrange(month_date.year, month_date.month)[1]
    return date(month_date.year, month_date.month, 1), date(month_date.year, month_date.month, last)


def _working_days_in_month(month_date, days_per_week=5):
    start, end = _month_bounds(month_date)
    count = 0
    d = start
    while d <= end:
        if d.weekday() < days_per_week:
            count += 1
        d += timedelta(days=1)
    return count


def _mission_days(employee, month_date):
    start, end = _month_bounds(month_date)
    total = 0
    for m in employee.missions.filter(status__in=['Approved', 'Completed'], start_date__lte=end, end_date__gte=start):
        s = max(m.start_date, start)
        e = min(m.end_date, end)
        total += (e - s).days + 1
    return total


def _leave_days_by_type(employee, month_date):
    start, end = _month_bounds(month_date)
    paid = unpaid = 0
    for absence in employee.absences.filter(status='Approved', start_date__lte=end, end_date__gte=start):
        s = max(absence.start_date, start)
        e = min(absence.end_date, end)
        days = (e - s).days + 1
        if absence.absence_type in ('CP', 'Maladie', 'RTT'):
            paid += days
        elif absence.absence_type == 'Autre':
            unpaid += days
    return paid, unpaid


def _attendance_metrics(employee, month_date, schedule):
    start, end = _month_bounds(month_date)
    qs = employee.attendances.filter(date__gte=start, date__lte=end)
    late_count = qs.filter(status='Late').count()
    absent_count = qs.filter(status='Absent').count()
    present_count = qs.filter(status='Present').count()

    late_minutes = 0
    hours_worked = D('0')
    work_start = schedule.work_start
    lunch = schedule.lunch_break_minutes

    for att in qs.exclude(status='Absent'):
        if att.check_in and att.check_out:
            start_dt = datetime.combine(att.date, att.check_in)
            end_dt = datetime.combine(att.date, att.check_out)
            if end_dt < start_dt:
                end_dt += timedelta(days=1)
            worked_mins = (end_dt - start_dt).total_seconds() / 60 - lunch
            hours_worked += D(str(max(worked_mins, 0) / 60))
            if att.status == 'Late' and att.check_in:
                expected = datetime.combine(att.date, work_start)
                actual = datetime.combine(att.date, att.check_in)
                if actual > expected:
                    late_minutes += int((actual - expected).total_seconds() / 60)
        elif att.status == 'Present':
            hours_worked += _d(schedule.hours_per_day)

    return {
        'late_count': late_count,
        'absent_count': absent_count,
        'present_count': present_count,
        'late_minutes': late_minutes,
        'hours_worked': hours_worked.quantize(D('0.01'), rounding=ROUND_HALF_UP),
    }


def compute_attendance_payroll(employee, month_date, salary_base):
    """
    Calcule les variables de paie liées aux présences pour un employé et un mois.
    """
    schedule = WorkScheduleSettings.get_settings()
    days_working = _working_days_in_month(month_date, schedule.working_days_per_week)
    mission_days = _mission_days(employee, month_date)
    leave_paid, leave_unpaid = _leave_days_by_type(employee, month_date)
    metrics = _attendance_metrics(employee, month_date, schedule)

    days_absent = metrics['absent_count']
    days_worked = metrics['present_count'] + metrics['late_count'] + mission_days
    days_worked = min(days_worked, days_working)

    monthly_hours = _d(schedule.monthly_hours or (schedule.hours_per_day * D(str(days_working))))
    hourly_rate = D('0')
    if monthly_hours > 0 and salary_base > 0:
        hourly_rate = (salary_base / monthly_hours).quantize(D('0.01'), rounding=ROUND_HALF_UP)

    hours_normal = min(metrics['hours_worked'], monthly_hours).quantize(D('0.01'), rounding=ROUND_HALF_UP)
    hours_overtime = max(metrics['hours_worked'] - monthly_hours, D('0')).quantize(D('0.01'), rounding=ROUND_HALF_UP)
    hours_missing = max(monthly_hours - metrics['hours_worked'], D('0')).quantize(D('0.01'), rounding=ROUND_HALF_UP)

    overtime_amount = D('0')
    if hours_overtime > 0 and hourly_rate > 0:
        coeff = _d(schedule.overtime_rate_weekday)
        overtime_amount = (hours_overtime * hourly_rate * coeff).quantize(D('0.01'), rounding=ROUND_HALF_UP)

    retenues_retards = D('0')
    if schedule.late_deduction_mode == 'AUTO' and metrics['late_minutes'] > 0 and hourly_rate > 0:
        late_hours = D(str(metrics['late_minutes'])) / D('60')
        retenues_retards = (late_hours * hourly_rate).quantize(D('0.01'), rounding=ROUND_HALF_UP)

    absence_deduction = D('0')
    unjustified = days_absent + leave_unpaid
    if unjustified > 0 and days_working > 0:
        daily_rate = salary_base / D(str(days_working))
        absence_deduction = (daily_rate * D(str(unjustified))).quantize(D('0.01'), rounding=ROUND_HALF_UP)

    presence_rate = D('0')
    if days_working > 0:
        presence_rate = (D(str(days_worked)) / D(str(days_working)) * D('100')).quantize(D('0.01'))

    return {
        'days_working': days_working,
        'days_worked': days_worked,
        'days_absent': days_absent,
        'days_leave': leave_paid,
        'days_mission': mission_days,
        'hours_normal': hours_normal,
        'hours_missing': hours_missing,
        'overtime_hours': hours_overtime,
        'overtime_rate': hourly_rate * schedule.overtime_rate_weekday if hourly_rate else D('0'),
        'heures_supplementaires': overtime_amount,
        'hourly_rate': hourly_rate,
        'late_minutes': metrics['late_minutes'],
        'retenues_retards': retenues_retards,
        'absences_non_justifiees': absence_deduction,
        'absence_late_count': metrics['late_count'],
        'absence_justified_days': leave_paid,
        'absence_unjustified_days': unjustified,
        'leave_taken': D(str(leave_paid)),
        'leave_balance_current': D(str(employee.leave_balance)),
        'leave_balance_previous': D(str(float(employee.leave_balance) + leave_paid)),
        'presence_rate': presence_rate,
    }
