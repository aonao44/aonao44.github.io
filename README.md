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

表示の確認は Playwright で撮る（`output/`）。デスクトップ4断面
（bc3000 / 100 / 1492 / 2010）とモバイル1枚を撮り、次を自動で検査する:

- ポリゴンが1つ以上描画されている
- 非国家判定が実際に適用され、国家と非国家が両方存在する
- 出来事の点が描画されている
- ポリゴンをクリックするとパネルに名前が出る
- クリックしたポリゴンが強調される
- モバイルでシートが開き、タッチでスライダーが動く

```sh
python3 -m http.server 8765 &
node scripts/screenshot.mjs
```

## 非国家ポリゴンの扱い

元データは、実在の国家と「狩猟採集民」「牧畜遊牧民」「民族集団」「考古学的文化」を
同じ形で並べている。両者を同じ濃さで塗ると、地図が民族分布図に見えてしまい
「この年代にどんな国があったか」が読めなくなる。

そこで非国家は **消さずに薄く**（塗り 15%・輪郭も細く）描く。判定規則は
`data/nonstate.json`、実装は `src/nonstate.js`。

**なぜ名前で判定するのか。** 元データには `type` 属性が一応あるが、7断面
3844 feature を数えたところ値が入っているのは 138 件、非 null は 16 件しかなく、
分類には使えなかった。`SUBJECTO` / `PARTOF` は宗主関係であって国家性とは無関係。
残る手掛かりが `NAME` の語形しかない。

規則は3つの部分からなる:

- `patterns` — 小文字化した NAME に含まれれば非国家とみなす部分文字列
  (`hunter`, `gatherer`, `forag`, `nomad`, `pastoral`, `culture`, `tribe`,
  `peoples`, `farmer` など14種)。元データの誤字 (`fich`, `Pacifi`) も含む
- `exceptions` — パターンに引っかかるが実際は国家である NAME（現在は0件）
- `explicit` — パターンでは拾えない裸の民族名・考古学的文化名
  (`Bantu`, `Ainu`, `Guanches`, `Afanasevo`, `Yamnaya` など66件)

**迷ったら国家扱いにする。** 実在の帝国を薄く塗る誤りの方が、狩猟採集民を
濃く塗る誤りより重いため。この方針から、次は意図的に国家側に残してある:

- 「軍閥」(`Chinese Warlords`) — 事実上の国家であり文化集団ではない
- `Xiongnu` / `Mongols` / `Franks` / `Visigoths` — 国家・連合体を指しうる
- `Huns` / `Goths` — アッティラの帝国・西ゴート王国を指しうる
- `Indus valley civilization` — 考古学的文化ではあるが四大文明の一つであり、
  薄く塗ると世界史教材として誤解を招く

現在 2548 件中 160 件前後が非国家と判定される。規則を変えたら
`npm test` の `nonstate` 系テストが範囲(50件超・全体の25%未満)を検査する。

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
data/names.ja.json            NAME → 日本語名（全2548件）
data/modern.json              NAME → 現在の国（面積上位216件）
data/nonstate.json            非国家判定の規則
data/events.json              主要な出来事110件
src/nonstate.js               非国家判定
src/events.js                 断面に対応する出来事の選別
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
