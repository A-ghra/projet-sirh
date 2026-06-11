"""Commande planifiable — détection et création automatique des absences."""
from django.core.management.base import BaseCommand
from django.utils import timezone

from hr_app.auto_absence_service import process_absence_alerts


class Command(BaseCommand):
    help = 'Traite les alertes et absences automatiques (à planifier en fin de journée).'

    def add_arguments(self, parser):
        parser.add_argument('--date', type=str, help='Date YYYY-MM-DD (défaut: aujourd\'hui)')
        parser.add_argument('--notify-only', action='store_true', help='Envoyer uniquement les alertes')
        parser.add_argument('--finalize-only', action='store_true', help='Créer uniquement les absences')

    def handle(self, *args, **options):
        target = None
        if options.get('date'):
            target = timezone.datetime.strptime(options['date'], '%Y-%m-%d').date()

        notify_only = options.get('notify_only')
        finalize_only = options.get('finalize_only')

        result = process_absence_alerts(
            for_date=target,
            force_notify=True if notify_only else (False if finalize_only else None),
            force_finalize=True if finalize_only else (False if notify_only else None),
        )
        self.stdout.write(self.style.SUCCESS(str(result)))
