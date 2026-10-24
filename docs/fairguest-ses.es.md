# Fairguest y SES.HOSPEDAJES: el envío desde su ordenador

Para los alojamientos de España fuera de Cataluña (`"country": "ES"`), Fairguest prepara el **parte de viajeros** (PV) y la **reserva de hospedaje** (RH) del Real Decreto 933/2021 y los manda al servicio web del Ministerio del Interior.

> Versión en desarrollo (octubre de 2026). No es asesoramiento legal. Los puntos marcados **[NV]** aún no se han comprobado con un uso real.

[Versione italiana](fairguest-ses.md)

## El estado hoy

| Pieza | Estado |
|---|---|
| Configuración: código de arrendador, código de establecimiento, entorno | lista |
| Usuario y contraseña del servicio web, sellados en la base de datos | listos |
| Control de los datos y vista previa de lo que recibe SES | listos |
| Envío con confirmación, número de lote, resultado (`consultaLote`), rechazos y reenvío | listos, probados solo con un servicio simulado |
| **XML** del PV y de la RH | **a la espera de los XSD del Ministerio** |

Mientras falten los XSD, `prepara` e `invia` se detienen **antes de cualquier conexión** con este mensaje: «the XML is not switched on yet». Mientras tanto, los datos se introducen en la web de SES y se registran con `fairnight ospiti inviato`.

## 1. Qué necesita

1. El **alta del arrendador** en la sede electrónica de SES.HOSPEDAJES, con certificado digital o Cl@ve. Le dan el **código de arrendador** (10 caracteres).
2. Cada alojamiento registrado tiene un **código de establecimiento** (10 caracteres).
3. **Usuario y contraseña del servicio web**: son distintos de los de la web (Guía visual, cap. 9). El canal de servicio web debe estar habilitado; si no, el Ministerio responde con el error 10120.
4. Para el entorno de pruebas hacen falta credenciales de pruebas: se piden con el correo de [registro-ospiti.md](registro-ospiti.md#a-mail-per-le-credenziali-dellambiente-di-prova) **[NV]**.

## 2. La configuración

En el bloque `fairguest` del alojamiento, en `fairnight.config.json`:

```json
"fairguest": {
  "country": "ES",
  "establishment": "0000000099",
  "professional": false,
  "checkInTime": "16:00",
  "checkOutTime": "11:00",
  "ses": {
    "landlord": "0000000001",
    "account": "principale",
    "environment": "test"
  }
}
```

- `establishment`: el código de establecimiento.
- `ses.landlord`: el código de arrendador.
- `ses.account`: el nombre de las credenciales guardadas. Solo hace falta con varios arrendadores; si falta, vale `principale`.
- `ses.environment`: `"test"` (el servicio de pruebas del Ministerio, **pre-ses**: no registra nada) o `"production"`. Si falta, vale `"test"`.

**Nunca aquí el usuario ni la contraseña.** Se guardan así, una vez por entorno:

```
fairnight ospiti credenziali --ses                        # entorno de pruebas
fairnight ospiti credenziali --ses --ambiente produzione  # producción
```

Fairnight los pide en un terminal (la contraseña sin eco) y los sella en la base de datos con su clave Fairguest. Solo se abren con la frase secreta.

## 3. El uso diario

```
fairnight ospiti                                  # qué vence y qué va con retraso
fairnight ospiti prepara --ses <estancia>          # vista previa: los campos exactos que recibirá SES
fairnight ospiti invia --ses                       # qué estancias saldrían y hacia qué entorno
fairnight ospiti invia --ses --applica             # envía, después de que escriba SEND
fairnight ospiti esito --ses                       # lee el resultado de los lotes enviados
```

- `--tipo prenotazione` manda la **RH**; sin `--tipo` sale el **PV** (entrada).
- Sin argumentos, `invia` toma los PV de las llegadas hasta hoy y las RH de las estancias no terminadas que aún no se han comunicado.
- `--ambiente prova` manda siempre al entorno de pruebas, aunque el alojamiento esté en producción.
- `--ambiente produzione` funciona **solo** si la configuración dice `"environment": "production"`. Son dos llaves para la misma puerta.

**La confirmación.** Con `--applica` Fairnight escribe cuántas comunicaciones salen, de qué tipo y hacia qué entorno, y solo envía si usted escribe `SEND`. Sin un terminal (una tarea programada) no envía nunca.

## 4. El registro, los errores, el reenvío

Cada envío queda en `data/fairnight.db`, con el número de lote y las respuestas del Ministerio. `fairnight ospiti mostra <estancia>` lo lista.

| Qué pasa | Qué registra Fairguest | Qué hace usted |
|---|---|---|
| SES acepta la petición y da un lote | `sent`, con el lote | `fairnight ospiti esito --ses` al cabo de unos minutos |
| El lote sigue en proceso | nada | repite `esito` más tarde |
| El lote registra la comunicación | `accepted`, con el codigoComunicacion | nada |
| El lote rechaza la comunicación | `rejected`, con el error del Ministerio | corrige (`ospiti correggi`) y vuelve a enviar |
| SES rechaza la petición (código, contraseña, servicio caído) | `rejected`, con el motivo | arregla la causa y vuelve a enviar |
| La respuesta no llega (red, tiempo agotado) | **nada** | comprueba en «Consulta de comunicaciones» de la web de SES **antes** de reenviar: la comunicación pudo llegar |

- Una estancia con un lote pendiente o ya aceptado no sale dos veces.
- Un cambio después de la aceptación es una comunicación nueva: hoy se hace en la web de SES.

**El entorno de pruebas no cuenta nunca.** Los envíos de prueba se registran aparte (canal `ses-prova`):
- el plazo sigue abierto;
- no hacen borrar los datos.

**Borrado.** Para un anfitrión no profesional, los datos se borran en cuanto el PV real (producción) queda **aceptado** (RD 933/2021, art. 5.4). Para un anfitrión profesional se guardan 3 años.

## 5. De dónde salen los campos

La correspondencia está en `packages/fairguest/src/countries/es-ses-parte.ts`. Las fuentes son públicas:
- «Instrucciones para el alta masiva de comunicaciones» v1.1.0 (SGTIC, 08-01-2024), [Instrucciones.pdf](https://hospedajes.ses.mir.es/hospedajes-sede/assets/docs/Instrucciones.pdf):
  - figura 1 y § 3 para el PV;
  - figura 2 y § 4 para la RH;
  - § 7.1 para la dirección;
  - § 7.2 para el pago;
  - § 8 para los códigos;
- la especificación «MIR-HOSPE-DSI-WS Servicio de Comunicación» v3.1.2 para el sobre SOAP y los lotes (copia de terceros, **[NV]**).

| Nuestro campo | Parte de viajeros (PV) | Notas |
|---|---|---|
| establishment | `solicitud/codigoEstablecimiento` | en la RH: `comunicacion/establecimiento/codigo` |
| reference, contractDate | `contrato/referencia`, `contrato/fechaContrato` | referencia de 50 caracteres como máximo |
| checkIn + checkInTime | `contrato/fechaEntrada` | `AAAA-MM-DDThh:mm:ss`; sin hora, medianoche (§ 4) |
| checkOut + checkOutTime | `contrato/fechaSalida` | igual |
| people, rooms, internet | `numPersonas`, `numHabitaciones`, `internet` | |
| payment.type | `contrato/pago/tipoPago` | **solo el tipo**: nunca número de tarjeta, IBAN ni titular |
| givenName, surname1, surname2 | `persona/nombre`, `apellido1`, `apellido2` | |
| document | `tipoDocumento` (NIF, NIE, PAS, OTRO), `numeroDocumento`, `soporteDocumento` | el soporte solo para NIF y NIE |
| birthDate, nationality, sex | `fechaNacimiento`, `nacionalidad` (ISO 3166-1 alfa-3), `sexo` (H, M, O) | |
| address | `persona/direccion/…` | en España, `codigoMunicipio` del INE de **5 cifras** (guardamos el de 6 con el dígito de control y quitamos el último); en el extranjero, `nombreMunicipio` |
| phone, phone2, email | `telefono`, `telefono2`, `correo` | al menos uno |
| kinship | `parentesco` | si en el grupo hay un menor; solo en el PV |

Roles: en el PV cada persona es `VI` (viajero). En la RH la primera es `TI` (titular) y las demás `VI`.

## 6. Para quien desarrolla: cuando lleguen los esquemas

Un arrendador registrado descarga de la sede electrónica la documentación del servicio web en una carpeta `openstay-ses-docs` junto al repositorio, **nunca dentro** (sección 7b de [registro-ospiti.md](registro-ospiti.md#b-file-da-scaricare-dentro-ses)). Después:

1. En `es-ses-parte.ts` se compara `SES_SCHEMA_DRAFT` con los XSD y con el WSDL. Se comprueban:
   - los espacios de nombres;
   - si los hijos están cualificados;
   - los nombres de las operaciones SOAP;
   - los códigos de estado de los lotes.
2. Se comprueba el orden de los elementos contra las secuencias de los XSD.
3. Se rellena el único punto de enganche, `SES_SCHEMA`, con la fecha de la comprobación.
4. La prueba `packages/fairguest/test/ses-xsd.test.ts` se activa sola cuando encuentra los `.xsd` en la carpeta, o en `OPENSTAY_SES_DOCS`. Valida cada documento generado con `xmllint`, que hay que instalar.
5. Prueba en el **entorno de pruebas** del Ministerio con datos inventados: `fairnight ospiti invia --ses --applica --ambiente prova`, después `esito --ses`.
6. Solo después, y con un anfitrión que lo acepte, el primer envío en producción.
