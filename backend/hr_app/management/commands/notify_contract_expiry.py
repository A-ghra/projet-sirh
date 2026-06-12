"""Alertes contrats expirants — à planifier quotidiennement."""
from django.core.management.base import BaseCommand

from hr_app.contract_service import notify_contract_expiry


class Command(BaseCommand):
    help = 'Envoie les notifications de contrats arrivant à expiration (90/60/30/7 jours).'

    def handle(self, *args, **options):
        count = notify_contract_expiry()
        self.stdout.write(self.style.SUCCESS(f'{count} notification(s) envoyée(s).'))
