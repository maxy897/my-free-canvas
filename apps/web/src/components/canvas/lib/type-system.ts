import type { PortDataType } from "@shared/types";

/** Color mapping for port data types */
export const PORT_COLORS: Record<PortDataType, string> = {
  text: "#ffb454",
  image: "#28d7f5",
  video: "#9b7cff",
};

export const HANDLE_STYLE = {
  width: 14,
  height: 14,
  border: "2px solid #14171d",
  boxShadow: "0 0 0 1.5px currentColor, 0 0 12px currentColor",
  borderRadius: "50%",
  transition: "box-shadow 0.2s ease, border-color 0.2s ease",
};

/** Check if a connection between two handles is valid */
export function isConnectionValid(
  sourceHandleType: PortDataType,
  targetHandleType: PortDataType
): boolean {
  return sourceHandleType === targetHandleType;
}

/** Get handle ID format: "{nodeType}-{portId}-{direction}" */
export function makeHandleId(portId: string, dataType: PortDataType, direction: "source" | "target"): string {
  return `${portId}:${dataType}:${direction}`;
}

/** Parse handle ID back to components */
export function parseHandleId(handleId: string): { portId: string; dataType: PortDataType; direction: "source" | "target" } | null {
  const parts = handleId.split(":");
  if (parts.length !== 3) return null;
  return {
    portId: parts[0],
    dataType: parts[1] as PortDataType,
    direction: parts[2] as "source" | "target",
  };
}
