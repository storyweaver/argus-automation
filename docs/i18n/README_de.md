# Windows Computer Use MCP

<p align="center">
  <a href="../../README.md">English</a> | <a href="README_zh-CN.md">中文</a> | <a href="README_ja.md">日本語</a> | <a href="README_fr.md">Français</a> | <b>Deutsch</b>
</p>

**Der einzige Windows-Desktop-Automatisierungs-MCP-Server, der auf Anthropics offizieller Chicago-MCP-Architektur basiert.**

Dieselben 24 Tools. Dasselbe 3-stufige Sicherheitsmodell. Dieselbe Token-Optimierung. Nur die native Schicht wurde fuer Windows ersetzt.

Jeder andere Desktop-Automatisierungs-MCP baut seine Tool-Schemata, sein Sicherheitsmodell und seine Dispatch-Logik von Grund auf neu. Dieses Projekt verwendet direkt **ueber 6.300 Zeilen** von Anthropics Produktionscode wieder -- denselben Code, der die integrierte macOS-Desktopsteuerung von Claude Code antreibt -- und ersetzt lediglich die native Schicht (Screenshot, Eingabe, Fensterverwaltung) durch Windows-Aequivalente.

---

## Warum diese Architektur anders ist

Die meisten Desktop-Automatisierungs-MCPs geben dem Modell ein paar primitive Tools (Screenshot, Klick, Tippen) und hoffen auf das Beste. **Chicago MCP** -- Anthropics interne Architektur fuer Desktopsteuerung -- verfolgt einen grundlegend anderen Ansatz: Desktop-Automatisierung wird als **zustandsbehaftete, kontrollierte Sitzung** mit mehrstufiger Sicherheit, Token-Budget und Batch-Ausfuehrung behandelt.

Wir haben diese Architektur auf Windows portiert. Das bedeutet in der Praxis:

### Architekturvergleich

```
┌─────────────────────────────────────────────────────────────────────┐
│              Andere MCP-Server                                      │
│                                                                     │
│   screenshot() ──→ Modell schaut ──→ click(x,y) ──→ Wiederholung   │
│                                                                     │
│   Keine Sicherheit. Kein Batching. Kein Token-Budget. Kein State.   │
│   Das Modell muss ALLES visuell parsen, jedes einzelne Mal.         │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│              Dieses Projekt (Chicago-MCP-Architektur)               │
│                                                                     │
│   ┌──── Session-Schicht ──────────────────────────────────────┐     │
│   │  request_access → 3-stufige Berechtigungen (read/click/full)│   │
│   │  Pro-App-Freigaben, Key-Blocklist, Frontmost-Gate           │   │
│   └─────────────────────────────────────────────────────────────┘   │
│   ┌──── Effizienz-Schicht ────────────────────────────────────┐     │
│   │  computer_batch: N Aktionen → 1 API-Aufruf                │     │
│   │  Strukturierte APIs: cursor_position, read_clipboard,      │     │
│   │    open_application — kein Screenshot noetig               │     │
│   │  targetImageSize: Binaere Suche auf ≤1568 Token-Budget     │     │
│   └────────────────────────────────────────────────────────────┘     │
│   ┌──── Vision-Schicht (nur wenn wirklich noetig) ────────────┐     │
│   │  screenshot → Modell sieht UI → click/type/scroll          │     │
│   │  zoom → hochaufloesender Ausschnitt fuer kleinen Text      │     │
│   └────────────────────────────────────────────────────────────┘     │
│   ┌──── Native Schicht (Windows) ─────────────────────────────┐     │
│   │  node-screenshots (DXGI) │ robotjs (SendInput)             │     │
│   │  koffi + Win32 API       │ sharp (JPEG/resize)             │     │
│   └────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

### Direktvergleich: Funktionsumfang

| Faehigkeit | **Dieses Projekt** | CursorTouch<br/>Windows-MCP<br/>(5k Stars) | MCPControl<br/>(306 Stars) | domdomegg<br/>computer-use-mcp<br/>(176 Stars) | sbroenne<br/>mcp-windows<br/>(24 Stars) |
|---|:---:|:---:|:---:|:---:|:---:|
| **Batch-Ausfuehrung** (N Aktionen, 1 API-Aufruf) | **Ja** | Nein | Nein | Nein | Nein |
| **Token-Budget-Optimierung** (binaere Suche, Resize auf ≤1568 Tokens) | **Ja** | Nein | Nein | Nein | Nein |
| **3-stufige App-Berechtigungen** (read / click / full) | **Ja** | Nein | Nein | Nein | Nein |
| **Frontmost-App-Gate** (blockiert bei falschem Fokusfenster) | **Ja** | Nein | Nein | Nein | Nein |
| **Blockierung gefaehrlicher Tasten** (Alt+F4, Win+L, Ctrl+Alt+Del) | **Ja** | Nein | Nein | Nein | Nein |
| **Strukturierte APIs** (Infos ohne Screenshots abrufen) | **Ja** | Teilweise | Teilweise | Nein | Ja |
| **Zoom** (hochaufloesender Ausschnitt fuer Details) | **Ja** | Nein | Nein | Nein | Nein |
| **Multi-Display** (Umschalten per Monitorname) | **Ja** | Nein | Nein | Nein | Nein |
| **Gleiches Tool-Schema wie Claude Code Built-in** | **Ja** | Nein | Nein | Naeherungsweise | Nein |
| **Wiederverwendeter Upstream-Code von Anthropic** | **6.300+ Zeilen** | 0 | 0 | 0 | 0 |
| Anzahl Tools | 24 | 19 | 12 | 6 | 10 |
| Sprache | TypeScript | Python | TypeScript | TypeScript | C# |

### Warum Batch-Ausfuehrung wichtig ist

Ohne `computer_batch` benoetigt eine Klick-Tippen-Enter-Sequenz **5 API-Roundtrips** (je 3-8 Sekunden). Mit Batching:

```javascript
// 5 Roundtrips → 2. 60% weniger Latenz und Tokens.
computer_batch([
  { action: "left_click", coordinate: [100, 200] },
  { action: "type", text: "hello world" },
  { action: "key", text: "Return" },
  { action: "screenshot" }
])
```

Kein anderer Windows-MCP-Server unterstuetzt das.

### Warum "APIs nutzen, wenn moeglich" wichtig ist

Andere MCPs zwingen das Modell, **alles per Screenshot visuell zu parsen**. Chicago MCP: Wenn eine Information per API verfuegbar ist, werden keine Vision-Tokens verschwendet.

| Aufgabe | Andere MCPs | Dieses Projekt |
|---|---|---|
| Welche App hat den Fokus? | Screenshot → Modell liest Titelleiste | `getFrontmostApp()` → strukturierte Daten |
| Wo ist der Cursor? | Screenshot → Modell raet | `cursor_position` → exakt `{x, y}` |
| Zwischenablage lesen | Strg+V in Notepad → Screenshot → lesen | `read_clipboard` → Textstring |
| Anwendung oeffnen | Screenshot → Icon finden → klicken | `open_application("Excel")` → API-Aufruf |
| Monitor wechseln | Screenshot → falscher Monitor → erneut versuchen | `switch_display("Dell U2720Q")` |

Jeder vermiedene Screenshot spart **ca. 1.500 Vision-Tokens** und **3-5 Sekunden**.

---

## Schnellstart

### Voraussetzungen

- **Node.js** 18+
- **Windows 10/11**
- Visual Studio Build Tools (fuer robotjs)

### Installation

```bash
git clone https://github.com/storyweaver/windows-computer-use-mcp.git
cd windows-computer-use-mcp
npm install
npm run build
```

### Konfiguration in Claude Code

In die `.mcp.json` des Projekts eintragen:

```json
{
  "mcpServers": {
    "windows-computer-use": {
      "command": "node",
      "args": ["C:/path/to/windows-computer-use-mcp/dist/index.js"]
    }
  }
}
```

Claude Code neu starten. Es erscheinen 24 neue Tools mit dem Praefix `mcp__windows-computer-use__`.

### Testen

```bash
npm test          # 70 Tests (Unit + Integration)
npm run test:unit # Nur Unit-Tests
```

---

## Projektstruktur

```
src/
├── upstream/              # 6.300+ Zeilen aus @ant/computer-use-mcp (1 Zeile geaendert)
│   ├── toolCalls.ts       # 3.649 Zeilen: Sicherheits-Gates + Tool-Dispatch
│   ├── tools.ts           # 24 Tool-Schema-Definitionen
│   ├── mcpServer.ts       # MCP-Server-Factory + Session-Binding
│   ├── types.ts           # Vollstaendiges Typsystem
│   ├── executor.ts        # ComputerExecutor-Interface (rekonstruiert)
│   ├── keyBlocklist.ts    # Blockierung gefaehrlicher Tasten (win32-Branch integriert)
│   ├── pixelCompare.ts    # 9×9-Pixel-Veralterungserkennung
│   ├── imageResize.ts     # Token-Budget-Algorithmus
│   └── ...                # deniedApps, sentinelApps, subGates
├── native/                # Windows-native Schicht (~400 Zeilen)
│   ├── screen.ts          # node-screenshots + sharp (DXGI-Capture)
│   ├── input.ts           # robotjs (SendInput Maus/Tastatur)
│   ├── window.ts          # koffi + Win32 API (Fensterverwaltung)
│   └── clipboard.ts       # PowerShell Get/Set-Clipboard
├── executor-windows.ts    # ComputerExecutor-Implementierung
├── host-adapter.ts        # HostAdapter-Zusammenbau
├── logger.ts              # Dateibasiertes Logging
└── index.ts               # stdio-MCP-Server-Einstiegspunkt
```

## Tech-Stack

Jede Bibliothek ist das Windows-Aequivalent dessen, was Chicago MCP unter macOS verwendet:

| Modul | macOS (Chicago MCP) | Windows (dieses Projekt) | Aufgabe |
|---|---|---|---|
| Screenshot | SCContentFilter | **node-screenshots** (DXGI) | Bildschirmaufnahme |
| Eingabe | enigo (Rust) | **robotjs** (SendInput) | Maus & Tastatur |
| Fensterverwaltung | Swift + NSWorkspace | **koffi** + Win32 API | Fenstersteuerung |
| Bildverarbeitung | Sharp | **Sharp** | JPEG-Komprimierung + Groessenaenderung |
| MCP-Framework | @modelcontextprotocol/sdk | **@modelcontextprotocol/sdk** | MCP-Protokoll |

## Die 24 Tools

| Kategorie | Tools |
|---|---|
| **Sitzung** | `request_access`, `list_granted_applications` |
| **Vision** | `screenshot`, `zoom` |
| **Mausklick** | `left_click`, `double_click`, `triple_click`, `right_click`, `middle_click` |
| **Maussteuerung** | `mouse_move`, `left_click_drag`, `left_mouse_down`, `left_mouse_up`, `cursor_position` |
| **Scrollen** | `scroll` |
| **Tastatur** | `type`, `key`, `hold_key` |
| **Zwischenablage** | `read_clipboard`, `write_clipboard` |
| **App/Display** | `open_application`, `switch_display` |
| **Batch + Warten** | `computer_batch`, `wait` |

## Sicherheitsmodell

Dreistufige, anwendungsspezifische Berechtigungen -- der einzige MCP-Server mit diesem Konzept:

| Stufe | Screenshot | Klick | Tippen/Einfuegen |
|---|:---:|:---:|:---:|
| **read** (Browser, Trading) | Ja | Nein | Nein |
| **click** (Terminals, IDEs) | Ja | Linksklick | Nein |
| **full** (alles andere) | Ja | Ja | Ja |

Zusaetzlich: Blockierung gefaehrlicher Tasten, Frontmost-App-Gate, sitzungsbezogene Freigaben.

## Logs

```
%LOCALAPPDATA%\windows-computer-use-mcp\logs\mcp-YYYY-MM-DD.log
```

## Bekannte Einschraenkungen

- **CJK-Texteingabe**: `write_clipboard` + `key("ctrl+v")` fuer nicht-ASCII-Text verwenden
- **App-Erkennung**: Gibt derzeit nur laufende Anwendungen zurueck (Registry-Scan geplant)
- **Pixel-Validierung**: Deaktiviert (asynchrones sharp kann synchrones Interface nicht bedienen)
- **hideBeforeAction**: Deaktiviert (Minimieren stoert WebView2-Kindprozesse)

## Lizenz

MIT

## Danksagungen

Basiert auf Anthropics `@ant/computer-use-mcp` (Chicago MCP), extrahiert aus Claude Code v2.1.88. Der Upstream-Code in `src/upstream/` stammt von Anthropic; die Windows-native Schicht ist eigenstaendig entwickelt.
