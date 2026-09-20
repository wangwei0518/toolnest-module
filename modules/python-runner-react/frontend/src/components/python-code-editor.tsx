import type * as Monaco from "monaco-editor/editor/editor.api";
import { Copy, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "./ui/button";

export function PythonCodeEditor({
  value,
  onChange,
  readOnly = false,
  minHeight = 360,
  title,
}: {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  minHeight?: number;
  title?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const syncingValueRef = useRef(false);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const readOnlyRef = useRef(readOnly);
  const [fullscreen, setFullscreen] = useState(false);

  valueRef.current = value;
  onChangeRef.current = onChange;
  readOnlyRef.current = readOnly;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let subscription: Monaco.IDisposable | undefined;
    void Promise.all([
      import("monaco-editor/editor/editor.api"),
      import("monaco-editor/editor/editor.worker?worker"),
      import("monaco-editor/languages/definitions/python/register"),
    ]).then(([monaco, workerModule]) => {
      if (disposed) return;
      const EditorWorker = workerModule.default;
      globalThis.MonacoEnvironment ??= {
        getWorker: (_workerId, _label) => new EditorWorker(),
      };
      const editor = monaco.editor.create(container, {
        value: valueRef.current,
        language: "python",
        theme: "vs-dark",
        automaticLayout: true,
        fontSize: 14,
        lineNumbers: "on",
        wordWrap: "on",
        tabSize: 4,
        insertSpaces: true,
        folding: true,
        minimap: { enabled: false },
        bracketPairColorization: { enabled: true },
        scrollBeyondLastLine: false,
        readOnly: readOnlyRef.current,
      });
      editorRef.current = editor;
      subscription = editor.onDidChangeModelContent(() => {
        if (!syncingValueRef.current) onChangeRef.current?.(editor.getValue());
      });
    });

    return () => {
      disposed = true;
      subscription?.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === value) return;
    syncingValueRef.current = true;
    editor.setValue(value);
    syncingValueRef.current = false;
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    requestAnimationFrame(() => editorRef.current?.layout());
  }, [fullscreen]);

  const copyCode = () => {
    void navigator.clipboard?.writeText(editorRef.current?.getValue() ?? value);
  };

  return (
    <div
      className={`tn-python-module__code-editor${fullscreen ? " is-fullscreen" : ""}`}
      data-testid="python-code-editor"
    >
      <div className="tn-python-module__code-editor-toolbar">
        <span>{title ?? (readOnly ? "只读代码" : "Python 编辑器")}</span>
        <div className="tn-python-module__actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="python-code-copy"
            aria-label="复制代码"
            onClick={copyCode}
          >
            <Copy data-icon="inline-start" aria-hidden="true" />
            复制代码
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="python-code-fullscreen"
            aria-label={fullscreen ? "退出全屏" : "全屏编辑"}
            onClick={() => setFullscreen((current) => !current)}
          >
            {fullscreen ? (
              <Minimize2 data-icon="inline-start" aria-hidden="true" />
            ) : (
              <Maximize2 data-icon="inline-start" aria-hidden="true" />
            )}
            {fullscreen ? "退出全屏" : "全屏编辑"}
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="tn-python-module__code-editor-surface"
        data-testid="python-code-editor-surface"
        style={{ minHeight: fullscreen ? 0 : minHeight }}
      />
    </div>
  );
}
