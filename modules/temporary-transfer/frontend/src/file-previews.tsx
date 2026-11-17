import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  File,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Film,
  Headphones,
  Presentation,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export type FileEntry = {
  id?: string;
  name: string;
  file?: File | undefined;
  description?: string | undefined;
};
type FileKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "code"
  | "text"
  | "sheet"
  | "slides"
  | "document"
  | "archive"
  | "file";
const sizeLabel = (n: number) =>
  n < 1024 ** 2
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1024 ** 2).toFixed(1)} MB`;

export function fileType(entry: FileEntry): FileKind {
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = entry.file?.type ?? "";
  if (
    /^(svg|html?|xml|js|jsx|ts|tsx|json|py|css|scss|sh|sql|yaml|yml)$/.test(ext)
  )
    return "code";
  if (
    /^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(mime) ||
    /^(png|jpe?g|webp|gif|avif|bmp)$/.test(ext)
  )
    return "image";
  if (mime.startsWith("video/") || /^(mp4|webm|mov|m4v|mkv)$/.test(ext))
    return "video";
  if (mime.startsWith("audio/") || /^(mp3|wav|ogg|m4a|aac|flac)$/.test(ext))
    return "audio";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("text/") || /^(txt|md|csv|tsv|log|ini)$/.test(ext))
    return "text";
  if (/^(xlsx?|ods|numbers)$/.test(ext)) return "sheet";
  if (/^(pptx?|odp|key)$/.test(ext)) return "slides";
  if (/^(docx?|odt|rtf|pages)$/.test(ext)) return "document";
  if (/^(zip|rar|7z|tar|gz|bz2|xz)$/.test(ext)) return "archive";
  return "file";
}

const icons = {
  image: FileImage,
  video: Film,
  audio: Headphones,
  pdf: FileText,
  code: FileCode2,
  text: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  document: FileText,
  archive: FileArchive,
  file: File,
};
const typeNames = {
  image: "图片",
  video: "视频",
  audio: "音频",
  pdf: "PDF 文档",
  code: "代码",
  text: "文本",
  sheet: "电子表格",
  slides: "演示文稿",
  document: "文档",
  archive: "压缩包",
  file: "文件",
};

export function fileIcon(entry: FileEntry) {
  return icons[fileType(entry)];
}

function useObjectUrl(file?: File, mime?: string) {
  const [value, setValue] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!file) {
      setValue(null);
      return;
    }
    const url = URL.createObjectURL(
      mime ? new Blob([file], { type: mime }) : file,
    );
    setValue({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file, mime]);
  return value?.file === file ? value?.url : undefined;
}

function ImageThumbnail({ file, name }: { file: File; name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const mime = (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      avif: "image/avif",
      bmp: "image/bmp",
    } as Record<string, string>
  )[ext];
  const url = useObjectUrl(file, mime);
  const [failed, setFailed] = useState(false);
  return failed ? (
    <FileImage className="text-muted-foreground" />
  ) : url ? (
    <img src={url} alt={name} onError={() => setFailed(true)} />
  ) : (
    <Skeleton className="size-full" />
  );
}

function FileAttachment({
  entry,
  index,
  onPreview,
  onRemove,
  onDownload,
  state,
  disabled,
  compact = false,
}: {
  entry: FileEntry;
  index: number;
  onPreview?: ((entry: FileEntry) => void) | undefined;
  onRemove?: ((index: number) => void) | undefined;
  onDownload?: ((index: number) => void) | undefined;
  state: "idle" | "uploading" | "error" | "done";
  disabled?: boolean;
  compact?: boolean;
}) {
  const kind = fileType(entry);
  const isImage = kind === "image" && !!entry.file;
  const verticalImage = isImage && !compact;
  const Icon = icons[kind];
  const description = [
    entry.name.includes(".")
      ? entry.name.split(".").pop()?.toUpperCase()
      : typeNames[kind],
    entry.file
      ? [sizeLabel(entry.file.size), entry.description]
          .filter(Boolean)
          .join(" · ")
      : entry.description
        ? sizeLabel(Number(entry.description))
        : "附件",
  ].join(" · ");
  return (
    <Attachment
      orientation={verticalImage ? "vertical" : "horizontal"}
      state={state}
      className={verticalImage ? "w-36" : "w-full flex-nowrap"}
    >
      <AttachmentMedia variant={isImage ? "image" : "icon"}>
        {isImage ? (
          <ImageThumbnail file={entry.file!} name={entry.name} />
        ) : (
          <Icon />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle title={entry.name}>{entry.name}</AttachmentTitle>
        <AttachmentDescription>{description}</AttachmentDescription>
      </AttachmentContent>
      {onPreview && (
        <AttachmentTrigger
          disabled={disabled}
          aria-label={`预览 ${entry.name}`}
          onClick={() => onPreview(entry)}
        />
      )}
      <AttachmentActions>
        {onRemove && (
          <AttachmentAction
            variant={verticalImage ? "secondary" : "ghost"}
            disabled={disabled}
            aria-label={`移除 ${entry.name}`}
            onClick={() => onRemove(index)}
          >
            <X />
          </AttachmentAction>
        )}
        {onDownload && (
          <AttachmentAction
            variant={verticalImage ? "secondary" : "ghost"}
            disabled={disabled}
            aria-label={`下载 ${entry.name}`}
            onClick={() => onDownload(index)}
          >
            <ArrowDownToLine />
          </AttachmentAction>
        )}
      </AttachmentActions>
    </Attachment>
  );
}

export function FileAttachments({
  entries,
  onPreview,
  onRemove,
  onDownload,
  state = "done",
  disabled = false,
  compact = false,
}: {
  entries: FileEntry[];
  onPreview?: ((entry: FileEntry) => void) | undefined;
  onRemove?: ((index: number) => void) | undefined;
  onDownload?: ((index: number) => void) | undefined;
  state?: "idle" | "uploading" | "error" | "done";
  disabled?: boolean;
  compact?: boolean;
}) {
  if (compact)
    return (
      <div className="flex min-w-0 flex-col gap-2">
        {entries.map((entry, index) => (
          <FileAttachment
            key={`${entry.name}-${index}`}
            {...{
              entry,
              index,
              onPreview,
              onRemove,
              onDownload,
              state,
              disabled,
              compact,
            }}
          />
        ))}
      </div>
    );
  const images = entries
    .map((entry, index) => ({ entry, index }))
    .filter((x) => fileType(x.entry) === "image" && x.entry.file);
  const others = entries
    .map((entry, index) => ({ entry, index }))
    .filter((x) => !(fileType(x.entry) === "image" && x.entry.file));
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {images.length > 0 && (
        <AttachmentGroup role="group" aria-label="图片附件" tabIndex={0}>
          {images.map(({ entry, index }) => (
            <FileAttachment
              key={`${entry.name}-${index}`}
              {...{
                entry,
                index,
                onPreview,
                onRemove,
                onDownload,
                state,
                disabled,
              }}
            />
          ))}
        </AttachmentGroup>
      )}
      {others.map(({ entry, index }) => (
        <FileAttachment
          key={`${entry.name}-${index}`}
          {...{
            entry,
            index,
            onPreview,
            onRemove,
            onDownload,
            state,
            disabled,
          }}
        />
      ))}
    </div>
  );
}

export function FilePreview({ entry }: { entry: FileEntry }) {
  const kind = fileType(entry);
  const Icon = icons[kind];
  const file = entry.file;
  const url = useObjectUrl(
    file,
    kind === "pdf" ? "application/pdf" : undefined,
  );
  const [text, setText] = useState<{ file: File; value: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    if (file && (kind === "code" || kind === "text")) {
      file
        .slice(0, 64 * 1024)
        .text()
        .then((value) => {
          if (active) setText({ file, value });
        })
        .catch(() => {
          if (active) setError("无法读取文本，可下载后查看。");
        });
    }
    return () => {
      active = false;
    };
  }, [file, kind]);
  return (
    <section
      className="flex min-w-0 flex-col gap-3"
      aria-label={`${entry.name}的预览`}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <h3 className="truncate text-sm font-medium" title={entry.name}>
            {entry.name}
          </h3>
        </div>
        <Badge variant="outline">{typeNames[kind]}</Badge>
      </div>
      {error ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>预览不可用</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : !file ? (
        <Alert>
          <Icon />
          <AlertTitle>{kind === "archive" ? "压缩包需下载后解压" : "此文件适合下载后查看"}</AlertTitle>
          <AlertDescription>
            {["sheet", "slides", "document"].includes(kind) ? "请使用对应的 Office 或文档应用打开。" : "保留原始文件，不在浏览器中执行或解压；请使用附件右侧按钮下载。"}
          </AlertDescription>
        </Alert>
      ) : kind === "image" ? (
        url ? (
          <div className="flex min-h-40 items-center justify-center rounded-lg border border-border bg-muted/30 p-3">
            <img
              className="max-h-80 max-w-full rounded-md object-contain"
              src={url}
              alt={entry.name}
              onError={() =>
                setError("图片格式不受支持或文件已损坏，可下载后查看。")
              }
            />
          </div>
        ) : (
          <Skeleton className="h-52 w-full" />
        )
      ) : kind === "video" ? (
        url && (
          <video
            src={url}
            controls
            playsInline
            preload="metadata"
            className="max-h-80 w-full rounded-lg border border-border bg-muted"
            onError={() => setError("当前浏览器无法播放该视频，可下载后查看。")}
          />
        )
      ) : kind === "audio" ? (
        url && (
          <audio
            src={url}
            controls
            preload="metadata"
            className="w-full"
            onError={() => setError("当前浏览器无法播放该音频，可下载后查看。")}
          />
        )
      ) : kind === "pdf" ? (
        url && (
          <>
            <object
              data={url}
              type="application/pdf"
              aria-label={`${entry.name} PDF 预览`}
              className="h-80 w-full rounded-lg border border-border"
            >
              <p className="p-4 text-xs text-muted-foreground">
                当前浏览器无法内嵌 PDF，请下载后查看。
              </p>
            </object>
            <p className="text-xs text-muted-foreground">
              如 PDF 未显示，可使用附件的下载按钮查看。
            </p>
          </>
        )
      ) : kind === "text" || kind === "code" ? (
        text?.file === file ? (
          <>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-4 font-mono text-xs leading-relaxed">
              {text.value || "（空文件）"}
            </pre>
            {(file.size > 64 * 1024 ||
              Number(entry.description) > 64 * 1024) && (
              <p className="text-xs text-muted-foreground">
                仅预览前 64 KB，完整内容请下载查看。
              </p>
            )}
          </>
        ) : (
          <Skeleton className="h-40 w-full" />
        )
      ) : (
        <Alert>
          <Icon />
          <AlertTitle>
            {kind === "archive" ? "压缩包需下载后解压" : "此文件适合下载后查看"}
          </AlertTitle>
          <AlertDescription>
            {kind === "sheet" || kind === "slides" || kind === "document"
              ? "请使用对应的 Office 或文档应用打开。"
              : "保留原始文件，不在浏览器中执行或解压。"}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
