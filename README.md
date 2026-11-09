# Clínica OS — sistema clínico multiinstitución

Aplicación cliente-servidor de Entrega II con React, TypeScript y Node.js. El servidor autentica la sesión y enruta las operaciones por institución: PostgreSQL para Hospital General, MySQL para Centro Médico Pediátrico, Firestore para Clínica Odontológica y MongoDB para Laboratorio Clínico.

## Preparar el entorno

Requiere Node.js LTS. Desde esta carpeta:

```powershell
npm install
Copy-Item .env.example .env
```

Completa `.env` con los datos de conexión.

## Operaciones por institución

- **Hospital General / PostgreSQL:** buscar y crear pacientes, archivar expedientes, consultar citas, antecedentes, alergias y eventos del historial. El formulario de Atención registra consulta, diagnóstico, tratamiento y receta en una transacción.
- **Centro Médico Pediátrico / MySQL:** consultar pacientes y registrar encuentros ligados a cita o urgencia, diagnóstico, crecimiento y receta. Las reglas y procedimientos del esquema controlan el cierre, el IMC, el peso usado en dosis, alergias, vacunación y archivo lógico.
- **Clínica Odontológica / Firestore:** crear paciente junto con su historial inicial, consultar agenda y expediente, archivar y registrar sesiones de tratamiento. La sesión actualiza cita e historial/odontograma en una transacción.
- **Laboratorio Clínico / MongoDB:** buscar y crear pacientes, archivar expediente, registrar órdenes con resultados variables embebidos y consultar historial analítico por paciente.

La ficha del paciente incluye una línea de tiempo de la información persistida. Si el motor de la institución no está disponible, la API responde con un error en vez de simular lecturas o escrituras en memoria.

## Sesiones de demostración

| Usuario | Acceso |
|---|---|
| `hospital` | Hospital General |
| `pediatria` | Centro Médico Pediátrico |
| `odontologia` | Clínica Odontológica |
| `laboratorio` | Laboratorio Clínico |
| `admin` | Selector institucional |

Configura contraseñas locales para estas cuentas con `APP_HOSPITAL_PASSWORD`, `APP_PEDIATRIA_PASSWORD`, `APP_ODONTOLOGIA_PASSWORD`, `APP_LABORATORIO_PASSWORD` y `APP_ADMIN_PASSWORD` en `.env`. El archivo se excluye de Git. Define contraseñas propias al desplegar y no uses datos clínicos reales con cuentas de demostración.

