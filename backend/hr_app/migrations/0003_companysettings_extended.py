import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr_app', '0002_companysettings_document_document_type_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='companysettings',
            name='rccm',
            field=models.CharField(default='CD/KIN/RCCM/24-B-00001', max_length=80),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='company_acronym',
            field=models.CharField(default='OTOMIA RH', max_length=50),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='company_slogan',
            field=models.CharField(default='Système Intelligent de Gestion des Ressources Humaines', max_length=255),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='company_description',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='tax_number',
            field=models.CharField(blank=True, default='', max_length=50),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='cnss_number',
            field=models.CharField(default='CNSS-001234567', max_length=50),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='vat_number',
            field=models.CharField(blank=True, default='', max_length=50),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='approval_number',
            field=models.CharField(blank=True, default='', max_length=50),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='other_legal_refs',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='postal_address',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='headquarters_address',
            field=models.TextField(default='Avenue du Commerce, Gombe, Kinshasa, RDC'),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='commune',
            field=models.CharField(blank=True, default='Gombe', max_length=100),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='city',
            field=models.CharField(default='Kinshasa', max_length=100),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='province',
            field=models.CharField(default='Kinshasa', max_length=100),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='country',
            field=models.CharField(default='RDC', max_length=100),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='phone_primary',
            field=models.CharField(default='+243 81 000 00 00', max_length=30),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='phone_secondary',
            field=models.CharField(blank=True, default='', max_length=30),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='website',
            field=models.URLField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='publisher',
            field=models.CharField(blank=True, default='OTOMIA RH SARL', max_length=200),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='billing_department',
            field=models.CharField(blank=True, default='Facturation', max_length=100),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='hr_department',
            field=models.CharField(default='Ressources Humaines', max_length=100),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='payroll_department',
            field=models.CharField(default='Service Paie', max_length=100),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='hr_manager_name',
            field=models.CharField(blank=True, default='Responsable RH', max_length=100),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='director_name',
            field=models.CharField(blank=True, default='Directeur Général', max_length=100),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='logo',
            field=models.ImageField(blank=True, null=True, upload_to='company/'),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='logo_url',
            field=models.URLField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='logo_max_size_mb',
            field=models.DecimalField(decimal_places=1, default=2.0, max_digits=4),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='bulletin_title',
            field=models.CharField(default='BULLETIN DE PAIE', max_length=100),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='bulletin_prefix',
            field=models.CharField(default='BULLETIN DE PAIE N°', max_length=50),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='bulletin_number_format',
            field=models.CharField(default='BP-{year}-{num:04d}', max_length=50),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='bulletin_footer',
            field=models.TextField(default='Document généré automatiquement par OTOMIA RH.'),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='report_title',
            field=models.CharField(default='RAPPORT RH', max_length=100),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='report_subtitle',
            field=models.CharField(default='Rapport statistique des ressources humaines', max_length=200),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='report_header',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='report_footer',
            field=models.CharField(default='Document confidentiel', max_length=200),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='report_author',
            field=models.CharField(default='Administrateur RH', max_length=100),
        ),
        migrations.AddField(
            model_name='companysettings',
            name='created_at',
            field=models.DateTimeField(auto_now_add=True, default=django.utils.timezone.now),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='companysettings',
            name='updated_at',
            field=models.DateTimeField(auto_now=True),
        ),
    ]
