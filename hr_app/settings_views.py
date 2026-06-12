"""Vues du centre de configuration Paramètres OTOMIA RH."""
import json

from django.contrib.auth.models import User
from django.contrib.auth.hashers import make_password
from rest_framework import viewsets, status
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.permissions import AllowAny, IsAuthenticated, BasePermission
from rest_framework.response import Response

from .backup_service import create_configuration_backup, list_backups, restore_configuration_backup
from .models import Role, UserProfile, SystemSettings, SystemBackup, CustomField, WorkScheduleSettings
from .permissions import get_user_role, ROLE_ADMIN
from .serializers import (
    SystemSettingsSerializer, WorkScheduleSettingsSerializer, SystemBackupSerializer, RoleSerializer,
    CustomFieldSerializer, ManagedUserSerializer,
)
from .utils import log_action

ROLE_SUPER = 'SUPER_ADMIN'
SETTINGS_ROLES = {ROLE_SUPER, ROLE_ADMIN}


def is_settings_admin(user):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    return get_user_role(user) in SETTINGS_ROLES


class IsSettingsAdmin(BasePermission):
    def has_permission(self, request, view):
        return is_settings_admin(request.user)


@api_view(['GET'])
@permission_classes([AllowAny])
def public_branding_view(request):
    """Branding public pour login et pages non authentifiées."""
    from .branding import (
        DEVELOPER_NAME, DEVELOPER_WEBSITE, DEVELOPER_SIGNATURE,
        APP_VERSION_LABEL, COPYRIGHT_YEAR, DEVELOPER_SOLUTIONS,
    )
    from .models import CompanySettings
    c = CompanySettings.get_settings()
    return Response({
        'company_name': c.company_name,
        'company_acronym': c.company_acronym,
        'company_slogan': c.company_slogan,
        'logo_display_url': c.logo_display_url,
        'developer_name': DEVELOPER_NAME,
        'developer_website': DEVELOPER_WEBSITE,
        'developer_signature': DEVELOPER_SIGNATURE,
        'app_version': APP_VERSION_LABEL,
        'copyright_year': COPYRIGHT_YEAR,
        'developer_solutions': DEVELOPER_SOLUTIONS,
    })


@api_view(['GET', 'PUT', 'PATCH'])
@permission_classes([IsAuthenticated])
def work_schedule_settings_view(request):
    obj = WorkScheduleSettings.get_settings()
    if request.method == 'GET':
        return Response(WorkScheduleSettingsSerializer(obj).data)
    if not is_settings_admin(request.user):
        return Response({'error': 'Accès réservé aux administrateurs.'}, status=403)
    ser = WorkScheduleSettingsSerializer(obj, data=request.data, partial=True)
    ser.is_valid(raise_exception=True)
    ser.save()
    log_action(request.user, 'Mise à jour horaires de travail', 'Paramètres', '', request)
    return Response(ser.data)


@api_view(['GET', 'PUT', 'PATCH'])
@permission_classes([IsAuthenticated])
def system_settings_view(request):
    obj = SystemSettings.get_settings()
    if request.method == 'GET':
        return Response(SystemSettingsSerializer(obj).data)
    if not is_settings_admin(request.user):
        return Response({'error': 'Accès réservé aux administrateurs.'}, status=403)
    ser = SystemSettingsSerializer(obj, data=request.data, partial=True)
    ser.is_valid(raise_exception=True)
    ser.save()
    log_action(request.user, 'Mise à jour paramètres système', 'Paramètres', '', request)
    return Response(ser.data)


class RoleManagementViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [IsSettingsAdmin]

    def perform_update(self, serializer):
        obj = serializer.save()
        log_action(self.request.user, 'Modification rôle', 'Paramètres', obj.name, self.request)


class ManagedUserViewSet(viewsets.ViewSet):
    permission_classes = [IsSettingsAdmin]

    def list(self, request):
        users = User.objects.select_related('profile__role').order_by('username')
        return Response(ManagedUserSerializer(users, many=True).data)

    def create(self, request):
        data = request.data
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        if not username or not password:
            return Response({'error': 'username et password requis.'}, status=400)
        if User.objects.filter(username=username).exists():
            return Response({'error': 'Nom d\'utilisateur déjà utilisé.'}, status=400)
        user = User.objects.create_user(
            username=username,
            email=data.get('email', ''),
            password=password,
            first_name=data.get('first_name', ''),
            last_name=data.get('last_name', ''),
        )
        role_code = data.get('role', 'EMPLOYE')
        role = Role.objects.filter(code=role_code).first()
        UserProfile.objects.create(user=user, role=role)
        log_action(request.user, 'Création utilisateur', 'Paramètres', username, request)
        return Response(ManagedUserSerializer(user).data, status=201)

    def partial_update(self, request, pk=None):
        user = User.objects.filter(pk=pk).first()
        if not user:
            return Response({'error': 'Utilisateur introuvable.'}, status=404)
        for field in ('email', 'first_name', 'last_name'):
            if field in request.data:
                setattr(user, field, request.data[field])
        if 'role' in request.data:
            role = Role.objects.filter(code=request.data['role']).first()
            profile, _ = UserProfile.objects.get_or_create(user=user)
            profile.role = role
            profile.save()
        user.save()
        log_action(request.user, 'Modification utilisateur', 'Paramètres', user.username, request)
        return Response(ManagedUserSerializer(user).data)

    @action(detail=True, methods=['post'])
    def suspend(self, request, pk=None):
        user = User.objects.filter(pk=pk).first()
        if not user:
            return Response({'error': 'Utilisateur introuvable.'}, status=404)
        user.is_active = False
        user.save()
        log_action(request.user, 'Suspension utilisateur', 'Paramètres', user.username, request)
        return Response({'status': 'success', 'message': f'Compte {user.username} suspendu.'})

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        user = User.objects.filter(pk=pk).first()
        if not user:
            return Response({'error': 'Utilisateur introuvable.'}, status=404)
        user.is_active = True
        user.save()
        log_action(request.user, 'Activation utilisateur', 'Paramètres', user.username, request)
        return Response({'status': 'success'})

    @action(detail=True, methods=['post'])
    def reset_password(self, request, pk=None):
        user = User.objects.filter(pk=pk).first()
        if not user:
            return Response({'error': 'Utilisateur introuvable.'}, status=404)
        import secrets
        import string
        new_pass = request.data.get('password') or ''.join(
            secrets.choice(string.ascii_letters + string.digits) for _ in range(12)
        )
        user.password = make_password(new_pass)
        user.save()
        log_action(request.user, 'Réinitialisation mot de passe', 'Paramètres', user.username, request)
        return Response({'status': 'success', 'message': f'Mot de passe réinitialisé pour {user.username}.'})


class SystemBackupViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = SystemBackup.objects.all()
    serializer_class = SystemBackupSerializer
    permission_classes = [IsSettingsAdmin]

    @action(detail=False, methods=['post'])
    def create_backup(self, request):
        backup = create_configuration_backup(request.user, request.data.get('notes', ''))
        log_action(request.user, 'Création sauvegarde', 'Paramètres', backup.filename, request)
        return Response(SystemBackupSerializer(backup).data)

    @action(detail=False, methods=['post'])
    def restore(self, request):
        uploaded = request.FILES.get('file')
        if not uploaded:
            return Response({'error': 'Fichier requis.'}, status=400)
        try:
            restored = restore_configuration_backup(uploaded, request.user)
        except (ValueError, json.JSONDecodeError) as e:
            return Response({'error': str(e)}, status=400)
        log_action(request.user, 'Restauration sauvegarde', 'Paramètres', uploaded.name, request)
        return Response({'status': 'success', 'restored': restored})


@api_view(['GET'])
@permission_classes([IsSettingsAdmin])
def all_custom_fields_view(request):
    fields = CustomField.objects.select_related('module').all().order_by('module__name', 'display_order')
    data = CustomFieldSerializer(fields, many=True).data
    for item in data:
        mod = CustomField.objects.get(pk=item['id']).module
        item['module_name'] = mod.name
        item['module_key'] = mod.key
    return Response(data)
