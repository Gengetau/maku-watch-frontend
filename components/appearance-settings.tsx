"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Check,
  ImagePlus,
  LoaderCircle,
  Palette,
  RotateCcw,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";

export type AccentTheme = "sakura" | "lavender" | "cyan" | "amber";

export type Preferences = {
  image: string;
  dim: number; // 15 - 85
  blur: number; // 0 - 24
  accent: AccentTheme;
};

export const DEFAULT_IMAGE = "/backgrounds/twilight.webp";
export const STORAGE_KEY_V2 = "maku-watch.appearance.v2";
export const STORAGE_KEY_V1 = "maku-watch.appearance.v1";

export const PRESET_BACKGROUNDS = [
  {
    id: "twilight",
    name: "樱海暮色",
    sub: "Sakura Twilight",
    url: DEFAULT_IMAGE,
    thumb: DEFAULT_IMAGE,
    description: "浪漫海岸暮色，伴随落樱与晚霞",
  },
  {
    id: "galaxy",
    name: "星海极光",
    sub: "Galactic Railway",
    url: "/backgrounds/galaxy.svg",
    thumb: "/backgrounds/galaxy.svg",
    description: "深邃银河与星座，漫游夜空星轨",
  },
  {
    id: "cyber",
    name: "赛博夜雨",
    sub: "Cyber Neon Rain",
    url: "/backgrounds/cyber-rain.svg",
    thumb: "/backgrounds/cyber-rain.svg",
    description: "雨夜霓虹都市，光影斑斓映幕",
  },
  {
    id: "summer",
    name: "晴空夏云",
    sub: "Summer Azure Skies",
    url: "/backgrounds/summer-clouds.svg",
    thumb: "/backgrounds/summer-clouds.svg",
    description: "蔚蓝天空与积雨云，阳光微风夏日",
  },
  {
    id: "midnight",
    name: "纯净深夜",
    sub: "Velvet Midnight",
    url: "",
    thumb: "",
    description: "沉浸暗黑极简，专注观影本身",
  },
] as const;

export const ACCENT_PALETTES: Record<
  AccentTheme,
  {
    name: string;
    primary: string;
    primaryForeground: string;
    ring: string;
    accentGlow: string;
  }
> = {
  sakura: {
    name: "樱粉",
    primary: "#ff7da7",
    primaryForeground: "#2c0b1a",
    ring: "#ff7da7",
    accentGlow: "rgba(255, 125, 167, 0.25)",
  },
  lavender: {
    name: "紫藤",
    primary: "#c084fc",
    primaryForeground: "#250d3a",
    ring: "#c084fc",
    accentGlow: "rgba(192, 132, 252, 0.25)",
  },
  cyan: {
    name: "青空",
    primary: "#38bdf8",
    primaryForeground: "#062233",
    ring: "#38bdf8",
    accentGlow: "rgba(56, 189, 248, 0.25)",
  },
  amber: {
    name: "落日",
    primary: "#fbbf24",
    primaryForeground: "#311c03",
    ring: "#fbbf24",
    accentGlow: "rgba(251, 191, 36, 0.25)",
  },
};

export const DEFAULTS: Preferences = {
  image: DEFAULT_IMAGE,
  dim: 42,
  blur: 0,
  accent: "sakura",
};

export function sanitizePreferences(raw: unknown): Preferences {
  if (!raw || typeof raw !== "object") return DEFAULTS;
  const candidate = raw as Partial<Preferences>;

  const image =
    typeof candidate.image === "string" ? candidate.image : DEFAULTS.image;

  const dim =
    typeof candidate.dim === "number" && Number.isFinite(candidate.dim)
      ? Math.max(15, Math.min(85, Math.round(candidate.dim)))
      : DEFAULTS.dim;

  const blur =
    typeof candidate.blur === "number" && Number.isFinite(candidate.blur)
      ? Math.max(0, Math.min(24, Math.round(candidate.blur)))
      : DEFAULTS.blur;

  const accent: AccentTheme =
    candidate.accent && candidate.accent in ACCENT_PALETTES
      ? candidate.accent
      : DEFAULTS.accent;

  return { image, dim, blur, accent };
}

function safeImageUrl(url: string): boolean {
  if (!url.startsWith("https://")) return false;
  try {
    const parsed = new URL(url);
    if (!["https:"].includes(parsed.protocol)) return false;
    return /\.(jpg|jpeg|png|webp|avif|gif)(\?.*)?$/i.test(parsed.pathname) ||
      parsed.searchParams.has("format") ||
      parsed.pathname.length > 5;
  } catch {
    return false;
  }
}

function verifyRemoteImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    const timer = window.setTimeout(() => {
      image.src = "";
      reject(new Error("图片加载超时，请确认该图片直链可公开访问。"));
    }, 12_000);

    image.onload = () => {
      window.clearTimeout(timer);
      resolve();
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("无法加载该图片，请检查链接是否为直接图片地址。"));
    };
    image.src = url;
  });
}

async function prepareUploadedImage(file: File): Promise<string> {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    throw new Error("请上传 JPG、PNG 或 WebP 格式的图片。");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("壁纸大小不能超过 10 MB。");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const maxDim = 1920;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("浏览器图像引擎初始化失败，请尝试使用图片直链。");
    }

    ctx.fillStyle = "#120e24";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    bitmap.close();
  }
}

export function useAppearance() {
  const [preferences, setPreferences] = useState<Preferences>(() => {
    if (typeof window === "undefined") return DEFAULTS;
    try {
      const savedV2 = localStorage.getItem(STORAGE_KEY_V2);
      if (savedV2) return sanitizePreferences(JSON.parse(savedV2));
      const savedV1 = localStorage.getItem(STORAGE_KEY_V1);
      if (savedV1) return sanitizePreferences(JSON.parse(savedV1));
    } catch {
      // Storage unavailable / blocked, keep defaults
    }
    return DEFAULTS;
  });

  const update = useCallback(
    (next: Preferences, persist = true) => {
      setPreferences(next);
      if (!persist) return;
      try {
        localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(next));
      } catch {
        toast.error("外观已更新，但本地存储已满或被浏览器拦截，刷新后可能会重置。", {
          id: "maku-appearance-storage-warning",
        });
      }
    },
    [],
  );

  const currentAccent = ACCENT_PALETTES[preferences.accent] ?? ACCENT_PALETTES.sakura;

  const style: CSSProperties = {
    "--wallpaper": preferences.image
      ? `url(${JSON.stringify(preferences.image)})`
      : "none",
    "--wallpaper-dim": `${preferences.dim / 100}`,
    "--wallpaper-blur": `${preferences.blur}px`,
    "--primary": currentAccent.primary,
    "--primary-foreground": currentAccent.primaryForeground,
    "--ring": currentAccent.ring,
    "--chart-1": currentAccent.primary,
    "--accent-glow": currentAccent.accentGlow,
  } as CSSProperties;

  return { preferences, update, style };
}

export function AppearanceSettings({
  appearance,
}: {
  appearance: ReturnType<typeof useAppearance>;
}) {
  const { preferences, update } = appearance;
  const [open, setOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const operationIdRef = useRef(0);
  const preferencesRef = useRef(preferences);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  const selectPreset = (imageUrl: string) => {
    operationIdRef.current += 1;
    setIsProcessing(false);
    setErrorMessage("");
    update({ ...preferencesRef.current, image: imageUrl });
  };

  const selectAccent = (accent: AccentTheme) => {
    update({ ...preferencesRef.current, accent });
  };

  const applyCustomImage = async (loader: () => Promise<string>) => {
    const opId = ++operationIdRef.current;
    setIsProcessing(true);
    setErrorMessage("");

    try {
      const dataUrl = await loader();
      if (opId !== operationIdRef.current) return;
      update({ ...preferencesRef.current, image: dataUrl });
      toast.success("专属壁纸已应用 ✨");
    } catch (err) {
      if (opId === operationIdRef.current) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "壁纸处理失败，请更换一张图片后重试。",
        );
      }
    } finally {
      if (opId === operationIdRef.current) {
        setIsProcessing(false);
      }
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      void applyCustomImage(() => prepareUploadedImage(file));
    }
  };

  const handleUrlSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const cleanUrl = urlInput.trim();
    if (!cleanUrl.startsWith("https://") || !safeImageUrl(cleanUrl)) {
      setErrorMessage("请输入合法的 HTTPS 图片直链（如 .jpg / .png / .webp）。");
      return;
    }

    void applyCustomImage(async () => {
      await verifyRemoteImage(cleanUrl);
      return cleanUrl;
    });
  };

  const resetToDefault = () => {
    operationIdRef.current += 1;
    setIsProcessing(false);
    setErrorMessage("");
    setUrlInput("");
    update(DEFAULTS);
    toast.info("已恢复默认动漫放映室外观");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) {
          operationIdRef.current += 1;
          setIsProcessing(false);
          setErrorMessage("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="appearance-trigger anime-hover-glow"
          aria-label="布置放映室外观"
          title="布置放映室外观"
        >
          <Palette size={18} />
        </Button>
      </DialogTrigger>

      <DialogContent className="room-dialog appearance-dialog anime-modal">
        <DialogHeader>
          <div className="anime-modal-badge">
            <Sparkles size={13} />
            <span>THEME &amp; AMBIENCE // 氛圍設定</span>
          </div>
          <DialogTitle>布置你的专属放映室</DialogTitle>
          <DialogDescription>
            换一片心动的次元风景，调一杯微光，陪你和朋友看完整部番剧。
          </DialogDescription>
        </DialogHeader>

        {/* Live Wallpaper Preview Card */}
        <div
          className="appearance-preview-deck"
          style={{
            backgroundImage: preferences.image
              ? `linear-gradient(rgba(18, 14, 30, ${preferences.dim / 100}), rgba(18, 14, 30, ${preferences.dim / 100})), url(${JSON.stringify(preferences.image)})`
              : "none",
            filter: preferences.blur ? `blur(${Math.min(preferences.blur, 4)}px)` : "none",
          }}
        >
          <div className="appearance-preview-content">
            <span className="preview-sparkle">✦</span>
            <strong>
              <ImagePlus size={16} /> 放映室即时氛围预览
            </strong>
            <small>
              {PRESET_BACKGROUNDS.find((p) => p.url === preferences.image)?.name ??
                (preferences.image ? "自定义专属壁纸" : "纯净深夜")}
            </small>
          </div>
        </div>

        {/* Preset Gallery */}
        <div className="appearance-section">
          <label className="appearance-section-title">
            <span>官方动漫巡礼主题</span>
            <small>点击即换</small>
          </label>
          <div className="background-presets-grid" role="radiogroup" aria-label="内置动漫背景">
            {PRESET_BACKGROUNDS.map((preset) => {
              const isSelected = preferences.image === preset.url;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`background-preset-card ${isSelected ? "selected" : ""}`}
                  onClick={() => selectPreset(preset.url)}
                  aria-pressed={isSelected}
                >
                  <span
                    className="preset-thumbnail"
                    style={{
                      backgroundImage: preset.thumb
                        ? `url(${JSON.stringify(preset.thumb)})`
                        : "none",
                      backgroundColor: preset.thumb ? "transparent" : "#130f24",
                    }}
                  >
                    {isSelected && (
                      <span className="preset-selected-badge">
                        <Check size={13} />
                      </span>
                    )}
                  </span>
                  <div className="preset-info">
                    <span className="preset-name">{preset.name}</span>
                    <span className="preset-sub">{preset.sub}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Accent Color Palette Switcher */}
        <div className="appearance-section">
          <label className="appearance-section-title">
            <span>主题强调色</span>
            <small>改变全站霓虹与按钮光感</small>
          </label>
          <div className="accent-palette-row" role="radiogroup" aria-label="主题强调色">
            {(Object.keys(ACCENT_PALETTES) as AccentTheme[]).map((key) => {
              const pal = ACCENT_PALETTES[key];
              const isSelected = preferences.accent === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`accent-palette-chip ${isSelected ? "selected" : ""}`}
                  onClick={() => selectAccent(key)}
                  aria-pressed={isSelected}
                >
                  <span
                    className="accent-dot"
                    style={{ backgroundColor: pal.primary }}
                  />
                  <span>{pal.name}</span>
                  {isSelected && <Check size={13} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Upload or URL */}
        <div className="appearance-section">
          <label className="appearance-section-title">
            <span>自定义壁纸</span>
            <small>本地处理，不上传云端</small>
          </label>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={handleFileUpload}
          />

          <div className="custom-wallpaper-actions">
            <Button
              variant="outline"
              className="background-upload-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Upload size={16} />
              )}
              <span>上传本地壁纸</span>
              <small>JPG / PNG / WebP · ≤ 10 MB</small>
            </Button>

            <form className="background-url-form" onSubmit={handleUrlSubmit}>
              <div className="url-input-wrap">
                <Input
                  id="custom-background-url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="或粘贴 HTTPS 图片直链…"
                  type="url"
                  disabled={isProcessing}
                  aria-label="输入图片直链"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={isProcessing || !urlInput.trim()}
                >
                  {isProcessing ? <LoaderCircle className="spin" size={14} /> : "应用"}
                </Button>
              </div>
            </form>
          </div>

          {errorMessage && (
            <p className="appearance-error-tip" role="alert">
              {errorMessage}
            </p>
          )}
        </div>

        {/* Sliders for Readability & Ambience */}
        <div className="appearance-section appearance-sliders-block">
          <div className="slider-row">
            <div className="slider-header">
              <label htmlFor="appearance-dim-slider">
                壁纸遮罩浓度 (提高文字对比度)
              </label>
              <span className="slider-val">{preferences.dim}%</span>
            </div>
            <Slider
              id="appearance-dim-slider"
              aria-label="壁纸遮罩浓度"
              min={15}
              max={85}
              step={1}
              value={[preferences.dim]}
              onValueChange={([val]) =>
                update({ ...preferences, dim: val }, false)
              }
              onValueCommit={([val]) =>
                update({ ...preferences, dim: val }, true)
              }
            />
          </div>

          <div className="slider-row">
            <div className="slider-header">
              <label htmlFor="appearance-blur-slider">壁纸柔焦虚化</label>
              <span className="slider-val">{preferences.blur}px</span>
            </div>
            <Slider
              id="appearance-blur-slider"
              aria-label="壁纸柔焦虚化"
              min={0}
              max={20}
              step={1}
              value={[preferences.blur]}
              onValueChange={([val]) =>
                update({ ...preferences, blur: val }, false)
              }
              onValueCommit={([val]) =>
                update({ ...preferences, blur: val }, true)
              }
            />
          </div>
        </div>

        {/* Footer */}
        <div className="appearance-dialog-footer">
          <p className="privacy-note">
            壁纸与调色仅保存在当前设备浏览器中，不消耗服务器流量，也不会影响房间内的其他伙伴。
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="reset-appearance-btn"
            onClick={resetToDefault}
          >
            <RotateCcw size={14} />
            重置默认
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
