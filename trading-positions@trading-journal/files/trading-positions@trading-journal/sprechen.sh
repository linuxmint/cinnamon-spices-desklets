#!/bin/sh
# Liest $1 vor ($2 = thorsten | jenny): Piper (natürliche Offline-Stimme) wenn eingerichtet, sonst spd-say.
# Piper liegt nicht im Desklet (160 MB); Einrichtung siehe ../install.sh --stimme.
PIPER_ORDNER="${PIPER_ORDNER:-$HOME/.local/share/piper}"
case "${2:-thorsten}" in
    jenny) STIMME="$PIPER_ORDNER/stimmen/en_GB-jenny_dioco-medium.onnx"; SPRACHE=en ;;
    *)     STIMME="$PIPER_ORDNER/stimmen/de_DE-thorsten-high.onnx";   SPRACHE=de ;;
esac
if [ -x "$PIPER_ORDNER/piper/piper" ] && [ -f "$STIMME" ]; then
    printf '%s\n' "$1" | "$PIPER_ORDNER/piper/piper" -m "$STIMME" --output_raw 2>/dev/null \
        | paplay --raw --rate=22050 --channels=1 --format=s16le
else
    spd-say -l "$SPRACHE" -- "$1"
fi
