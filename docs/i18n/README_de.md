# Argus Automation

<p align="center">
  <a href="../../README.md">English</a> | <a href="README_zh-CN.md">中文</a> | <a href="README_ja.md">日本語</a> | <a href="README_fr.md">Français</a> | **Deutsch**
</p>

<p align="center">
  <b>Modernste Desktop-Automatisierung fuer KI-Agenten.</b><br/>
  Funktioniert mit <b>Claude Code</b>, <b>Codex</b> und <b>OpenClaw</b>.
</p>

---

> **Argus** (Ἄργος Πανόπτης) — der hundertaeugige Riese der griechischen Mythologie, der allsehende Waechter, der niemals schlaeft. Wir haben dieses Projekt Argus genannt, weil es Ihren gesamten Desktop durch Screenshots erfasst und ihn mit chirurgischer Praezision steuert — genau wie der mythologische Waechter ueber alles wachte, was ihm anvertraut wurde.

Jeder andere Desktop-Automatisierungs-MCP baut seine Tool-Schemata, sein Sicherheitsmodell und seine Dispatch-Logik von Grund auf neu. Argus verwendet direkt **ueber 6.300 Zeilen** von Anthropics Chicago-MCP-Produktionscode wieder — denselben Code, der die integrierte macOS-Desktopsteuerung von Claude Code antreibt — und ersetzt lediglich die native Schicht durch Windows-Aequivalente. Dieselben 24 Tools, dasselbe 3-stufige Sicherheitsmodell, dieselbe Token-Optimierung.

## Zwei grundlegend verschiedene Designphilosophien

Jeder andere MCP verfolgt den **"Gib dem Modell einen Hammer"-Ansatz** — Screenshot + Klick + Tippen als atomare Tools bereitstellen und dann hoffen, dass das Modell den Rest herausfindet. Jeder Schritt ist: Screenshot → schauen → entscheiden → handeln → wiederholen.

Argus verfolgt einen grundlegend anderen Ansatz: **Desktop-Automatisierung als zustandsbehaftete, kontrollierte Sitzung modellieren** — mit mehrstufiger Sicherheit, Token-Budget und Batch-Ausfuehrung. Der Unterschied ist enorm.

### Vergleich 1: Tool-Design — Flache Primitive vs. Schichtenarchitektur

**CursorTouch (5.000 Stars) Tools:**
```
Click, Type, Scroll, Move, Shortcut, Screenshot, App, Shell...
```
Jedes Tool ist eine unabhaengige atomare Operation ohne Kontextbeziehung. Das Modell muss bei jedem einzelnen Schritt Screenshot → schauen → entscheiden → handeln.

**Argus' geschichtetes Tool-Design:**
```
Session-Schicht:     request_access, list_granted_applications
Vision-Schicht:      screenshot, zoom
Praezisions-Schicht: left_click, double_click, triple_click, right_click,
                     middle_click, left_mouse_down, left_mouse_up
Eingabe-Schicht:     type, key, hold_key
Effizienz-Schicht:   computer_batch (N Aktionen → 1 API-Aufruf)
Navigations-Schicht: open_application, switch_display
Statusabfrage-Schicht: cursor_position, read_clipboard, write_clipboard
Warte-Schicht:       wait
```

24 Top-Level-Tools + 16 Batch-Aktionstypen. Der Kern dieses geschichteten Designs: **Das Modell soll auf der richtigen Abstraktionsebene denken, anstatt jedes Mal bei den Pixeln anzufangen.**

### Vergleich 2: "APIs nutzen, wenn moeglich" — Das am meisten unterschaetzte Designprinzip

Dies ist der am meisten unterschaetzte Designaspekt. Andere MCPs zwingen das Modell, **alles per Vision wahrzunehmen**. Argus' Prinzip: Wenn eine Information ueber eine strukturierte API abrufbar ist, werden niemals Vision-Tokens dafuer verschwendet. Screenshots sind fuer Faelle reserviert, in denen visuelles Verstaendnis tatsaechlich erforderlich ist.

| Aufgabe | Andere MCPs | Argus | Ersparnis |
|---|---|---|---|
| **Vorhandene Apps ermitteln** | Screenshot → Modell liest Taskleiste | `listInstalledApps()` → strukturierte Daten | 1 Screenshot + 1 Vision-Inferenz |
| **Anwendung oeffnen** | Screenshot → Icon finden → klicken | `open_application("Excel")` → direkter API-Aufruf | 2-3 Screenshots + mehrere Klicks |
| **Fokussierte App ermitteln** | Screenshot → Modell liest Titelleiste | `getFrontmostApp()` → gibt bundleId zurueck | 1 Screenshot + Inferenz |
| **Cursorposition ermitteln** | Screenshot → Modell raet | `cursor_position` → exakte Koordinaten | 1 Screenshot |
| **Zwischenablage lesen** | Strg+V in Notepad → Screenshot → lesen | `read_clipboard` → gibt Text zurueck | Mehrere Aktionen + 2 Screenshots |
| **Monitor wechseln** | Screenshot → falscher Monitor → Versuch und Irrtum | `switch_display("Dell U2720Q")` | Versuch-und-Irrtum-Schleife |
| **Kleinen Text lesen** | Modell versucht komprimierten Screenshot zu entziffern | `zoom` → hochaufloesender Ausschnitt | Fehlklick-Kosten |

Jeder vermiedene Screenshot spart **ca. 1.500 Vision-Tokens** und **3-5 Sekunden** Latenz.

### Vergleich 3: `computer_batch` — Die einzige Batch-Ausfuehrungs-Engine

Diese Faehigkeit hat **kein Konkurrent**. So gross ist der Unterschied:

**Andere MCPs bei "Feld klicken → Text eingeben → Enter druecken":**
```
Aufruf 1: screenshot        → Modell empfaengt Bild → Inferenz → naechster Schritt
Aufruf 2: click(100, 200)   → Modell empfaengt OK   → Inferenz → naechster Schritt
Aufruf 3: type("hello")     → Modell empfaengt OK   → Inferenz → naechster Schritt
Aufruf 4: key("Return")     → Modell empfaengt OK   → Inferenz → naechster Schritt
Aufruf 5: screenshot        → Modell bestaetigt Ergebnis

= 5 API-Roundtrips × 3-8 Sekunden = 15-40 Sekunden
```

**Argus fuer dieselbe Aufgabe:**
```
Aufruf 1: screenshot
Aufruf 2: computer_batch([
  { action: "left_click", coordinate: [100, 200] },
  { action: "type", text: "hello" },
  { action: "key", text: "Return" },
  { action: "screenshot" }
])

= 2 API-Roundtrips = 6-16 Sekunden
```

**60 % weniger Latenz und Tokens.** Und jede Aktion innerhalb des Batches durchlaeuft weiterhin eine Frontmost-App-Sicherheitspruefung — keine blinde Ausfuehrung.

### Vergleich 4: Sicherheitsmodell — Produktionsreif vs. nicht vorhanden

| Sicherheitsdimension | CursorTouch (5k Stars) | MCPControl (306 Stars) | **Argus** |
|---|:---:|:---:|:---:|
| App-Berechtigungen | Nein | Nein | **3-stufig (read/click/full)** |
| Frontmost-App-Gate | Nein (kann jedes Fenster klicken) | Nein | **Pruefung vor jeder Aktion** |
| Blockierung gefaehrlicher Tasten | Nein | Nein | **Alt+F4, Win+L, Ctrl+Alt+Del** |
| Klickziel-Validierung | Nein | Nein | **9×9-Pixel-Veralterungsschutz** |
| Zwischenablage-Isolation | Nein | Nein | **Sichern/Wiederherstellen bei click-Stufe** |
| App-Sperrliste | Nein | Nein | **Browser→read-only, Terminals→click-only** |

CursorTouch's README sagt woertlich *"POTENTIALLY DANGEROUS"*. Argus' Sicherheitsmodell ist **fuer kommerzielle Produkte konzipiert** — Anthropics Cowork und Desktop-App verwenden dieselbe Architektur.

### Direktvergleich: Zusammenfassung

| Faehigkeit | **Argus** | CursorTouch<br/>(5k Stars) | MCPControl<br/>(306 Stars) | domdomegg<br/>(176 Stars) | sbroenne<br/>(24 Stars) |
|---|:---:|:---:|:---:|:---:|:---:|
| **Batch-Ausfuehrung** | **Ja** | Nein | Nein | Nein | Nein |
| **Token-Budget-Optimierung** | **Ja** | Nein | Nein | Nein | Nein |
| **3-stufige App-Berechtigungen** | **Ja** | Nein | Nein | Nein | Nein |
| **Frontmost-App-Gate** | **Ja** | Nein | Nein | Nein | Nein |
| **Blockierung gefaehrlicher Tasten** | **Ja** | Nein | Nein | Nein | Nein |
| **Strukturierte APIs** (Infos ohne Screenshot) | **Ja** | Teilweise | Teilweise | Nein | Ja |
| **Zoom** (hochaufloesender Detailausschnitt) | **Ja** | Nein | Nein | Nein | Nein |
| **Multi-Display-Wechsel** | **Ja** | Nein | Nein | Nein | Nein |
| **Gleiches Schema wie Claude Code Built-in** | **Ja** | Nein | Nein | Annaehernd | Nein |
| **Wiederverwendeter Anthropic-Upstream-Code** | **6.300+ Zeilen** | 0 | 0 | 0 | 0 |
| Anzahl Tools | 24 | 19 | 12 | 6 | 10 |
| Sprache | TypeScript | Python | TypeScript | TypeScript | C# |

---

## Schnellstart

### Voraussetzungen

- **Node.js** 18+
- **Windows 10/11**
- Visual Studio Build Tools (fuer robotjs)

### Installation

```bash
git clone https://github.com/storyweaver/argus-automation.git
cd argus-automation
npm install
npm run build
```

### Konfiguration in Claude Code

In die `.mcp.json` des Projekts eintragen:

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

Claude Code neu starten. Es erscheinen 24 neue Tools mit dem Praefix `mcp__argus__`.

### Testen

```bash
npm test          # 70 Tests (Unit + Integration)
npm run test:unit # Nur Unit-Tests
```

---

## Architektur

```
┌─────────────────────────────────────────────────────────────────────┐
│  Upstream-Schicht — 6.300+ Zeilen aus Anthropics Chicago MCP        │
│  (nur 1 Zeile geaendert)                                           │
│                                                                     │
│  toolCalls.ts (3.649 Zeilen) — Sicherheits-Gates + Tool-Dispatch    │
│  mcpServer.ts — Server-Factory + Session-Binding                    │
│  tools.ts — 24 Tool-Schema-Definitionen                             │
│  types.ts — Vollstaendiges Typsystem                                │
│  keyBlocklist.ts — Blockierung gefaehrlicher Tasten (win32-Branch)  │
│  pixelCompare.ts — 9×9-Pixel-Veralterungserkennung                 │
│  imageResize.ts — Token-Budget-Algorithmus                          │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ ComputerExecutor-Interface
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Windows-native Schicht — ca. 400 Zeilen, neuer Code                │
│                                                                     │
│  screen.ts — node-screenshots + sharp (DXGI-Capture, JPEG, Resize)  │
│  input.ts  — robotjs (SendInput Maus/Tastatur)                      │
│  window.ts — koffi + Win32 API (Fensterverwaltung)                  │
│  clipboard.ts — PowerShell Get/Set-Clipboard                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Tech-Stack

Jede Bibliothek ist das Windows-Aequivalent dessen, was die macOS-Version verwendet:

| Modul | macOS (Chicago MCP) | Windows (Argus) | Aufgabe |
|---|---|---|---|
| Screenshot | SCContentFilter | **node-screenshots** (DXGI) | Bildschirmaufnahme |
| Eingabe | enigo (Rust) | **robotjs** (SendInput) | Maus & Tastatur |
| Fensterverwaltung | Swift + NSWorkspace | **koffi** + Win32 API | Fenstersteuerung |
| Bildverarbeitung | Sharp | **Sharp** | JPEG-Komprimierung + Resize |
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

Dreistufige, anwendungsspezifische Berechtigungen — **der einzige MCP-Server mit diesem Niveau an Zugriffskontrolle**:

| Stufe | Screenshot | Klick | Tippen/Einfuegen |
|---|:---:|:---:|:---:|
| **read** (Browser, Trading) | Ja | Nein | Nein |
| **click** (Terminals, IDEs) | Ja | Nur Linksklick | Nein |
| **full** (alles andere) | Ja | Ja | Ja |

Zusaetzlich: Blockierung gefaehrlicher Tasten, Frontmost-App-Gate bei jeder Aktion, sitzungsbezogene Freigaben.

## Logs

Alle Tool-Aufrufe werden protokolliert unter:
```
%LOCALAPPDATA%\argus-automation\logs\mcp-YYYY-MM-DD.log
```

## Bekannte Einschraenkungen

- **CJK-Texteingabe**: `write_clipboard` + `key("ctrl+v")` fuer nicht-ASCII-Text verwenden
- **App-Erkennung**: Gibt derzeit nur laufende Anwendungen zurueck (Registry-Scan geplant)
- **Pixel-Validierung**: Deaktiviert unter Windows (asynchrones sharp kann synchrones Interface nicht bedienen)
- **hideBeforeAction**: Deaktiviert (Minimieren stoert WebView2-Kindprozesse)

## Lizenz

MIT

## Danksagungen

Basiert auf Anthropics Chicago-MCP-Architektur, extrahiert aus Claude Code v2.1.88. Der Upstream-Code in `src/upstream/` stammt von Anthropic; die Windows-native Schicht und der Integrationscode sind eigenstaendig entwickelt.
