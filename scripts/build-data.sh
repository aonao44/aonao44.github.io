#!/usr/bin/env bash
# imperia — 元データ取得 + mapshaper 簡略化
#
# aourednik/historical-basemaps (GPL-3.0) の world_*.geojson を取得し、
# mapshaper で簡略化して data/eras/<name>.geojson に書き出す。
# あわせて Natural Earth (public domain) 110m の国境線を data/modern-borders.geojson に取得する。
#
# 元データはリポジトリに含めない。生成物 (data/eras/*, data/modern-borders.geojson) のみコミットする。
#
# 使い方:
#   scripts/build-data.sh            # 全断面をビルド（既存はスキップ）
#   FORCE=1 scripts/build-data.sh    # 既存を無視して再ビルド
#   scripts/build-data.sh bc3000 100 # 指定断面だけビルド

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/data/eras"
BORDERS_OUT="$ROOT/data/modern-borders.geojson"

BASEMAPS_URL="https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson"
NE_URL="https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_boundary_lines_land.geojson"

# 目標 ~300KB / ハード上限 500KB (spec より)
TARGET_BYTES=$((300 * 1024))
MAX_BYTES=$((500 * 1024))

# 簡略化率の候補。1つ目で目標を超えたら順に強くしていく。
SIMPLIFY_STEPS=("10%" "6%" "4%" "2.5%" "1.5%")

# 断面一覧 (spec の採用断面)
ALL_ERAS=(
  bc3000 bc2000 bc1500 bc1000 bc700 bc500 bc400 bc323 bc300 bc200 bc100 bc1
  100 200 300 400 500 600 700 800 900 1000
  1100 1200 1279 1300 1400 1492 1500 1530 1600 1650
  1700 1715 1783 1800 1815 1880 1900 1914 1920 1930 1938 1945 1960 1994 2000 2010
)

if [ "$#" -gt 0 ]; then
  ERAS=("$@")
else
  ERAS=("${ALL_ERAS[@]}")
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/imperia-build.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$OUT_DIR"

MAPSHAPER=(npx -y mapshaper@0.7.55)

filesize() { wc -c < "$1" | tr -d ' '; }

build_era() {
  local era="$1"
  local dest="$OUT_DIR/$era.geojson"
  local src="$TMP_DIR/world_$era.geojson"

  if [ -f "$dest" ] && [ "${FORCE:-0}" != "1" ]; then
    echo "skip   $era ($(filesize "$dest") bytes, already built)"
    return 0
  fi

  echo "fetch  $era"
  curl -fsSL "$BASEMAPS_URL/world_$era.geojson" -o "$src"

  local best=""
  for pct in "${SIMPLIFY_STEPS[@]}"; do
    local cand="$TMP_DIR/out_$era.geojson"
    # 注意: -clean は -simplify の「前」に置くこと。
    # 後ろに置くと clean が元の arc から位相を作り直すため簡略化が丸ごと失われる
    # (era 1000 で 10%/1.5% どちらでも 526679B と同一サイズになる現象の原因)。
    "${MAPSHAPER[@]}" "$src" \
      -clean \
      -simplify "$pct" keep-shapes \
      -filter-fields NAME,SUBJECTO,BORDERPRECISION \
      -o force format=geojson precision=0.001 "$cand" >/dev/null 2>&1
    local size
    size="$(filesize "$cand")"
    best="$cand"
    if [ "$size" -le "$TARGET_BYTES" ]; then
      echo "build  $era  simplify=$pct  ${size}B"
      break
    fi
    echo "  retry $era  simplify=$pct  ${size}B > target"
  done

  local final_size
  final_size="$(filesize "$best")"
  if [ "$final_size" -gt "$MAX_BYTES" ]; then
    echo "ERROR: $era is ${final_size}B (> ${MAX_BYTES}B hard max)" >&2
    return 1
  fi
  mv "$best" "$dest"
  echo "ok     $era  ${final_size}B"
}

for era in "${ERAS[@]}"; do
  build_era "$era"
done

# 原典に混入した数値 SUBJECTO を、既知の feature だけに限定して補正する。
# skip 済みの生成物にも適用し、部分ビルドと全ビルドで結果を一致させる。
node "$ROOT/scripts/normalize-era-data.mjs" "${ERAS[@]}"

# geometry:null を索引へ混ぜない現行規則で、断面ナビゲーション用索引も同期する。
node "$ROOT/scripts/build-name-eras.mjs"

# --- Natural Earth 110m 国境線 ---
if [ ! -f "$BORDERS_OUT" ] || [ "${FORCE:-0}" = "1" ]; then
  echo "fetch  modern-borders (Natural Earth 110m admin-0 boundary lines)"
  curl -fsSL "$NE_URL" -o "$TMP_DIR/ne.geojson"
  "${MAPSHAPER[@]}" "$TMP_DIR/ne.geojson" \
    -o force format=geojson precision=0.001 "$BORDERS_OUT" >/dev/null 2>&1
  echo "ok     modern-borders  $(filesize "$BORDERS_OUT")B"
else
  echo "skip   modern-borders (already built)"
fi

# --- 検証 (spec: 全断面が生成され各 500KB 未満) ---
# 部分ビルド時は「未生成の他断面」で落とさないよう、対象を引数の断面に絞る。
if [ "$#" -gt 0 ]; then
  ALL_ERAS=("$@")
fi

echo
echo "--- verify ---"
fail=0
for era in "${ALL_ERAS[@]}"; do
  f="$OUT_DIR/$era.geojson"
  if [ ! -f "$f" ]; then
    echo "MISSING $era" >&2
    fail=1
    continue
  fi
  size="$(filesize "$f")"
  if [ "$size" -ge "$MAX_BYTES" ]; then
    echo "TOO BIG $era ${size}B" >&2
    fail=1
  fi
done
count="$(ls -1 "$OUT_DIR" | grep -c '\.geojson$' || true)"
total="$(du -sh "$OUT_DIR" | cut -f1)"
echo "eras: $count files, $total total"
[ "$fail" -eq 0 ] && echo "verify: OK" || { echo "verify: FAILED" >&2; exit 1; }
