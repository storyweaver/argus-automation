# Argus Automation

<p align="center">
  <a href="../../README.md">English</a> | <a href="README_zh-CN.md">中文</a> | **日本語** | <a href="README_fr.md">Français</a> | <a href="README_de.md">Deutsch</a>
</p>

<p align="center">
  <b>AI エージェントのための最先端デスクトップ自動化。</b><br/>
  <b>Claude Code</b>、<b>Codex</b>、<b>OpenClaw</b> に対応。
</p>

---

> **Argus**（アルゴス・パノプテス / Ἄργος Πανόπτης）――ギリシャ神話に登場する百の目を持つ巨人にして、眠ることなくすべてを見通す番人。このプロジェクトに Argus と名付けたのは、スクリーンショットを通じてデスクトップ全体を見渡し、外科手術のような精度で操作するその姿が、かの神話の守護者と重なるからです。

他のデスクトップ自動化 MCP は、ツールスキーマ、セキュリティモデル、ディスパッチロジックをすべてゼロから構築しています。Argus は Anthropic のプロダクション Chicago MCP コード **6,300 行以上** をそのまま再利用しています。このコードは Claude Code に組み込まれた macOS デスクトップ制御と同一のものであり、ネイティブレイヤーのみを Windows 相当の実装に置き換えています。同じ 24 のツール。同じ 3 層セキュリティモデル。同じトークン最適化。

## 根本的に異なる二つの設計思想

他のすべての MCP は **「モデルにハンマーを渡す」** アプローチです。スクリーンショット + クリック + タイプをアトミックなツールとして提供し、あとはモデルが何とかしてくれることを期待します。毎回のステップが「スクリーンショット → 見る → 判断 → 操作 → 繰り返し」です。

Argus は根本的に異なるアプローチを取ります。デスクトップ自動化を、階層型セキュリティ、トークン予算管理、バッチ実行を備えた**ステートフルで制御されたセッション**としてモデル化します。その差は歴然です。

### 比較 1: ツール設計 ―― フラットなプリミティブ vs 階層型アーキテクチャ

**CursorTouch（5,000 stars）のツール:**
```
Click, Type, Scroll, Move, Shortcut, Screenshot, App, Shell...
```
各ツールはコンテキスト上の関連性を持たない独立したアトミック操作です。モデルは毎回「スクリーンショット → 見る → 判断 → 操作」を繰り返す必要があります。

**Argus の階層型ツール設計:**
```
Session Layer:     request_access, list_granted_applications
Vision Layer:      screenshot, zoom
Precision Layer:   left_click, double_click, triple_click, right_click,
                   middle_click, left_mouse_down, left_mouse_up
Input Layer:       type, key, hold_key
Efficiency Layer:  computer_batch (N actions → 1 API call)
Navigation Layer:  open_application, switch_display
State Query Layer: cursor_position, read_clipboard, write_clipboard
Wait Layer:        wait
```

24 のトップレベルツール + 16 のバッチアクションタイプ。この階層設計の本質は、**毎回ピクセルから始めるのではなく、モデルが適切な抽象レベルで思考できるようにすること**です。

### 比較 2: 「API で取れるなら API を使う」 ―― 最も過小評価されている設計原則

これは最も過小評価されている設計ポイントです。他の MCP はモデルに**すべてを視覚で認識させます**。Argus の原則: 構造化 API で情報を取得できるなら、Vision トークンを無駄遣いしない。スクリーンショットは、視覚的な理解が本当に必要な場面にのみ使います。

| タスク | 他の MCP | Argus | 節約できるもの |
|---|---|---|---|
| **どのアプリがあるか知る** | スクリーンショット → モデルがタスクバーを読む | `listInstalledApps()` → 構造化データ | スクリーンショット 1 回 + Vision 推論 1 回 |
| **アプリを開く** | スクリーンショット → アイコンを探す → クリック | `open_application("Excel")` → API 直接呼び出し | スクリーンショット 2-3 回 + 複数クリック |
| **フォーカス中のアプリを知る** | スクリーンショット → モデルがタイトルバーを読む | `getFrontmostApp()` → bundleId を返す | スクリーンショット 1 回 + 推論 |
| **カーソル位置を知る** | スクリーンショット → モデルが推測 | `cursor_position` → 正確な座標 | スクリーンショット 1 回 |
| **クリップボードを読む** | Ctrl+V でメモ帳に貼付 → スクリーンショット → 読み取り | `read_clipboard` → テキストを返す | 複数操作 + スクリーンショット 2 回 |
| **モニターを切り替える** | スクリーンショット → 違うモニター → 試行錯誤 | `switch_display("Dell U2720Q")` | 試行錯誤のループ |
| **小さい文字を読む** | モデルが圧縮されたスクリーンショットを必死に読む | `zoom` → 高解像度の領域クロップ | 誤クリックのコスト |

スクリーンショットを 1 回避けるだけで、約 **1,500 Vision トークン**と **3-5 秒**のレイテンシを節約できます。

### 比較 3: `computer_batch` ―― 唯一のバッチ実行エンジン

これは**他のどの競合にもない**機能です。その差がどれほど大きいか見てみましょう。

**他の MCP で「フィールドをクリック → テキストを入力 → Enter を押す」を実行する場合:**
```
Call 1: screenshot        → モデルが画像を受信 → 推論 → 次のステップ
Call 2: click(100, 200)   → モデルが OK を受信   → 推論 → 次のステップ
Call 3: type("hello")     → モデルが OK を受信   → 推論 → 次のステップ
Call 4: key("Return")     → モデルが OK を受信   → 推論 → 次のステップ
Call 5: screenshot        → モデルが結果を確認

= 5 API ラウンドトリップ × 3-8 秒 = 15-40 秒
```

**Argus で同じことを実行する場合:**
```
Call 1: screenshot
Call 2: computer_batch([
  { action: "left_click", coordinate: [100, 200] },
  { action: "type", text: "hello" },
  { action: "key", text: "Return" },
  { action: "screenshot" }
])

= 2 API ラウンドトリップ = 6-16 秒
```

**レイテンシとトークンを 60% 削減。** さらに、バッチ内のすべてのアクションに対してフォアグラウンドアプリのセキュリティチェックが実行されます。盲目的な実行ではありません。

### 比較 4: セキュリティモデル ―― プロダクショングレード vs 皆無

| セキュリティの次元 | CursorTouch (5k stars) | MCPControl (306 stars) | **Argus** |
|---|:---:|:---:|:---:|
| アプリレベルの権限 | なし | なし | **3 層 (read/click/full)** |
| フォアグラウンドアプリゲート | なし（どのウィンドウでもクリック可能） | なし | **すべてのアクション前にチェック** |
| 危険キーのブロック | なし | なし | **Alt+F4, Win+L, Ctrl+Alt+Del** |
| クリック対象の検証 | なし | なし | **9x9 ピクセルの陳腐化ガード** |
| クリップボードの分離 | なし | なし | **click 層アプリでの退避/復元** |
| アプリ拒否リスト | なし | なし | **ブラウザ→読み取り専用、ターミナル→クリックのみ** |

CursorTouch の README には文字通り *"POTENTIALLY DANGEROUS"* と書かれています。Argus のセキュリティモデルは**商用製品向けに設計されています**。Anthropic の Cowork やデスクトップアプリも同じアーキテクチャを使用しています。

### 総合比較

| 機能 | **Argus** | CursorTouch<br/>(5k stars) | MCPControl<br/>(306 stars) | domdomegg<br/>(176 stars) | sbroenne<br/>(24 stars) |
|---|:---:|:---:|:---:|:---:|:---:|
| **バッチ実行** | **対応** | 非対応 | 非対応 | 非対応 | 非対応 |
| **トークン予算最適化** | **対応** | 非対応 | 非対応 | 非対応 | 非対応 |
| **3 層アプリパーミッション** | **対応** | 非対応 | 非対応 | 非対応 | 非対応 |
| **フォアグラウンドアプリゲート** | **対応** | 非対応 | 非対応 | 非対応 | 非対応 |
| **危険キーブロック** | **対応** | 非対応 | 非対応 | 非対応 | 非対応 |
| **構造化 API**（スクリーンショット不要の情報取得） | **対応** | 一部対応 | 一部対応 | 非対応 | 対応 |
| **ズーム**（細部の高解像度クロップ） | **対応** | 非対応 | 非対応 | 非対応 | 非対応 |
| **マルチディスプレイ切り替え** | **対応** | 非対応 | 非対応 | 非対応 | 非対応 |
| **Claude Code 組み込みと同一スキーマ** | **対応** | 非対応 | 非対応 | 近い | 非対応 |
| **Anthropic 上流コードの再利用** | **6,300 行以上** | 0 | 0 | 0 | 0 |
| ツール数 | 24 | 19 | 12 | 6 | 10 |
| 言語 | TypeScript | Python | TypeScript | TypeScript | C# |

---

## クイックスタート

### 前提条件

- **Node.js** 18+
- **Windows 10/11**
- Visual Studio Build Tools（robotjs のビルドに必要）

### インストール

```bash
git clone https://github.com/storyweaver/argus-automation.git
cd argus-automation
npm install
npm run build
```

### Claude Code での設定

プロジェクトの `.mcp.json` に以下を追加してください:

```json
{
  "mcpServers": {
    "argus": {
      "command": "node",
      "args": ["C:/path/to/argus-automation/dist/index.js"]
    }
  }
}
```

Claude Code を再起動すると、`mcp__argus__` プレフィックス付きの 24 個の新しいツールが表示されます。

### テスト

```bash
npm test          # 70 テスト（ユニット + 結合）
npm run test:unit # ユニットテストのみ
```

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────────┐
│  Upstream Layer — Anthropic の Chicago MCP から 6,300 行以上          │
│  （変更は 1 行のみ）                                                  │
│                                                                     │
│  toolCalls.ts (3,649 行) — セキュリティゲート + ツールディスパッチ       │
│  mcpServer.ts — Server ファクトリ + セッションバインディング             │
│  tools.ts — 24 のツールスキーマ定義                                    │
│  types.ts — 完全な型システム                                          │
│  keyBlocklist.ts — 危険キーインターセプト（win32 ブランチ）              │
│  pixelCompare.ts — 9x9 陳腐化検出                                    │
│  imageResize.ts — トークン予算アルゴリズム                              │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ ComputerExecutor interface
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Windows Native Layer — 約 400 行、新規コード                         │
│                                                                     │
│  screen.ts — node-screenshots + sharp（DXGI キャプチャ、JPEG、リサイズ）│
│  input.ts  — robotjs（SendInput マウス/キーボード）                    │
│  window.ts — koffi + Win32 API（ウィンドウ管理）                       │
│  clipboard.ts — PowerShell Get/Set-Clipboard                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 技術スタック

各ライブラリは、macOS 版で使用されているものに対応する Windows 版です:

| モジュール | macOS (Chicago MCP) | Windows (Argus) | 役割 |
|---|---|---|---|
| Screenshot | SCContentFilter | **node-screenshots** (DXGI) | 画面キャプチャ |
| Input | enigo (Rust) | **robotjs** (SendInput) | マウス & キーボード |
| Window Mgmt | Swift + NSWorkspace | **koffi** + Win32 API | ウィンドウ制御 |
| Image Processing | Sharp | **Sharp** | JPEG 圧縮 + リサイズ |
| MCP Framework | @modelcontextprotocol/sdk | **@modelcontextprotocol/sdk** | MCP プロトコル |

## 24 のツール

| カテゴリ | ツール |
|---|---|
| **セッション** | `request_access`, `list_granted_applications` |
| **ビジョン** | `screenshot`, `zoom` |
| **マウスクリック** | `left_click`, `double_click`, `triple_click`, `right_click`, `middle_click` |
| **マウス制御** | `mouse_move`, `left_click_drag`, `left_mouse_down`, `left_mouse_up`, `cursor_position` |
| **スクロール** | `scroll` |
| **キーボード** | `type`, `key`, `hold_key` |
| **クリップボード** | `read_clipboard`, `write_clipboard` |
| **アプリ/ディスプレイ** | `open_application`, `switch_display` |
| **バッチ + 待機** | `computer_batch`, `wait` |

## セキュリティモデル

アプリごとの 3 層パーミッション ―― **このレベルのアクセス制御を備えた唯一の MCP サーバー**:

| 層 | スクリーンショット | クリック | 入力/貼り付け |
|---|:---:|:---:|:---:|
| **read**（ブラウザ、トレーディング） | 可 | 不可 | 不可 |
| **click**（ターミナル、IDE） | 可 | 左クリックのみ | 不可 |
| **full**（その他すべて） | 可 | 可 | 可 |

さらに: 危険キーブロック、すべてのアクションに対するフォアグラウンドアプリゲート、セッションスコープの許可。

## ログ

すべてのツール呼び出しは以下に記録されます:
```
%LOCALAPPDATA%\argus-automation\logs\mcp-YYYY-MM-DD.log
```

## 既知の制限事項

- **CJK テキスト入力**: 非 ASCII テキストには `write_clipboard` + `key("ctrl+v")` を使用してください
- **アプリ検出**: 現在は実行中のアプリのみ返します（レジストリスキャンは計画中）
- **ピクセル検証**: 無効化されています（非同期 sharp が同期インターフェースに対応できないため）
- **hideBeforeAction**: 無効化されています（最小化すると WebView2 子プロセスが壊れるため）

## ライセンス

MIT

## 謝辞

Anthropic の Chicago MCP アーキテクチャに基づいて構築されており、Claude Code v2.1.88 から抽出されています。`src/upstream/` 内のコードは Anthropic の成果物であり、Windows ネイティブレイヤーと統合コードはオリジナルです。
