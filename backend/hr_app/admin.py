from django.contrib import admin
from .models import (
    Role, UserProfile, CompanySettings, Department, Position, Employee,
    EmployeeMovement, Contract, Payroll, PayrollCalculationLog, Absence,
    Attendance, Mission, Document, Notification, Recruitment, Applicant,
    Training, EmployeeTrainingResult, PerformanceReview, AuditLog, Report,
    SkillCategory, Skill, EmployeeSkill, Certification, Objective, EmployeeKPI,
    AppModule, ModuleFeature, CustomField, SystemSettings, SystemBackup,
)

admin.site.register(Role)
admin.site.register(CompanySettings)
admin.site.register(PayrollCalculationLog)
admin.site.register(Notification)
admin.site.register(EmployeeTrainingResult)
admin.site.register(UserProfile)
admin.site.register(Department)
admin.site.register(Position)
admin.site.register(Employee)
admin.site.register(EmployeeMovement)
admin.site.register(Contract)
admin.site.register(Payroll)
admin.site.register(Absence)
admin.site.register(Attendance)
admin.site.register(Mission)
admin.site.register(Document)
admin.site.register(Recruitment)
admin.site.register(Applicant)
admin.site.register(Training)
admin.site.register(PerformanceReview)
admin.site.register(SkillCategory)
admin.site.register(Skill)
admin.site.register(EmployeeSkill)
admin.site.register(Certification)
admin.site.register(Objective)
admin.site.register(EmployeeKPI)
admin.site.register(AuditLog)
admin.site.register(Report)
admin.site.register(AppModule)
admin.site.register(ModuleFeature)
admin.site.register(CustomField)
admin.site.register(SystemSettings)
admin.site.register(SystemBackup)
