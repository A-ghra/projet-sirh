"""Logique métier — missions professionnelles."""
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Q  # noqa: F401 — used in filter_missions_queryset
from django.utils import timezone

from .models import Mission, MissionAuditLog, Payroll
from .permissions import (
    ROLE_ADMIN, ROLE_EMPLOYE, ROLE_GESTIONNAIRE, ROLE_MANAGER, get_user_role,
)
from .presence_service import get_user_employee

MISSION_ACTIVE_STATUSES = (
    'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'Approved', 'Completed',
)

STATUS_LABELS = {
    'PENDING_APPROVAL': 'En attente d\'approbation',
    'APPROVED': 'Approuvée',
    'IN_PROGRESS': 'En cours',
    'COMPLETED': 'Terminée',
    'CANCELLED': 'Annulée',
    'Pending': 'En attente d\'approbation',
    'Approved': 'Approuvée',
    'Rejected': 'Annulée',
    'Completed': 'Terminée',
}


def normalize_mission_status(status):
    mapping = {
        'Pending': 'PENDING_APPROVAL',
        'Approved': 'APPROVED',
        'Rejected': 'CANCELLED',
        'Completed': 'COMPLETED',
    }
    return mapping.get(status, status or 'PENDING_APPROVAL')


def generate_mission_number(employee):
    year = timezone.now().year
    seq = Mission.objects.filter(
        employee=employee, mission_number__contains=str(year),
    ).count() + 1
    mat = (employee.matricule or 'EMP').replace(' ', '')
    return f'MIS-{mat}-{year}-{seq:03d}'


def log_mission_action(mission, action, user=None, note=''):
    MissionAuditLog.objects.create(
        mission=mission,
        action=action,
        user=user if user and user.is_authenticated else None,
        note=note or '',
    )


MISSION_AUDIT_FIELDS = {
    'title': 'Objet',
    'destination': 'Lieu',
    'description': 'Description',
    'city': 'Ville',
    'province': 'Province',
    'country': 'Pays',
    'visited_organization': 'Organisme visité',
    'start_date': 'Date début',
    'end_date': 'Date fin',
    'start_time': 'Heure départ',
    'end_time': 'Heure retour',
    'transport_mode': 'Transport',
    'accommodation': 'Hébergement',
    'advance_amount': 'Avance',
    'daily_allowance': 'Indemnité/jour',
    'budget_allocated': 'Budget',
    'comments': 'Commentaires',
}


def build_mission_update_audit_note(instance, validated_data):
    """Construit une note d'audit listant les champs modifiés (ancienne → nouvelle valeur)."""
    changes = []
    for field, label in MISSION_AUDIT_FIELDS.items():
        if field not in validated_data:
            continue
        old_val = getattr(instance, field, None)
        new_val = validated_data[field]
        if str(old_val or '') != str(new_val or ''):
            changes.append(f'{label}: {old_val or "—"} → {new_val or "—"}')
    if not changes:
        return instance.title or ''
    return '; '.join(changes)


def user_can_write_mission(user, mission=None, employee_id=None):
    role = get_user_role(user)
    if user.is_superuser or role in (ROLE_ADMIN, ROLE_GESTIONNAIRE):
        return True
    emp = get_user_employee(user)
    if not emp:
        return False
    target_id = mission.employee_id if mission else employee_id
    if role == ROLE_MANAGER:
        if target_id == emp.id:
            return True
        from .models import Employee
        return Employee.objects.filter(id=target_id, manager=emp).exists()
    if role == ROLE_EMPLOYE:
        return mission is None and target_id == emp.id
    return False


def user_can_delete_mission(user, mission=None):
    role = get_user_role(user)
    return user.is_superuser or role in (ROLE_ADMIN, ROLE_GESTIONNAIRE)


def user_can_approve_mission(user):
    role = get_user_role(user)
    return user.is_superuser or role in (ROLE_ADMIN, ROLE_GESTIONNAIRE, ROLE_MANAGER)


def filter_missions_queryset(user, qs=None):
    from .models import Employee
    from .presence_service import can_manage_all_presences, get_user_employee
    qs = qs or Mission.objects.select_related(
        'employee', 'employee__department', 'employee__manager',
    ).prefetch_related('documents')
    if can_manage_all_presences(user):
        return qs
    emp = get_user_employee(user)
    if not emp:
        return qs.none()
    role = get_user_role(user)
    if role == ROLE_MANAGER:
        team_ids = Employee.objects.filter(Q(id=emp.id) | Q(manager=emp)).values_list('id', flat=True)
        return qs.filter(employee_id__in=team_ids)
    if role == ROLE_EMPLOYE:
        return qs.filter(employee_id=emp.id)
    return qs.none()


def apply_mission_filters(qs, params):
    if params.get('department'):
        qs = qs.filter(employee__department_id=params['department'])
    if params.get('employee'):
        qs = qs.filter(employee_id=params['employee'])
    if params.get('status'):
        qs = qs.filter(status=params['status'])
    if params.get('year'):
        try:
            qs = qs.filter(start_date__year=int(params['year']))
        except (TypeError, ValueError):
            pass
    if params.get('month'):
        try:
            qs = qs.filter(start_date__month=int(params['month']))
        except (TypeError, ValueError):
            pass
    search = params.get('search') or params.get('q')
    if search:
        qs = qs.filter(
            Q(employee__full_name__icontains=search)
            | Q(employee__matricule__icontains=search)
            | Q(employee__department__name__icontains=search)
            | Q(title__icontains=search)
            | Q(destination__icontains=search)
            | Q(mission_number__icontains=search)
            | Q(city__icontains=search)
        )
    return qs.order_by('-start_date', '-id')


def mission_days_count(mission):
    if mission.start_date and mission.end_date:
        return (mission.end_date - mission.start_date).days + 1
    return 0


def sync_mission_attendance_markers(mission):
    """Marque les jours de mission dans la grille (évite absences auto)."""
    from .models import Attendance
    if mission.status not in MISSION_ACTIVE_STATUSES:
        return
    d = mission.start_date
    while d <= mission.end_date:
        Attendance.objects.update_or_create(
            employee=mission.employee,
            date=d,
            defaults={
                'event_type': 'mission',
                'status': 'Present',
                'notes': f'Mission: {mission.title}',
                'record_source': 'mission',
            },
        )
        d += timedelta(days=1)


def sync_mission_to_payroll(mission):
    """Transmet indemnités / avances au bulletin brouillon du mois de début."""
    if mission.payroll_synced or mission.status not in ('COMPLETED', 'IN_PROGRESS', 'APPROVED', 'Approved', 'Completed'):
        return None
    month_start = mission.start_date.replace(day=1)
    payroll, _ = Payroll.objects.get_or_create(
        employee=mission.employee,
        month=month_start,
        defaults={
            'salary_base': mission.employee.salary_base or 0,
            'gross_salary': mission.employee.salary_base or 0,
            'net_salary': mission.employee.salary_base or 0,
            'status': 'DRAFT',
        },
    )
    if payroll.status not in ('DRAFT', 'PENDING'):
        return payroll
    days = mission_days_count(mission)
    allowance_total = Decimal(mission.daily_allowance or 0) * days
    payroll.days_mission = (payroll.days_mission or 0) + days
    payroll.autres_indemnites = Decimal(payroll.autres_indemnites or 0) + allowance_total
    if mission.advance_amount:
        payroll.avances_salaire = Decimal(payroll.avances_salaire or 0) + Decimal(mission.advance_amount)
    if mission.actual_expenses and mission.status in ('COMPLETED', 'Completed'):
        payroll.indemnite_speciale = Decimal(payroll.indemnite_speciale or 0) + Decimal(mission.actual_expenses)
    payroll.save()
    mission.payroll_synced = True
    mission.save(update_fields=['payroll_synced'])
    return payroll
