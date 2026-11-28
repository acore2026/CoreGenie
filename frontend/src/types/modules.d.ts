declare module "uuid" {
  export function v4(): string;
}

declare module "file-saver" {
  export function saveAs(data: Blob | string, filename?: string): void;
}

declare module "react-beautiful-dnd" {
  import type { CSSProperties, ReactNode } from "react";
  export interface DragStart {
    draggableId: string;
  }
  export interface DropResult {
    reason: string;
    draggableId: string;
    source: { droppableId: string; index: number };
    destination?: { droppableId: string; index: number } | null;
  }
  export interface DraggableProvided {
    innerRef: (element: HTMLElement | null) => void;
    draggableProps: {
      style?: CSSProperties;
      [key: string]: unknown;
    };
    dragHandleProps?: Record<string, unknown> | null;
  }
  export interface DraggableStateSnapshot {
    isDragging: boolean;
  }
  export function DragDropContext(props: {
    onDragEnd: (result: DropResult) => void;
    onDragStart?: (start: DragStart) => void;
    children: ReactNode;
  }): JSX.Element;
  export function Draggable(props: {
    draggableId: string;
    index: number;
    isDragDisabled?: boolean;
    children: (
      provided: DraggableProvided,
      snapshot: DraggableStateSnapshot
    ) => ReactNode;
  }): JSX.Element;
}
