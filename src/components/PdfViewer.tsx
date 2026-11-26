import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, Loader2, Trash2, ZoomIn, ZoomOut } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface OverlaySignatureField {
  localId: string;
  signer_id: string;
  signer_name: string;
  signer_job_title?: string;
  action_type: string;
  page_number: number;
  x_percent: number;
  y_percent: number;
  width_percent: number;
  height_percent: number;
}

interface PdfViewerProps {
  fileSource: string | ArrayBuffer | Uint8Array | null;
  pageNumber?: number;
  onPageChange?: (page: number) => void;
  onNumPagesLoaded?: (numPages: number) => void;
  fields?: OverlaySignatureField[];
  editable?: boolean;
  selectedFieldId?: string | null;
  onSelectField?: (localId: string | null) => void;
  onUpdateField?: (localId: string, patch: Partial<OverlaySignatureField>) => void;
  onDeleteField?: (localId: string) => void;
  onDropNewField?: (pageNumber: number, xPercent: number, yPercent: number) => void;
  className?: string;
}

export function PdfViewer({
  fileSource,
  pageNumber: controlledPage,
  onPageChange,
  onNumPagesLoaded,
  fields = [],
  editable = false,
  selectedFieldId,
  onSelectField,
  onUpdateField,
  onDeleteField,
  onDropNewField,
  className = '',
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<any>(null);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [internalPage, setInternalPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const currentPage = controlledPage ?? internalPage;

  const setPage = (p: number) => {
    const clamped = Math.max(1, Math.min(numPages || 1, p));
    if (onPageChange) onPageChange(clamped);
    else setInternalPage(clamped);
  };

  // Load PDF document
  useEffect(() => {
    if (!fileSource) {
      setPdfDoc(null);
      setNumPages(0);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const sourceParam =
      fileSource instanceof Uint8Array
        ? { data: fileSource.slice() }
        : fileSource instanceof ArrayBuffer
        ? { data: new Uint8Array(fileSource.slice(0)) }
        : { url: fileSource };

    const loadingTask = pdfjsLib.getDocument(sourceParam);
    loadingTask.promise
      .then((doc) => {
        if (cancelled) {
          doc.cleanup();
          return;
        }
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        onNumPagesLoaded?.(doc.numPages);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'Gagal memuat file PDF.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [fileSource]);

  // Render current page
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let cancelled = false;
    const targetPage = Math.max(1, Math.min(pdfDoc.numPages, currentPage));

    pdfDoc.getPage(targetPage).then((page) => {
      if (cancelled || !canvasRef.current) return;

      const baseScale = 1.25 * zoom;
      const viewport = page.getViewport({ scale: baseScale });
      const outputScale = window.devicePixelRatio || 1;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      setCanvasSize({
        width: Math.floor(viewport.width),
        height: Math.floor(viewport.height),
      });

      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
      const task = page.render({
        canvas,
        canvasContext: ctx,
        transform,
        viewport,
      });
      renderTaskRef.current = task;

      task.promise.catch(() => {
        // Ignore cancelled render
      });
    });

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [pdfDoc, currentPage, zoom]);

  // Pointer drag/resize handling for signature boxes
  const dragStateRef = useRef<{
    mode: 'move' | 'resize';
    localId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  useEffect(() => {
    if (!editable) return;

    const handlePointerMove = (e: PointerEvent) => {
      const state = dragStateRef.current;
      const container = overlayRef.current;
      if (!state || !container || !onUpdateField) return;

      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const dxPercent = ((e.clientX - state.startX) / rect.width) * 100;
      const dyPercent = ((e.clientY - state.startY) / rect.height) * 100;

      if (state.mode === 'move') {
        const nextX = Math.max(0, Math.min(100 - state.origW, state.origX + dxPercent));
        const nextY = Math.max(0, Math.min(100 - state.origH, state.origY + dyPercent));
        onUpdateField(state.localId, {
          x_percent: Number(nextX.toFixed(2)),
          y_percent: Number(nextY.toFixed(2)),
        });
      } else {
        const nextW = Math.max(10, Math.min(100 - state.origX, state.origW + dxPercent));
        const nextH = Math.max(6, Math.min(100 - state.origY, state.origH + dyPercent));
        onUpdateField(state.localId, {
          width_percent: Number(nextW.toFixed(2)),
          height_percent: Number(nextH.toFixed(2)),
        });
      }
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [editable, onUpdateField]);

  const pageFields = fields.filter((f) => f.page_number === currentPage);

  return (
    <div className={`flex flex-col rounded-lg border border-slate-200 bg-slate-100 overflow-hidden ${className}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPage(currentPage - 1)}
            disabled={currentPage <= 1 || !numPages}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            aria-label="Halaman sebelumnya"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-2 text-xs font-medium text-slate-700 tabular-nums whitespace-nowrap">
            Halaman {numPages ? currentPage : 0} / {numPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(currentPage + 1)}
            disabled={currentPage >= numPages || !numPages}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            aria-label="Halaman berikutnya"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.15).toFixed(2))))}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 text-slate-700 hover:bg-slate-50"
            aria-label="Perkecil"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-12 text-center text-xs font-mono text-slate-700 tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2, Number((z + 0.15).toFixed(2))))}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 text-slate-700 hover:bg-slate-50"
            aria-label="Perbesar"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Viewport */}
      <div className="relative flex-1 overflow-auto p-4 sm:p-6 flex justify-center items-start min-h-[460px] max-h-[75vh]">
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin text-[#1755CE]" />
            <span className="mt-2 text-sm">Memuat dokumen PDF...</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-white p-4 text-sm text-[#DC2626]">
            {error}
          </div>
        )}

        {!loading && !error && fileSource && (
          <div
            ref={overlayRef}
            className="relative bg-white shadow-md border border-slate-300 select-none"
            style={{
              width: canvasSize.width || 'auto',
              height: canvasSize.height || 'auto',
            }}
            onDragOver={(e) => {
              if (editable && onDropNewField) {
                e.preventDefault();
              }
            }}
            onDrop={(e) => {
              if (!editable || !onDropNewField || !overlayRef.current) return;
              e.preventDefault();
              const rect = overlayRef.current.getBoundingClientRect();
              const xPct = Math.max(0, Math.min(76, ((e.clientX - rect.left) / rect.width) * 100 - 10));
              const yPct = Math.max(0, Math.min(88, ((e.clientY - rect.top) / rect.height) * 100 - 5));
              onDropNewField(currentPage, Number(xPct.toFixed(2)), Number(yPct.toFixed(2)));
            }}
            onClick={() => editable && onSelectField?.(null)}
          >
            <canvas ref={canvasRef} className="block" />

            {/* Signature Field Overlays */}
            {pageFields.map((field) => {
              const isSelected = selectedFieldId === field.localId;
              return (
                <div
                  key={field.localId}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectField?.(field.localId);
                  }}
                  onPointerDown={(e) => {
                    if (!editable) return;
                    e.stopPropagation();
                    onSelectField?.(field.localId);
                    dragStateRef.current = {
                      mode: 'move',
                      localId: field.localId,
                      startX: e.clientX,
                      startY: e.clientY,
                      origX: field.x_percent,
                      origY: field.y_percent,
                      origW: field.width_percent,
                      origH: field.height_percent,
                    };
                  }}
                  style={{
                    left: `${field.x_percent}%`,
                    top: `${field.y_percent}%`,
                    width: `${field.width_percent}%`,
                    height: `${field.height_percent}%`,
                  }}
                  className={`absolute flex flex-col justify-between rounded border p-1.5 transition-shadow ${
                    editable ? 'cursor-move' : ''
                  } ${
                    isSelected
                      ? 'border-[#1755CE] bg-[#1755CE]/12 ring-2 ring-[#1755CE]/30'
                      : 'border-[#1755CE]/70 bg-blue-50/85'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1 overflow-hidden">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[#163A70] truncate">
                      {field.action_type === 'sign'
                        ? 'Tanda Tangan'
                        : field.action_type === 'approve'
                        ? 'Persetujuan'
                        : 'Review'}
                    </span>
                    {editable && onDeleteField && (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteField(field.localId);
                        }}
                        className="rounded p-0.5 text-slate-500 hover:bg-red-50 hover:text-[#DC2626]"
                        aria-label="Hapus kotak tanda tangan"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-[11px] font-semibold text-slate-900 truncate leading-tight">
                      {field.signer_name}
                    </p>
                    {field.signer_job_title && (
                      <p className="text-[9px] text-slate-600 truncate leading-tight">
                        {field.signer_job_title}
                      </p>
                    )}
                  </div>

                  {editable && (
                    <div
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        dragStateRef.current = {
                          mode: 'resize',
                          localId: field.localId,
                          startX: e.clientX,
                          startY: e.clientY,
                          origX: field.x_percent,
                          origY: field.y_percent,
                          origW: field.width_percent,
                          origH: field.height_percent,
                        };
                      }}
                      className="absolute bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize rounded-tl bg-[#1755CE]"
                      title="Seret untuk mengubah ukuran"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
