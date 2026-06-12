from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('hr_app', '0003_companysettings_extended'),
    ]

    operations = [
        migrations.AddField(
            model_name='employee',
            name='custom_data',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.CreateModel(
            name='AppModule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('key', models.CharField(max_length=50, unique=True)),
                ('name', models.CharField(max_length=100)),
                ('description', models.TextField(blank=True, default='')),
                ('icon', models.CharField(default='fa-cube', max_length=50)),
                ('is_active', models.BooleanField(default=True)),
                ('display_order', models.IntegerField(default=0)),
                ('allowed_roles', models.CharField(default='ADMIN_RH', help_text='Rôles autorisés, séparés par des virgules', max_length=255)),
            ],
            options={
                'verbose_name': 'Module',
                'verbose_name_plural': 'Modules',
                'db_table': 'modules',
                'ordering': ['display_order', 'name'],
            },
        ),
        migrations.CreateModel(
            name='ModuleFeature',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('feature_key', models.CharField(max_length=80)),
                ('feature_name', models.CharField(max_length=200)),
                ('description', models.TextField(blank=True, default='')),
                ('feature_type', models.CharField(choices=[('menu_tab', 'Onglet / Menu'), ('payroll_gain', 'Gain de paie'), ('payroll_retention', 'Retenue de paie'), ('recruitment_step', 'Étape recrutement'), ('training_type', 'Type formation'), ('portal_section', 'Section portail'), ('general', 'Fonctionnalité générale')], default='general', max_length=30)),
                ('icon', models.CharField(blank=True, default='', max_length=50)),
                ('config', models.JSONField(blank=True, default=dict)),
                ('is_active', models.BooleanField(default=True)),
                ('display_order', models.IntegerField(default=0)),
                ('module', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='features', to='hr_app.appmodule')),
            ],
            options={
                'verbose_name': 'Fonctionnalité module',
                'verbose_name_plural': 'Fonctionnalités modules',
                'db_table': 'module_features',
                'ordering': ['display_order', 'feature_name'],
                'unique_together': {('module', 'feature_key')},
            },
        ),
        migrations.CreateModel(
            name='CustomField',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('field_key', models.CharField(max_length=80)),
                ('field_name', models.CharField(max_length=200)),
                ('field_type', models.CharField(choices=[('text', 'Texte'), ('textarea', 'Zone de texte'), ('number', 'Nombre'), ('email', 'Email'), ('phone', 'Téléphone'), ('date', 'Date'), ('time', 'Heure'), ('select', 'Liste déroulante'), ('checkbox', 'Case à cocher'), ('radio', 'Bouton radio'), ('file', 'Fichier'), ('image', 'Image')], default='text', max_length=20)),
                ('description', models.TextField(blank=True, default='')),
                ('required', models.BooleanField(default=False)),
                ('visible', models.BooleanField(default=True)),
                ('editable', models.BooleanField(default=True)),
                ('default_value', models.TextField(blank=True, default='')),
                ('options', models.JSONField(blank=True, default=list)),
                ('display_order', models.IntegerField(default=0)),
                ('module', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='custom_fields', to='hr_app.appmodule')),
            ],
            options={
                'verbose_name': 'Champ personnalisé',
                'verbose_name_plural': 'Champs personnalisés',
                'db_table': 'custom_fields',
                'ordering': ['display_order', 'field_name'],
                'unique_together': {('module', 'field_key')},
            },
        ),
    ]
