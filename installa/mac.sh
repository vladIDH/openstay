#!/bin/bash
# Installa (o aggiorna) Fairnight su Mac.
#
# Si lancia con un doppio clic su "Installa Fairnight (Mac).command". Cosa fa:
# 1. controlla che ci sia Node.js 22 o più recente; se manca spiega come installarlo
#    (non scarica niente da solo);
# 2. installa Fairnight nella cartella Fairnight dell'utente (~/Fairnight/programma):
#    dalla copia del progetto, se questo file sta dentro il progetto, altrimenti da npm;
# 3. crea l'app Fairnight in ~/Applicazioni (Applications) con un collegamento sulla Scrivania;
# 4. la prima volta fa partire la configurazione guidata, poi apre il calendario.
# I dati (impostazioni e calendari) stanno solo in quella cartella. Rilanciarlo aggiorna
# il programma e non tocca i dati.
#
# Opzioni per le prove: --cartella=PERCORSO --senza-domande --non-aprire --senza-collegamenti
set -u

CARTELLA="$HOME/Fairnight"
SENZA_DOMANDE=0
NON_APRIRE=0
SENZA_COLLEGAMENTI=0
for a in "$@"; do
  case "$a" in
    --cartella=*) CARTELLA="${a#--cartella=}" ;;
    --senza-domande) SENZA_DOMANDE=1 ;;
    --non-aprire) NON_APRIRE=1 ;;
    --senza-collegamenti) SENZA_COLLEGAMENTI=1 ;;
  esac
done

NODE_MINIMO=22
# La pagina è in inglese (anche /it porta lì). Pulsante verificato il 15 ottobre 2026: «macOS Installer (.pkg)».
PAGINA_NODE="https://nodejs.org/en/download"
EMAIL="hello@khlumen.com"
PACCHETTI="fairnight fairguest fairhello fairnight-smoobu fairnight-beds24 fairnight-market fairnight-cli"
QUI="$(cd "$(dirname "$0")" && pwd)"
PROGETTO="$(dirname "$QUI")"
PROGRAMMA="$CARTELLA/programma"
LOG="$CARTELLA/installazione.log"
# Node.js dall'installer ufficiale sta in /usr/local/bin, quello di Homebrew in /opt/homebrew/bin:
# una finestra aperta da Finder non sempre li ha nel PATH. In fondo, così vince il Node che l'host
# usa già: i file da doppio clic lo cercano nello stesso ordine e trovano lo stesso.
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

scrivi() { printf '%s\n' "$1"; }
titolo() { printf '\033[36m%s\033[0m\n' "$1"; }
fatto() { printf '\033[32m  OK  %s\033[0m\n' "$1"; }

# fermati PAGINA_O_FILE_DA_APRIRE RIGA...  (un file viene mostrato nel Finder)
fermati() {
  local apri="$1"
  shift
  printf '\n'
  for r in "$@"; do printf '\033[33m%s\033[0m\n' "$r"; done
  printf '\n'
  if [ "$SENZA_DOMANDE" = 0 ]; then
    if [ -f "$apri" ]; then
      read -r -p "Premi Invio per vedere il file nel Finder (oppure chiudi questa finestra) " _
      open -R "$apri"
    elif [ -n "$apri" ]; then
      read -r -p "Premi Invio per aprire la pagina nel browser (oppure chiudi questa finestra) " _
      open "$apri"
    else
      read -r -p "Premi Invio per chiudere " _
    fi
  fi
  exit 1
}

# Esegue npm nella cartella data e mette tutto quello che stampa nel registro dell'installazione.
esegui() {
  local dove="$1"
  shift
  printf '\n> npm %s  (in %s)\n' "$*" "$dove" >> "$LOG"
  (cd "$dove" && "$NPM" "$@") >> "$LOG" 2>&1
}

# Il motivo più probabile, in parole semplici, dagli errori che npm scrive nel registro.
motivo() {
  if grep -Eq 'ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|network' "$LOG"; then
    echo "Sembra che manchi la connessione a internet. Controlla il Wi-Fi o il cavo, poi rilancia."
  elif grep -Eq 'E404|404 Not Found' "$LOG"; then
    echo "Fairnight non si trova ancora su internet: forse non è ancora uscito. Riprova tra qualche giorno."
  elif grep -Eq 'EPERM|EBUSY|EACCES' "$LOG"; then
    echo "Un file di Fairnight è in uso o protetto: chiudi la finestra di Fairnight se è aperta, poi rilancia."
  elif grep -q 'ENOSPC' "$LOG"; then
    echo "Il disco è pieno: libera un po' di spazio, poi rilancia."
  fi
}

non_riuscito() {
  local m
  m="$(motivo)"
  set -- "Non sono riuscito a $1. I tuoi dati non sono stati toccati."
  [ -n "$m" ] && set -- "$@" "$m"
  fermati "$LOG" "$@" \
    "Se non si risolve, scrivici a $EMAIL e allega il file installazione.log," \
    "che trovi nella cartella $CARTELLA: lo guardiamo noi."
}

printf '\n'
titolo "Fairnight: i prezzi delle tue notti, calcolati sul tuo computer"
titolo "---------------------------------------------------------------"
scrivi "Serve la connessione a internet: Fairnight scarica i suoi componenti."

# 1. Node.js
# Per le prove: FAIRNIGHT_NODE dice quale node usare (un percorso che non esiste = Node mancante).
if [ -n "${FAIRNIGHT_NODE:-}" ]; then
  NODE=""
  [ -x "$FAIRNIGHT_NODE" ] && NODE="$FAIRNIGHT_NODE"
else
  NODE="$(command -v node || true)"
fi
if [ -z "$NODE" ]; then
  fermati "$PAGINA_NODE" \
    "Per far funzionare Fairnight serve Node.js, un programma gratuito (versione 22 o più recente)." \
    "  1. Apri la pagina ufficiale (è in inglese): $PAGINA_NODE" \
    "  2. Scorri oltre il riquadro con i comandi e clicca il pulsante verde «macOS Installer (.pkg)»." \
    "     Apri il file scaricato e installalo lasciando le opzioni come sono." \
    "  3. Poi fai di nuovo doppio clic su «Installa Fairnight (Mac)»."
fi
VERSIONE="$("$NODE" -p 'process.versions.node')"
ARCHITETTURA="$("$NODE" -p 'process.arch')"
MAGGIORE="${VERSIONE%%.*}"
if [ "$MAGGIORE" -lt "$NODE_MINIMO" ]; then
  fermati "$PAGINA_NODE" \
    "Sul Mac c'è Node.js $VERSIONE, ma Fairnight ha bisogno della versione $NODE_MINIMO o più recente." \
    "  1. Apri la pagina ufficiale (è in inglese): $PAGINA_NODE" \
    "  2. Scorri oltre il riquadro con i comandi e clicca il pulsante verde «macOS Installer (.pkg)». Installalo: prende il posto di quella vecchia." \
    "  3. Poi fai di nuovo doppio clic su «Installa Fairnight (Mac)»."
fi
NPM="$(dirname "$NODE")/npm"
if [ ! -x "$NPM" ]; then
  fermati "$PAGINA_NODE" \
    "Ho trovato Node.js ($NODE) ma non npm, che di solito arriva insieme." \
    "Reinstalla Node.js dalla pagina ufficiale ($PAGINA_NODE), poi rilancia «Installa Fairnight (Mac)»."
fi
PATH="$(dirname "$NODE"):$PATH" # gli script di npm usano lo stesso Node
fatto "Node.js $VERSIONE"

# 2. Il programma
mkdir -p "$PROGRAMMA"
printf 'Installazione di Fairnight, %s, Node.js %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$VERSIONE" "$ARCHITETTURA" > "$LOG"
AGGIORNAMENTO=0
VERSIONE_PRIMA=""
if [ -d "$PROGRAMMA/node_modules/fairnight-cli" ]; then
  AGGIORNAMENTO=1
  VERSIONE_PRIMA="$("$NODE" -p 'require(process.argv[1]).version' "$PROGRAMMA/node_modules/fairnight-cli/package.json" 2> /dev/null || true)"
fi
# Ogni volta un elenco nuovo: niente rimandi a pacchetti di installazioni precedenti.
printf '%s\n' '{ "name": "fairnight-installato", "private": true, "description": "Fairnight installato per questo utente: si aggiorna rilanciando Installa Fairnight" }' > "$PROGRAMMA/package.json"
rm -f "$PROGRAMMA/package-lock.json"

if [ -f "$PROGETTO/packages/fairnight-cli/package.json" ]; then
  scrivi ""
  scrivi "Passo 1 di 3: scarico i componenti di Fairnight."
  if [ "$AGGIORNAMENTO" = 1 ]; then
    scrivi "  La finestra può sembrare ferma per un minuto o due: è normale, lasciala aperta."
  else
    scrivi "  La prima volta ci vogliono 2-4 minuti e la finestra sembra ferma: è normale, lasciala aperta."
  fi
  esegui "$PROGETTO" ci --no-audit --no-fund || non_riuscito "scaricare i componenti di Fairnight"
  scrivi "Passo 2 di 3: preparo Fairnight..."
  esegui "$PROGETTO" run build || non_riuscito "preparare Fairnight"
  rm -rf "$PROGRAMMA/pacchetti"
  mkdir -p "$PROGRAMMA/pacchetti"
  SPAZI=()
  for p in $PACCHETTI; do SPAZI+=(-w "$p"); done
  esegui "$PROGETTO" pack "${SPAZI[@]}" --pack-destination "$PROGRAMMA/pacchetti" || non_riuscito "impacchettare Fairnight"
  DA_INSTALLARE=("$PROGRAMMA/pacchetti/"*.tgz)
  scrivi "Passo 3 di 3: installo Fairnight nella tua cartella..."
else
  DA_INSTALLARE=(fairnight-cli@latest)
  scrivi ""
  if [ "$AGGIORNAMENTO" = 1 ]; then
    scrivi "Scarico e installo Fairnight: la finestra può sembrare ferma per un minuto. È normale, lasciala aperta."
  else
    scrivi "Scarico e installo Fairnight: 1-2 minuti, e la finestra sembra ferma. È normale, lasciala aperta."
  fi
fi
esegui "$PROGRAMMA" install --omit=dev --no-audit --no-fund "${DA_INSTALLARE[@]}" || non_riuscito "installare Fairnight"

if [ -f "$PROGRAMMA/node_modules/better-sqlite3/build/config.gypi" ]; then
  echo "better-sqlite3: compilato sul posto (nessun binario precompilato usato)" >> "$LOG"
else
  echo "better-sqlite3: binario precompilato" >> "$LOG"
fi
FAIRNIGHT="$PROGRAMMA/node_modules/fairnight-cli/bin/fairnight.js"
"$NODE" "$FAIRNIGHT" --help > /dev/null 2>&1 || non_riuscito "avviare Fairnight dopo averlo installato"
VERSIONE_FAIRNIGHT="$("$NODE" -p 'require(process.argv[1]).version' "$PROGRAMMA/node_modules/fairnight-cli/package.json")"
if [ "$AGGIORNAMENTO" = 0 ]; then
  fatto "Fairnight $VERSIONE_FAIRNIGHT installato"
elif [ -n "$VERSIONE_PRIMA" ] && [ "$VERSIONE_PRIMA" != "$VERSIONE_FAIRNIGHT" ]; then
  fatto "Fairnight aggiornato dalla versione $VERSIONE_PRIMA alla $VERSIONE_FAIRNIGHT"
else
  fatto "Fairnight $VERSIONE_FAIRNIGHT reinstallato (era già l'ultima versione)"
fi
if [ "$AGGIORNAMENTO" = 1 ]; then
  scrivi "  Se Fairnight era aperto, chiudi la sua finestra e riaprilo dall'icona: così usa la versione appena installata."
fi

# 3. I file da doppio clic e l'app
avvio() {
  cat > "$CARTELLA/$1" <<EOF
#!/bin/bash
# $2
export PATH="\$PATH:/usr/local/bin:/opt/homebrew/bin"
cd "\$(dirname "\$0")"
node "programma/node_modules/fairnight-cli/bin/fairnight.js" $3 --dir .
$4
EOF
  chmod +x "$CARTELLA/$1"
}
avvio "Fairnight.command" "Apre il calendario di Fairnight: chiudi questa finestra per spegnerlo." apri '[ $? -ne 0 ] && read -r -p "Premi Invio per chiudere " _'
avvio "Cambia impostazioni.command" "Cambia le case, i link e i prezzi di Fairnight." configura 'read -r -p "Premi Invio per chiudere " _'
cp "$QUI/fairnight.png" "$PROGRAMMA/fairnight.png"

if [ "$SENZA_COLLEGAMENTI" = 0 ]; then
  APP="$HOME/Applications/Fairnight.app"
  mkdir -p "$HOME/Applications"
  rm -rf "$APP"
  COMANDO="$CARTELLA/Fairnight.command"
  # Una piccola app che apre Fairnight.command nel Terminale: niente permessi speciali da chiedere.
  osacompile -o "$APP" -e "do shell script \"open \" & quoted form of \"$COMANDO\"" >> "$LOG" 2>&1
  ICONE="$(mktemp -d)/fairnight.iconset"
  mkdir -p "$ICONE"
  for s in 16 32 128 256 512; do
    sips -z "$s" "$s" "$PROGRAMMA/fairnight.png" --out "$ICONE/icon_${s}x${s}.png" > /dev/null 2>&1
    d=$((s * 2))
    sips -z "$d" "$d" "$PROGRAMMA/fairnight.png" --out "$ICONE/icon_${s}x${s}@2x.png" > /dev/null 2>&1
  done
  iconutil -c icns "$ICONE" -o "$APP/Contents/Resources/applet.icns" >> "$LOG" 2>&1
  # L'icona cambiata rompe la firma locale che osacompile mette all'app: la rifacciamo.
  codesign --force --deep --sign - "$APP" >> "$LOG" 2>&1
  touch "$APP"
  mkdir -p "$HOME/Desktop"
  ln -sfn "$APP" "$HOME/Desktop/Fairnight.app"
  fatto "App Fairnight in Applicazioni e sulla Scrivania"
fi

# 4. Configurazione e calendario
CONFIG="$CARTELLA/fairnight.config.json"
scrivi ""
titolo "I tuoi dati restano solo su questo Mac, nella cartella $CARTELLA"
if [ -f "$CONFIG" ]; then
  scrivi "Le tue impostazioni restano come sono. Per cambiarle: doppio clic su «Cambia impostazioni» nella cartella Fairnight."
elif [ "$SENZA_DOMANDE" = 0 ]; then
  scrivi ""
  "$NODE" "$FAIRNIGHT" configura --dir "$CARTELLA" ||
    fermati "" "La configurazione non è finita. Quando vuoi, riprendila con un doppio clic su «Cambia impostazioni» nella cartella Fairnight."
fi
if [ ! -f "$CONFIG" ]; then
  scrivi "Fairnight è installato, ma la configurazione non è stata fatta: riprendila con un doppio clic su «Cambia impostazioni» nella cartella Fairnight."
  exit 0
fi
if [ "$NON_APRIRE" = 1 ]; then exit 0; fi

scrivi ""
printf '\033[32m%s\033[0m\n' "Fatto! Da adesso apri Fairnight con l'icona Fairnight sulla Scrivania."
scrivi ""
"$NODE" "$FAIRNIGHT" apri --dir "$CARTELLA"
