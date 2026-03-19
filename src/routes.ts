/**
 * Recommended route patterns for Protype printer ecosystem.
 *
 * This module provides route path constants and URL builder helpers
 * to keep routing consistent between ProtypeHub and ProControl.
 *
 * Usage:
 *   import { PRINTER_ROUTES, buildPrinterUrl } from 'protype-printer-sdk/routes';
 *   navigate(buildPrinterUrl(printer.id));
 *   navigate(buildPrinterUrl(printer.id, 'files'));
 */

// ─── ProtypeHub Routes ──────────────────────────────────────
//
// ProtypeHub is a multi-page Electron app with sidebar.
// Printer pages are nested under /printer/:id/
// All routes are inside authenticated <AppLayout> with <Outlet>.
//
// Route tree:
//   /login                        → LoginPage (unauthenticated)
//   / (AppLayout)
//     /                           → DashboardPage (printer list, status overview)
//     /dashboard                  → DashboardPage (alias)
//     /vpn                        → VPNPage
//     /settings                   → SettingsPage
//     /printer/:id                → PrinterPage (dashboard tab)
//     /printer/:id/files          → PrinterFilesPage (G-code file manager)
//     /printer/:id/history        → PrinterHistoryPage (print history)
//     /printer/:id/console        → PrinterConsolePage (full G-code terminal)
//     /printer/:id/settings       → PrinterSettingsPage (printer configuration)
//   *                             → redirect to /
//
// :id = printer.id or printer.printer_serial (both supported)

export const HUB_ROUTES = {
  /** Main dashboard with printer list */
  DASHBOARD: '/',
  /** VPN management */
  VPN: '/vpn',
  /** Application settings */
  SETTINGS: '/settings',

  /** Printer control panel — main dashboard tab */
  PRINTER: '/printer/:id',
  /** Printer — G-code file manager */
  PRINTER_FILES: '/printer/:id/files',
  /** Printer — print history */
  PRINTER_HISTORY: '/printer/:id/history',
  /** Printer — full G-code console */
  PRINTER_CONSOLE: '/printer/:id/console',
  /** Printer — printer configuration */
  PRINTER_SETTINGS: '/printer/:id/settings',
} as const;

// ─── ProControl Routes (Kiosk) ──────────────────────────────
//
// ProControl is a full-screen kiosk app on the printer's 21" touchscreen.
// No sidebar — top nav or tab bar. Single printer on localhost.
// MoonrakerProvider wraps the entire app with mode="local".
//
// Route tree:
//   /                             → KioskDashboard (temperature + print status)
//   /temperature                  → TemperaturePage (full temp controls)
//   /motion                       → MotionPage (jog, home, speed/flow)
//   /files                        → FilesPage (G-code file browser)
//   /console                      → ConsolePage (G-code terminal)
//   /filament                     → FilamentPage (extrusion, sensors FS1-FS8)
//   /macros                       → MacrosPage (Klipper macros)
//   /settings                     → SettingsPage (printer config)
//   /system                       → SystemPage (Wi-Fi, brightness, USB)

export const KIOSK_ROUTES = {
  /** Main dashboard — temperature + print status */
  DASHBOARD: '/',
  /** Temperature controls */
  TEMPERATURE: '/temperature',
  /** Motion controls — jog, home */
  MOTION: '/motion',
  /** G-code file browser */
  FILES: '/files',
  /** G-code terminal */
  CONSOLE: '/console',
  /** Filament / extrusion controls */
  FILAMENT: '/filament',
  /** Klipper macros */
  MACROS: '/macros',
  /** Printer settings */
  SETTINGS: '/settings',
  /** System settings (Wi-Fi, display, USB) */
  SYSTEM: '/system',
} as const;

// ─── URL Builders ───────────────────────────────────────────

export type PrinterTab =
  | 'files' | 'history' | 'console' | 'settings'
  | 'filacore' | 'jobs' | 'webcam' | 'viewer'
  | 'bedmesh' | 'calibration' | 'config' | 'system'
  | 'spoolman' | 'timelapse';

/**
 * Build a ProtypeHub printer URL.
 *
 * @param printerId - printer.id or printer.printer_serial
 * @param tab - optional sub-tab (files, history, console, settings)
 * @returns URL path string, e.g. "/printer/abc123" or "/printer/abc123/files"
 *
 * @example
 *   navigate(buildPrinterUrl(printer.id));
 *   navigate(buildPrinterUrl(printer.id, 'files'));
 */
export function buildPrinterUrl(printerId: string, tab?: PrinterTab): string {
  const base = `/printer/${encodeURIComponent(printerId)}`;
  return tab ? `${base}/${tab}` : base;
}

/**
 * Extract printer ID from current path.
 *
 * @param pathname - window.location.pathname or useLocation().pathname
 * @returns printer ID string or null
 *
 * @example
 *   const id = extractPrinterId('/printer/abc123/files'); // "abc123"
 */
export function extractPrinterId(pathname: string): string | null {
  const match = pathname.match(/^\/printer\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Check if current path is a printer page.
 *
 * @param pathname - window.location.pathname
 * @returns true if path starts with /printer/
 */
export function isPrinterRoute(pathname: string): boolean {
  return pathname.startsWith('/printer/');
}

/**
 * Get the active printer tab from URL.
 *
 * @param pathname - window.location.pathname
 * @returns tab name or null (dashboard)
 *
 * @example
 *   getActiveTab('/printer/abc/files')    // "files"
 *   getActiveTab('/printer/abc')          // null (dashboard)
 */
export function getActiveTab(pathname: string): PrinterTab | null {
  const match = pathname.match(/^\/printer\/[^/]+\/(\w+)$/);
  if (!match) return null;
  const tab = match[1] as PrinterTab;
  const validTabs: PrinterTab[] = [
    'files', 'history', 'console', 'settings',
    'filacore', 'jobs', 'webcam', 'viewer',
    'bedmesh', 'calibration', 'config', 'system',
    'spoolman', 'timelapse',
  ];
  return validTabs.includes(tab) ? tab : null;
}
