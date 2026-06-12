"""Détection automatique des absences — alertes manager et création."""
import calendar
from datetime import date, time

from django.core.mail import send_mail
from django.db.models import Q
from django.utils import timezone

from .models import (
    Absence, AbsenceAlert, Attendance, Employee, Mission,
    PresenceAbsenceSettings, WorkScheduleSettings,
)
from .utils import log_action, notify_employee, notify_manager

AUTO_ABSENCE_REASON = 'Absence automatique pour absence de pointage.'


def is_working_day(d, schedule=None):
    schedule = schedule or WorkScheduleSettings.get_settings()
    return d.weekday() < int(schedule.working_days_per_week or 5)


def employee_has_daily_coverage(employee, d):
    """True si présence, congé approuvé ou mission couvre la journée."""
    att = Attendance.objects.filter(employee=employee, date=d).first()
    if att and att.event_type in ('presence', 'leave', 'mission', 'absence'):
        return True
    if employee.absences.filter(status='Approved', start_date__lte=d, end_date__gte=d).exists():
        return True
    from .mission_service import MISSION_ACTIVE_STATUSES
    if employee.missions.filter(
        status__in=MISSION_ACTIVE_STATUSES,
        start_date__lte=d, end_date__gte=d,
    ).exists():
        return True
    return False


def find_untracked_employees(d):
    """Employés actifs sans couverture pour la date donnée."""
    employees = Employee.objects.filter(status='Active', is_active=True).select_related('manager', 'department')
    return [emp for emp in employees if not employee_has_daily_coverage(emp, d)]


def resolve_alert_if_covered(alert):
    """Marque l'alerte comme régularisée si l'employé a désormais une couverture."""
    if alert.status != 'pending':
        return False
    if employee_has_daily_coverage(alert.employee, alert.date):
        alert.status = 'regularized'
        alert.resolved_at = timezone.now()
        alert.save(update_fields=['status', 'resolved_at'])
        return True
    return False


def send_absence_alert(employee, d, settings):
    """Notifie le manager qu'aucun pointage n'a été enregistré."""
    manager = employee.manager
    alert, created = AbsenceAlert.objects.get_or_create(
        employee=employee,
        date=d,
        defaults={'manager': manager, 'status': 'pending'},
    )
    if not created and alert.status != 'pending':
        return alert

    if not created:
        resolve_alert_if_covered(alert)
        if alert.status != 'pending':
            return alert

    message = (
        f"Aucun pointage n'a été enregistré aujourd'hui.\n\n"
        f"Veuillez confirmer l'absence de l'employé : {employee.full_name} "
        f"avant la clôture de la journée."
    )
    title = f"Alerte absence — {employee.full_name}"

    if settings.notify_internal or settings.notify_dashboard:
        notify_manager(manager, title, message, 'absence_alert')

    if settings.notify_email and manager and manager.email:
        try:
            send_mail(
                subject=f"[OTOMIA RH] {title}",
                message=message,
                from_email=None,
                recipient_list=[manager.email],
                fail_silently=True,
            )
        except Exception:
            pass

    notify_employee(
        employee,
        'Absence potentielle détectée',
        f'Aucun pointage enregistré le {d}. Contactez votre manager si nécessaire.',
        'absence_alert',
    )
    return alert


def create_auto_absence(employee, d, manager, settings):
    """Crée l'absence automatique après expiration du délai de régularisation."""
    now = timezone.now()
    att, created = Attendance.objects.update_or_create(
        employee=employee,
        date=d,
        defaults={
            'event_type': 'absence',
            'status': 'Absent',
            'record_source': 'auto',
            'absence_workflow_status': 'pending_validation',
            'generated_at': now,
            'responsible_manager': manager,
            'notes': AUTO_ABSENCE_REASON,
        },
    )
    if not created and att.record_source == 'manual' and att.event_type != 'absence':
        return att

    alert = AbsenceAlert.objects.filter(employee=employee, date=d).first()
    if alert:
        alert.status = 'auto_created'
        alert.resolved_at = now
        alert.attendance = att
        alert.save(update_fields=['status', 'resolved_at', 'attendance'])
    else:
        AbsenceAlert.objects.create(
            employee=employee, date=d, manager=manager,
            status='auto_created', resolved_at=now, attendance=att,
        )

    notify_manager(
        manager,
        f'Absence automatique — {employee.full_name}',
        f'Absence créée pour {employee.full_name} le {d} : {AUTO_ABSENCE_REASON}',
        'absence_auto',
    )
    notify_employee(
        employee,
        'Absence automatique enregistrée',
        f'Une absence a été enregistrée le {d}. Vous pouvez soumettre une justification.',
        'absence_auto',
    )
    return att


def process_absence_alerts(for_date=None, force_notify=None, force_finalize=None):
    """
    Phase 1 : alertes manager après fin de journée.
    Phase 2 : création automatique après heure limite.
    force_notify / force_finalize : True/False pour forcer, None pour détection horaire.
    """
    settings = PresenceAbsenceSettings.get_settings()
    forced = force_notify is True or force_finalize is True
    if not settings.auto_absence_enabled and not forced:
        return {'enabled': False, 'alerts_sent': 0, 'absences_created': 0}

    schedule = WorkScheduleSettings.get_settings()
    now = timezone.now()
    target_date = for_date or now.date()

    if not is_working_day(target_date, schedule):
        return {'enabled': True, 'alerts_sent': 0, 'absences_created': 0, 'skipped': 'non_working_day'}

    result = {'enabled': True, 'alerts_sent': 0, 'absences_created': 0, 'date': str(target_date)}

    should_notify = force_notify if force_notify is not None else (now.time() >= schedule.work_end)
    should_finalize = force_finalize if force_finalize is not None else (now.time() >= settings.cutoff_time)

    if should_notify:
        for emp in find_untracked_employees(target_date):
            alert = send_absence_alert(emp, target_date, settings)
            if alert and alert.status == 'pending':
                result['alerts_sent'] += 1

    if should_finalize:
        pending_alerts = AbsenceAlert.objects.filter(
            date=target_date, status='pending',
        ).select_related('employee', 'manager')
        for alert in pending_alerts:
            if resolve_alert_if_covered(alert):
                continue
            if not employee_has_daily_coverage(alert.employee, alert.date):
                create_auto_absence(alert.employee, alert.date, alert.manager, settings)
                result['absences_created'] += 1

    return result


def regularize_auto_absence(attendance, user, new_status, note=''):
    """Régularise une absence automatique (manager / RH)."""
    old_status = attendance.absence_workflow_status
    attendance.absence_workflow_status = new_status
    if note:
        attendance.justification_note = note
    attendance.save(update_fields=['absence_workflow_status', 'justification_note'])

    alert = AbsenceAlert.objects.filter(attendance=attendance).first()
    if alert and new_status == 'regularized':
        alert.status = 'regularized'
        alert.resolved_at = timezone.now()
        alert.save(update_fields=['status', 'resolved_at'])

    log_action(
        user, 'Régularisation absence auto', 'Présences',
        f'{attendance.employee.full_name} — {attendance.date}',
        old_value=old_status, new_value=new_status,
    )
    return attendance


def submit_absence_justification(attendance, note='', file_obj=None):
    """Soumission de justification par l'employé."""
    if note:
        attendance.justification_note = note
    if file_obj:
        attendance.justification_file = file_obj
    if attendance.absence_workflow_status == 'pending_validation':
        attendance.absence_workflow_status = 'contested'
    attendance.save()
    return attendance


def auto_absence_counts_for_dashboard():
    """Compteurs pour tableau de bord RH."""
    today = timezone.now().date()
    month_start = today.replace(day=1)
    auto_qs = Attendance.objects.filter(record_source='auto', event_type='absence')
    return {
        'auto_absences_today': auto_qs.filter(date=today).count(),
        'auto_absences_pending': auto_qs.filter(absence_workflow_status='pending_validation').count(),
        'auto_absences_regularized': auto_qs.filter(absence_workflow_status='regularized').count(),
        'auto_absences_month': auto_qs.filter(date__gte=month_start).count(),
        'pending_alerts_today': AbsenceAlert.objects.filter(date=today, status='pending').count(),
    }
