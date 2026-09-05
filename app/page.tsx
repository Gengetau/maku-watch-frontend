"use client";

/* eslint-disable react-hooks/set-state-in-effect -- video, storage, and WebSocket effects mirror external state into React intentionally. */

import { CSSProperties, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Clapperboard,
  Clock3,
  Copy,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  MessageCircle,
  MoreHorizontal,
  PanelRight,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Share2,
  SkipBack,
  SkipForward,
  Sparkles,
  Star,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { AppearanceSettings, useAppearance } from "@/components/appearance-settings";

import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

const DEFAULT_API_BASE = "https://ether-canteen-referee.ngrok-free.dev";
const DEFAULT_WS_BASE = "wss://ether-canteen-referee.ngrok-free.dev/ws";
const API_BASE = (process.env.NEXT_PUBLIC_MAKU_API_BASE ?? DEFAULT_API_BASE).replace(/\/+$/, "");
const WS_BASE = (process.env.NEXT_PUBLIC_MAKU_WS_BASE ?? DEFAULT_WS_BASE).replace(/\/+$/, "");
const ROOM_STORAGE_KEY = "maku-watch.room-code";
const MEMBER_STORAGE_KEY_PREFIX = "maku-watch.member-id";
const LEGACY_MEMBER_STORAGE_KEY = "maku-watch.member-id";
const LEGACY_NICKNAME_STORAGE_KEY = "maku-watch.nickname";
const NICKNAME_STORAGE_KEY_PREFIX = "maku-watch.nickname";
const CHAT_STORAGE_KEY_PREFIX = "maku-watch.chat";
const CLIENT_ID_STORAGE_KEY = "maku-watch.client-id";
const RECONNECT_WINDOW_MS = 20_000;
const WS_PING_INTERVAL_MS = 28_000;
const SOURCE_RETRY_DELAYS_MS = [1_000, 3_000, 10_000];
const HLS_FORWARD_BUFFER_SECONDS = 60;
const STARTUP_BUFFER_SECONDS = 7;
const STALL_LOCAL_RESUME_BUFFER_SECONDS = 1;
const BUFFER_CHECK_INTERVAL_MS = 250;
const FOLLOWER_FRAME_CHECK_INTERVAL_MS = 1_000;
const FOLLOWER_FRAME_STALL_MS = 2_500;
const FOLLOWER_RESYNC_COOLDOWN_MS = 2_000;
const RANDOM_NICKNAME_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const RANDOM_NICKNAME_LENGTH = 6;
const DANMAKU_SPEED_PX_PER_SECOND = 70;

function createRandomNickname(): string {
  const values = new Uint32Array(RANDOM_NICKNAME_LENGTH);
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(values);
    return Array.from(values, (value) => RANDOM_NICKNAME_ALPHABET[value % RANDOM_NICKNAME_ALPHABET.length]).join("");
  }
  return Array.from({ length: RANDOM_NICKNAME_LENGTH }, () => {
    const index = Math.floor(Math.random() * RANDOM_NICKNAME_ALPHABET.length);
    return RANDOM_NICKNAME_ALPHABET[index];
  }).join("");
}

type PlaybackState = {
  paused: boolean;
  position: number;
  playbackRate: number;
  catalogId: number | null;
  episodeId: string | null;
  episodeUrl: string | null;
  episodeName: string | null;
  sourceId: string | null;
  updatedAt: number;
  revision: number;
};

type RoomMember = {
  id: string;
  nickname: string;
  joinedAt: number;
  isHost: boolean;
};

type RoomSnapshot = {
  code: string;
  createdAt: number;
  hostId: string;
  playback: PlaybackState;
  members: RoomMember[];
};

type RoomJoinResult = {
  room: RoomSnapshot;
  member: RoomMember;
};

type SourceTransport = "direct" | "relay";

type SourceOption = {
  id: string;
  name: string;
  version?: string;
  type?: string;
  transport?: SourceTransport;
  useWebview?: boolean;
  tier?: number;
  access?: string;
  requiresVerification?: boolean;
  health?: SourceHealth;
};

type SourceHealth = {
  state: string;
  stage?: string;
  checkedAt?: number;
  expiresAt?: number;
};

type CatalogImageSet = {
  large: string;
  common: string;
  medium: string;
  small: string;
  grid: string;
};

type CatalogItem = {
  id: number;
  name: string;
  nameCn: string;
  summary: string;
  airDate: string;
  rank: number;
  ratingScore: number;
  ratingTotal: number;
  images: CatalogImageSet;
  aliases: string[];
  tags: string[];
};

type SourceSearchItem = {
  title: string;
  detailUrl: string;
  sourceId: string;
  catalogId: number | null;
  catalog: CatalogItem | null;
};

type SourceRoad = {
  name: string;
  episodes: Array<{ id: string; name: string; url: string }>;
};

type ActiveEpisode = {
  id: string;
  name: string;
  url: string;
  sourceId: string;
  key: string;
};

type ResolvedMedia = {
  url: string;
  kind: "hls" | "mp4" | "unknown";
  referer?: string;
  via?: string;
  transport?: SourceTransport;
  quality?: HlsQualityInfo;
  key: string;
};

type HlsQualityLevel = {
  index: number;
  label: string;
  width: number | null;
  height: number | null;
  bandwidth: number | null;
  frameRate: number | null;
  codecs: string | null;
};

type HlsQualityInfo = {
  mode: "adaptive" | "single";
  levels: HlsQualityLevel[];
};

type DanmakuMode = "scroll" | "top" | "bottom";

type DanmakuMessage = {
  id: string;
  by: string;
  nickname: string;
  text: string;
  color: string;
  mode: DanmakuMode;
  videoTime: number;
  sentAt: number;
};

type DanmakuFontSize = "small" | "medium" | "large";

type DanmakuSettings = {
  enabled: boolean;
  showScroll: boolean;
  showTop: boolean;
  showBottom: boolean;
  opacity: number;
  fontSize: DanmakuFontSize;
};

type ChatMessage = {
  id: string;
  memberId: string;
  name: string;
  time: string;
  text: string;
  color: string;
  kind: "chat" | "danmaku";
  self?: boolean;
};

type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "error";

type SourceError = {
  code: string;
  message: string;
  challengeUrl?: string;
};

type PlaybackCommand = {
  paused?: boolean;
  position?: number;
  playbackRate?: number;
  catalogId?: number | null;
  episodeId?: string | null;
  episodeUrl?: string | null;
  episodeName?: string | null;
  sourceId?: string | null;
};

type RoomSocketMessage = {
  type?: string;
  id?: string;
  room?: unknown;
  playback?: unknown;
  by?: string;
  nickname?: string;
  text?: string;
  color?: string;
  mode?: string;
  videoTime?: number;
  sentAt?: number;
  clientTime?: number | null;
  serverTime?: number;
  code?: string;
  message?: string;
  scope?: string;
  retryAfterMs?: number;
};

const EMPTY_PLAYBACK: PlaybackState = {
  paused: true,
  position: 0,
  playbackRate: 1,
  catalogId: null,
  episodeId: null,
  episodeUrl: null,
  episodeName: null,
  sourceId: null,
  updatedAt: 0,
  revision: 0,
};

class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

function memberStorageKey(roomCode: string): string {
  return `${MEMBER_STORAGE_KEY_PREFIX}:${normalizeCode(roomCode)}`;
}

function nicknameStorageKey(roomCode: string): string {
  return `${NICKNAME_STORAGE_KEY_PREFIX}:${normalizeCode(roomCode)}`;
}

function chatStorageKey(roomCode: string): string {
  return `${CHAT_STORAGE_KEY_PREFIX}:${normalizeCode(roomCode)}`;
}

function loadStoredChatMessages(roomCode: string): ChatMessage[] {
  if (!roomCode) return [];
  try {
    const raw = sessionStorage.getItem(chatStorageKey(roomCode));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ChatMessage => {
      if (!isRecord(item)) return false;
      return typeof item.id === "string"
        && typeof item.memberId === "string"
        && typeof item.name === "string"
        && typeof item.time === "string"
        && typeof item.text === "string"
        && typeof item.color === "string"
        && (item.kind === "chat" || item.kind === "danmaku")
        && (item.self === undefined || typeof item.self === "boolean");
    }).slice(-100);
  } catch {
    return [];
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bufferedSecondsAhead(video: HTMLVideoElement, position = video.currentTime): number {
  for (let index = 0; index < video.buffered.length; index += 1) {
    const start = video.buffered.start(index);
    const end = video.buffered.end(index);
    if (position >= start - 0.1 && position <= end + 0.1) return Math.max(0, end - position);
  }
  return 0;
}

function hasBufferedAhead(video: HTMLVideoElement, seconds: number, position = video.currentTime): boolean {
  const remaining = Number.isFinite(video.duration) ? Math.max(0, video.duration - position) : seconds;
  const target = Math.min(seconds, remaining);
  return bufferedSecondsAhead(video, position) + 0.1 >= target;
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatClock(timestamp: number): string {
  if (!timestamp) return "刚刚";
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function toneFor(value: string): string {
  const tones = ["tone-rose", "tone-gold", "tone-cyan", "tone-blue", "tone-indigo", "tone-lime"];
  return tones[hashString(value) % tones.length] ?? tones[0];
}

function avatarToneFor(value: string): string {
  const tones = ["avatar-coral", "avatar-sky", "avatar-gold"];
  return tones[hashString(value) % tones.length] ?? tones[0];
}

function markFor(value: string): string {
  return Array.from(value.trim())[0] ?? "幕";
}

function episodeKeyFor(sourceId: string, episodeId: string, episodeUrl: string): string {
  return `${sourceId}|${episodeId}|${episodeUrl}`;
}

const DANMAKU_FONT_SIZES: Record<DanmakuFontSize, string> = {
  small: "14px",
  medium: "18px",
  large: "23px",
};

const DANMAKU_FONT_PIXELS: Record<DanmakuFontSize, number> = {
  small: 14,
  medium: 18,
  large: 23,
};

function qualityLabelFor(level: Partial<HlsQualityLevel> & { bandwidth?: number | null }): string {
  if (level.height && level.height > 0) return `${level.height}P`;
  if (level.width && level.width > 0) return `${level.width}W`;
  if (level.bandwidth && level.bandwidth > 0) {
    return `${Math.round(level.bandwidth / 1000)}K`;
  }
  return "AUTO";
}

function parseSourceHealth(value: unknown): SourceHealth | undefined {
  if (!isRecord(value)) return undefined;
  const state = stringValue(value.state);
  if (!state) return undefined;
  return {
    state,
    stage: stringValue(value.stage) || undefined,
    checkedAt: numberValue(value.checkedAt) || undefined,
    expiresAt: numberValue(value.expiresAt) || undefined,
  };
}

function parseCatalogItem(value: unknown): CatalogItem | null {
  if (!isRecord(value)) return null;
  const id = numberValue(value.id);
  const name = stringValue(value.name);
  if (!id || !name) return null;
  const rawImages = isRecord(value.images) ? value.images : {};
  const images = {
    large: stringValue(rawImages.large),
    common: stringValue(rawImages.common),
    medium: stringValue(rawImages.medium),
    small: stringValue(rawImages.small),
    grid: stringValue(rawImages.grid),
  };
  const aliases = Array.isArray(value.aliases) ? value.aliases.map(stringValue).filter(Boolean) : [];
  const tags = Array.isArray(value.tags) ? value.tags.map(stringValue).filter(Boolean) : [];
  return {
    id,
    name,
    nameCn: stringValue(value.nameCn) || name,
    summary: stringValue(value.summary),
    airDate: stringValue(value.airDate),
    rank: numberValue(value.rank),
    ratingScore: numberValue(value.ratingScore),
    ratingTotal: numberValue(value.ratingTotal),
    images,
    aliases,
    tags,
  };
}

function parsePlayback(value: unknown): PlaybackState {
  const record = isRecord(value) ? value : {};
  return {
    paused: booleanValue(record.paused, true),
    position: Math.max(0, numberValue(record.position)),
    playbackRate: clamp(numberValue(record.playbackRate, 1), 0.25, 4),
    catalogId: numberValue(record.catalogId) || null,
    episodeId: stringValue(record.episodeId) || null,
    episodeUrl: stringValue(record.episodeUrl) || null,
    episodeName: stringValue(record.episodeName) || null,
    sourceId: stringValue(record.sourceId) || null,
    updatedAt: numberValue(record.updatedAt),
    revision: numberValue(record.revision),
  };
}

function parseRoomSnapshot(value: unknown): RoomSnapshot | null {
  if (!isRecord(value)) return null;
  const code = normalizeCode(stringValue(value.code));
  const hostId = stringValue(value.hostId);
  if (!code || !hostId || !Array.isArray(value.members)) return null;
  const members = value.members.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = stringValue(item.id);
    if (!id) return [];
    return [{
      id,
      nickname: stringValue(item.nickname) || "Guest",
      joinedAt: numberValue(item.joinedAt),
      isHost: booleanValue(item.isHost, id === hostId),
    }];
  });
  return {
    code,
    createdAt: numberValue(value.createdAt),
    hostId,
    playback: parsePlayback(value.playback),
    members,
  };
}

function parseSources(value: unknown): SourceOption[] {
  const record = isRecord(value) ? value : {};
  const rawItems = Array.isArray(value)
    ? value
    : Array.isArray(record.sources)
      ? record.sources
      : Array.isArray(record.items)
        ? record.items
        : [];
  const parsed = rawItems.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const id = stringValue(item.id);
    const name = stringValue(item.name);
    const tier = numberValue(item.tier);
    const transport = stringValue(item.transport).toLowerCase();
    return id ? [{
      source: {
        id,
        name: name || id,
        version: stringValue(item.version) || undefined,
        type: stringValue(item.type) || undefined,
        transport: transport === "direct" || transport === "relay" ? transport : undefined,
        useWebview: typeof item.useWebview === "boolean" ? item.useWebview : undefined,
        tier: tier > 0 ? tier : undefined,
        access: stringValue(item.access) || undefined,
        requiresVerification: typeof item.requiresVerification === "boolean" ? item.requiresVerification : undefined,
        health: parseSourceHealth(item.health) ?? parseSourceHealth(item.validation),
      },
      index,
    }] : [];
  });
  return parsed
    .sort((left, right) => {
      const leftTier = left.source.tier ?? Number.MAX_SAFE_INTEGER;
      const rightTier = right.source.tier ?? Number.MAX_SAFE_INTEGER;
      if (leftTier !== rightTier) return leftTier - rightTier;
      const leftTransport = left.source.transport === "direct" ? 0 : left.source.transport === "relay" ? 1 : 2;
      const rightTransport = right.source.transport === "direct" ? 0 : right.source.transport === "relay" ? 1 : 2;
      return leftTransport - rightTransport || left.index - right.index;
    })
    .map(({ source }) => source);
}

type SourceValidationTone = "ready" | "caution" | "warning" | "neutral";

type SourceValidationSummary = {
  label: string;
  message: string;
  tone: SourceValidationTone;
};

function sourceNeedsVerification(source: SourceOption): boolean {
  return source.requiresVerification === true
    || source.access?.toLowerCase() === "verification_required"
    || source.health?.state === "challenge";
}

function sourceValidationFor(source: SourceOption | undefined): SourceValidationSummary | null {
  if (!source) return null;
  if (sourceNeedsVerification(source)) {
    return {
      label: "需验证",
      message: "搜索和分集可以使用，播放时可能需要浏览器验证。",
      tone: "caution",
    };
  }
  switch (source.health?.state) {
    case "playable":
      return { label: "已校验可播放", message: "最近一次媒体校验通过浏览器兼容性检查。", tone: "ready" };
    case "search_ok":
      return { label: "搜索可用", message: "最近有搜索结果，播放能力会在解析时再次校验。", tone: "neutral" };
    case "catalog_ok":
      return { label: "分集可用", message: "最近有可用分集，播放地址会在选择集数后再次校验。", tone: "neutral" };
    case "challenge":
      return { label: "需浏览器验证", message: "当前片源需要完成交互式验证后才能播放。", tone: "caution" };
    case "forbidden":
      return { label: "上游拒绝", message: "上游暂时拒绝访问，可以稍后重试或切换片源。", tone: "warning" };
    case "upstream_error":
      return { label: "上游异常", message: "上游服务暂时不可用，可以稍后重试或切换片源。", tone: "warning" };
    case "resolver_failed":
      return { label: "解析不稳定", message: "最近未找到已验证的播放地址，可以尝试其他片源。", tone: "warning" };
    default:
      return { label: "状态未知", message: "服务端暂未记录近期校验证据，选择集数时会再次检查。", tone: "neutral" };
  }
}

function sourceMenuLabel(source: SourceOption): string {
  const validation = sourceValidationFor(source);
  const tier = source.tier === 1 ? "推荐" : source.tier === 2 ? "条件" : "";
  const transport = source.transport === "relay" ? "兼容线路" : source.transport === "direct" ? "直连" : "";
  return [source.name, source.version ? `v${source.version}` : "", tier, transport, validation?.label ?? ""]
    .filter(Boolean)
    .join(" · ");
}

function parseSearchResults(value: unknown): SourceSearchItem[] {
  const record = isRecord(value) ? value : {};
  const rawItems = Array.isArray(value)
    ? value
    : Array.isArray(record.items)
      ? record.items
      : Array.isArray(record.results)
        ? record.results
        : [];
  return rawItems.flatMap((item) => {
    if (!isRecord(item)) return [];
    const title = stringValue(item.title);
    const detailUrl = stringValue(item.detailUrl);
    const sourceId = stringValue(item.sourceId);
    const catalog = parseCatalogItem(item.catalog) ?? parseCatalogItem(item.catalogItem);
    const catalogId = numberValue(item.catalogId) || catalog?.id || null;
    return title && detailUrl && sourceId ? [{ title, detailUrl, sourceId, catalogId, catalog }] : [];
  });
}

function parseCatalogSearchItems(value: unknown): CatalogItem[] {
  const record = isRecord(value) ? value : {};
  const rawItems = Array.isArray(value)
    ? value
    : Array.isArray(record.items)
      ? record.items
      : Array.isArray(record.results)
        ? record.results
        : [];
  return rawItems.flatMap((item) => {
    const parsed = parseCatalogItem(item);
    return parsed ? [parsed] : [];
  });
}

function normalizeTitleForMatch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function catalogMatchScore(sourceTitle: string, catalog: CatalogItem): number {
  const source = normalizeTitleForMatch(sourceTitle);
  if (!source) return 0;
  const names = [catalog.nameCn, catalog.name, ...catalog.aliases]
    .map(normalizeTitleForMatch)
    .filter(Boolean);
  let best = 0;
  for (const name of names) {
    if (source === name) {
      best = Math.max(best, 100);
      continue;
    }
    const shortestLength = Math.min(source.length, name.length);
    if (shortestLength >= 4 && (source.includes(name) || name.includes(source))) {
      best = Math.max(best, 75);
      continue;
    }
    if (shortestLength < 5) continue;
    const sourceChars = new Set(Array.from(source));
    const nameChars = new Set(Array.from(name));
    const shared = Array.from(sourceChars).filter((character) => nameChars.has(character)).length;
    const overlap = shared / Math.min(sourceChars.size, nameChars.size);
    if (overlap >= 0.78) best = Math.max(best, 55);
  }
  return best;
}

function enrichSearchResults(sourceResults: SourceSearchItem[], catalogResults: CatalogItem[]): SourceSearchItem[] {
  const catalogById = new Map(catalogResults.map((item) => [item.id, item]));
  return sourceResults.map((item) => {
    const directMatch = item.catalogId ? catalogById.get(item.catalogId) : undefined;
    if (directMatch) return { ...item, catalog: directMatch };
    let bestMatch: CatalogItem | null = null;
    let bestScore = 0;
    for (const candidate of catalogResults) {
      const score = catalogMatchScore(item.title, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }
    return { ...item, catalog: bestScore >= 55 ? bestMatch : null };
  });
}

function parseRoads(value: unknown): SourceRoad[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || !Array.isArray(item.episodes)) return [];
    const episodes = item.episodes.flatMap((episode) => {
      if (!isRecord(episode)) return [];
      const id = stringValue(episode.id);
      const name = stringValue(episode.name);
      const url = stringValue(episode.url);
      return id && name && url ? [{ id, name, url }] : [];
    });
    return episodes.length ? [{ name: stringValue(item.name) || "线路", episodes }] : [];
  });
}

function parseResolvedMedia(value: unknown): Omit<ResolvedMedia, "key"> | null {
  if (!isRecord(value)) return null;
  const url = stringValue(value.url);
  const kind = stringValue(value.kind);
  if (!url || !["hls", "mp4", "unknown"].includes(kind)) return null;
  return {
    url,
    kind: kind as "hls" | "mp4" | "unknown",
    referer: stringValue(value.referer) || undefined,
    via: stringValue(value.via) || undefined,
    transport: ["direct", "relay"].includes(stringValue(value.transport).toLowerCase())
      ? stringValue(value.transport).toLowerCase() as SourceTransport
      : undefined,
    quality: parseHlsQualityInfo(value.quality),
  };
}

function parseHlsQualityInfo(value: unknown): HlsQualityInfo | undefined {
  if (!isRecord(value)) return undefined;
  const mode = stringValue(value.mode);
  if (mode !== "adaptive" && mode !== "single") return undefined;
  const levels = Array.isArray(value.levels) ? value.levels.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const level = {
      index: Number.isInteger(item.index) ? numberValue(item.index, index) : index,
      label: stringValue(item.label),
      width: numberValue(item.width) || null,
      height: numberValue(item.height) || null,
      bandwidth: numberValue(item.bandwidth) || null,
      frameRate: numberValue(item.frameRate) || null,
      codecs: stringValue(item.codecs) || null,
    };
    return [{ ...level, label: level.label || qualityLabelFor(level) }];
  }) : [];
  return { mode, levels };
}

function parseDanmakuMessage(value: unknown): DanmakuMessage | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const text = stringValue(value.text);
  const mode = stringValue(value.mode);
  if (!id || !text || (mode !== "scroll" && mode !== "top" && mode !== "bottom")) return null;
  return {
    id,
    by: stringValue(value.by),
    nickname: stringValue(value.nickname) || "成员",
    text,
    color: /^#[0-9a-f]{6}$/i.test(stringValue(value.color)) ? stringValue(value.color) : "#FFFFFF",
    mode,
    videoTime: Math.max(0, numberValue(value.videoTime)),
    sentAt: numberValue(value.sentAt, Date.now()),
  };
}

function playbackEpisode(value: PlaybackState): ActiveEpisode | null {
  if (!value.sourceId || !value.episodeId || !value.episodeUrl) return null;
  const id = value.episodeId;
  return {
    id,
    name: value.episodeName || "当前集",
    url: value.episodeUrl,
    sourceId: value.sourceId,
    key: episodeKeyFor(value.sourceId, id, value.episodeUrl),
  };
}

function retryAfterMsFor(response: Response): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (new URL(API_BASE).hostname.endsWith("ngrok-free.dev")) {
    headers.set("ngrok-skip-browser-warning", "1");
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      cache: "no-store",
      headers,
    });
  } catch {
    throw new ApiRequestError("service_unavailable", 0, "后端服务暂时不可用，请稍后重试。");
  }
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    throw new ApiRequestError("service_unavailable", response.status, "后端服务暂时不可用，请稍后重试。");
  }
  let payload: unknown = null;
  let parsedJson = false;
  try {
    if (raw.trim()) {
      payload = JSON.parse(raw);
      parsedJson = true;
    }
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const record = isRecord(payload) ? payload : {};
    const invalidGatewayBody = !parsedJson;
    const rateLimited = response.status === 429 || stringValue(record.error) === "rate_limited";
    const relayCapacity = stringValue(record.error) === "relay_capacity";
    const serviceUnavailable = [502, 503, 504].includes(response.status) || (invalidGatewayBody && !rateLimited);
    const roomFull = response.status === 409 && stringValue(record.error) === "room_full";
    const retryAfterMs = retryAfterMsFor(response);
    const details = retryAfterMs === undefined ? record : { ...record, retryAfterMs };
    const code = relayCapacity
      ? "relay_capacity"
      : serviceUnavailable
        ? "service_unavailable"
        : rateLimited
          ? "rate_limited"
          : roomFull
            ? "room_full"
            : stringValue(record.error) || `http_${response.status}`;
    const message = relayCapacity
      ? stringValue(record.message) || "兼容线路当前容量已满，请切换其他片源。"
      : serviceUnavailable
        ? "后端服务暂时不可用，请稍后重试。"
        : rateLimited
          ? "请求太频繁，请稍后重试。"
          : roomFull
            ? "房间已满，请让房主创建新的房间。"
            : stringValue(record.message) || code;
    throw new ApiRequestError(code, response.status, message, details);
  }
  if (!parsedJson) throw new ApiRequestError("service_unavailable", response.status, "后端服务暂时不可用，请稍后重试。");
  return payload as T;
}

function sourceErrorFor(error: unknown): SourceError {
  if (error instanceof ApiRequestError) {
    const challengeUrl = stringValue(error.details.challengeUrl) || undefined;
    if (error.code === "service_unavailable") {
      return { code: error.code, message: "后端服务暂时不可用，请稍后重试。" };
    }
    if (error.code === "challenge_required") {
      return { code: error.code, message: "片源需要浏览器验证，暂时无法直接播放。", challengeUrl };
    }
    if (error.code === "source_unavailable") {
      return { code: error.code, message: "当前片源未通过本次浏览器兼容性校验，暂不提供播放。" };
    }
    if (error.code === "video_source_not_found") {
      return { code: error.code, message: "这个线路暂时没有找到可播放的视频地址。" };
    }
    if (error.code === "resolver_failed") {
      return { code: error.code, message: "当前片源暂时没有找到已验证的播放地址，可以切换其他片源。" };
    }
    if (error.code === "forbidden") {
      return { code: error.code, message: "上游片源拒绝了访问，可以稍后重试或切换其他片源。" };
    }
    if (error.code === "upstream_error") {
      return { code: error.code, message: "片源上游服务暂时不可用，可以稍后重试。" };
    }
    if (error.code === "relay_capacity") {
      const reason = stringValue(error.details.reason);
      return {
        code: error.code,
        message: reason === "bandwidth"
          ? "兼容线路带宽已满，请切换直连片源或其他片源。"
          : "兼容线路当前连接数已满，请切换直连片源或其他片源。",
      };
    }
    if (error.code === "resolve_failed") {
      return { code: error.code, message: "片源解析失败，可以重新获取一次播放地址。" };
    }
    return { code: error.code, message: error.message || "片源请求失败。" };
  }
  return { code: "resolve_failed", message: "片源解析失败，可以重新获取一次播放地址。" };
}

function sourceErrorTitle(code: string): string {
  if (code === "challenge_required") return "需要验证";
  if (code === "source_unavailable") return "片源暂不可用";
  if (code === "video_source_not_found") return "没有视频地址";
  if (code === "resolver_failed") return "没有可播放地址";
  if (code === "forbidden") return "上游拒绝访问";
  if (code === "upstream_error") return "上游服务异常";
  if (code === "relay_capacity") return "兼容线路繁忙";
  if (code === "resolve_failed") return "解析失败";
  if (code === "service_unavailable") return "服务暂时不可用";
  return "播放源错误";
}

function episodeKeyFromPlayback(value: PlaybackState): string | null {
  const episode = playbackEpisode(value);
  return episode?.key ?? null;
}

function predictedPosition(value: PlaybackState, offset: number): number {
  if (value.paused || !value.updatedAt) return Math.max(0, value.position);
  const elapsed = Math.max(0, (Date.now() + offset - value.updatedAt) / 1_000);
  return Math.max(0, value.position + elapsed * value.playbackRate);
}

export default function Home() {
  const appearance = useAppearance();
  const [roomCode, setRoomCode] = useState("");
  const [memberId, setMemberId] = useState("");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>(EMPTY_PLAYBACK);
  const [activeEpisode, setActiveEpisode] = useState<ActiveEpisode | null>(null);
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [pendingInviteCode, setPendingInviteCode] = useState("");
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "join" | "invite" | "rename">("create");
  const [roomRequestBusy, setRoomRequestBusy] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [clientId, setClientId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  const [sources, setSources] = useState<SourceOption[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [sourceListError, setSourceListError] = useState("");
  const [sourceListLoading, setSourceListLoading] = useState(true);
  const [sourceReloadNonce, setSourceReloadNonce] = useState(0);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SourceSearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [catalogMetadataError, setCatalogMetadataError] = useState("");
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogItem | null>(null);
  const [selectedSourceMatch, setSelectedSourceMatch] = useState<SourceSearchItem | null>(null);
  const [activeCatalog, setActiveCatalog] = useState<CatalogItem | null>(null);
  const [activeWorkTitle, setActiveWorkTitle] = useState("");
  const [roads, setRoads] = useState<SourceRoad[]>([]);
  const [selectedRoad, setSelectedRoad] = useState(0);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [chaptersError, setChaptersError] = useState("");

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [isPlaying, setIsPlaying] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isMobilePlayerDocked, setIsMobilePlayerDocked] = useState(false);
  const [videoStageWidth, setVideoStageWidth] = useState(0);
  const [videoPosition, setVideoPosition] = useState(0);
  const [scrubPosition, setScrubPosition] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [resolvedMedia, setResolvedMedia] = useState<ResolvedMedia | null>(null);
  const [mediaState, setMediaState] = useState<"idle" | "resolving" | "loading" | "ready" | "error">("idle");
  const [sourceError, setSourceError] = useState<SourceError | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [isRebuffering, setIsRebuffering] = useState(false);
  const [resolveNonce, setResolveNonce] = useState(0);
  const [qualityLevels, setQualityLevels] = useState<HlsQualityLevel[]>([]);
  const [qualityMode, setQualityMode] = useState<"adaptive" | "single" | "unknown">("unknown");
  const [selectedQualityLevel, setSelectedQualityLevel] = useState(-1);
  const [qualityManualAvailable, setQualityManualAvailable] = useState(false);
  const [danmakuMessages, setDanmakuMessages] = useState<DanmakuMessage[]>([]);
  const [danmakuDraft, setDanmakuDraft] = useState("");
  const [danmakuColor, setDanmakuColor] = useState("#FFFFFF");
  const [danmakuMode, setDanmakuMode] = useState<DanmakuMode>("scroll");
  const [danmakuSettings, setDanmakuSettings] = useState<DanmakuSettings>({
    enabled: true,
    showScroll: true,
    showTop: true,
    showBottom: true,
    opacity: 0.9,
    fontSize: "medium",
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const videoStageRef = useRef<HTMLDivElement | null>(null);
  const playerAnchorRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const roomRef = useRef<RoomSnapshot | null>(null);
  const playbackRef = useRef<PlaybackState>(EMPTY_PLAYBACK);
  const activeEpisodeRef = useRef<ActiveEpisode | null>(null);
  const serverOffsetRef = useRef(0);
  const websocketRef = useRef<WebSocket | null>(null);
  const websocketSendRef = useRef<((message: unknown) => boolean) | null>(null);
  const nicknameRef = useRef("");
  const resolveRetryKeyRef = useRef<string | null>(null);
  const resolveRequestIdRef = useRef(0);
  const bootstrapRef = useRef(false);
  const controlsHideTimerRef = useRef<number | null>(null);
  const rebufferingRef = useRef(false);
  const pendingCatalogIdRef = useRef<number | null>(null);
  const danmakuEnabledRef = useRef(true);
  const localEpisodeOverrideRef = useRef(false);
  const localOverridePlaybackKeyRef = useRef<string | null>(null);
  const lastManualResolveRetryAtRef = useRef(0);

  const members = room?.members ?? [];
  const currentMember = members.find((member) => member.id === memberId);
  const isHost = Boolean(room && memberId && room.hostId === memberId);
  const currentSource = sources.find((source) => source.id === sourceId);
  const currentSourceValidation = sourceValidationFor(currentSource);
  const selectedSourceLabel = selectedSourceMatch?.sourceId
    ? sources.find((source) => source.id === selectedSourceMatch.sourceId)?.name ?? selectedSourceMatch.sourceId
    : "";
  const sourceLabel = currentSource?.name || selectedSourceLabel || sourceId || "等待片源";
  const displayedPosition = isScrubbing ? scrubPosition : videoPosition;
  const activeEpisodes = useMemo<ActiveEpisode[]>(() => {
    const source = selectedSourceMatch?.sourceId || sourceId;
    return (roads[selectedRoad]?.episodes ?? []).map((episode) => {
      return {
        id: episode.id,
        name: episode.name,
        url: episode.url,
        sourceId: source,
        key: episodeKeyFor(source, episode.id, episode.url),
      };
    });
  }, [roads, selectedRoad, selectedSourceMatch?.sourceId, sourceId]);
  const activeRoad = roads[selectedRoad];
  const activeEpisodeKey = activeEpisode?.key;
  const activeTitle = activeCatalog?.nameCn || activeCatalog?.name || activeWorkTitle || activeEpisode?.name || "还没有选择片源";
  const activePlaybackSource = sources.find((source) => source.id === activeEpisode?.sourceId);
  const directAlternativeSource = sources.find((source) => source.transport === "direct" && source.id !== (activeEpisode?.sourceId ?? sourceId));
  const isRelayPlayback = resolvedMedia?.via === "relay"
    || resolvedMedia?.transport === "relay"
    || activePlaybackSource?.transport === "relay";
  const activeSourceLabel = sources.find((source) => source.id === activeEpisode?.sourceId)?.name
    || activeEpisode?.sourceId
    || playback.sourceId
    || "等待片源";
  const activeMark = markFor(activeTitle);
  const stageTone = toneFor(activeTitle);
  const isSocketConnected = connectionState === "connected";
  const hostControlsEnabled = isHost && isSocketConnected;
  const selectedQuality = qualityLevels.find((level) => level.index === selectedQualityLevel);
  const canChangeQuality = resolvedMedia?.kind === "hls" && qualityManualAvailable && qualityLevels.length > 1;
  const qualityChipLabel = resolvedMedia?.kind === "mp4"
    ? "MP4"
    : canChangeQuality
      ? selectedQuality?.label ?? "AUTO"
      : qualityMode === "single"
        ? "SINGLE"
        : resolvedMedia?.kind === "hls"
          ? "AUTO"
          : "AUTO";
  const visibleDanmaku = danmakuMessages.filter((message) => {
    if (!danmakuSettings.enabled) return false;
    const age = videoPosition - message.videoTime;
    const lifetime = message.mode === "scroll" ? 8 : 4;
    if (age < -1 || age > lifetime) return false;
    if (message.mode === "scroll") return danmakuSettings.showScroll;
    if (message.mode === "top") return danmakuSettings.showTop;
    return danmakuSettings.showBottom;
  });
  const activeEpisodeIndex = activeEpisodes.findIndex((episode) => episode.key === activeEpisode?.key);
  const hasNextEpisode = activeEpisodeIndex >= 0 && activeEpisodeIndex < activeEpisodes.length - 1;
  const connectionLabel = connectionState === "connected"
    ? "同步正常"
    : connectionState === "connecting"
      ? "连接中"
      : connectionState === "reconnecting"
        ? "正在重连"
        : connectionState === "error"
          ? "连接中断"
          : "未进入房间";

  const mediaMatchesPlayback = useCallback((mediaKey: string, current: PlaybackState): boolean => {
    const authoritativeKey = episodeKeyFromPlayback(current);
    if (mediaKey === authoritativeKey) return true;
    return Boolean(
      localEpisodeOverrideRef.current
      && localOverridePlaybackKeyRef.current === authoritativeKey
      && activeEpisodeRef.current?.key === mediaKey,
    );
  }, []);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    nicknameRef.current = nickname;
  }, [nickname]);

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  useEffect(() => {
    activeEpisodeRef.current = activeEpisode;
  }, [activeEpisode]);

  const applyAuthoritativePlayback = useCallback((next: PlaybackState, force = false) => {
    if (!force && next.revision < playbackRef.current.revision) return;
    const previous = playbackRef.current;
    const pendingCatalogId = pendingCatalogIdRef.current;
    if (pendingCatalogId && next.catalogId === pendingCatalogId) pendingCatalogIdRef.current = null;
    else if (pendingCatalogId && next.revision > previous.revision) pendingCatalogIdRef.current = null;
    playbackRef.current = next;
    setPlayback(next);
    setPlaybackRate(next.playbackRate);
    const nextEpisode = playbackEpisode(next);
    const nextPlaybackKey = episodeKeyFromPlayback(next);
    const keepLocalOverride = Boolean(
      localEpisodeOverrideRef.current
      && nextPlaybackKey
      && localOverridePlaybackKeyRef.current === nextPlaybackKey,
    );
    if (!keepLocalOverride) {
      localEpisodeOverrideRef.current = false;
      localOverridePlaybackKeyRef.current = null;
      setActiveEpisode((current) => {
        if (!nextEpisode) return null;
        if (current?.key === nextEpisode.key) {
          const nextName = nextEpisode.name || current.name;
          return nextName === current.name ? current : { ...current, name: nextName };
        }
        return nextEpisode;
      });
      setActiveCatalog((current) => current?.id === next.catalogId ? current : null);
      if (next.catalogId !== previous.catalogId) setActiveWorkTitle(next.episodeName || "");
    }
  }, []);

  const applyRoomSnapshot = useCallback((next: RoomSnapshot) => {
    if (roomRef.current?.code === next.code && next.playback.revision < playbackRef.current.revision) return;
    roomRef.current = next;
    setRoom(next);
    applyAuthoritativePlayback(next.playback, true);
    setRoomError("");
  }, [applyAuthoritativePlayback]);

  const refreshRoomState = useCallback(async () => {
    if (!roomCode) return;
    try {
      const next = parseRoomSnapshot(await requestJson<unknown>(`/api/rooms/${encodeURIComponent(roomCode)}`));
      if (!next) throw new Error("invalid_room_snapshot");
      if (memberId && !next.members.some((member) => member.id === memberId)) {
        setRoomError("这个房间身份已经失效，请重新输入昵称加入。 ");
        setConnectionState("error");
        return;
      }
      applyRoomSnapshot(next);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "room_not_found") {
        setRoomError("房间已不存在，请重新创建或加入其他房间。 ");
        setConnectionState("error");
      }
    }
  }, [applyRoomSnapshot, memberId, roomCode]);

  const persistIdentity = useCallback((nextRoom: RoomSnapshot, nextMember: RoomMember, nextNickname: string) => {
    const code = normalizeCode(nextRoom.code);
    const name = nextNickname.trim().slice(0, 32) || nextMember.nickname || "Guest";
    sessionStorage.setItem(ROOM_STORAGE_KEY, code);
    sessionStorage.setItem(memberStorageKey(code), nextMember.id);
    sessionStorage.removeItem(LEGACY_MEMBER_STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_NICKNAME_STORAGE_KEY);
    sessionStorage.setItem(nicknameStorageKey(code), name);
    localEpisodeOverrideRef.current = false;
    localOverridePlaybackKeyRef.current = null;
    window.history.replaceState({}, "", `${window.location.pathname}?room=${encodeURIComponent(code)}`);
    setRoomCode(code);
    setChatMessages(loadStoredChatMessages(code));
    setNickname(name);
    setMemberId(nextMember.id);
    setPendingInviteCode("");
    applyRoomSnapshot(nextRoom);
    setRoomDialogOpen(false);
    setRoomError("");
  }, [applyRoomSnapshot]);

  const openRoomDialog = useCallback((mode: "create" | "join" | "invite" | "rename") => {
    setDialogMode(mode);
    if (mode === "join" && roomCode) setJoinCode(roomCode);
    if (mode === "create" && !roomCode) setPendingInviteCode("");
    if (mode === "rename") {
      setRenameDraft(currentMember?.nickname ?? nickname);
      setRenameBusy(false);
    }
    setRoomDialogOpen(true);
  }, [currentMember?.nickname, nickname, roomCode]);

  const createRoom = useCallback(async () => {
    const name = nickname.trim().slice(0, 32);
    if (!name) {
      toast.error("请输入昵称");
      return;
    }
    setRoomRequestBusy(true);
    setRoomError("");
    try {
      const result = await requestJson<RoomJoinResult>("/api/rooms", {
        method: "POST",
        body: JSON.stringify({ nickname: name }),
      });
      persistIdentity(result.room, result.member, name);
      toast.success("观影房已创建", { description: `房间码 ${result.room.code}，可以邀请朋友加入了。` });
    } catch (error) {
      const message = error instanceof ApiRequestError ? error.message : "暂时无法创建观影房。";
      setRoomError(message);
      toast.error("创建房间失败", { description: message });
    } finally {
      setRoomRequestBusy(false);
    }
  }, [nickname, persistIdentity]);

  const joinRoom = useCallback(async () => {
    const code = normalizeCode(joinCode);
    const name = nickname.trim().slice(0, 32);
    if (!code) {
      toast.error("请输入房间码");
      return;
    }
    if (!name) {
      toast.error("请输入昵称");
      return;
    }
    setRoomRequestBusy(true);
    setRoomError("");
    try {
      const result = await requestJson<RoomJoinResult>(`/api/rooms/${encodeURIComponent(code)}/join`, {
        method: "POST",
        body: JSON.stringify({ nickname: name }),
      });
      persistIdentity(result.room, result.member, name);
      toast.success("已进入观影房", { description: `房间 ${result.room.code} 正在同步。` });
    } catch (error) {
      const message = error instanceof ApiRequestError && error.code === "room_not_found"
        ? "没有找到这个房间，请检查房间码。"
        : error instanceof ApiRequestError ? error.message : "暂时无法加入观影房。";
      setRoomError(message);
      toast.error("加入房间失败", { description: message });
    } finally {
      setRoomRequestBusy(false);
    }
  }, [joinCode, nickname, persistIdentity]);

  const isWebSocketOpen = useCallback(() => websocketRef.current?.readyState === WebSocket.OPEN, []);

  const renameMember = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextNickname = renameDraft.trim().slice(0, 32);
    if (!room || !memberId) {
      toast.info("请先进入房间");
      return;
    }
    if (!nextNickname) {
      toast.error("昵称不能为空");
      return;
    }
    if (!isWebSocketOpen()) {
      toast.info("房间正在重连，连接恢复后才能修改昵称");
      return;
    }
    setRenameBusy(true);
    const sent = websocketSendRef.current?.({ type: "member.rename", nickname: nextNickname }) ?? false;
    if (!sent) {
      setRenameBusy(false);
      toast.info("房间正在重连，昵称暂未更新");
    }
  }, [isWebSocketOpen, memberId, renameDraft, room]);

  const copyInvite = useCallback(async () => {
    if (!roomCode) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomCode)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("邀请链接已复制", { description: shareUrl });
    } catch {
      toast.info(`邀请链接：${shareUrl}`);
    }
  }, [roomCode]);

  const sendHostPlayback = useCallback((overrides: PlaybackCommand): boolean => {
    if (!isHost) {
      toast.info("只有房主可以控制播放");
      return false;
    }
    if (!isWebSocketOpen()) {
      setRoomError("房间正在重连，连接恢复前不能修改播放状态。 ");
      return false;
    }
    const video = videoRef.current;
    const current = playbackRef.current;
    const active = activeEpisodeRef.current;
    const command: PlaybackCommand = {
      paused: overrides.paused ?? (video?.paused ?? current.paused),
      position: overrides.position ?? (video?.currentTime ?? current.position),
      playbackRate: overrides.playbackRate ?? (video?.playbackRate || current.playbackRate || playbackRate),
      catalogId: overrides.catalogId ?? selectedCatalog?.id ?? current.catalogId ?? null,
      sourceId: overrides.sourceId ?? active?.sourceId ?? current.sourceId ?? null,
      episodeId: overrides.episodeId ?? active?.id ?? current.episodeId ?? null,
      episodeUrl: overrides.episodeUrl ?? active?.url ?? current.episodeUrl ?? null,
      episodeName: overrides.episodeName ?? active?.name ?? current.episodeName ?? null,
    };
    const sent = websocketSendRef.current?.({ type: "playback.command", command }) ?? false;
    if (!sent) setRoomError("房间正在重连，播放操作会在连接恢复后才能发送。 ");
    return sent;
  }, [isHost, isWebSocketOpen, playbackRate, selectedCatalog?.id]);

  const selectEpisode = useCallback((episode: ActiveEpisode) => {
    if (!isWebSocketOpen()) {
      setRoomError("房间正在重连，连接恢复前不能换集。 ");
      return;
    }
    const wasPlaying = Boolean(videoRef.current && !videoRef.current.paused && !playbackRef.current.paused);
    if (!isHost) {
      const authoritativeKey = episodeKeyFromPlayback(playbackRef.current);
      if (!authoritativeKey) {
        toast.info("房主还没有选择正在播放的内容");
        return;
      }
      localEpisodeOverrideRef.current = true;
      localOverridePlaybackKeyRef.current = authoritativeKey;
      setActiveCatalog(selectedCatalog);
      setActiveWorkTitle(selectedCatalog?.nameCn || selectedCatalog?.name || selectedSourceMatch?.title || episode.name);
      setActiveEpisode(episode);
      const target = predictedPosition(playbackRef.current, serverOffsetRef.current);
      setVideoPosition(target);
      setScrubPosition(target);
      setIsPlaying(wasPlaying);
      toast.success("已在本机切换片源", { description: "不会改变房间内容，播放进度继续跟随房主。" });
      return;
    }
    if (!sendHostPlayback({
      paused: !wasPlaying,
      position: 0,
      playbackRate,
      catalogId: selectedCatalog?.id ?? playbackRef.current.catalogId ?? null,
      sourceId: episode.sourceId,
      episodeId: episode.id,
      episodeUrl: episode.url,
      episodeName: episode.name,
    })) return;
    localEpisodeOverrideRef.current = false;
    localOverridePlaybackKeyRef.current = null;
    pendingCatalogIdRef.current = selectedCatalog?.id ?? null;
    setActiveCatalog(selectedCatalog);
    setActiveWorkTitle(selectedCatalog?.nameCn || selectedCatalog?.name || selectedSourceMatch?.title || episode.name);
    setActiveEpisode(episode);
    setVideoPosition(0);
    setScrubPosition(0);
    setIsPlaying(wasPlaying);
  }, [isHost, isWebSocketOpen, playbackRate, selectedCatalog, selectedSourceMatch?.title, sendHostPlayback]);

  const openSourceSwitcher = useCallback(() => {
    const title = activeCatalog?.nameCn || activeCatalog?.name || activeWorkTitle;
    if (title) setSearch(title);
    document.getElementById("history")?.scrollIntoView({ behavior: "smooth", block: "start" });
    toast.info("播放中也可以换片源", { description: "选择片源、搜索作品，再点击新的分集即可切换。" });
  }, [activeCatalog?.name, activeCatalog?.nameCn, activeWorkTitle]);

  const switchToDirectSource = useCallback(() => {
    if (!directAlternativeSource) {
      openSourceSwitcher();
      return;
    }
    const title = activeCatalog?.nameCn || activeCatalog?.name || activeWorkTitle;
    setSourceId(directAlternativeSource.id);
    setSelectedSourceMatch(null);
    setSelectedCatalog(null);
    setRoads([]);
    setSelectedRoad(0);
    setChaptersError("");
    setSearchResults([]);
    setSearchError("");
    setCatalogMetadataError("");
    if (title) setSearch(title);
    document.getElementById("history")?.scrollIntoView({ behavior: "smooth", block: "start" });
    toast.info(`已切换到直连片源 ${directAlternativeSource.name}`, { description: "请在搜索结果中选择作品和分集。" });
  }, [activeCatalog?.name, activeCatalog?.nameCn, activeWorkTitle, directAlternativeSource, openSourceSwitcher]);

  const loadChapters = useCallback(async (work: SourceSearchItem) => {
    setSelectedSourceMatch(work);
    setSelectedCatalog(work.catalog);
    setSourceId(work.sourceId);
    setChaptersLoading(true);
    setChaptersError("");
    setRoads([]);
    setSelectedRoad(0);
    try {
      const result = parseRoads(await requestJson<unknown>(`/api/source/chapters?sourceId=${encodeURIComponent(work.sourceId)}&detailUrl=${encodeURIComponent(work.detailUrl)}`));
      if (!result.length) throw new Error("no_chapters");
      setRoads(result);
      toast.success(`《${work.title}》已加载`, { description: `${result.length} 条线路，可以选择集数了。` });
      window.setTimeout(() => document.getElementById("queue")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    } catch (error) {
      const message = error instanceof ApiRequestError ? sourceErrorFor(error).message : "没有解析到可用的线路和集数。";
      setChaptersError(message);
      toast.error("分集加载失败", { description: message });
    } finally {
      setChaptersLoading(false);
    }
  }, []);

  const retryCurrentResolve = useCallback(() => {
    const episode = activeEpisodeRef.current;
    if (!episode) return;
    if (resolveRetryKeyRef.current === episode.key) {
      setMediaState("error");
      setSourceError({ code: "resolve_failed", message: "新的播放地址也已失效，请稍后再试。" });
      return;
    }
    resolveRetryKeyRef.current = episode.key;
    setResolvedMedia(null);
    setSourceError(null);
    setMediaState("resolving");
    setResolveNonce((value) => value + 1);
    toast.info("播放地址已失效，正在重新获取");
  }, []);

  const retryResolveManually = useCallback(() => {
    if (sourceError?.code === "relay_capacity") {
      toast.info("兼容线路繁忙，请切换直连片源或其他片源");
      return;
    }
    const now = Date.now();
    const waitMs = 15_000 - (now - lastManualResolveRetryAtRef.current);
    if (waitMs > 0) {
      toast.info(`请等待 ${Math.ceil(waitMs / 1_000)} 秒后再重新获取`);
      return;
    }
    lastManualResolveRetryAtRef.current = now;
    resolveRetryKeyRef.current = null;
    setSourceError(null);
    setResolvedMedia(null);
    setMediaState("resolving");
    setResolveNonce((value) => value + 1);
  }, [sourceError?.code]);

  const handleRateChange = useCallback((value: string) => {
    const nextRate = Number(value);
    if (!Number.isFinite(nextRate)) return;
    if (!isHost) {
      toast.info("只有房主可以调整倍速");
      return;
    }
    if (!isWebSocketOpen()) {
      setRoomError("房间正在重连，连接恢复前不能调整倍速。 ");
      return;
    }
    if (!sendHostPlayback({ playbackRate: nextRate })) return;
    setPlaybackRate(nextRate);
    if (videoRef.current) videoRef.current.playbackRate = nextRate;
  }, [isHost, isWebSocketOpen, sendHostPlayback]);

  const handleVolumeChange = useCallback((value: number[]) => {
    const nextVolume = clamp(value[0] ?? 0, 0, 1);
    setVolume(nextVolume);
    setIsMuted(nextVolume === 0);
    const video = videoRef.current;
    if (video) {
      video.volume = nextVolume;
      video.muted = nextVolume === 0;
    }
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    const nextVolume = nextMuted ? volume : volume > 0 ? volume : 0.8;
    setVolume(nextVolume);
    setIsMuted(nextMuted);
    const video = videoRef.current;
    if (video) {
      video.volume = nextVolume;
      video.muted = nextMuted;
    }
  }, [isMuted, volume]);

  const handleQualityChange = useCallback((value: string) => {
    if (value === "auto") {
      if (hlsRef.current) {
        hlsRef.current.currentLevel = -1;
        hlsRef.current.nextLevel = -1;
      }
      setSelectedQualityLevel(-1);
      return;
    }
    const nextLevel = Number(value);
    if (!Number.isInteger(nextLevel) || !qualityManualAvailable || !hlsRef.current) return;
    hlsRef.current.currentLevel = nextLevel;
    hlsRef.current.nextLevel = nextLevel;
    setSelectedQualityLevel(nextLevel);
  }, [qualityManualAvailable]);

  const handlePlayToggle = useCallback(() => {
    const video = videoRef.current;
    if (!video || !activeEpisodeRef.current || !videoReady) {
      toast.info("请先搜索并选择一集可播放的内容");
      return;
    }
    if (!isHost) {
      toast.info("播放由房主控制，其他成员会自动跟随");
      return;
    }
    if (!isWebSocketOpen()) {
      setRoomError("房间正在重连，连接恢复前不能修改播放状态。 ");
      return;
    }
    if (video.paused) {
      if (!sendHostPlayback({ paused: false, position: video.currentTime })) return;
      void video.play()
        .catch(() => {
          toast.error("浏览器阻止了播放，请再次点击播放");
        });
    } else {
      if (!sendHostPlayback({ paused: true, position: video.currentTime })) return;
      video.pause();
    }
  }, [isHost, isWebSocketOpen, sendHostPlayback, videoReady]);

  const resumeLocalPlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      const current = playbackRef.current;
      const active = activeEpisodeRef.current;
      if (active && mediaMatchesPlayback(active.key, current)) {
        video.currentTime = predictedPosition(current, serverOffsetRef.current);
        setVideoPosition(video.currentTime);
        setScrubPosition(video.currentTime);
      }
      setAutoplayBlocked(false);
    } catch {
      setAutoplayBlocked(true);
      toast.error("浏览器仍阻止播放，请先允许此页面播放媒体");
    }
  }, [mediaMatchesPlayback]);

  const handleSeekCommit = useCallback((value: number) => {
    if (!isHost) return;
    if (!isWebSocketOpen()) {
      setIsScrubbing(false);
      setScrubPosition(videoRef.current?.currentTime ?? 0);
      setRoomError("房间正在重连，连接恢复前不能拖动进度。 ");
      return;
    }
    const video = videoRef.current;
    if (!sendHostPlayback({ position: value })) return;
    setIsScrubbing(false);
    setScrubPosition(value);
    if (video) video.currentTime = value;
  }, [isHost, isWebSocketOpen, sendHostPlayback]);

  const seekRelative = useCallback((delta: number) => {
    if (!isHost) return;
    if (!isWebSocketOpen()) {
      setRoomError("房间正在重连，连接恢复前不能调整进度。 ");
      return;
    }
    const video = videoRef.current;
    if (!video || !videoReady) return;
    const maximum = videoDuration > 0 ? videoDuration : Number.MAX_SAFE_INTEGER;
    const next = clamp(video.currentTime + delta, 0, maximum);
    if (!sendHostPlayback({ position: next })) return;
    video.currentTime = next;
    setVideoPosition(next);
    setScrubPosition(next);
  }, [isHost, isWebSocketOpen, sendHostPlayback, videoDuration, videoReady]);

  const handleNextEpisode = useCallback(() => {
    if (!hostControlsEnabled || !hasNextEpisode) return;
    const next = activeEpisodes[activeEpisodeIndex + 1];
    if (next) selectEpisode(next);
  }, [activeEpisodeIndex, activeEpisodes, hasNextEpisode, hostControlsEnabled, selectEpisode]);

  const sendDanmaku = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = danmakuDraft.trim();
    if (!text) return;
    if (!room || !isWebSocketOpen()) {
      toast.info("进入房间并等待同步连接后才能发送弹幕");
      return;
    }
    const sent = websocketSendRef.current?.({
      type: "danmaku.send",
      text: text.slice(0, 120),
      color: danmakuColor,
      mode: danmakuMode,
    }) ?? false;
    if (!sent) {
      toast.info("房间正在重连，弹幕暂未发送");
      return;
    }
    setDanmakuDraft("");
  }, [danmakuColor, danmakuDraft, danmakuMode, isWebSocketOpen, room]);

  const updateDanmakuEnabled = useCallback((enabled: boolean) => {
    danmakuEnabledRef.current = enabled;
    setDanmakuSettings((current) => ({ ...current, enabled }));
    if (!enabled) setDanmakuMessages([]);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    const next = stored || (window.crypto.randomUUID?.() ?? `maku-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    if (!stored) localStorage.setItem(CLIENT_ID_STORAGE_KEY, next);
    setClientId(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    let retryAttempt = 0;

    const scheduleRetry = (error?: unknown) => {
      const retryAfter = error instanceof ApiRequestError && typeof error.details.retryAfterMs === "number"
        ? Math.max(0, error.details.retryAfterMs)
        : undefined;
      const delay = retryAfter ?? SOURCE_RETRY_DELAYS_MS[retryAttempt];
      retryAttempt += 1;
      if (delay !== undefined) retryTimer = window.setTimeout(loadSources, delay);
    };

    const loadSources = () => {
      if (cancelled) return;
      setSourceListLoading(true);
      setSourceListError("");
      void requestJson<unknown>("/api/sources")
        .then((value) => {
          if (cancelled) return;
          const nextSources = parseSources(value);
          setSources(nextSources);
          setSourceListError(nextSources.length ? "" : "后端暂时没有可用片源。");
          setSourceId((current) => current && nextSources.some((source) => source.id === current)
            ? current
            : nextSources[0]?.id ?? "");
          setSourceListLoading(false);
          if (!nextSources.length) scheduleRetry();
        })
        .catch((error) => {
          if (cancelled) return;
          setSourceListLoading(false);
          setSourceListError(error instanceof ApiRequestError ? error.message : "片源列表加载失败，请稍后重试。");
          scheduleRetry(error);
        });
    };

    loadSources();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [sourceReloadNonce]);

  useEffect(() => {
    const query = search.trim();
    if (query.length < 2 || !sourceId) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError("");
      setCatalogMetadataError("");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      setSearchError("");
      setCatalogMetadataError("");
      const sourceSearch = requestJson<unknown>(`/api/source/search?sourceId=${encodeURIComponent(sourceId)}&q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      });
      const catalogSearch = requestJson<unknown>(`/api/catalog/search?q=${encodeURIComponent(query)}&limit=20&offset=0`, {
        signal: controller.signal,
      });
      void Promise.allSettled([sourceSearch, catalogSearch]).then(([sourceResult, catalogResult]) => {
        if (controller.signal.aborted) return;
        if (sourceResult.status === "rejected") {
          setSearchResults([]);
          setSearchError(sourceResult.reason instanceof ApiRequestError ? sourceErrorFor(sourceResult.reason).message : "片源搜索失败，请稍后重试。");
          return;
        }
        const sourceResults = parseSearchResults(sourceResult.value);
        const catalogResults = catalogResult.status === "fulfilled" ? parseCatalogSearchItems(catalogResult.value) : [];
        setSearchResults(enrichSearchResults(sourceResults, catalogResults));
        if (catalogResult.status === "rejected") {
          setCatalogMetadataError("Bangumi 元数据暂时不可用，已显示片源搜索结果。");
        }
      }).finally(() => {
        if (!controller.signal.aborted) setSearchLoading(false);
      });
    }, 420);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [search, sourceId]);

  useEffect(() => {
    const catalogId = playback.catalogId;
    if (localEpisodeOverrideRef.current) return;
    if (!catalogId) {
      setActiveCatalog(null);
      return;
    }
    if (activeCatalog?.id === catalogId) return;
    if (pendingCatalogIdRef.current && pendingCatalogIdRef.current !== catalogId) return;
    let cancelled = false;
    void requestJson<unknown>(`/api/catalog/${encodeURIComponent(String(catalogId))}`)
      .then((value) => {
        if (cancelled) return;
        const next = parseCatalogItem(value);
        if (next && playbackRef.current.catalogId === catalogId) {
          setActiveCatalog(next);
          setActiveWorkTitle(next.nameCn || next.name);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeCatalog?.id, playback.catalogId]);

  useEffect(() => {
    const queryCode = normalizeCode(new URLSearchParams(window.location.search).get("room") ?? "");
    const storedCode = normalizeCode(sessionStorage.getItem(ROOM_STORAGE_KEY) ?? "");
    const freshNickname = createRandomNickname();
    setNickname(freshNickname);
    sessionStorage.removeItem(LEGACY_NICKNAME_STORAGE_KEY);
    setPendingInviteCode(queryCode);
    if (queryCode) setJoinCode(queryCode);
    if (bootstrapRef.current) return;
    bootstrapRef.current = true;

    const candidateCode = queryCode || storedCode;
    if (!candidateCode || (queryCode && queryCode !== storedCode)) {
      setDialogMode(queryCode ? "join" : "create");
      setRoomDialogOpen(true);
      setIsBootstrapping(false);
      return;
    }
    let storedMember = sessionStorage.getItem(memberStorageKey(candidateCode)) ?? "";
    if (!storedMember) {
      const legacyMember = sessionStorage.getItem(LEGACY_MEMBER_STORAGE_KEY) ?? "";
      if (legacyMember) {
        storedMember = legacyMember;
        sessionStorage.setItem(memberStorageKey(candidateCode), legacyMember);
        sessionStorage.removeItem(LEGACY_MEMBER_STORAGE_KEY);
      }
    }
    if (!storedMember) {
      setDialogMode("join");
      setJoinCode(candidateCode);
      setRoomDialogOpen(true);
      setIsBootstrapping(false);
      return;
    }

    let cancelled = false;
    void requestJson<unknown>(`/api/rooms/${encodeURIComponent(candidateCode)}`)
      .then((value) => {
        if (cancelled) return;
        const restored = parseRoomSnapshot(value);
        const restoredMember = restored?.members.find((member) => member.id === storedMember);
        if (!restored || !restoredMember) {
          sessionStorage.removeItem(memberStorageKey(candidateCode));
          setDialogMode("join");
          setJoinCode(candidateCode);
          setRoomDialogOpen(true);
          setRoomError("原房间身份已失效，请重新输入昵称加入。 ");
          return;
        }
        sessionStorage.setItem(ROOM_STORAGE_KEY, restored.code);
        setRoomCode(restored.code);
        setChatMessages(loadStoredChatMessages(restored.code));
        setMemberId(storedMember);
        const restoredNickname = restoredMember.nickname
          || sessionStorage.getItem(nicknameStorageKey(restored.code))
          || freshNickname;
        setNickname(restoredNickname);
        sessionStorage.setItem(nicknameStorageKey(restored.code), restoredNickname);
        setPendingInviteCode("");
        applyRoomSnapshot(restored);
        setRoomDialogOpen(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDialogMode(queryCode ? "join" : "create");
        setJoinCode(candidateCode);
        setRoomDialogOpen(true);
        setRoomError("暂时无法恢复原房间，请重新连接或加入房间。 ");
      })
      .finally(() => {
        if (!cancelled) setIsBootstrapping(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyRoomSnapshot]);

  useEffect(() => {
    if (!roomCode) return;
    try {
      sessionStorage.setItem(chatStorageKey(roomCode), JSON.stringify(chatMessages.slice(-100)));
    } catch {
      // Session storage is best-effort; live room messaging must keep working if it is unavailable.
    }
  }, [chatMessages, roomCode]);

  useEffect(() => {
    if (!roomCode || !memberId) {
      websocketRef.current = null;
      websocketSendRef.current = null;
      if (!roomCode) setConnectionState("idle");
      return;
    }
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectStartedAt: number | null = null;
    let reconnectAttempt = 0;

    const send = (message: unknown): boolean => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      const elapsed = reconnectStartedAt ? Date.now() - reconnectStartedAt : 0;
      if (elapsed >= RECONNECT_WINDOW_MS) {
        setConnectionState("error");
        setRoomError("连接超过 20 秒仍未恢复，请重新加入房间。 ");
        return;
      }
      setConnectionState("reconnecting");
      const delay = Math.min(750 * (2 ** reconnectAttempt), 4_000);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    };

    const handleMessage = (message: RoomSocketMessage) => {
      if (message.type === "room.snapshot") {
        const next = parseRoomSnapshot(message.room);
        if (!next) return;
        if (!next.members.some((member) => member.id === memberId)) {
          setConnectionState("error");
          setRoomError("房间身份已经失效，请重新输入昵称加入。 ");
          return;
        }
        applyRoomSnapshot(next);
        return;
      }
      if (message.type === "member.renamed") {
        const nextNickname = stringValue(message.nickname);
        if (!nextNickname) return;
        setNickname(nextNickname);
        setRenameDraft(nextNickname);
        setRenameBusy(false);
        if (roomCode) sessionStorage.setItem(nicknameStorageKey(roomCode), nextNickname);
        setRoomDialogOpen(false);
        toast.success("昵称已更新", { description: "已同步到房间成员列表。" });
        return;
      }
      if (message.type === "room.playback") {
        applyAuthoritativePlayback(parsePlayback(message.playback));
        return;
      }
      if (message.type === "danmaku.message") {
        const next = parseDanmakuMessage(message);
        if (!next) return;
        if (danmakuEnabledRef.current) {
          setDanmakuMessages((messages) => [...messages.filter((item) => item.id !== next.id), next].slice(-240));
        }
        setChatMessages((messages) => [
          ...messages.filter((item) => item.id !== `danmaku:${next.id}`).slice(-99),
          {
            id: `danmaku:${next.id}`,
            memberId: next.by || "unknown",
            name: next.nickname,
            time: formatClock(next.sentAt),
            text: next.text,
            color: next.by === memberId ? "avatar-mint" : avatarToneFor(next.nickname),
            kind: "danmaku",
            self: next.by === memberId,
          },
        ]);
        return;
      }
      if (message.type === "chat.message") {
        const sender = roomRef.current?.members.find((member) => member.id === message.by);
        const senderName = sender?.nickname ?? (message.by === memberId ? nicknameRef.current : "成员");
        const sentAt = numberValue(message.sentAt, Date.now());
        const text = stringValue(message.text);
        const messageId = `chat:${sentAt}:${message.by ?? "unknown"}:${text}`;
        setChatMessages((messages) => [
          ...messages.filter((item) => item.id !== messageId).slice(-99),
          {
            id: messageId,
            memberId: message.by ?? "unknown",
            name: senderName,
            time: formatClock(sentAt),
            text,
            color: message.by === memberId ? "avatar-mint" : avatarToneFor(senderName),
            kind: "chat",
            self: message.by === memberId,
          },
        ]);
        if (text && danmakuEnabledRef.current) {
          const videoTime = videoRef.current?.currentTime ?? predictedPosition(playbackRef.current, serverOffsetRef.current);
          setDanmakuMessages((messages) => [...messages.filter((item) => item.id !== messageId), {
            id: messageId,
            by: message.by ?? "unknown",
            nickname: senderName,
            text,
            color: "#FFFFFF",
            mode: "scroll",
            videoTime,
            sentAt,
          }].slice(-240));
        }
        return;
      }
      if (message.type === "sync.pong") {
        const clientTime = numberValue(message.clientTime, 0);
        const serverTime = numberValue(message.serverTime, 0);
        if (clientTime && serverTime) {
          const now = Date.now();
          serverOffsetRef.current = serverTime + (now - clientTime) / 2 - now;
        }
        return;
      }
      if (message.type === "error") {
        if (message.code === "host_only") toast.info("只有房主可以执行这个播放操作");
        else if (message.code === "invalid_room_or_member") setRoomError("房间身份已经失效，请重新加入。 ");
        else if (message.code === "member_rename_failed") {
          setRenameBusy(false);
          toast.error("昵称更新失败", { description: "当前成员身份已经失效，请重新加入房间。" });
        }
        else if (message.code === "rate_limited") toast.info(message.scope === "danmaku" ? "弹幕发送太频繁，请稍后再试" : "聊天发送太频繁，请稍后再试");
        else if (message.code === "invalid_message") toast.error("房间消息格式无效，请稍后再试");
        else if (message.code) toast.error("房间同步错误", { description: message.message || message.code });
      }
    };

    const connect = () => {
      if (disposed) return;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      setConnectionState(reconnectAttempt ? "reconnecting" : "connecting");
      socket = new WebSocket(`${WS_BASE}?room=${encodeURIComponent(roomCode)}&member=${encodeURIComponent(memberId)}`);
      websocketRef.current = socket;
      websocketSendRef.current = send;
      socket.onopen = () => {
        if (websocketRef.current !== socket) return;
        reconnectAttempt = 0;
        reconnectStartedAt = null;
        setConnectionState("connected");
        setRoomError("");
        send({ type: "sync.ping", clientTime: Date.now() });
      };
      socket.onmessage = (event) => {
        try {
          handleMessage(JSON.parse(String(event.data)) as RoomSocketMessage);
        } catch {
          toast.error("收到无法识别的房间消息");
        }
      };
      socket.onerror = () => {
        if (!disposed) setConnectionState("reconnecting");
      };
      socket.onclose = (event) => {
        if (disposed) return;
        setRenameBusy(false);
        websocketSendRef.current = null;
        if (websocketRef.current === socket) websocketRef.current = null;
        if (event.code === 1008) {
          if (event.reason.includes("ip_connection_limit")) {
            setConnectionState("error");
            setRoomError("当前网络连接数已达上限，请稍后重试。 ");
            reconnectStartedAt ??= Date.now();
            scheduleReconnect();
            return;
          }
          setConnectionState("error");
          setRoomError("房间身份已经失效，请重新输入昵称加入。 ");
          sessionStorage.removeItem(memberStorageKey(roomCode));
          setDialogMode("join");
          setJoinCode(roomCode);
          setRoomDialogOpen(true);
          return;
        }
        if (event.code === 1013) {
          setConnectionState("error");
          setRoomError("服务器当前繁忙，正在尝试重新连接。 ");
        }
        reconnectStartedAt ??= Date.now();
        scheduleReconnect();
      };
    };

    const sendPing = () => send({ type: "sync.ping", clientTime: Date.now() });
    const pingTimer = window.setInterval(sendPing, WS_PING_INTERVAL_MS);
    const handleVisibility = () => {
      if (!document.hidden) {
        sendPing();
        void refreshRoomState();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    connect();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(pingTimer);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      websocketRef.current = null;
      websocketSendRef.current = null;
      socket?.close(1000, "switching_room");
    };
  }, [applyAuthoritativePlayback, applyRoomSnapshot, memberId, refreshRoomState, roomCode]);

  useEffect(() => {
    if (!activeEpisodeKey) {
      setResolvedMedia(null);
      setMediaState("idle");
      setSourceError(null);
      setVideoReady(false);
      setAutoplayBlocked(false);
      rebufferingRef.current = false;
      setIsRebuffering(false);
      resolveRetryKeyRef.current = null;
      return;
    }
    setAutoplayBlocked(false);
    resolveRetryKeyRef.current = null;
    lastManualResolveRetryAtRef.current = 0;
  }, [activeEpisodeKey]);

  useEffect(() => {
    setDanmakuMessages([]);
  }, [playback.sourceId, playback.episodeId, playback.episodeUrl]);

  useEffect(() => {
    const episode = activeEpisode;
    if (!episode || !clientId) return;
    const requestId = ++resolveRequestIdRef.current;
    let cancelled = false;
    setResolvedMedia(null);
    setMediaState("resolving");
    setSourceError(null);
    setVideoReady(false);
    void requestJson<unknown>("/api/source/resolve", {
      method: "POST",
      body: JSON.stringify({ sourceId: episode.sourceId, episodeUrl: episode.url, clientId }),
    })
      .then((value) => {
        if (cancelled || requestId !== resolveRequestIdRef.current) return;
        if (isRecord(value) && stringValue(value.error) === "relay_capacity") {
          throw new ApiRequestError("relay_capacity", 503, "兼容线路当前容量已满，请切换其他片源。", value);
        }
        const media = parseResolvedMedia(value);
        if (!media) throw new Error("invalid_resolve_response");
        setResolvedMedia({ ...media, key: episode.key });
      })
      .catch((error) => {
        if (cancelled || requestId !== resolveRequestIdRef.current) return;
        setMediaState("error");
        setSourceError(sourceErrorFor(error));
      });
    return () => {
      cancelled = true;
    };
  }, [activeEpisode, clientId, resolveNonce]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    let cancelled = false;
    let readyMarked = false;
    let initialPositionApplied = false;
    setVideoReady(false);
    setMediaState(resolvedMedia ? "loading" : "idle");
    rebufferingRef.current = false;
    setIsRebuffering(false);
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (!resolvedMedia) return () => {
      cancelled = true;
    };

    video.crossOrigin = "anonymous";
    const applyInitialPosition = () => {
      if (initialPositionApplied || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
      initialPositionApplied = true;
      const current = playbackRef.current;
      if (!mediaMatchesPlayback(resolvedMedia.key, current)) return;
      const target = predictedPosition(current, serverOffsetRef.current);
      if (Math.abs(video.currentTime - target) > 0.25) video.currentTime = target;
      video.playbackRate = current.playbackRate;
      setPlaybackRate(current.playbackRate);
    };
    const finishStartupBuffer = () => {
      if (cancelled || readyMarked) return;
      applyInitialPosition();
      const current = playbackRef.current;
      const target = mediaMatchesPlayback(resolvedMedia.key, current)
        ? predictedPosition(current, serverOffsetRef.current)
        : video.currentTime;
      if (!hasBufferedAhead(video, STARTUP_BUFFER_SECONDS, target)) return;
      if (Math.abs(video.currentTime - target) > 0.25) video.currentTime = target;
      readyMarked = true;
      setMediaState("ready");
      setVideoReady(true);
      setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0);
      if (mediaMatchesPlayback(resolvedMedia.key, current)) {
        video.playbackRate = current.playbackRate;
        setPlaybackRate(current.playbackRate);
        if (!current.paused) void video.play().catch(() => setAutoplayBlocked(true));
      }
    };
    const clearRebuffering = () => {
      rebufferingRef.current = false;
      setIsRebuffering(false);
    };
    const recoverFromStall = () => {
      if (cancelled || !readyMarked || !rebufferingRef.current) return;
      const current = playbackRef.current;
      if (current.paused) {
        clearRebuffering();
        return;
      }

      // A media `waiting` event already stops frame progression by itself. Do not
      // keep the player paused while waiting for an ever-advancing room target to
      // become buffered: progressive MP4 origins may stop extending their range
      // while paused, which can deadlock recovery permanently. Resume from the
      // locally playable position first; normal room sync can correct drift after
      // media progression has restarted.
      const locallyPlayable = video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
        || hasBufferedAhead(video, STALL_LOCAL_RESUME_BUFFER_SECONDS, video.currentTime);
      if (!locallyPlayable) return;
      clearRebuffering();
      if (video.paused) void video.play().catch(() => setAutoplayBlocked(true));
    };
    const checkBuffer = () => {
      if (!readyMarked) finishStartupBuffer();
      else recoverFromStall();
    };
    const handleWaiting = () => {
      if (cancelled || !readyMarked || playbackRef.current.paused) return;
      rebufferingRef.current = true;
      setIsRebuffering(true);
      setAutoplayBlocked(false);
    };
    const handlePlaying = () => {
      if (!playbackRef.current.paused) setAutoplayBlocked(false);
      if (!rebufferingRef.current) return;
      const current = playbackRef.current;
      clearRebuffering();
      if (current.paused && !video.paused) video.pause();
    };
    const handleVideoError = () => {
      if (!cancelled) retryCurrentResolve();
    };
    video.addEventListener("error", handleVideoError);
    video.addEventListener("loadedmetadata", checkBuffer);
    video.addEventListener("durationchange", checkBuffer);
    video.addEventListener("progress", checkBuffer);
    video.addEventListener("canplay", checkBuffer);
    video.addEventListener("canplaythrough", checkBuffer);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("stalled", handleWaiting);
    video.addEventListener("playing", handlePlaying);
    const bufferCheckTimer = window.setInterval(checkBuffer, BUFFER_CHECK_INTERVAL_MS);

    if (resolvedMedia.kind === "hls") {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        setQualityManualAvailable(false);
        video.src = resolvedMedia.url;
        video.load();
      } else if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          maxBufferLength: HLS_FORWARD_BUFFER_SECONDS,
          maxMaxBufferLength: 120,
          backBufferLength: 60,
          fragLoadingTimeOut: 30_000,
          fragLoadingMaxRetry: 8,
          fragLoadingRetryDelay: 500,
          fragLoadingMaxRetryTimeout: 64_000,
          maxBufferHole: 0.5,
          nudgeMaxRetry: 5,
          xhrSetup(xhr, url) {
            if (url.includes(".ngrok-free.dev/") && url.includes("/api/media/")) {
              xhr.setRequestHeader("ngrok-skip-browser-warning", "1");
            }
          },
        });
        hlsRef.current = hls;
        const syncHlsQuality = () => {
          const levels = hls.levels.map((level, index) => ({
            index,
            label: level.name || qualityLabelFor({
              width: level.width || null,
              height: level.height || null,
              bandwidth: level.bitrate || null,
            }),
            width: level.width || null,
            height: level.height || null,
            bandwidth: level.bitrate || null,
            frameRate: level.frameRate || null,
            codecs: level.codecs || level.codecSet || null,
          }));
          setQualityLevels(levels);
          setQualityMode(levels.length > 1 ? "adaptive" : "single");
          setQualityManualAvailable(levels.length > 1);
          setSelectedQualityLevel((current) => levels.some((level) => level.index === current) ? current : -1);
        };
        hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(resolvedMedia.url));
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          syncHlsQuality();
          setMediaState("loading");
          checkBuffer();
        });
        hls.on(Hls.Events.FRAG_BUFFERED, checkBuffer);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (cancelled || !data.fatal) return;
          const status = numberValue((data as { response?: { code?: unknown } }).response?.code);
          const errorType = stringValue((data as { type?: unknown }).type).toLowerCase();
          if (status === 401 || status === 403 || errorType.includes("network")) {
            retryCurrentResolve();
          } else {
            setMediaState("error");
            setSourceError({ code: "resolve_failed", message: "HLS 播放器遇到不可恢复的媒体错误。" });
          }
        });
        hls.attachMedia(video);
      } else {
        setMediaState("error");
        setSourceError({ code: "resolve_failed", message: "当前浏览器不支持 HLS 播放。" });
      }
    } else {
      video.src = resolvedMedia.url;
      video.load();
    }
    return () => {
      cancelled = true;
      window.clearInterval(bufferCheckTimer);
      video.removeEventListener("error", handleVideoError);
      video.removeEventListener("loadedmetadata", checkBuffer);
      video.removeEventListener("durationchange", checkBuffer);
      video.removeEventListener("progress", checkBuffer);
      video.removeEventListener("canplay", checkBuffer);
      video.removeEventListener("canplaythrough", checkBuffer);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("stalled", handleWaiting);
      video.removeEventListener("playing", handlePlaying);
      rebufferingRef.current = false;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [mediaMatchesPlayback, resolvedMedia, retryCurrentResolve]);

  useEffect(() => {
    setSelectedQualityLevel(-1);
    setQualityManualAvailable(false);
    if (!resolvedMedia) {
      setQualityLevels([]);
      setQualityMode("unknown");
      return;
    }
    const quality = resolvedMedia.quality;
    setQualityLevels(quality?.levels ?? []);
    setQualityMode(resolvedMedia.kind === "mp4" ? "single" : quality?.mode ?? "unknown");
    setQualityManualAvailable(false);
  }, [resolvedMedia]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !resolvedMedia || !videoReady) return;
    if (!mediaMatchesPlayback(resolvedMedia.key, playback)) return;
    const target = predictedPosition(playback, serverOffsetRef.current);
    // While the media pipeline is rebuffering, let it regain forward progress
    // before applying room-time correction. Seeking every authoritative update
    // during a discontinuity can turn a short decoder transition into a retry
    // loop of waiting/pause/seek events.
    if (!rebufferingRef.current
      && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      && Math.abs(video.currentTime - target) > 1.1) {
      video.currentTime = target;
    }
    if (Math.abs(video.playbackRate - playback.playbackRate) > 0.01) video.playbackRate = playback.playbackRate;
    setPlaybackRate(playback.playbackRate);
    if (playback.paused) {
      setAutoplayBlocked(false);
      if (!video.paused) video.pause();
    }
    if (!playback.paused && video.paused && !rebufferingRef.current) void video.play().catch(() => setAutoplayBlocked(true));
    setVideoPosition(video.currentTime);
    if (!isScrubbing) setScrubPosition(video.currentTime);
  }, [isScrubbing, mediaMatchesPlayback, playback, resolvedMedia, videoReady]);

  useEffect(() => {
    const video = videoRef.current;
    const mediaKey = resolvedMedia?.key;
    if (!video || isHost || !mediaKey || !videoReady) return;
    const mediaVideo = video as HTMLVideoElement & {
      cancelVideoFrameCallback?: (handle: number) => void;
      getVideoPlaybackQuality?: () => { totalVideoFrames: number };
      requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number; presentedFrames: number }) => void) => number;
    };
    let cancelled = false;
    let frameRequestId: number | null = null;
    let lastRenderedMediaTime = video.currentTime;
    let lastPresentedFrames: number | null = null;
    let lastRenderedAt = performance.now();
    let lastObservedTime = video.currentTime;
    let lastRecoveryAt = 0;

    const markRendered = (mediaTime?: number, presentedFrames?: number) => {
      const mediaAdvanced = typeof mediaTime === "number"
        && Number.isFinite(mediaTime)
        && mediaTime > lastRenderedMediaTime + 0.01;
      const framesAdvanced = typeof presentedFrames === "number"
        && Number.isFinite(presentedFrames)
        && (lastPresentedFrames === null || presentedFrames > lastPresentedFrames);
      if (mediaAdvanced || framesAdvanced) lastRenderedAt = performance.now();
      if (mediaAdvanced && typeof mediaTime === "number") lastRenderedMediaTime = mediaTime;
      if (framesAdvanced && typeof presentedFrames === "number") lastPresentedFrames = presentedFrames;
    };

    const requestNextFrame = () => {
      if (cancelled || typeof mediaVideo.requestVideoFrameCallback !== "function") return;
      frameRequestId = mediaVideo.requestVideoFrameCallback((_now, metadata) => {
        markRendered(metadata.mediaTime, metadata.presentedFrames);
        requestNextFrame();
      });
    };
    requestNextFrame();

    const checkRenderedFrames = () => {
      if (cancelled) return;
      const current = playbackRef.current;
      const now = performance.now();
      if (!mediaMatchesPlayback(mediaKey, current) || current.paused) {
        lastRenderedAt = now;
        lastObservedTime = video.currentTime;
        return;
      }
      if (video.paused && !rebufferingRef.current) {
        lastRenderedAt = now;
        lastObservedTime = video.currentTime;
        return;
      }

      const qualityFrames = mediaVideo.getVideoPlaybackQuality?.()?.totalVideoFrames;
      if (typeof qualityFrames === "number" && Number.isFinite(qualityFrames)) {
        markRendered(undefined, qualityFrames);
      } else if (typeof mediaVideo.requestVideoFrameCallback !== "function" && video.currentTime > lastObservedTime + 0.05) {
        lastRenderedAt = now;
      }
      lastObservedTime = video.currentTime;
      if (rebufferingRef.current || now - lastRenderedAt < FOLLOWER_FRAME_STALL_MS) return;
      if (now - lastRecoveryAt < FOLLOWER_RESYNC_COOLDOWN_MS) return;

      const target = predictedPosition(current, serverOffsetRef.current);
      const drift = target - video.currentTime;
      if (drift < -1) return;
      lastRecoveryAt = now;
      rebufferingRef.current = true;
      setIsRebuffering(true);
      const safeTarget = Number.isFinite(video.duration) && video.duration > 0
        ? Math.min(target, Math.max(0, video.duration - 0.25))
        : target;
      if (Math.abs(video.currentTime - safeTarget) > 0.15) video.currentTime = Math.max(0, safeTarget);
      if (hlsRef.current) {
        try {
          hlsRef.current.startLoad(Math.max(0, safeTarget - 1));
          if (video.error || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) hlsRef.current.recoverMediaError();
        } catch {
          // The media effect will re-resolve if the HLS instance cannot recover.
        }
      }
      lastRenderedAt = now;
      void video.play().catch(() => {
        rebufferingRef.current = false;
        setIsRebuffering(false);
        setAutoplayBlocked(true);
      });
    };
    const watchdogTimer = window.setInterval(checkRenderedFrames, FOLLOWER_FRAME_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(watchdogTimer);
      if (frameRequestId !== null) mediaVideo.cancelVideoFrameCallback?.(frameRequestId);
    };
  }, [isHost, mediaMatchesPlayback, resolvedMedia?.key, videoReady]);

  useEffect(() => {
    if (!isHost) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      const current = playbackRef.current;
      const active = activeEpisodeRef.current;
      if (!video || video.paused || !active) return;
      if (websocketRef.current?.readyState !== WebSocket.OPEN) return;
      const sent = websocketSendRef.current?.({
        type: "playback.command",
        command: {
          paused: false,
          position: video.currentTime,
          playbackRate: video.playbackRate,
          catalogId: current.catalogId ?? selectedCatalog?.id ?? null,
          sourceId: active.sourceId,
          episodeId: active.id,
          episodeUrl: active.url,
          episodeName: active.name,
        },
      }) ?? false;
      if (!sent) return;
      playbackRef.current = { ...current, position: video.currentTime, paused: false, playbackRate: video.playbackRate };
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [isHost, selectedCatalog?.id]);

  const handleVideoTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setVideoPosition(video.currentTime);
    if (!isScrubbing) setScrubPosition(video.currentTime);
    setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0);
  }, [isScrubbing]);

  const handleVideoPlay = useCallback(() => setIsPlaying(true), []);
  const handleVideoPause = useCallback(() => setIsPlaying(false), []);
  const handleVideoLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video) setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0);
  }, []);

  const showVideoControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsHideTimerRef.current !== null) window.clearTimeout(controlsHideTimerRef.current);
    controlsHideTimerRef.current = null;
    if (isPlaying && videoReady) {
      controlsHideTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
        controlsHideTimerRef.current = null;
      }, 3_000);
    }
  }, [isPlaying, videoReady]);

  useEffect(() => {
    showVideoControls();
    return () => {
      if (controlsHideTimerRef.current !== null) window.clearTimeout(controlsHideTimerRef.current);
      controlsHideTimerRef.current = null;
    };
  }, [showVideoControls]);

  useEffect(() => {
    const stage = videoStageRef.current;
    if (!stage) return;
    let animationFrame = 0;
    const updateStageWidth = () => {
      animationFrame = 0;
      const nextWidth = Math.round(stage.getBoundingClientRect().width);
      setVideoStageWidth((current) => current === nextWidth ? current : nextWidth);
    };
    const scheduleUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(updateStageWidth);
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(stage);
    window.addEventListener("resize", scheduleUpdate);
    scheduleUpdate();
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = isMuted || volume === 0;
  }, [isMuted, volume]);

  useEffect(() => {
    const anchor = playerAnchorRef.current;
    const player = playerRef.current;
    if (!anchor || !player) return;

    const mobileQuery = window.matchMedia("(max-width: 900px)");
    let animationFrame = 0;

    const updatePlayerDock = () => {
      animationFrame = 0;
      const playerHeight = player.getBoundingClientRect().height;
      if (playerHeight > 0) anchor.style.setProperty("--mobile-player-height", `${playerHeight}px`);

      const shouldDock = Boolean(
        activeEpisode
        && mobileQuery.matches
        && !document.fullscreenElement
        && anchor.getBoundingClientRect().top <= 0,
      );
      setIsMobilePlayerDocked((current) => current === shouldDock ? current : shouldDock);
    };

    const schedulePlayerDockUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(updatePlayerDock);
    };

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(schedulePlayerDockUpdate);
    resizeObserver?.observe(player);
    window.addEventListener("scroll", schedulePlayerDockUpdate, { passive: true });
    window.addEventListener("resize", schedulePlayerDockUpdate);
    document.addEventListener("fullscreenchange", schedulePlayerDockUpdate);
    mobileQuery.addEventListener("change", schedulePlayerDockUpdate);
    schedulePlayerDockUpdate();

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", schedulePlayerDockUpdate);
      window.removeEventListener("resize", schedulePlayerDockUpdate);
      document.removeEventListener("fullscreenchange", schedulePlayerDockUpdate);
      mobileQuery.removeEventListener("change", schedulePlayerDockUpdate);
      setIsMobilePlayerDocked(false);
    };
  }, [activeEpisode]);

  const activePendingInviteCode = !room && pendingInviteCode ? pendingInviteCode : "";
  const isPreRoom = !room;
  const preRoomTitle = activePendingInviteCode
    ? `房间 ${activePendingInviteCode} 正在等你`
    : "先进入一个观影房";
  const preRoomDescription = activePendingInviteCode
    ? "邀请链接已经识别，只需要确认昵称；加入后会自动连接房间当前的播放进度。"
    : "创建一个新房间，或者输入朋友分享的房间码。进入后再选择影片、聊天和同步播放。";

  return (
    <main style={appearance.style} className={`maku-app ${isPreRoom ? "pre-room" : ""}`} data-room-state={room ? "joined" : activePendingInviteCode ? "invited" : "empty"}>
      <header className="topbar">
        <div className="brand-lockup" aria-label="幕友">
          <span className="brand-mark"><Clapperboard size={19} /></span>
          <span className="brand-name">幕友</span>
          <span className="brand-sub">MAKU · 一起看</span>
        </div>

        <nav className="main-nav" aria-label="主导航">
          <a className="nav-link active" href="#watch"><Play size={14} />正在放映</a>
          <a className="nav-link" href="#queue"><SkipForward size={14} />选集</a>
          <a className="nav-link" href="#history"><Search size={14} />找番</a>
        </nav>

        <div className="topbar-actions">
          <AppearanceSettings appearance={appearance} />
          <div className="room-mini-status"><span className={`live-dot ${connectionState === "connected" ? "" : "muted"}`} />{roomCode ? `房间 ${roomCode}` : activePendingInviteCode ? `邀请 ${activePendingInviteCode}` : "未进入房间"}</div>
          <Button className="invite-button" size="sm" onClick={() => openRoomDialog(roomCode ? "invite" : activePendingInviteCode ? "join" : "create")}>
            {roomCode ? <Share2 size={15} /> : <Users size={15} />}
            {roomCode ? "邀请朋友" : activePendingInviteCode ? "加入房间" : "进入房间"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="icon-button" variant="ghost" size="icon" aria-label="打开更多操作"><MoreHorizontal size={18} /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="menu-surface">
              <DropdownMenuLabel>{roomCode ? `房间 ${roomCode}` : "房间操作"}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => openRoomDialog("create")}><Plus />新建观影房</DropdownMenuItem>
              <DropdownMenuItem onClick={() => openRoomDialog("join")}><Users />加入其他房间</DropdownMenuItem>
              {roomCode && <><DropdownMenuSeparator /><DropdownMenuItem onClick={copyInvite}><Copy />复制邀请链接</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" className="profile-button" onClick={() => openRoomDialog("rename")} disabled={!room || !memberId} aria-label="修改昵称" title={room ? "修改昵称" : "进入房间后修改昵称"}>
            <Avatar className="profile-avatar" size="sm"><AvatarFallback className="avatar-mint">{(currentMember?.nickname ?? nickname).slice(0, 1)}</AvatarFallback></Avatar>
          </button>
        </div>
      </header>

      <section className="workspace-shell" id="watch">
        <div className="workspace-heading">
          <div>
            <div className="hero-kicker"><Sparkles size={14} /> OUR ANIME CINEMA <span>{"//"} 同じ空の下、同じ物語を。</span></div>
            <div className="eyebrow"><span className={`live-dot ${connectionState === "connected" ? "" : "muted"}`} />ROOM / {roomCode || activePendingInviteCode || "—"}<span className="eyebrow-divider">·</span><span className="muted-eyebrow">{room ? "实时放映室 · 连线稳定" : activePendingInviteCode ? "邀请已识别 · 等待加入" : "先创建或加入房间"}</span></div>
            <h1>{activePendingInviteCode ? `准备加入 ${activePendingInviteCode}` : room ? "故事正在放映，我们一起。" : "下一话，也要一起看。"}</h1>
            <p className="heading-copy">{activePendingInviteCode ? "房间链接有效，输入昵称就可以加入朋友当前的观影进度。" : "和朋友在同一条时间线上，把每一帧都留给一起笑的人。"}</p>
          </div>
          <div className="heading-actions">
            <div className={`sync-pill ${connectionState === "error" ? "sync-pill-error" : ""}`}><Wifi size={14} />{activePendingInviteCode ? "邀请已识别" : connectionLabel}</div>
            {roomCode ? <Button variant="outline" onClick={() => openRoomDialog("invite")}><Users size={16} />{members.length} 人在线</Button> : activePendingInviteCode ? <Button onClick={() => openRoomDialog("join")}><Users size={16} />加入房间</Button> : null}
          </div>
        </div>

        {roomError && <div className="room-alert" role="status"><AlertTriangle size={16} /><span>{roomError}</span><button type="button" onClick={() => setRoomError("")} aria-label="关闭提示"><X size={15} /></button></div>}

        {isPreRoom && <section className={`pre-room-callout ${activePendingInviteCode ? "invited" : ""}`} aria-label="进入观影房">
          <div className="pre-room-callout-copy">
            <span className="section-kicker">{activePendingInviteCode ? "INVITE READY" : "ROOM FIRST"}</span>
            <h2>{preRoomTitle}</h2>
            <p>{preRoomDescription}</p>
          </div>
          <div className="pre-room-callout-actions">
            {activePendingInviteCode ? <Button onClick={() => openRoomDialog("join")}><Users size={16} />输入昵称并加入</Button> : <><Button onClick={() => openRoomDialog("create")}><Plus size={16} />创建房间</Button><Button variant="outline" onClick={() => openRoomDialog("join")}><Users size={16} />加入已有房间</Button></>}
          </div>
        </section>}

        <div className="watch-layout">
          <section className="watch-column" aria-label="播放器">
            <div ref={playerAnchorRef} className={`mobile-player-anchor ${isMobilePlayerDocked ? "is-docked" : ""}`}>
              <div ref={playerRef} className="video-card">
                <div ref={videoStageRef} className={`video-stage ${stageTone}`} onPointerMove={showVideoControls} onPointerDown={showVideoControls} onFocusCapture={showVideoControls}>
                <video
                  ref={videoRef}
                  className={`video-element ${videoReady ? "visible" : ""}`}
                  playsInline
                  preload="auto"
                  muted={isMuted}
                  aria-label={activeTitle}
                  onPlay={handleVideoPlay}
                  onPause={handleVideoPause}
                  onTimeUpdate={handleVideoTimeUpdate}
                  onLoadedMetadata={handleVideoLoadedMetadata}
                  onRateChange={(event) => setPlaybackRate(event.currentTarget.playbackRate)}
                />
                <div className="danmaku-overlay" aria-live="off">
                  {visibleDanmaku.map((message) => {
                    const lane = 8 + (hashString(message.id) % 70);
                    const stageWidth = Math.max(320, videoStageWidth || 640);
                    const fontPixels = DANMAKU_FONT_PIXELS[danmakuSettings.fontSize];
                    const estimatedTextWidth = Math.min(stageWidth * 0.9, Math.max(fontPixels * 2, Array.from(message.text).length * fontPixels * 0.9));
                    const danmakuDuration = Math.max(5, (stageWidth + estimatedTextWidth) / DANMAKU_SPEED_PX_PER_SECOND);
                    const style: CSSProperties & Record<"--danmaku-distance" | "--danmaku-duration", string> = {
                      color: message.color,
                      opacity: danmakuSettings.opacity,
                      fontSize: DANMAKU_FONT_SIZES[danmakuSettings.fontSize],
                      "--danmaku-distance": `${stageWidth}px`,
                      "--danmaku-duration": `${danmakuDuration}s`,
                      ...(message.mode === "bottom"
                        ? { bottom: `${8 + (hashString(message.id) % 16)}%` }
                        : { top: `${lane}%` }),
                    };
                    return <span key={message.id} className={`danmaku-item danmaku-${message.mode}`} style={style}>{message.text}</span>;
                  })}
                </div>
                {!videoReady && <div className="scene-art" aria-hidden="true">
                  <div className="scene-grid" />
                  <div className="scene-orbit orbit-one" />
                  <div className="scene-orbit orbit-two" />
                  <Sparkles className="scene-emblem" size={28} />
                  <span className="scene-kicker">{activeEpisode ? "RESOLVING SOURCE // 片源解析中" : "MAKU CINEMA // 放映室"}</span>
                  <span className="scene-title">{activeEpisode ? "即将开播" : "我们的放映室"}</span>
                  <span className="scene-caption">{activeEpisode?.name ?? selectedSourceMatch?.title ?? "搜索一部番剧开始"}</span>
                </div>}
                {!videoReady && !sourceError && mediaState === "resolving" && <div className="media-status"><LoaderCircle size={17} className="spin" />正在解析片源…</div>}
                {!videoReady && !sourceError && mediaState === "loading" && <div className="media-status"><LoaderCircle size={17} className="spin" />正在预缓冲（目标 {STARTUP_BUFFER_SECONDS} 秒）…</div>}
                {videoReady && isRebuffering && <div className="media-status"><LoaderCircle size={17} className="spin" />播放缓冲中，正在自动恢复…</div>}
                {sourceError && <div className="media-error-panel" role="alert">
                  <AlertTriangle size={18} />
                  <div className="media-error-copy"><strong>{sourceErrorTitle(sourceError.code)}</strong><span>{sourceError.message}</span>{sourceError.challengeUrl && <a href={sourceError.challengeUrl} target="_blank" rel="noreferrer">打开验证页面 <ArrowUpRight size={13} /></a>}</div>
                  <div className="media-error-actions">
                    {sourceError.code !== "relay_capacity" && <Button variant="outline" size="sm" onClick={retryResolveManually}><RefreshCw size={14} />重新获取</Button>}
                    {sourceError.code === "relay_capacity" && <Button size="sm" onClick={switchToDirectSource}><Radio size={14} />{directAlternativeSource ? "切换直连片源" : "选择其他片源"}</Button>}
                    {!isHost && sourceError.code !== "relay_capacity" && <Button size="sm" onClick={() => {
                      const title = activeCatalog?.nameCn || activeCatalog?.name || activeWorkTitle;
                      if (title && title !== activeEpisode?.name) setSearch(title);
                      document.getElementById("history")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      toast.info("选择其他片源并点击对应分集，只会在本机换源");
                    }}><Radio size={14} />本地换源</Button>}
                  </div>
                </div>}
                {!isHost && autoplayBlocked && !playback.paused && <div className="autoplay-recovery" role="status">
                  <div className="autoplay-recovery-copy"><Volume2 size={18} /><span><strong>浏览器暂停了自动播放</strong><small>房间仍在播放，点击后仅在本地继续同步。</small></span></div>
                  <Button size="sm" onClick={() => void resumeLocalPlayback()}><Play size={14} fill="currentColor" />点击继续同步播放</Button>
                </div>}
                {!videoReady && !sourceError && !activeEpisode && <div className="media-empty-hint"><BookOpen size={16} />从下方搜索并选择一集</div>}
                {!videoReady && <div className="subtitle-line">「先选一部番剧，房主点击播放后大家会自动跟随。」</div>}
                <div className={`video-controls ${controlsVisible || !isPlaying || !videoReady ? "" : "controls-hidden"}`}>
                  <div className="progress-row">
                    <Slider
                      aria-label="播放进度"
                      value={[clamp(displayedPosition, 0, Math.max(1, videoDuration))]}
                      min={0}
                      max={Math.max(1, videoDuration)}
                      disabled={!hostControlsEnabled || !videoReady}
                      onPointerDown={() => setIsScrubbing(true)}
                      onValueChange={(value) => setScrubPosition(value[0] ?? 0)}
                      onValueCommit={(value) => handleSeekCommit(value[0] ?? 0)}
                      className="progress-slider"
                    />
                    <span className="time-readout">{formatTime(displayedPosition)} / {videoDuration ? formatTime(videoDuration) : "--:--"}</span>
                    </div>
                    <div className="control-row">
                    <div className="control-cluster">
                      <Button variant="ghost" size="icon-sm" className="player-control" onClick={() => seekRelative(-10)} disabled={!hostControlsEnabled || !videoReady} aria-label="后退十秒"><SkipBack size={17} /></Button>
                      <Button size="icon-lg" className="play-control" onClick={handlePlayToggle} disabled={!hostControlsEnabled || !activeEpisode || !videoReady} aria-label={isPlaying ? "暂停" : "播放"}>{isPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</Button>
                      <Button variant="ghost" size="icon-sm" className="player-control" onClick={() => seekRelative(10)} disabled={!hostControlsEnabled || !videoReady} aria-label="前进十秒"><SkipForward size={17} /></Button>
                      <div className="volume-control">
                        <Button variant="ghost" size="icon-sm" className="player-control" onClick={toggleMute} disabled={!videoReady} aria-label={isMuted ? "取消静音" : "静音"}>{isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}</Button>
                        <Slider aria-label="音量" value={[isMuted ? 0 : volume]} min={0} max={1} step={0.05} onValueChange={handleVolumeChange} disabled={!videoReady} className="volume-slider" />
                      </div>
                    </div>
                    <form className="fullscreen-danmaku-compose" onSubmit={sendDanmaku}>
                      <Input value={danmakuDraft} onChange={(event) => setDanmakuDraft(event.target.value)} placeholder="发送弹幕…" aria-label="全屏发送弹幕" maxLength={120} disabled={!room || connectionState !== "connected"} />
                      <Button type="submit" size="icon-sm" className="danmaku-send" aria-label="发送弹幕" title="发送弹幕" disabled={!room || connectionState !== "connected" || !danmakuDraft.trim()}><Send size={14} /></Button>
                    </form>
                    <div className="control-cluster">
                      {isRelayPlayback && <span className="compatibility-chip">兼容线路</span>}
                      <span className="quality-chip">{qualityChipLabel}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" className="player-control" aria-label="播放器设置" disabled={!videoReady}><Settings2 size={17} /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="menu-surface">
                          <DropdownMenuLabel>画质</DropdownMenuLabel>
                          {canChangeQuality ? <DropdownMenuRadioGroup value={selectedQualityLevel >= 0 ? String(selectedQualityLevel) : "auto"} onValueChange={handleQualityChange}>
                            <DropdownMenuRadioItem value="auto">自动</DropdownMenuRadioItem>
                            {qualityLevels.map((level) => <DropdownMenuRadioItem key={`quality-${level.index}`} value={String(level.index)}>{level.label}</DropdownMenuRadioItem>)}
                          </DropdownMenuRadioGroup> : <DropdownMenuItem disabled>{resolvedMedia?.kind === "mp4" || qualityMode === "single" ? "单码率，无可切换档位" : "当前浏览器仅支持自动画质"}</DropdownMenuItem>}
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>播放速度</DropdownMenuLabel>
                          <DropdownMenuRadioGroup value={String(playbackRate)} onValueChange={handleRateChange}>
                            {[0.75, 1, 1.25, 1.5, 2].map((rate) => <DropdownMenuRadioItem key={rate} value={String(rate)} disabled={!hostControlsEnabled}>{rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}×</DropdownMenuRadioItem>)}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button variant="ghost" size="icon-sm" className="player-control" onClick={() => { if (!document.fullscreenElement) void playerRef.current?.requestFullscreen?.(); else void document.exitFullscreen?.(); }} aria-label="全屏播放"><Maximize2 size={17} /></Button>
                    </div>
                  </div>
                </div>
                </div>
              </div>
            </div>

            <div className="now-playing-bar">
              <div className="now-playing-copy">
                <div className="now-playing-title"><span className="now-playing-mark">{activeMark}</span><div><h2>{activeTitle === "还没有选择片源" ? "等待选择番剧" : activeTitle}</h2><p>{activeSourceLabel} <span>·</span> {activeEpisode?.name ?? "搜索后选择一集"}</p></div></div>
                <div className="metadata-row"><span><Clock3 size={14} />本集 {formatTime(displayedPosition)} / {videoDuration ? formatTime(videoDuration) : "--:--"}</span><span><Sparkles size={14} />{isHost ? "你是房主，播放状态由你发送" : "跟随房主的服务端状态"}</span></div>
              </div>
              <div className="now-playing-actions">
                <Button variant="outline" onClick={openSourceSwitcher} disabled={!room}><Radio size={15} />换片源</Button>
                <Button className="next-button" onClick={handleNextEpisode} disabled={!hostControlsEnabled || !hasNextEpisode}><SkipForward size={15} />下一话</Button>
              </div>
            </div>

            <section className="danmaku-panel" aria-label="实时弹幕">
              <div className="danmaku-panel-header">
                <div><span className="section-kicker">LIVE DANMAKU</span><strong><Sparkles size={14} />实时弹幕</strong></div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="icon-button" aria-label="弹幕设置"><Settings2 size={16} /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="menu-surface">
                    <DropdownMenuLabel>弹幕显示</DropdownMenuLabel>
                    <DropdownMenuCheckboxItem checked={danmakuSettings.enabled} onCheckedChange={(checked) => updateDanmakuEnabled(checked === true)}>显示弹幕</DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={danmakuSettings.showScroll} onCheckedChange={(checked) => setDanmakuSettings((current) => ({ ...current, showScroll: checked === true }))}>显示滚动弹幕</DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={danmakuSettings.showTop} onCheckedChange={(checked) => setDanmakuSettings((current) => ({ ...current, showTop: checked === true }))}>显示顶部弹幕</DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={danmakuSettings.showBottom} onCheckedChange={(checked) => setDanmakuSettings((current) => ({ ...current, showBottom: checked === true }))}>显示底部弹幕</DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>字号</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={danmakuSettings.fontSize} onValueChange={(value) => {
                      if (value === "small" || value === "medium" || value === "large") {
                        setDanmakuSettings((current) => ({ ...current, fontSize: value }));
                      }
                    }}>
                      <DropdownMenuRadioItem value="small">小</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="medium">中</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="large">大</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="danmaku-compose-toolbar">
                <Button type="button" size="sm" variant={danmakuSettings.enabled ? "secondary" : "outline"} className="danmaku-toggle" aria-pressed={danmakuSettings.enabled} onClick={() => updateDanmakuEnabled(!danmakuSettings.enabled)}><Sparkles size={14} />{danmakuSettings.enabled ? "弹幕已开" : "弹幕已关"}</Button>
                <span className="danmaku-compose-location">在房间消息栏发送，一起聊剧情 ✦</span>
              </div>
              <p className="danmaku-hint">弹幕按房间权威播放时间同步，仅保留本次观看期间的消息。</p>
            </section>

            <section className="episodes-section" id="queue">
              <div className="section-heading-row"><div><span className="section-kicker">SOURCE EPISODES</span><h2>分集列表</h2></div><div className="episode-heading-tools">{roads.length > 1 && <Select value={String(selectedRoad)} onValueChange={(value) => setSelectedRoad(Number(value))}><SelectTrigger className="road-select" aria-label="选择线路"><SelectValue /></SelectTrigger><SelectContent>{roads.map((road, index) => <SelectItem key={`${road.name}-${index}`} value={String(index)}>{road.name}</SelectItem>)}</SelectContent></Select>}{activeRoad && <span className="muted-count">{activeRoad.episodes.length} 集</span>}</div></div>
              {!isHost && room && activeEpisodes.length > 0 && <div className="local-source-note"><Radio size={14} /><span>点击分集仅在本机换源，播放、暂停和进度仍跟随房主。</span></div>}
              {chaptersLoading && <div className="episodes-state"><LoaderCircle size={16} className="spin" />正在加载线路与集数…</div>}
              {chaptersError && <div className="episodes-state error"><AlertTriangle size={16} />{chaptersError}</div>}
              {!chaptersLoading && !chaptersError && activeEpisodes.length > 0 && <div className="episode-strip">
                {activeEpisodes.map((episode, index) => {
                  const selected = episode.key === activeEpisode?.key;
                  return <button key={episode.key} type="button" className={`episode-chip ${selected ? "selected" : ""}`} onClick={() => selectEpisode(episode)} disabled={!room || !isSocketConnected}><span className="episode-number">E{String(index + 1).padStart(2, "0")}</span><span>{episode.name}</span>{selected && <CheckCircle2 size={14} />}</button>;
                })}
              </div>}
              {!chaptersLoading && !chaptersError && activeEpisodes.length === 0 && <div className="episodes-state"><BookOpen size={16} />搜索并点击一部番剧后，这里会显示真实线路和集数。</div>}
            </section>
          </section>

          <aside className="chat-card" aria-label="房间聊天">
            <div className="chat-card-header">
              <div><div className="section-kicker">LIVE ROOM</div><h2>房间消息</h2></div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="icon-button" aria-label="房间设置"><MoreHorizontal size={18} /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="menu-surface">
                  <DropdownMenuLabel>{roomCode ? `房间 ${roomCode}` : "还没有房间"}</DropdownMenuLabel>
                  {roomCode && <DropdownMenuItem onClick={copyInvite}><Copy />复制邀请链接</DropdownMenuItem>}
                  {roomCode && <DropdownMenuItem onClick={() => openRoomDialog("rename")}><Pencil />修改昵称</DropdownMenuItem>}
                  <DropdownMenuItem onClick={() => openRoomDialog("join")}><Users />加入其他房间</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="presence-row">
              <AvatarGroup>
                {members.slice(0, 5).map((member) => <Avatar key={member.id} size="sm"><AvatarFallback className={member.id === memberId ? "avatar-mint" : avatarToneFor(member.id)}>{member.nickname.slice(0, 1)}</AvatarFallback></Avatar>)}
              </AvatarGroup>
              <span><strong>{members.length}</strong> 人在线 · {room ? "实时同步中" : "等待进入房间"}</span>
              <span className="presence-signal"><Wifi size={13} /></span>
            </div>

            <Tabs defaultValue="chat" className="chat-tabs">
              <TabsList variant="line" className="chat-tabs-list"><TabsTrigger value="chat"><MessageCircle size={14} />消息</TabsTrigger><TabsTrigger value="members"><Users size={14} />成员 <span className="tab-count">{members.length}</span></TabsTrigger></TabsList>
              <TabsContent value="chat" className="chat-tab-content">
                <ScrollArea className="chat-scroll-area">
                  <div className="chat-messages">
                    <div className="chat-system"><span className="system-line" />{room ? "你已进入房间" : "进入房间后开始聊天"}<span className="system-line" /></div>
                    {chatMessages.length === 0 && <div className="empty-chat"><MessageCircle size={17} /><span>把第一句「开播啦」留在这里 ✦</span></div>}
                    {chatMessages.map((message) => <div key={message.id} className={`chat-message ${message.self ? "self" : ""}`}><Avatar size="sm"><AvatarFallback className={message.color}>{message.name.slice(0, 1)}</AvatarFallback></Avatar><div className="message-body"><div className="message-meta"><strong>{message.name}</strong>{message.kind === "danmaku" && <span className="message-kind">弹幕</span>}<span>{message.time}</span></div><p>{message.text}</p></div></div>)}
                  </div>
                </ScrollArea>
                <div className="chat-composer">
                  <div className="chat-composer-toolbar">
                    <span className="chat-composer-label">消息会同时显示在聊天栏和视频弹幕上</span>
                  </div>
                  <form className="chat-compose" onSubmit={sendDanmaku} aria-label="发送房间消息">
                    <Input value={danmakuDraft} onChange={(event) => setDanmakuDraft(event.target.value)} placeholder={room ? "发送一条消息…" : "进入房间后发送"} aria-label="发送房间消息" maxLength={120} disabled={!room || connectionState !== "connected"} />
                      <Select value={danmakuMode} onValueChange={(value) => { if (value === "scroll" || value === "top" || value === "bottom") setDanmakuMode(value); }}>
                        <SelectTrigger className="danmaku-mode-select" aria-label="弹幕位置"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="scroll">滚动</SelectItem><SelectItem value="top">顶部</SelectItem><SelectItem value="bottom">底部</SelectItem></SelectContent>
                      </Select>
                      <label className="danmaku-color-picker" aria-label="弹幕颜色"><input type="color" value={danmakuColor} onChange={(event) => setDanmakuColor(event.target.value.toUpperCase())} /><span style={{ backgroundColor: danmakuColor }} /></label>
                    <Button type="submit" size="icon-sm" className="send-button" aria-label="发送消息" title="发送消息" disabled={!room || connectionState !== "connected" || !danmakuDraft.trim()}><Send size={14} /></Button>
                  </form>
                </div>
              </TabsContent>
              <TabsContent value="members" className="members-tab-content">
                <div className="member-list">{members.map((member) => <div className="member-row" key={member.id}><Avatar><AvatarFallback className={member.id === memberId ? "avatar-mint" : avatarToneFor(member.id)}>{member.nickname.slice(0, 1)}</AvatarFallback></Avatar><div><strong>{member.nickname}{member.id === memberId ? " · 你" : ""}</strong><span>{member.id === room?.hostId ? "房主" : "正在观看"}</span></div>{member.id === room?.hostId ? <span className="host-label">房主</span> : <span className="online-label"><span className="live-dot" />在线</span>}</div>)}</div>
                {members.length === 0 && <div className="empty-chat"><Users size={17} /><span>进入房间后显示成员。</span></div>}
              </TabsContent>
            </Tabs>

            <div className="chat-footer-note"><PanelRight size={14} />房主控制播放，其他成员跟随服务端状态</div>
          </aside>
        </div>

        <section className="catalog-section" id="history">
          <div className="catalog-header">
            <div><span className="section-kicker">SEARCH SOURCES</span><h2>片源搜索</h2><p>{activeEpisode ? "播放中仍可换片源：先选片源、搜索作品，再点击新的分集。" : sourceId ? `正在搜索 ${sourceLabel} 的真实规则目录。` : "先选择一个片源，再搜索番剧。"}</p></div>
            <div className="catalog-tools">
              <Select value={sourceId || undefined} onValueChange={(value) => { setSourceId(value); setSelectedSourceMatch(null); setSelectedCatalog(null); setRoads([]); setSelectedRoad(0); setChaptersError(""); setSearchResults([]); setSearchError(""); setCatalogMetadataError(""); }} disabled={sourceListLoading || !sources.length}>
                <SelectTrigger className="source-select catalog-source-select" aria-label="选择播放源"><Radio size={14} /><SelectValue placeholder={sources.length ? "选择片源" : "加载片源"} /></SelectTrigger>
                <SelectContent>{sources.map((source) => <SelectItem key={source.id} value={source.id}>{sourceMenuLabel(source)}</SelectItem>)}</SelectContent>
              </Select>
              <div className="search-box"><Search size={16} /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索番剧或剧集" aria-label="搜索番剧" disabled={!sourceId || sourceListLoading} />{search && <button type="button" onClick={() => setSearch("")} aria-label="清除搜索"><X size={15} /></button>}</div>
              {sourceId && search.trim().length >= 2 && !searchLoading && <span className="catalog-result-count">{searchResults.length} 个结果</span>}
            </div>
          </div>
          {sourceListLoading && <div className="source-health-note"><LoaderCircle size={16} className="spin" /><span>正在加载可用播放源…</span></div>}
          {sourceListError && <div className="source-health-note error"><AlertTriangle size={16} /><span>{sourceListError}</span><Button variant="outline" size="sm" onClick={() => setSourceReloadNonce((value) => value + 1)}><RefreshCw size={14} />重新加载</Button></div>}
          {currentSource && currentSourceValidation && <div className={`source-validation-note ${currentSourceValidation.tone}`}><span className="source-validation-icon">{currentSourceValidation.tone === "ready" ? <CheckCircle2 size={15} /> : currentSourceValidation.tone === "neutral" ? <Radio size={15} /> : <AlertTriangle size={15} />}</span><span><strong>{currentSourceValidation.label}</strong>{currentSourceValidation.message}</span></div>}
          {searchError && <div className="empty-search error"><AlertTriangle size={18} /><span>{searchError}</span></div>}
          {catalogMetadataError && !searchError && <div className="source-health-note"><AlertTriangle size={16} /><span>{catalogMetadataError}</span></div>}
          {searchLoading && <div className="empty-search"><LoaderCircle size={18} className="spin" /><span>正在搜索片源…</span></div>}
          {!sourceListLoading && !sourceListError && !sourceId && <div className="empty-search"><Radio size={19} /><span>请先选择一个片源，再输入关键词搜索。</span></div>}
          {!searchLoading && !searchError && sourceId && search.trim().length < 2 && <div className="empty-search"><BookOpen size={19} /><span>输入至少 2 个字，搜索当前片源的番剧目录。</span></div>}
          {!searchLoading && !searchError && sourceId && search.trim().length >= 2 && searchResults.length === 0 && <div className="empty-search"><BookOpen size={19} /><span>当前片源没有找到相符的作品，试试换个关键词。</span></div>}
          {!searchLoading && searchResults.length > 0 && <div className="catalog-grid">
            {searchResults.map((work) => {
              const catalog = work.catalog;
              const title = catalog?.nameCn || catalog?.name || work.title;
              const cover = catalog?.images.medium || catalog?.images.common || catalog?.images.grid || catalog?.images.small || catalog?.images.large;
              const rating = catalog && catalog.ratingScore > 0 ? catalog.ratingScore.toFixed(1) : "暂无评分";
              const year = catalog?.airDate ? catalog.airDate.slice(0, 4) : "年份未知";
              const selected = selectedSourceMatch?.sourceId === work.sourceId && selectedSourceMatch.detailUrl === work.detailUrl;
              const status = selected && chaptersLoading ? "正在加载分集…" : selected && roads.length ? `${roads.length} 条线路已加载` : "加载线路与分集";
              return <article className={`catalog-result-card ${selected ? "current" : ""}`} key={`${work.sourceId}:${work.detailUrl}`}>
                <button type="button" className="catalog-card" onClick={() => void loadChapters(work)} disabled={chaptersLoading} aria-busy={selected && chaptersLoading} aria-label={`加载 ${title} 的分集`}>
                  <span className="catalog-cover" style={{ backgroundImage: cover ? `url("${cover}")` : undefined }} role="img" aria-label={`${title}封面`}>
                    {!cover && <span className={`catalog-cover-fallback ${toneFor(title)}`}>{markFor(title)}</span>}
                    <span className="catalog-cover-shade" />
                    <span className="catalog-card-action">{selected && chaptersLoading ? <LoaderCircle size={15} className="spin" /> : <Play size={15} fill="currentColor" />}</span>
                  </span>
                  <span className="catalog-card-copy">
                    <strong>{title}</strong>
                    {catalog?.name && catalog.name !== title && <small>{catalog.name}</small>}
                    <span className="catalog-card-meta"><span><Star size={13} fill="currentColor" />{rating}</span><span>{year}</span></span>
                    <small>{status}</small>
                  </span>
                </button>
              </article>;
            })}
          </div>}
        </section>

        <footer className="site-footer"><span>幕友 · 把屏幕变成次元客厅</span><span className="footer-dot">✦</span><span>规则目录与多源设计参考 <a href="https://github.com/Predidit/Kazumi" target="_blank" rel="noreferrer">Kazumi <ArrowUpRight size={12} /></a></span><span className="footer-right">同一片星空，同一刻心动</span></footer>
      </section>

      <Dialog open={roomDialogOpen} onOpenChange={setRoomDialogOpen}>
        <DialogContent className="room-dialog">
          {dialogMode === "invite" ? <>
            <DialogHeader><DialogTitle>邀请朋友进房间</DialogTitle><DialogDescription>把邀请链接发给朋友，对方打开后输入昵称，就会自动进入这个房间。</DialogDescription></DialogHeader>
            <div className="invite-code-panel"><span className="code-label">房间码</span><div className="invite-code-row"><strong>{roomCode || "—"}</strong><Button variant="outline" size="sm" onClick={copyInvite} disabled={!roomCode}><Copy size={15} />复制链接</Button></div><p><LockKeyhole size={13} />链接中包含房间码，不包含临时播放地址</p></div>
            <DialogFooter><Button variant="outline" onClick={() => setRoomDialogOpen(false)}>稍后</Button><Button onClick={copyInvite} disabled={!roomCode}><Share2 size={15} />复制邀请信息</Button></DialogFooter>
          </> : dialogMode === "rename" ? <form onSubmit={renameMember}>
            <DialogHeader><DialogTitle>修改昵称</DialogTitle><DialogDescription>昵称会同步到房间成员列表、聊天和弹幕，成员身份与房主权限不会改变。</DialogDescription></DialogHeader>
            <label className="field-label">新的昵称<Input value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} placeholder="输入新的昵称" maxLength={32} autoFocus disabled={renameBusy} /></label>
            <div className="dialog-tip"><CheckCircle2 size={16} /><span>修改后会继续使用当前 member ID，不会离开或重新加入房间。</span></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setRoomDialogOpen(false)} disabled={renameBusy}>取消</Button><Button type="submit" disabled={renameBusy}>{renameBusy ? <><LoaderCircle size={15} className="spin" />同步中</> : <><Pencil size={15} />保存昵称</>}</Button></DialogFooter>
          </form> : <>
            <DialogHeader><DialogTitle>{dialogMode === "create" ? "新建观影房" : activePendingInviteCode ? `加入 ${activePendingInviteCode}` : "加入观影房"}</DialogTitle><DialogDescription>{dialogMode === "create" ? "创建一个真实房间，之后可以把链接发给朋友。" : activePendingInviteCode ? "邀请房间已经识别，确认昵称后就会连接朋友当前的播放进度。" : "输入朋友分享的房间码和你的昵称，加入他们当前的播放进度。"}</DialogDescription></DialogHeader>
            <label className="field-label">你的昵称<Input name="maku-display-name" value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="例如：A7K9Q2" maxLength={32} autoComplete="off" data-1p-ignore autoFocus /></label>
            {dialogMode === "join" && (activePendingInviteCode ? <div className="join-target-panel"><span>准备加入</span><strong>{activePendingInviteCode}</strong><CheckCircle2 size={16} /></div> : <label className="field-label">房间码<Input name="maku-room-code" value={joinCode} onChange={(event) => setJoinCode(normalizeCode(event.target.value))} placeholder="例如：K7M9Q2" maxLength={8} autoComplete="off" data-1p-ignore autoCapitalize="characters" spellCheck={false} /></label>)}
            <div className="dialog-tip"><CheckCircle2 size={16} /><span>你的身份会保存在当前浏览器的会话中，短暂断线后会继续使用同一个成员身份。</span></div>
            {dialogMode === "join" && activePendingInviteCode ? <div className="invite-join-actions"><Button className="invite-join-primary" onClick={joinRoom} disabled={roomRequestBusy}>{roomRequestBusy ? <><LoaderCircle size={15} className="spin" />处理中</> : <><Users size={15} />加入房间</>}</Button><button type="button" className="dialog-text-action" onClick={() => { setPendingInviteCode(""); setJoinCode(""); }} disabled={roomRequestBusy}>改用其他房间码</button></div> : <DialogFooter><Button variant="outline" onClick={() => openRoomDialog(dialogMode === "create" ? "join" : "create")} disabled={roomRequestBusy}>{dialogMode === "create" ? <><Users size={15} />加入已有房间</> : <><Plus size={15} />新建房间</>}</Button><Button onClick={dialogMode === "create" ? createRoom : joinRoom} disabled={roomRequestBusy}>{roomRequestBusy ? <><LoaderCircle size={15} className="spin" />处理中</> : dialogMode === "create" ? <><Plus size={15} />创建房间</> : <><Users size={15} />加入房间</>}</Button></DialogFooter>}
          </>}
        </DialogContent>
      </Dialog>

      {!isBootstrapping && <Toaster position="bottom-right" />}
    </main>
  );
}
