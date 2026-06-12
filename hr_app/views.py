from datetime import datetime, timedelta
from decimal import Decimal

import json
import os

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.hashers import make_password
from django.contrib.auth.models import User
from django.db.models import Sum, Count, Avg, Q
from django.http import FileResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .exports import (
    generate_payslip_pdf, generate_payslip_excel, generate_payroll_excel,
    generate_payroll_mass_pdf, generate_payroll_mass_word,
    generate_payslip_word, generate_report_pdf, generate_report_excel, generate_report_word,
)
from .models import (
    Role, UserProfile, CompanySettings, Department, Position, Employee,
    EmployeeMovement, Contract, Payroll, PayrollCalculationLog, PayrollExportLog, Absence,
    Attendance, Mission, Document, Notification, Recruitment, Applicant,
    Training, EmployeeTrainingResult, PerformanceReview, AuditLog, Report,
    AppModule, ModuleFeature, CustomField,
    SkillCategory, Skill, EmployeeSkill, Certification, Objective, EmployeeKPI,
)
from .payroll_service import compute_payroll_totals
from .payslip_export import (
    can_access_payroll, resolve_payroll, export_payslip_file, send_payslip_email,
    parse_individual_export_params, individual_export_response, individual_export_file_response,
)
from .permissions import (
    get_user_role, IsGestionnaireOrAdmin, IsManagerOrAbove, IsAdminRH,
    can_export_payroll_individual, can_export_payroll_global,
    ROLE_ADMIN, ROLE_GESTIONNAIRE, ROLE_PAIE, ROLE_MANAGER, ROLE_EMPLOYE,
)
from .recruitment_service import (
    convert_applicant_to_employee, get_department_managers, search_applicants,
    sync_applicant_benefits, generate_secure_password, send_credentials_email,
)
from .recruitment_import import import_from_csv, import_from_excel, import_from_pdf
import logging

logger = logging.getLogger(__name__)
from .serializers import (
    RoleSerializer, CompanySettingsSerializer, DepartmentSerializer, PositionSerializer,
    EmployeeSerializer, EmployeeMovementSerializer, ContractSerializer, PayrollSerializer,
    PayrollCalculationLogSerializer, PayrollExportLogSerializer, AbsenceSerializer, AttendanceSerializer,
    MissionSerializer, DocumentSerializer, NotificationSerializer,
    RecruitmentSerializer, ApplicantSerializer,     TrainingSerializer,
    EmployeeTrainingResultSerializer, PerformanceReviewSerializer,
    SkillCategorySerializer, SkillSerializer, EmployeeSkillSerializer,
    CertificationSerializer, ObjectiveSerializer, EmployeeKPISerializer,
    AuditLogSerializer, ReportSerializer, LoginSerializer,
    AppModuleSerializer, AppModuleListSerializer, ModuleFeatureSerializer, CustomFieldSerializer,
)
from .talent_service import (
    performance_dashboard_stats, training_dashboard_stats, talent_overview_stats,
    check_certification_alerts,
)
from .sync_service import collect_sync_payload
from .utils import log_action, notify_employee
from .company_utils import validate_logo_file, download_logo_from_url


def _user_payload(user):
    role_code = get_user_role(user)
    employee_id = None
    employee_name = None
    dashboard = 'employee-portal'
    if role_code == ROLE_ADMIN:
        dashboard = 'admin-dashboard'
    elif role_code == ROLE_GESTIONNAIRE:
        dashboard = 'rh-dashboard'
    elif role_code == ROLE_MANAGER:
        dashboard = 'manager-dashboard'
    if hasattr(user, 'profile') and user.profile.employee:
        employee_id = user.profile.employee.id
        employee_name = user.profile.employee.full_name
    permissions = {}
    force_password_change = False
    if hasattr(user, 'profile') and user.profile:
        if user.profile.role:
            permissions = user.profile.role.permissions or {}
        force_password_change = bool(user.profile.force_password_change)
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'role': role_code,
        'role_label': user.profile.role.name if hasattr(user, 'profile') and user.profile.role else 'Utilisateur',
        'employee_id': employee_id,
        'employee_name': employee_name,
        'dashboard': dashboard,
        'permissions': permissions,
        'force_password_change': force_password_change,
    }


@api_view(['GET'])
@permission_classes([AllowAny])
def csrf_token_view(request):
    return Response({'csrfToken': get_token(request)})


@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    LOGIN_FAIL = "Identifiant ou mot de passe incorrect."
    serializer = LoginSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({'error': LOGIN_FAIL}, status=status.HTTP_401_UNAUTHORIZED)
    username = serializer.validated_data['username']
    password = serializer.validated_data['password']
    user = authenticate(request, username=username, password=password)
    if user is None and '@' in username:
        try:
            u = User.objects.get(email=username)
            user = authenticate(request, username=u.username, password=password)
        except User.DoesNotExist:
            pass
    if user is None:
        return Response({'error': LOGIN_FAIL}, status=status.HTTP_401_UNAUTHORIZED)
    login(request, user)
    log_action(user, 'Connexion', 'Auth', f'Utilisateur {user.username} connecté', request)
    return Response({'status': 'success', 'user': _user_payload(user)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    log_action(request.user, 'Déconnexion', 'Auth', f'Utilisateur {request.user.username} déconnecté', request)
    logout(request)
    return Response({'status': 'success', 'message': 'Déconnexion réussie.'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_view(request):
    return Response(_user_payload(request.user))


class RoleViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [IsAuthenticated]


class DepartmentViewSet(viewsets.ModelViewSet):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer

    def perform_create(self, serializer):
        obj = serializer.save()
        log_action(self.request.user, 'Création département', 'Personnel', obj.name, self.request)

    @action(detail=True, methods=['get'])
    def managers(self, request, pk=None):
        """Responsables du département — filtrés par département uniquement."""
        managers = get_department_managers(pk)
        return Response(EmployeeSerializer(managers, many=True).data)


class PositionViewSet(viewsets.ModelViewSet):
    queryset = Position.objects.all()
    serializer_class = PositionSerializer


class EmployeeViewSet(viewsets.ModelViewSet):
    queryset = Employee.objects.all()
    serializer_class = EmployeeSerializer

    def get_permissions(self):
        if self.action in ('list', 'retrieve', 'employee_file'):
            return [IsAuthenticated()]
        return [IsGestionnaireOrAdmin()]

    def perform_create(self, serializer):
        obj = serializer.save()
        log_action(self.request.user, 'Création employé', 'Personnel', obj.full_name, self.request)

    def perform_update(self, serializer):
        obj = serializer.save()
        log_action(self.request.user, 'Modification employé', 'Personnel', obj.full_name, self.request)

    @action(detail=True, methods=['post'])
    def archive_employee(self, request, pk=None):
        employee = self.get_object()
        employee.status = 'Archived'
        employee.is_active = False
        employee.save()
        log_action(request.user, 'Archivage employé', 'Personnel', employee.full_name, request)
        return Response({'status': 'success', 'message': f'Employé {employee.full_name} archivé.'})

    @action(detail=True, methods=['get'])
    def employee_file(self, request, pk=None):
        employee = self.get_object()
        payslips = employee.payrolls.filter(status__in=['VALIDATED', 'PAID', 'ARCHIVED']).order_by('-month')
        export_logs = PayrollExportLog.objects.filter(payroll__employee=employee).select_related(
            'payroll', 'exported_by',
        ).order_by('-exported_at')[:50]
        user_account = None
        if employee.user_id:
            profile = getattr(employee.user, 'profile', None)
            user_account = {
                'id': employee.user.id,
                'username': employee.user.username,
                'email': employee.user.email,
                'is_active': employee.user.is_active,
                'role': profile.role.code if profile and profile.role else None,
                'role_label': profile.role.name if profile and profile.role else None,
                'force_password_change': profile.force_password_change if profile else False,
            }
        return Response({
            'employee': EmployeeSerializer(employee).data,
            'user_account': user_account,
            'documents': DocumentSerializer(employee.documents.all(), many=True).data,
            'contracts': ContractSerializer(employee.contracts.all(), many=True).data,
            'performance_reviews': PerformanceReviewSerializer(employee.performance_reviews.all(), many=True).data,
            'trainings': TrainingSerializer(employee.trainings.all(), many=True).data,
            'training_results': EmployeeTrainingResultSerializer(employee.training_results.all(), many=True).data,
            'skills': EmployeeSkillSerializer(
                employee.employee_skills.select_related('skill', 'skill__category').all(), many=True,
            ).data,
            'certifications': CertificationSerializer(employee.certifications.all(), many=True).data,
            'objectives': ObjectiveSerializer(employee.objectives.all(), many=True).data,
            'kpis': EmployeeKPISerializer(employee.kpis.all(), many=True).data,
            'talent_summary': {
                'average_stars': round(
                    employee.performance_reviews.aggregate(avg=Avg('star_rating'))['avg'] or 0, 1,
                ),
                'evaluations_count': employee.performance_reviews.count(),
                'trainings_count': employee.trainings.count(),
                'skills_count': employee.employee_skills.count(),
                'certifications_count': employee.certifications.count(),
                'objectives_completed': employee.objectives.filter(status='Completed').count(),
                'objectives_total': employee.objectives.count(),
            },
            'movements': EmployeeMovementSerializer(employee.movements.all(), many=True).data,
            'payslips': PayrollSerializer(payslips, many=True).data,
            'export_history': PayrollExportLogSerializer(export_logs, many=True).data,
        })

    @action(detail=True, methods=['post'])
    def manage_user_password(self, request, pk=None):
        """Réinitialiser / modifier le mot de passe du compte utilisateur lié."""
        employee = self.get_object()
        if not employee.user_id:
            return Response({'error': 'Aucun compte utilisateur lié à cet employé.'}, status=400)
        action_type = request.data.get('action', 'reset')
        send_email = request.data.get('send_email', True)
        force_change = request.data.get('force_password_change', True)
        user = employee.user
        profile, _ = UserProfile.objects.get_or_create(user=user)

        if action_type == 'generate':
            new_pass = generate_secure_password()
        else:
            new_pass = request.data.get('password', '').strip()
            if not new_pass:
                new_pass = generate_secure_password()

        user.password = make_password(new_pass)
        user.save(update_fields=['password'])
        profile.force_password_change = force_change
        profile.save(update_fields=['force_password_change'])

        email_sent = False
        email_error = None
        if send_email and employee.email:
            applicant_stub = type('A', (), {
                'full_name': employee.full_name, 'email': employee.email,
            })()
            email_sent, email_error = send_credentials_email(
                applicant_stub, user.username, new_pass, force_change,
            )

        log_action(
            request.user, 'Gestion mot de passe employé', 'Personnel',
            f'{employee.full_name} ({user.username})', request,
        )
        return Response({
            'status': 'success',
            'username': user.username,
            'password': new_pass,
            'email_sent': email_sent,
            'email_error': email_error,
            'force_password_change': force_change,
        })


class EmployeeMovementViewSet(viewsets.ModelViewSet):
    queryset = EmployeeMovement.objects.all()
    serializer_class = EmployeeMovementSerializer
    permission_classes = [IsGestionnaireOrAdmin]


class ContractViewSet(viewsets.ModelViewSet):
    queryset = Contract.objects.all()
    serializer_class = ContractSerializer
    permission_classes = [IsGestionnaireOrAdmin]


def _apply_payroll_calc(payroll, data, user=None):
    totals = compute_payroll_totals(data, employee=payroll.employee, month_date=payroll.month)
    for field, value in totals.items():
        old = getattr(payroll, field, None)
        setattr(payroll, field, value)
        if user and old != value:
            PayrollCalculationLog.objects.create(
                payroll=payroll, field_name=field,
                old_value=str(old) if old is not None else '',
                new_value=str(value), calculated_value=str(value),
                performed_by=user,
            )
    payroll.sync_legacy_fields()
    return payroll


def _finalize_payslip(payroll, user):
    from .payslip_builder import generate_verification_hash
    payroll.status = 'VALIDATED'
    payroll.validated_by = user
    payroll.generated_by = user
    payroll.issued_at = timezone.now()
    payroll.verification_hash = generate_verification_hash(payroll)
    payroll.save()
    for fmt in ('pdf', 'excel', 'word'):
        export_payslip_file(payroll, fmt, user=user, archive=True)
    notify_employee(
        payroll.employee,
        'Nouveau bulletin de paie',
        f'Votre bulletin de {payroll.month.strftime("%B %Y")} est disponible.',
        'payslip',
    )


class PayrollViewSet(viewsets.ModelViewSet):
    queryset = Payroll.objects.all().select_related('employee')
    serializer_class = PayrollSerializer

    def get_permissions(self):
        if self.action in ('list', 'retrieve', 'download_payslip', 'calculation_history'):
            return [IsAuthenticated()]
        return [IsGestionnaireOrAdmin()]

    @action(detail=False, methods=['post'], url_path='calculate')
    def calculate_payroll(self, request):
        month = request.data.get('month')
        year = request.data.get('year')
        if not month or not year:
            return Response({'error': 'month et year sont requis.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            target_date = datetime(int(year), int(month), 1).date()
        except (ValueError, TypeError):
            return Response({'error': 'Format mois/année invalide.'}, status=status.HTTP_400_BAD_REQUEST)

        company = CompanySettings.get_settings()
        employees = Employee.objects.filter(status='Active')
        if request.data.get('employee_id'):
            employees = employees.filter(id=request.data['employee_id'])
        results = []
        for emp in employees:
            base_data = {
                'salary_base': emp.salary_base,
                'prime_transport': request.data.get('prime_transport', 100),
                'prime_logement': request.data.get('prime_logement', 50),
                'prime_fonction': request.data.get('prime_fonction', 0),
                'days_worked': request.data.get('days_worked', 22),
                'days_absent': request.data.get('days_absent', 0),
                'inpp_enabled': company.inpp_enabled,
            }
            totals = compute_payroll_totals(base_data, employee=emp, month_date=target_date)
            payroll, _ = Payroll.objects.update_or_create(
                employee=emp, month=target_date,
                defaults={**totals, 'status': 'DRAFT', 'currency': request.data.get('currency', 'USD')},
            )
            payroll.sync_legacy_fields()
            payroll.save()
            _apply_payroll_calc(payroll, totals, request.user)
            payroll.save()
            results.append(PayrollSerializer(payroll).data)
        log_action(request.user, 'Calcul paie RDC', 'Paie', f'{len(results)} bulletins - {month}/{year}', request)
        return Response({'status': 'success', 'count': len(results), 'data': results})

    @action(detail=True, methods=['put', 'patch'])
    def update_elements(self, request, pk=None):
        payroll = self.get_object()
        if payroll.status not in ('DRAFT', 'PENDING'):
            return Response({'error': 'Modification impossible après validation.'}, status=400)
        _apply_payroll_calc(payroll, {**request.data, 'salary_base': request.data.get('salary_base', payroll.salary_base)}, request.user)
        payroll.status = 'DRAFT'
        payroll.save()
        return Response(PayrollSerializer(payroll).data)

    @action(detail=True, methods=['post'])
    def submit_validation(self, request, pk=None):
        payroll = self.get_object()
        payroll.status = 'PENDING'
        payroll.save()
        log_action(request.user, 'Soumission validation paie', 'Paie', payroll.employee.full_name, request)
        return Response({'status': 'success', 'message': 'Paie soumise pour validation.'})

    @action(detail=False, methods=['post'], url_path='validate')
    def validate_batch(self, request):
        payroll_ids = request.data.get('payroll_ids', [])
        if not payroll_ids:
            return Response({'error': 'payroll_ids requis.'}, status=status.HTTP_400_BAD_REQUEST)
        validated = []
        for pid in payroll_ids:
            payroll = get_object_or_404(Payroll, pk=pid)
            _finalize_payslip(payroll, request.user)
            validated.append(PayrollSerializer(payroll).data)
        if validated:
            month = Payroll.objects.get(pk=payroll_ids[0]).month
            generate_payroll_excel(month, Payroll.objects.filter(id__in=payroll_ids))
        log_action(request.user, 'Validation paie masse', 'Paie', f'{len(validated)} bulletins', request)
        return Response({'status': 'success', 'data': validated})

    @action(detail=True, methods=['post'])
    def validate_payroll(self, request, pk=None):
        payroll = self.get_object()
        _finalize_payslip(payroll, request.user)
        log_action(request.user, 'Validation bulletin', 'Paie', payroll.employee.full_name, request)
        return Response({
            'status': 'success',
            'pdf_url': f'/media/{payroll.payslip_pdf}',
            'excel_url': f'/media/{payroll.payslip_excel}',
            'word_url': f'/media/{payroll.payslip_word}',
        })

    @action(detail=True, methods=['post'])
    def reopen_payroll(self, request, pk=None):
        """Réouvre un bulletin validé en brouillon pour permettre la modification avant export."""
        payroll = self.get_object()
        if payroll.status not in ('VALIDATED', 'PENDING', 'PAID'):
            return Response(
                {'error': 'Seuls les bulletins validés ou en attente peuvent être réouverts.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        payroll.status = 'DRAFT'
        payroll.save(update_fields=['status'])
        log_action(request.user, 'Réouverture bulletin', 'Paie', payroll.employee.full_name, request)
        return Response({'status': 'success', 'message': 'Bulletin réouvert — vous pouvez le modifier.'})

    @action(detail=True, methods=['post'])
    def mark_paid(self, request, pk=None):
        payroll = self.get_object()
        payroll.status = 'PAID'
        payroll.save()
        log_action(request.user, 'Paie marquée payée', 'Paie', payroll.employee.full_name, request)
        return Response({'status': 'success'})

    @action(detail=True, methods=['post'])
    def archive_payroll(self, request, pk=None):
        payroll = self.get_object()
        payroll.status = 'ARCHIVED'
        payroll.save()
        return Response({'status': 'success'})

    @action(detail=True, methods=['get'])
    def calculation_history(self, request, pk=None):
        payroll = self.get_object()
        logs = PayrollCalculationLogSerializer(payroll.calculation_logs.all()[:50], many=True)
        return Response(logs.data)

    @action(detail=True, methods=['get'])
    def download_payslip(self, request, pk=None):
        payroll = self.get_object()
        if not can_access_payroll(request.user, payroll):
            return Response({'error': 'Accès refusé.'}, status=status.HTTP_403_FORBIDDEN)
        fmt = request.query_params.get('export_format') or request.query_params.get('format', 'pdf')
        if payroll.status not in ('VALIDATED', 'PAID', 'ARCHIVED'):
            return Response({'error': 'Fichier non disponible. Validez d\'abord la paie.'}, status=404)
        field_map = {'pdf': payroll.payslip_pdf, 'excel': payroll.payslip_excel, 'word': payroll.payslip_word}
        f = field_map.get(fmt)
        if not f:
            result = export_payslip_file(payroll, fmt, user=request.user, archive=True)
            f = result['path']
        else:
            from .payroll_service import payslip_filename
            ext_map = {'pdf': 'pdf', 'excel': 'xlsx', 'word': 'docx'}
            result = {'path': f, 'filename': payslip_filename(payroll, ext_map[fmt]), 'url': f'/media/{f}'}
        return Response({
            'url': result['url'],
            'filename': result['filename'],
            'payroll_id': payroll.id,
        })


class AbsenceViewSet(viewsets.ModelViewSet):
    queryset = Absence.objects.all().select_related('employee')
    serializer_class = AbsenceSerializer

    def perform_create(self, serializer):
        obj = serializer.save()
        log_action(self.request.user, 'Demande congé', 'Congés', obj.employee.full_name, self.request)

    @action(detail=True, methods=['post'])
    def approve_absence(self, request, pk=None):
        absence = self.get_object()
        absence.status = 'Approved'
        validator = getattr(request.user.profile, 'employee', None)
        absence.validated_by = validator
        absence.save()
        notify_employee(absence.employee, 'Congé validé', f'Votre congé du {absence.start_date} au {absence.end_date} a été approuvé.', 'leave_approved')
        log_action(request.user, 'Approbation congé', 'Congés', absence.employee.full_name, request)
        return Response({'status': 'success', 'message': 'Congé approuvé.'})

    @action(detail=True, methods=['post'])
    def reject_absence(self, request, pk=None):
        absence = self.get_object()
        absence.status = 'Rejected'
        absence.save()
        notify_employee(absence.employee, 'Congé refusé', f'Votre demande de congé du {absence.start_date} au {absence.end_date} a été refusée.', 'leave_rejected')
        log_action(request.user, 'Refus congé', 'Congés', absence.employee.full_name, request)
        return Response({'status': 'success', 'message': 'Congé refusé.'})


class AttendanceViewSet(viewsets.ModelViewSet):
    queryset = Attendance.objects.all()
    serializer_class = AttendanceSerializer
    permission_classes = [IsManagerOrAbove]

    def perform_create(self, serializer):
        obj = serializer.save()
        log_action(
            self.request.user, 'Enregistrement présence', 'Présences',
            f'{obj.employee.full_name} — {obj.date} ({obj.status})', self.request,
            new_value=obj.status,
        )

    def perform_update(self, serializer):
        old_status = self.get_object().status
        obj = serializer.save()
        log_action(
            self.request.user, 'Modification présence', 'Présences',
            f'{obj.employee.full_name} — {obj.date}', self.request,
            old_value=old_status, new_value=obj.status,
        )


class MissionViewSet(viewsets.ModelViewSet):
    queryset = Mission.objects.all()
    serializer_class = MissionSerializer

    def perform_create(self, serializer):
        obj = serializer.save()
        log_action(self.request.user, 'Création mission', 'Présences', obj.title, self.request)

    def perform_update(self, serializer):
        obj = serializer.save()
        log_action(self.request.user, 'Modification mission', 'Présences', obj.title, self.request)


class DocumentViewSet(viewsets.ModelViewSet):
    queryset = Document.objects.all()
    serializer_class = DocumentSerializer


class RecruitmentViewSet(viewsets.ModelViewSet):
    queryset = Recruitment.objects.all()
    serializer_class = RecruitmentSerializer


def _parse_applicant_benefits(request):
    raw = request.data.get('benefits') or request.data.get('benefits_json')
    if not raw:
        return []
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return []
    return raw


class ApplicantViewSet(viewsets.ModelViewSet):
    queryset = Applicant.objects.all().select_related(
        'recruitment', 'department', 'manager', 'employee', 'position_ref',
    ).prefetch_related('benefits')
    serializer_class = ApplicantSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_permissions(self):
        if self.action in ('list', 'retrieve', 'resume_file'):
            return [IsAuthenticated()]
        return [IsGestionnaireOrAdmin()]

    def get_queryset(self):
        qs = super().get_queryset()
        q = self.request.query_params.get('q') or self.request.query_params.get('search')
        status_filter = self.request.query_params.get('status')
        dept = self.request.query_params.get('department')
        if q:
            qs = search_applicants(qs, q)
        if status_filter:
            qs = qs.filter(status=status_filter)
        if dept:
            qs = qs.filter(department_id=dept)
        return qs.order_by('-updated_at', '-created_at')

    def perform_create(self, serializer):
        applicant = serializer.save()
        sync_applicant_benefits(applicant, _parse_applicant_benefits(self.request))
        log_action(self.request.user, 'Création candidat', 'Recrutement', applicant.full_name, self.request)

    def perform_update(self, serializer):
        old_status = self.get_object().status
        applicant = serializer.save()
        if 'benefits' in self.request.data or 'benefits_json' in self.request.data:
            sync_applicant_benefits(applicant, _parse_applicant_benefits(self.request))
        log_action(
            self.request.user, 'Modification candidat', 'Recrutement',
            applicant.full_name, self.request,
            old_value=old_status if old_status != applicant.status else None,
            new_value=applicant.status if old_status != applicant.status else None,
        )

    @action(detail=True, methods=['post'])
    def hire(self, request, pk=None):
        """Intègre un candidat accepté comme employé."""
        applicant = self.get_object()
        try:
            send_email = request.data.get('send_email', True)
            force_change = request.data.get('force_password_change', True)
            employee, credentials = convert_applicant_to_employee(
                applicant, request.user,
                send_email=send_email, force_password_change=force_change,
            )
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        log_action(
            request.user, 'Intégration candidat → employé', 'Recrutement',
            f'{applicant.full_name} → {employee.matricule}', request,
        )
        return Response({
            'status': 'success',
            'message': f'{applicant.full_name} intégré comme employé {employee.matricule}.',
            'employee': EmployeeSerializer(employee).data,
            'credentials': credentials,
        })

    @action(detail=True, methods=['get'])
    def resume_file(self, request, pk=None):
        """Téléchargement / prévisualisation du CV."""
        applicant = self.get_object()
        if not applicant.resume:
            return Response({'error': 'Aucun CV disponible.'}, status=404)
        full_path = os.path.join(settings.MEDIA_ROOT, applicant.resume.name)
        if not os.path.isfile(full_path):
            return Response({'error': 'Fichier CV introuvable.'}, status=404)
        inline = request.query_params.get('inline') == '1'
        response = FileResponse(open(full_path, 'rb'), filename=os.path.basename(full_path))
        ext = os.path.splitext(full_path)[1].lower()
        content_types = {
            '.pdf': 'application/pdf',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.doc': 'application/msword',
        }
        response['Content-Type'] = content_types.get(ext, 'application/octet-stream')
        if inline:
            response['Content-Disposition'] = f'inline; filename="{os.path.basename(full_path)}"'
        return response

    @action(detail=False, methods=['post'], parser_classes=[MultiPartParser, FormParser])
    def import_candidates(self, request):
        """Import de masse — Excel, CSV ou PDF."""
        upload = request.FILES.get('file')
        if not upload:
            return Response({'error': 'Fichier requis.'}, status=400)
        recruitment_id = request.data.get('recruitment_id')
        recruitment = Recruitment.objects.filter(pk=recruitment_id).first() if recruitment_id else None
        name = upload.name.lower()
        try:
            if name.endswith('.xlsx') or name.endswith('.xls'):
                result = import_from_excel(upload, recruitment)
            elif name.endswith('.csv'):
                result = import_from_csv(upload, recruitment)
            elif name.endswith('.pdf'):
                result = import_from_pdf(upload, recruitment)
            else:
                return Response({'error': 'Format non supporté (xlsx, csv, pdf).'}, status=400)
        except Exception as exc:
            return Response({'error': f'Erreur import: {exc}'}, status=400)
        log_action(
            request.user, 'Import candidats', 'Recrutement',
            f'{result["created"]} candidat(s)', request,
        )
        return Response({'status': 'success', **result})


class TrainingViewSet(viewsets.ModelViewSet):
    queryset = Training.objects.prefetch_related('employees').all()
    serializer_class = TrainingSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        qs = super().get_queryset()
        employee_id = self.request.query_params.get('employee')
        if employee_id:
            qs = qs.filter(employees__id=employee_id)
        status = self.request.query_params.get('status')
        if status:
            qs = qs.filter(status=status)
        return qs.distinct()

    def _sync_training_results(self, training):
        for emp in training.employees.all():
            EmployeeTrainingResult.objects.get_or_create(employee=emp, training=training)

    def perform_create(self, serializer):
        training = serializer.save()
        self._sync_training_results(training)
        log_action(
            self.request.user, 'Création formation', 'Formation',
            training.title, self.request, new_value=training.status,
        )

    def perform_update(self, serializer):
        old_status = self.get_object().status
        training = serializer.save()
        self._sync_training_results(training)
        log_action(
            self.request.user, 'Modification formation', 'Formation',
            training.title, self.request, old_value=old_status, new_value=training.status,
        )

    def perform_destroy(self, instance):
        title = instance.title
        log_action(self.request.user, 'Suppression formation', 'Formation', title, self.request)
        instance.delete()

    @action(detail=True, methods=['post'])
    def enroll_participants(self, request, pk=None):
        training = self.get_object()
        employee_ids = request.data.get('employee_ids', [])
        department_id = request.data.get('department_id')
        added = 0
        if department_id:
            dept_employees = Employee.objects.filter(department_id=department_id, status='Active')
            training.employees.add(*dept_employees)
            added += dept_employees.count()
        if employee_ids:
            emps = Employee.objects.filter(id__in=employee_ids)
            training.employees.add(*emps)
            added += len(employee_ids)
        for emp in training.employees.all():
            EmployeeTrainingResult.objects.get_or_create(employee=emp, training=training)
        log_action(
            request.user, 'Inscription formation', 'Formation',
            f'{training.title} — {training.employees.count()} participant(s)', request,
        )
        data = TrainingSerializer(training).data
        data['participants_added'] = added
        return Response(data)

    @action(detail=False, methods=['get'])
    def dashboard(self, request):
        return Response(training_dashboard_stats())


class PerformanceReviewViewSet(viewsets.ModelViewSet):
    queryset = PerformanceReview.objects.select_related('employee', 'reviewer', 'department').all()
    serializer_class = PerformanceReviewSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        employee_id = self.request.query_params.get('employee')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        return qs

    def perform_create(self, serializer):
        review = serializer.save()
        if not review.reviewer_id:
            profile = getattr(self.request.user, 'profile', None)
            if profile and profile.employee_id:
                review.reviewer_id = profile.employee_id
                review.save(update_fields=['reviewer'])
        log_action(
            self.request.user, 'Création évaluation', 'Performances',
            review.employee.full_name, self.request, new_value=review.star_rating,
        )

    def perform_update(self, serializer):
        old_stars = self.get_object().star_rating
        review = serializer.save()
        log_action(
            self.request.user, 'Modification évaluation', 'Performances',
            review.employee.full_name, self.request, old_value=old_stars, new_value=review.star_rating,
        )

    @action(detail=True, methods=['post'])
    def validate_review(self, request, pk=None):
        review = self.get_object()
        review.status = 'Validated'
        review.save()
        stars = '★' * (review.star_rating or 0)
        notify_employee(
            review.employee, 'Nouvelle évaluation',
            f'Évaluation du {review.review_date} disponible. Note: {stars} ({review.result})',
            'evaluation',
        )
        log_action(request.user, 'Validation évaluation', 'Performances', review.employee.full_name, request)
        return Response({'status': 'success'})

    @action(detail=False, methods=['get'])
    def dashboard(self, request):
        employee_id = request.query_params.get('employee')
        return Response(performance_dashboard_stats(employee_id))


class EmployeeTrainingResultViewSet(viewsets.ModelViewSet):
    queryset = EmployeeTrainingResult.objects.select_related('employee', 'training').all()
    serializer_class = EmployeeTrainingResultSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        employee_id = self.request.query_params.get('employee')
        training_id = self.request.query_params.get('training')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        if training_id:
            qs = qs.filter(training_id=training_id)
        return qs

    def perform_create(self, serializer):
        result = serializer.save()
        log_action(
            self.request.user, 'Création résultat formation', 'Formation',
            f'{result.employee.full_name} — {result.training.title}', self.request,
            new_value=result.score,
        )

    def perform_update(self, serializer):
        old = self.get_object()
        old_score = old.score
        result = serializer.save()
        log_action(
            self.request.user, 'Modification résultat formation', 'Formation',
            f'{result.employee.full_name} — {result.training.title}', self.request,
            old_value=old_score, new_value=result.score,
        )


class SkillCategoryViewSet(viewsets.ModelViewSet):
    queryset = SkillCategory.objects.prefetch_related('skills').all()
    serializer_class = SkillCategorySerializer


class SkillViewSet(viewsets.ModelViewSet):
    queryset = Skill.objects.select_related('category').all()
    serializer_class = SkillSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        category_id = self.request.query_params.get('category')
        if category_id:
            qs = qs.filter(category_id=category_id)
        return qs


class EmployeeSkillViewSet(viewsets.ModelViewSet):
    queryset = EmployeeSkill.objects.select_related('employee', 'skill', 'skill__category').all()
    serializer_class = EmployeeSkillSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        employee_id = self.request.query_params.get('employee')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        return qs


class CertificationViewSet(viewsets.ModelViewSet):
    queryset = Certification.objects.select_related('employee').all()
    serializer_class = CertificationSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        qs = super().get_queryset()
        employee_id = self.request.query_params.get('employee')
        expiry = self.request.query_params.get('expiry')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        if expiry == 'expiring':
            today = timezone.now().date()
            qs = qs.filter(expiry_date__gte=today, expiry_date__lte=today + timedelta(days=90))
        elif expiry == 'expired':
            qs = qs.filter(expiry_date__lt=timezone.now().date())
        return qs

    def perform_create(self, serializer):
        cert = serializer.save()
        check_certification_alerts(cert.employee)
        log_action(self.request.user, 'Ajout certification', 'Performances', cert.title, self.request)


class ObjectiveViewSet(viewsets.ModelViewSet):
    queryset = Objective.objects.select_related('employee').all()
    serializer_class = ObjectiveSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        employee_id = self.request.query_params.get('employee')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        return qs

    def perform_create(self, serializer):
        obj = serializer.save()
        log_action(self.request.user, 'Création objectif', 'Performances', obj.title, self.request, new_value=obj.status)

    def perform_update(self, serializer):
        old_status = self.get_object().status
        obj = serializer.save()
        log_action(
            self.request.user, 'Modification objectif', 'Performances',
            obj.title, self.request, old_value=old_status, new_value=obj.status,
        )


class EmployeeKPIViewSet(viewsets.ModelViewSet):
    queryset = EmployeeKPI.objects.select_related('employee').all()
    serializer_class = EmployeeKPISerializer

    def get_queryset(self):
        qs = super().get_queryset()
        employee_id = self.request.query_params.get('employee')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        return qs

    def perform_create(self, serializer):
        obj = serializer.save()
        log_action(self.request.user, 'Création KPI', 'Performances', obj.name, self.request, new_value=obj.current_value)

    def perform_update(self, serializer):
        old_val = self.get_object().current_value
        obj = serializer.save()
        log_action(
            self.request.user, 'Modification KPI', 'Performances',
            obj.name, self.request, old_value=old_val, new_value=obj.current_value,
        )


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.all()[:200]
    serializer_class = AuditLogSerializer
    permission_classes = [IsGestionnaireOrAdmin]


def _collect_dashboard_stats(request=None):
    from .dashboard_analytics import collect_dashboard_analytics
    params = request.GET if request else {}
    return collect_dashboard_analytics(
        month=params.get('month'),
        year=params.get('year'),
        department_id=params.get('department'),
        employee_id=params.get('employee'),
        contract_type=params.get('contract_type'),
        gender=params.get('gender'),
        age_range=params.get('age_range'),
        site=params.get('site'),
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_stats(request):
    return Response(_collect_dashboard_stats(request))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def talent_dashboard(request):
    return Response(talent_overview_stats())


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sync_stats(request):
    """Statistiques agrégées pour synchronisation temps réel (polling frontend)."""
    return Response(collect_sync_payload(request))


def _get_portal_employee(request):
    role = get_user_role(request.user)
    employee_id = request.query_params.get('employee_id')
    if role == ROLE_EMPLOYE:
        emp = getattr(request.user.profile, 'employee', None)
        if not emp:
            return None, Response({'error': 'Profil employé non lié.'}, status=400)
        return emp, None
    if employee_id:
        return get_object_or_404(Employee, pk=employee_id), None
    return None, Response({'error': 'employee_id requis.'}, status=400)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def employee_portal(request):
    employee, err = _get_portal_employee(request)
    if err:
        return err
    today = timezone.now().date()
    month_start = today.replace(day=1)
    attendances = employee.attendances.filter(date__gte=month_start)
    payslips_qs = employee.payrolls.filter(status__in=['VALIDATED', 'PAID', 'ARCHIVED']).order_by('-month')
    export_logs = PayrollExportLog.objects.filter(payroll__employee=employee).select_related(
        'payroll', 'exported_by',
    ).order_by('-exported_at')[:30]
    return Response({
        'employee': EmployeeSerializer(employee).data,
        'payslips': PayrollSerializer(payslips_qs, many=True).data,
        'export_history': PayrollExportLogSerializer(export_logs, many=True).data,
        'documents': DocumentSerializer(employee.documents.all(), many=True).data,
        'absences': AbsenceSerializer(employee.absences.all().order_by('-start_date'), many=True).data,
        'trainings': TrainingSerializer(employee.trainings.all(), many=True).data,
        'training_results': EmployeeTrainingResultSerializer(employee.training_results.all(), many=True).data,
        'reviews': PerformanceReviewSerializer(employee.performance_reviews.all().order_by('-review_date'), many=True).data,
        'skills': EmployeeSkillSerializer(
            employee.employee_skills.select_related('skill', 'skill__category').all(), many=True,
        ).data,
        'certifications': CertificationSerializer(employee.certifications.all(), many=True).data,
        'objectives': ObjectiveSerializer(employee.objectives.all(), many=True).data,
        'kpis': EmployeeKPISerializer(employee.kpis.all(), many=True).data,
        'attendances': AttendanceSerializer(attendances.order_by('-date')[:30], many=True).data,
        'missions': MissionSerializer(employee.missions.all().order_by('-start_date'), many=True).data,
        'notifications': NotificationSerializer(employee.notifications.filter(is_read=False)[:20], many=True).data,
        'leave_balance': float(employee.leave_balance),
        'attendance_summary': {
            'present': attendances.filter(status='Present').count(),
            'late': attendances.filter(status='Late').count(),
            'absent': attendances.filter(status='Absent').count(),
        },
    })


@api_view(['PUT', 'PATCH'])
@permission_classes([IsAuthenticated])
def update_employee_profile(request):
    role = get_user_role(request.user)
    if role != ROLE_EMPLOYE:
        return Response({'error': 'Réservé aux employés.'}, status=403)
    emp = getattr(request.user.profile, 'employee', None)
    if not emp:
        return Response({'error': 'Profil non lié.'}, status=400)
    allowed = ['phone_number', 'address', 'email', 'emergency_contact_name', 'emergency_contact_phone']
    for field in allowed:
        if field in request.data:
            setattr(emp, field, request.data[field])
    emp.save()
    log_action(request.user, 'Mise à jour profil', 'Portail', emp.full_name, request)
    return Response(EmployeeSerializer(emp).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def employee_notifications(request):
    emp = getattr(request.user.profile, 'employee', None)
    if not emp:
        return Response({'error': 'Profil non lié.'}, status=400)
    notifs = NotificationSerializer(emp.notifications.all()[:50], many=True)
    return Response(notifs.data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_notification_read(request, notif_id):
    emp = getattr(request.user.profile, 'employee', None)
    notif = get_object_or_404(Notification, pk=notif_id, employee=emp)
    notif.is_read = True
    notif.save()
    return Response({'status': 'success'})


@api_view(['GET', 'PUT', 'PATCH'])
@permission_classes([IsAuthenticated])
def company_settings_view(request):
    settings_obj = CompanySettings.get_settings()
    if request.method == 'GET':
        return Response(CompanySettingsSerializer(settings_obj).data)
    from .permissions import is_settings_admin
    if not is_settings_admin(request.user):
        return Response({'error': 'Accès réservé à l\'Administrateur RH.'}, status=403)
    ser = CompanySettingsSerializer(settings_obj, data=request.data, partial=True)
    ser.is_valid(raise_exception=True)
    ser.save()
    log_action(request.user, 'Mise à jour paramètres entreprise', 'Paramètres', settings_obj.company_name, request)
    return Response(CompanySettingsSerializer(settings_obj).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def company_logo_upload(request):
    from .permissions import is_settings_admin
    if not is_settings_admin(request.user):
        return Response({'error': 'Accès réservé à l\'Administrateur RH.'}, status=403)
    settings_obj = CompanySettings.get_settings()
    uploaded = request.FILES.get('logo')
    if not uploaded:
        return Response({'error': 'Fichier logo requis.'}, status=400)
    try:
        validate_logo_file(uploaded, settings_obj.logo_max_size_mb)
    except ValueError as e:
        return Response({'error': str(e)}, status=400)
    settings_obj.logo = uploaded
    settings_obj.logo_url = ''
    settings_obj.save()
    log_action(request.user, 'Upload logo entreprise', 'Paramètres', uploaded.name, request)
    return Response(CompanySettingsSerializer(settings_obj).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def company_logo_from_url(request):
    from .permissions import is_settings_admin
    if not is_settings_admin(request.user):
        return Response({'error': 'Accès réservé à l\'Administrateur RH.'}, status=403)
    url = request.data.get('logo_url', '').strip()
    if not url:
        return Response({'error': 'URL requise.'}, status=400)
    settings_obj = CompanySettings.get_settings()
    try:
        filename, content = download_logo_from_url(url, settings_obj.logo_max_size_mb)
        settings_obj.logo.save(filename, content, save=False)
        settings_obj.logo_url = url
        settings_obj.save()
    except Exception as e:
        return Response({'error': f'Impossible de télécharger l\'image: {e}'}, status=400)
    log_action(request.user, 'Logo depuis URL', 'Paramètres', url, request)
    return Response(CompanySettingsSerializer(settings_obj).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def export_report(request):
    path = request.path.rstrip('/')
    if path.endswith('excel'):
        fmt = 'excel'
    elif path.endswith('word'):
        fmt = 'word'
    else:
        fmt = request.query_params.get('format', 'pdf')
    stats_data = _collect_dashboard_stats()
    stats = {
        'Effectif total': stats_data['total_employees'],
        'Masse salariale ($)': stats_data['payroll_mass'],
        'Taux absentéisme (%)': stats_data['absenteeism_rate'],
        'Recrutements en cours': stats_data['open_recruitments'],
        'Formations': stats_data['trainings_count'],
        'Évaluations': stats_data['evaluations_count'],
        'Hommes': stats_data['gender_distribution']['hommes'],
        'Femmes': stats_data['gender_distribution']['femmes'],
    }
    company = CompanySettings.get_settings()
    title = company.report_title
    generators = {'pdf': generate_report_pdf, 'excel': generate_report_excel, 'word': generate_report_word}
    if fmt not in generators:
        return Response({'error': 'Format invalide (pdf, excel, word).'}, status=400)
    path = generators[fmt](title, stats)
    report = Report.objects.create(
        title=title, report_type=fmt, generated_by=request.user,
        **{f'file_{fmt}': path},
    )
    log_action(request.user, f'Export rapport {fmt}', 'Reporting', title, request)
    return Response({'status': 'success', 'url': f'/media/{path}', 'report_id': report.id})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def export_payslip(request):
    payroll_id = request.query_params.get('payroll_id')
    fmt = request.query_params.get('export_format') or request.query_params.get('format', 'pdf')
    if not payroll_id:
        return Response({'error': 'payroll_id requis.'}, status=400)
    payroll = get_object_or_404(Payroll, pk=payroll_id)
    if not can_access_payroll(request.user, payroll):
        return Response({'error': 'Accès refusé.'}, status=403)
    if payroll.status not in ('VALIDATED', 'PAID', 'ARCHIVED'):
        return Response({'error': 'Le bulletin doit être validé avant export.'}, status=400)
    if fmt not in ('pdf', 'excel', 'word'):
        return Response({'error': 'Format invalide (pdf, excel, word).'}, status=400)
    result = export_payslip_file(payroll, fmt, user=request.user, archive=True)
    log_action(request.user, f'Export bulletin {fmt}', 'Paie', payroll.employee.full_name, request)
    return Response({
        'status': 'success',
        'url': result['url'],
        'filename': result['filename'],
        'payroll_id': payroll.id,
        'preview_url': result['url'] if fmt == 'pdf' else None,
    })


def _individual_export_core(request, as_download=False):
    """Logique centrale export individuel — un employé, un fichier."""
    if not can_export_payroll_individual(request.user):
        logger.warning('Export individuel refusé user=%s role=%s', request.user, get_user_role(request.user))
        return Response({'error': 'Réservé aux gestionnaires RH / Paie.'}, status=403)
    employee_id, month, year, fmt = parse_individual_export_params(request)
    logger.info(
        'Export individuel demandé employee=%s month=%s year=%s fmt=%s download=%s qp=%s',
        employee_id, month, year, fmt, as_download,
        dict(getattr(request, 'query_params', request.GET)),
    )
    if not employee_id or not month or not year:
        return Response({'error': 'Paramètres manquants (employee_id, month, year).'}, status=400)
    payroll, err = resolve_payroll(employee_id, month, year)
    if err:
        return err
    if fmt not in ('pdf', 'excel', 'word'):
        return Response({'error': 'Format invalide (pdf, excel, word).'}, status=400)
    if as_download:
        file_response, err = individual_export_file_response(payroll, fmt, request.user)
        if err:
            return err
        log_action(
            request.user, f'Téléchargement bulletin {fmt}',
            'Paie', f'{payroll.employee.matricule} {month}/{year}', request,
        )
        return file_response
    payload = individual_export_response(payroll, fmt, request.user)
    log_action(
        request.user, f'Export individuel {fmt}',
        'Paie', f'{payroll.employee.matricule} {month}/{year}', request,
    )
    return Response(payload)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def export_payslip_individual(request):
    """Export individuel JSON — métadonnées + URL fichier."""
    return _individual_export_core(request, as_download=False)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def export_payslip_individual_download(request):
    """Export individuel — téléchargement direct du fichier (un seul employé)."""
    return _individual_export_core(request, as_download=True)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payslip_preview(request):
    """Prévisualisation PDF d'un bulletin validé."""
    payroll_id = request.query_params.get('payroll_id')
    employee_id = request.query_params.get('employee_id')
    month = request.query_params.get('month')
    year = request.query_params.get('year')
    if payroll_id:
        payroll = get_object_or_404(Payroll, pk=payroll_id)
    else:
        payroll, err = resolve_payroll(employee_id, month, year)
        if err:
            return err
    if not can_access_payroll(request.user, payroll):
        return Response({'error': 'Accès refusé.'}, status=403)
    if payroll.status not in ('VALIDATED', 'PAID', 'ARCHIVED'):
        return Response({'error': 'Bulletin non validé.'}, status=400)
    result = export_payslip_file(payroll, 'pdf', user=request.user, archive=False)
    return Response({
        'status': 'success',
        'url': result['url'],
        'filename': result['filename'],
        'payroll_id': payroll.id,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def send_payslip_by_email(request):
    """Envoi optionnel du bulletin par email à l'employé."""
    if not can_export_payroll_individual(request.user):
        return Response({'error': 'Réservé aux gestionnaires RH / Paie.'}, status=403)
    payroll_id = request.data.get('payroll_id')
    employee_id = request.data.get('employee_id')
    month = request.data.get('month')
    year = request.data.get('year')
    fmt = request.data.get('export_format') or request.data.get('format', 'pdf')
    recipient = request.data.get('email')
    if payroll_id:
        payroll = get_object_or_404(Payroll, pk=payroll_id)
    else:
        payroll, err = resolve_payroll(employee_id, month, year)
        if err:
            return err
    if payroll.status not in ('VALIDATED', 'PAID', 'ARCHIVED'):
        return Response({'error': 'Le bulletin doit être validé.'}, status=400)
    if fmt not in ('pdf', 'excel', 'word'):
        return Response({'error': 'Format invalide.'}, status=400)
    try:
        ok, msg = send_payslip_email(payroll, fmt, request.user, recipient=recipient or None)
    except Exception as exc:
        return Response({'error': f'Envoi email échoué : {exc}'}, status=500)
    if not ok:
        return Response({'error': msg}, status=400)
    log_action(request.user, 'Envoi bulletin email', 'Paie', payroll.employee.full_name, request)
    return Response({'status': 'success', 'message': f'Bulletin envoyé à {msg}.'})


def _payrolls_for_month(month, year, statuses=None):
    try:
        target = datetime(int(year), int(month), 1).date()
    except (ValueError, TypeError):
        return None, Response({'error': 'month et year requis (entiers).'}, status=400)
    payrolls = Payroll.objects.filter(month=target).select_related('employee')
    if statuses is not None:
        payrolls = payrolls.filter(status__in=statuses)
    return payrolls, None


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payroll_summary(request):
    month = request.query_params.get('month')
    year = request.query_params.get('year')
    all_qs, err = _payrolls_for_month(month, year, statuses=None)
    if err:
        return err
    validated = all_qs.filter(status__in=['VALIDATED', 'PAID', 'ARCHIVED'])
    agg = validated.aggregate(
        avg_presence=Avg('presence_rate'),
        total_overtime=Sum('overtime_hours'),
        total_late=Sum('late_minutes'),
        total_absent_days=Sum('days_absent'),
    )
    return Response({
        'total_bulletins': all_qs.count(),
        'validated_count': validated.count(),
        'draft_count': all_qs.filter(status='DRAFT').count(),
        'pending_count': all_qs.filter(status='PENDING').count(),
        'paid_count': all_qs.filter(status='PAID').count(),
        'gross_mass': float(validated.aggregate(t=Sum('gross_salary'))['t'] or 0),
        'net_mass': float(validated.aggregate(t=Sum('net_salary'))['t'] or 0),
        'cnss_total': float(validated.aggregate(t=Sum('cnss_salarie'))['t'] or 0),
        'irpp_total': float(validated.aggregate(t=Sum('irpp'))['t'] or 0),
        'avg_presence_rate': float(agg['avg_presence'] or 0),
        'total_overtime_hours': float(agg['total_overtime'] or 0),
        'total_late_minutes': int(agg['total_late'] or 0),
        'total_absent_days': int(agg['total_absent_days'] or 0),
        'absenteeism_rate': round(
            (int(agg['total_absent_days'] or 0) / max(validated.count() * 22, 1)) * 100, 1
        ),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def export_payroll_month(request):
    """Export GLOBAL — état récapitulatif mensuel (plusieurs employés)."""
    if not can_export_payroll_global(request.user):
        return Response({'error': 'Export global réservé aux administrateurs et gestionnaires paie.'}, status=403)
    path_url = request.path.rstrip('/')
    if path_url.endswith('excel'):
        fmt = 'excel'
    elif path_url.endswith('word'):
        fmt = 'word'
    else:
        fmt = 'pdf'
    month = request.query_params.get('month')
    year = request.query_params.get('year')
    payrolls, err = _payrolls_for_month(month, year, statuses=['VALIDATED', 'PAID', 'ARCHIVED'])
    if err:
        return err
    if not payrolls.exists():
        return Response({'error': 'Aucun bulletin validé pour cette période.'}, status=404)
    target = datetime(int(year), int(month), 1).date()
    generators = {
        'pdf': generate_payroll_mass_pdf,
        'excel': generate_payroll_excel,
        'word': generate_payroll_mass_word,
    }
    file_path = generators[fmt](target, payrolls)
    title = f'État de paie {target.strftime("%m/%Y")}'
    Report.objects.create(
        title=title, report_type=f'payroll_{fmt}', generated_by=request.user,
        **{f'file_{fmt}': file_path},
    )
    log_action(request.user, f'Export paie masse {fmt}', 'Paie', title, request)
    from .exports import global_payroll_filename
    ext_map = {'pdf': 'pdf', 'excel': 'xlsx', 'word': 'docx'}
    return Response({
        'status': 'success',
        'url': f'/media/{file_path}',
        'filename': global_payroll_filename(target, ext_map[fmt]),
        'count': payrolls.count(),
        'format': fmt,
        'export_type': 'global',
        'message': f'État global de paie — {payrolls.count()} employé(s). Ce document n\'est PAS un bulletin individuel.',
    })


def _reorder_items(model_cls, ids):
    for order, item_id in enumerate(ids):
        model_cls.objects.filter(pk=item_id).update(display_order=order)


class AppModuleViewSet(viewsets.ModelViewSet):
    queryset = AppModule.objects.prefetch_related('features', 'custom_fields').all()
    serializer_class = AppModuleSerializer

    def get_serializer_class(self):
        if self.action == 'list':
            return AppModuleListSerializer
        return AppModuleSerializer

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [IsAuthenticated()]
        return [IsAdminRH()]

    def perform_create(self, serializer):
        obj = serializer.save()
        log_action(self.request.user, 'Création module', 'Personnalisation', obj.name, self.request)

    def perform_update(self, serializer):
        obj = serializer.save()
        log_action(self.request.user, 'Modification module', 'Personnalisation', obj.name, self.request)

    def perform_destroy(self, instance):
        name = instance.name
        instance.delete()
        log_action(self.request.user, 'Suppression module', 'Personnalisation', name, self.request)

    @action(detail=True, methods=['post'])
    def toggle(self, request, pk=None):
        mod = self.get_object()
        mod.is_active = not mod.is_active
        mod.save()
        state = 'activé' if mod.is_active else 'désactivé'
        log_action(request.user, f'Module {state}', 'Personnalisation', mod.name, request)
        return Response(AppModuleSerializer(mod).data)

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'error': 'ids requis.'}, status=400)
        _reorder_items(AppModule, ids)
        log_action(request.user, 'Réorganisation modules', 'Personnalisation', str(ids), request)
        return Response({'status': 'success'})


class ModuleFeatureViewSet(viewsets.ModelViewSet):
    queryset = ModuleFeature.objects.select_related('module').all()
    serializer_class = ModuleFeatureSerializer

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [IsAuthenticated()]
        return [IsAdminRH()]

    def get_queryset(self):
        qs = super().get_queryset()
        module_id = self.request.query_params.get('module')
        if module_id:
            qs = qs.filter(module_id=module_id)
        return qs

    def perform_create(self, serializer):
        obj = serializer.save()
        log_action(self.request.user, 'Ajout fonctionnalité', 'Personnalisation',
                   f'{obj.module.name} — {obj.feature_name}', self.request)

    def perform_update(self, serializer):
        obj = serializer.save()
        log_action(self.request.user, 'Modification fonctionnalité', 'Personnalisation',
                   f'{obj.module.name} — {obj.feature_name}', self.request)

    def perform_destroy(self, instance):
        label = f'{instance.module.name} — {instance.feature_name}'
        instance.delete()
        log_action(self.request.user, 'Suppression fonctionnalité', 'Personnalisation', label, self.request)

    @action(detail=True, methods=['post'])
    def toggle(self, request, pk=None):
        feat = self.get_object()
        feat.is_active = not feat.is_active
        feat.save()
        state = 'activée' if feat.is_active else 'désactivée'
        log_action(request.user, f'Fonctionnalité {state}', 'Personnalisation', feat.feature_name, request)
        return Response(ModuleFeatureSerializer(feat).data)

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'error': 'ids requis.'}, status=400)
        _reorder_items(ModuleFeature, ids)
        return Response({'status': 'success'})


class CustomFieldViewSet(viewsets.ModelViewSet):
    queryset = CustomField.objects.select_related('module').all()
    serializer_class = CustomFieldSerializer

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [IsAuthenticated()]
        return [IsAdminRH()]

    def get_queryset(self):
        qs = super().get_queryset()
        module_id = self.request.query_params.get('module')
        if module_id:
            qs = qs.filter(module_id=module_id)
        return qs

    def perform_create(self, serializer):
        obj = serializer.save()
        log_action(self.request.user, 'Ajout champ', 'Personnalisation',
                   f'{obj.module.name} — {obj.field_name}', self.request)

    def perform_update(self, serializer):
        obj = serializer.save()
        log_action(self.request.user, 'Modification champ', 'Personnalisation',
                   f'{obj.module.name} — {obj.field_name}', self.request)

    def perform_destroy(self, instance):
        label = f'{instance.module.name} — {instance.field_name}'
        instance.delete()
        log_action(self.request.user, 'Suppression champ', 'Personnalisation', label, self.request)

    @action(detail=True, methods=['post'])
    def toggle_visible(self, request, pk=None):
        field = self.get_object()
        field.visible = not field.visible
        field.save()
        return Response(CustomFieldSerializer(field).data)

    @action(detail=True, methods=['post'])
    def toggle_active(self, request, pk=None):
        field = self.get_object()
        field.visible = not field.visible
        field.save()
        return Response(CustomFieldSerializer(field).data)

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'error': 'ids requis.'}, status=400)
        _reorder_items(CustomField, ids)
        return Response({'status': 'success'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def module_config_view(request):
    """Configuration runtime des modules pour le frontend."""
    role = get_user_role(request.user)
    modules = AppModule.objects.filter(is_active=True).prefetch_related('features', 'custom_fields')
    result = []
    for mod in modules:
        if role not in mod.role_list():
            continue
        result.append({
            'id': mod.id,
            'key': mod.key,
            'name': mod.name,
            'description': mod.description,
            'icon': mod.icon,
            'is_active': mod.is_active,
            'display_order': mod.display_order,
            'allowed_roles': mod.allowed_roles,
            'features': ModuleFeatureSerializer(
                mod.features.filter(is_active=True), many=True
            ).data,
            'custom_fields': CustomFieldSerializer(
                mod.custom_fields.filter(visible=True), many=True
            ).data,
        })
    return Response({'modules': sorted(result, key=lambda m: m['display_order'])})
