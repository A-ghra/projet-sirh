"""Services recrutement — conversion candidat → employé, comptes utilisateurs."""
import re
import secrets
import string
import unicodedata
from datetime import date

from django.conf import settings
from django.contrib.auth.models import User
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import Applicant, ApplicantBenefit, Contract, Employee, Position, Role, UserProfile


def slugify_username(value):
    value = unicodedata.normalize('NFKD', value or '').encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^a-zA-Z0-9._-]', '', value.lower().replace(' ', '.'))
    return value.strip('.') or 'employe'


def generate_username(prenom, nom):
    base = slugify_username(f"{prenom}.{nom}")
    username = base
    i = 1
    while User.objects.filter(username=username).exists():
        username = f"{base}{i}"
        i += 1
    return username


def generate_secure_password(length=10):
    alphabet = string.ascii_letters + string.digits + '@#$%&*'
    while True:
        pwd = ''.join(secrets.choice(alphabet) for _ in range(length))
        if (any(c.islower() for c in pwd) and any(c.isupper() for c in pwd)
                and any(c.isdigit() for c in pwd) and any(c in '@#$%&*' for c in pwd)):
            return pwd


def next_matricule():
    last = Employee.objects.filter(matricule__regex=r'^EMP\d+$').order_by('-matricule').first()
    if last:
        try:
            num = int(last.matricule.replace('EMP', '')) + 1
        except ValueError:
            num = Employee.objects.count() + 1
    else:
        num = Employee.objects.count() + 1
    return f"EMP{str(num).zfill(3)}"


def get_department_managers(department_id):
    """Responsables du département — filtrés par département uniquement."""
    if not department_id:
        return Employee.objects.none()
    qs = Employee.objects.filter(
        department_id=department_id, is_active=True, status='Active',
    ).select_related('department', 'position_ref')
    keywords = ('directeur', 'responsable', 'chef', 'manager', 'dsi', 'assistant')
    leaders = qs.filter(
        Q(subordinates__isnull=False)
        | Q(position__iregex=r'(directeur|responsable|chef|manager|dsi|assistant)')
    ).distinct()
    return leaders if leaders.exists() else qs.distinct()


def send_credentials_email(applicant, username, password, force_change=False):
    login_url = getattr(settings, 'FRONTEND_LOGIN_URL', 'http://127.0.0.1:5500/login.html')
    subject = 'Vos identifiants OTOMIA RH'
    body = (
        f"Bonjour {applicant.full_name},\n\n"
        f"Votre compte utilisateur OTOMIA RH a été créé.\n\n"
        f"Nom d'utilisateur : {username}\n"
        f"Mot de passe temporaire : {password}\n"
        f"Lien de connexion : {login_url}\n\n"
    )
    if force_change:
        body += "Vous devrez changer votre mot de passe à la première connexion.\n\n"
    body += "Cordialement,\nService RH — OTOMIA RH"
    try:
        send_mail(subject, body, None, [applicant.email], fail_silently=False)
        return True, None
    except Exception as exc:
        return False, str(exc)


@transaction.atomic
def convert_applicant_to_employee(applicant, user, send_email=True, force_password_change=True):
    """Transforme un candidat accepté en employé + contrat + compte utilisateur."""
    if applicant.status != 'ACCEPTED':
        raise ValueError('Seuls les candidats acceptés peuvent être intégrés.')
    if applicant.employee_id:
        raise ValueError('Ce candidat a déjà été intégré comme employé.')

    matricule = next_matricule()
    hire_date = applicant.contract_start or date.today()
    position_title = applicant.position or (
        applicant.position_ref.title if applicant.position_ref else 'Poste à définir'
    )

    employee = Employee.objects.create(
        matricule=matricule,
        nom=applicant.nom,
        postnom=applicant.postnom,
        prenom=applicant.prenom,
        full_name=applicant.full_name,
        gender=applicant.gender,
        date_of_birth=applicant.date_of_birth,
        nationality=applicant.nationality,
        civil_status=applicant.civil_status,
        email=applicant.email,
        phone_number=applicant.phone,
        address=applicant.address,
        department=applicant.department,
        manager=applicant.manager,
        position=position_title,
        position_ref=applicant.position_ref,
        contract_type=applicant.contract_type,
        hire_date=hire_date,
        salary_base=applicant.salary_base,
        photo=applicant.photo,
        status='Active',
        is_active=True,
        custom_data={
            'civility': applicant.civility,
            'children_count': applicant.children_count,
            'city': applicant.city,
            'province': applicant.province,
            'country': applicant.country,
            'postal_code': applicant.postal_code,
            'work_schedule': applicant.work_schedule,
            'work_days_per_week': applicant.work_days_per_week,
        },
    )

    benefits = [
        {'label': b.label, 'amount': str(b.amount), 'description': b.description}
        for b in applicant.benefits.all()
    ]
    from .contract_service import generate_contract_number
    Contract.objects.create(
        employee=employee,
        contract_number=generate_contract_number(employee),
        contract_type=applicant.contract_type,
        start_date=hire_date,
        end_date=applicant.contract_end,
        work_days_per_week=applicant.work_days_per_week,
        work_schedule=applicant.work_schedule,
        salary_base=applicant.salary_base or employee.salary_base,
        position_title=applicant.position or employee.position,
        benefits=benefits,
        status='DRAFT',
        is_active=True,
    )

    credentials = None
    if applicant.create_user_account:
        username = generate_username(applicant.prenom, applicant.nom)
        password = generate_secure_password()
        django_user = User.objects.create_user(
            username=username,
            email=applicant.email,
            password=password,
            first_name=applicant.prenom,
            last_name=applicant.nom,
        )
        role = Role.objects.filter(code=applicant.user_role).first()
        profile = UserProfile.objects.create(
            user=django_user,
            role=role,
            employee=employee,
            force_password_change=force_password_change,
        )
        employee.user = django_user
        employee.save(update_fields=['user'])
        credentials = {'username': username, 'password': password, 'role': applicant.user_role}
        if send_email:
            send_credentials_email(applicant, username, password, force_password_change)

    applicant.employee = employee
    applicant.converted_at = timezone.now()
    applicant.save(update_fields=['employee', 'converted_at'])

    return employee, credentials


def sync_applicant_benefits(applicant, benefits_data):
    """Remplace les avantages en nature d'un candidat."""
    ApplicantBenefit.objects.filter(applicant=applicant).delete()
    for item in benefits_data or []:
        label = (item.get('label') or '').strip()
        if not label:
            continue
        ApplicantBenefit.objects.create(
            applicant=applicant,
            label=label,
            amount=item.get('amount') or 0,
            description=item.get('description') or '',
        )


def search_applicants(queryset, q):
    q = (q or '').strip()
    if not q:
        return queryset
    return queryset.filter(
        Q(full_name__icontains=q)
        | Q(nom__icontains=q)
        | Q(prenom__icontains=q)
        | Q(email__icontains=q)
        | Q(phone__icontains=q)
        | Q(position__icontains=q)
        | Q(nationality__icontains=q)
        | Q(department__name__icontains=q)
        | Q(status__icontains=q)
    ).distinct()
