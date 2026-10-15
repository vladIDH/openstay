# Fairguest en Italia: guía para el anfitrión

Fairguest comunica los huéspedes a la **Polizia di Stato** desde su ordenador, con el servicio **Alloggiati Web**. Los datos de los huéspedes quedan cifrados en su ordenador y se borran solos en cuanto el envío queda registrado. No hay ningún servidor nuestro en medio.

> Versión de Fairguest en desarrollo (octubre de 2026). Esta guía cubre **Alloggiati Web**, la comunicación a **Istat** de la región, el **enlace para el huésped** y la **foto del documento**.
>
> No es un asesoramiento legal. Los puntos marcados **[NV]** aún no se han comprobado con un envío real.

[Versione italiana](fairguest-italia.md)

## Qué hace falta

1. **Las credenciales de Alloggiati Web** de su alojamiento, que se piden a la **Questura** de la provincia. También valen para los alquileres de menos de 30 días (art. 19-bis DL 113/2018). Recibirá:
   - un **usuario** y una **contraseña**;
   - una **tarjeta de códigos** con PUK, que solo sirve para entrar en la web.
2. **La «Chiave Web Service» (WSKEY).** Entre en el [portal](https://alloggiatiweb.poliziadistato.it/PortaleAlloggiati/), abra el menú de su usuario y elija «Chiave Web Service».
   - Se genera **una al día**.
   - Hay que **generarla de nuevo cada vez que cambie la contraseña**, y luego volver a guardarla en Fairguest.
3. **Varios apartamentos con un solo usuario.** Si la Questura le dio un usuario «Gestione Appartamenti»:
   - cada apartamento tiene un número (IdAppartamento), que aparece en el portal, en «Appartamenti»;
   - ese número va en los ajustes de cada alojamiento.
4. **Fairnight instalado**, con la carpeta de sus alojamientos (vea el README).

## Cómo se activa

### 1. El alojamiento

En `fairnight.config.json`, añada un bloque `fairguest` a cada alojamiento situado en Italia:

```json
"fairguest": {
  "country": "IT",
  "establishment": "IT000XX000000",
  "checkInTime": "15:00",
  "checkOutTime": "10:00",
  "alloggiati": { "account": "principale" }
}
```

- `establishment`: un código suyo para el alojamiento. El CIN sirve.
- `checkInTime` y `checkOutTime`: sirven para los plazos. Una estancia de 24 horas o menos tiene **6 horas** en lugar de 24.
- `alloggiati.account`: el nombre que da a las credenciales. Si todos los alojamientos usan el mismo usuario, deje `principale`. Si tiene varios usuarios, use un nombre para cada uno.
- `alloggiati.apartmentId`: solo para usuarios «Gestione Appartamenti». Es el número del apartamento en el portal.

### 2. Fairguest

```
fairnight ospiti attiva
```

**La frase secreta.** Elija una de al menos 12 caracteres. Sin ella nadie puede leer los datos de los huéspedes: ni usted, ni nosotros, ni nadie. **Si la pierde, los datos no se recuperan.**

**Las tablas oficiales.** Fairguest descarga del portal las tablas de municipios, Estados y documentos.
- Las guarda en `data/fairguest/alloggiati/` y las vuelve a descargar cuando tienen más de un mes.
- Para descargarlas de nuevo en cualquier momento: `fairnight ospiti tabelle`.

### 3. Las credenciales de Alloggiati Web

```
fairnight ospiti credenziali
```

- Pide usuario, contraseña y clave. **La contraseña y la clave no se ven al escribirlas** y nunca pasan por la línea de comandos.
- Se guardan **selladas con su clave**: solo se abren con la frase secreta.
- Con varios usuarios, añada `--account nombre`.

Para comprobarlas con la Polizia di Stato **sin enviar ninguna ficha**:

```
fairnight ospiti credenziali --verifica
```

## Qué ve el huésped

El formulario se abre de dos maneras:

- **desde la red de casa:** `fairnight serve --lan` y el enlace de `fairnight ospiti elenco`, en un teléfono o una tableta conectados a su red;
- **desde cualquier lugar:** el enlace de `fairnight ospiti link <estancia>`, que se manda al huésped como le escribe normalmente. Vea «El enlace para el huésped» más abajo.

El formulario está en italiano, inglés y español, en tres pasos: sus datos, documento y confirmación. Para un alojamiento en Italia pide solo lo que pide Alloggiati Web:

| Huésped | Qué rellena |
|---|---|
| Todos | nombre, apellidos, sexo, fecha de nacimiento, ciudadanía, Estado de nacimiento. El municipio (y, si hace falta, la provincia) solo para quien nació en Italia |
| Solo quien reservó | el documento: tipo (pasaporte, carta de identidad electrónica o de papel, permiso de conducir), número y Estado de expedición. El municipio solo para documentos expedidos en Italia |
| Los demás | el parentesco con quien reservó, si son familiares. Así Fairguest sabe si es una familia (cabeza de familia y familiares) o un grupo (jefe de grupo y miembros) |

**No pide** dirección, teléfono, email ni pago: en Italia la ley no los exige, así que el formulario no los recoge.

Arriba, el huésped lee una línea sobre qué pasa con sus datos: quedan cifrados en su ordenador, van solo a la Polizia di Stato y se borran solos después del envío. También se le dice que **a la llegada usted le reconocerá en persona o por videollamada**, con el documento.

## El enlace para el huésped

```
fairnight ospiti link <estancia>
```

Imprime una dirección como `https://fairguest.khlumen.com/c/…#v1.…`. Mándela al huésped: funciona desde cualquier teléfono hasta dos días después de la salida. Su ordenador **no abre ningún puerto**: solo hace peticiones de salida.

**Cómo viajan los datos**
1. El huésped rellena el formulario en su teléfono. Tiene el mismo aspecto y las mismas preguntas que el de casa.
2. **El teléfono cifra los datos** con la clave pública de su carpeta Fairguest antes de enviarlos.
3. El servicio de reenvío (`fairguest.khlumen.com`) solo recibe texto cifrado y lo guarda en un buzón de la estancia.
4. Su ordenador lo descarga y lo borra del servicio:
   - con `fairnight ospiti scarica`;
   - solo, cada 5 minutos, mientras `fairnight serve` está en marcha;
   - antes de `ospiti elenco` y de `ospiti invia`.
5. En su ordenador los datos siguen cifrados: solo se abren con la frase secreta.

**Qué ve quien gestiona el servicio de reenvío**
- Ve la dirección IP del teléfono y la hora, como cualquier web.
- Ve un texto cifrado, siempre de la misma longitud.
- No ve nombres ni documentos, ni cuántos caracteres escribió el huésped.
- No ve su clave, el alojamiento ni las fechas: van detrás del `#` del enlace, y los navegadores nunca los envían al servidor.
- No guarda registros de las peticiones.
- Cada buzón se borra solo dos días después de la salida.

**Qué puede hacer quien tenga el enlace:** añadir huéspedes a esa estancia, no leerlos. Si un enlace acaba en malas manos:
- revise los huéspedes con `fairnight ospiti mostra`;
- borre los que sobren con `fairnight ospiti cancella <estancia> --persona N --applica`.

**Comprobar la página**

```
fairnight ospiti verifica-pagina
```

Compara cada fichero que el servicio manda al teléfono con la huella (SHA-256) de la página de esta versión de Fairguest. Cada línea debe decir `same`.

Hace falta porque quien gestiona el servicio podría cambiar la página para leer los datos antes de cifrarlos: es el límite de cualquier formulario en la web. Para tener el control completo:
- aloje el servicio usted mismo: instrucciones en [packages/fairguest-relay/README.md](../packages/fairguest-relay/README.md);
- después ponga su dirección en `fairnight.config.json` con `"fairguestRelay": "https://…"`.

## La foto del documento

En la página del enlace, el huésped puede tocar «Hacer o elegir una foto» y encuadrar las líneas de letras y `<<<` del documento:
- en el pasaporte, al pie de la página de la foto;
- en el DNI o la carta de identidad electrónica, en el reverso.

**Qué se rellena solo:** nombre, apellidos, fecha de nacimiento, sexo, ciudadanía, tipo y número del documento, Estado de expedición. En el DNI español también el número de soporte. El huésped revisa los datos y completa el resto.

**Dónde pasa todo:**
- **La lectura se hace en el teléfono.** El programa de lectura (Tesseract) y su modelo para esas líneas son ficheros del propio servicio: no se contacta con ningún otro sitio.
- **La foto nunca se envía ni se guarda.** Está en memoria solo mientras se lee y después se borra. Fairguest no guarda copias del documento en ningún sitio, que es lo que piden la AEPD y el Garante italiano.
- **Las cifras de control** de esas líneas dicen si la lectura es correcta. Si no cuadran, el huésped ve un aviso y revisa los datos.
- **Sin esas líneas** (por ejemplo, la antigua carta de identidad italiana de papel) se rellena a mano.

Captura desde un teléfono, con datos inventados: [datos leídos de la foto](images/link/link-es-2-letto.png).

## Istat: el movimiento turístico de la región

Es una obligación distinta de Alloggiati Web. Cada región italiana recoge llegadas y pernoctaciones con su propio portal y sus plazos. Fairguest envía **solo lo que necesita la estadística**, sin nombres ni documentos:
- sexo y fecha de nacimiento;
- ciudadanía, Estado y municipio de nacimiento;
- residencia;
- tipo de huésped (solo, familia o grupo);
- fechas de llegada y de salida.

### Su región

| Región o provincia | Portal | Qué hace Fairguest |
|---|---|---|
| Piemonte, Lombardia, Liguria, Emilia-Romagna, Veneto, Toscana (solo Florencia, Prato, Pistoia), Marche, Lazio, Abruzzo, Molise, Calabria, Cerdeña, Basilicata | ROSS1000 | **envío automático** con el servicio web de la región, o fichero XML para subir |
| Provincia de Trento | ISTATalloggi | fichero CSV para subir |
| Umbria | Turismatica | un fichero de texto por día (modelo C/59) para subir |
| Puglia | SPOT Easy | se sube el mismo fichero de la Questura (`fairnight ospiti prepara`) |
| Valle d'Aosta, Friuli Venezia Giulia, Provincia de Bolzano, Toscana (otras provincias), Campania, Sicilia | portal regional | **solo a mano**: Fairguest imprime las cifras del mes para copiarlas |

Las fuentes son las páginas oficiales y los manuales de los portales, consultados el 15/10/2026. Para ROSS1000 se sigue el «Tracciato record di integrazione dati (XML)», versión 3 del 18/03/2026.

### Cómo se activa

En el bloque `fairguest` del alojamiento:

```json
"rooms": 2,
"beds": 4,
"istat": { "region": "lazio", "code": "EL-CODIGO-DE-LA-ESTRUCTURA" }
```

- `region`, uno de estos valores:
  - con ROSS1000: `piemonte`, `lombardia`, `liguria`, `emilia-romagna`, `veneto`, `toscana-fi-po-pt`, `marche`, `lazio`, `abruzzo`, `molise`, `calabria`, `sardegna`, `basilicata`;
  - con fichero: `trento`, `umbria`, `puglia`;
  - solo a mano: `valle-d-aosta`, `friuli-venezia-giulia`, `bolzano`, `toscana`, `campania`, `sicilia`.
- `code`: el código de la estructura dado por la región (ROSS1000), el CIPAT (Trento) o el nombre de la estructura (Umbria y regiones a mano).
- `rooms` y `beds`: habitaciones y plazas. Solo hacen falta con ROSS1000, que los pide para cada día. La configuración guiada (`fairnight configura`) los pregunta solo en ese caso.

Con ROSS1000 hacen falta también las credenciales de transmisión de la estructura. Si entra en el portal con SPID o CIE, pida una «password di trasmissione» a la oficina de turismo de la región.

```
fairnight ospiti credenziali --istat
```

### Qué cambia en el formulario del huésped

Para un alojamiento con Istat activo, el formulario pide también la **residencia**:
- el Estado;
- el municipio, si vive en Italia, o la ciudad, si vive en el extranjero.

### El mes

```
fairnight ospiti istat --mese 2026-10              # prepara el mes: ficheros y cifras, no envía nada
fairnight ospiti istat --mese 2026-10 --applica    # ROSS1000: envía los días listos
```

**Con ROSS1000**
- Cada día del mes es un movimiento, también los días sin huéspedes. Los días bloqueados en el calendario figuran como cerrados.
- Fairguest escribe también el fichero XML para el portal.
- Con `--applica` envía los días listos y anota los aceptados, que no vuelve a enviar.

**Los demás casos**
- **Trento:** el CSV del mes.
- **Umbria:** un fichero por día.
- **Regiones a mano:** llegadas y pernoctaciones por procedencia, y noches ocupadas.

En los primeros 15 días del mes, `fairnight ospiti` recuerda el mes anterior.

### Conservación

- **Cuando Alloggiati Web acepta las fichas**, los datos de los huéspedes se borran. Antes, Fairguest guarda aparte, cifrada, la **ficha Istat**, sin nombres ni documentos.
- **La ficha Istat se borra:**
  - con ROSS1000, en cuanto la región acepta el día de llegada y el de salida;
  - en los demás casos, a partir del día 16 del mes siguiente a la salida.
- **Un borrado pedido por el huésped** se lleva también la ficha Istat.

### Por comprobar con el primer envío real [NV]

- **ROSS1000:**
  - las mayúsculas de «Non specificato»;
  - el orden de las respuestas por día;
  - la versión V1 de Basilicata.
- **Trento:** los códigos de procedencia de los extranjeros.
- **Umbria:**
  - los códigos de procedencia;
  - la alineación de los números;
  - los saltos de línea.

## El reconocimiento del huésped

La sentencia del **Consiglio di Stato n.º 9101/2025** volvió a poner en vigor la circular del 18/11/2024: quien aloja debe comprobar que la persona corresponde al documento.
- Se comprueba **en persona** o por una conexión de vídeo **en directo**.
- **No bastan** el envío del documento, una caja de llaves o un código.

Por eso Fairguest **no envía nada a Alloggiati Web hasta que usted marca el reconocimiento**:

```
fairnight ospiti riconosciuto <estancia>
```

El formulario rellena los datos y le ahorra tiempo, pero **no sustituye al reconocimiento**.

## El envío, una vez al día

```
fairnight ospiti                      # qué vence y qué va con retraso
fairnight ospiti invia                # las fichas de hoy: las prepara y las revisa, no envía nada
fairnight ospiti invia --prova        # Alloggiati Web las revisa sin registrarlas
fairnight ospiti invia --applica      # las revisa y las envía
```

**Plazos** (art. 109 TULPS):
- en las **24 horas siguientes a la llegada**;
- en **6 horas** si la estancia dura 24 horas o menos.

Si falta una hora, la cuenta empieza a medianoche: el plazo que se muestra nunca es posterior al real. La página del calendario (`fairnight serve`) también avisa cuando algo vence o va con retraso.

**Qué hace `--applica`**
1. Pide la frase secreta y un token a Alloggiati Web.
2. Primero revisa siempre las fichas (`Test`).
3. Envía (`Send`) solo las estancias con **todas** las fichas correctas.
4. Anota el resultado de cada estancia. Si una ficha está mal, muestra el código de error del servicio y no envía esa estancia.
5. En cuanto el envío es aceptado, **borra los datos de los huéspedes**. Solo queda la línea «enviado el …».

**Límites del servicio**
- Alloggiati Web solo acepta llegadas **de hoy o de ayer**. Si una llegada es más antigua, Fairguest se lo dice: pregunte a la Questura cómo comunicarla.
- Una ficha declara como mucho **30 días** de estancia.
- Fairguest nunca envía dos veces la misma estancia.

**Envío a mano desde el portal**

```
fairnight ospiti prepara <estancia>
```

- Escribe el fichero de texto (líneas de 168 caracteres) en `data/fairguest/`.
- Súbalo en el portal con «Invio File».
- Luego anote el envío con `fairnight ospiti inviato <estancia>`.
- El fichero lleva los datos sin cifrar: se borra al anotar el envío.

### Envío automático (se activa a propósito)

`fairnight ospiti invia --applica` puede lanzarse desde una tarea programada, por ejemplo cada noche a las 21. Para eso:
- la frase secreta tiene que estar en la variable `FAIRGUEST_FRASE` de la tarea;
- cada alojamiento tiene que tener:

```json
"alloggiati": { "account": "principale", "autoSend": true }
```

Sin `autoSend: true`, Fairguest se niega a enviar si no hay una terminal delante.

**Los riesgos, que conviene conocer antes de activarlo:**
- **La frase queda en el ordenador**, sin cifrar, en la configuración de la tarea. Quien acceda al ordenador, o a una copia de seguridad, puede leer los datos de los huéspedes y las credenciales de Alloggiati Web. Proteja el ordenador con contraseña y cifre el disco.
- **El reconocimiento sigue siendo cosa suya.** La tarea solo envía las estancias marcadas con `ospiti riconosciuto`. Las demás se quedan pendientes y aparecen en `fairnight ospiti`.
- **Nadie ve los errores en el momento.** Un error del servicio o una ficha rechazada quedan en el registro de la tarea. Revise cada día `fairnight ospiti`: sale con código 1 cuando algo va con retraso.
- **Las credenciales cambian.** Tras un cambio de contraseña la clave anterior deja de valer, y la tarea falla hasta que guarde la nueva.

## Los recibos

Por cada día con envíos, Alloggiati Web prepara un **recibo en PDF**:
- solo se puede descargar durante los **últimos 30 días**, sin contar hoy;
- hay que **guardarlo 5 años** (DM 7/1/2013, art. 4-bis).

```
fairnight ospiti ricevute
```

- Descarga los recibos que faltan y los guarda en `data/fairguest/ricevute/`.
- Los borra solo pasados 5 años.
- Ejecútelo al menos una vez por semana: pasados 30 días el recibo ya no se puede descargar.

## Conservación de los datos

| Qué | Cuánto se guarda |
|---|---|
| Datos de los huéspedes (cifrados) | hasta que Alloggiati Web acepta el envío; después se borran en el acto (DM 7/1/2013, art. 4-bis). Una reserva anulada se borra en el acto |
| Fotos o copias del documento | nunca: la foto se lee en el teléfono del huésped y no se guarda ni se envía |
| Servicio de reenvío del enlace | solo texto cifrado, borrado al descargarlo; cada buzón se borra solo dos días después de la salida |
| Recibos de Alloggiati Web | 5 años, luego se borran |
| Credenciales de Alloggiati Web | selladas, hasta que las cambie |
| Tablas de códigos | en su ordenador, se descargan de nuevo cada mes |

El borrado actúa sobre el fichero `data/fairnight.db` y **no toca las copias de seguridad**. Si copia la carpeta, borre esas copias con la misma regla.

## La primera prueba real

El servicio **no tiene un entorno de pruebas aparte**: también la revisión (`Test`) se hace en el servicio real, con credenciales reales. Por eso el primer uso se hace con un anfitrión que lo acepte, en este orden:

1. `fairnight ospiti credenziali --verifica`: solo pide el token y lo comprueba, no envía fichas.
2. Una estancia real, con el huésped reconocido, el día de llegada:
   - `fairnight ospiti invia` (revisión local);
   - después `fairnight ospiti invia --prova` (revisión de Alloggiati Web, sin registrar).
3. Solo si la revisión sale toda correcta, `fairnight ospiti invia --applica`.
4. Al día siguiente, `fairnight ospiti ricevute`. Compare el recibo con el portal.

**Por confirmar con la primera prueba [NV]:**
- los días de estancia escritos con cero delante (`03`);
- los nombres con letras acentuadas;
- el número máximo de fichas por llamada;
- la duración del token;
- la codificación del fichero subido a mano: el manual dice UTF-8, el DM 2013 habla de ASCII.

## Fuentes

- [Portal Alloggiati Web](https://alloggiatiweb.poliziadistato.it/PortaleAlloggiati/)
- [Manual del servicio web, rev. 01 del 24/01/2022](https://alloggiatiweb.poliziadistato.it/PortaleAlloggiati/Download/Manuali/MANUALEWS.pdf)
- [Manual de usuario (cap. 12, formato del fichero)](https://alloggiatiweb.poliziadistato.it/PortaleAlloggiati/Download/Manuali/MANUALEALBERGHI.pdf)
- [Tablas de códigos](https://alloggiatiweb.poliziadistato.it/PortaleAlloggiati/Tabelle.aspx)
- [DM 16 de septiembre de 2021, GU n.º 246 del 14/10/2021](https://www.gazzettaufficiale.it/eli/id/2021/10/14/21A06000/sg)
- [Garante privacy, nota del 29/04/2026 sobre las copias de documentos](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/10244289)
- [Consiglio di Stato, sección III, sentencia n.º 9101/2025](https://mdp.giustizia-amministrativa.it/visualizza/?nodeRef=&schema=cds&nrg=202505732&nomeFile=202509101_11.html&subDir=Provvedimenti)
