"use client";

/* eslint-disable react-hooks/set-state-in-effect -- restore device-local appearance after hydration. */

import { CSSProperties, useEffect, useRef, useState } from "react";
import { Check, ImagePlus, LoaderCircle, Palette, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";

const STORAGE_KEY = "maku-watch.appearance.v1";
const DEFAULT_IMAGE = "/backgrounds/twilight.webp";
const DEFAULTS = { image: DEFAULT_IMAGE, dim: 42, blur: 0 };
type Preferences = typeof DEFAULTS;

function safeImage(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === "" || value === DEFAULT_IMAGE) return true;
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

export function useAppearance() {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || !safeImage(saved.image)) return;
      // Browser storage is untrusted; reject invalid controls and old schemas.
      if (!Number.isFinite(saved.dim) || !Number.isFinite(saved.blur)) return;
      setPreferences({ image: saved.image, dim: Math.max(20, Math.min(85, saved.dim)), blur: Math.max(0, Math.min(12, saved.blur)) });
    } catch { /* Default artwork remains usable with blocked or corrupt storage. */ }
  }, []);

  function update(next: Preferences, persist = true) {
    setPreferences(next);
    if (!persist) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      toast.error("背景已应用，但浏览器未能保存；刷新后可能恢复原设置。", { id: "appearance-storage" });
    }
  }

  const style = {
    "--wallpaper": preferences.image ? `url(${JSON.stringify(preferences.image)})` : "none",
    "--wallpaper-dim": preferences.dim / 100,
    "--wallpaper-blur": `${preferences.blur}px`,
  } as CSSProperties;
  return { preferences, update, style };
}

// Decode before applying a remote image. No server fetch or credentials involved.
function checkImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    const timer = window.setTimeout(() => { image.src = ""; reject(new Error("图片加载超时，请换一个链接。")); }, 12_000);
    image.onload = () => { window.clearTimeout(timer); resolve(); };
    image.onerror = () => { window.clearTimeout(timer); reject(new Error("无法加载这张图片，请使用可公开访问的图片直链。")); };
    image.src = url;
  });
}

async function prepareUpload(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("请选择 JPG、PNG 或 WebP 图片。");
  if (file.size > 10 * 1024 * 1024) throw new Error("图片不能超过 10 MB。");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理图片，请尝试图片链接。");
    context.fillStyle = "#121022";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", .82);
  } finally { bitmap.close(); }
}

export function AppearanceSettings({ appearance }: { appearance: ReturnType<typeof useAppearance> }) {
  const { preferences, update } = appearance;
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const preferencesRef = useRef(preferences);
  useEffect(() => { preferencesRef.current = preferences; }, [preferences]);
  useEffect(() => () => { requestId.current += 1; }, []);

  function choose(image: string) {
    requestId.current += 1;
    setBusy(false);
    setError("");
    update({ ...preferencesRef.current, image });
  }

  async function loadImage(load: () => Promise<string>) {
    const id = ++requestId.current;
    setBusy(true);
    setError("");
    try {
      const image = await load();
      if (id !== requestId.current) return;
      update({ ...preferencesRef.current, image });
      toast.success("新的观影背景已应用");
    } catch (cause) {
      if (id === requestId.current) setError(cause instanceof Error ? cause.message : "图片处理失败，请更换图片后重试。");
    } finally { if (id === requestId.current) setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={(value) => {
    setOpen(value);
    if (!value) { requestId.current += 1; setBusy(false); }
  }}>
    <DialogTrigger asChild><Button variant="ghost" size="icon" className="appearance-trigger" aria-label="更换背景" title="更换背景"><Palette size={19} /></Button></DialogTrigger>
    <DialogContent className="room-dialog appearance-dialog">
      <DialogHeader><span className="section-kicker">MAKE IT YOURS</span><DialogTitle>布置你的放映室</DialogTitle><DialogDescription>换一片喜欢的风景，陪你看完下一话。</DialogDescription></DialogHeader>
      <div className="appearance-preview" style={{ backgroundImage: preferences.image ? `linear-gradient(rgba(18,16,34,${preferences.dim / 100}), rgba(18,16,34,${preferences.dim / 100})), url(${JSON.stringify(preferences.image)})` : "none" }}><span><ImagePlus size={18} />你的专属观影背景</span></div>
      <div className="background-presets" aria-label="内置背景">
        <button type="button" className={`background-choice ${preferences.image === DEFAULT_IMAGE ? "selected" : ""}`} onClick={() => choose(DEFAULT_IMAGE)} aria-pressed={preferences.image === DEFAULT_IMAGE}><span className="background-swatch twilight-swatch" /><span>樱海暮色</span>{preferences.image === DEFAULT_IMAGE && <Check size={15} />}</button>
        <button type="button" className={`background-choice ${preferences.image === "" ? "selected" : ""}`} onClick={() => choose("")} aria-pressed={preferences.image === ""}><span className="background-swatch quiet-swatch" /><span>纯净夜色</span>{preferences.image === "" && <Check size={15} />}</button>
      </div>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void loadImage(() => prepareUpload(file));
      }} />
      <Button variant="outline" className="background-upload" onClick={() => fileInput.current?.click()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}上传自己的壁纸<span>JPG / PNG / WebP · ≤ 10 MB</span></Button>
      <form className="background-url-form" onSubmit={(event) => {
        event.preventDefault();
        void loadImage(async () => {
          const value = url.trim();
          if (!value.startsWith("https://") || !safeImage(value)) throw new Error("请输入 HTTPS 图片直链，不要使用网页地址。");
          await checkImage(value);
          return value;
        });
      }}>
        <label className="field-label" htmlFor="background-url">或粘贴图片链接</label>
        <div><Input id="background-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…/wallpaper.jpg" type="url" disabled={busy} /><Button type="submit" disabled={busy || !url.trim()}>应用</Button></div>
      </form>
      {error && <p className="background-error" role="alert">{error}</p>}
      <div className="appearance-sliders">
        <label htmlFor="background-dim">背景遮罩 <span>{preferences.dim}%</span></label>
        <Slider id="background-dim" aria-label="背景遮罩" min={20} max={85} step={1} value={[preferences.dim]} onValueChange={([dim]) => update({ ...preferences, dim }, false)} onValueCommit={([dim]) => update({ ...preferences, dim })} />
        <label htmlFor="background-blur">背景虚化 <span>{preferences.blur}px</span></label>
        <Slider id="background-blur" aria-label="背景虚化" min={0} max={12} step={1} value={[preferences.blur]} onValueChange={([blur]) => update({ ...preferences, blur }, false)} onValueCommit={([blur]) => update({ ...preferences, blur })} />
      </div>
      <div className="appearance-footer"><p>设置仅保存在此浏览器，不影响房间里的朋友；上传图片不发送到服务器。</p><Button variant="ghost" size="sm" onClick={() => { choose(DEFAULT_IMAGE); update(DEFAULTS); setUrl(""); }}><RotateCcw size={14} />恢复默认</Button></div>
    </DialogContent>
  </Dialog>;
}
