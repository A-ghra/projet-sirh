from rest_framework.permissions import BasePermission

ROLE_SUPER = 'SUPER_ADMIN'
ROLE_ADMIN = 'ADMIN_RH'
ROLE_GESTIONNAIRE = 'GESTIONNAIRE_RH'
ROLE_PAIE = 'GESTIONNAIRE_PAIE'
ROLE_MANAGER = 'RESPONSABLE_HIERARCHIQUE'
ROLE_EMPLOYE = 'EMPLOYE'
SETTINGS_ROLES = {ROLE_SUPER, ROLE_ADMIN}
PAYROLL_EXPORT_ROLES = {ROLE_SUPER, ROLE_ADMIN, ROLE_GESTIONNAIRE, ROLE_PAIE}


def get_user_role(user):
    if not user or not user.is_authenticated:
        return None
    if hasattr(user, 'profile') and user.profile.role:
        return user.profile.role.code
    if user.is_superuser:
        return ROLE_ADMIN
    return ROLE_EMPLOYE


class IsAuthenticatedRole(BasePermission):
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated


class IsAdminRH(BasePermission):
    def has_permission(self, request, view):
        role = get_user_role(request.user)
        return request.user.is_superuser or role in SETTINGS_ROLES


def is_settings_admin(user):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    return get_user_role(user) in SETTINGS_ROLES


class IsGestionnaireOrAdmin(BasePermission):
    def has_permission(self, request, view):
        return get_user_role(request.user) in (ROLE_ADMIN, ROLE_GESTIONNAIRE)


class IsManagerOrAbove(BasePermission):
    def has_permission(self, request, view):
        return get_user_role(request.user) in (ROLE_ADMIN, ROLE_GESTIONNAIRE, ROLE_MANAGER)


class IsEmployeeOrAbove(BasePermission):
    def has_permission(self, request, view):
        return get_user_role(request.user) is not None


def can_export_payroll_individual(user):
    return get_user_role(user) in PAYROLL_EXPORT_ROLES


def can_export_payroll_global(user):
    return get_user_role(user) in PAYROLL_EXPORT_ROLES
