"""Sauvegarde et restauration des données de configuration OTOMIA RH."""
import json
import os
from datetime import datetime

from django.conf import settings
from django.contrib.auth.models import User
from django.core import serializers

from .models import (
    CompanySettings, SystemSettings, Role, AppModule, ModuleFeature,
    CustomField, SystemBackup,
)

BACKUP_MODELS = [
    CompanySettings, SystemSettings, Role, AppModule, ModuleFeature, CustomField,
]


def _backup_dir():
    path = os.path.join(settings.MEDIA_ROOT, 'backups')
    os.makedirs(path, exist_ok=True)
    return path


def create_configuration_backup(user=None, notes=''):
    payload = {
        'version': '1.0',
        'created_at': datetime.now().isoformat(),
        'models': {},
    }
    for model in BACKUP_MODELS:
        name = model._meta.label_lower
        payload['models'][name] = json.loads(
            serializers.serialize('json', model.objects.all())
        )
    filename = f"otomia_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    file_path = os.path.join(_backup_dir(), filename)
    content = json.dumps(payload, indent=2, ensure_ascii=False)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    size_kb = round(os.path.getsize(file_path) / 1024, 1)
    backup = SystemBackup.objects.create(
        filename=filename,
        file_path=f'backups/{filename}',
        size_kb=size_kb,
        created_by=user,
        notes=notes or 'Sauvegarde configuration',
    )
    return backup


def list_backups():
    return SystemBackup.objects.all()[:50]


def restore_configuration_backup(uploaded_file, user=None):
    """Restaure les modèles de configuration depuis un fichier JSON."""
    data = json.load(uploaded_file)
    if 'models' not in data:
        raise ValueError('Fichier de sauvegarde invalide.')
    restored = []
    for model in BACKUP_MODELS:
        name = model._meta.label_lower
        entries = data['models'].get(name, [])
        if not entries:
            continue
        for obj in serializers.deserialize('json', json.dumps(entries)):
            obj.save()
        restored.append(name)
    return restored
