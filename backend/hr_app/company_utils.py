import os
import uuid
from urllib.parse import urlparse
from django.conf import settings
from django.core.files.base import ContentFile

ALLOWED_LOGO_EXT = {'.png', '.jpg', '.jpeg', '.svg', '.webp'}
MAX_LOGO_BYTES_DEFAULT = 2 * 1024 * 1024


def validate_logo_file(uploaded_file, max_mb=2.0):
    ext = os.path.splitext(uploaded_file.name)[1].lower()
    if ext not in ALLOWED_LOGO_EXT:
        raise ValueError(f'Format non accepté. Utilisez: {", ".join(ALLOWED_LOGO_EXT)}')
    max_bytes = int(float(max_mb) * 1024 * 1024)
    if uploaded_file.size > max_bytes:
        raise ValueError(f'Fichier trop volumineux (max {max_mb} Mo).')
    return True


def download_logo_from_url(url, max_mb=2.0):
    import urllib.request
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('URL invalide. Utilisez une adresse HTTPS.')
    req = urllib.request.Request(url, headers={'User-Agent': 'OTOMIA-RH/1.0'})
    with urllib.request.urlopen(req, timeout=15) as resp:
        content = resp.read()
        content_type = resp.headers.get('Content-Type', '')
    max_bytes = int(float(max_mb) * 1024 * 1024)
    if len(content) > max_bytes:
        raise ValueError(f'Image trop volumineuse (max {max_mb} Mo).')
    ext = os.path.splitext(parsed.path)[1].lower()
    if not ext or ext not in ALLOWED_LOGO_EXT:
        if 'png' in content_type:
            ext = '.png'
        elif 'jpeg' in content_type or 'jpg' in content_type:
            ext = '.jpg'
        elif 'svg' in content_type:
            ext = '.svg'
        else:
            ext = '.png'
    filename = f'logo_{uuid.uuid4().hex[:8]}{ext}'
    return filename, ContentFile(content)


def logo_file_uri(company):
    """Chemin absolu pour WeasyPrint."""
    if company.logo and company.logo.path and os.path.isfile(company.logo.path):
        return f'file://{company.logo.path}'
    return None
