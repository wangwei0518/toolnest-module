import { useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "./components/ui/input-otp";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { FieldDescription, FieldError } from "./components/ui/field";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { Receiver } from "./receiver";

import "./guest.css";

type Result = {
  id: string;
  title: string;
  content: string | null;
  expiresAt: number;
  files: Array<{ id: string; filename: string; size: number }>;
};
const id =
  (import.meta.env.DEV
    ? new URLSearchParams(location.search).get("id")
    : null) ??
  location.pathname.split("/").filter(Boolean).at(-1) ??
  "";
const base = `/api/v1/modules/temporary-transfer/public/${encodeURIComponent(id)}`;

function GuestPage() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function request<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
      cache: "no-store",
    });
    const data: unknown = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data === "object" &&
        data &&
        "message" in data &&
        typeof data.message === "string"
          ? data.message
          : "请求失败，请重试。",
      );
    return data as T;
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResult({ ...(await request<Result>(`${base}/verify`)), id });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法打开投递。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="tn-guest">
      <div className="tn-guest__shell">
        <div className="tn-guest__brand">ToolNest</div>
        <Card>
          <CardHeader>
            <CardTitle>{result ? "你的投递已就绪" : "输入提取码"}</CardTitle>
            <CardDescription>
              {result
                ? "来自另一台设备的分享。"
                : "发送者与你分享了一份投递，验证后查看内容。"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!result ? (
              <form
                onSubmit={(event) => void verify(event)}
                className="flex flex-col gap-4"
              >
                <Field data-invalid={!!error}>
                  <FieldLabel htmlFor="guest-code" className="justify-center">
                    6 位提取码
                  </FieldLabel>
                  <InputOTP
                    nonce={document.querySelector<HTMLMetaElement>('meta[name="toolnest-csp-nonce"]')?.content ?? ""}
                id="guest-code"
                    maxLength={6}
                    pattern={REGEXP_ONLY_DIGITS}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(v) => {
                      setCode(v);
                      setError("");
                    }}
                    pasteTransformer={(v) => v.replace(/\D/g, "")}
                    aria-invalid={!!error}
                    aria-describedby={error ? "guest-error" : "guest-help"}
                    containerClassName="mx-auto w-full max-w-72 justify-center"
                  >
                    <InputOTPGroup className="min-w-0 flex-1">
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <InputOTPSlot
                          key={i}
                          index={i}
                          className="h-9 flex-1"
                          aria-invalid={!!error}
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                  <FieldDescription id="guest-help" className="text-center">
                    输入 6 位数字，支持整段粘贴。
                  </FieldDescription>
                  {error && (
                    <FieldError id="guest-error" className="text-center">
                      {error}
                    </FieldError>
                  )}
                </Field>
                <Button
                  type="submit"
                  size="lg"
                  disabled={busy || code.length !== 6}
                >
                  {busy ? "验证中…" : "验证并取件"}
                  <ArrowRight />
                </Button>
              </form>
            ) : (
              <Receiver
                key={result.id}
                result={result}
                authorize={(file) =>
                  request<{ url: string }>(
                    `${base}/files/${encodeURIComponent(file)}/download`,
                  )
                }
              />
            )}
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 shrink-0" />
              分享链接和二维码同样需要提取码。
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<GuestPage />);
