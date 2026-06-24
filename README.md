# ハレタス - 納品ドキュメント

タスクを完了するほど空が晴れていくPWAタスク管理アプリ

---

## ファイル一覧

```
/
├── index.html          メイン画面（全UIの入口）
├── style.css           スタイルシート
├── app.js              アプリロジック（IndexedDB / タスク管理 / 習慣管理 / 統計）
├── manifest.json       PWAマニフェスト
├── service-worker.js   オフラインキャッシュ・通知スケジューラ
├── README.md           本ドキュメント
└── assets/
    └── icons/
        ├── icon.svg    元SVGアイコン
        ├── icon-72.png
        ├── icon-96.png
        ├── icon-128.png
        ├── icon-144.png
        ├── icon-152.png
        ├── icon-192.png
        ├── icon-384.png
        └── icon-512.png
```

---

## Android Chrome での確認手順

### 1. ファイルをサーバーに配置

PWAはローカルファイル（file://）では動作しません。
以下のいずれかの方法でHTTPS配信してください。

**方法A：GitHub Pages（無料・推奨）**
1. GitHubに新しいリポジトリを作成
2. 全ファイルをpush
3. Settings → Pages → Source: main / root に設定
4. `https://ユーザー名.github.io/リポジトリ名/` でアクセス可能

**方法B：Netlify Drop（最速）**
1. https://app.netlify.com/drop を開く
2. haretasuフォルダをドラッグ＆ドロップ
3. 自動でHTTPS URLが発行される

**方法C：ローカル開発（テスト用）**
```bash
# Python 3
python3 -m http.server 8080
# → http://localhost:8080 でアクセス（Chromeはlocalhostはhttpsと同等扱い）
```

### 2. Android Chromeで動作確認

1. Android Chrome で配信URLにアクセス
2. タブ一覧から「今日のタスク」「やり残し」「明日以降」「毎日」の4タブを確認
3. タスクを追加してスワイプで完了→空が晴れていくことを確認
4. オフライン（機内モード）でも動作することを確認

---

## PWAインストール手順

### Android Chrome

1. HTTPS URLにアクセス
2. アドレスバー右側の「⋮（メニュー）」をタップ
3. 「ホーム画面に追加」をタップ
4. アプリ名「ハレタス」を確認して「追加」
5. ホーム画面にアイコンが表示される
6. アイコンからスタンドアロンアプリとして起動できる

### iOS Safari（参考）

1. Safari でURLにアクセス
2. 下部の「共有」ボタン（□↑）をタップ
3. 「ホーム画面に追加」をタップ
4. 「追加」で完了

---

## 通知機能の実現範囲と制限事項

### ✅ 実現できること

| 機能 | 内容 |
|------|------|
| 通知許可要求 | Web Notifications API で許可ダイアログを表示 |
| アプリ起動中の通知 | 設定時刻になったらService Worker経由で通知表示 |
| 通知タップでアプリ起動 | notificationclickイベントでウィンドウをフォーカス |
| 複数通知設定 | タスクごとに複数の「N分前」通知を設定可能 |
| 通知データ保存 | IndexedDBに通知情報を永続保存 |
| 逃した通知の補完表示 | アプリ再起動時に1時間以内の通知を遡って表示 |
| Periodic Background Sync | Android Chrome（条件付き）でバックグラウンド確認 |

### ❌ 実現できないこと（PWA単体の技術的限界）

| 機能 | 理由 | 代替案 |
|------|------|--------|
| **アプリを閉じた後の確実な定時通知** | Service WorkerはOSによっていつでも停止される。バックグラウンド常駐の保証がない | Push通知サーバー（Firebase Cloud Messaging等）を追加する |
| **iOSでのプッシュ通知** | iOS 16.3未満はWeb Push非対応。16.4以降も制限あり | ネイティブアプリ（Capacitor/Flutter等でラップ） |
| **通知のスヌーズ・繰り返し** | バックグラウンドタイマーの継続実行が保証されない | Androidアプリ化（WorkManagerで実装可能） |

### 実装上の補足

```
現在の通知フロー：
1. タスク登録時 → IndexedDBに通知レコード保存
2. Service Worker起動中 → 5分ごとにDBを確認
3. 時刻が来たら → showNotification()で通知表示
4. アプリ再起動時 → 逃した1時間以内の通知を補完表示

限界：
- アプリを一度も開いていない時間帯は通知が届かない可能性あり
- Periodic Background Sync（Chrome Android限定）で改善されるが保証はなし
```

### Push通知サーバーを追加する場合（将来拡張）

```
1. Firebase Cloud Messaging (FCM) を設定
2. service-worker.js の push イベントハンドラは実装済み
3. バックエンド（Node.js/Cloud Functions）でスケジュール管理
4. 完全なバックグラウンド通知が実現できる
```

---

## 将来拡張への備え

以下の機能は未実装ですが、データ構造・モジュール設計を考慮済みです。

- **タラ機能・レバ機能**：タスクに `type: 'tara'` | `'reba'` を追加するだけ
- **ポイント機能**：`stats`ストアにポイントフィールドを追加
- **植物育成**：`streak`データを流用してレベル計算
- **実績機能**：達成履歴は`stats`ストアに蓄積済み
- **目標管理**：新しいObjectStoreを追加するだけ
- **Androidアプリ化**：Capacitor.jsでラップするとWebViewアプリとして配布可能

---

## 技術スタック

- **フロントエンド**：Vanilla JS（フレームワーク不要）
- **ストレージ**：IndexedDB（オフライン対応）
- **PWA**：Service Worker + Web App Manifest
- **通知**：Web Notifications API + Service Worker
- **ビルドツール**：不要（index.htmlを開くだけで動作）
