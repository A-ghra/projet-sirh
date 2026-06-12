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
    EmployeeSerializer, EmployeeMovementSerializer, ContractSerializer, ContractAmendmentSerializer,
    ContractTypeConfigSerializer, PayrollSerializer,
    PayrollCalculationLogSerializer, PayrollExportLogSerializer, AbsenceSerializer, AttendanceSerializer,
    MissionSerializer, MissionDocumentSerializer, DocumentSerializer, NotificationSerializer,
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


class ContractTypeViewSet(viewsets.ModelViewSet):
    from .models import ContractTypeConfig
    queryset = ContractTypeConfig.objects.all()
    serializer_class = ContractTypeConfigSerializer

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [IsAuthenticated()]
        return [IsGestionnaireOrAdmin()]


class ContractViewSet(viewsets.ModelViewSet):
    queryset = Contract.objects.select_related(
        'employee', 'employee__department', 'employee__manager',
    ).prefetch_related('amendments')
    serializer_class = ContractSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_permissions(self):
        if self.action in ('list', 'retrieve', 'dashboard', 'export_contract', 'export_individual', 'types'):
            return [IsAuthenticated()]
        if self.action == 'sign_contract':
            return [IsAuthenticated()]
        if self.action == 'export_global':
            return [IsGestionnaireOrAdmin()]
        return [IsGestionnaireOrAdmin()]

    def get_queryset(self):
        from .contract_service import filter_contracts_for_user
        qs = filter_contracts_for_user(self.request.user)
        params = self.request.query_params
        if params.get('contract_type'):
            qs = qs.filter(contract_type=params['contract_type'])
        if params.get('status'):
            qs = qs.filter(status=params['status'])
        if params.get('department'):
            qs = qs.filter(employee__department_id=params['department'])
        emp_id = params.get('employee') or params.get('employee_id')
        if emp_id:
            qs = qs.filter(employee_id=emp_id)
        if params.get('year'):
            qs = qs.filter(start_date__year=params['year'])
        if params.get('month'):
            try:
                qs = qs.filter(start_date__month=int(params['month']))
            except (TypeError, ValueError):
                pass
        if params.get('expiring'):
            from datetime import timedelta
            today = timezone.now().date()
            qs = qs.filter(
                is_active=True, end_date__isnull=False,
                end_date__gte=today, end_date__lte=today + timedelta(days=90),
            )
        lifecycle = params.get('lifecycle')
        if lifecycle:
            from .contract_service import compute_lifecycle_status
            today = timezone.now().date()
            ids = [c.id for c in qs if compute_lifecycle_status(c, today) == lifecycle]
            qs = qs.filter(id__in=ids)
        search = params.get('search') or params.get('q')
        if search:
            qs = qs.filter(
                Q(employee__full_name__icontains=search)
                | Q(employee__matricule__icontains=search)
                | Q(contract_number__icontains=search)
                | Q(contract_type__icontains=search)
            )
        return qs.order_by('-start_date', '-id')

    def perform_create(self, serializer):
        from .contract_service import generate_contract_number, user_can_write_contract
        from rest_framework.exceptions import PermissionDenied
        if not user_can_write_contract(self.request.user):
            raise PermissionDenied('Création non autorisée.')
        emp = serializer.validated_data.get('employee')
        if not serializer.validated_data.get('contract_number'):
            serializer.validated_data['contract_number'] = generate_contract_number(emp)
        if not serializer.validated_data.get('position_title') and emp:
            serializer.validated_data['position_title'] = emp.position
        obj = serializer.save(created_by=self.request.user, source='MANUAL')
        from .contract_service import log_contract_archive
        log_contract_archive(obj, 'CREATE', self.request.user, note='Création manuelle')
        log_action(self.request.user, 'Création contrat', 'Contrats', obj.contract_number, self.request)

    def perform_update(self, serializer):
        from .contract_service import ensure_contract_editable, user_can_write_contract
        from rest_framework.exceptions import PermissionDenied
        if not user_can_write_contract(self.request.user, serializer.instance):
            raise PermissionDenied('Modification non autorisée.')
        ensure_contract_editable(serializer.instance)
        old = serializer.instance.status
        obj = serializer.save()
        from .contract_service import log_contract_archive
        log_contract_archive(obj, 'UPDATE', self.request.user, note=f'{old} → {obj.status}')
        log_action(
            self.request.user, 'Modification contrat', 'Contrats', obj.contract_number,
            self.request, old_value=old, new_value=obj.status,
        )

    def perform_destroy(self, instance):
        from .contract_service import user_can_delete_contract, log_contract_archive
        from rest_framework.exceptions import PermissionDenied
        if not user_can_delete_contract(self.request.user, instance):
            raise PermissionDenied('Suppression non autorisée pour ce contrat.')
        log_contract_archive(instance, 'DELETE', self.request.user)
        log_action(self.request.user, 'Suppression contrat', 'Contrats', instance.contract_number, self.request)
        instance.delete()

    @action(detail=False, methods=['get'], url_path='dashboard')
    def dashboard(self, request):
        from .contract_service import build_contract_dashboard
        qs = self.filter_queryset(self.get_queryset())
        return Response(build_contract_dashboard(qs))

    @action(detail=False, methods=['get'], url_path='types')
    def types(self, request):
        from .contract_service import get_active_contract_types
        return Response(get_active_contract_types())

    @action(detail=False, methods=['post'], url_path='import-contracts', parser_classes=[MultiPartParser, FormParser])
    def import_contracts(self, request):
        from .contract_import import import_from_csv, import_from_excel
        f = request.FILES.get('file')
        if not f:
            return Response({'error': 'Fichier requis.'}, status=400)
        name = f.name.lower()
        if name.endswith('.csv'):
            result = import_from_csv(f, user=request.user)
        elif name.endswith(('.xlsx', '.xls')):
            result = import_from_excel(f, user=request.user)
        else:
            return Response({'error': 'Format non supporté. Utilisez CSV ou XLSX.'}, status=400)
        log_action(request.user, 'Import contrats', 'Contrats', f'{result["created"]} créé(s)', request)
        return Response(result)

    @action(detail=False, methods=['post'], url_path='import-document', parser_classes=[MultiPartParser, FormParser])
    def import_document(self, request):
        """Importe un document contrat (PDF, DOCX, image) pour un employé."""
        from .contract_service import import_contract_document
        from .models import Employee
        f = request.FILES.get('file')
        emp_id = request.data.get('employee')
        if not f or not emp_id:
            return Response({'error': 'Employé et fichier requis.'}, status=400)
        name = f.name.lower()
        allowed = ('.pdf', '.docx', '.doc', '.jpg', '.jpeg', '.png')
        if not any(name.endswith(ext) for ext in allowed):
            return Response({'error': 'Formats autorisés : PDF, DOCX, JPG, JPEG, PNG.'}, status=400)
        employee = get_object_or_404(Employee, pk=emp_id)
        contract = import_contract_document(
            employee, f, request.user,
            description=request.data.get('description', ''),
            contract_type=request.data.get('contract_type', 'CDI'),
            start_date=request.data.get('start_date') or None,
        )
        return Response(self.get_serializer(contract).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='export-individual')
    def export_individual(self, request):
        """Export d'un seul contrat (employé + contrat + format)."""
        from .contract_export import contract_export_response
        from .contract_service import filter_contracts_for_user
        contract_id = request.query_params.get('contract_id')
        emp_id = request.query_params.get('employee_id') or request.query_params.get('employee')
        fmt = request.query_params.get('export_format') or request.query_params.get('format', 'pdf')
        if not contract_id:
            return Response({'error': 'Veuillez sélectionner un contrat.'}, status=400)
        contract = get_object_or_404(
            Contract.objects.select_related(
                'employee', 'employee__department', 'employee__manager',
            ),
            pk=contract_id,
        )
        if emp_id and str(contract.employee_id) != str(emp_id):
            return Response({'error': 'Le contrat ne correspond pas à l\'employé sélectionné.'}, status=400)
        allowed = filter_contracts_for_user(request.user).filter(pk=contract.pk)
        if not allowed.exists():
            return Response({'error': 'Accès refusé à ce contrat.'}, status=403)
        log_action(
            request.user, 'Export individuel contrat', 'Contrats',
            f'{contract.contract_number} — {fmt}', request,
        )
        return contract_export_response(contract, fmt, user=request.user, export_type='individual')

    @action(detail=False, methods=['get'], url_path='export-global')
    def export_global(self, request):
        from .contract_export import export_global_response
        qs = self.filter_queryset(self.get_queryset())
        if not qs.exists():
            return Response(
                {'error': 'Aucun contrat disponible pour les critères sélectionnés.'},
                status=404,
            )
        fmt = request.query_params.get('export_format') or request.query_params.get('format', 'xlsx')
        try:
            response = export_global_response(qs, fmt, user=request.user)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        log_action(
            request.user, 'Export global contrats', 'Contrats',
            f'{qs.count()} contrat(s) — {fmt}', request,
        )
        return response

    @action(detail=True, methods=['get'], url_path='archive-logs')
    def archive_logs(self, request, pk=None):
        from .models import ContractArchiveLog
        contract = self.get_object()
        logs = contract.archive_logs.select_related('user').all()[:50]
        data = [{
            'action': log.action,
            'action_label': log.get_action_display(),
            'user': log.user.username if log.user else '-',
            'note': log.note,
            'created_at': log.created_at.isoformat(),
        } for log in logs]
        return Response(data)

    @action(detail=True, methods=['get'], url_path='export')
    def export_contract(self, request, pk=None):
        from .contract_export import contract_export_response
        contract = self.get_object()
        fmt = request.query_params.get('export_format') or request.query_params.get('format', 'pdf')
        log_action(
            request.user, 'Export contrat', 'Contrats',
            f'{contract.contract_number} — {fmt}', request,
        )
        return contract_export_response(contract, fmt, user=request.user, export_type='individual')

    @action(detail=True, methods=['post'], url_path='sign')
    def sign_contract(self, request, pk=None):
        from .contract_service import apply_contract_signatures
        contract = self.get_object()
        role = request.data.get('role', 'employee')
        if role == 'employee':
            emp = getattr(request.user.profile, 'employee', None)
            if not emp or emp.id != contract.employee_id:
                return Response({'error': 'Signature employé non autorisée.'}, status=403)
        elif get_user_role(request.user) not in (ROLE_ADMIN, ROLE_GESTIONNAIRE):
            return Response({'error': 'Signature RH/Direction réservée aux gestionnaires.'}, status=403)
        contract = apply_contract_signatures(contract, role, request.data, request.user)
        return Response(self.get_serializer(contract).data)

    @action(detail=True, methods=['post'], url_path='cancel')
    def cancel_contract(self, request, pk=None):
        from .contract_service import cancel_contract
        contract = self.get_object()
        contract = cancel_contract(contract, request.user, request.data.get('reason', ''))
        return Response(self.get_serializer(contract).data)

    @action(detail=True, methods=['post'], url_path='archive')
    def archive_contract(self, request, pk=None):
        from .contract_service import archive_contract
        contract = self.get_object()
        contract = archive_contract(contract, request.user)
        return Response(self.get_serializer(contract).data)

    @action(detail=True, methods=['post'], url_path='renew')
    def renew_contract(self, request, pk=None):
        from .contract_service import renew_contract, generate_contract_number
        old = self.get_object()
        data = renew_contract(old, request.user, request.data)
        serializer = self.get_serializer(data={
            **data,
            'contract_number': generate_contract_number(old.employee),
            'contract_type': data.get('contract_type', old.contract_type),
            'transport_allowance': old.transport_allowance,
            'housing_allowance': old.housing_allowance,
            'work_schedule': old.work_schedule,
            'currency': old.currency,
        })
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'post'], url_path='amendments')
    def amendments(self, request, pk=None):
        from .models import ContractAmendment
        from .serializers import ContractAmendmentSerializer
        contract = self.get_object()
        if request.method == 'GET':
            ser = ContractAmendmentSerializer(contract.amendments.all(), many=True)
            return Response(ser.data)
        num = request.data.get('amendment_number') or f'AVN-{contract.amendments.count() + 1:03d}'
        ser = ContractAmendmentSerializer(data={**request.data, 'contract': contract.id, 'amendment_number': num})
        ser.is_valid(raise_exception=True)
        ser.save()
        log_action(request.user, 'Création avenant', 'Contrats', f'{contract.contract_number}/{num}', request)
        return Response(ser.data, status=status.HTTP_201_CREATED)


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
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        from .presence_service import filter_absence_queryset
        return filter_absence_queryset(self.request.user)

    def perform_create(self, serializer):
        from .presence_service import get_user_employee
        if not serializer.validated_data.get('absence_type'):
            serializer.validated_data['absence_type'] = 'CP'
        emp = get_user_employee(self.request.user)
        if get_user_role(self.request.user) == ROLE_EMPLOYE and emp:
            serializer.validated_data['employee'] = emp
        obj = serializer.save()
        from .presence_service import notify_leave_request_created
        notify_leave_request_created(obj)
        log_action(self.request.user, 'Demande congé', 'Congés', obj.employee.full_name, self.request)

    @action(detail=False, methods=['post'], url_path='leave-request')
    def leave_request(self, request):
        """Alias POST /api/absences/leave-request/ — demande de congé."""
        return self.create(request)

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
    queryset = Attendance.objects.all().select_related('employee', 'employee__department')
    serializer_class = AttendanceSerializer

    def get_permissions(self):
        auth_actions = (
            'list', 'retrieve', 'report', 'grid', 'summary', 'leaves', 'attendance_missions',
            'create', 'pointages', 'conges', 'leave_request', 'auto_absences',
            'submit_justification', 'contest_absence',
        )
        if self.action in auth_actions:
            return [IsAuthenticated()]
        return [IsManagerOrAbove()]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['allow_manual_absence'] = False
        return ctx

    def _after_attendance_saved(self, obj):
        from .auto_absence_service import resolve_alert_if_covered
        from .models import AbsenceAlert
        from django.utils import timezone as tz
        for alert in AbsenceAlert.objects.filter(employee=obj.employee, date=obj.date, status='pending'):
            resolve_alert_if_covered(alert)
        if obj.record_source == 'auto' and obj.event_type != 'absence':
            obj.absence_workflow_status = 'regularized'
            obj.save(update_fields=['absence_workflow_status'])
            AbsenceAlert.objects.filter(
                employee=obj.employee, date=obj.date, status='auto_created',
            ).update(status='regularized', resolved_at=tz.now())

    def get_queryset(self):
        from .presence_service import filter_attendance_queryset
        qs = filter_attendance_queryset(self.request.user)
        month = self.request.query_params.get('month')
        year = self.request.query_params.get('year')
        employee_id = self.request.query_params.get('employee')
        if month and year:
            from .presence_service import _month_bounds, _parse_int
            from django.utils import timezone as tz
            today = tz.now().date()
            m = _parse_int(month, today.month)
            y = _parse_int(year, today.year)
            start, end = _month_bounds(y, m)
            qs = qs.filter(date__gte=start, date__lte=end)
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        return qs.order_by('-date', '-id')

    def _upsert_attendance(self, request, payload):
        emp_id = payload.get('employee')
        att_date = payload.get('date')
        if emp_id and att_date:
            existing = Attendance.objects.filter(employee_id=emp_id, date=att_date).first()
            if existing:
                update_serializer = self.get_serializer(existing, data=payload, partial=True)
                update_serializer.is_valid(raise_exception=True)
                self.perform_update(update_serializer)
                return Response(update_serializer.data)
        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def create(self, request, *args, **kwargs):
        return self._upsert_attendance(request, request.data)

    def _save_attendance_from_serializer(self, serializer):
        from .presence_service import prepare_attendance_payload
        raw_type = self.request.data.get('event_type')
        merged = dict(serializer.validated_data)
        prepared = prepare_attendance_payload(merged)
        if raw_type == 'late':
            prepared['status'] = 'Late'
        if serializer.validated_data.get('status'):
            prepared['status'] = serializer.validated_data['status']
        return serializer.save(
            status=prepared['status'],
            event_type=prepared['event_type'],
            check_in=prepared.get('check_in'),
            check_out=serializer.validated_data.get('check_out'),
            notes=serializer.validated_data.get('notes', ''),
        )

    def perform_create(self, serializer):
        from .presence_service import user_can_create_attendance_for, sync_attendance_related_records
        from rest_framework.exceptions import PermissionDenied
        employee = serializer.validated_data.get('employee')
        employee_id = employee.id if employee else None
        if not user_can_create_attendance_for(self.request.user, employee_id):
            raise PermissionDenied('Vous ne pouvez pas enregistrer ce pointage.')
        obj = self._save_attendance_from_serializer(serializer)
        sync_attendance_related_records(obj)
        self._after_attendance_saved(obj)
        log_action(
            self.request.user, 'Enregistrement présence', 'Présences',
            f'{obj.employee.full_name} — {obj.date} ({obj.event_type})', self.request,
            new_value=obj.status,
        )

    def perform_update(self, serializer):
        from .presence_service import user_can_edit_attendance
        from rest_framework.exceptions import PermissionDenied
        instance = serializer.instance
        if not instance:
            instance = self.get_object()
        if not user_can_edit_attendance(self.request.user, attendance=instance):
            raise PermissionDenied('Modification non autorisée.')
        old_status = instance.status
        obj = self._save_attendance_from_serializer(serializer)
        from .presence_service import sync_attendance_related_records
        sync_attendance_related_records(obj)
        self._after_attendance_saved(obj)
        log_action(
            self.request.user, 'Modification présence', 'Présences',
            f'{obj.employee.full_name} — {obj.date}', self.request,
            old_value=old_status, new_value=obj.status,
        )

    def perform_destroy(self, instance):
        from .presence_service import user_can_delete_attendance
        if not user_can_delete_attendance(self.request.user, instance):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Suppression non autorisée.')
        log_action(
            self.request.user, 'Suppression présence', 'Présences',
            f'{instance.employee.full_name} — {instance.date}', self.request,
        )
        instance.delete()

    @action(detail=False, methods=['get'], url_path='report')
    def report(self, request):
        from .presence_service import build_attendance_report
        data = build_attendance_report(
            request.user,
            month=request.query_params.get('month'),
            year=request.query_params.get('year'),
            search=request.query_params.get('search') or request.query_params.get('q'),
            department_id=request.query_params.get('department'),
        )
        return Response(data)

    @action(detail=False, methods=['get'], url_path='grid')
    def grid(self, request):
        from .presence_service import build_attendance_grid
        data = build_attendance_grid(
            request.user,
            month=request.query_params.get('month'),
            year=request.query_params.get('year'),
            employee_id=request.query_params.get('employee'),
            department_id=request.query_params.get('department'),
        )
        return Response(data)

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        from .presence_service import build_attendance_summary
        data = build_attendance_summary(
            request.user,
            month=request.query_params.get('month'),
            year=request.query_params.get('year'),
            search=request.query_params.get('search') or request.query_params.get('q'),
        )
        return Response(data)

    @action(detail=False, methods=['post'], url_path='pointages')
    def pointages(self, request):
        """Alias POST /api/attendance/pointages/ — enregistrement pointage."""
        return self._upsert_attendance(request, request.data)

    def _create_leave_request(self, request):
        """Crée une demande de congé (Absence) — partagé par les alias conges / leave-request."""
        absence_vs = AbsenceViewSet()
        absence_vs.request = request
        absence_vs.format_kwarg = None
        absence_vs.action = 'create'
        serializer = AbsenceSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        absence_vs.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='conges')
    def conges(self, request):
        """Alias POST /api/attendance/conges/ — demande de congé."""
        return self._create_leave_request(request)

    @action(detail=False, methods=['post'], url_path='leave-request')
    def leave_request(self, request):
        """Alias POST /api/attendance/leave-request/ — demande de congé."""
        return self._create_leave_request(request)

    @action(detail=False, methods=['get'], url_path='leaves')
    def leaves(self, request):
        """Alias GET /api/attendance/leaves/ — liste des congés."""
        absence_vs = AbsenceViewSet()
        absence_vs.request = request
        absence_vs.format_kwarg = None
        absence_vs.action = 'list'
        qs = absence_vs.filter_queryset(absence_vs.get_queryset())
        serializer = AbsenceSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get', 'post'], url_path='missions')
    def attendance_missions(self, request):
        """Alias GET/POST /api/attendance/missions/ — liste ou création de mission."""
        if request.method == 'GET':
            mission_vs = MissionViewSet()
            mission_vs.request = request
            mission_vs.format_kwarg = None
            mission_vs.action = 'list'
            qs = mission_vs.filter_queryset(mission_vs.get_queryset())
            serializer = MissionSerializer(qs, many=True)
            return Response(serializer.data)
        payload = request.data.copy() if hasattr(request.data, 'copy') else dict(request.data)
        if payload.get('location') and not payload.get('destination'):
            payload['destination'] = payload.pop('location')
        mission_vs = MissionViewSet()
        mission_vs.request = request
        mission_vs.format_kwarg = None
        mission_vs.action = 'create'
        serializer = MissionSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        mission_vs.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='auto-absences')
    def auto_absences(self, request):
        """Liste des absences automatiques."""
        qs = self.filter_queryset(self.get_queryset()).filter(
            record_source='auto', event_type='absence',
        )
        month = request.query_params.get('month')
        year = request.query_params.get('year')
        if month and year:
            from .presence_service import _month_bounds, _parse_int
            from django.utils import timezone as tz
            today = tz.now().date()
            m = _parse_int(month, today.month)
            y = _parse_int(year, today.year)
            start, end = _month_bounds(y, m)
            qs = qs.filter(date__gte=start, date__lte=end)
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='confirm-absence')
    def confirm_absence(self, request, pk=None):
        from .auto_absence_service import regularize_auto_absence
        obj = self.get_object()
        if obj.record_source != 'auto':
            return Response({'error': 'Cette absence n\'est pas automatique.'}, status=400)
        note = request.data.get('note', '')
        obj = regularize_auto_absence(obj, request.user, 'confirmed', note)
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=['post'], url_path='regularize-absence')
    def regularize_absence(self, request, pk=None):
        from .auto_absence_service import regularize_auto_absence
        obj = self.get_object()
        if obj.record_source != 'auto':
            return Response({'error': 'Cette absence n\'est pas automatique.'}, status=400)
        note = request.data.get('note', '')
        obj = regularize_auto_absence(obj, request.user, 'regularized', note)
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=['post'], url_path='contest-absence')
    def contest_absence(self, request, pk=None):
        from .auto_absence_service import regularize_auto_absence
        obj = self.get_object()
        if obj.record_source != 'auto':
            return Response({'error': 'Cette absence n\'est pas automatique.'}, status=400)
        note = request.data.get('note', '')
        obj = regularize_auto_absence(obj, request.user, 'contested', note)
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=['post'], url_path='submit-justification', parser_classes=[MultiPartParser, FormParser, JSONParser])
    def submit_justification(self, request, pk=None):
        from .auto_absence_service import submit_absence_justification
        from .presence_service import get_user_employee
        obj = self.get_object()
        emp = get_user_employee(request.user)
        role = get_user_role(request.user)
        if role == ROLE_EMPLOYE and (not emp or emp.id != obj.employee_id):
            return Response({'error': 'Non autorisé.'}, status=403)
        file_obj = request.FILES.get('file')
        if file_obj:
            allowed = ('.pdf', '.jpg', '.jpeg', '.png')
            ext = '.' + file_obj.name.rsplit('.', 1)[-1].lower() if '.' in file_obj.name else ''
            if ext not in allowed:
                return Response({'error': 'Format non autorisé. PDF, JPG, JPEG, PNG uniquement.'}, status=400)
        note = request.data.get('note', '')
        obj = submit_absence_justification(obj, note=note, file_obj=file_obj)
        log_action(request.user, 'Justification absence', 'Présences', f'{obj.employee.full_name} — {obj.date}', request)
        return Response(self.get_serializer(obj).data)


class MissionViewSet(viewsets.ModelViewSet):
    queryset = Mission.objects.select_related(
        'employee', 'employee__department', 'employee__manager',
    ).prefetch_related('documents')
    serializer_class = MissionSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_permissions(self):
        from .mission_service import user_can_delete_mission
        if self.action in ('list', 'retrieve', 'export_missions', 'audit_logs'):
            return [IsAuthenticated()]
        if self.action == 'destroy':
            return [IsAuthenticated()]
        if self.action in ('approve', 'start_mission', 'close_mission', 'cancel_mission'):
            return [IsManagerOrAbove()]
        return [IsManagerOrAbove()]

    def get_queryset(self):
        from .mission_service import filter_missions_queryset, apply_mission_filters
        qs = filter_missions_queryset(self.request.user)
        return apply_mission_filters(qs, self.request.query_params)

    def perform_create(self, serializer):
        from .mission_service import (
            generate_mission_number, log_mission_action, user_can_write_mission,
            sync_mission_attendance_markers,
        )
        from rest_framework.exceptions import PermissionDenied
        emp = serializer.validated_data.get('employee')
        if not user_can_write_mission(self.request.user, employee_id=emp.id if emp else None):
            raise PermissionDenied('Création de mission non autorisée.')
        if not serializer.validated_data.get('mission_number') and emp:
            serializer.validated_data['mission_number'] = generate_mission_number(emp)
        obj = serializer.save(created_by=self.request.user)
        log_mission_action(obj, 'CREATE', self.request.user, obj.title)
        log_action(self.request.user, 'Création mission', 'Présences', obj.mission_number, self.request)

    def perform_update(self, serializer):
        from .mission_service import (
            log_mission_action, user_can_write_mission, sync_mission_attendance_markers,
            build_mission_update_audit_note,
        )
        from rest_framework.exceptions import PermissionDenied
        if not user_can_write_mission(self.request.user, mission=serializer.instance):
            raise PermissionDenied('Modification non autorisée.')
        instance = serializer.instance
        audit_note = build_mission_update_audit_note(instance, serializer.validated_data)
        print("Mission mise à jour :", instance.id)
        print(self.request.data)
        obj = serializer.save()
        if obj.status in ('APPROVED', 'IN_PROGRESS', 'Approved'):
            sync_mission_attendance_markers(obj)
        log_mission_action(obj, 'UPDATE', self.request.user, audit_note)
        log_action(self.request.user, 'Modification mission', 'Présences', obj.mission_number, self.request)

    def perform_destroy(self, instance):
        from .mission_service import log_mission_action, user_can_delete_mission
        from rest_framework.exceptions import PermissionDenied
        if not user_can_delete_mission(self.request.user, instance):
            raise PermissionDenied('Seuls Admin RH et Gestionnaire RH peuvent supprimer une mission.')
        log_mission_action(instance, 'DELETE', self.request.user, instance.title)
        log_action(self.request.user, 'Suppression mission', 'Présences', instance.mission_number, self.request)
        instance.delete()

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        from .mission_service import (
            log_mission_action, sync_mission_attendance_markers, sync_mission_to_payroll, user_can_approve_mission,
        )
        from rest_framework.exceptions import PermissionDenied
        if not user_can_approve_mission(request.user):
            raise PermissionDenied('Validation non autorisée.')
        mission = self.get_object()
        mission.status = 'APPROVED'
        mission.approved_by = request.user
        mission.save(update_fields=['status', 'approved_by', 'updated_at'])
        sync_mission_attendance_markers(mission)
        sync_mission_to_payroll(mission)
        log_mission_action(mission, 'APPROVE', request.user)
        log_action(request.user, 'Validation mission', 'Présences', mission.mission_number, request)
        return Response(self.get_serializer(mission).data)

    @action(detail=True, methods=['post'], url_path='start')
    def start_mission(self, request, pk=None):
        from .mission_service import log_mission_action, sync_mission_attendance_markers
        mission = self.get_object()
        mission.status = 'IN_PROGRESS'
        mission.save(update_fields=['status', 'updated_at'])
        sync_mission_attendance_markers(mission)
        log_mission_action(mission, 'START', request.user)
        return Response(self.get_serializer(mission).data)

    @action(detail=True, methods=['post'], url_path='close')
    def close_mission(self, request, pk=None):
        from .mission_service import log_mission_action, sync_mission_to_payroll
        from django.utils import timezone as tz
        mission = self.get_object()
        for field in ('closure_summary', 'closure_results', 'closure_difficulties',
                      'closure_recommendations', 'actual_expenses', 'comments'):
            if field in request.data:
                setattr(mission, field, request.data.get(field))
        mission.status = 'COMPLETED'
        mission.closed_at = tz.now()
        mission.save()
        sync_mission_to_payroll(mission)
        log_mission_action(mission, 'CLOSE', request.user, request.data.get('closure_summary', ''))
        log_action(request.user, 'Clôture mission', 'Présences', mission.mission_number, request)
        return Response(self.get_serializer(mission).data)

    @action(detail=True, methods=['post'], url_path='cancel')
    def cancel_mission(self, request, pk=None):
        from .mission_service import log_mission_action
        mission = self.get_object()
        mission.status = 'CANCELLED'
        mission.save(update_fields=['status', 'updated_at'])
        log_mission_action(mission, 'CANCEL', request.user)
        return Response(self.get_serializer(mission).data)

    @action(detail=True, methods=['post'], url_path='documents')
    def upload_document(self, request, pk=None):
        from .models import MissionDocument
        mission = self.get_object()
        f = request.FILES.get('file')
        if not f:
            return Response({'error': 'Fichier requis.'}, status=400)
        name = f.name.lower()
        if not any(name.endswith(ext) for ext in ('.pdf', '.jpg', '.jpeg', '.png', '.docx', '.doc')):
            return Response({'error': 'Formats : PDF, JPG, PNG, DOCX.'}, status=400)
        doc = MissionDocument.objects.create(
            mission=mission,
            file=f,
            doc_type=request.data.get('doc_type', 'other'),
            label=request.data.get('label', f.name),
            uploaded_by=request.user,
        )
        from .mission_service import log_mission_action
        log_mission_action(mission, 'UPDATE', request.user, f'Document: {doc.label}')
        return Response(MissionDocumentSerializer(doc, context={'request': request}).data, status=201)

    @action(detail=True, methods=['get'], url_path='audit-logs')
    def audit_logs(self, request, pk=None):
        mission = self.get_object()
        logs = mission.audit_logs.select_related('user').all()[:50]
        return Response([{
            'action': log.action,
            'action_label': log.get_action_display(),
            'user': log.user.username if log.user else '-',
            'note': log.note,
            'created_at': log.created_at.isoformat(),
        } for log in logs])

    @action(detail=False, methods=['get'], url_path='export')
    def export_missions(self, request):
        from .mission_export import mission_export_response
        from .mission_service import log_mission_action
        qs = self.filter_queryset(self.get_queryset())
        if not qs.exists():
            return Response({'error': 'Aucune mission pour les critères sélectionnés.'}, status=404)
        fmt = request.query_params.get('export_format') or request.query_params.get('format', 'xlsx')
        for m in qs[:20]:
            log_mission_action(m, 'EXPORT', request.user, fmt)
        log_action(request.user, 'Export missions', 'Présences', f'{qs.count()} mission(s)', request)
        return mission_export_response(qs, fmt)


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
        'contracts': ContractSerializer(
            employee.contracts.all().order_by('-start_date'), many=True, context={'request': request},
        ).data,
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
