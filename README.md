# test-manager-library-3413974-tool

> **Prueba técnica · Ficha ADSO 3413974**
> Horario: de **9:15 a. m. a 3:00 p. m.** (15:00). Después, **feria de presentación** de cada proyecto.

Este repositorio contiene el sembrador de datos de demostración de *Manager Library*. La herramienta
usa exclusivamente la API HTTP; no abre conexiones a PostgreSQL ni inserta filas directamente.

## Stack y desarrollo guiado por especificación

| Capa | Tecnología |
|---|---|
| Frontend | React |
| Backend | PHP con Laravel |
| Sembrador | Node.js en contenedor |

Se conservan las historias, reglas, contrato API y modelo de datos del spec. La prueba evalúa cómo
se aplica SDD (*Spec-Driven Development*) al stack tecnológico definido.

## Ejecutar el sembrador

Desde la raíz del proyecto, después de aplicar las migraciones y aprovisionar al administrador:

```powershell
docker compose --profile tools --env-file infra\.env -f infra\compose.yaml run --build --rm tool
```

La ejecución identifica y reutiliza **40 libros** y **10 socios**, y asegura al menos **15 préstamos**
y **3 préstamos activos vencidos**. Una segunda ejecución no duplica el catálogo, los socios ni los
préstamos demostrativos. Al final verifica por API el listado de vencidos y el reporte de más
prestados.

El perfil Compose dirige las escrituras a `api-demo`, una instancia temporal de Laravel conectada a
la misma base y al mismo secreto JWT de la API principal. `DEMO_LIBRARY_TIME` (por defecto
`2020-01-01T12:00:00Z`) permite crear préstamos históricos usando las rutas contractuales
existentes; las comprobaciones se hacen contra la API principal con su reloj real. No agrega rutas
al contrato ni ejecuta SQL.

## Los seis repositorios

| Repositorio | Responsabilidad |
|---|---|
| [`docs`](https://github.com/code-sena/test-manager-library-3413974-docs) | Spec y decisiones SDD |
| [`api`](https://github.com/code-sena/test-manager-library-3413974-api) | Backend Laravel |
| [`app`](https://github.com/code-sena/test-manager-library-3413974-app) | Frontend React |
| [`page`](https://github.com/code-sena/test-manager-library-3413974-page) | Sitio público estático |
| [`infra`](https://github.com/code-sena/test-manager-library-3413974-infra) | Docker Compose y PostgreSQL |
| [`tool`](https://github.com/code-sena/test-manager-library-3413974-tool) | Sembrador de datos de demostración |
