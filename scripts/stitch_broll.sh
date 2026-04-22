#!/usr/bin/env bash
# Stitch B-roll clips around the existing Remotion-rendered demo video using ffmpeg.
# Output: docs/demo/demo-with-broll.mp4
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
BROLL="$ROOT/docs/demo/broll"
INNER="$ROOT/bakerysense-web/e2e-demo/video/out/demo-full.mp4"
OUT="$ROOT/docs/demo/demo-with-broll.mp4"
TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

# Captions — match script.md / storyboard.md owner lines
CAP1="Yesterday I threw out 40 croissants. I needed something that would just tell me how many to bake."
CAP7="At 5pm I take one photo. It counts what is left."
CAP9="By month two, the model knows my bakery better than I do."

W=1440
H=900

# We use drawtext with a boxed background for the caption. Font fallback is
# Helvetica on macOS; the system font matches what ffmpeg can see.
FONT="/System/Library/Fonts/Supplemental/Arial.ttf"
[ -f "$FONT" ] || FONT="/System/Library/Fonts/Helvetica.ttc"

# Normalize each B-roll to 1440x900 + caption overlay + silent audio track, same codec as the inner mp4.
normalize_with_caption() {
  local src="$1" cap="$2" dst="$3"
  local text_escaped
  text_escaped=$(printf '%s' "$cap" | sed "s/'/\\\\\\\\'/g" | sed 's/:/\\:/g')
  ffmpeg -y -i "$src" \
    -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
    -vf "scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,drawtext=fontfile='${FONT}':text='${text_escaped}':fontcolor=#fff8ee:fontsize=32:x=(w-text_w)/2:y=h-160:box=1:boxcolor=0x140F0ADB:boxborderw=22:line_spacing=8" \
    -map 0:v -map 1:a -shortest \
    -c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 \
    -c:a aac -b:a 128k \
    -r 30 \
    "$dst" 2>/dev/null
}

# Normalize the inner demo so it has an audio track (Remotion renders no audio).
normalize_inner() {
  ffmpeg -y -i "$INNER" \
    -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
    -map 0:v -map 1:a -shortest \
    -c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 \
    -c:a aac -b:a 128k \
    -vf "scale=${W}:${H}" \
    -r 30 \
    "$TMP/inner.mp4" 2>/dev/null
}

echo "Normalizing + captioning shot1..."
normalize_with_caption "$BROLL/shot1-cold-open.mp4"    "$CAP1" "$TMP/shot1.mp4"
echo "Normalizing + captioning shot7b..."
normalize_with_caption "$BROLL/shot7b-display-case.mp4" "$CAP7" "$TMP/shot7.mp4"
echo "Normalizing + captioning shot9..."
normalize_with_caption "$BROLL/shot9-close.mp4"        "$CAP9" "$TMP/shot9.mp4"
echo "Normalizing inner demo..."
normalize_inner

# Concat list (order: shot1 → inner → shot7b → shot9)
cat > "$TMP/list.txt" <<EOF
file '$TMP/shot1.mp4'
file '$TMP/inner.mp4'
file '$TMP/shot7.mp4'
file '$TMP/shot9.mp4'
EOF

echo "Concatenating..."
ffmpeg -y -f concat -safe 0 -i "$TMP/list.txt" -c copy "$OUT" 2>/dev/null

echo "Output: $OUT"
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 "$OUT"
