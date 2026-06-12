from datetime import time

from django.db import models
from django.utils import timezone
from django.contrib.auth.models import User


class Role(models.Model):
    ROLE_CHOICES = [
        ('SUPER_ADMIN', 'Super Administrateur'),
        ('ADMIN_RH', 'Administrateur RH'),
        ('GESTIONNAIRE_RH', 'Gestionnaire RH'),
        ('GESTIONNAIRE_PAIE', 'Gestionnaire Paie'),
        ('RESPONSABLE_HIERARCHIQUE', 'Responsable Hiérarchique'),
        ('EMPLOYE', 'Employé'),
    ]
    code = models.CharField(max_length=30, unique=True)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    permissions = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return self.name


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    role = models.ForeignKey(Role, on_delete=models.SET_NULL, null=True, blank=True)
    employee = models.OneToOneField(
        'Employee', on_delete=models.SET_NULL, null=True, blank=True, related_name='user_profile'
    )
    force_password_change = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.user.username} - {self.role}"


class Department(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True, null=True)
    parent = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='children')

    def __str__(self):
        return self.name


class Position(models.Model):
    title = models.CharField(max_length=100, unique=True)
    department = models.ForeignKey(
        Department, on_delete=models.SET_NULL, null=True, blank=True, related_name='positions'
    )
    description = models.TextField(blank=True, null=True)

    def __str__(self):
        return self.title


class CompanySettings(models.Model):
    """Configuration entreprise — utilisée dans tous les documents générés."""
    # Identité
    company_name = models.CharField(max_length=200, default='OTOMIA RH SARL')
    company_acronym = models.CharField(max_length=50, default='OTOMIA RH')
    company_slogan = models.CharField(max_length=255, default='Système Intelligent de Gestion des Ressources Humaines')
    company_description = models.TextField(blank=True, default='')
    # Légal
    rccm = models.CharField(max_length=80, default='CD/KIN/RCCM/24-B-00001')
    id_nat = models.CharField(max_length=50, default='01-9-N12345K')
    tax_number = models.CharField(max_length=50, blank=True, default='')
    cnss_number = models.CharField(max_length=50, default='CNSS-001234567')
    vat_number = models.CharField(max_length=50, blank=True, default='')
    approval_number = models.CharField(max_length=50, blank=True, default='')
    other_legal_refs = models.TextField(blank=True, default='')
    # Coordonnées
    postal_address = models.TextField(blank=True, default='')
    headquarters_address = models.TextField(default='Avenue du Commerce, Gombe, Kinshasa, RDC')
    commune = models.CharField(max_length=100, blank=True, default='Gombe')
    city = models.CharField(max_length=100, default='Kinshasa')
    province = models.CharField(max_length=100, default='Kinshasa')
    country = models.CharField(max_length=100, default='RDC')
    phone_primary = models.CharField(max_length=30, default='+243 81 000 00 00')
    phone_secondary = models.CharField(max_length=30, blank=True, default='')
    email = models.EmailField(default='contact@otomia-rh.com')
    website = models.URLField(blank=True, default='')
    # Administratif
    publisher = models.CharField(max_length=200, blank=True, default='OTOMIA RH SARL')
    billing_department = models.CharField(max_length=100, blank=True, default='Facturation')
    hr_department = models.CharField(max_length=100, default='Ressources Humaines')
    payroll_department = models.CharField(max_length=100, default='Service Paie')
    hr_manager_name = models.CharField(max_length=100, blank=True, default='Responsable RH')
    payroll_manager_name = models.CharField(max_length=100, blank=True, default='Responsable Paie')
    director_name = models.CharField(max_length=100, blank=True, default='Directeur Général')
    # Logo
    logo = models.ImageField(upload_to='company/', blank=True, null=True)
    logo_url = models.URLField(blank=True, default='')
    logo_max_size_mb = models.DecimalField(max_digits=4, decimal_places=1, default=2.0)
    # Bulletins de paie
    bulletin_title = models.CharField(max_length=100, default='BULLETIN DE PAIE')
    bulletin_prefix = models.CharField(max_length=50, default='BULLETIN DE PAIE N°')
    bulletin_number_format = models.CharField(max_length=50, default='BP-{year}-{num:04d}')
    bulletin_footer = models.TextField(default='Document généré automatiquement par OTOMIA RH.')
    bulletin_qr_enabled = models.BooleanField(default=True)
    bulletin_signature_enabled = models.BooleanField(default=True)
    bulletin_stamp_enabled = models.BooleanField(default=True)
    inpp_enabled = models.BooleanField(default=True, help_text='Activer la retenue INPP sur les bulletins')
    # Rapports RH
    report_title = models.CharField(max_length=100, default='RAPPORT RH')
    report_subtitle = models.CharField(max_length=200, default='Rapport statistique des ressources humaines')
    report_header = models.CharField(max_length=200, blank=True, default='')
    report_footer = models.CharField(max_length=200, default='Document confidentiel')
    report_author = models.CharField(max_length=100, default='Administrateur RH')
    report_number_format = models.CharField(max_length=50, default='RPT-{year}-{num:04d}')
    report_logo_enabled = models.BooleanField(default=True)
    # Legacy (rétrocompatibilité exports)
    address = models.TextField(blank=True, default='')
    cnss_affiliation = models.CharField(max_length=50, blank=True, default='')
    phone = models.CharField(max_length=30, blank=True, default='')
    logo_text = models.CharField(max_length=50, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'Paramètres entreprise'

    def save(self, *args, **kwargs):
        self.address = self.headquarters_address
        self.cnss_affiliation = self.cnss_number
        self.phone = self.phone_primary
        self.logo_text = self.company_acronym
        if not self.report_header:
            self.report_header = self.company_name
        if not self.publisher:
            self.publisher = self.company_name
        super().save(*args, **kwargs)

    def bulletin_number(self, payroll_id, year=None):
        year = year or timezone.now().year
        return self.bulletin_number_format.format(year=year, num=payroll_id)

    @property
    def logo_display_url(self):
        if self.logo:
            return self.logo.url
        return self.logo_url or ''

    @classmethod
    def get_settings(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return self.company_name


class WorkScheduleSettings(models.Model):
    """Paramètres horaires de travail — impact sur le calcul de paie."""
    LATE_DEDUCTION_CHOICES = [
        ('NONE', 'Aucune retenue'),
        ('AUTO', 'Retenue automatique'),
    ]
    work_start = models.TimeField(default=time(8, 0))
    work_end = models.TimeField(default=time(17, 0))
    lunch_break_minutes = models.IntegerField(default=60)
    hours_per_day = models.DecimalField(max_digits=4, decimal_places=2, default=8.00)
    hours_per_week = models.DecimalField(max_digits=5, decimal_places=2, default=40.00)
    working_days_per_week = models.IntegerField(default=5)
    monthly_hours = models.DecimalField(max_digits=6, decimal_places=2, default=208.00)
    overtime_rate_weekday = models.DecimalField(max_digits=4, decimal_places=2, default=1.25)
    overtime_rate_weekend = models.DecimalField(max_digits=4, decimal_places=2, default=1.50)
    overtime_rate_holiday = models.DecimalField(max_digits=4, decimal_places=2, default=2.00)
    late_deduction_mode = models.CharField(
        max_length=10, choices=LATE_DEDUCTION_CHOICES, default='NONE',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'Horaires de travail'

    @classmethod
    def get_settings(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return 'Horaires de travail'


class PresenceAbsenceSettings(models.Model):
    """Paramètres de détection automatique des absences."""
    PAYROLL_RULE_CHOICES = [
        ('justified', 'Absence justifiée'),
        ('unjustified', 'Absence non justifiée (déduction)'),
        ('no_impact', 'Sans impact salarial'),
    ]
    auto_absence_enabled = models.BooleanField(default=True)
    cutoff_time = models.TimeField(default=time(18, 0))
    notify_internal = models.BooleanField(default=True)
    notify_email = models.BooleanField(default=True)
    notify_dashboard = models.BooleanField(default=True)
    payroll_impact_rule = models.CharField(
        max_length=20, choices=PAYROLL_RULE_CHOICES, default='unjustified',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'Paramètres absences automatiques'

    @classmethod
    def get_settings(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return 'Paramètres absences automatiques'


class SystemSettings(models.Model):
    """Paramètres système globaux OTOMIA RH."""
    CURRENCY_CHOICES = [('USD', 'USD'), ('CDF', 'CDF')]
    DATE_FORMAT_CHOICES = [
        ('DD/MM/YYYY', 'JJ/MM/AAAA'),
        ('MM/DD/YYYY', 'MM/JJ/AAAA'),
        ('YYYY-MM-DD', 'AAAA-MM-JJ'),
    ]
    LANGUAGE_CHOICES = [('fr', 'Français'), ('en', 'English')]
    EXPORT_FORMAT_CHOICES = [('pdf', 'PDF'), ('excel', 'Excel'), ('word', 'Word')]

    default_currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default='USD')
    date_format = models.CharField(max_length=20, choices=DATE_FORMAT_CHOICES, default='DD/MM/YYYY')
    timezone = models.CharField(max_length=50, default='Africa/Kinshasa')
    language = models.CharField(max_length=5, choices=LANGUAGE_CHOICES, default='fr')
    export_format = models.CharField(max_length=10, choices=EXPORT_FORMAT_CHOICES, default='pdf')
    system_version = models.CharField(max_length=30, default='OTOMIA RH 2026.1')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'Paramètres système'

    @classmethod
    def get_settings(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return 'Paramètres système'


class SystemBackup(models.Model):
    """Historique des sauvegardes."""
    filename = models.CharField(max_length=200)
    file_path = models.CharField(max_length=300)
    size_kb = models.DecimalField(max_digits=10, decimal_places=1, default=0)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    notes = models.CharField(max_length=255, blank=True, default='')

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.filename


class Employee(models.Model):
    CONTRACT_CHOICES = [
        ('CDI', 'Contrat à Durée Indéterminée'),
        ('CDD', 'Contrat à Durée Déterminée'),
        ('Stage', 'Stage'),
        ('Consultant', 'Consultant'),
        ('Freelance', 'Freelance'),
        ('Intérim', 'Intérim'),
    ]
    STATUS_CHOICES = [
        ('Active', 'Actif'),
        ('Archived', 'Archivé'),
        ('On Leave', 'En congé'),
    ]
    GENDER_CHOICES = [
        ('M', 'Homme'),
        ('F', 'Femme'),
        ('O', 'Autre'),
    ]
    CIVIL_STATUS_CHOICES = [
        ('Célibataire', 'Célibataire'),
        ('Marié(e)', 'Marié(e)'),
        ('Divorcé(e)', 'Divorcé(e)'),
        ('Veuf(ve)', 'Veuf(ve)'),
    ]

    user = models.OneToOneField(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='employee_profile')
    matricule = models.CharField(max_length=20, unique=True)
    nom = models.CharField(max_length=100, default='')
    postnom = models.CharField(max_length=100, blank=True, default='')
    prenom = models.CharField(max_length=100, default='')
    full_name = models.CharField(max_length=200)
    contract_type = models.CharField(max_length=20, choices=CONTRACT_CHOICES, default='CDI')
    position = models.CharField(max_length=100, default='Poste à définir')
    grade = models.CharField(max_length=50, blank=True, default='')
    position_ref = models.ForeignKey(Position, on_delete=models.SET_NULL, null=True, blank=True, related_name='employees')
    department = models.ForeignKey(Department, on_delete=models.SET_NULL, related_name='employees', null=True, blank=True)
    hire_date = models.DateField(default=timezone.now)
    salary_base = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    email = models.EmailField(unique=True, null=True, blank=True)
    phone_number = models.CharField(max_length=20, blank=True, null=True)
    address = models.TextField(blank=True, null=True)
    date_of_birth = models.DateField(blank=True, null=True)
    nationality = models.CharField(max_length=50, default='Congolaise')
    social_security_number = models.CharField(max_length=50, unique=True, blank=True, null=True)
    cnss_number = models.CharField(max_length=50, blank=True, null=True)
    fiscal_number = models.CharField(max_length=50, blank=True, null=True)
    gender = models.CharField(max_length=1, choices=GENDER_CHOICES, default='M')
    civil_status = models.CharField(max_length=20, choices=CIVIL_STATUS_CHOICES, default='Célibataire')
    emergency_contact_name = models.CharField(max_length=100, blank=True, default='')
    emergency_contact_phone = models.CharField(max_length=30, blank=True, default='')
    leave_balance = models.DecimalField(max_digits=5, decimal_places=1, default=25.0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Active')
    is_active = models.BooleanField(default=True)
    photo = models.ImageField(upload_to='employees/', blank=True, null=True)
    manager = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='subordinates')
    custom_data = models.JSONField(default=dict, blank=True)

    def save(self, *args, **kwargs):
        if self.nom or self.prenom:
            parts = [self.prenom, self.nom, self.postnom]
            self.full_name = ' '.join(p for p in parts if p).strip() or self.full_name
        if not self.cnss_number and self.social_security_number:
            self.cnss_number = self.social_security_number
        super().save(*args, **kwargs)

    @property
    def seniority_years(self):
        delta = timezone.now().date() - self.hire_date
        return round(delta.days / 365.25, 1)

    def __str__(self):
        return f"{self.full_name} ({self.matricule})"


class EmployeeMovement(models.Model):
    MOVEMENT_TYPES = [
        ('Promotion', 'Promotion'),
        ('Mutation', 'Mutation'),
        ('Departure', 'Départ'),
        ('Affectation', 'Affectation'),
    ]
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='movements')
    movement_type = models.CharField(max_length=20, choices=MOVEMENT_TYPES)
    previous_value = models.CharField(max_length=255)
    new_value = models.CharField(max_length=255)
    date = models.DateField(default=timezone.now)
    reason = models.TextField(blank=True, null=True)

    def __str__(self):
        return f"{self.employee.full_name} - {self.movement_type}"


class ContractTypeConfig(models.Model):
    """Types de contrat configurables par l'administrateur RH."""
    code = models.CharField(max_length=50, unique=True)
    label = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)
    display_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['display_order', 'label']

    def __str__(self):
        return self.label


class Contract(models.Model):
    STATUS_CHOICES = [
        ('DRAFT', 'Brouillon'),
        ('PENDING_SIGNATURE', 'En attente de signature'),
        ('SIGNED', 'Signé'),
        ('LOCKED', 'Verrouillé'),
        ('CANCELLED', 'Annulé'),
        ('ARCHIVED', 'Archivé'),
    ]
    CURRENCY_CHOICES = [('USD', 'USD'), ('CDF', 'CDF')]

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='contracts')
    contract_number = models.CharField(max_length=50, unique=True, blank=True)
    contract_type = models.CharField(max_length=50)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='DRAFT')
    start_date = models.DateField()
    end_date = models.DateField(blank=True, null=True)
    duration_months = models.PositiveSmallIntegerField(blank=True, null=True)
    probation_end_date = models.DateField(blank=True, null=True)
    assignment_location = models.CharField(max_length=200, blank=True, default='')
    job_description = models.TextField(blank=True, default='')
    position_title = models.CharField(max_length=150, blank=True, default='')

    salary_base = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    transport_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    housing_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    responsibility_bonus = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    indemnities = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    benefits_in_kind = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default='USD')

    work_days_per_week = models.PositiveSmallIntegerField(default=5, blank=True, null=True)
    work_schedule = models.CharField(max_length=100, blank=True, default='08h00 - 17h00')
    annual_leave_days = models.DecimalField(max_digits=5, decimal_places=1, default=25)
    overtime_clause = models.TextField(blank=True, default='')
    special_clauses = models.TextField(blank=True, default='')

    employee_obligations = models.TextField(blank=True, default='')
    employer_obligations = models.TextField(blank=True, default='')
    confidentiality_clause = models.TextField(blank=True, default='')
    non_compete_clause = models.TextField(blank=True, default='')
    termination_conditions = models.TextField(blank=True, default='')
    renewal_conditions = models.TextField(blank=True, default='')
    other_clauses = models.TextField(blank=True, default='')

    employee_signed_at = models.DateTimeField(blank=True, null=True)
    employee_signature = models.TextField(blank=True, default='')
    hr_signed_at = models.DateTimeField(blank=True, null=True)
    hr_signatory_name = models.CharField(max_length=150, blank=True, default='')
    hr_signature = models.TextField(blank=True, default='')
    direction_signed_at = models.DateTimeField(blank=True, null=True)
    direction_signatory_name = models.CharField(max_length=150, blank=True, default='')
    direction_signature = models.TextField(blank=True, default='')

    benefits = models.JSONField(default=list, blank=True)
    file = models.FileField(upload_to='contracts/', blank=True, null=True)
    import_description = models.TextField(blank=True, default='')
    imported_at = models.DateTimeField(blank=True, null=True)
    imported_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name='contracts_imported',
    )
    source = models.CharField(
        max_length=20,
        choices=[('MANUAL', 'Manuel'), ('IMPORTED', 'Importé'), ('GENERATED', 'Généré')],
        default='MANUAL',
    )
    is_active = models.BooleanField(default=True)
    is_locked = models.BooleanField(default=False)
    archived_at = models.DateTimeField(blank=True, null=True)
    cancelled_at = models.DateTimeField(blank=True, null=True)
    parent_contract = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True, related_name='renewals',
    )
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name='contracts_created',
    )
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-start_date', '-id']

    def __str__(self):
        return f"Contrat {self.contract_type} - {self.employee.full_name}"

    @property
    def is_fully_signed(self):
        return bool(self.employee_signed_at and self.hr_signed_at and self.direction_signed_at)


class ContractAmendment(models.Model):
    STATUS_CHOICES = Contract.STATUS_CHOICES
    contract = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name='amendments')
    amendment_number = models.CharField(max_length=50)
    effective_date = models.DateField()
    description = models.TextField(blank=True, default='')
    salary_base = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)
    position_title = models.CharField(max_length=150, blank=True, default='')
    end_date = models.DateField(blank=True, null=True)
    clauses = models.TextField(blank=True, default='')
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='DRAFT')
    employee_signed_at = models.DateTimeField(blank=True, null=True)
    hr_signed_at = models.DateTimeField(blank=True, null=True)
    file = models.FileField(upload_to='contracts/amendments/', blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-effective_date', '-id']
        unique_together = ('contract', 'amendment_number')

    def __str__(self):
        return f"Avenant {self.amendment_number} — {self.contract}"


class ContractDownloadLog(models.Model):
    contract = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name='download_logs')
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    format = models.CharField(max_length=10, default='pdf')
    downloaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-downloaded_at']


class ContractArchiveLog(models.Model):
    """Historique des actions et versions sur les contrats."""
    ACTION_CHOICES = [
        ('CREATE', 'Création'),
        ('IMPORT', 'Importation'),
        ('EXPORT', 'Exportation'),
        ('UPDATE', 'Modification'),
        ('DELETE', 'Suppression'),
        ('ARCHIVE', 'Archivage'),
        ('VERSION', 'Version'),
    ]
    contract = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name='archive_logs')
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    note = models.TextField(blank=True, default='')
    file_snapshot = models.FileField(upload_to='contracts/archive/', blank=True, null=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class Payroll(models.Model):
    STATUS_CHOICES = [
        ('DRAFT', 'Brouillon'),
        ('PENDING', 'En attente de validation'),
        ('VALIDATED', 'Validé'),
        ('PAID', 'Payé'),
        ('ARCHIVED', 'Archivé'),
    ]
    CURRENCY_CHOICES = [
        ('USD', 'Dollar (USD)'),
        ('CDF', 'Franc congolais (CDF)'),
    ]
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='payrolls')
    month = models.DateField()
    currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default='USD')
    # Période
    days_working = models.IntegerField(default=22)
    days_worked = models.IntegerField(default=22)
    days_absent = models.IntegerField(default=0)
    days_leave = models.IntegerField(default=0)
    overtime_hours = models.DecimalField(max_digits=8, decimal_places=2, default=0.00)
    overtime_rate = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    issued_at = models.DateTimeField(blank=True, null=True)
    generated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name='generated_payrolls'
    )
    verification_hash = models.CharField(max_length=64, blank=True, default='')
    # Gains
    salary_base = models.DecimalField(max_digits=12, decimal_places=2)
    prime_fonction = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    prime_responsabilite = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    prime_rendement = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    prime_risque = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    prime_transport = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    prime_logement = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    prime_communication = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    prime_representation = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    prime_anciennete = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    indemnite_fonction = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    indemnite_speciale = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    heures_supplementaires = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    gratifications = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    bonus_exceptionnel = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    avantages_nature = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    autres_indemnites = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    # Totaux gains
    total_primes = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    total_indemnites = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    gross_salary = models.DecimalField(max_digits=12, decimal_places=2)
    taxable_salary = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    # Retenues
    inpp = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    cnss_salarie = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    irpp = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    assurance_sante = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    avances_salaire = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    prets_internes = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    absences_non_justifiees = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    retenues_disciplinaires = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    cotisations_syndicales = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    autres_retenues = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    total_retenues = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    net_salary = models.DecimalField(max_digits=12, decimal_places=2)
    # Historique congés / absences (snapshot bulletin)
    leave_balance_previous = models.DecimalField(max_digits=5, decimal_places=1, default=0.0)
    leave_taken = models.DecimalField(max_digits=5, decimal_places=1, default=0.0)
    leave_balance_current = models.DecimalField(max_digits=5, decimal_places=1, default=0.0)
    absence_late_count = models.IntegerField(default=0)
    absence_justified_days = models.IntegerField(default=0)
    absence_unjustified_days = models.IntegerField(default=0)
    # Temps de travail (Présences & Congés)
    days_mission = models.IntegerField(default=0)
    hours_normal = models.DecimalField(max_digits=8, decimal_places=2, default=0.00)
    hours_missing = models.DecimalField(max_digits=8, decimal_places=2, default=0.00)
    late_minutes = models.IntegerField(default=0)
    hourly_rate = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    retenues_retards = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    presence_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)
    # Legacy aliases (rétrocompatibilité)
    transport_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    housing_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    risk_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    other_allowances = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    iprp = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    cnss_worker = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    advances = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    other_deductions = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    validated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='validated_payrolls')
    payslip_pdf = models.FileField(upload_to='payslips/', blank=True, null=True)
    payslip_excel = models.FileField(upload_to='payslips/excel/', blank=True, null=True)
    payslip_word = models.FileField(upload_to='payslips/word/', blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('employee', 'month')

    def sync_legacy_fields(self):
        self.transport_allowance = self.prime_transport
        self.housing_allowance = self.prime_logement
        self.risk_allowance = self.prime_risque
        self.other_allowances = self.autres_indemnites
        self.iprp = self.irpp
        self.cnss_worker = self.cnss_salarie
        self.advances = self.avances_salaire
        self.other_deductions = self.autres_retenues

    def __str__(self):
        return f"Paie {self.employee.full_name} - {self.month.strftime('%m/%Y')}"


class PayrollCalculationLog(models.Model):
    payroll = models.ForeignKey(Payroll, on_delete=models.CASCADE, related_name='calculation_logs')
    field_name = models.CharField(max_length=80)
    old_value = models.CharField(max_length=100, blank=True, default='')
    new_value = models.CharField(max_length=100, blank=True, default='')
    calculated_value = models.CharField(max_length=100, blank=True, default='')
    performed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class Absence(models.Model):
    ABSENCE_TYPES = [
        ('CP', 'Congé Payé'),
        ('Maladie', 'Maladie'),
        ('RTT', 'RTT'),
        ('Mission', 'Mission'),
        ('Autre', 'Autre'),
    ]
    STATUS_CHOICES = [
        ('Pending', 'En attente'),
        ('Approved', 'Approuvé'),
        ('Rejected', 'Refusé'),
    ]
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='absences')
    absence_type = models.CharField(max_length=20, choices=ABSENCE_TYPES, default='CP')
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Pending')
    reason = models.TextField(blank=True, null=True)
    justification_file = models.FileField(upload_to='leave_justifications/', blank=True, null=True)
    validated_by = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True, related_name='validated_absences')

    @property
    def days_count(self):
        if self.start_date and self.end_date:
            return (self.end_date - self.start_date).days + 1
        return 0

    def __str__(self):
        return f"Absence {self.employee.full_name} ({self.start_date} au {self.end_date})"


class Attendance(models.Model):
    STATUS_CHOICES = [
        ('Present', 'Présent'),
        ('Late', 'Retard'),
        ('Absent', 'Absent'),
    ]
    EVENT_TYPE_CHOICES = [
        ('presence', 'Présence'),
        ('absence', 'Absence'),
        ('leave', 'Congé'),
        ('mission', 'Mission'),
    ]
    RECORD_SOURCE_CHOICES = [
        ('manual', 'Manuel'),
        ('auto', 'Automatique'),
    ]
    ABSENCE_WORKFLOW_CHOICES = [
        ('pending_validation', 'En attente de validation'),
        ('confirmed', 'Confirmée'),
        ('regularized', 'Régularisée'),
        ('contested', 'Contestée'),
    ]
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='attendances')
    date = models.DateField()
    check_in = models.TimeField(blank=True, null=True)
    check_out = models.TimeField(blank=True, null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Present')
    event_type = models.CharField(max_length=20, choices=EVENT_TYPE_CHOICES, default='presence')
    notes = models.TextField(blank=True, null=True)
    record_source = models.CharField(max_length=10, choices=RECORD_SOURCE_CHOICES, default='manual')
    absence_workflow_status = models.CharField(
        max_length=30, choices=ABSENCE_WORKFLOW_CHOICES, blank=True, null=True,
    )
    generated_at = models.DateTimeField(blank=True, null=True)
    responsible_manager = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='managed_auto_absences',
    )
    justification_file = models.FileField(upload_to='absence_justifications/', blank=True, null=True)
    justification_note = models.TextField(blank=True, default='')

    class Meta:
        unique_together = ('employee', 'date')

    def __str__(self):
        return f"{self.employee.full_name} - {self.date}"


class AbsenceAlert(models.Model):
    """Alerte manager avant création automatique d'une absence."""
    STATUS_CHOICES = [
        ('pending', 'En attente'),
        ('regularized', 'Régularisée'),
        ('auto_created', 'Absence créée'),
    ]
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='absence_alerts')
    date = models.DateField()
    manager = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='team_absence_alerts',
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    notified_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(blank=True, null=True)
    attendance = models.ForeignKey(
        Attendance, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='source_alert',
    )

    class Meta:
        unique_together = ('employee', 'date')
        ordering = ['-date', '-id']

    def __str__(self):
        return f"Alerte {self.employee.full_name} — {self.date}"


class Mission(models.Model):
    STATUS_CHOICES = [
        ('PENDING_APPROVAL', 'En attente d\'approbation'),
        ('APPROVED', 'Approuvée'),
        ('IN_PROGRESS', 'En cours'),
        ('COMPLETED', 'Terminée'),
        ('CANCELLED', 'Annulée'),
        # Rétrocompatibilité
        ('Pending', 'En attente'),
        ('Approved', 'Approuvé'),
        ('Rejected', 'Refusé'),
        ('Completed', 'Terminé'),
    ]
    ACTIVE_STATUSES = ('APPROVED', 'IN_PROGRESS', 'COMPLETED', 'Approved', 'Completed')
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='missions')
    mission_number = models.CharField(max_length=50, blank=True, default='')
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    destination = models.CharField(max_length=200)
    city = models.CharField(max_length=100, blank=True, default='')
    province = models.CharField(max_length=100, blank=True, default='')
    country = models.CharField(max_length=100, blank=True, default='RDC')
    visited_organization = models.CharField(max_length=200, blank=True, default='')
    start_date = models.DateField()
    start_time = models.TimeField(blank=True, null=True)
    end_date = models.DateField()
    end_time = models.TimeField(blank=True, null=True)
    transport_mode = models.CharField(max_length=100, blank=True, default='')
    accommodation = models.CharField(max_length=150, blank=True, default='')
    advance_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    daily_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    budget_allocated = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    closure_summary = models.TextField(blank=True, default='')
    closure_results = models.TextField(blank=True, default='')
    closure_difficulties = models.TextField(blank=True, default='')
    closure_recommendations = models.TextField(blank=True, default='')
    actual_expenses = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    comments = models.TextField(blank=True, default='')
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='PENDING_APPROVAL')
    payroll_synced = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name='missions_created',
    )
    approved_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name='missions_approved',
    )
    closed_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-start_date', '-id']

    def __str__(self):
        return f"{self.title} - {self.employee.full_name}"


class MissionDocument(models.Model):
    DOC_TYPES = [
        ('order', 'Ordre de mission'),
        ('invitation', 'Invitation'),
        ('authorization', 'Autorisation'),
        ('ticket', 'Billet de transport'),
        ('receipt', 'Justificatif'),
        ('closure', 'Rapport de clôture'),
        ('other', 'Autre'),
    ]
    mission = models.ForeignKey(Mission, on_delete=models.CASCADE, related_name='documents')
    doc_type = models.CharField(max_length=30, choices=DOC_TYPES, default='other')
    label = models.CharField(max_length=200, blank=True, default='')
    file = models.FileField(upload_to='missions/')
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-uploaded_at']


class MissionAuditLog(models.Model):
    ACTION_CHOICES = [
        ('CREATE', 'Création'),
        ('UPDATE', 'Modification'),
        ('DELETE', 'Suppression'),
        ('APPROVE', 'Validation'),
        ('CANCEL', 'Annulation'),
        ('START', 'Démarrage'),
        ('CLOSE', 'Clôture'),
        ('EXPORT', 'Exportation'),
    ]
    mission = models.ForeignKey(Mission, on_delete=models.CASCADE, related_name='audit_logs')
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    note = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class PayrollExportLog(models.Model):
    """Historique des exports individuels de bulletins de paie."""
    FORMAT_CHOICES = [
        ('pdf', 'PDF'),
        ('excel', 'Excel'),
        ('word', 'Word'),
    ]
    payroll = models.ForeignKey(Payroll, on_delete=models.CASCADE, related_name='export_logs')
    format = models.CharField(max_length=10, choices=FORMAT_CHOICES)
    file_path = models.CharField(max_length=500)
    filename = models.CharField(max_length=255)
    exported_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    email_sent = models.BooleanField(default=False)
    email_recipient = models.EmailField(blank=True, default='')
    exported_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-exported_at']

    def __str__(self):
        return f"{self.filename} ({self.get_format_display()})"


class Document(models.Model):
    DOC_TYPES = [
        ('Contrat', 'Contrat de travail'),
        ('Avenant', 'Avenant'),
        ('Note', 'Note de service'),
        ('Attestation', 'Attestation'),
        ('Certificat', 'Certificat de travail'),
        ('Bulletin de paie', 'Bulletin de paie'),
        ('Autre', 'Autre'),
    ]
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='documents')
    title = models.CharField(max_length=200)
    document_type = models.CharField(max_length=20, choices=DOC_TYPES, default='Autre')
    file = models.FileField(upload_to='documents/')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.title} - {self.employee.full_name}"


class Notification(models.Model):
    NOTIF_TYPES = [
        ('payslip', 'Nouveau bulletin'),
        ('leave_approved', 'Congé validé'),
        ('leave_rejected', 'Congé refusé'),
        ('leave_pending', 'Demande de congé'),
        ('absence_alert', 'Alerte absence'),
        ('absence_auto', 'Absence automatique'),
        ('contract_expiring', 'Contrat expirant'),
        ('contract_signed', 'Contrat signé'),
        ('evaluation', 'Nouvelle évaluation'),
        ('training', 'Nouvelle formation'),
        ('document', 'Nouveau document RH'),
        ('general', 'Général'),
    ]
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='notifications')
    title = models.CharField(max_length=200)
    message = models.TextField()
    notification_type = models.CharField(max_length=20, choices=NOTIF_TYPES, default='general')
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.title} - {self.employee.full_name}"


class Recruitment(models.Model):
    STATUS_CHOICES = [
        ('Open', 'Ouvert'),
        ('Closed', 'Fermé'),
        ('On Hold', 'En attente'),
    ]
    job_title = models.CharField(max_length=200)
    description = models.TextField()
    department = models.ForeignKey(Department, on_delete=models.SET_NULL, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Open')
    posted_date = models.DateField(auto_now_add=True)

    def __str__(self):
        return self.job_title


class Applicant(models.Model):
    STATUS_CHOICES = [
        ('PENDING', 'En attente'),
        ('EVALUATING', 'En cours d\'évaluation'),
        ('INTERVIEW_SCHEDULED', 'Entretien programmé'),
        ('INTERVIEW_DONE', 'Entretien effectué'),
        ('ACCEPTED', 'Accepté'),
        ('REJECTED', 'Refusé'),
    ]
    CIVILITY_CHOICES = [
        ('M', 'Monsieur'),
        ('Mme', 'Madame'),
        ('Mlle', 'Mademoiselle'),
    ]
    GENDER_CHOICES = Employee.GENDER_CHOICES
    CIVIL_STATUS_CHOICES = Employee.CIVIL_STATUS_CHOICES
    USER_ROLE_CHOICES = [
        ('EMPLOYE', 'Employé'),
        ('RESPONSABLE_HIERARCHIQUE', 'Manager'),
        ('GESTIONNAIRE_RH', 'Responsable RH'),
        ('GESTIONNAIRE_PAIE', 'Gestionnaire Paie'),
        ('ADMIN_RH', 'Administrateur RH'),
    ]

    recruitment = models.ForeignKey(
        Recruitment, on_delete=models.SET_NULL, null=True, blank=True, related_name='applicants',
    )
    # Identité
    nom = models.CharField(max_length=100, default='')
    postnom = models.CharField(max_length=100, blank=True, default='')
    prenom = models.CharField(max_length=100, default='')
    full_name = models.CharField(max_length=200, blank=True, default='')
    civility = models.CharField(max_length=10, choices=CIVILITY_CHOICES, default='M')
    gender = models.CharField(max_length=1, choices=GENDER_CHOICES, default='M')
    date_of_birth = models.DateField(blank=True, null=True)
    nationality = models.CharField(max_length=50, default='Congolaise')
    civil_status = models.CharField(max_length=20, choices=CIVIL_STATUS_CHOICES, default='Célibataire')
    children_count = models.PositiveSmallIntegerField(default=0)
    phone = models.CharField(max_length=30, blank=True, default='')
    email = models.EmailField()
    address = models.TextField(blank=True, default='')
    city = models.CharField(max_length=100, blank=True, default='')
    province = models.CharField(max_length=100, blank=True, default='')
    country = models.CharField(max_length=100, default='RDC')
    postal_code = models.CharField(max_length=20, blank=True, default='')
    photo = models.ImageField(upload_to='applicants/photos/', blank=True, null=True)
    resume = models.FileField(upload_to='resumes/', blank=True, null=True)
    # Affectation
    department = models.ForeignKey(
        Department, on_delete=models.SET_NULL, null=True, blank=True, related_name='applicants',
    )
    manager = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True, related_name='managed_applicants',
    )
    # Contrat prévu
    position = models.CharField(max_length=100, blank=True, default='')
    position_ref = models.ForeignKey(
        Position, on_delete=models.SET_NULL, null=True, blank=True, related_name='applicants',
    )
    salary_base = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    contract_type = models.CharField(max_length=20, choices=Employee.CONTRACT_CHOICES, default='CDI')
    contract_start = models.DateField(blank=True, null=True)
    contract_end = models.DateField(blank=True, null=True)
    work_days_per_week = models.PositiveSmallIntegerField(default=5)
    work_schedule = models.CharField(max_length=50, blank=True, default='08h00 - 17h00')
    # Compte utilisateur
    create_user_account = models.BooleanField(default=False)
    user_role = models.CharField(max_length=30, choices=USER_ROLE_CHOICES, default='EMPLOYE')
    # Suivi
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='PENDING')
    score = models.IntegerField(default=0)
    employee = models.ForeignKey(
        Employee, on_delete=models.SET_NULL, null=True, blank=True, related_name='applicant_origin',
    )
    converted_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if self.nom or self.prenom:
            parts = [self.prenom, self.nom, self.postnom]
            self.full_name = ' '.join(p for p in parts if p).strip() or self.full_name
        super().save(*args, **kwargs)

    def __str__(self):
        job = self.recruitment.job_title if self.recruitment else (self.position or 'Candidat')
        return f"{self.full_name} - {job}"


class ApplicantBenefit(models.Model):
    applicant = models.ForeignKey(Applicant, on_delete=models.CASCADE, related_name='benefits')
    label = models.CharField(max_length=100)
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    description = models.CharField(max_length=255, blank=True, default='')

    def __str__(self):
        return f"{self.label} — {self.applicant.full_name}"


class Training(models.Model):
    TRAINING_TYPES = [
        ('Internal', 'Interne'),
        ('External', 'Externe'),
    ]
    STATUS_CHOICES = [
        ('Planned', 'Planifiée'),
        ('InProgress', 'En cours'),
        ('Completed', 'Terminée'),
        ('Cancelled', 'Annulée'),
    ]
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, null=True)
    training_type = models.CharField(max_length=20, choices=TRAINING_TYPES, default='Internal')
    start_date = models.DateField()
    end_date = models.DateField()
    instructor = models.CharField(max_length=200, blank=True, default='')
    organization = models.CharField(max_length=200, blank=True, default='', verbose_name='Organisme de formation')
    location = models.CharField(max_length=200, blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Planned')
    employees = models.ManyToManyField(Employee, related_name='trainings', blank=True)
    cost = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    evaluation_score = models.IntegerField(blank=True, null=True)
    certification = models.CharField(max_length=200, blank=True, default='')

    def __str__(self):
        return self.title


class EmployeeTrainingResult(models.Model):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='training_results')
    training = models.ForeignKey(Training, on_delete=models.CASCADE, related_name='results')
    score = models.IntegerField(blank=True, null=True)
    certification_obtained = models.CharField(max_length=200, blank=True, default='')
    completed = models.BooleanField(default=False)

    class Meta:
        unique_together = ('employee', 'training')


class PerformanceReview(models.Model):
    STATUS_CHOICES = [
        ('Draft', 'Brouillon'),
        ('Pending', 'En attente validation'),
        ('Validated', 'Validé'),
    ]
    STAR_LABELS = {
        1: 'Très insuffisant',
        2: 'Insuffisant',
        3: 'Satisfaisant',
        4: 'Très bon',
        5: 'Excellent',
    }
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='performance_reviews')
    reviewer = models.ForeignKey(Employee, on_delete=models.SET_NULL, null=True, blank=True, related_name='reviews_given')
    department = models.ForeignKey(Department, on_delete=models.SET_NULL, null=True, blank=True, related_name='performance_reviews')
    review_date = models.DateField()
    evaluation_period = models.CharField(max_length=80, blank=True, default='')
    star_rating = models.PositiveSmallIntegerField(default=3)
    score = models.IntegerField()
    result = models.CharField(max_length=50, blank=True, default='')
    comments = models.TextField(blank=True, null=True)
    comments_strengths = models.TextField(blank=True, default='')
    comments_weaknesses = models.TextField(blank=True, default='')
    comments_recommendations = models.TextField(blank=True, default='')
    comments_improvement = models.TextField(blank=True, default='')
    comments_future_goals = models.TextField(blank=True, default='')
    goals = models.TextField(blank=True, null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Draft')

    class Meta:
        ordering = ['-review_date']

    def save(self, *args, **kwargs):
        if self.star_rating:
            self.score = self.star_rating * 20
            self.result = self.STAR_LABELS.get(self.star_rating, '')
        if not self.department_id and self.employee_id:
            self.department = self.employee.department
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Évaluation {self.employee.full_name} - {self.review_date}"


class SkillCategory(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['name']
        verbose_name_plural = 'Catégories de compétences'

    def __str__(self):
        return self.name


class Skill(models.Model):
    LEVEL_CHOICES = [
        ('debutant', 'Débutant'),
        ('intermediaire', 'Intermédiaire'),
        ('expert', 'Expert'),
    ]
    category = models.ForeignKey(SkillCategory, on_delete=models.CASCADE, related_name='skills')
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True, default='')
    required_level = models.CharField(max_length=20, choices=LEVEL_CHOICES, default='intermediaire')

    class Meta:
        unique_together = ('category', 'name')
        ordering = ['category__name', 'name']

    def __str__(self):
        return f"{self.name} ({self.category.name})"


class EmployeeSkill(models.Model):
    LEVEL_CHOICES = Skill.LEVEL_CHOICES
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='employee_skills')
    skill = models.ForeignKey(Skill, on_delete=models.CASCADE, related_name='employee_assignments')
    level = models.CharField(max_length=20, choices=LEVEL_CHOICES, default='debutant')
    acquired_date = models.DateField(default=timezone.now)

    class Meta:
        unique_together = ('employee', 'skill')
        ordering = ['-acquired_date']

    def __str__(self):
        return f"{self.employee.full_name} — {self.skill.name}"


class Certification(models.Model):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='certifications')
    title = models.CharField(max_length=200)
    issuing_organization = models.CharField(max_length=200, blank=True, default='')
    issue_date = models.DateField()
    expiry_date = models.DateField(blank=True, null=True)
    certificate_number = models.CharField(max_length=100, blank=True, default='')
    document = models.FileField(upload_to='certifications/', blank=True, null=True)

    class Meta:
        ordering = ['-issue_date']

    def expiry_status(self):
        if not self.expiry_date:
            return 'valid'
        today = timezone.now().date()
        delta = (self.expiry_date - today).days
        if delta < 0:
            return 'expired'
        if delta <= 30:
            return 'expiring_30'
        if delta <= 90:
            return 'expiring_90'
        return 'valid'

    def __str__(self):
        return f"{self.title} — {self.employee.full_name}"


class Objective(models.Model):
    PRIORITY_CHOICES = [
        ('Low', 'Basse'),
        ('Medium', 'Moyenne'),
        ('High', 'Haute'),
    ]
    STATUS_CHOICES = [
        ('NotStarted', 'Non commencé'),
        ('InProgress', 'En cours'),
        ('Completed', 'Réalisé'),
        ('Late', 'En retard'),
    ]
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='objectives')
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    target_date = models.DateField()
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default='Medium')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='NotStarted')
    progress_percent = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['-target_date']

    def refresh_status(self):
        today = timezone.now().date()
        if self.status == 'Completed':
            return
        if self.target_date < today and self.status != 'Completed':
            self.status = 'Late'
        elif self.progress_percent >= 100:
            self.status = 'Completed'
            self.progress_percent = 100

    def save(self, *args, **kwargs):
        self.refresh_status()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.title} — {self.employee.full_name}"


class EmployeeKPI(models.Model):
    UNIT_CHOICES = [
        ('FC', 'FC'),
        ('USD', 'USD ($)'),
        ('PERCENT', '%'),
        ('SALES', 'Ventes'),
        ('CLIENTS', 'Clients'),
        ('HOURS', 'Heures'),
        ('DAYS', 'Jours'),
        ('FILES', 'Dossiers'),
        ('PROJECTS', 'Projets'),
    ]
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='kpis')
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True, default='')
    current_value = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    target_value = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    unit = models.CharField(max_length=20, choices=UNIT_CHOICES, default='PERCENT')

    class Meta:
        ordering = ['name']
        verbose_name = 'KPI employé'
        verbose_name_plural = 'KPI employés'

    def gap(self):
        return float(self.current_value) - float(self.target_value)

    def achievement_percent(self):
        target = float(self.target_value)
        if target == 0:
            return 0.0
        return round(float(self.current_value) / target * 100, 1)

    def __str__(self):
        return f"{self.name} — {self.employee.full_name}"


class AuditLog(models.Model):
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    action = models.CharField(max_length=100)
    module = models.CharField(max_length=50)
    details = models.TextField(blank=True, null=True)
    ip_address = models.GenericIPAddressField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.action} - {self.created_at}"


class Report(models.Model):
    title = models.CharField(max_length=200)
    report_type = models.CharField(max_length=50)
    generated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    file_pdf = models.FileField(upload_to='reports/pdf/', blank=True, null=True)
    file_excel = models.FileField(upload_to='reports/excel/', blank=True, null=True)
    file_word = models.FileField(upload_to='reports/word/', blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title


class AppModule(models.Model):
    """Module applicatif personnalisable (table: modules)."""
    key = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, default='')
    icon = models.CharField(max_length=50, default='fa-cube')
    is_active = models.BooleanField(default=True)
    display_order = models.IntegerField(default=0)
    allowed_roles = models.CharField(
        max_length=255, default='ADMIN_RH',
        help_text='Rôles autorisés, séparés par des virgules',
    )

    class Meta:
        db_table = 'modules'
        ordering = ['display_order', 'name']
        verbose_name = 'Module'
        verbose_name_plural = 'Modules'

    def role_list(self):
        return [r.strip() for r in self.allowed_roles.split(',') if r.strip()]

    def __str__(self):
        return self.name


class ModuleFeature(models.Model):
    """Fonctionnalité d'un module (table: module_features)."""
    FEATURE_TYPES = [
        ('menu_tab', 'Onglet / Menu'),
        ('payroll_gain', 'Gain de paie'),
        ('payroll_retention', 'Retenue de paie'),
        ('recruitment_step', 'Étape recrutement'),
        ('training_type', 'Type formation'),
        ('portal_section', 'Section portail'),
        ('leave_type', 'Type de congé'),
        ('kpi_indicator', 'Indicateur KPI'),
        ('evaluation_method', 'Méthode d\'évaluation'),
        ('report_widget', 'Widget reporting'),
        ('general', 'Fonctionnalité générale'),
    ]
    module = models.ForeignKey(AppModule, on_delete=models.CASCADE, related_name='features')
    feature_key = models.CharField(max_length=80)
    feature_name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    feature_type = models.CharField(max_length=30, choices=FEATURE_TYPES, default='general')
    icon = models.CharField(max_length=50, blank=True, default='')
    config = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)
    display_order = models.IntegerField(default=0)

    class Meta:
        db_table = 'module_features'
        ordering = ['display_order', 'feature_name']
        unique_together = [['module', 'feature_key']]
        verbose_name = 'Fonctionnalité module'
        verbose_name_plural = 'Fonctionnalités modules'

    def __str__(self):
        return f"{self.module.name} — {self.feature_name}"


class CustomField(models.Model):
    """Champ personnalisé par module (table: custom_fields)."""
    FIELD_TYPES = [
        ('text', 'Texte'),
        ('textarea', 'Zone de texte'),
        ('number', 'Nombre'),
        ('email', 'Email'),
        ('phone', 'Téléphone'),
        ('date', 'Date'),
        ('time', 'Heure'),
        ('select', 'Liste déroulante'),
        ('checkbox', 'Case à cocher'),
        ('radio', 'Bouton radio'),
        ('file', 'Fichier'),
        ('image', 'Image'),
    ]
    module = models.ForeignKey(AppModule, on_delete=models.CASCADE, related_name='custom_fields')
    field_key = models.CharField(max_length=80)
    field_name = models.CharField(max_length=200)
    field_type = models.CharField(max_length=20, choices=FIELD_TYPES, default='text')
    description = models.TextField(blank=True, default='')
    required = models.BooleanField(default=False)
    visible = models.BooleanField(default=True)
    editable = models.BooleanField(default=True)
    default_value = models.TextField(blank=True, default='')
    options = models.JSONField(default=list, blank=True)
    display_order = models.IntegerField(default=0)

    class Meta:
        db_table = 'custom_fields'
        ordering = ['display_order', 'field_name']
        unique_together = [['module', 'field_key']]
        verbose_name = 'Champ personnalisé'
        verbose_name_plural = 'Champs personnalisés'

    def __str__(self):
        return f"{self.module.name} — {self.field_name}"
