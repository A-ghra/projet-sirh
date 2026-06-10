# Generated manually for payroll individual export RDC

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('hr_app', '0007_alter_companysettings_address_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='companysettings',
            name='inpp_enabled',
            field=models.BooleanField(default=True, help_text='Activer la retenue INPP sur les bulletins'),
        ),
        migrations.AlterField(
            model_name='document',
            name='document_type',
            field=models.CharField(
                choices=[
                    ('Contrat', 'Contrat de travail'),
                    ('Avenant', 'Avenant'),
                    ('Note', 'Note de service'),
                    ('Attestation', 'Attestation'),
                    ('Certificat', 'Certificat de travail'),
                    ('Bulletin de paie', 'Bulletin de paie'),
                    ('Autre', 'Autre'),
                ],
                default='Autre',
                max_length=20,
            ),
        ),
        migrations.CreateModel(
            name='PayrollExportLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('format', models.CharField(choices=[('pdf', 'PDF'), ('excel', 'Excel'), ('word', 'Word')], max_length=10)),
                ('file_path', models.CharField(max_length=500)),
                ('filename', models.CharField(max_length=255)),
                ('email_sent', models.BooleanField(default=False)),
                ('email_recipient', models.EmailField(blank=True, default='', max_length=254)),
                ('exported_at', models.DateTimeField(auto_now_add=True)),
                ('exported_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
                ('payroll', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='export_logs', to='hr_app.payroll')),
            ],
            options={
                'ordering': ['-exported_at'],
            },
        ),
    ]
