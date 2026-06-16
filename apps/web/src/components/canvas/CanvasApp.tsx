import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  Panel,
  Background,
  BackgroundVariant,
  type OnConnect,
  type IsValidConnection,
  addEdge,
  type Node,
  type Connection,
  useReactFlow,
  type OnConnectStart,
  type OnConnectEnd,
  type XYPosition,
  type Viewport,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { nanoid } from "nanoid";
import { NODE_REGISTRY, type NodeTypeDefinition, type PortDataType } from "@shared/types";
import { nodeTypes } from "./nodes";
import { parseHandleId, isConnectionValid, makeHandleId } from "./lib/type-system";
import { getAutoLayoutNodes } from "./lib/auto-layout";
import { Toolbar } from "./panels/Toolbar";
import { DND_NODE_TYPE } from "./panels/NodePalette";
import { useFlowStore } from "./stores/use-flow-store";
import { useSSETaskExecution } from "./hooks/use-sse-task-execution";
import { useAutoSave } from "./hooks/use-auto-save";
import { useProjectSync } from "./hooks/use-project-sync";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { GenerationGallery } from "./GenerationGallery";
import { PreviewOverlay, type PreviewOverlayImage } from "./PreviewOverlay";
import { ASSET_DRAG_TYPE, type AssetDragPayload } from "./AssetCard";

type MenuMode =
  | { type: "add" }
  | {
      type: "connect";
      nodeId: string;
      handleId: string;
      direction: "source" | "target";
      dataType: PortDataType;
    };

interface NodeMenuState {
  menuPosition: { x: number; y: number };
  flowPosition: XYPosition;
  mode: MenuMode;
}

type ImagePreviewState = PreviewOverlayImage;

const API_BASE = import.meta.env.PUBLIC_API_URL || "http://localhost:8787";
const HIDDEN_NODE_TYPES = new Set(["img2video"]);
const CANVAS_EXPORT_VERSION = 1;
const CANVAS_MIN_ZOOM = 0.1;
const CANVAS_MAX_ZOOM = 2;
const FIT_VIEW_PADDING = 0.25;
const SHOULD_SHOW_CANVAS_EXPORT = import.meta.env.DEV;
const NODE_WIDTH = 280;
const DEFAULT_NODE_HEIGHT = 220;
const NODE_HEIGHT_BY_TYPE: Record<string, number> = {
  prompt: 220,
  "image-input": 250,
  txt2img: 360,
  img2video: 300,
};
const TXT2IMG_PREFERENCES_STORAGE_KEY = "free-canvas:txt2img-preferences";
const TXT2IMG_SIZE_OPTIONS = new Set(["auto", "1:1", "3:2", "2:3", "16:9", "21:9", "9:16", "4:3", "3:4"]);
const TXT2IMG_RESOLUTION_OPTIONS = new Set(["1080p", "2k", "4k"]);
const TXT2IMG_COUNT_OPTIONS = new Set([1, 2, 3, 4]);

interface CanvasImageUploadResult {
  asset?: unknown;
  assetId?: string;
  url: string;
  title?: string;
  width?: string;
  height?: string;
  size?: string;
  downloadUrl?: string;
}

function isNodeTypeAvailable(nodeType: NodeTypeDefinition): boolean {
  return !HIDDEN_NODE_TYPES.has(nodeType.type);
}

function isInputElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function readTxt2ImgPreferences(): Record<string, string | number> {
  if (typeof window === "undefined") return {};

  try {
    const stored = window.localStorage.getItem(TXT2IMG_PREFERENCES_STORAGE_KEY);
    if (!stored) return {};

    const parsed = JSON.parse(stored) as Record<string, unknown>;
    const preferences: Record<string, string | number> = {};
    if (typeof parsed.size === "string" && TXT2IMG_SIZE_OPTIONS.has(parsed.size)) {
      preferences.size = parsed.size;
    }
    if (
      typeof parsed.image_resolution === "string" &&
      TXT2IMG_RESOLUTION_OPTIONS.has(parsed.image_resolution)
    ) {
      preferences.image_resolution = parsed.image_resolution;
    }
    if (typeof parsed.n === "number" && TXT2IMG_COUNT_OPTIONS.has(parsed.n)) {
      preferences.n = parsed.n;
    }
    return preferences;
  } catch {
    return {};
  }
}

function persistTxt2ImgPreferences(config: Record<string, unknown>) {
  if (typeof window === "undefined") return;

  const next = { ...readTxt2ImgPreferences() };
  if (typeof config.size === "string" && TXT2IMG_SIZE_OPTIONS.has(config.size)) {
    next.size = config.size;
  }
  if (
    typeof config.image_resolution === "string" &&
    TXT2IMG_RESOLUTION_OPTIONS.has(config.image_resolution)
  ) {
    next.image_resolution = config.image_resolution;
  }
  if (typeof config.n === "number" && TXT2IMG_COUNT_OPTIONS.has(config.n)) {
    next.n = config.n;
  }

  try {
    window.localStorage.setItem(TXT2IMG_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be unavailable in private browsing or restricted contexts.
  }
}

function getNodeCenteredPosition(nodeType: NodeTypeDefinition, center: XYPosition): XYPosition {
  const height = NODE_HEIGHT_BY_TYPE[nodeType.type] ?? DEFAULT_NODE_HEIGHT;
  return {
    x: center.x - NODE_WIDTH / 2,
    y: center.y - height / 2,
  };
}

function getEventClientPoint(event: MouseEvent | TouchEvent) {
  if ("changedTouches" in event && event.changedTouches.length > 0) {
    const touch = event.changedTouches[0];
    return { x: touch.clientX, y: touch.clientY };
  }
  const mouseEvent = event as MouseEvent;
  return { x: mouseEvent.clientX, y: mouseEvent.clientY };
}

function createCanvasNode(nodeType: NodeTypeDefinition, position: XYPosition): Node {
  return {
    id: nanoid(8),
    type: nodeType.type,
    position,
    data: {
      ...nodeType.defaultConfig,
      ...(nodeType.type === "txt2img" ? readTxt2ImgPreferences() : {}),
    },
  };
}

function createCanvasExportFileName(projectId: string | null, canvasId: string | null): string {
  const dateStamp = new Date().toISOString().slice(0, 10);
  const idSlug = canvasId || projectId;
  const canvasSlug = idSlug ? `canvas-${idSlug}` : "canvas";
  return `${canvasSlug}-${dateStamp}.json`;
}

function removeRuntimeCallbacksFromNodes(nodes: Node[]): Node[] {
  return nodes.map((node) => ({
    ...node,
    data: Object.fromEntries(
      Object.entries(node.data ?? {}).filter(([, value]) => typeof value !== "function")
    ),
  }));
}

function downloadJsonFile(fileName: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function uploadCanvasImage(file: File, projectId: string | null): Promise<CanvasImageUploadResult> {
  const formData = new FormData();
  formData.set("file", file);
  if (projectId) formData.set("projectId", projectId);

  const response = await fetch(`${API_BASE}/api/canvas/files/upload`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => null)) as { error?: string; detail?: string } | null;
    const message = [errorData?.error, errorData?.detail].filter(Boolean).join(": ");
    throw new Error(message || "图片上传失败");
  }

  return response.json() as Promise<CanvasImageUploadResult>;
}

function getCompatibleConnection(
  mode: Extract<MenuMode, { type: "connect" }>,
  nodeType: NodeTypeDefinition,
  newNodeId: string
): Connection | null {
  if (mode.direction === "source") {
    const input = nodeType.inputs.find((port) => isConnectionValid(mode.dataType, port.dataType));
    if (!input) return null;
    return {
      source: mode.nodeId,
      sourceHandle: mode.handleId,
      target: newNodeId,
      targetHandle: makeHandleId(input.id, input.dataType, "target"),
    };
  }

  const output = nodeType.outputs.find((port) => isConnectionValid(port.dataType, mode.dataType));
  if (!output) return null;
  return {
    source: newNodeId,
    sourceHandle: makeHandleId(output.id, output.dataType, "source"),
    target: mode.nodeId,
    targetHandle: mode.handleId,
  };
}

function isNodeTypeCompatibleWithMenu(nodeType: NodeTypeDefinition, mode: MenuMode): boolean {
  if (mode.type === "add") return true;
  if (mode.direction === "source") {
    return nodeType.inputs.some((port) => isConnectionValid(mode.dataType, port.dataType));
  }
  return nodeType.outputs.some((port) => isConnectionValid(port.dataType, mode.dataType));
}

function CanvasNodeMenu({
  menu,
  onSelect,
  onClose,
}: {
  menu: NodeMenuState;
  onSelect: (nodeType: NodeTypeDefinition) => void;
  onClose: () => void;
}) {
  const nodeTypes = Object.values(NODE_REGISTRY).filter((nodeType) => {
    if (!isNodeTypeAvailable(nodeType)) return false;
    if (!isNodeTypeCompatibleWithMenu(nodeType, menu.mode)) return false;
    return true;
  });

  const title = menu.mode.type === "connect" ? "选择要连接的新节点" : "添加节点";

  return (
    <div
      className="absolute z-30 w-80 overflow-hidden rounded-[24px] border border-white/10 bg-[#07101A]/95 text-[#F5F7FA] shadow-[0_26px_72px_rgba(0,0,0,0.56),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl"
      style={{
        left: menu.menuPosition.x,
        top: menu.menuPosition.y,
        transform: "translate(-8px, 8px)",
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="border-b border-white/10 bg-white/[0.026] p-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-semibold text-[#F5F7FA]">{title}</span>
          <button
            type="button"
            aria-label="关闭节点菜单"
            className="min-h-7 rounded-full border border-white/10 px-2.5 py-0.5 text-[10px] text-[#9AA6B7] transition hover:bg-white/10 hover:text-[#F5F7FA]"
            onClick={onClose}
          >
            Esc
          </button>
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto p-2">
        {nodeTypes.length === 0 ? (
          <div className="px-2 py-5 text-center text-xs text-[#788493]">没有兼容节点</div>
        ) : (
          <div className="space-y-1">
            {nodeTypes.map((nodeType) => (
              <button
                key={nodeType.type}
                type="button"
                onClick={() => onSelect(nodeType)}
                className="canvas-field flex min-h-14 w-full items-center justify-between rounded-[16px] px-3 py-2.5 text-left transition hover:border-[#28D7F5]/45 hover:bg-[#101A27] focus-visible:ring-2 focus-visible:ring-[#28D7F5]/70"
              >
                <span>
                  <span className="block text-xs font-semibold text-[#F5F7FA]">{nodeType.label}</span>
                  <span className="block text-[11px] text-[#788493]">
                    {nodeType.inputs.length} 输入 · {nodeType.outputs.length} 输出
                  </span>
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.035] px-2 py-0.5 text-[10px] text-[#B8C0CC]">
                  {nodeType.category}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MapIcon() {
  return (
    <svg width="18" height="17" viewBox="0 0 18 17" fill="none" aria-hidden="true">
      <path d="M4.36.08.36 2A.64.64 0 0 0 0 2.57v13.78c0 .47.49.77.92.57L4.91 15a.64.64 0 0 0 .36-.57V.65c0-.46-.49-.77-.91-.57Z" fill="currentColor" />
      <path d="M6.36 14.53V.64c0-.46.5-.77.92-.57l4 1.92c.22.1.36.33.36.57v13.8c0 .46-.49.76-.91.57l-4-1.83a.63.63 0 0 1-.37-.57Z" fill="currentColor" />
      <path d="m17.08.06-4 1.92a.64.64 0 0 0-.35.57v13.82c0 .45.47.76.89.58l4-1.73c.23-.1.38-.33.38-.58V.63c0-.46-.49-.77-.92-.57Z" fill="currentColor" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M5.04 12.46v4.24H1.94a1.15 1.15 0 0 1-1.14-1.15v-3.09h4.24Zm5.83 0v4.24H6.63v-4.24h4.24Zm5.83 0v3.09a1.15 1.15 0 0 1-1.15 1.15h-3.09v-4.24h4.24ZM5.04 6.63v4.24H.8V6.63h4.24Zm5.83 0v4.24H6.63V6.63h4.24Zm5.83 0v4.24h-4.24V6.63h4.24ZM5.04.8v4.24H.8V1.94C.8 1.31 1.31.8 1.94.8h3.1Zm5.83 0v4.24H6.63V.8h4.24Zm4.68 0c.64 0 1.15.51 1.15 1.14v3.1h-4.24V.8h3.09Z" fill="currentColor" />
    </svg>
  );
}

function FitIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3.25 18.22v-1.78a.75.75 0 0 1 1.5 0v1.78c0 .27.11.54.3.73.2.19.46.3.73.3h1.78a.75.75 0 0 1 0 1.5H5.78c-.67 0-1.32-.27-1.79-.74a2.53 2.53 0 0 1-.74-1.79Zm16 0v-1.78a.75.75 0 0 1 1.5 0v1.78c0 .67-.27 1.31-.74 1.79a2.53 2.53 0 0 1-1.79.74h-1.78a.75.75 0 0 1 0-1.5h1.78c.27 0 .54-.11.73-.3.19-.2.3-.46.3-.73ZM14.5 12a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0ZM3.25 7.56V5.78c0-.67.27-1.32.74-1.79a2.53 2.53 0 0 1 1.79-.74h1.78a.75.75 0 0 1 0 1.5H5.78c-.27 0-.54.11-.73.3-.19.2-.3.46-.3.73v1.78a.75.75 0 0 1-1.5 0Zm16 0V5.78c0-.27-.11-.54-.3-.73-.2-.19-.46-.3-.73-.3h-1.78a.75.75 0 0 1 0-1.5h1.78c.67 0 1.31.27 1.79.74.47.47.74 1.12.74 1.79v1.78a.75.75 0 0 1-1.5 0Z" fill="currentColor" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

function AutoLayoutIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4.2 3.1h3.2c.62 0 1.12.5 1.12 1.12v3.2c0 .62-.5 1.12-1.12 1.12H4.2c-.62 0-1.12-.5-1.12-1.12v-3.2c0-.62.5-1.12 1.12-1.12Zm8.4 0h3.2c.62 0 1.12.5 1.12 1.12v3.2c0 .62-.5 1.12-1.12 1.12h-3.2c-.62 0-1.12-.5-1.12-1.12v-3.2c0-.62.5-1.12 1.12-1.12Zm0 8.36h3.2c.62 0 1.12.5 1.12 1.12v3.2c0 .62-.5 1.12-1.12 1.12h-3.2c-.62 0-1.12-.5-1.12-1.12v-3.2c0-.62.5-1.12 1.12-1.12Z"
        fill="currentColor"
      />
      <path
        d="M8.98 5.84h1.18m-4.36 2.7v2.34c0 .7.57 1.27 1.27 1.27h3.09m4.04-3.61v1.72"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ToolButton({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`group relative flex size-9 shrink-0 items-center justify-center rounded-[14px] text-[#E6E6E6] transition focus-visible:ring-2 focus-visible:ring-[#28D7F5]/70 ${
        active ? "bg-white/12 text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,0.18)]" : "hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function CanvasControls({
  showGrid,
  showMap,
  zoom,
  onGridChange,
  onMapChange,
  onAutoLayout,
}: {
  showGrid: boolean;
  showMap: boolean;
  zoom: number;
  onGridChange: (show: boolean) => void;
  onMapChange: (show: boolean) => void;
  onAutoLayout: () => void;
}) {
  const { fitView, setViewport, getViewport } = useReactFlow();
  const zoomPercent = Math.round(zoom * 100);

  const handleZoomChange = (value: string) => {
    const nextZoom = Number(value);
    const viewport = getViewport();
    setViewport({ ...viewport, zoom: nextZoom }, { duration: 120 });
  };

  return (
    <Panel position="bottom-left" className="!bottom-6 !left-6 !m-0">
      <div className="flex flex-col gap-2">
        {showMap && (
          <div className="relative h-[118px] w-[164px]">
            <div className="absolute inset-0 overflow-hidden rounded-[20px] border border-white/10 bg-[#070C14]/82 shadow-[0_14px_42px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-2xl">
              <MiniMap
                className="custom-canvas-minimap !m-0 !h-full !w-full !border-0 !bg-transparent !shadow-none"
                nodeStrokeWidth={1}
                nodeBorderRadius={4}
                pannable
                zoomable
                maskColor="transparent"
                nodeColor="rgba(90, 90, 99, 0.55)"
                nodeStrokeColor="rgba(255, 255, 255, 0.58)"
              />
              <div className="pointer-events-none absolute inset-0 rounded-[20px] shadow-[inset_0_0.5px_0_rgba(255,255,255,0.14)]" />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="flex h-12 items-center gap-2 rounded-[24px] border border-white/10 bg-[#070C14]/82 px-2.5 shadow-[0_14px_40px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-2xl">
            <ToolButton active={showMap} title={showMap ? "关闭小地图" : "打开小地图"} onClick={() => onMapChange(!showMap)}>
              <MapIcon />
            </ToolButton>
            <ToolButton active={showGrid} title={showGrid ? "关闭网格" : "打开网格"} onClick={() => onGridChange(!showGrid)}>
              <GridIcon />
            </ToolButton>
            <ToolButton
              title="适配视图"
              onClick={() => fitView({ padding: FIT_VIEW_PADDING, duration: 220, minZoom: CANVAS_MIN_ZOOM })}
            >
              <FitIcon />
            </ToolButton>
            <ToolButton title="自动布局" onClick={onAutoLayout}>
              <AutoLayoutIcon />
            </ToolButton>
            <div className="flex w-[112px] items-center gap-2 px-1">
              <input
                aria-label="缩放画布"
                type="range"
                min={CANVAS_MIN_ZOOM}
                max={CANVAS_MAX_ZOOM}
                step="0.01"
                value={zoom}
                onChange={(event) => handleZoomChange(event.target.value)}
                className="canvas-zoom-slider"
              />
              <span className="w-8 text-right font-mono text-[10px] text-[#E6E6E6]/70">{zoomPercent}%</span>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function CanvasFlow() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    addNode,
    addNodeWithEdges,
    updateNodeData,
    commitNodeDataHistory,
    setNodes,
    setEdges,
    projectId,
    canvasId,
  } = useFlowStore(
    useShallow((state) => ({
      nodes: state.nodes,
      edges: state.edges,
      onNodesChange: state.onNodesChange,
      onEdgesChange: state.onEdgesChange,
      addNode: state.addNode,
      addNodeWithEdges: state.addNodeWithEdges,
      updateNodeData: state.updateNodeData,
      commitNodeDataHistory: state.commitNodeDataHistory,
      setNodes: state.setNodes,
      setEdges: state.setEdges,
      projectId: state.projectId,
      canvasId: state.canvasId,
    }))
  );
  const { executeNode, cancelNode, resumeRunningTasks } = useSSETaskExecution();
  const { ensureEditorCanvas } = useProjectSync();
  const { screenToFlowPosition, getViewport, fitView } = useReactFlow();
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showCanvasGallery, setShowCanvasGallery] = useState(false);
  const [canvasGalleryPinned, setCanvasGalleryPinned] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [previewImage, setPreviewImage] = useState<ImagePreviewState | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const initializedCanvasRef = useRef(false);
  const lastPointerRef = useRef({ x: 240, y: 160 });
  const connectingRef = useRef<MenuMode | null>(null);

  // Enable keyboard shortcuts
  useKeyboardShortcuts({ enabled: true });

  // Enable auto-save to remote D1
  useAutoSave();

  useEffect(() => {
    if (initializedCanvasRef.current) return;
    initializedCanvasRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("projectId");
    const canvasId = params.get("canvasId");

    void ensureEditorCanvas({ projectId, canvasId }).then((ids) => {
      if (!ids) return;

      const nextParams = new URLSearchParams(window.location.search);
      nextParams.set("projectId", ids.projectId);
      nextParams.set("canvasId", ids.canvasId);
      window.history.replaceState(null, "", `${window.location.pathname}?${nextParams.toString()}`);
      resumeRunningTasks();
    });
  }, [ensureEditorCanvas, resumeRunningTasks]);

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges(addEdge(connection, useFlowStore.getState().edges));
    },
    [setEdges]
  );

  const openNodeMenu = useCallback(
    (screenPosition: { x: number; y: number }, mode: MenuMode = { type: "add" }) => {
      const rect = rootRef.current?.getBoundingClientRect();
      const menuPosition = rect
        ? { x: screenPosition.x - rect.left, y: screenPosition.y - rect.top }
        : screenPosition;

      setNodeMenu({
        menuPosition,
        flowPosition: screenToFlowPosition(screenPosition),
        mode,
      });
    },
    [screenToFlowPosition]
  );

  const openImagePreview = useCallback((image: ImagePreviewState) => {
    setPreviewImage(image);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isInputElement(event.target)) return;
      if (event.key === "Escape") {
        setNodeMenu(null);
        return;
      }
      if (event.key === "@") {
        event.preventDefault();
        openNodeMenu(lastPointerRef.current);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openNodeMenu]);

  /** Validate connection type compatibility */
  const isValidConnectionCheck: IsValidConnection = useCallback((connection) => {
    const { sourceHandle, targetHandle } = connection;
    if (!sourceHandle || !targetHandle) return false;

    const source = parseHandleId(sourceHandle);
    const target = parseHandleId(targetHandle);
    if (!source || !target) return false;

    return isConnectionValid(source.dataType, target.dataType);
  }, []);

  const handleMenuNodeSelect = useCallback(
    (nodeType: NodeTypeDefinition) => {
      if (!nodeMenu) return;
      const node = createCanvasNode(nodeType, nodeMenu.flowPosition);

      if (nodeMenu.mode.type === "connect") {
        const connection = getCompatibleConnection(nodeMenu.mode, nodeType, node.id);
        if (connection) {
          addNodeWithEdges(node, addEdge(connection, useFlowStore.getState().edges));
        } else {
          addNode(node);
        }
      } else {
        addNode(node);
      }

      setNodeMenu(null);
    },
    [addNode, addNodeWithEdges, nodeMenu]
  );

  const handleAddNode = useCallback(
    (nodeType: NodeTypeDefinition) => {
      const rect = rootRef.current?.getBoundingClientRect();
      const screenCenter = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : lastPointerRef.current;
      const flowCenter = screenToFlowPosition(screenCenter);

      addNode(createCanvasNode(nodeType, getNodeCenteredPosition(nodeType, flowCenter)));
    },
    [addNode, screenToFlowPosition]
  );

  const handleNodeConfigChange = useCallback(
    (nodeId: string, nodeType: string | undefined, data: Record<string, unknown>) => {
      if (nodeType === "txt2img") {
        persistTxt2ImgPreferences(data);
      }
      updateNodeData(nodeId, data);
    },
    [updateNodeData]
  );

  const handleImageFileUpload = useCallback(
    (nodeId: string, file: File) => {
      updateNodeData(nodeId, {
        title: file.name,
        source: "upload",
        uploadStatus: "uploading",
        uploadError: "",
      });

      void uploadCanvasImage(file, useFlowStore.getState().projectId)
        .then((result) => {
          updateNodeData(nodeId, {
            url: result.url,
            asset: result.asset,
            assetId: result.assetId || "",
            fileKey: result.assetId || "",
            title: result.title || file.name,
            source: "upload",
            uploadStatus: "success",
            uploadError: "",
            width: result.width,
            height: result.height,
            size: result.size,
            downloadUrl: result.downloadUrl,
          });
        })
        .catch((error: unknown) => {
          updateNodeData(nodeId, {
            uploadStatus: "failed",
            uploadError: error instanceof Error ? error.message : "图片上传失败",
          });
        });
    },
    [updateNodeData]
  );

  const handleViewportMove = useCallback((_: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    setZoom(Number(viewport.zoom.toFixed(2)));
  }, []);

  const handleExportJson = useCallback(() => {
    const { projectId, canvasId, nodes, edges } = useFlowStore.getState();
    const exportData = {
      version: CANVAS_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      projectId,
      canvasId,
      flowData: {
        nodes: removeRuntimeCallbacksFromNodes(nodes),
        edges,
        viewport: getViewport(),
      },
    };

    downloadJsonFile(createCanvasExportFileName(projectId, canvasId), exportData);
  }, [getViewport]);

  const handleAutoLayout = useCallback(() => {
    const { nodes, edges } = useFlowStore.getState();
    if (nodes.length <= 1) return;

    setNodes(getAutoLayoutNodes(nodes, edges));
    window.setTimeout(() => fitView({ padding: FIT_VIEW_PADDING, duration: 260, minZoom: CANVAS_MIN_ZOOM }), 0);
  }, [fitView, setNodes]);

  const handlePaneClick = useCallback(() => {
    setNodeMenu(null);
    if (showCanvasGallery && !canvasGalleryPinned) {
      setShowCanvasGallery(false);
    }
  }, [canvasGalleryPinned, showCanvasGallery]);

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | ReactMouseEvent) => {
      event.preventDefault();
      setShowCanvasGallery((show) => (show && !canvasGalleryPinned ? false : show));
      openNodeMenu({ x: event.clientX, y: event.clientY });
    },
    [canvasGalleryPinned, openNodeMenu]
  );

  /** Handle drag over to allow drop */
  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect =
      event.dataTransfer.types.includes("Files") || event.dataTransfer.types.includes(ASSET_DRAG_TYPE)
        ? "copy"
        : "move";
  }, []);

  /** Handle drop to create node at cursor position */
  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const draggedAsset = event.dataTransfer.getData(ASSET_DRAG_TYPE);
      if (draggedAsset) {
        try {
          const asset = JSON.parse(draggedAsset) as AssetDragPayload;
          if (!asset.url) return;

          const node = createCanvasNode(NODE_REGISTRY["image-input"], screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          }));
          node.data = {
            ...node.data,
            url: asset.url,
            thumbnailUrl: asset.thumbnailUrl || "",
            title: asset.title || asset.prompt || "生成素材",
            source: "asset-library",
            uploadStatus: "ready",
            generatedFrom: "gallery",
          };
          addNode(node);
          return;
        } catch (error) {
          console.warn("[canvas] Failed to parse dragged asset", error);
        }
      }

      const imageFiles = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length > 0) {
        const basePosition = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        for (const [index, file] of imageFiles.entries()) {
          const node = createCanvasNode(NODE_REGISTRY["image-input"], {
            x: basePosition.x + index * 28,
            y: basePosition.y + index * 28,
          });
          node.data = {
            ...node.data,
            title: file.name,
            source: "upload",
            uploadStatus: "uploading",
          };
          addNode(node);
          handleImageFileUpload(node.id, file);
        }

        return;
      }

      const nodeType = event.dataTransfer.getData(DND_NODE_TYPE);
      if (!nodeType || !NODE_REGISTRY[nodeType] || !isNodeTypeAvailable(NODE_REGISTRY[nodeType])) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(createCanvasNode(NODE_REGISTRY[nodeType], position));
    },
    [screenToFlowPosition, addNode, handleImageFileUpload]
  );

  const onConnectStart: OnConnectStart = useCallback(
    (_: unknown, params: { nodeId?: string | null; handleId?: string | null }) => {
      const { nodeId, handleId } = params;
      if (!nodeId || !handleId) {
        connectingRef.current = null;
        return;
      }

      const handle = parseHandleId(handleId);
      if (!handle) {
        connectingRef.current = null;
        return;
      }

      connectingRef.current = {
        type: "connect",
        nodeId,
        handleId,
        direction: handle.direction,
        dataType: handle.dataType,
      };
    },
    []
  );

  const onConnectEnd: OnConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const mode = connectingRef.current;
      connectingRef.current = null;
      if (!mode || mode.type !== "connect") return;

      const target = event.target;
      const targetIsPane =
        target instanceof Element && target.classList.contains("react-flow__pane");

      if (targetIsPane) {
        openNodeMenu(getEventClientPoint(event), mode);
      }
    },
    [openNodeMenu]
  );

  /** Inject callbacks into nodes */
  const nodesWithCallbacks = useMemo(
    () =>
      nodes.map((node) => {
        if (node.type === "prompt") {
          return {
            ...node,
            data: {
              ...node.data,
              onChange: (value: string) => updateNodeData(node.id, { text: value }, { recordHistory: false }),
              onCommit: commitNodeDataHistory,
            },
          };
        }
        if (node.type === "txt2img" || node.type === "img2video") {
          const hasNonEmptyPrompt =
            node.type === "txt2img" &&
            edges.some((edge) => {
              if (edge.target !== node.id) return false;
              const sourceNode = nodes.find((candidate) => candidate.id === edge.source);
              return sourceNode?.type === "prompt" && String(sourceNode.data.text || "").trim().length > 0;
            });
          const referenceImageCount =
            node.type === "txt2img"
              ? edges.reduce((count, edge) => {
                  if (edge.target !== node.id) return count;
                  const targetPort = edge.targetHandle ? parseHandleId(edge.targetHandle) : null;
                  if (targetPort?.portId !== "reference_images") return count;
                  const sourceNode = nodes.find((candidate) => candidate.id === edge.source);
                  const imageValue = sourceNode?.type === "image-input" ? sourceNode.data.url : undefined;
                  if (Array.isArray(imageValue)) return count + imageValue.filter(Boolean).length;
                  return imageValue ? count + 1 : count;
                }, 0)
              : 0;
          return {
            ...node,
            data: {
              ...node.data,
              canExecute: node.type === "txt2img" ? hasNonEmptyPrompt : true,
              referenceImageCount,
              onExecute: () => {
                if (node.type === "txt2img" && !hasNonEmptyPrompt) return;
                executeNode(node.id);
              },
              onCancel: () => cancelNode(node.id),
              onBatchChange: (n: number) => {
                persistTxt2ImgPreferences({ n });
                updateNodeData(node.id, { n, batchCount: n });
              },
              onConfigChange: (data: Record<string, unknown>) =>
                handleNodeConfigChange(node.id, node.type, data),
            },
          };
        }
        if (node.type === "image-input") {
          return {
            ...node,
            data: {
              ...node.data,
              onFileUpload: (file: File) => handleImageFileUpload(node.id, file),
              onPreviewImage: openImagePreview,
            },
          };
        }
        return node;
      }),
    [
      nodes,
      edges,
      updateNodeData,
      commitNodeDataHistory,
      executeNode,
      cancelNode,
      handleImageFileUpload,
      openImagePreview,
      handleNodeConfigChange,
    ]
  );

  return (
    <div
      ref={rootRef}
      className={`darkroom-canvas relative h-full w-full overflow-hidden ${
        showGrid ? "darkroom-grid" : "darkroom-no-grid"
      }`}
      onPointerMove={(event) => {
        lastPointerRef.current = { x: event.clientX, y: event.clientY };
      }}
    >
      <Toolbar
        onAddNode={handleAddNode}
        onExportJson={SHOULD_SHOW_CANVAS_EXPORT ? handleExportJson : undefined}
        onOpenGallery={() => setShowCanvasGallery(true)}
      />
      {nodeMenu && (
        <CanvasNodeMenu
          menu={nodeMenu}
          onSelect={handleMenuNodeSelect}
          onClose={() => setNodeMenu(null)}
        />
      )}
      <ReactFlow
        className="bg-transparent"
        nodes={nodesWithCallbacks}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onMove={handleViewportMove}
        isValidConnection={isValidConnectionCheck}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={{
          markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(226, 235, 248, 0.72)", width: 14, height: 14 },
        }}
        fitView
        minZoom={CANVAS_MIN_ZOOM}
        maxZoom={CANVAS_MAX_ZOOM}
        deleteKeyCode={null}
        selectionOnDrag
        selectionKeyCode={null}
        multiSelectionKeyCode="Shift"
        panOnDrag={[1, 2]}
        panActivationKeyCode="Space"
        paneClickDistance={5}
        proOptions={{ hideAttribution: true }}
      >
        <CanvasControls
          showGrid={showGrid}
          showMap={showMap}
          zoom={zoom}
          onGridChange={setShowGrid}
          onMapChange={setShowMap}
          onAutoLayout={handleAutoLayout}
        />
        {showGrid && (
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(184, 192, 204, 0.1)" />
        )}
      </ReactFlow>
      {showCanvasGallery && (
        <div className="absolute right-4 top-4 z-40 h-[calc(100%-2rem)] w-[min(920px,calc(100%-2rem))] overflow-hidden rounded-[30px] border border-white/10 bg-[#07101A]/94 shadow-[0_28px_100px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl">
          <GenerationGallery
            mode="panel"
            projectId={projectId}
            canvasId={canvasId}
            pinned={canvasGalleryPinned}
            onPinnedChange={setCanvasGalleryPinned}
            onClose={() => setShowCanvasGallery(false)}
          />
        </div>
      )}
      {previewImage && <PreviewOverlay image={previewImage} onClose={() => setPreviewImage(null)} />}
    </div>
  );
}

/** Wrapper that provides ReactFlowProvider (required for useReactFlow) */
export default function CanvasApp() {
  return (
    <ReactFlowProvider>
      <CanvasFlow />
    </ReactFlowProvider>
  );
}
