from django.contrib.auth.models import User
from rest_framework import serializers
from .models import (
    Role, UserProfile, CompanySettings, SystemSettings, SystemBackup,
    Department, Position, Employee,
    AppModule, ModuleFeature, CustomField,
    EmployeeMovement, Contract, Payroll, PayrollCalculationLog, PayrollExportLog,
    WorkScheduleSettings, Absence,
    Attendance, Mission, Document, Notification, Recruitment, Applicant,
    Training, EmployeeTrainingResult, PerformanceReview, AuditLog, Report,
    ApplicantBenefit, SkillCategory, Skill, EmployeeSkill,
    Certification, Objective, EmployeeKPI,
)


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = '__all__'


class SystemSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemSettings
        fields = '__all__'


class WorkScheduleSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkScheduleSettings
        fields = '__all__'


class SystemBackupSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = SystemBackup
        fields = '__all__'

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None


class ManagedUserSerializer(serializers.ModelSerializer):
    role_code = serializers.SerializerMethodField()
    role_label = serializers.SerializerMethodField()
    is_suspended = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'is_active', 'last_login', 'date_joined',
            'role_code', 'role_label', 'is_suspended',
        ]

    def get_role_code(self, obj):
        if hasattr(obj, 'profile') and obj.profile.role:
            return obj.profile.role.code
        return None

    def get_role_label(self, obj):
        if hasattr(obj, 'profile') and obj.profile.role:
            return obj.profile.role.name
        return '—'

    def get_is_suspended(self, obj):
        return not obj.is_active


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name']


class UserProfileSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    role = RoleSerializer(read_only=True)
    role_code = serializers.CharField(source='role.code', read_only=True)

    class Meta:
        model = UserProfile
        fields = ['id', 'user', 'role', 'role_code', 'employee']


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = '__all__'


class PositionSerializer(serializers.ModelSerializer):
    department_name = serializers.ReadOnlyField(source='department.name')

    class Meta:
        model = Position
        fields = '__all__'


class CompanySettingsSerializer(serializers.ModelSerializer):
    logo_display_url = serializers.ReadOnlyField()
    logo_filename = serializers.SerializerMethodField()
    logo_size_kb = serializers.SerializerMethodField()

    class Meta:
        model = CompanySettings
        fields = '__all__'
        read_only_fields = ['created_at', 'updated_at']

    def get_logo_filename(self, obj):
        if obj.logo:
            return obj.logo.name.split('/')[-1]
        if obj.logo_url:
            return obj.logo_url.split('/')[-1]
        return None

    def get_logo_size_kb(self, obj):
        if obj.logo and obj.logo.path:
            try:
                import os
                return round(os.path.getsize(obj.logo.path) / 1024, 1)
            except OSError:
                pass
        return None


class EmployeeSerializer(serializers.ModelSerializer):
    department_name = serializers.ReadOnlyField(source='department.name')
    manager_name = serializers.ReadOnlyField(source='manager.full_name')
    gender_label = serializers.CharField(source='get_gender_display', read_only=True)
    seniority_years = serializers.ReadOnlyField()
    photo_url = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = '__all__'

    def get_photo_url(self, obj):
        if obj.photo:
            return obj.photo.url
        return None


class EmployeeMovementSerializer(serializers.ModelSerializer):
    employee_name = serializers.ReadOnlyField(source='employee.full_name')

    class Meta:
        model = EmployeeMovement
        fields = '__all__'


class ContractSerializer(serializers.ModelSerializer):
    employee_name = serializers.ReadOnlyField(source='employee.full_name')

    class Meta:
        model = Contract
        fields = '__all__'


class PayrollCalculationLogSerializer(serializers.ModelSerializer):
    username = serializers.ReadOnlyField(source='performed_by.username')

    class Meta:
        model = PayrollCalculationLog
        fields = '__all__'


class PayrollExportLogSerializer(serializers.ModelSerializer):
    exported_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PayrollExportLog
        fields = '__all__'

    def get_exported_by_name(self, obj):
        if obj.exported_by:
            return obj.exported_by.get_full_name() or obj.exported_by.username
        return 'Système'


class PayrollSerializer(serializers.ModelSerializer):
    employee_name = serializers.ReadOnlyField(source='employee.full_name')
    employee_matricule = serializers.ReadOnlyField(source='employee.matricule')
    status_label = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = Payroll
        fields = '__all__'


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = '__all__'


class EmployeeTrainingResultSerializer(serializers.ModelSerializer):
    training_title = serializers.ReadOnlyField(source='training.title')
    employee_name = serializers.ReadOnlyField(source='employee.full_name')

    class Meta:
        model = EmployeeTrainingResult
        fields = '__all__'


class AbsenceSerializer(serializers.ModelSerializer):
    employee_name = serializers.ReadOnlyField(source='employee.full_name')

    class Meta:
        model = Absence
        fields = '__all__'


class AttendanceSerializer(serializers.ModelSerializer):
    employee_name = serializers.ReadOnlyField(source='employee.full_name')

    class Meta:
        model = Attendance
        fields = '__all__'


class MissionSerializer(serializers.ModelSerializer):
    employee_name = serializers.ReadOnlyField(source='employee.full_name')

    class Meta:
        model = Mission
        fields = '__all__'


class DocumentSerializer(serializers.ModelSerializer):
    employee_name = serializers.ReadOnlyField(source='employee.full_name')

    class Meta:
        model = Document
        fields = '__all__'


class RecruitmentSerializer(serializers.ModelSerializer):
    applicants_count = serializers.SerializerMethodField()

    class Meta:
        model = Recruitment
        fields = '__all__'

    def get_applicants_count(self, obj):
        return obj.applicants.count()


class ApplicantBenefitSerializer(serializers.ModelSerializer):
    class Meta:
        model = ApplicantBenefit
        fields = '__all__'


class ApplicantSerializer(serializers.ModelSerializer):
    job_title = serializers.ReadOnlyField(source='recruitment.job_title')
    department_name = serializers.ReadOnlyField(source='department.name')
    manager_name = serializers.ReadOnlyField(source='manager.full_name')
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    photo_url = serializers.SerializerMethodField()
    resume_url = serializers.SerializerMethodField()
    benefits = ApplicantBenefitSerializer(many=True, read_only=True)
    employee_matricule = serializers.ReadOnlyField(source='employee.matricule')

    class Meta:
        model = Applicant
        fields = '__all__'

    def get_photo_url(self, obj):
        return obj.photo.url if obj.photo else None

    def get_resume_url(self, obj):
        return obj.resume.url if obj.resume else None


class TrainingSerializer(serializers.ModelSerializer):
    employees_count = serializers.SerializerMethodField()
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    participant_names = serializers.SerializerMethodField()

    class Meta:
        model = Training
        fields = '__all__'

    def get_employees_count(self, obj):
        return obj.employees.count()

    def get_participant_names(self, obj):
        return [e.full_name for e in obj.employees.all()]

    def create(self, validated_data):
        employees = validated_data.pop('employees', [])
        training = Training.objects.create(**validated_data)
        if employees:
            training.employees.set(employees)
        return training

    def update(self, instance, validated_data):
        employees = validated_data.pop('employees', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if employees is not None:
            instance.employees.set(employees)
        return instance


class PerformanceReviewSerializer(serializers.ModelSerializer):
    employee_name = serializers.ReadOnlyField(source='employee.full_name')
    reviewer_name = serializers.ReadOnlyField(source='reviewer.full_name')
    department_name = serializers.ReadOnlyField(source='department.name')
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    star_display = serializers.SerializerMethodField()

    class Meta:
        model = PerformanceReview
        fields = '__all__'

    def get_star_display(self, obj):
        rating = obj.star_rating or 0
        return '★' * rating + '☆' * (5 - rating)


class SkillCategorySerializer(serializers.ModelSerializer):
    skills_count = serializers.SerializerMethodField()

    class Meta:
        model = SkillCategory
        fields = '__all__'

    def get_skills_count(self, obj):
        return obj.skills.count()


class SkillSerializer(serializers.ModelSerializer):
    category_name = serializers.ReadOnlyField(source='category.name')
    required_level_label = serializers.CharField(source='get_required_level_display', read_only=True)

    class Meta:
        model = Skill
        fields = '__all__'


class EmployeeSkillSerializer(serializers.ModelSerializer):
    employee_name = serializers.ReadOnlyField(source='employee.full_name')
    skill_name = serializers.ReadOnlyField(source='skill.name')
    category_name = serializers.ReadOnlyField(source='skill.category.name')
    level_label = serializers.CharField(source='get_level_display', read_only=True)

    class Meta:
        model = EmployeeSkill
        fields = '__all__'


class CertificationSerializer(serializers.ModelSerializer):
    employee_name = serializers.ReadOnlyField(source='employee.full_name')
    expiry_status = serializers.SerializerMethodField()
    expiry_status_label = serializers.SerializerMethodField()
    document_url = serializers.SerializerMethodField()

    class Meta:
        model = Certification
        fields = '__all__'

    def get_expiry_status(self, obj):
        return obj.expiry_status()

    def get_expiry_status_label(self, obj):
        labels = {
            'valid': 'Valide',
            'expiring_90': 'Expire dans 90 jours',
            'expiring_30': 'Expire dans 30 jours',
            'expired': 'Expirée',
        }
        return labels.get(obj.expiry_status(), 'Valide')

    def get_document_url(self, obj):
        return obj.document.url if obj.document else None


class ObjectiveSerializer(serializers.ModelSerializer):
    employee_name = serializers.ReadOnlyField(source='employee.full_name')
    priority_label = serializers.CharField(source='get_priority_display', read_only=True)
    status_label = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = Objective
        fields = '__all__'


class EmployeeKPISerializer(serializers.ModelSerializer):
    employee_name = serializers.ReadOnlyField(source='employee.full_name')
    unit_label = serializers.CharField(source='get_unit_display', read_only=True)
    gap = serializers.SerializerMethodField()
    achievement_percent = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeKPI
        fields = '__all__'

    def get_gap(self, obj):
        return obj.gap()

    def get_achievement_percent(self, obj):
        return obj.achievement_percent()


class AuditLogSerializer(serializers.ModelSerializer):
    username = serializers.ReadOnlyField(source='user.username')

    class Meta:
        model = AuditLog
        fields = '__all__'


class ReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = Report
        fields = '__all__'


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)


class CustomFieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomField
        fields = '__all__'


class ModuleFeatureSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleFeature
        fields = '__all__'


class AppModuleSerializer(serializers.ModelSerializer):
    features = ModuleFeatureSerializer(many=True, read_only=True)
    custom_fields = CustomFieldSerializer(many=True, read_only=True)

    class Meta:
        model = AppModule
        fields = '__all__'


class AppModuleListSerializer(serializers.ModelSerializer):
    features_count = serializers.SerializerMethodField()
    fields_count = serializers.SerializerMethodField()

    class Meta:
        model = AppModule
        fields = '__all__'

    def get_features_count(self, obj):
        return obj.features.count()

    def get_fields_count(self, obj):
        return obj.custom_fields.count()
