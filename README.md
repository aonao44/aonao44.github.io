# imperia

世界史の版図を現代地図に重ねて見るサイト。紀元前3000年から2010年までの48断面を
スライダーで切り替え、その年代の世界全体の政体を現代の国境・都市の上に重ねて表示する。

ビルドステップなし。素の HTML + ES modules + MapLibre GL JS（CDN）で動く静的サイト。

## 動かす

```sh
python3 -m http.server 8765   # または npm run serve
open http://localhost:8765/
```

`data/eras/*.geojson` はリポジトリに含まれているので、取得後すぐ動く。

`?era=<id>` で初期断面を指定できる（例: `?era=bc3000`, `?era=100`, `?era=2010`）。

## データを作り直す

```sh
npm run build:data              # 未生成の断面だけビルド
FORCE=1 npm run build:data      # 全断面を再ビルド
npm run build:data bc3000 100   # 指定断面だけ
```

`scripts/build-data.sh` が historical-basemaps から元データを取得し、`mapshaper` で
簡略化して `data/eras/` に書き出す。元データ（1〜2MB/断面）はリポジトリに含めない。

> **注意**: `-clean` は必ず `-simplify` の**前**に置くこと。後ろに置くと clean が元の arc から
> 位相を作り直すため簡略化が丸ごと失われる（era 1000 が簡略化率によらず 526KB になる）。

政体名の一覧が要るとき:

```sh
node scripts/extract-names.js            # 出現断面数の多い順
node scripts/extract-names.js --count    # ユニーク件数
node scripts/extract-names.js --missing  # names.ja.json に未登録のものだけ
```

## テスト

```sh
npm test    # node:test。eras / slider / layers / panel のロジック
```

表示の確認は Playwright でスクリーンショットを撮る（`output/`）。

## 構成

```
index.html
app.js                        エントリ。map 初期化・UI 結線
src/eras.js                   断面一覧・年ラベル・ロード + キャッシュ
src/layers.js                 版図/国境レイヤー・NAME ハッシュからの配色
src/panel.js                  右パネル
src/slider.js                 スライダー・自動再生
data/eras/*.geojson           簡略化済み48断面（生成物）
data/modern-borders.geojson   Natural Earth 110m 国境線
data/names.ja.json            NAME → 日本語名
data/modern.json              NAME → 現在の国
scripts/build-data.sh         元データ取得 + 簡略化
scripts/extract-names.js      NAME ユニーク抽出
```

## データ出典・ライセンス

- **版図データ**: [aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps)
  — GPL-3.0。`geojson/world_*.geojson` を簡略化して使用。
  作者の但し書きどおり、古代の境界は本質的に曖昧であり、本サイトの表示も
  「およその勢力範囲」以上のものではない。
- **現代国境**: [Natural Earth](https://www.naturalearthdata.com/) 110m admin-0
  boundary lines — パブリックドメイン（[nvkelso/natural-earth-vector](https://github.com/nvkelso/natural-earth-vector) 経由で取得）。
- **背景タイル**: [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors — ODbL。
- **地図ライブラリ**: [MapLibre GL JS](https://maplibre.org/) — BSD-3-Clause。

版図データが GPL-3.0 のため、本リポジトリのコードも **GPL-3.0-or-later** で公開する。
全文は [LICENSE](./LICENSE) を参照。
