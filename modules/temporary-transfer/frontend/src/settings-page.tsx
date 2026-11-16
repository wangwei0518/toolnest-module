import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, type Settings } from "./api/transfer";

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [accountId, setAccountId] = useState("");
  const [bucket, setBucket] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.settings().then((result) => {
      if (!active) return;
      setSettings(result); setAccountId(result.r2.accountId ?? ""); setBucket(result.r2.bucket ?? "");
    }).catch(() => { if (active) setError("读取设置失败，请刷新重试。"); });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || busy) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const result = await api.saveSettings({ ...settings, r2: { accountId, bucket, accessKeyId, secretAccessKey } });
      setSettings(result); setAccessKeyId(""); setSecretAccessKey(""); setMessage("设置已保存。");
    } catch { setError("保存失败，请检查配置、期限与容量后重试。"); }
    finally { setBusy(false); }
  }

  if (!settings) return <p role="status">{error || "正在读取设置…"}</p>;
  const setNumber = (key: "defaultHours" | "maxHours" | "maxFileBytes" | "maxTotalBytes" | "maxConcurrentUploads" | "maxGrantsAllowed", value: string, unit = 1) => {
    setSettings({ ...settings, [key]: Number(value) * unit });
  };
  return <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
    <Card><CardHeader><CardTitle>R2 存储</CardTitle><CardDescription>文件直接传至私有存储桶。凭证保存在模块运行数据中，保存后不会回显。</CardDescription></CardHeader>
      <CardContent><FieldGroup>
        <Field><FieldLabel htmlFor="r2-account">Cloudflare 账号 ID</FieldLabel><Input id="r2-account" value={accountId} onChange={(event) => setAccountId(event.target.value)} required /></Field>
        <Field><FieldLabel htmlFor="r2-bucket">存储桶名称</FieldLabel><Input id="r2-bucket" value={bucket} onChange={(event) => setBucket(event.target.value)} required /></Field>
        <Field><FieldLabel htmlFor="r2-access">Access Key ID</FieldLabel><Input id="r2-access" value={accessKeyId} autoComplete="off" onChange={(event) => setAccessKeyId(event.target.value)} placeholder={settings.r2.configured ? "已配置，留空保持不变" : "输入 R2 专用访问密钥"} required={!settings.r2.configured} /></Field>
        <Field><FieldLabel htmlFor="r2-secret">Secret Access Key</FieldLabel><Input id="r2-secret" type="password" value={secretAccessKey} autoComplete="new-password" onChange={(event) => setSecretAccessKey(event.target.value)} placeholder={settings.r2.configured ? "已配置，留空保持不变" : "输入 R2 专用密钥"} required={!settings.r2.configured} /><FieldDescription>建议使用仅限此存储桶的对象读写权限。</FieldDescription></Field>
      </FieldGroup></CardContent>
    </Card>
    <Card><CardHeader><CardTitle>暂存限制</CardTitle><CardDescription>可调整默认期限、容量和上传并发。</CardDescription></CardHeader>
      <CardContent><FieldGroup>
        <Field><FieldLabel htmlFor="default-hours">默认期限（小时）</FieldLabel><Input id="default-hours" type="number" min="1" max="720" value={settings.defaultHours} onChange={(event) => setNumber("defaultHours", event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="max-hours">最长期限（小时）</FieldLabel><Input id="max-hours" type="number" min="1" max="720" value={settings.maxHours} onChange={(event) => setNumber("maxHours", event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="file-limit">单文件上限（MiB）</FieldLabel><Input id="file-limit" type="number" min="1" max="5120" value={settings.maxFileBytes / 1048576} onChange={(event) => setNumber("maxFileBytes", event.target.value, 1048576)} /></Field>
        <Field><FieldLabel htmlFor="total-limit">总容量（MiB）</FieldLabel><Input id="total-limit" type="number" min="1" value={settings.maxTotalBytes / 1048576} onChange={(event) => setNumber("maxTotalBytes", event.target.value, 1048576)} /></Field>
        <Field><FieldLabel htmlFor="upload-concurrency">上传并发</FieldLabel><Input id="upload-concurrency" type="number" min="1" max="8" value={settings.maxConcurrentUploads} onChange={(event) => setNumber("maxConcurrentUploads", event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="default-grants">默认下载授权次数</FieldLabel><Input id="default-grants" type="number" min="1" max={settings.maxGrantsAllowed} value={settings.defaultMaxGrants ?? ""} onChange={(event) => setSettings({ ...settings, defaultMaxGrants: event.target.value ? Number(event.target.value) : null })} /><FieldDescription>留空表示默认不限制次数。</FieldDescription></Field>
        <Field><FieldLabel htmlFor="max-grants">可设置的最大下载授权次数</FieldLabel><Input id="max-grants" type="number" min="1" max="10000" value={settings.maxGrantsAllowed} onChange={(event) => setNumber("maxGrantsAllowed", event.target.value)} /></Field>
      </FieldGroup></CardContent>
    </Card>
    {error && <p role="alert" className="text-destructive">{error}</p>}{message && <p role="status">{message}</p>}
    <Button type="submit" className="w-fit" disabled={busy}>{busy ? "保存中…" : "保存设置"}</Button>
  </form>;
}
