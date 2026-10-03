import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Excalidraw,
  CaptureUpdateAction,
  convertToExcalidrawElements,
  exportToBlob,
  getSceneVersion,
} from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import '@excalidraw/excalidraw/index.css';
import type { DiagramScene } from '../lib/types';
import { registerDiagramFlush, trackDiagramSave } from '../lib/diagramFlush';
import { useTheme } from '../lib/theme';

interface Props {
  initialScene: DiagramScene | null;
  onChange?: (scene: DiagramScene, png: string | null) => void;
  readOnly?: boolean;
  height?: number;
}

const SAVE_DEBOUNCE_MS = 1500;

const TABLE_TEMPLATE = 'table_name\n────────────────\nPK  id\nFK  other_id\n    column_name';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Scenes are candidate-controlled and opened in the admin's browser. Keep only embedded images that are
 * inline raster data URLs, so a `dataURL` pointing at a remote host is never fetched.
 */
function safeFiles(files: DiagramScene['files']): BinaryFiles {
  const out: Record<string, unknown> = {};
  for (const [id, f] of Object.entries(files ?? {})) {
    const url = (f as { dataURL?: unknown } | null)?.dataURL;
    if (typeof url === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(url)) out[id] = f;
  }
  return out as BinaryFiles;
}

export default function DiagramEditor({ initialScene, onChange, readOnly = false, height = 560 }: Props) {
  const { theme } = useTheme();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const lastVersion = useRef<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Latest scene seen in onChange. emit() must read this, not the imperative API: on unmount Excalidraw
  // swaps in an empty Scene (and files = {}) *before* our effect cleanup runs, so querying the API there
  // would save an empty diagram over the candidate's real one.
  const latest = useRef<{ elements: readonly ExcalidrawElement[]; files: BinaryFiles } | null>(null);

  const emit = useCallback((): Promise<void> => {
    const snap = latest.current;
    if (!snap) return Promise.resolve();
    const elements = snap.elements.filter((el) => !el.isDeleted);
    const files = snap.files;
    return trackDiagramSave((async () => {
      const scene: DiagramScene = {
        elements: elements as unknown as Record<string, unknown>[],
        appState: { viewBackgroundColor: '#ffffff' },
        files: files as unknown as Record<string, unknown>,
      };
      let png: string | null = null;
      if (elements.length > 0) {
        try {
          const blob = await exportToBlob({
            elements,
            files,
            appState: { exportBackground: true, viewBackgroundColor: '#ffffff' },
            mimeType: 'image/png',
            exportPadding: 24,
            maxWidthOrHeight: 1800,
          });
          png = await blobToDataUrl(blob);
        } catch {
          png = null;
        }
      }
      onChangeRef.current?.(scene, png);
    })());
  }, []);

  // Emit a pending debounced change now (unmount, Save & exit, submit).
  const flushPending = useCallback(async () => {
    if (timer.current === undefined) return;
    window.clearTimeout(timer.current);
    timer.current = undefined;
    await emit();
  }, [emit]);

  useEffect(() => {
    if (readOnly) return;
    registerDiagramFlush(flushPending);
    return () => {
      registerDiagramFlush(null);
      void flushPending(); // e.g. switching question within the debounce window
    };
  }, [flushPending, readOnly]);

  const handleChange = (elements: readonly ExcalidrawElement[], _appState: unknown, files: BinaryFiles) => {
    if (readOnly) return;
    latest.current = { elements, files };
    const version = getSceneVersion(elements);
    if (lastVersion.current === null) {
      lastVersion.current = version; // initial render
      return;
    }
    if (version === lastVersion.current) return; // pointer moves, selection etc.
    lastVersion.current = version;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      void emit();
    }, SAVE_DEBOUNCE_MS);
  };

  const insertTable = () => {
    if (!api) return;
    const st = api.getAppState();
    const zoom = st.zoom.value;
    const offset = (api.getSceneElements().length % 5) * 30;
    const x = -st.scrollX + st.width / 2 / zoom - 130 + offset;
    const y = -st.scrollY + st.height / 2 / zoom - 80 + offset;
    const els = convertToExcalidrawElements([
      {
        type: 'rectangle',
        x,
        y,
        width: 260,
        height: 160,
        strokeColor: '#1e1e1e',
        backgroundColor: '#e7f5ff',
        fillStyle: 'solid',
        roundness: null,
        label: { text: TABLE_TEMPLATE, textAlign: 'left', verticalAlign: 'top', fontSize: 16 },
      },
    ]);
    api.updateScene({ elements: [...api.getSceneElements(), ...els], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    api.setActiveTool({ type: 'selection' });
  };

  return (
    <div
      className={
        fullscreen
          ? 'fixed inset-0 z-50 flex flex-col bg-surface p-3'
          : 'flex flex-col overflow-hidden rounded-lg border border-slate-300 bg-surface'
      }
    >
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
          <button
            type="button"
            onClick={insertTable}
            className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            + Insert table
          </button>
          <span className="text-xs text-slate-500">
            Double-click a box to edit its text · use the arrow tool (A) to connect tables · label relationships e.g. “1 : N”
          </span>
          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
            className="ml-auto rounded px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
          >
            {fullscreen ? '✕ Exit full screen' : '⛶ Full screen'}
          </button>
        </div>
      )}
      <div style={fullscreen ? { flex: 1 } : { height }}>
        <Excalidraw
          excalidrawAPI={setApi}
          theme={theme}
          initialData={{
            elements: (initialScene?.elements ?? []) as never,
            files: safeFiles(initialScene?.files),
            appState: { viewBackgroundColor: '#ffffff', currentItemFontFamily: 2 as never },
            scrollToContent: true,
          }}
          onChange={handleChange}
          viewModeEnabled={readOnly}
          UIOptions={{
            canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: !readOnly, toggleTheme: false },
            tools: { image: false },
          }}
        />
      </div>
    </div>
  );
}
