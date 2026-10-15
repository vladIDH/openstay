#!/bin/bash
# Doppio clic qui per installare o aggiornare Fairnight su Mac.
QUI="$(dirname "$0")"
if [ ! -f "$QUI/installa/mac.sh" ]; then
  printf '\n%s\n' "Manca la cartella «installa» accanto a questo file: Fairnight va installato dalla cartella estratta dallo zip, intera."
  printf '%s\n' "  1. Fai doppio clic sul file .zip scaricato: accanto allo zip il Mac crea la cartella estratta."
  printf '%s\n\n' "  2. Dentro quella cartella, tasto destro su «Installa Fairnight (Mac)» e poi «Apri»."
  read -r -p "Premi Invio per chiudere " _
  exit 1
fi
exec /bin/bash "$QUI/installa/mac.sh" "$@"
