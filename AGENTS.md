# AGENTS.md — AI Context for protype-printer-sdk

> This document provides comprehensive context for AI assistants (Claude, GPT, etc.)
> working with the Protype printer ecosystem. Read this first before making changes.

---

## Ecosystem Overview

Protype is a 3D printer management ecosystem with three main components:

```
┌────────────────────────────────────────────────────┐
│                    ProtypeHub                       │
│  Electron desktop app (macOS/Win/Linux)             │
│  Remote printer management via WireGuard VPN        │
│  React 19 + Vite + TailwindCSS v4 + protype-ui     │
│  Located: /Users/.../ProtypeHub                     │
└──────────────────┬─────────────────────────────────┘
                   │ VPN tunnel (WireGuard)
┌──────────────────▼─────────────────────────────────┐
│              Klipper + Moonraker                    │
│  Runs on printer's Raspberry Pi / SBC               │
│  REST API on port 7125 + WebSocket                  │
│  Controls 3D printer firmware                       │
└──────────────────┬─────────────────────────────────┘
                   │ localhost
┌──────────────────▼─────────────────────────────────┐
│                  ProControl                          │
│  Electron kiosk app on printer's 21" touchscreen    │
│  React 18 + Webpack + Ant Design (migrating)        │
│  Located: /Users/.../ProControl                     │
└────────────────────────────────────────────────────┘
```

### This Package: protype-printer-sdk

The shared SDK layer between ProtypeHub and ProControl.
Provides typed Moonraker REST client, WebSocket, React hooks, and utilities.

**No external runtime dependencies.** Uses native `fetch()` and `WebSocket`.
Only peer dependency: React >=18.

---

## Architecture & Data Flow

```
User clicks printer in sidebar
  → navigate(/printer/:id)
    → PrinterPage.tsx resolves printer from PrinterContext
      → <MoonrakerProvider baseUrl="http://{vpn_ip}:7125" mode="remote">
          ├── usePrinterState()    → reads status from context
          ├── useTemperature()     → reads + sets temps via REST
          ├── usePrintJob()        → reads + controls print
          ├── useMotion()          → jog/home via REST G-code
          ├── useGcode()           → raw G-code console
          ├── useFiles()           → file management via REST
          ├── useFilament()        → extrusion + sensors
          └── useMacros()          → Klipper macro listing/exec
```

### Connection Modes

| | `mode="local"` (ProControl) | `mode="remote"` (ProtypeHub) |
|--|------------------------------|-------------------------------|
| Base URL | `http://localhost:7125` | `http://{vpn_ip}:7125` |
| Poll interval | 1000ms | 3000ms |
| HTTP timeout | 5000ms | 10000ms |
| WS reconnect | 1000ms | 3000ms |
| Max retries | 2 | 3 |

---

## File Structure

```
vendor/protype-printer-sdk/
├── src/
│   ├── api/
│   │   ├── moonraker-client.ts     # REST client — all Moonraker HTTP API methods
│   │   ├── moonraker-ws.ts         # WebSocket JSON-RPC 2.0 client
│   │   └── types.ts                # ALL TypeScript types (PrinterStatus, HeaterState, etc.)
│   │
│   ├── hooks/
│   │   ├── MoonrakerProvider.tsx    # React context — wraps children with REST+WS+polling
│   │   ├── usePrinterState.ts      # Derived state: isPrinting, isIdle, etc.
│   │   ├── useTemperature.ts       # Temp reading + control + preheat presets
│   │   ├── usePrintJob.ts          # Progress, ETA, pause/resume/cancel
│   │   ├── useMotion.ts            # Jog XYZ, home, E-stop, speed/flow
│   │   ├── useGcode.ts             # G-code console with history
│   │   ├── useFiles.ts             # File list, upload, delete, search
│   │   ├── useFilament.ts          # Extrusion + sensors FS1-FS8
│   │   └── useMacros.ts            # Klipper macro list + execute
│   │
│   ├── utils/
│   │   ├── gcode-builder.ts        # Type-safe G-code: home(), moveAbsolute(), etc.
│   │   ├── format.ts               # formatTemp(), formatDuration(), formatETA(), etc.
│   │   └── constants.ts            # ENDPOINTS, POLL_INTERVALS, TIMEOUTS
│   │
│   ├── routes.ts                   # Route constants + URL builders (HUB_ROUTES, KIOSK_ROUTES)
│   └── index.ts                    # Public API — all exports
│
├── package.json
├── tsconfig.json
├── README.md                       # User-facing docs
└── AGENTS.md                       # This file (AI context)
```

---

## Moonraker API (What the SDK talks to)

Moonraker is the API layer for Klipper firmware. Runs on port 7125.

### Key REST Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/server/info` | GET | Server status, Klipper state |
| `/printer/objects/query?{objects}` | GET | Read printer object states |
| `/printer/gcode/script` | POST | Send G-code commands |
| `/printer/print/start` | POST | Start a print |
| `/printer/print/pause` | POST | Pause active print |
| `/printer/print/resume` | POST | Resume paused print |
| `/printer/print/cancel` | POST | Cancel active print |
| `/printer/emergency_stop` | POST | Emergency stop |
| `/printer/firmware_restart` | POST | Restart Klipper |
| `/server/files/list` | GET | List G-code files |
| `/server/files/metadata` | GET | File metadata (thumbnails, time, etc.) |
| `/server/files/upload` | POST | Upload G-code file |
| `/server/history/list` | GET | Print history |
| `/printer/objects/list` | GET | List available objects (macros, etc.) |

### Key Printer Objects

| Object | Fields | Purpose |
|--------|--------|---------|
| `print_stats` | state, filename, total_duration, print_duration, filament_used | Print state |
| `virtual_sdcard` | progress, is_active, file_position | Print progress |
| `toolhead` | position, homed_axes, max_velocity, max_accel | Head position |
| `extruder` | temperature, target, power | Hotend temps |
| `extruder1` | temperature, target, power | Second hotend |
| `heater_bed` | temperature, target, power | Bed temps |
| `heater_generic heater_chamber` | temperature, target, power | Chamber |
| `filament_switch_sensor FS1..FS8` | enabled, filament_detected | Filament sensors |

### WebSocket Protocol

Moonraker uses JSON-RPC 2.0 over WebSocket at `ws://{ip}:7125/websocket`.

**Subscribe to live updates:**
```json
{
  "jsonrpc": "2.0",
  "method": "printer.objects.subscribe",
  "params": { "objects": { "extruder": null, "heater_bed": null } },
  "id": 1
}
```

**Server pushes:**
- `notify_status_update` — partial object updates (real-time temps, progress)
- `notify_gcode_response` — G-code output lines
- `notify_klippy_ready` / `notify_klippy_shutdown` — firmware state
- `notify_filelist_changed` — file add/remove

---

## TypeScript Types (api/types.ts)

### Core Types

```typescript
type ConnectionMode = 'local' | 'remote';
type KlipperState = 'ready' | 'startup' | 'shutdown' | 'error';
type PrintState = 'standby' | 'printing' | 'paused' | 'complete' | 'cancelled' | 'error';

interface PrinterStatus {
  klipperState: KlipperState;
  printStats: PrintStats;
  temperatures: TemperatureData;
  toolhead: ToolheadState;
  virtualSdCard: VirtualSdCard;
  filamentSensors: FilamentSensorState[];
  progress: number;       // 0.0-1.0
  eta: Date | null;       // computed
  elapsedSeconds: number; // computed
  isConnected: boolean;
}

interface HeaterState {
  temperature: number;  // current C
  target: number;       // target C
  power: number;        // 0.0-1.0
}

interface Position { x: number; y: number; z: number; e: number; }

// All API calls return:
interface ApiResult<T> { success: boolean; data?: T; error?: string; }
```

---

## Hook API Cheatsheet

| Hook | Key Returns | When to Use |
|------|-------------|-------------|
| `useMoonraker()` | `client, ws, status, refresh` | Low-level access to REST/WS clients |
| `usePrinterState()` | `isPrinting, isIdle, isPaused, isReady` | UI state flags |
| `useTemperature()` | `extruder, bed, chamber, preheatPLA()` | Temperature panels |
| `usePrintJob()` | `progress, eta, filename, pause(), cancel()` | Print status/controls |
| `useMotion()` | `position, jog(), home(), emergencyStop()` | Jog controls |
| `useGcode()` | `sendGcode(), history, isSending` | G-code console |
| `useFiles()` | `files, uploadFile(), deleteFile(), startPrint()` | File manager |
| `useFilament()` | `extrude(), retract(), sensors` | Filament controls |
| `useMacros()` | `macros, runMacro(), visibleMacros` | Macro buttons |

---

## ProtypeHub Integration (Host App)

### Stack

- **Runtime:** Electron 38 (Chromium + Node.js)
- **Frontend:** React 19 + Vite + TailwindCSS v4
- **Router:** react-router-dom 7 with `HashRouter`
- **UI:** protype-ui (custom design system, git submodule at `vendor/protype-ui`)
- **Icons:** lucide-react
- **Animation:** framer-motion
- **Auth:** OAuth 2.0 via Keycloak (Electron main process handles tokens)
- **VPN:** WireGuard (native macOS or sudo wg-quick)
- **Fonts:** Roboto Mono (monospace), system fonts

### Route Map

```
/login                    LoginPage            OAuth login screen
/                         DashboardPage        Printer list + status
/dashboard                DashboardPage        (alias)
/vpn                      VPNPage              VPN management
/settings                 SettingsPage         App settings
/printer/:id              PrinterPage          Printer dashboard tab
/printer/:id/files        PrinterPage          Files tab
/printer/:id/console      PrinterPage          Console tab
/printer/:id/history      PrinterPage          History tab
```

### Context Providers (in order)

```tsx
<HashRouter>
  <AuthProvider>          // OAuth tokens, user info
    <VPNStatusProvider>   // VPN connection status polling
      <VPNProvider>       // VPN connect/disconnect, registration
        <PrinterProvider> // Printer list, connection flow
          <AppRoutes />
        </PrinterProvider>
      </VPNProvider>
    </VPNStatusProvider>
  </AuthProvider>
</HashRouter>
```

### Electron IPC Bridge (window.electronAPI)

The renderer process communicates with Electron main via `window.electronAPI`:

**Auth:** `oauthLogin()`, `oauthLogout()`, `oauthStatus()`, `oauthRefresh()`
**VPN:** `startWireGuard()`, `stopWireGuard()`, `getConnectionStatus()`
**VPN Config:** `checkVpnRegistration()`, `registerVpnUser()`, `getVpnConfig()`
**Device:** `getMacAddress()`, `getDeviceFingerprint()`, `getPcName()`
**Tokens:** `getTokenInfo()`, `clearSavedTokens()`
**Sudo:** `sudoStartSession()`, `sudoStopSession()`, `sudoGetSessionInfo()`
**Window:** `window.minimize()`, `window.maximize()`, `window.close()`

### Design Tokens

- **Background:** `#09090b` (almost black) with subtle purple radial gradients
- **Primary accent:** `#585DFF → #8EDFF8` gradient
- **Glass cards:** `rgba(255, 255, 255, 0.03)` bg + `rgba(255, 255, 255, 0.06)` border
- **Border radius:** 16px (cards), 8px (buttons/inputs)
- **Font:** `'Roboto Mono', monospace`
- **Text:** `rgba(255, 255, 255, 0.9)` primary, `rgba(255, 255, 255, 0.45)` secondary
- **Status colors:** green `#4ade80`, red `#ef4444`, yellow `#facc15`, blue `#60a5fa`

### Alias Configuration

```ts
// vite.config.mts
'protype-printer-sdk': './vendor/protype-printer-sdk/src'
'protype-ui':          './vendor/protype-ui/src'
'@':                   './src'
```

---

## ProControl Integration (Kiosk App) — Planned

### Current Stack

- **Runtime:** Electron (kiosk mode, 21" touchscreen)
- **Frontend:** React 18 + Webpack + Ant Design
- **Moonraker:** Direct REST calls from moonraker.ts (850+ lines)
- **Location:** `/Users/.../ProControl`
- **protype-ui:** Not yet integrated (planned)

### Migration Plan

1. Add `protype-printer-sdk` as git submodule
2. Replace `moonraker.ts` with SDK's `MoonrakerClient`
3. Add `protype-ui` submodule, replace Ant Design
4. Wrap app with `<MoonrakerProvider mode="local">`
5. Build touch-optimized UI using SDK hooks

---

## Common Tasks for AI

### Adding a new Moonraker feature

1. Add types to `src/api/types.ts`
2. Add REST method to `src/api/moonraker-client.ts`
3. Create or extend a hook in `src/hooks/`
4. Export from `src/index.ts`
5. Use in PrinterPage or create new tab

### Adding a new printer page tab

1. Add tab ID to `PrinterTab` type in `src/routes.ts`
2. Add `HUB_ROUTES` entry
3. Create tab component in `PrinterPage.tsx`
4. Add to `TABS` array and tab content switch

### Modifying temperature presets

Edit `src/hooks/useTemperature.ts` — `preheatPLA`, `preheatABS`, `preheatPETG` functions.

### Adding a new G-code command builder

Add function to `src/utils/gcode-builder.ts`, it will auto-export via `gcode.*`.

### Changing poll intervals / timeouts

Edit `src/utils/constants.ts` — `POLL_INTERVALS` and `TIMEOUTS`.

---

## Important Conventions

- **Language:** Code comments in English, UI text in Russian
- **Naming:** camelCase for TypeScript, snake_case for Moonraker API fields
- **Imports:** Always import from `'protype-printer-sdk'`, never from relative SDK paths
- **No axios:** SDK uses native `fetch()` for portability
- **No external deps:** Keep the SDK zero-dependency (only React peer dep)
- **Heater names:** Moonraker uses `extruder`, `heater_bed`, `heater_generic heater_chamber`
- **Filament sensors:** Named `FS1` through `FS8` (8 sensors max per Protype printer)
- **G-code:** Klipper G-code, not Marlin. Use `SET_HEATER_TEMPERATURE` over `M104`
- **Error handling:** All API calls return `ApiResult<T>` — always check `.success`
