from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr_app', '0015_contract_import_export'),
    ]

    operations = [
        migrations.AddField(
            model_name='absence',
            name='justification_file',
            field=models.FileField(blank=True, null=True, upload_to='leave_justifications/'),
        ),
        migrations.AlterField(
            model_name='absence',
            name='absence_type',
            field=models.CharField(
                choices=[
                    ('CP', 'Congé Payé'),
                    ('Maladie', 'Maladie'),
                    ('RTT', 'RTT'),
                    ('Mission', 'Mission'),
                    ('Autre', 'Autre'),
                ],
                default='CP',
                max_length=20,
            ),
        ),
    ]
