# Argus Automation

<p align="center">
  <a href="../../README.md">English</a> | <a href="README_zh-CN.md">中文</a> | <a href="README_ja.md">日本語</a> | **Français** | <a href="README_de.md">Deutsch</a>
</p>

<p align="center">
  <b>Automatisation de bureau de pointe pour les agents IA.</b><br/>
  Compatible avec <b>Claude Code</b>, <b>Codex</b> et <b>OpenClaw</b>.
</p>

---

> **Argus** (Ἄργος Πανόπτης) — le géant aux cent yeux de la mythologie grecque, gardien omniscient qui ne dort jamais. Nous avons nommé ce projet Argus parce qu'il voit l'intégralité de votre bureau grâce aux captures d'écran et le contrôle avec une précision chirurgicale — tout comme le gardien mythologique veillait sur tout ce qui lui était confié.

Tous les autres MCP d'automatisation de bureau construisent leurs schémas d'outils, leur modèle de sécurité et leur logique de dispatch à partir de zéro. Argus réutilise directement **plus de 6 300 lignes** du code de production Chicago MCP d'Anthropic — le même code qui alimente le contrôle de bureau macOS intégré à Claude Code — et ne remplace que la couche native par des équivalents Windows. Mêmes 24 outils, même modèle de sécurité à 3 niveaux, même optimisation de tokens.

## Deux philosophies de conception fondamentalement différentes

Tous les autres MCP adoptent l'approche **« donner un marteau au modèle »** — fournir capture d'écran + clic + saisie comme outils atomiques, puis espérer que le modèle se débrouille. Chaque étape : capture d'écran → regarder → décider → agir → recommencer.

Argus adopte une approche fondamentalement différente : **modéliser l'automatisation de bureau comme une session à état gouvernée** — avec une sécurité multicouche, un budget de tokens et une exécution par lots. L'écart est considérable.

### Comparaison 1 : Conception des outils — Primitives plates vs Architecture en couches

**Outils de CursorTouch (5 000 stars) :**
```
Click, Type, Scroll, Move, Shortcut, Screenshot, App, Shell...
```
Chaque outil est une opération atomique indépendante sans relation contextuelle. Le modèle doit effectuer capture d'écran → regarder → décider → agir à chaque étape.

**Conception en couches des outils d'Argus :**
```
Couche Session :     request_access, list_granted_applications
Couche Vision :      screenshot, zoom
Couche Précision :   left_click, double_click, triple_click, right_click,
                     middle_click, left_mouse_down, left_mouse_up
Couche Saisie :      type, key, hold_key
Couche Efficacité :  computer_batch (N actions → 1 appel API)
Couche Navigation :  open_application, switch_display
Couche Requête :     cursor_position, read_clipboard, write_clipboard
Couche Attente :     wait
```

24 outils de premier niveau + 16 types d'actions par lots. L'essence de cette conception en couches : **permettre au modèle de raisonner au bon niveau d'abstraction, au lieu de repartir des pixels à chaque fois.**

### Comparaison 2 : « Utiliser les API quand c'est possible » — Le principe de conception le plus sous-estimé

C'est le point de conception le plus sous-estimé. Les autres MCP forcent le modèle à **tout percevoir par la vision**. Le principe d'Argus : si une information peut être obtenue via une API structurée, ne jamais gaspiller de tokens de vision. Les captures d'écran sont réservées aux cas où la compréhension visuelle est réellement nécessaire.

| Tâche | Autres MCP | Argus | Ce que vous économisez |
|---|---|---|---|
| **Connaître les apps installées** | Capture d'écran → le modèle lit la barre des tâches | `listInstalledApps()` → données structurées | 1 capture + 1 inférence vision |
| **Ouvrir une application** | Capture d'écran → trouver l'icône → cliquer | `open_application("Excel")` → appel API direct | 2-3 captures + plusieurs clics |
| **Savoir quelle app est au premier plan** | Capture d'écran → le modèle lit la barre de titre | `getFrontmostApp()` → retourne le bundleId | 1 capture + inférence |
| **Connaître la position du curseur** | Capture d'écran → le modèle devine | `cursor_position` → coordonnées exactes | 1 capture |
| **Lire le presse-papiers** | Ctrl+V dans Notepad → capture → lecture | `read_clipboard` → retourne le texte | Plusieurs actions + 2 captures |
| **Changer de moniteur** | Capture d'écran → mauvais → tâtonnements | `switch_display("Dell U2720Q")` | Boucle d'essais-erreurs |
| **Lire du texte fin** | Le modèle plisse les yeux sur une capture compressée | `zoom` → recadrage haute résolution | Coût des clics ratés |

Chaque capture d'écran évitée économise environ **1 500 tokens de vision** et **3 à 5 secondes** de latence.

### Comparaison 3 : `computer_batch` — Le seul moteur d'exécution par lots

C'est une capacité **qu'aucun concurrent ne possède**. Voici l'ampleur de l'écart :

**Les autres MCP pour « cliquer un champ → saisir du texte → appuyer sur Entrée » :**
```
Appel 1 : screenshot        → le modèle reçoit l'image → inférence → étape suivante
Appel 2 : click(100, 200)   → le modèle reçoit OK      → inférence → étape suivante
Appel 3 : type("hello")     → le modèle reçoit OK      → inférence → étape suivante
Appel 4 : key("Return")     → le modèle reçoit OK      → inférence → étape suivante
Appel 5 : screenshot        → le modèle confirme le résultat

= 5 allers-retours API × 3-8 secondes = 15-40 secondes
```

**Argus pour la même opération :**
```
Appel 1 : screenshot
Appel 2 : computer_batch([
  { action: "left_click", coordinate: [100, 200] },
  { action: "type", text: "hello" },
  { action: "key", text: "Return" },
  { action: "screenshot" }
])

= 2 allers-retours API = 6-16 secondes
```

**60 % de latence et de tokens en moins.** Et chaque action à l'intérieur du lot bénéficie toujours d'une vérification de sécurité sur l'app au premier plan — pas d'exécution aveugle.

### Comparaison 4 : Modèle de sécurité — Production vs Inexistant

| Dimension de sécurité | CursorTouch (5k stars) | MCPControl (306 stars) | **Argus** |
|---|:---:|:---:|:---:|
| Permissions par application | Non | Non | **3 niveaux (read/click/full)** |
| Verrou d'app au premier plan | Non (peut cliquer n'importe quelle fenêtre) | Non | **Vérifié avant chaque action** |
| Blocage des touches dangereuses | Non | Non | **Alt+F4, Win+L, Ctrl+Alt+Del** |
| Validation de la cible du clic | Non | Non | **Garde de péremption 9×9 pixels** |
| Isolation du presse-papiers | Non | Non | **Sauvegarde/restauration pour les apps en tier click** |
| Liste de refus d'apps | Non | Non | **Navigateurs→lecture seule, Terminaux→clic seul** |

Le README de CursorTouch indique littéralement *« POTENTIALLY DANGEROUS »*. Le modèle de sécurité d'Argus est **conçu pour les produits commerciaux** — Cowork d'Anthropic et l'application de bureau utilisent la même architecture.

### Résumé comparatif

| Capacité | **Argus** | CursorTouch<br/>(5k stars) | MCPControl<br/>(306 stars) | domdomegg<br/>(176 stars) | sbroenne<br/>(24 stars) |
|---|:---:|:---:|:---:|:---:|:---:|
| **Exécution par lots** | **Oui** | Non | Non | Non | Non |
| **Optimisation du budget tokens** | **Oui** | Non | Non | Non | Non |
| **Permissions par app à 3 niveaux** | **Oui** | Non | Non | Non | Non |
| **Verrou d'app au premier plan** | **Oui** | Non | Non | Non | Non |
| **Blocage des touches dangereuses** | **Oui** | Non | Non | Non | Non |
| **API structurées** (info sans capture) | **Oui** | Partiel | Partiel | Non | Oui |
| **Zoom** (recadrage haute résolution) | **Oui** | Non | Non | Non | Non |
| **Multi-écran** | **Oui** | Non | Non | Non | Non |
| **Même schéma que Claude Code intégré** | **Oui** | Non | Non | Proche | Non |
| **Code Anthropic amont réutilisé** | **6 300+ lignes** | 0 | 0 | 0 | 0 |
| Nombre d'outils | 24 | 19 | 12 | 6 | 10 |
| Langage | TypeScript | Python | TypeScript | TypeScript | C# |

---

## Démarrage rapide

### Prérequis

- **Node.js** 18+
- **Windows 10/11**
- Visual Studio Build Tools (pour robotjs)

### Installation

```bash
git clone https://github.com/storyweaver/argus-automation.git
cd argus-automation
npm install
npm run build
```

### Configuration dans Claude Code

Ajoutez ceci au fichier `.mcp.json` de votre projet :

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

Redémarrez Claude Code. Vous verrez 24 nouveaux outils préfixés par `mcp__argus__`.

### Tests

```bash
npm test          # 70 tests (unitaires + intégration)
npm run test:unit # Tests unitaires uniquement
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Couche Amont — 6 300+ lignes issues du Chicago MCP d'Anthropic     │
│  (1 seule ligne modifiée)                                           │
│                                                                     │
│  toolCalls.ts (3 649 lignes) — portes de sécurité + dispatch        │
│  mcpServer.ts — Fabrique du serveur + liaison de session            │
│  tools.ts — 24 définitions de schémas d'outils                     │
│  types.ts — système de types complet                               │
│  keyBlocklist.ts — interception des touches dangereuses (win32)     │
│  pixelCompare.ts — détection de péremption 9×9                     │
│  imageResize.ts — algorithme de budget tokens                      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ Interface ComputerExecutor
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Couche Native Windows — ~400 lignes, code original                 │
│                                                                     │
│  screen.ts — node-screenshots + sharp (capture DXGI, JPEG, resize)  │
│  input.ts  — robotjs (souris/clavier SendInput)                     │
│  window.ts — koffi + Win32 API (gestion des fenêtres)               │
│  clipboard.ts — PowerShell Get/Set-Clipboard                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Pile technique

Chaque bibliothèque est l'équivalent Windows de ce que la version macOS utilise :

| Module | macOS (Chicago MCP) | Windows (Argus) | Rôle |
|---|---|---|---|
| Capture d'écran | SCContentFilter | **node-screenshots** (DXGI) | Capture d'écran |
| Saisie | enigo (Rust) | **robotjs** (SendInput) | Souris et clavier |
| Gestion des fenêtres | Swift + NSWorkspace | **koffi** + Win32 API | Contrôle des fenêtres |
| Traitement d'image | Sharp | **Sharp** | Compression JPEG + redimensionnement |
| Framework MCP | @modelcontextprotocol/sdk | **@modelcontextprotocol/sdk** | Protocole MCP |

## Les 24 outils

| Catégorie | Outils |
|---|---|
| **Session** | `request_access`, `list_granted_applications` |
| **Vision** | `screenshot`, `zoom` |
| **Clic souris** | `left_click`, `double_click`, `triple_click`, `right_click`, `middle_click` |
| **Contrôle souris** | `mouse_move`, `left_click_drag`, `left_mouse_down`, `left_mouse_up`, `cursor_position` |
| **Défilement** | `scroll` |
| **Clavier** | `type`, `key`, `hold_key` |
| **Presse-papiers** | `read_clipboard`, `write_clipboard` |
| **App/Affichage** | `open_application`, `switch_display` |
| **Lots + Attente** | `computer_batch`, `wait` |

## Modèle de sécurité

Permissions par application à trois niveaux — **le seul serveur MCP à proposer ce niveau de contrôle d'accès** :

| Niveau | Capture d'écran | Clic | Saisie/Collage |
|---|:---:|:---:|:---:|
| **read** (navigateurs, trading) | Oui | Non | Non |
| **click** (terminaux, IDE) | Oui | Clic gauche uniquement | Non |
| **full** (tout le reste) | Oui | Oui | Oui |

En complément : blocage des touches dangereuses, verrou d'application au premier plan sur chaque action, autorisations limitées à la session.

## Journaux

Tous les appels d'outils sont journalisés dans :
```
%LOCALAPPDATA%\argus-automation\logs\mcp-YYYY-MM-DD.log
```

## Limitations connues

- **Saisie de texte CJK** : utilisez `write_clipboard` + `key("ctrl+v")` pour le texte non-ASCII
- **Découverte d'applications** : ne renvoie actuellement que les applications en cours d'exécution (analyse du registre prévue)
- **Validation de pixels** : désactivée sous Windows (sharp asynchrone incompatible avec l'interface synchrone)
- **hideBeforeAction** : désactivé (la minimisation interrompt les processus enfants WebView2)

## Licence

MIT

## Remerciements

Construit sur l'architecture Chicago MCP d'Anthropic, extraite de Claude Code v2.1.88. Le code amont dans `src/upstream/` appartient à Anthropic ; la couche native Windows et le code d'intégration sont originaux.
