from .models import AuditLog, Notification


def log_action(user, action, module, details='', request=None, old_value=None, new_value=None):
    ip = None
    if request:
        ip = request.META.get('REMOTE_ADDR')
    if old_value is not None or new_value is not None:
        extra = []
        if old_value is not None:
            extra.append(f'Avant: {old_value}')
        if new_value is not None:
            extra.append(f'Après: {new_value}')
        details = f'{details} | {" | ".join(extra)}' if details else ' | '.join(extra)
    AuditLog.objects.create(
        user=user if user and user.is_authenticated else None,
        action=action,
        module=module,
        details=details,
        ip_address=ip,
    )


def notify_employee(employee, title, message, notification_type='general'):
    if employee:
        Notification.objects.create(
            employee=employee,
            title=title,
            message=message,
            notification_type=notification_type,
        )
