#!/bin/bash
# Makes the demo's voice: macOS `say` reads the sample letter, ffmpeg lays it 1.5 s into a mix,
# and the word timings are spread over the spoken length (fake timings, real enough to watch).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p public
TEXT="Dear Robin, this year you carried more than anyone saw. Thank you for every early morning and every late night. I am grateful for you, today and always. With love, Sam."
say -v Samantha -r 165 -o public/voice.aiff "$TEXT"
ffmpeg -loglevel error -y -f lavfi -t 1.5 -i anullsrc=r=22050:cl=mono -i public/voice.aiff -filter_complex "[0][1]concat=n=2:v=0:a=1" -c:a aac -b:a 96k public/card.m4a
DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 public/voice.aiff)
node -e '
const text = process.argv[1], dur = Number(process.argv[2]), lead = 1.5
const words = text.split(/\s+/)
const weight = words.map((w) => w.length + (/[,.]$/.test(w) ? 4 : 1))
const total = weight.reduce((a, b) => a + b, 0)
let t = lead
const out = words.map((w, i) => { const d = dur * weight[i] / total; const r = { w, s: +t.toFixed(2), e: +(t + d * 0.85).toFixed(2) }; t += d; return r })
for (const i of [1, 9, 19, 27]) out[i].br = 1
require("fs").writeFileSync("public/timings.json", JSON.stringify(out))
' "$TEXT" "$DUR"
echo "voice $(printf %.1f "$DUR")s -> public/card.m4a, public/timings.json"
# A soft chord for the recorder demo's music bed.
ffmpeg -loglevel error -y -f lavfi -i "sine=f=220:d=20" -f lavfi -i "sine=f=277:d=20" -f lavfi -i "sine=f=330:d=20" -filter_complex "amix=inputs=3,volume=0.6" -c:a libmp3lame -b:a 96k public/bed.mp3
echo "bed -> public/bed.mp3"
