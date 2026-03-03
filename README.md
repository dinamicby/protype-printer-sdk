# protype-printer-sdk

Moonraker/Klipper SDK for the Protype printer ecosystem.
TypeScript REST client, WebSocket, React hooks.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              App-specific Layouts                │
│  ProtypeHub: sidebar page    ProControl: kiosk   │
└──────────────────┬──────────────────────────────┘
                   │ uses
┌──────────────────▼──────────────────────────────┐
│           protype-printer-sdk (this)             │
│  Moonraker client + React hooks + utilities      │
│  vendor/protype-printer-sdk                      │
└──────────────────┬──────────────────────────────┘
                   │ uses
┌──────────────────▼──────────────────────────────┐
│              protype-ui                           │
│  Button, Card, Input, Badge, Sidebar...          │
│  vendor/protype-ui                               │
└─────────────────────────────────────────────────┘
```

---

## Installation

Add as git submodule in both ProtypeHub and ProControl:

```bash
git submodule add https://github.com/dinamicby/protype-printer-sdk.git vendor/protype-printer-sdk
```

### Vite (ProtypeHub)

```ts
// vite.config.mts
resolve: {
  alias: {
    'protype-printer-sdk': path.resolve(__dirname, './vendor/protype-printer-sdk/src'),
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "paths": {
      "protype-printer-sdk": ["vendor/protype-printer-sdk/src"],
      "protype-printer-sdk/*": ["vendor/protype-printer-sdk/src/*"]
    }
  },
  "include": ["src", "vendor/protype-printer-sdk/src"]
}
```

### Webpack (ProControl)

```js
// webpack.config.js
resolve: {
  alias: {
    'protype-printer-sdk': path.resolve(__dirname, 'vendor/protype-printer-sdk/src'),
  }
}
```

---

## Route Maps

### ProtypeHub Routes

ProtypeHub uses `react-router-dom` with `HashRouter`.
All printer routes are nested inside the authenticated `AppLayout`.

```
Route                          Component           Description
─────────────────────────────────────────────────────────────────
/login                         LoginPage           OAuth login
/                              DashboardPage       Main dashboard (printer list)
/dashboard                     DashboardPage       Alias for /
/vpn                           VPNPage             VPN management
/settings                      SettingsPage        App settings
/printer/:id                   PrinterPage         Printer control panel (SDK)
/printer/:id/files             PrinterFilesPage    G-code file manager (planned)
/printer/:id/history           PrinterHistoryPage  Print history (planned)
/printer/:id/settings          PrinterSettingsPage Printer config (planned)
/printer/:id/console           PrinterConsolePage  Full G-code console (planned)
*                              → redirect /        404 fallback
```

**Route params:**
- `:id` — Printer ID (`printer.id`) or serial number (`printer.printer_serial`). Both are supported, the page resolves the printer from the list.

**Navigation flow:**
```
Sidebar click on printer
  → navigate(/printer/:id)
    → PrinterPage resolves printer from context
      → <MoonrakerProvider baseUrl={http://{ip}:7125} mode="remote">
        → PrinterDashboard renders SDK hooks
```

### ProControl Routes (Planned)

ProControl runs in kiosk mode — the entire screen is the printer UI.
No sidebar, no auth, single printer on localhost.

```
Route                          Component           Description
─────────────────────────────────────────────────────────────────
/                              KioskDashboard      Main printer dashboard
/temperature                   TemperaturePage     Temperature controls
/motion                        MotionPage          Jog / Home controls
/files                         FilesPage           G-code file browser
/console                       ConsolePage         G-code console
/filament                      FilamentPage        Extrusion / sensors
/settings                      SettingsPage        Printer settings
/system                        SystemPage          Wi-Fi, brightness, USB
```

**ProControl MoonrakerProvider setup:**
```tsx
// Wraps entire app — single printer on localhost
<MoonrakerProvider baseUrl="http://localhost:7125" mode="local">
  <KioskRouter />
</MoonrakerProvider>
```

---

## Connection Modes

| Setting | `local` (ProControl) | `remote` (ProtypeHub) |
|---------|---------------------|----------------------|
| Poll interval | 1000ms | 3000ms |
| HTTP timeout | 5000ms | 10000ms |
| WS reconnect delay | 1000ms | 3000ms |
| Max retries | 2 | 3 |
| Typical latency | <5ms | 50-200ms (VPN) |

---

## Quick Start

```tsx
import {
  MoonrakerProvider,
  usePrinterState,
  useTemperature,
  usePrintJob,
  formatTempPair,
} from 'protype-printer-sdk';

// Wrap your printer page/app with MoonrakerProvider
function App() {
  return (
    <MoonrakerProvider baseUrl="http://192.168.1.2:7125" mode="remote">
      <Dashboard />
    </MoonrakerProvider>
  );
}

function Dashboard() {
  const { isPrinting, isConnected } = usePrinterState();
  const { extruder, bed } = useTemperature();
  const { progress, eta } = usePrintJob();

  return (
    <div>
      <p>Connected: {isConnected ? 'Yes' : 'No'}</p>
      <p>Hotend: {formatTempPair(extruder?.temperature, extruder?.target)}</p>
      <p>Bed: {formatTempPair(bed?.temperature, bed?.target)}</p>
      {isPrinting && <p>Progress: {(progress * 100).toFixed(1)}%</p>}
    </div>
  );
}
```

---

## API Reference

### MoonrakerProvider

React context that manages the Moonraker connection lifecycle.
Must wrap all components that use SDK hooks.

```tsx
<MoonrakerProvider
  baseUrl="http://192.168.1.2:7125"  // Moonraker HTTP URL
  mode="remote"                       // "local" | "remote"
  pollInterval={3000}                 // Override poll interval (ms)
  disableWebSocket={false}            // Disable WS, polling only
>
  {children}
</MoonrakerProvider>
```

**Context value** (via `useMoonraker()`):

| Field | Type | Description |
|-------|------|-------------|
| `client` | `MoonrakerClient` | REST API client |
| `ws` | `MoonrakerWebSocket` | WebSocket client |
| `status` | `PrinterStatus \| null` | Full printer status |
| `isConnected` | `boolean` | REST connectivity |
| `wsConnected` | `boolean` | WebSocket connectivity |
| `error` | `string \| null` | Connection error |
| `refresh` | `() => Promise<void>` | Force status refresh |
| `config` | `MoonrakerConfig` | Connection config |

---

### usePrinterState()

High-level printer state with convenience boolean flags.

```tsx
const {
  status,           // PrinterStatus | null
  printState,       // 'standby' | 'printing' | 'paused' | 'complete' | 'cancelled' | 'error'
  klipperState,     // 'ready' | 'startup' | 'shutdown' | 'error'
  isConnected,      // boolean
  wsConnected,      // boolean
  error,            // string | null

  // Convenience flags
  isIdle,           // printState === 'standby'
  isPrinting,       // printState === 'printing'
  isPaused,         // printState === 'paused'
  isComplete,       // printState === 'complete'
  isCancelled,      // printState === 'cancelled'
  isError,          // printState === 'error'
  isReady,          // klipperState === 'ready'
  isStarting,       // klipperState === 'startup'
  isShutdown,       // klipperState === 'shutdown'
} = usePrinterState();
```

---

### useTemperature()

Temperature monitoring and control. Includes preheat profiles.

```tsx
const {
  extruder,         // HeaterInfo | null  — { temperature, target, power, isHeating, atTarget }
  extruder1,        // HeaterInfo | null  — second extruder (null if not present)
  bed,              // HeaterInfo | null
  chamber,          // HeaterInfo | null

  // Controls
  setExtruderTemp,      // (target: number, tool?: number) => Promise<void>
  setExtruderTempWait,  // (target: number, tool?: number) => Promise<void>  — blocks until reached
  setBedTemp,           // (target: number) => Promise<void>
  setBedTempWait,       // (target: number) => Promise<void>
  setChamberTemp,       // (target: number) => Promise<void>
  cooldown,             // () => Promise<void>  — TURN_OFF_HEATERS

  // Presets
  preheatPLA,       // () => Promise<void>  — extruder 200, bed 60
  preheatABS,       // () => Promise<void>  — extruder 240, bed 100
  preheatPETG,      // () => Promise<void>  — extruder 230, bed 80
} = useTemperature();
```

**HeaterInfo fields:**
- `temperature` — current temp in C
- `target` — target temp in C
- `power` — heater power 0.0-1.0
- `isHeating` — target > 0
- `atTarget` — |temperature - target| <= 2

---

### usePrintJob()

Current print progress, timing, and controls.

```tsx
const {
  state,            // PrintState
  progress,         // 0.0 - 1.0
  progressPercent,  // "45.2%"
  eta,              // Date | null
  elapsedSeconds,   // number
  filename,         // string | null
  totalDuration,    // number (sec, including pauses)
  printDuration,    // number (sec, excluding pauses)
  filamentUsed,     // number (mm)
  message,          // string | null (Klipper message)
  isActive,         // boolean (virtual SD active)

  // Controls
  startPrint,       // (filename: string) => Promise<void>
  pause,            // () => Promise<void>
  resume,           // () => Promise<void>
  cancel,           // () => Promise<void>
} = usePrintJob();
```

---

### useMotion()

Toolhead position, jog controls, homing, emergency stop.

```tsx
const {
  position,         // { x, y, z, e }
  isHomed,          // boolean

  // Jog
  jog,              // (params: { x?, y?, z?, speed? }) => Promise<void>
  moveTo,           // (params: { x?, y?, z?, speed? }) => Promise<void>

  // Homing
  home,             // (...axes: ('x'|'y'|'z')[]) => Promise<void>  — no args = home all

  // Emergency
  emergencyStop,    // () => Promise<void>  — M112
  firmwareRestart,  // () => Promise<void>
  disableSteppers,  // () => Promise<void>  — M84

  // Overrides
  setSpeedFactor,   // (percent: number) => Promise<void>  — M220
  setFlowFactor,    // (percent: number) => Promise<void>  — M221
} = useMotion();
```

---

### useGcode()

G-code console with command history.

```tsx
const {
  sendGcode,        // (command: string) => Promise<string | null>
  history,          // GcodeHistoryEntry[]  — { command, response, timestamp, success }
  lastResponse,     // string | null
  isSending,        // boolean
  clearHistory,     // () => void
  wsResponses,      // string[]  — raw WS responses
  clearWsResponses, // () => void
} = useGcode();
```

---

### useFiles()

G-code file management — list, upload, delete, search.

```tsx
const {
  files,            // GcodeFile[]
  isLoading,        // boolean
  error,            // string | null

  refresh,          // () => Promise<void>
  getMetadata,      // (filename: string) => Promise<GcodeFileMetadata | null>
  uploadFile,       // (file: File, startAfterUpload?: boolean) => Promise<boolean>
  deleteFile,       // (filename: string) => Promise<boolean>
  startPrint,       // (filename: string) => Promise<void>

  searchFiles,      // (query: string) => GcodeFile[]
  sortedByDate,     // GcodeFile[]  — newest first
  sortedByName,     // GcodeFile[]  — alphabetical
  totalSize,        // number (bytes)
} = useFiles();
```

---

### useFilament()

Extrusion controls and filament sensor state (FS1-FS8).

```tsx
const {
  extrude,               // (length: number, speed?: number) => Promise<void>
  retract,               // (length: number, speed?: number) => Promise<void>
  resetExtruder,         // () => Promise<void>
  setRelativeExtrusion,  // () => Promise<void>
  setAbsoluteExtrusion,  // () => Promise<void>

  sensors,               // Record<string, FilamentSensorState>
  allFilamentPresent,    // boolean
  anyFilamentOut,        // boolean
  sensorCount,           // number
  setSensorEnabled,      // (sensorName: string, enabled: boolean) => Promise<void>
} = useFilament();
```

---

### useMacros()

Klipper macro listing and execution.

```tsx
const {
  macros,           // GcodeMacro[]  — all macros
  visibleMacros,    // GcodeMacro[]  — without _ prefixed
  isLoading,        // boolean
  error,            // string | null
  runningMacro,     // string | null

  refresh,          // () => Promise<void>
  runMacro,         // (name: string, params?: Record<string, string|number>) => Promise<void>
} = useMacros();
```

---

## Utilities

### Formatters

```tsx
import {
  formatTemp,           // (value, decimals?) => "215°C" | "—"
  formatTempPair,       // (current, target, decimals?) => "215 / 220°C"
  formatDuration,       // (seconds) => "01:23:45" | "23:45"
  formatETA,            // (date | null) => "~2ч 15м" | "—"
  formatProgress,       // (0.452, decimals?) => "45.2%"
  formatFileSize,       // (bytes) => "1.2 MB"
  formatFilamentLength, // (mm) => "12.5 м" | "450 мм"
  formatTimestamp,      // (unix) => locale string
  formatPower,          // (0.75) => "75%"
} from 'protype-printer-sdk';
```

### G-code Builder

```tsx
import { gcode } from 'protype-printer-sdk';

gcode.home()                        // "G28"
gcode.home('x', 'z')               // "G28 X Z"
gcode.moveAbsolute({ x: 10, y: 20 }) // "G90\nG1 X10 Y20"
gcode.moveRelative({ z: 5 })       // "G91\nG1 Z5\nG90"
gcode.setExtruderTemp(220)          // "M104 S220"
gcode.setBedTemp(60)                // "M140 S60"
gcode.setHeaterTemp('heater_chamber', 50) // "SET_HEATER_TEMPERATURE HEATER=heater_chamber TARGET=50"
gcode.extrude(50, 300)              // "M83\nG1 E50 F300"
gcode.retract(5)                    // "M83\nG1 E-5 F300"
gcode.setFanSpeed(0.5)              // "M106 S128"
gcode.emergencyStop()               // "M112"
gcode.batch(                        // multi-line
  gcode.home(),
  gcode.setBedTemp(60),
  gcode.setExtruderTemp(200),
)
```

### Constants

```tsx
import { ENDPOINTS, POLL_INTERVALS, TIMEOUTS, STATUS_OBJECTS } from 'protype-printer-sdk';

ENDPOINTS.OBJECTS_QUERY  // "/printer/objects/query"
ENDPOINTS.GCODE_SCRIPT   // "/printer/gcode/script"
ENDPOINTS.FILES_LIST     // "/server/files/list"
POLL_INTERVALS.local     // 1000
POLL_INTERVALS.remote    // 3000
STATUS_OBJECTS           // ['print_stats', 'virtual_sdcard', ...]
```

---

## MoonrakerClient (Low-level)

For use outside React or in Electron main process:

```tsx
import { MoonrakerClient } from 'protype-printer-sdk';

const client = new MoonrakerClient({
  baseUrl: 'http://192.168.1.2:7125',
  mode: 'remote',
});

// All methods return ApiResult<T> = { success, data?, error? }
const status = await client.getPrinterStatus();
await client.setExtruderTemp(220);
await client.setBedTemp(60);
await client.sendGcode('G28');
await client.home(['x', 'y', 'z']);
await client.moveRelative({ x: 10, speed: 3000 });
await client.startPrint('benchy.gcode');
await client.pausePrint();
await client.resumePrint();
await client.cancelPrint();
await client.emergencyStop();

const files = await client.listFiles();
const meta = await client.getFileMetadata('benchy.gcode');
const history = await client.getPrintHistory(50);
const macros = await client.listMacros();
```

---

## MoonrakerWebSocket (Low-level)

```tsx
import { MoonrakerWebSocket, wsUrlFromHttp } from 'protype-printer-sdk';

const ws = new MoonrakerWebSocket({
  url: wsUrlFromHttp('http://192.168.1.2:7125'), // → ws://192.168.1.2:7125/websocket
  autoReconnect: true,
  reconnectDelay: 3000,
});

ws.on('connection', (data) => console.log('Connected:', data.connected));
ws.on('status_update', (data) => console.log('Status:', data));
ws.on('gcode_response', (data) => console.log('GCode:', data));
ws.on('notify_klippy_ready', () => console.log('Klipper ready'));

ws.connect();

// Subscribe to printer objects
await ws.subscribeObjects({
  extruder: null,
  heater_bed: ['temperature', 'target'],
  print_stats: null,
});

// JSON-RPC call
const result = await ws.call('printer.gcode.script', { script: 'G28' });
```

---

## Integration Patterns

### Pattern: ProtypeHub Printer Page

```tsx
// src/pages/PrinterPage.tsx
import { useParams, useNavigate } from 'react-router-dom';
import { MoonrakerProvider } from 'protype-printer-sdk';
import { usePrinterContext } from '../contexts/PrinterContext';

export function PrinterPage() {
  const { id } = useParams<{ id: string }>();
  const { printers } = usePrinterContext();
  const printer = printers.find(p => p.id === id || p.printer_serial === id);

  if (!printer) return <NotFound />;

  return (
    <MoonrakerProvider baseUrl={`http://${printer.client_ip}:7125`} mode="remote">
      <PrinterDashboard printerName={printer.printer_name} />
    </MoonrakerProvider>
  );
}
```

### Pattern: ProControl Kiosk App

```tsx
// src/App.tsx
import { MoonrakerProvider } from 'protype-printer-sdk';

function App() {
  return (
    <MoonrakerProvider baseUrl="http://localhost:7125" mode="local">
      <KioskLayout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/temperature" element={<TemperaturePage />} />
          <Route path="/files" element={<FilesPage />} />
        </Routes>
      </KioskLayout>
    </MoonrakerProvider>
  );
}
```

### Pattern: Sidebar Printer Navigation

```tsx
// AppLayout.tsx — sidebar item
{printers.map((printer) => (
  <SidebarItem
    key={printer.id}
    icon={<Printer size={18} />}
    active={currentPath === `/printer/${printer.id}`}
    onClick={() => navigate(`/printer/${printer.id}`)}
    badge={<StatusDot active={printer.is_online} />}
  >
    {printer.printer_name}
  </SidebarItem>
))}
```

### Pattern: Conditional Panels

```tsx
function SmartDashboard() {
  const { isPrinting, isPaused, isIdle } = usePrinterState();

  return (
    <div>
      {/* Always show */}
      <TemperaturePanel />
      <ConnectionStatus />

      {/* Show during print */}
      {(isPrinting || isPaused) && <PrintProgressPanel />}

      {/* Show when idle */}
      {isIdle && <FileListPanel />}

      {/* Always show */}
      <MotionPanel />
      <GcodeConsole />
    </div>
  );
}
```

---

## File Structure

```
vendor/protype-printer-sdk/
├── src/
│   ├── api/
│   │   ├── moonraker-client.ts     # REST API client (fetch-based, platform-agnostic)
│   │   ├── moonraker-ws.ts         # WebSocket JSON-RPC 2.0 client
│   │   └── types.ts                # Full TypeScript type definitions
│   │
│   ├── hooks/
│   │   ├── MoonrakerProvider.tsx    # React context: connection lifecycle
│   │   ├── usePrinterState.ts      # Printer status + convenience flags
│   │   ├── useTemperature.ts       # Temperature read/write + presets
│   │   ├── usePrintJob.ts          # Print progress, ETA, controls
│   │   ├── useMotion.ts            # Jog, home, E-stop, speed/flow
│   │   ├── useGcode.ts             # G-code console with history
│   │   ├── useFiles.ts             # File listing, upload, delete
│   │   ├── useFilament.ts          # Extrusion, sensors FS1-FS8
│   │   └── useMacros.ts            # Klipper macro management
│   │
│   ├── utils/
│   │   ├── gcode-builder.ts        # Type-safe G-code command builders
│   │   ├── format.ts               # Display formatters (temp, time, ETA)
│   │   └── constants.ts            # Endpoints, intervals, timeouts
│   │
│   └── index.ts                    # Public API (all exports)
│
├── package.json                    # peerDeps: react >=18
├── tsconfig.json                   # Strict TS, ESNext, Bundler
└── README.md                       # This file
```

---

## Peer Dependencies

- `react` >= 18.0.0
- `react-dom` >= 18.0.0

No other dependencies. Uses native `fetch()` and `WebSocket`.
