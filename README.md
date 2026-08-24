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

下部の入力欄に年を打って Enter を押すと、その年に有効だった断面へ飛ぶ。
`117` / `-500` / `紀元前500` / `BC500` / `500BC` / `前500` を受け付ける。
断面は48しかないので、打った年ちょうどの断面が無いときは
その年以前で最も新しい断面へ寄せ、「→ 100年の断面を表示」と表示する。

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

## 地図を日本語にする

下地は **OpenFreeMap の positron**（ベクタタイル、キー不要）。ラスタタイルをやめた
理由は、ラスタは画像に地名が焼き込まれていて言語を変えられないから。ベクタなら
起動時に全 symbol レイヤーの `text-field` を差し替えられる:

```js
['coalesce', ['get', 'name:ja'], ['get', 'name:latin'], ['get', 'name']]
```

OpenMapTiles の地物は `name:ja` を持っているので、これで「Deutschland」が「ドイツ」
になる。持っていない地物はラテン文字表記→原語表記に落ちる。

**日本語のグリフ**は Map の `localIdeographFontFamily` でローカルフォントに描かせる。
下地が配るフォントスタック（Noto Sans Regular ほか）に CJK が含まれる保証がなく、
無いと豆腐（□）になるため。漢字・ひらがな・カタカナはグリフを取りに行かない。

版図の塗りは**下地のラベルより下**に差し込む（`addEraLayers(map, firstSymbolLayerId())`）。
上に載せると不透明度 0.55 の塗りが地名を覆って読めなくなる。

## ラベルの主従

このサイトの主役は歴史上の政体であって現代の地名ではない。下地のラベルを
黒・通常サイズのまま残すと、政体名と同じ重さで張り合ってしまい地図が読めない。

- 政体名: 太字 (Noto Sans Bold)、面積に応じて 12〜22px、その政体の濃い色、太い白縁
- 現代の地名: 9.5px（国名のみ 11px）、`#8a8a8a`、細い白縁
- 都市・町・村・水域名・道路名はズーム4未満では出さない。世界表示では国名だけが残る

## 地図上の政体名

政体名は `data/names.ja.json` を引いて地図に直接描く。クリックしなくても
「今のどこに何があったか」が読めるようにするため。文字サイズは版図の面積で変え、
非国家は小さめ・灰色にする。色は**その政体の塗りと同じ色相の濃い色**にしてあり、
黒で描かれる下地の現代地名と見分けられる。

ラベルは版図ポリゴンに直接張らず、**政体ごとに1点の Point ソース**に張る
(`src/labelpoint.js`)。ポリゴンに直接張ると MapLibre がタイルごとにラベルを置くため、
広い版図（北極圏の狩猟民など）が画面上で同じ名前を5回繰り返してしまう。
代表点は最大の多角形の重心、重心が図形の外に落ちる形（コの字・三日月）では
走査線で内側を取り直す。

> 元データには末尾に空白が付いた NAME (`"Pomeranian culture "`) が混ざっている。
> 対訳表のキーは trim 済みなので、`decorateEra` で NAME を trim して正規化している。

## この時代の世界（概説）

`data/overviews.json` に48断面ぶんの 200〜300字の叙述を持たせている。トピック一覧の
先頭、断面名の直下に出る。その年に「どの勢力が伸び、どこが傾き、地域どうしが
どうつながっていたか」を地域横断で書いてある。

## 政体の来歴

`data/polity-info.json` に主要293政体の `{summary_ja, period_ja, capital_ja?, name_ja?}`。
政体の詳細パネルで、名前と「現在の国」のあいだに出る。未登録の政体では
この欄が丸ごと省かれるだけで、従来どおりの表示になる。

`name_ja` は `names.ja.json` の訳を上書きする。断面の年代と矛盾する訳を直すための
逃げ道で、例えば `Manchu Empire`（1650〜1914年の断面に登場）は「後金」（1616〜1636年の
国号）ではなく「清」と表示する。

## 登場する断面へ飛ぶ

`scripts/build-name-eras.mjs` が `data/name-eras.json`（NAME → 登場する断面 ID の配列）を
生成する。政体の詳細パネルに「登場する断面: 紀元前1年〜200年（3断面）」と出し、
◀ 最初 / ◀ / ▶ / ▶ 最後 で断面を移動する。移動先にその政体が居れば選択と強調を
持ち越し、居なければトピック一覧に戻る。

```sh
node scripts/build-name-eras.mjs   # data/eras/*.geojson を作り直したら再実行する
```

> **表記揺れは統合していない。** 元データには `Bantu` / `Bantou`、
> `Saharan Pastoral Nomads` / `Saharan pastoral nomads`、
> `United States` / `United States of America` のような別表記が混在する。
> これらは別々の政体として索引されるので、「登場する断面」が実際の存続期間より
> 短く出ることがある。機械的に名寄せすると実際には別物の政体まで束ねてしまうため、
> あえて統合していない。

## 断面ごとのトピック

`data/topics.json` に、48断面それぞれ 4〜7 件の「その年代に世界で何が起きていたか」を
持たせている。ポリゴンを選んでいない間、右パネルの既定表示がこれになる。

各トピックは `{title_ja, body_ja, polity?, wiki_url}`。`polity` はその断面のデータに
**実在する NAME** でなければならず、テストが全断面ぶん検証する。`polity` 付きの
トピックをクリックすると、その版図を強調して地図が寄る。政体の詳細からは
「← トピック一覧」で戻れる。

地域の偏りを避けるため、東アジア・南アジア・中東・アフリカ・南北アメリカ・
ヨーロッパ・草原の遊牧民を横断するよう書いてある。年代の取り違えを防ぐテストとして、
本文が引用する西暦が断面の年から60年以上離れていたら失敗するようにしてある。

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
src/yearinput.js              年入力の解釈と断面への寄せ
data/eras/*.geojson           簡略化済み48断面（生成物）
data/modern-borders.geojson   Natural Earth 110m 国境線
data/names.ja.json            NAME → 日本語名（全2548件）
data/modern.json              NAME → 現在の国（面積上位216件）
data/nonstate.json            非国家判定の規則
data/events.json              主要な出来事110件
data/topics.json              断面ごとのトピック（48断面 × 4〜7件）
data/overviews.json           断面ごとの概説（48断面 × 200〜300字）
data/polity-info.json         政体の来歴（293件）
data/name-eras.json           NAME → 登場する断面（生成物）
src/nonstate.js               非国家判定
src/labelpoint.js             政体名ラベルの代表点計算
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
- **背景タイル**: [OpenFreeMap](https://openfreemap.org/) の positron スタイル（キー不要・無料）。
  ベクタタイルは [OpenMapTiles](https://openmaptiles.org/) スキーマ、データは
  [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors — ODbL。
- **地図ライブラリ**: [MapLibre GL JS](https://maplibre.org/) — BSD-3-Clause。

版図データが GPL-3.0 のため、本リポジトリのコードも **GPL-3.0-or-later** で公開する。
全文は [LICENSE](./LICENSE) を参照。
