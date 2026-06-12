"""Service métier — gestion du cycle de vie des contrats."""
from datetime import timedelta

from django.core.mail import send_mail
from django.db import models
from django.db.models import Q, Count
from django.utils import timezone

from .models import Contract, ContractAmendment, ContractTypeConfig, Employee, Notification
from .permissions import (
    ROLE_ADMIN, ROLE_EMPLOYE, ROLE_GESTIONNAIRE, ROLE_MANAGER, get_user_role,
)
from .utils import log_action, notify_employee, notify_manager

DEFAULT_CONTRACT_TYPES = [
    ('CDI', 'CDI'),
    ('CDD', 'CDD'),
    ('Stage', 'Stage'),
    ('Consultant', 'Consultant'),
    ('Freelance', 'Freelance'),
    ('Intérim', 'Intérim'),
    ('Prestataire externe', 'Prestataire externe'),
]

# Alias rétrocompatibilité seed
_TYPE_ALIASES = {
    'Contrat de stage': 'Stage',
    'Contrat de consultant': 'Consultant',
    'Contrat temporaire': 'CDD',
    'Contrat à temps partiel': 'CDD',
    'Contrat freelance': 'Freelance',
    'Apprentissage': 'Stage',
}

DEFAULT_BENEFIT_TYPES = [
    'Transport', 'Logement', 'Téléphone', 'Internet',
    'Assurance santé', 'Véhicule', 'Prime spéciale',
]

LIFECYCLE_LABELS = {
    'ACTIVE': 'Actif',
    'EXPIRING_SOON': 'Expirant bientôt',
    'EXPIRED': 'Expiré',
    'TERMINATED': 'Résilié',
}


def seed_contract_types():
    for i, (code, label) in enumerate(DEFAULT_CONTRACT_TYPES):
        ContractTypeConfig.objects.get_or_create(code=code, defaults={'label': label, 'display_order': i})


def get_active_contract_types():
    seed_contract_types()
    return list(ContractTypeConfig.objects.filter(is_active=True).values('code', 'label'))


def generate_contract_number(employee):
    year = timezone.now().year
    mat = (employee.matricule or 'EMP00000').replace(' ', '')
    seq = Contract.objects.filter(employee=employee, contract_number__contains=str(year)).count() + 1
    return f'CTR-{mat}-{year}-{seq:03d}'


def filter_contracts_for_user(user, qs=None):
    qs = qs or Contract.objects.select_related('employee', 'employee__department', 'employee__manager')
    role = get_user_role(user)
    if role in (ROLE_ADMIN, ROLE_GESTIONNAIRE):
        return qs
    if role == ROLE_MANAGER:
        emp = getattr(user.profile, 'employee', None)
        if not emp:
            return qs.none()
        return qs.filter(Q(employee__manager=emp) | Q(employee=emp))
    if role == ROLE_EMPLOYE:
        emp = getattr(user.profile, 'employee', None)
        if not emp:
            return qs.none()
        return qs.filter(employee=emp)
    return qs


def user_can_write_contract(user, contract=None):
    role = get_user_role(user)
    if role == ROLE_ADMIN:
        return True
    if role == ROLE_GESTIONNAIRE:
        if contract and contract.is_locked:
            return False
        return True
    return False


def user_can_delete_contract(user, contract):
    role = get_user_role(user)
    if contract.is_locked or contract.status in ('LOCKED', 'SIGNED'):
        return role == ROLE_ADMIN
    if role in (ROLE_ADMIN, ROLE_GESTIONNAIRE):
        return True
    return False


def ensure_contract_editable(contract):
    if contract.is_locked or contract.status in ('LOCKED', 'CANCELLED', 'ARCHIVED'):
        from rest_framework.exceptions import ValidationError
        raise ValidationError('Ce contrat est verrouillé et ne peut plus être modifié. Créez un avenant.')


def apply_contract_signatures(contract, role, data, user):
    now = timezone.now()
    signature = data.get('signature', data.get('signatory_name', ''))
    if role == 'employee':
        contract.employee_signed_at = now
        contract.employee_signature = signature or contract.employee.full_name
    elif role == 'hr':
        contract.hr_signed_at = now
        contract.hr_signatory_name = data.get('signatory_name', '')
        contract.hr_signature = signature or contract.hr_signatory_name
    elif role == 'direction':
        contract.direction_signed_at = now
        contract.direction_signatory_name = data.get('signatory_name', '')
        contract.direction_signature = signature or contract.direction_signatory_name
    else:
        from rest_framework.exceptions import ValidationError
        raise ValidationError('Rôle de signature invalide.')

    if contract.employee_signed_at or contract.hr_signed_at or contract.direction_signed_at:
        if contract.status == 'DRAFT':
            contract.status = 'PENDING_SIGNATURE'

    if contract.is_fully_signed:
        contract.status = 'LOCKED'
        contract.is_locked = True
        contract.is_active = True
        emp = contract.employee
        emp.contract_type = contract.contract_type[:20] if len(contract.contract_type) <= 20 else contract.contract_type[:20]
        if contract.salary_base:
            emp.salary_base = contract.salary_base
        emp.save(update_fields=['contract_type', 'salary_base'])

    contract.save()
    log_action(user, f'Signature contrat ({role})', 'Contrats', contract.contract_number)
    return contract


def cancel_contract(contract, user, reason=''):
    ensure_contract_editable(contract) if not contract.is_locked else None
    contract.status = 'CANCELLED'
    contract.cancelled_at = timezone.now()
    contract.is_active = False
    if reason:
        contract.other_clauses = f"{contract.other_clauses}\n[Annulation] {reason}".strip()
    contract.save()
    log_action(user, 'Annulation contrat', 'Contrats', contract.contract_number, new_value=reason)
    return contract


def archive_contract(contract, user):
    contract.status = 'ARCHIVED'
    contract.archived_at = timezone.now()
    contract.is_active = False
    contract.save()
    log_action(user, 'Archivage contrat', 'Contrats', contract.contract_number)
    return contract


def renew_contract(contract, user, data):
    ensure_contract_editable(contract) if contract.is_locked else None
    archive_contract(contract, user)
    new_data = {
        'employee': contract.employee_id,
        'contract_type': data.get('contract_type', contract.contract_type),
        'start_date': data.get('start_date'),
        'end_date': data.get('end_date', contract.end_date),
        'salary_base': data.get('salary_base', contract.salary_base),
        'position_title': data.get('position_title', contract.position_title or contract.employee.position),
        'parent_contract': contract,
    }
    return new_data


def build_contract_dashboard(qs):
    today = timezone.now().date()
    soon = today + timedelta(days=90)
    return {
        'total': qs.count(),
        'cdi': qs.filter(contract_type__icontains='CDI').count(),
        'cdd': qs.filter(contract_type__icontains='CDD').count(),
        'expiring_soon': qs.filter(
            is_active=True, end_date__isnull=False, end_date__gte=today, end_date__lte=soon,
        ).count(),
        'renewed': qs.filter(parent_contract__isnull=False).count(),
        'signed': qs.filter(status__in=['SIGNED', 'LOCKED']).count(),
        'pending_signature': qs.filter(status='PENDING_SIGNATURE').count(),
        'by_status': list(qs.values('status').annotate(count=Count('id'))),
        'by_type': list(qs.values('contract_type').annotate(count=Count('id')).order_by('-count')[:8]),
    }


def compute_lifecycle_status(contract, today=None):
    """Statut métier : Actif, Expirant bientôt, Expiré, Résilié."""
    today = today or timezone.now().date()
    if contract.status in ('CANCELLED',) or contract.cancelled_at:
        return 'TERMINATED'
    if contract.status == 'ARCHIVED' and not contract.is_active:
        if contract.end_date and contract.end_date < today:
            return 'EXPIRED'
        return 'TERMINATED'
    if contract.end_date:
        if contract.end_date < today:
            return 'EXPIRED'
        if contract.end_date <= today + timedelta(days=90):
            return 'EXPIRING_SOON'
    if contract.is_active or contract.status in ('SIGNED', 'LOCKED', 'DRAFT', 'PENDING_SIGNATURE'):
        return 'ACTIVE'
    return 'TERMINATED'


def export_filename(contract, ext):
    from .contract_builder import slug_employee_name
    mat = (contract.employee.matricule or 'EMP00000').replace(' ', '')
    name_part = slug_employee_name(contract.employee.full_name)
    ctype = (contract.contract_type or 'CTR').replace(' ', '_').upper()
    return f'CONTRAT_{mat}_{name_part}_{ctype}.{ext}'


def log_contract_archive(contract, action, user=None, note='', file_obj=None, metadata=None):
    from .models import ContractArchiveLog
    log = ContractArchiveLog.objects.create(
        contract=contract,
        action=action,
        user=user if user and user.is_authenticated else None,
        note=note or '',
        metadata=metadata or {},
    )
    if file_obj:
        log.file_snapshot = file_obj
        log.save(update_fields=['file_snapshot'])
    return log


def import_contract_document(employee, uploaded_file, user, description='', contract_type='CDI', start_date=None):
    """Importe un document contrat (PDF, DOCX, image) et le lie à l'employé."""
    from datetime import date as date_cls
    from .models import Contract
    now = timezone.now()
    start = now.date()
    if start_date:
        if isinstance(start_date, str):
            try:
                start = date_cls.fromisoformat(start_date[:10])
            except ValueError:
                start = now.date()
        else:
            start = start_date
    contract = Contract.objects.create(
        employee=employee,
        contract_number=generate_contract_number(employee),
        contract_type=contract_type,
        start_date=start,
        position_title=employee.position,
        salary_base=employee.salary_base,
        import_description=description,
        imported_at=now,
        imported_by=user if user and user.is_authenticated else None,
        source='IMPORTED',
        status='LOCKED',
        is_active=True,
        file=uploaded_file,
    )
    log_contract_archive(
        contract, 'IMPORT', user,
        note=description or f'Import {uploaded_file.name}',
        metadata={'filename': uploaded_file.name},
    )
    log_action(user, 'Import document contrat', 'Contrats', contract.contract_number)
    return contract


def notify_rh_staff(title, message, notification_type='contract_expiring'):
    """Notifie les profils RH (admin / gestionnaire) liés à un employé."""
    from .models import UserProfile
    from .permissions import ROLE_ADMIN, ROLE_GESTIONNAIRE
    profiles = UserProfile.objects.filter(
        role__code__in=[ROLE_ADMIN, ROLE_GESTIONNAIRE],
        employee__isnull=False,
    ).select_related('employee')
    for p in profiles:
        if p.employee:
            notify_employee(p.employee, title, message, notification_type)


def notify_contract_expiry():
    """Alertes 90 / 30 jours avant expiration et le jour J."""
    today = timezone.now().date()
    thresholds = {90: 'Contrat expirant dans 90 jours', 30: 'Contrat expirant dans 30 jours', 0: 'Contrat expirant aujourd\'hui'}
    notified = 0
    for days, title_tpl in thresholds.items():
        target = today + timedelta(days=days)
        contracts = Contract.objects.filter(
            is_active=True, end_date=target,
            status__in=['SIGNED', 'LOCKED', 'PENDING_SIGNATURE', 'DRAFT'],
        ).select_related('employee', 'employee__manager')
        for c in contracts:
            title = title_tpl if days else title_tpl
            msg = f'Le contrat {c.contract_number} de {c.employee.full_name} expire le {c.end_date}.'
            notify_employee(c.employee, title, msg, 'contract_expiring')
            notify_rh_staff(title, msg, 'contract_expiring')
            if c.employee.manager:
                notify_manager(c.employee.manager, title, msg, 'contract_expiring')
            notified += 1
            try:
                if c.employee.email:
                    send_mail(title, msg, None, [c.employee.email], fail_silently=True)
            except Exception:
                pass
    return notified
