from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('hr_app', '0005_payroll_rdc_2026'),
    ]

    operations = [
        migrations.AddField(
            model_name='companysettings',
            name='payroll_manager_name',
            field=models.CharField(blank=True, default='Responsable Paie', max_length=100),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='bulletin_qr_enabled',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='bulletin_signature_enabled',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='bulletin_stamp_enabled',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='report_number_format',
            field=models.CharField(default='RPT-{year}-{num:04d}', max_length=50),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='report_logo_enabled',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='role',
            name='permissions',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AlterField(
            model_name='role',
            name='code',
            field=models.CharField(max_length=30, unique=True),
        ),
        migrations.CreateModel(
            name='SystemSettings',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('default_currency', models.CharField(choices=[('USD', 'USD'), ('CDF', 'CDF')], default='USD', max_length=3)),
                ('date_format', models.CharField(choices=[('DD/MM/YYYY', 'JJ/MM/AAAA'), ('MM/DD/YYYY', 'MM/JJ/AAAA'), ('YYYY-MM-DD', 'AAAA-MM-JJ')], default='DD/MM/YYYY', max_length=20)),
                ('timezone', models.CharField(default='Africa/Kinshasa', max_length=50)),
                ('language', models.CharField(choices=[('fr', 'Français'), ('en', 'English')], default='fr', max_length=5)),
                ('export_format', models.CharField(choices=[('pdf', 'PDF'), ('excel', 'Excel'), ('word', 'Word')], default='pdf', max_length=10)),
                ('system_version', models.CharField(default='OTOMIA RH 2026.1', max_length=30)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name_plural': 'Paramètres système',
            },
        ),
        migrations.CreateModel(
            name='SystemBackup',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('filename', models.CharField(max_length=200)),
                ('file_path', models.CharField(max_length=300)),
                ('size_kb', models.DecimalField(decimal_places=1, default=0, max_digits=10)),
                ('notes', models.CharField(blank=True, default='', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
