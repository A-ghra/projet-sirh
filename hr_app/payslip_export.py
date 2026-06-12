"""Export individuel, archivage et envoi des bulletins de paie."""
import logging
import os
from datetime import datetime

from django.conf import settings
from django.core.files import File
from django.core.mail import EmailMessage
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework.response import Response

from .exports import generate_payslip_pdf, generate_payslip_excel, generate_payslip_word
from .models import Document, Employee, Payroll, PayrollExportLog
from .payroll_service import payslip_filename
from .permissions import ROLE_ADMIN, ROLE_GESTIONNAIRE, ROLE_PAIE, ROLE_SUPER, ROLE_EMPLOYE, get_user_role

logger = logging.getLogger(__name__)

EXPORTABLE_STATUSES = ('VALIDATED', 'PAID', 'ARCHIVED')
GENERATORS = {
    'pdf': generate_payslip_pdf,
    'excel': generate_payslip_excel,
    'word': generate_payslip_word,
}
FIELD_MAP = {'pdf': 'payslip_pdf', 'excel': 'payslip_excel', 'word': 'payslip_word'}
EXT_MAP = {'pdf': 'pdf', 'excel': 'xlsx', 'word': 'docx'}


CONTENT_TYPES = {
    'pdf': 'application/pdf',
    'excel': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'word': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}


def can_access_payroll(user, payroll):
    role = get_user_role(user)
    if role in (ROLE_SUPER, ROLE_ADMIN, ROLE_GESTIONNAIRE, ROLE_PAIE):
        return True
    if role == ROLE_EMPLOYE:
        emp = getattr(user.profile, 'employee', None)
        return emp and emp.id == payroll.employee_id
    return False


def resolve_payroll(employee_id, month, year):
    if not all([employee_id, month, year]):
        return None, Response({'error': 'employee_id, month et year sont requis.'}, status=400)
    try:
        target = datetime(int(year), int(month), 1).date()
    except (ValueError, TypeError):
        return None, Response({'error': 'month et year invalides.'}, status=400)
    employee = get_object_or_404(Employee, pk=employee_id)
    payroll = Payroll.objects.filter(employee=employee, month=target).select_related('employee').first()
    if not payroll:
        logger.warning('Export individuel: aucune paie employee=%s month=%s/%s', employee_id, month, year)
        return None, Response(
            {'error': 'Aucune paie trouvée pour cette période.'},
            status=404,
        )
    if payroll.status not in EXPORTABLE_STATUSES:
        logger.warning('Export individuel: bulletin non validé id=%s status=%s', payroll.id, payroll.status)
        return None, Response(
            {
                'error': (
                    f'Aucune paie validée pour cette période. Statut actuel : {payroll.get_status_display()}. '
                    'Validez le bulletin avant export.'
                ),
            },
            status=400,
        )
    return payroll, None


def parse_individual_export_params(request):
    """Extrait employee_id, month, year, format depuis GET ou POST."""
    qp = getattr(request, 'query_params', None) or request.GET
    data = getattr(request, 'data', None) or {}
    if hasattr(data, 'get'):
        pass
    else:
        data = {}
    employee_id = qp.get('employee_id') or data.get('employee_id')
    month = qp.get('month') or data.get('month')
    year = qp.get('year') or data.get('year')
    fmt = qp.get('export_format') or qp.get('format') or data.get('export_format') or data.get('format', 'pdf')
    return employee_id, month, year, fmt


def individual_export_response(payroll, fmt, user):
    """Génère un bulletin individuel et retourne les métadonnées JSON."""
    logger.info(
        'Export individuel JSON payroll=%s employee=%s format=%s user=%s',
        payroll.id, payroll.employee.matricule, fmt, user.username if user else '-',
    )
    result = export_payslip_file(payroll, fmt, user=user, archive=True)
    return {
        'status': 'success',
        'message': 'Export généré avec succès.',
        'url': result['url'],
        'filename': result['filename'],
        'payroll_id': payroll.id,
        'employee_name': payroll.employee.full_name,
        'employee_matricule': payroll.employee.matricule,
        'export_type': 'individual',
        'preview_url': result['url'] if fmt == 'pdf' else None,
    }


def individual_export_file_response(payroll, fmt, user):
    """Retourne le fichier bulletin en téléchargement direct (un seul employé)."""
    logger.info(
        'Export individuel DOWNLOAD payroll=%s employee=%s format=%s',
        payroll.id, payroll.employee.matricule, fmt,
    )
    result = export_payslip_file(payroll, fmt, user=user, archive=True)
    full_path = os.path.join(settings.MEDIA_ROOT, result['path'])
    if not os.path.isfile(full_path):
        logger.error('Fichier bulletin introuvable: %s', full_path)
        return None, Response({'error': 'Fichier bulletin introuvable après génération.'}, status=500)
    content_type = CONTENT_TYPES.get(fmt, 'application/octet-stream')
    file_handle = open(full_path, 'rb')
    response = FileResponse(file_handle, as_attachment=True, filename=result['filename'], content_type=content_type)
    response['X-Export-Type'] = 'individual'
    response['X-Employee-Matricule'] = payroll.employee.matricule
    return response, None


def archive_payslip_export(payroll, path, fmt, user, filename):
    PayrollExportLog.objects.create(
        payroll=payroll,
        format=fmt,
        file_path=path,
        filename=filename,
        exported_by=user,
    )
    month_label = payroll.month.strftime('%m/%Y')
    title = f'Bulletin de paie {month_label}'
    doc_type = 'Bulletin de paie'
    full_path = os.path.join(settings.MEDIA_ROOT, path)
    if not os.path.isfile(full_path):
        return
    existing = Document.objects.filter(
        employee=payroll.employee, title=title, document_type=doc_type,
    ).first()
    with open(full_path, 'rb') as f:
        django_file = File(f, name=os.path.basename(path))
        if existing:
            existing.file.save(os.path.basename(path), django_file, save=True)
        else:
            doc = Document(employee=payroll.employee, title=title, document_type=doc_type)
            doc.file.save(os.path.basename(path), django_file, save=True)


def export_payslip_file(payroll, fmt, user=None, archive=True):
    """Génère un bulletin INDIVIDUEL — un seul employé par fichier."""
    if fmt not in GENERATORS:
        raise ValueError('Format invalide (pdf, excel, word).')
    if not payroll or not payroll.employee_id:
        raise ValueError('Bulletin ou employé invalide.')
    path = GENERATORS[fmt](payroll, user=user)
    setattr(payroll, FIELD_MAP[fmt], path)
    payroll.save(update_fields=[FIELD_MAP[fmt]])
    filename = payslip_filename(payroll, EXT_MAP[fmt])
    if archive:
        archive_payslip_export(payroll, path, fmt, user, filename)
    return {
        'path': path,
        'filename': filename,
        'url': f'/media/{path}',
        'export_type': 'individual',
        'employee_matricule': payroll.employee.matricule,
        'employee_name': payroll.employee.full_name,
        'payroll_id': payroll.id,
    }


def send_payslip_email(payroll, fmt, user, recipient=None):
    recipient = recipient or payroll.employee.email
    if not recipient:
        return False, 'Aucune adresse email pour cet employé.'
    result = export_payslip_file(payroll, fmt, user=user, archive=True)
    full_path = os.path.join(settings.MEDIA_ROOT, result['path'])
    if not os.path.isfile(full_path):
        return False, 'Fichier bulletin introuvable.'
    month_label = payroll.month.strftime('%B %Y')
    subject = f'Bulletin de paie — {month_label}'
    body = (
        f'Bonjour {payroll.employee.full_name},\n\n'
        f'Veuillez trouver ci-joint votre bulletin de paie pour {month_label}.\n\n'
        f'Cordialement,\nService Paie — OTOMIA RH'
    )
    email = EmailMessage(subject=subject, body=body, to=[recipient])
    email.attach_file(full_path)
    email.send(fail_silently=False)
    log = PayrollExportLog.objects.filter(
        payroll=payroll, file_path=result['path'],
    ).order_by('-exported_at').first()
    if log:
        log.email_sent = True
        log.email_recipient = recipient
        log.save(update_fields=['email_sent', 'email_recipient'])
    return True, recipient
