/**
 * useGcode — send G-code commands to the printer.
 *
 * Provides a generic sendGcode function plus a command history
 * for console-style interfaces.
 *
 * Usage:
 *   const { sendGcode, history, lastResponse } = useGcode();
 *   await sendGcode('G28');
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useMoonraker } from './MoonrakerProvider';

export interface GcodeHistoryEntry {
  /** Command sent */
  command: string;
  /** Response from Klipper (if any) */
  response: string | null;
  /** Timestamp */
  timestamp: number;
  /** Whether command succeeded */
  success: boolean;
}

export interface GcodeValue {
  /** Send a G-code command (single or multi-line) */
  sendGcode: (command: string) => Promise<string | null>;
  /** Command history (latest first) */
  history: GcodeHistoryEntry[];
  /** Last G-code response */
  lastResponse: string | null;
  /** Whether a command is currently being sent */
  isSending: boolean;
  /** Clear command history */
  clearHistory: () => void;
  /** G-code responses received via WebSocket */
  wsResponses: string[];
  /** Clear WebSocket responses */
  clearWsResponses: () => void;
}

const MAX_HISTORY = 200;

export function useGcode(): GcodeValue {
  const { client, ws } = useMoonraker();
  const [history, setHistory] = useState<GcodeHistoryEntry[]>([]);
  const [lastResponse, setLastResponse] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [wsResponses, setWsResponses] = useState<string[]>([]);

  // Listen for G-code responses from WebSocket
  useEffect(() => {
    const handler = (data: any) => {
      if (typeof data === 'string') {
        setWsResponses((prev) => [...prev.slice(-MAX_HISTORY), data]);
      }
    };
    ws.on('gcode_response', handler);
    return () => {
      ws.off('gcode_response', handler);
    };
  }, [ws]);

  const sendGcode = useCallback(
    async (command: string): Promise<string | null> => {
      setIsSending(true);
      try {
        const result = await client.sendGcode(command);
        const response: string | null = result.success
          ? 'ok'
          : (result.error ?? null);
        const entry: GcodeHistoryEntry = {
          command,
          response,
          timestamp: Date.now(),
          success: result.success,
        };
        setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY));
        setLastResponse(response);
        return response;
      } catch (err: any) {
        const entry: GcodeHistoryEntry = {
          command,
          response: err?.message ?? 'Send failed',
          timestamp: Date.now(),
          success: false,
        };
        setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY));
        setLastResponse(null);
        return null;
      } finally {
        setIsSending(false);
      }
    },
    [client],
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    setLastResponse(null);
  }, []);

  const clearWsResponses = useCallback(() => {
    setWsResponses([]);
  }, []);

  return {
    sendGcode,
    history,
    lastResponse,
    isSending,
    clearHistory,
    wsResponses,
    clearWsResponses,
  };
}
