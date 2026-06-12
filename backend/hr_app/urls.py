from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    csrf_token_view, login_view, logout_view, me_view,
    dashboard_stats, employee_portal, update_employee_profile,
    employee_notifications, mark_notification_read, company_settings_view,
    company_logo_upload, company_logo_from_url,
    export_report, export_payslip, export_payslip_individual, export_payslip_individual_download,
    payslip_preview, send_payslip_by_email, export_payroll_month, payroll_summary,
    RoleViewSet, DepartmentViewSet, PositionViewSet, EmployeeViewSet,
    EmployeeMovementViewSet, ContractViewSet, ContractTypeViewSet, PayrollViewSet,
    AbsenceViewSet, AttendanceViewSet, MissionViewSet, DocumentViewSet,
    RecruitmentViewSet, ApplicantViewSet, TrainingViewSet,
    PerformanceReviewViewSet, EmployeeTrainingResultViewSet,
    SkillCategoryViewSet, SkillViewSet, EmployeeSkillViewSet,
    CertificationViewSet, ObjectiveViewSet, EmployeeKPIViewSet,
    AuditLogViewSet, talent_dashboard, sync_stats,
    AppModuleViewSet, ModuleFeatureViewSet, CustomFieldViewSet, module_config_view,
)
from .settings_views import (
    public_branding_view, system_settings_view, work_schedule_settings_view,
    presence_absence_settings_view, RoleManagementViewSet,
    ManagedUserViewSet, SystemBackupViewSet, all_custom_fields_view,
)

router = DefaultRouter()
router.register(r'roles', RoleViewSet)
router.register(r'departments', DepartmentViewSet)
router.register(r'positions', PositionViewSet)
router.register(r'employees', EmployeeViewSet)
router.register(r'movements', EmployeeMovementViewSet)
router.register(r'contracts', ContractViewSet)
router.register(r'contract-types', ContractTypeViewSet)
router.register(r'payroll', PayrollViewSet)
router.register(r'absences', AbsenceViewSet)
router.register(r'attendance', AttendanceViewSet)
router.register(r'missions', MissionViewSet)
router.register(r'documents', DocumentViewSet)
router.register(r'recruitments', RecruitmentViewSet)
router.register(r'applicants', ApplicantViewSet)
router.register(r'trainings', TrainingViewSet)
router.register(r'performance-reviews', PerformanceReviewViewSet)
router.register(r'training-results', EmployeeTrainingResultViewSet)
router.register(r'skill-categories', SkillCategoryViewSet)
router.register(r'skills', SkillViewSet)
router.register(r'employee-skills', EmployeeSkillViewSet)
router.register(r'certifications', CertificationViewSet)
router.register(r'objectives', ObjectiveViewSet)
router.register(r'employee-kpis', EmployeeKPIViewSet)
router.register(r'audit-logs', AuditLogViewSet)
router.register(r'modules', AppModuleViewSet)
router.register(r'module-features', ModuleFeatureViewSet)
router.register(r'custom-fields', CustomFieldViewSet)
router.register(r'settings/roles', RoleManagementViewSet, basename='settings-roles')
router.register(r'settings/users', ManagedUserViewSet, basename='settings-users')
router.register(r'settings/backups', SystemBackupViewSet, basename='settings-backups')

urlpatterns = [
    path('csrf/', csrf_token_view),
    path('login/', login_view),
    path('logout/', logout_view),
    path('me/', me_view),
    path('dashboard/', dashboard_stats),
    path('talent-dashboard/', talent_dashboard),
    path('sync/', sync_stats),
    path('employee-portal/', employee_portal),
    path('employee-portal/profile/', update_employee_profile),
    path('employee-portal/notifications/', employee_notifications),
    path('employee-portal/notifications/<int:notif_id>/read/', mark_notification_read),
    path('company-settings/', company_settings_view),
    path('company-settings/logo/upload/', company_logo_upload),
    path('company-settings/logo/url/', company_logo_from_url),
    path('export/pdf/', export_report),
    path('export/excel/', export_report),
    path('export/word/', export_report),
    path('export/payslip/', export_payslip),
    path('payroll/export-individual/', export_payslip_individual),
    path('payroll/export-individual/download/', export_payslip_individual_download),
    path('export/payslip/individual/', export_payslip_individual),
    path('export/payslip/preview/', payslip_preview),
    path('export/payslip/email/', send_payslip_by_email),
    path('export/payroll/pdf/', export_payroll_month),
    path('export/payroll/excel/', export_payroll_month),
    path('export/payroll/word/', export_payroll_month),
    path('payroll/summary/', payroll_summary),
    path('module-config/', module_config_view),
    path('public-branding/', public_branding_view),
    path('system-settings/', system_settings_view),
    path('work-schedule-settings/', work_schedule_settings_view),
    path('presence-absence-settings/', presence_absence_settings_view),
    path('settings/custom-fields/', all_custom_fields_view),
    path('', include(router.urls)),
]
