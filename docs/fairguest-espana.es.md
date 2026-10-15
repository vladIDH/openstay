# Fairguest en España: el enlace para el huésped y la foto del documento

En España Fairguest prepara la comunicación de los viajeros (Real Decreto 933/2021) para:
- **SES.HOSPEDAJES**, con `"country": "ES"`;
- los **Mossos d'Esquadra** en Cataluña, con `"country": "ES-CT"`.

El modelo de datos y los plazos están en [registro-ospiti.md](registro-ospiti.md) y en el README de fairnight-cli. Esta guía explica el **enlace** que funciona desde cualquier lugar y la **foto del documento**: son los mismos que en Italia.

> Versión en desarrollo (octubre de 2026). No es asesoramiento legal. Los puntos marcados **[NV]** aún no se han comprobado con un uso real.

[Versione italiana](fairguest-spagna.md)

## El enlace

```
fairnight ospiti link <estancia>
```

Imprime una dirección como `https://fairguest-relay.openstay.workers.dev/c/…#v1.…`. Mándela al huésped: funciona desde cualquier teléfono hasta dos días después de la salida.

**Qué hace el huésped**
- Rellena el formulario de siempre, con las preguntas del Real Decreto 933/2021: dirección, teléfono o correo y tipo de pago (solo el tipo, nunca números de tarjeta).
- El teléfono cifra cada huésped con la clave pública de su carpeta Fairguest antes de enviarlo.
- El servicio de reenvío solo ve texto cifrado de longitud fija.

**Qué hace su ordenador**
- Descarga los huéspedes y los borra del servicio:
  - con `fairnight ospiti scarica`;
  - solo, cada 5 minutos, con `fairnight serve` en marcha;
  - antes de `ospiti elenco`.
- No abre ningún puerto.
- Los datos siguen cifrados y se abren solo con la frase secreta.

**Comprobar el servicio:** `fairnight ospiti verifica-pagina` compara cada fichero que el servicio sirve con la huella de la página de esta versión.

El detalle de qué ve quien gestiona el servicio, y cómo alojarlo usted mismo, está en la guía italiana, apartado «Il link da mandare all'ospite» ([versión en español](fairguest-italia.es.md#el-enlace-para-el-huésped)), y en [packages/fairguest-relay/README.md](../packages/fairguest-relay/README.md).

## La foto del documento

El huésped toca «Hacer o elegir una foto» y encuadra las líneas de letras y `<<<`:
- en el **DNI**, en el reverso;
- en el **pasaporte**, al pie de la página de la foto.

**DNI español**
- El DNI lleva el número de soporte en el lugar del número del documento, y el número de DNI en los datos opcionales.
- Fairguest pone cada uno en su campo: «Número de documento» (DNI) y «Número de soporte».
- Separa los dos apellidos.

**Otros documentos**
- Un pasaporte español marca «Pasaporte expedido en España», que los Mossos piden en otro campo.
- Las tarjetas de identidad extranjeras, como la carta d'identità italiana, se ponen como «Otro documento de identidad».

**Dónde pasa todo:**
- **La lectura se hace en el teléfono.** El programa de lectura y su modelo los sirve el propio servicio: no se contacta con ningún otro sitio.
- **La foto nunca se envía ni se guarda**, como pide la AEPD (no hace falta copia del DNI).
- **Las cifras de control** dicen si la lectura es correcta. Si alguna no cuadra, el huésped ve «algunos caracteres no son seguros» y revisa los datos.

Captura desde un teléfono, con datos inventados: [DNI leído en un alojamiento de Cataluña](images/link/link-es-dni-leido.png).

## El municipio de residencia

Para quien vive en España, SES y los Mossos piden el **código INE del municipio**. El huésped no lo sabe, así que el formulario pregunta el municipio por su nombre:
- el campo «Municipio o ciudad» sugiere los 8.132 municipios de la relación oficial del INE (1 de enero de 2026), también sin JavaScript;
- no importan mayúsculas ni tildes, el artículo puede ir delante o detrás («Las Palmas de Gran Canaria») y los nombres bilingües responden a cada mitad («San Sebastián», «Donostia»);
- si dos municipios se llaman igual, decide el código postal (sus dos primeras cifras son la provincia);
- un lugar que no es un municipio (un barrio, «Costa Adeje») se rechaza con un mensaje que pide elegirlo de la lista.

Fairguest guarda el código completo de 6 cifras (provincia, municipio, dígito de control; Adeje 380012), como lo pide el fichero de los Mossos (manual v8, campo 29). A SES van las 5 primeras (38001), como dicen las instrucciones de SES («códigos de municipios del INE (5 dígitos)»). El anfitrión ya no tiene que corregir nada. Con `fairnight ospiti correggi … address.municipalityCode` se pueden escribir 5 o 6 cifras: un código que no existe se rechaza.

| El campo | No es un municipio | Elegido | Guardado |
|---|---|---|---|
| ![Campo](images/ine/ine-1-campo.png) | ![Error](images/ine/ine-2-non-e-un-comune.png) | ![Elegido](images/ine/ine-3-scelto.png) | ![Guardado](images/ine/ine-4-salvato.png) |

La relación se actualiza una vez al año: se descarga a mano `NNcodmun.xlsx` del INE y se lanza `node packages/fairguest/scripts/es-municipalities.mjs <fichero> <año>`.

## Después

**Mossos d'Esquadra**
- `fairnight ospiti prepara <estancia>` escribe el fichero para «Envío de ficheros masivos».
- Lo probamos con un huésped llegado por el enlace y la foto de un DNI inventado: número de DNI, soporte y apellidos van a sus campos.

**SES.HOSPEDAJES**
- El envío automático espera los esquemas XSD del Ministerio: vea registro-ospiti.md, sección 7b.
- Mientras tanto, los datos del huésped se copian en la web de SES y se anota el envío con `fairnight ospiti inviato`.

**Por comprobar con huéspedes reales [NV]**
- la precisión de la lectura con fotos reales de teléfono;
- el DNI de modelo antiguo y el TIE.
