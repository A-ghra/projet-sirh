import os
import django
from datetime import date, timedelta

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'sirh_backend_project.settings')
django.setup()

from django.contrib.auth.models import User
from hr_app.models import (
    Role, UserProfile, CompanySettings, Department, Position, Employee,
    Recruitment, Applicant, Training, PerformanceReview, Absence, Attendance,
    Mission, Document, Notification, EmployeeTrainingResult,
    SkillCategory, Skill, EmployeeSkill, Certification, Objective, EmployeeKPI,
)

DEFAULT_PERMISSIONS = {
    'dashboard': {'read': True, 'write': False},
    'admin-personnel': {'read': True, 'write': True},
    'contrats': {'read': True, 'write': True},
    'paie': {'read': True, 'write': True},
    'presences': {'read': True, 'write': True},
    'recrutement': {'read': True, 'write': True},
    'formation': {'read': True, 'write': True},
    'performances': {'read': True, 'write': True},
    'portail-employe': {'read': True, 'write': True},
    'reporting': {'read': True, 'write': True},
    'parametres': {'read': True, 'write': True},
}

ROLE_PERMISSIONS = {
    'SUPER_ADMIN': DEFAULT_PERMISSIONS,
    'ADMIN_RH': DEFAULT_PERMISSIONS,
    'GESTIONNAIRE_RH': {
        'dashboard': {'read': True, 'write': False},
        'admin-personnel': {'read': True, 'write': True},
        'paie': {'read': True, 'write': False},
        'presences': {'read': True, 'write': True},
        'recrutement': {'read': True, 'write': True},
        'formation': {'read': True, 'write': True},
        'performances': {'read': True, 'write': True},
        'portail-employe': {'read': True, 'write': False},
        'reporting': {'read': True, 'write': True},
        'parametres': {'read': False, 'write': False},
    },
    'GESTIONNAIRE_PAIE': {
        'dashboard': {'read': True, 'write': False},
        'admin-personnel': {'read': True, 'write': False},
        'contrats': {'read': False, 'write': False},
        'paie': {'read': True, 'write': True},
        'presences': {'read': True, 'write': False},
        'recrutement': {'read': False, 'write': False},
        'formation': {'read': False, 'write': False},
        'performances': {'read': False, 'write': False},
        'portail-employe': {'read': False, 'write': False},
        'reporting': {'read': True, 'write': True},
        'parametres': {'read': False, 'write': False},
    },
    'RESPONSABLE_HIERARCHIQUE': {
        'dashboard': {'read': True, 'write': False},
        'admin-personnel': {'read': True, 'write': False},
        'contrats': {'read': True, 'write': False},
        'paie': {'read': False, 'write': False},
        'presences': {'read': True, 'write': True},
        'recrutement': {'read': True, 'write': False},
        'formation': {'read': True, 'write': False},
        'performances': {'read': True, 'write': True},
        'portail-employe': {'read': True, 'write': False},
        'reporting': {'read': True, 'write': False},
        'parametres': {'read': False, 'write': False},
    },
    'EMPLOYE': {
        'dashboard': {'read': True, 'write': False},
        'admin-personnel': {'read': False, 'write': False},
        'contrats': {'read': True, 'write': False},
        'paie': {'read': False, 'write': False},
        'presences': {'read': True, 'write': True},
        'recrutement': {'read': False, 'write': False},
        'formation': {'read': False, 'write': False},
        'performances': {'read': False, 'write': False},
        'portail-employe': {'read': True, 'write': True},
        'reporting': {'read': False, 'write': False},
        'parametres': {'read': False, 'write': False},
    },
}

ROLES = [
    ('SUPER_ADMIN', 'Super Administrateur', 'Contrôle total OTOMIA RH'),
    ('ADMIN_RH', 'Administrateur RH', 'Accès total au système'),
    ('GESTIONNAIRE_RH', 'Gestionnaire RH', 'Gestion employés et modules RH'),
    ('GESTIONNAIRE_PAIE', 'Gestionnaire Paie', 'Gestion paie et bulletins'),
    ('RESPONSABLE_HIERARCHIQUE', 'Responsable Hiérarchique', 'Validation congés et évaluations'),
    ('EMPLOYE', 'Employé', 'Accès portail employé'),
]

USERS = [
    ('admin', 'admin@otomia-rh.com', 'ADMIN_RH', 'Admin RH', None),
    ('gestionnaire', 'paie@otomia-rh.com', 'GESTIONNAIRE_RH', 'Gestionnaire Paie', None),
    ('manager', 'manager@otomia-rh.com', 'RESPONSABLE_HIERARCHIQUE', 'Responsable Hiérarchique', 'EMP003'),
    ('employe', 'employe@otomia-rh.com', 'EMPLOYE', 'Employé Démo', 'EMP001'),
]


def seed_db():
    print('=== Peuplement OTOMIA RH ===')
    role_map = {}
    for code, name, desc in ROLES:
        perms = ROLE_PERMISSIONS.get(code, {})
        role, created = Role.objects.get_or_create(
            code=code, defaults={'name': name, 'description': desc, 'permissions': perms}
        )
        if not created:
            role.permissions = perms
            role.save(update_fields=['permissions'])
        role_map[code] = role

    depts = {}
    for name in ['Direction', 'RH', 'IT', 'Finance', 'Commercial']:
        d, _ = Department.objects.get_or_create(name=name)
        depts[name] = d

    positions = ['Directeur RH', 'Gestionnaire Paie', 'Développeur', 'Comptable', 'Commercial']
    for title in positions:
        Position.objects.get_or_create(title=title, defaults={'department': depts['RH']})

    CompanySettings.objects.update_or_create(pk=1, defaults={
        'company_name': 'OTOMIA RH SARL',
        'company_acronym': 'OTOMIA RH',
        'company_slogan': 'Système Intelligent de Gestion des Ressources Humaines',
        'headquarters_address': 'Avenue du Commerce, Gombe, Kinshasa, RDC',
        'city': 'Kinshasa', 'province': 'Kinshasa', 'country': 'RDC', 'commune': 'Gombe',
        'rccm': 'CD/KIN/RCCM/24-B-00001', 'id_nat': '01-9-N12345K',
        'cnss_number': 'CNSS-001234567', 'phone_primary': '+243 81 000 00 00',
        'email': 'contact@otomia-rh.com', 'website': 'https://otomia-rh.com',
        'hr_manager_name': 'Marie Curie Mukendi', 'director_name': 'Directeur Général',
    })

    employees_data = [
        {'matricule': 'EMP001', 'nom': 'Dupont', 'postnom': 'Kabila', 'prenom': 'Jean', 'full_name': 'Jean Dupont Kabila',
         'position': 'Développeur', 'grade': 'Cadre', 'salary': 1500, 'dept': 'IT', 'gender': 'M',
         'cnss': 'CNSS-EMP001', 'fiscal': 'FISC-001'},
        {'matricule': 'EMP002', 'nom': 'Curie', 'postnom': 'Mukendi', 'prenom': 'Marie', 'full_name': 'Marie Curie Mukendi',
         'position': 'Gestionnaire Paie', 'grade': 'Cadre supérieur', 'salary': 2000, 'dept': 'RH', 'gender': 'F',
         'cnss': 'CNSS-EMP002', 'fiscal': 'FISC-002'},
        {'matricule': 'EMP003', 'nom': 'Martin', 'postnom': 'Tshilombo', 'prenom': 'Pierre', 'full_name': 'Pierre Martin Tshilombo',
         'position': 'Responsable Commercial', 'grade': 'Manager', 'salary': 1800, 'dept': 'Commercial', 'gender': 'M',
         'cnss': 'CNSS-EMP003', 'fiscal': 'FISC-003'},
        {'matricule': 'EMP004', 'nom': 'Lambert', 'postnom': 'Kasongo', 'prenom': 'Sophie', 'full_name': 'Sophie Lambert Kasongo',
         'position': 'Comptable', 'grade': 'Agent', 'salary': 1600, 'dept': 'Finance', 'gender': 'F',
         'cnss': 'CNSS-EMP004', 'fiscal': 'FISC-004'},
    ]
    emp_map = {}
    for data in employees_data:
        emp, _ = Employee.objects.get_or_create(
            matricule=data['matricule'],
            defaults={
                'nom': data['nom'], 'postnom': data['postnom'], 'prenom': data['prenom'],
                'full_name': data['full_name'], 'position': data['position'], 'grade': data['grade'],
                'salary_base': data['salary'], 'department': depts[data['dept']],
                'email': f"{data['matricule'].lower()}@otomia-rh.com",
                'gender': data['gender'], 'cnss_number': data['cnss'], 'fiscal_number': data['fiscal'],
                'phone_number': '+243 81 000 00 01', 'nationality': 'Congolaise',
                'emergency_contact_name': 'Contact Urgence', 'emergency_contact_phone': '+243 99 000 00 00',
                'hire_date': date.today() - timedelta(days=365),
            },
        )
        emp_map[data['matricule']] = emp

    emp_map['EMP001'].manager = emp_map['EMP003']
    emp_map['EMP001'].save()

    for username, email, role_code, full_name, matricule in USERS:
        user, created = User.objects.get_or_create(
            username=username,
            defaults={'email': email, 'first_name': full_name.split()[0], 'last_name': full_name.split()[-1] if ' ' in full_name else ''},
        )
        if created:
            user.set_password('otomia2026')
            user.save()
        employee = emp_map.get(matricule) if matricule else None
        UserProfile.objects.update_or_create(
            user=user,
            defaults={'role': role_map[role_code], 'employee': employee},
        )
        if employee and not employee.user:
            employee.user = user
            employee.save()

    Recruitment.objects.get_or_create(
        job_title='Développeur Full Stack',
        defaults={'description': 'Poste IT - Django/React', 'status': 'Open', 'department': depts['IT']},
    )
    rec = Recruitment.objects.first()
    if rec:
        Applicant.objects.get_or_create(
            recruitment=rec, email='candidat@email.com',
            defaults={'full_name': 'Alice Candidat', 'status': 'New', 'score': 75},
        )

    training, _ = Training.objects.get_or_create(
        title='Formation Django REST',
        defaults={
            'description': 'Formation interne API REST',
            'start_date': date.today(),
            'end_date': date.today() + timedelta(days=3),
            'cost': 500,
            'training_type': 'Internal',
            'instructor': 'Marie Curie Mukendi',
            'organization': 'OTOMIA Academy',
            'location': 'Salle de formation — Kinshasa',
            'status': 'InProgress',
        },
    )
    training.employees.add(emp_map['EMP001'])

    review, _ = PerformanceReview.objects.update_or_create(
        employee=emp_map['EMP001'],
        review_date=date.today(),
        defaults={
            'score': 85, 'star_rating': 4, 'evaluation_period': 'Semestre 1 2026',
            'department': depts['IT'], 'reviewer': emp_map['EMP003'],
            'comments': "L'employé atteint ses objectifs mensuels, démontre une excellente capacité d'adaptation.",
            'comments_strengths': 'Capacité d\'adaptation, respect des délais, esprit d\'équipe',
            'comments_weaknesses': 'Gestion documentaire à améliorer',
            'comments_recommendations': 'Suivre une formation en gestion documentaire',
            'comments_improvement': 'Organisation des dossiers et archivage',
            'comments_future_goals': 'Devenir lead technique sur le projet principal',
            'goals': 'Lead technique', 'status': 'Validated',
        },
    )
    review.save()

    SKILL_CATEGORIES = [
        ('Informatique', 'Compétences techniques et développement'),
        ('Ressources Humaines', 'Gestion du personnel'),
        ('Finance', 'Gestion financière'),
        ('Comptabilité', 'Comptabilité et fiscalité'),
        ('Gestion', 'Management et leadership'),
        ('Marketing', 'Communication et marketing'),
        ('Technique', 'Compétences techniques métier'),
        ('Communication', 'Communication interpersonnelle'),
    ]
    cat_map = {}
    for name, desc in SKILL_CATEGORIES:
        cat, _ = SkillCategory.objects.get_or_create(name=name, defaults={'description': desc})
        cat_map[name] = cat

    django_skill, _ = Skill.objects.get_or_create(
        category=cat_map['Informatique'], name='Django REST',
        defaults={'description': 'Développement API REST avec Django', 'required_level': 'intermediaire'},
    )
    EmployeeSkill.objects.get_or_create(
        employee=emp_map['EMP001'], skill=django_skill,
        defaults={'level': 'intermediaire', 'acquired_date': date.today() - timedelta(days=90)},
    )

    Certification.objects.get_or_create(
        employee=emp_map['EMP001'], title='Certificat Django REST',
        defaults={
            'issuing_organization': 'OTOMIA Academy',
            'issue_date': date.today() - timedelta(days=60),
            'expiry_date': date.today() + timedelta(days=45),
            'certificate_number': 'CERT-DJ-2026-001',
        },
    )

    Objective.objects.get_or_create(
        employee=emp_map['EMP001'], title='Finaliser le module SIRH',
        defaults={
            'description': 'Livrer le module performances et formation',
            'target_date': date.today() + timedelta(days=30),
            'priority': 'High', 'status': 'InProgress', 'progress_percent': 75,
        },
    )

    EmployeeKPI.objects.get_or_create(
        employee=emp_map['EMP001'], name='Chiffre d\'affaires généré',
        defaults={
            'description': 'CA mensuel sur les projets assignés',
            'current_value': 850000, 'target_value': 1000000, 'unit': 'FC',
        },
    )

    Absence.objects.get_or_create(
        employee=emp_map['EMP001'],
        start_date=date.today() + timedelta(days=30),
        end_date=date.today() + timedelta(days=35),
        defaults={'absence_type': 'CP', 'status': 'Pending', 'reason': 'Vacances été'},
    )

    for i in range(5):
        Attendance.objects.get_or_create(
            employee=emp_map['EMP001'],
            date=date.today() - timedelta(days=i),
            defaults={'status': 'Present' if i > 0 else 'Late', 'check_in': '08:00', 'check_out': '17:00'},
        )

    Mission.objects.get_or_create(
        employee=emp_map['EMP001'], title='Mission Lubumbashi',
        defaults={
            'destination': 'Lubumbashi', 'start_date': date.today() + timedelta(days=10),
            'end_date': date.today() + timedelta(days=12), 'status': 'Approved',
        },
    )

    EmployeeTrainingResult.objects.get_or_create(
        employee=emp_map['EMP001'], training=training,
        defaults={'score': 90, 'certification_obtained': 'Certificat Django REST', 'completed': True},
    )

    Notification.objects.get_or_create(
        employee=emp_map['EMP001'], title='Bienvenue sur OTOMIA RH',
        defaults={'message': 'Votre portail employé est actif.', 'notification_type': 'general'},
    )

    from hr_app.module_seed import seed_module_config
    from hr_app.models import SystemSettings
    seed_module_config()
    SystemSettings.get_settings()

    print('Base de données OTOMIA RH peuplée.')
    print('Utilisateurs initialisés. Les identifiants sont gérés en base Django uniquement.')


if __name__ == '__main__':
    seed_db()
