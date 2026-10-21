<#
  Installa (o aggiorna) Fairnight su Windows.

  Si lancia con un doppio clic su "Installa Fairnight (Windows).cmd". Cosa fa:
  1. controlla che ci sia Node.js 22 o più recente; se manca spiega come installarlo
     (non scarica niente da solo);
  2. installa Fairnight nella cartella Fairnight dell'utente (C:\Users\<nome>\Fairnight\programma):
     dalla copia del progetto, se questo file sta dentro il progetto, altrimenti da npm;
  3. crea l'icona Fairnight sul desktop e nel menu Start;
  4. la prima volta fa partire la configurazione guidata, poi apre il calendario.
  I dati (impostazioni e calendari) stanno solo in quella cartella. Rilanciarlo aggiorna
  il programma e non tocca i dati.
  Parla spagnolo se Windows è in spagnolo, italiano altrimenti (-Lingua la sceglie).
  Il registro installazione.log resta in italiano: è per noi.
#>
# Un parametro scritto male (-Cartela) ferma lo script invece di installare nella cartella di default.
[CmdletBinding()]
param(
  # Dove installare: per le prove si usa una cartella a parte.
  [string]$Cartella = (Join-Path $env:USERPROFILE 'Fairnight'),
  # Nessuna domanda e nessuna pausa (prove automatiche).
  [switch]$SenzaDomande,
  # Alla fine non apre il calendario.
  [switch]$NonAprire,
  # Non crea l'icona sul desktop e nel menu Start.
  [switch]$SenzaCollegamenti,
  # La lingua dei messaggi e della configurazione guidata; senza, quella di Windows.
  [ValidateSet('it', 'es')] [string]$Lingua
)

$ErrorActionPreference = 'Stop'
$Email = 'hello@khlumen.com'
$NodeMinimo = 22
# La pagina è in inglese (anche /it porta lì). Pulsanti verificati il 15 ottobre 2026: «Windows Installer (.msi)»,
# sotto la frase «Or get a prebuilt Node.js for Windows running a x64 architecture», dopo un riquadro di comandi.
$PaginaNode = 'https://nodejs.org/en/download'
$Pacchetti = @('fairnight', 'fairguest', 'fairhello', 'fairnight-smoobu', 'fairnight-beds24', 'fairnight-market', 'fairnight-cli')

$Programma = Join-Path $Cartella 'programma'
$Log = Join-Path $Cartella 'installazione.log'
$Progetto = Split-Path $PSScriptRoot -Parent
$DalProgetto = Test-Path (Join-Path $Progetto 'packages\fairnight-cli\package.json')

# Le lettere accentate in UTF-8 (il file .cmd ha già fatto chcp 65001). Il simbolo dell'euro non si scrive mai:
# il carattere della console classica lo mostra come «?», qualunque sia la codifica.
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }

# Spagnolo se lo è la lingua dei menu di Windows, o se quella non è né spagnolo né italiano ma lo sono date e numeri.
# Per le prove: FAIRNIGHT_CULTURA fa finta che Windows sia in quella lingua (es-ES, it-IT, en-US...).
function LinguaDiWindows {
  $menu = if ($env:FAIRNIGHT_CULTURA) { $env:FAIRNIGHT_CULTURA } else { (Get-UICulture).Name }
  $formati = if ($env:FAIRNIGHT_CULTURA) { $env:FAIRNIGHT_CULTURA } else { (Get-Culture).Name }
  if ($menu -like 'es*') { return 'es' }
  if ($menu -like 'it*') { return 'it' }
  if ($formati -like 'es*') { return 'es' }
  return 'it'
}
if (-not $Lingua) { $Lingua = LinguaDiWindows }
# La configurazione guidata parla la stessa lingua: Fairnight la legge da LANG.
$env:LANG = if ($Lingua -eq 'es') { 'es_ES.UTF-8' } else { 'it_IT.UTF-8' }

# Tutto quello che l'host legge. {0}, {1}: i valori che si aggiungono con -f.
$Testi = @{
  it = @{
    Titolo               = 'Fairnight: i prezzi delle tue notti, calcolati sul tuo computer'
    Righe                = '---------------------------------------------------------------'
    Internet             = 'Serve la connessione a internet: Fairnight scarica i suoi componenti.'
    PremiApri            = 'Premi Invio per aprire {0} (oppure chiudi questa finestra)'
    PremiChiudi          = 'Premi Invio per chiudere'
    LaPagina             = 'la pagina nel browser'
    LaCartella           = 'la cartella con il file'
    Imprevisto           = "L'installazione si è fermata per un problema imprevisto: {0}"
    DatiIntatti          = 'I tuoi dati non sono stati toccati.'
    ScriviciLog          = 'Scrivici a {0} e allega il file installazione.log, che trovi nella cartella {1}: lo guardiamo noi.'
    ScriviciFoto         = 'Scrivici a {0} con una foto di questa finestra: lo guardiamo noi.'
    MotivoRete           = 'Sembra che manchi la connessione a internet. Controlla il Wi-Fi o il cavo, poi rilancia.'
    MotivoNonUscito      = 'Fairnight non si trova ancora su internet: forse non è ancora uscito. Riprova tra qualche giorno.'
    MotivoInUso          = "Un file di Fairnight è in uso: chiudi la finestra di Fairnight se è aperta, poi rilancia. A volte lo blocca l'antivirus."
    MotivoDisco          = "Il disco è pieno: libera un po' di spazio, poi rilancia."
    NonRiuscito          = 'Non sono riuscito a {0}. I tuoi dati non sono stati toccati.'
    NonSiRisolve1        = 'Se non si risolve, scrivici a {0} e allega il file installazione.log,'
    NonSiRisolve2        = 'che trovi nella cartella {0}: lo guardiamo noi.'
    CosaScaricare        = 'scaricare i componenti di Fairnight'
    CosaPreparare        = 'preparare Fairnight'
    CosaImpacchettare    = 'impacchettare Fairnight'
    CosaInstallare       = 'installare Fairnight'
    CosaAvviare          = 'avviare Fairnight dopo averlo installato'
    NodeManca            = 'Per far funzionare Fairnight serve Node.js, un programma gratuito (versione 22 o più recente).'
    NodeApri             = '  1. Apri la pagina ufficiale (è in inglese): {0}'
    NodeScorri           = '  2. Scorri oltre il riquadro con i comandi, fino a «Or get a prebuilt Node.js for Windows», e clicca il pulsante verde «Windows Installer (.msi)».'
    NodeInstalla         = '     Apri il file scaricato e installalo lasciando le opzioni come sono.'
    NodeRilancia         = '  3. Poi fai di nuovo doppio clic su «Installa Fairnight (Windows)».'
    NodeVecchio          = "Sul computer c'è Node.js {0}, ma Fairnight ha bisogno della versione {1} o più recente."
    NodeVecchioScorri    = '  2. Scorri oltre il riquadro con i comandi e clicca il pulsante verde «Windows Installer (.msi)». Installalo: prende il posto di quella vecchia.'
    NodeArchitettura     = "Su questo computer c'è Node.js per processori {0}: Fairnight per ora funziona con la versione x64."
    NodeArchScorri       = '  2. Scorri fino a «Or get a prebuilt Node.js for Windows running a ... architecture»: nel menu dopo «running a» scegli «x64» al posto di «ARM64».'
    NodeArchInstalla     = '     Poi clicca «Windows Installer (.msi)» e installalo: la versione x64 funziona anche sui computer con processore ARM.'
    NpmManca             = 'Ho trovato Node.js ({0}) ma non npm, che di solito arriva insieme.'
    NpmReinstalla        = 'Reinstalla Node.js dalla pagina ufficiale ({0}), poi rilancia «Installa Fairnight (Windows)».'
    Passo1               = 'Passo 1 di 3: scarico i componenti di Fairnight.'
    LentoAggiornamento   = '  La finestra può sembrare ferma per un minuto o due: è normale, lasciala aperta.'
    LentoPrimaVolta      = '  La prima volta ci vogliono 2-4 minuti e la finestra sembra ferma: è normale, lasciala aperta.'
    Passo2               = 'Passo 2 di 3: preparo Fairnight...'
    Passo3               = 'Passo 3 di 3: installo Fairnight nella tua cartella...'
    NpmAggiornamento     = 'Scarico e installo Fairnight: la finestra può sembrare ferma per un minuto. È normale, lasciala aperta.'
    NpmPrimaVolta        = 'Scarico e installo Fairnight: 1-2 minuti, e la finestra sembra ferma. È normale, lasciala aperta.'
    Installato           = 'Fairnight {0} installato'
    Aggiornato           = 'Fairnight aggiornato dalla versione {0} alla {1}'
    Reinstallato         = "Fairnight {0} reinstallato (era già l'ultima versione)"
    ChiudiERiapri        = "  Se Fairnight era aperto, chiudi la sua finestra e riaprilo dall'icona: così usa la versione appena installata."
    DescrizioneIcona     = 'Apre il calendario dei prezzi di Fairnight'
    Icone                = 'Icona Fairnight sul desktop e nel menu Start'
    DatiQui              = 'I tuoi dati restano solo su questo computer, nella cartella {0}'
    ImpostazioniRestano  = 'Le tue impostazioni restano come sono. Per cambiarle: doppio clic su «Cambia impostazioni» nella cartella Fairnight.'
    ConfigurazioneFerma  = 'La configurazione non è finita. Quando vuoi, riprendila con un doppio clic su «Cambia impostazioni» nella cartella Fairnight.'
    NonConfigurato       = 'Fairnight è installato, ma la configurazione non è stata fatta: riprendila con un doppio clic su «Cambia impostazioni» nella cartella Fairnight.'
    Fatto                = "Fatto! Da adesso apri Fairnight con l'icona Fairnight sul desktop."
  }
  es = @{
    Titolo               = 'Fairnight: los precios de tus noches, calculados en tu ordenador'
    Righe                = '----------------------------------------------------------------'
    Internet             = 'Hace falta conexión a internet: Fairnight descarga sus componentes.'
    PremiApri            = 'Pulsa Intro para abrir {0} (o cierra esta ventana)'
    PremiChiudi          = 'Pulsa Intro para cerrar'
    LaPagina             = 'la página en el navegador'
    LaCartella           = 'la carpeta con el archivo'
    Imprevisto           = 'La instalación se ha parado por un problema inesperado: {0}'
    DatiIntatti          = 'Tus datos no se han tocado.'
    ScriviciLog          = 'Escríbenos a {0} y adjunta el archivo installazione.log, que está en la carpeta {1}: lo miramos nosotros.'
    ScriviciFoto         = 'Escríbenos a {0} con una foto de esta ventana: lo miramos nosotros.'
    MotivoRete           = 'Parece que falta la conexión a internet. Revisa el wifi o el cable y vuelve a lanzarlo.'
    MotivoNonUscito      = 'Fairnight todavía no está en internet: quizá aún no ha salido. Vuelve a probar dentro de unos días.'
    MotivoInUso          = 'Un archivo de Fairnight está en uso: cierra la ventana de Fairnight si está abierta y vuelve a lanzarlo. A veces lo bloquea el antivirus.'
    MotivoDisco          = 'El disco está lleno: libera un poco de espacio y vuelve a lanzarlo.'
    NonRiuscito          = 'No he podido {0}. Tus datos no se han tocado.'
    NonSiRisolve1        = 'Si no se arregla, escríbenos a {0} y adjunta el archivo installazione.log,'
    NonSiRisolve2        = 'que está en la carpeta {0}: lo miramos nosotros.'
    CosaScaricare        = 'descargar los componentes de Fairnight'
    CosaPreparare        = 'preparar Fairnight'
    CosaImpacchettare    = 'empaquetar Fairnight'
    CosaInstallare       = 'instalar Fairnight'
    CosaAvviare          = 'abrir Fairnight después de instalarlo'
    NodeManca            = 'Para que Fairnight funcione hace falta Node.js, un programa gratuito (versión 22 o más reciente).'
    NodeApri             = '  1. Abre la página oficial (está en inglés): {0}'
    NodeScorri           = '  2. Baja más allá del recuadro con los comandos, hasta «Or get a prebuilt Node.js for Windows», y haz clic en el botón verde «Windows Installer (.msi)».'
    NodeInstalla         = '     Abre el archivo descargado e instálalo dejando las opciones como están.'
    NodeRilancia         = '  3. Luego haz otra vez doble clic en «Installa Fairnight (Windows)».'
    NodeVecchio          = 'En el ordenador está Node.js {0}, pero Fairnight necesita la versión {1} o más reciente.'
    NodeVecchioScorri    = '  2. Baja más allá del recuadro con los comandos y haz clic en el botón verde «Windows Installer (.msi)». Instálalo: sustituye al antiguo.'
    NodeArchitettura     = 'En este ordenador está Node.js para procesadores {0}: por ahora Fairnight funciona con la versión x64.'
    NodeArchScorri       = '  2. Baja hasta «Or get a prebuilt Node.js for Windows running a ... architecture»: en el menú después de «running a» elige «x64» en lugar de «ARM64».'
    NodeArchInstalla     = '     Luego haz clic en «Windows Installer (.msi)» e instálalo: la versión x64 funciona también en los ordenadores con procesador ARM.'
    NpmManca             = 'He encontrado Node.js ({0}) pero no npm, que normalmente viene con él.'
    NpmReinstalla        = 'Vuelve a instalar Node.js desde la página oficial ({0}) y lanza otra vez «Installa Fairnight (Windows)».'
    Passo1               = 'Paso 1 de 3: descargo los componentes de Fairnight.'
    LentoAggiornamento   = '  La ventana puede parecer parada durante uno o dos minutos: es normal, déjala abierta.'
    LentoPrimaVolta      = '  La primera vez tarda 2-4 minutos y la ventana parece parada: es normal, déjala abierta.'
    Passo2               = 'Paso 2 de 3: preparo Fairnight...'
    Passo3               = 'Paso 3 de 3: instalo Fairnight en tu carpeta...'
    NpmAggiornamento     = 'Descargo e instalo Fairnight: la ventana puede parecer parada durante un minuto. Es normal, déjala abierta.'
    NpmPrimaVolta        = 'Descargo e instalo Fairnight: 1-2 minutos, y la ventana parece parada. Es normal, déjala abierta.'
    Installato           = 'Fairnight {0} instalado'
    Aggiornato           = 'Fairnight actualizado de la versión {0} a la {1}'
    Reinstallato         = 'Fairnight {0} reinstalado (ya era la última versión)'
    ChiudiERiapri        = '  Si Fairnight estaba abierto, cierra su ventana y vuelve a abrirlo desde el icono: así usa la versión recién instalada.'
    DescrizioneIcona     = 'Abre el calendario de precios de Fairnight'
    Icone                = 'Icono de Fairnight en el escritorio y en el menú Inicio'
    DatiQui              = 'Tus datos se quedan solo en este ordenador, en la carpeta {0}'
    ImpostazioniRestano  = 'Tu configuración se queda como está. Para cambiarla: doble clic en «Cambia impostazioni» en la carpeta Fairnight.'
    ConfigurazioneFerma  = 'La configuración no ha terminado. Cuando quieras, retómala con doble clic en «Cambia impostazioni» en la carpeta Fairnight.'
    NonConfigurato       = 'Fairnight está instalado, pero la configuración no se ha hecho: retómala con doble clic en «Cambia impostazioni» en la carpeta Fairnight.'
    Fatto                = '¡Hecho! A partir de ahora abre Fairnight con el icono de Fairnight en el escritorio.'
  }
}
$T = $Testi[$Lingua]

function Scrivi([string]$testo, [string]$colore = 'Gray') { Write-Host $testo -ForegroundColor $colore }
function Fatto([string]$testo) { Write-Host "  OK  $testo" -ForegroundColor Green }

# Esce con 2: "Installa Fairnight (Windows).cmd" sa che il problema è già stato spiegato.
function Fermati([string[]]$righe, [string]$apri = '', [string]$cosaApre = $T.LaPagina) {
  Write-Host ''
  foreach ($r in $righe) { Write-Host $r -ForegroundColor Yellow }
  Write-Host ''
  if (-not $SenzaDomande) {
    if ($apri) {
      Read-Host ($T.PremiApri -f $cosaApre) | Out-Null
      Start-Process $apri
    } else {
      Read-Host $T.PremiChiudi | Out-Null
    }
  }
  exit 2
}

# Qualunque errore che lo script non ha previsto: spiegato in parole semplici, mai una finestra che si chiude da sola.
trap {
  $aiuto = @(
    ($T.Imprevisto -f $_.Exception.Message),
    $T.DatiIntatti
  )
  if (Test-Path $Log) {
    $aiuto += $T.ScriviciLog -f $Email, $Cartella
    Fermati $aiuto $Cartella $T.LaCartella
  }
  $aiuto += $T.ScriviciFoto -f $Email
  Fermati $aiuto
}

function TrovaNode {
  # Per le prove: FAIRNIGHT_NODE dice quale node.exe usare (un percorso che non esiste = Node mancante).
  if ($env:FAIRNIGHT_NODE) {
    if (Test-Path $env:FAIRNIGHT_NODE) { return $env:FAIRNIGHT_NODE }
    return $null
  }
  $comando = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($comando) { return $comando.Source }
  # Appena installato, Node.js può non essere ancora nel PATH di questa finestra.
  foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  return $null
}

# Esegue npm nella cartella data e mette tutto quello che stampa nel registro dell'installazione.
# Gli argomenti con spazi vanno già tra virgolette.
function Esegui([string]$dove, [string]$argomenti) {
  Add-Content -Path $Log -Value "`r`n> npm $argomenti  (in $dove)" -Encoding UTF8
  $uscita = Join-Path $env:TEMP "fairnight-npm-uscita-$PID.tmp"
  $errori = Join-Path $env:TEMP "fairnight-npm-errori-$PID.tmp"
  $p = Start-Process -FilePath $npm -ArgumentList $argomenti -WorkingDirectory $dove -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $uscita -RedirectStandardError $errori
  foreach ($f in @($uscita, $errori)) {
    if (Test-Path $f) {
      Get-Content $f | Add-Content -Path $Log -Encoding UTF8
      Remove-Item -Force $f
    }
  }
  $Host.UI.RawUI.WindowTitle = 'Installa Fairnight' # npm cambia il titolo della finestra
  return $p.ExitCode
}

# Il motivo più probabile, in parole semplici, dagli errori che npm scrive nel registro.
function Motivo {
  if (-not (Test-Path $Log)) { return $null }
  $testo = Get-Content $Log -Raw
  if ($testo -match 'ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|network') { return $T.MotivoRete }
  if ($testo -match 'E404|404 Not Found') { return $T.MotivoNonUscito }
  if ($testo -match 'EPERM|EBUSY|EACCES') { return $T.MotivoInUso }
  if ($testo -match 'ENOSPC') { return $T.MotivoDisco }
  return $null
}

function NonRiuscito([string]$cosa) {
  $righe = @($T.NonRiuscito -f $cosa)
  $motivo = Motivo
  if ($motivo) { $righe += $motivo }
  $righe += @(
    ($T.NonSiRisolve1 -f $Email),
    ($T.NonSiRisolve2 -f $Cartella)
  )
  Fermati $righe $Cartella $T.LaCartella
}

Write-Host ''
Scrivi $T.Titolo 'Cyan'
Scrivi $T.Righe 'Cyan'
Scrivi $T.Internet

# 1. Node.js
$node = TrovaNode
if (-not $node) {
  Fermati @(
    $T.NodeManca,
    ($T.NodeApri -f $PaginaNode),
    $T.NodeScorri,
    $T.NodeInstalla,
    $T.NodeRilancia
  ) $PaginaNode
}
$versione = (& $node -p 'process.versions.node').Trim()
$architettura = (& $node -p 'process.arch').Trim()
$maggiore = [int]($versione.Split('.')[0])
if ($maggiore -lt $NodeMinimo) {
  Fermati @(
    ($T.NodeVecchio -f $versione, $NodeMinimo),
    ($T.NodeApri -f $PaginaNode),
    $T.NodeVecchioScorri,
    $T.NodeRilancia
  ) $PaginaNode
}
if ($architettura -ne 'x64') {
  Fermati @(
    ($T.NodeArchitettura -f $architettura),
    ($T.NodeApri -f $PaginaNode),
    $T.NodeArchScorri,
    $T.NodeArchInstalla,
    $T.NodeRilancia
  ) $PaginaNode
}
$npm = Join-Path (Split-Path $node) 'npm.cmd'
if (-not (Test-Path $npm)) {
  Fermati @(
    ($T.NpmManca -f $node),
    ($T.NpmReinstalla -f $PaginaNode)
  ) $PaginaNode
}
$env:Path = "$(Split-Path $node);$env:Path"
Fatto "Node.js $versione"

# 2. Il programma
New-Item -ItemType Directory -Force -Path $Programma | Out-Null
Set-Content -Path $Log -Value "Installazione di Fairnight, $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), Node.js $versione $architettura, lingua $Lingua" -Encoding UTF8
$aggiornamento = Test-Path (Join-Path $Programma 'node_modules\fairnight-cli')
$versionePrima = $null
if ($aggiornamento) {
  try { $versionePrima = (Get-Content (Join-Path $Programma 'node_modules\fairnight-cli\package.json') -Raw | ConvertFrom-Json).version } catch { $versionePrima = $null }
}
# Ogni volta un elenco nuovo: niente rimandi a pacchetti di installazioni precedenti.
Set-Content -Path (Join-Path $Programma 'package.json') -Encoding ASCII -Value '{ "name": "fairnight-installato", "private": true, "description": "Fairnight installato per questo utente: si aggiorna rilanciando Installa Fairnight" }'
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Programma 'package-lock.json')

if ($DalProgetto) {
  Scrivi ''
  Scrivi $T.Passo1
  if ($aggiornamento) { Scrivi $T.LentoAggiornamento }
  else { Scrivi $T.LentoPrimaVolta }
  if ((Esegui $Progetto 'ci --no-audit --no-fund') -ne 0) { NonRiuscito $T.CosaScaricare }
  Scrivi $T.Passo2
  if ((Esegui $Progetto 'run build') -ne 0) { NonRiuscito $T.CosaPreparare }
  $cartellaPacchetti = Join-Path $Programma 'pacchetti'
  if (Test-Path $cartellaPacchetti) { Remove-Item -Recurse -Force $cartellaPacchetti }
  New-Item -ItemType Directory -Force -Path $cartellaPacchetti | Out-Null
  $spazi = ($Pacchetti | ForEach-Object { "-w $_" }) -join ' '
  if ((Esegui $Progetto "pack $spazi --pack-destination `"$cartellaPacchetti`"") -ne 0) { NonRiuscito $T.CosaImpacchettare }
  $daInstallare = (Get-ChildItem $cartellaPacchetti -Filter *.tgz | ForEach-Object { "`"$($_.FullName)`"" }) -join ' '
  Scrivi $T.Passo3
} else {
  $daInstallare = 'fairnight-cli@latest'
  Scrivi ''
  if ($aggiornamento) { Scrivi $T.NpmAggiornamento }
  else { Scrivi $T.NpmPrimaVolta }
}
if ((Esegui $Programma "install --omit=dev --no-audit --no-fund $daInstallare") -ne 0) { NonRiuscito $T.CosaInstallare }

$sqlite = Join-Path $Programma 'node_modules\better-sqlite3'
if (Test-Path (Join-Path $sqlite 'build\config.gypi')) {
  Add-Content -Path $Log -Value 'better-sqlite3: compilato sul posto (nessun binario precompilato usato)' -Encoding UTF8
} else {
  Add-Content -Path $Log -Value 'better-sqlite3: binario precompilato' -Encoding UTF8
}
$fairnight = Join-Path $Programma 'node_modules\fairnight-cli\bin\fairnight.js'
& $node $fairnight --help *> $null
if ($LASTEXITCODE -ne 0) { NonRiuscito $T.CosaAvviare }
$versioneFairnight = (Get-Content (Join-Path $Programma 'node_modules\fairnight-cli\package.json') -Raw | ConvertFrom-Json).version
if (-not $aggiornamento) { Fatto ($T.Installato -f $versioneFairnight) }
elseif ($versionePrima -and $versionePrima -ne $versioneFairnight) { Fatto ($T.Aggiornato -f $versionePrima, $versioneFairnight) }
else { Fatto ($T.Reinstallato -f $versioneFairnight) }
if ($aggiornamento) { Scrivi $T.ChiudiERiapri }

# 3. I file da doppio clic e le icone
$avvio = @'
@echo off
title Fairnight
set "NODE=node"
where node >nul 2>nul && goto avvia
set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE%" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
:avvia
"%NODE%" "%~dp0programma\node_modules\fairnight-cli\bin\fairnight.js" COMANDO --dir "%~dp0."
DOPO
'@
Set-Content -Path (Join-Path $Cartella 'Fairnight.cmd') -Encoding ASCII -Value $avvio.Replace('COMANDO', 'apri').Replace('DOPO', 'if errorlevel 1 pause')
Set-Content -Path (Join-Path $Cartella 'Cambia impostazioni.cmd') -Encoding ASCII -Value $avvio.Replace('COMANDO', 'configura').Replace('DOPO', 'pause')
$icona = Join-Path $Programma 'fairnight.ico'
Copy-Item -Force (Join-Path $PSScriptRoot 'fairnight.ico') $icona

if (-not $SenzaCollegamenti) {
  $shell = New-Object -ComObject WScript.Shell
  foreach ($dove in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
    $link = $shell.CreateShortcut((Join-Path $dove 'Fairnight.lnk'))
    $link.TargetPath = Join-Path $Cartella 'Fairnight.cmd'
    $link.WorkingDirectory = $Cartella
    $link.IconLocation = "$icona,0"
    $link.Description = $T.DescrizioneIcona
    $link.Save()
  }
  Fatto $T.Icone
}

# 4. Configurazione e calendario
$config = Join-Path $Cartella 'fairnight.config.json'
Scrivi ''
Scrivi ($T.DatiQui -f $Cartella) 'Cyan'
if (Test-Path $config) {
  Scrivi $T.ImpostazioniRestano
} elseif (-not $SenzaDomande) {
  Scrivi ''
  & $node $fairnight configura --dir $Cartella
  if ($LASTEXITCODE -ne 0) {
    Fermati @($T.ConfigurazioneFerma)
  }
}
if (-not (Test-Path $config)) {
  Scrivi $T.NonConfigurato
  exit 0
}
if ($NonAprire) { exit 0 }

Scrivi ''
Scrivi $T.Fatto 'Green'
Scrivi ''
$Host.UI.RawUI.WindowTitle = 'Fairnight'
& $node $fairnight apri --dir $Cartella
if ($LASTEXITCODE -ne 0 -and -not $SenzaDomande) { Read-Host $T.PremiChiudi | Out-Null }
