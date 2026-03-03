/**
 * useFiles — G-code file management.
 *
 * List, search, upload, delete, and get metadata for files stored
 * in Moonraker's virtual SD card.
 *
 * Usage:
 *   const { files, refresh, uploadFile, startPrint } = useFiles();
 */
import { useState, useCallback, useEffect } from 'react';
import { useMoonraker } from './MoonrakerProvider';
import type { GcodeFile, GcodeFileMetadata } from '../api/types';

export interface FilesValue {
  /** List of G-code files */
  files: GcodeFile[];
  /** Whether files are being loaded */
  isLoading: boolean;
  /** Error message */
  error: string | null;

  // ─── Actions ──────────────────────────────────────
  /** Refresh file list */
  refresh: () => Promise<void>;
  /** Get file metadata */
  getMetadata: (filename: string) => Promise<GcodeFileMetadata | null>;
  /** Upload a G-code file */
  uploadFile: (file: File, startAfterUpload?: boolean) => Promise<boolean>;
  /** Delete a file */
  deleteFile: (filename: string) => Promise<boolean>;
  /** Start printing a file */
  startPrint: (filename: string) => Promise<void>;

  // ─── Search / Filter ──────────────────────────────
  /** Search files by name */
  searchFiles: (query: string) => GcodeFile[];
  /** Sort files by date (newest first) */
  sortedByDate: GcodeFile[];
  /** Sort files by name */
  sortedByName: GcodeFile[];
  /** Total size of all files */
  totalSize: number;
}

export function useFiles(): FilesValue {
  const { client } = useMoonraker();
  const [files, setFiles] = useState<GcodeFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await client.listFiles();
      if (result.success && result.data) {
        setFiles(result.data);
      } else {
        setError(result.error ?? 'Failed to load files');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load files');
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  // Load files on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  const getMetadata = useCallback(
    async (filename: string): Promise<GcodeFileMetadata | null> => {
      const result = await client.getFileMetadata(filename);
      return result.success ? result.data ?? null : null;
    },
    [client],
  );

  const uploadFile = useCallback(
    async (file: File, startAfterUpload = false): Promise<boolean> => {
      const result = await client.uploadFile(file, file.name);
      if (result.success) {
        // Refresh list after upload
        await refresh();
        if (startAfterUpload) {
          await client.startPrint(file.name);
        }
        return true;
      }
      return false;
    },
    [client, refresh],
  );

  const deleteFile = useCallback(
    async (filename: string): Promise<boolean> => {
      const result = await client.deleteFile(filename);
      if (result.success) {
        // Remove from local state immediately
        setFiles((prev) => prev.filter((f) => f.filename !== filename));
        return true;
      }
      return false;
    },
    [client],
  );

  const startPrint = useCallback(
    async (filename: string) => {
      await client.startPrint(filename);
    },
    [client],
  );

  const searchFiles = useCallback(
    (query: string): GcodeFile[] => {
      const q = query.toLowerCase();
      return files.filter((f) => f.filename.toLowerCase().includes(q));
    },
    [files],
  );

  const sortedByDate: GcodeFile[] = [...files].sort(
    (a, b) => b.modified - a.modified,
  );

  const sortedByName: GcodeFile[] = [...files].sort((a, b) =>
    a.filename.localeCompare(b.filename),
  );

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return {
    files,
    isLoading,
    error,
    refresh,
    getMetadata,
    uploadFile,
    deleteFile,
    startPrint,
    searchFiles,
    sortedByDate,
    sortedByName,
    totalSize,
  };
}
