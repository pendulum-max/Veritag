"use client";

import { hashPair, sha256 } from "@veritag/sdk";
import { useMemo, useState } from "react";

export interface MerkleLeafInput {
  label: string;
  hash?: string;
}

interface MerkleTreeVisualizerProps {
  leaves?: MerkleLeafInput[];
  title?: string;
}

interface PositionedNode {
  id: string;
  level: number;
  index: number;
  hash: string;
  label: string;
  x: number;
  y: number;
  leftChildId?: string;
  rightChildId?: string;
}

const DEFAULT_LEAVES: MerkleLeafInput[] = Array.from({ length: 8 }, (_, i) => ({
  label: `CH-2026-000${i + 1}`,
}));

const MAX_LEAVES = 64;

function buildTreeLayout(inputs: MerkleLeafInput[]) {
  const capped = inputs.slice(0, MAX_LEAVES);
  const leafLayer = capped.map((item, idx) => {
    const hash = item.hash ?? sha256(`veritag-leaf:${item.label}:${idx}`).toString("hex");
    return {
      hash,
      label: item.label,
    };
  });

  const layers: Array<Array<{ hash: string; label: string }>> = [leafLayer];
  while (layers[layers.length - 1]!.length > 1) {
    const current = layers[layers.length - 1]!;
    const next: Array<{ hash: string; label: string }> = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = i + 1 < current.length ? current[i + 1]! : left;
      const combined = hashPair(
        Buffer.from(left.hash, "hex"),
        Buffer.from(right.hash, "hex"),
      ).toString("hex");
      next.push({
        hash: combined,
        label: current.length <= 2 ? "Merkle Root" : `Node L${layers.length}.${i / 2}`,
      });
    }
    layers.push(next);
  }

  const totalLevels = layers.length;
  const leafCount = leafLayer.length;
  const nodeSpacingX = Math.max(54, Math.min(110, 760 / Math.max(1, leafCount)));
  const levelHeight = 78;
  const width = Math.max(560, leafCount * nodeSpacingX + 80);
  const height = Math.max(260, totalLevels * levelHeight + 70);

  const nodes: PositionedNode[] = [];
  const nodeMap = new Map<string, PositionedNode>();

  // Position leaves first (level 0 at bottom), then center parents over children
  for (let level = 0; level < totalLevels; level++) {
    const layer = layers[level]!;
    const y = height - 44 - level * levelHeight;
    layer.forEach((entry, index) => {
      const id = `${level}-${index}`;
      let x: number;
      let leftChildId: string | undefined;
      let rightChildId: string | undefined;

      if (level === 0) {
        const totalWidth = (leafCount - 1) * nodeSpacingX;
        x = width / 2 - totalWidth / 2 + index * nodeSpacingX;
      } else {
        const leftId = `${level - 1}-${index * 2}`;
        const prevLayerLen = layers[level - 1]!.length;
        const rightIdx = index * 2 + 1 < prevLayerLen ? index * 2 + 1 : index * 2;
        const rightId = `${level - 1}-${rightIdx}`;
        leftChildId = leftId;
        rightChildId = rightId;
        const leftNode = nodeMap.get(leftId)!;
        const rightNode = nodeMap.get(rightId)!;
        x = (leftNode.x + rightNode.x) / 2;
      }

      const node: PositionedNode = {
        id,
        level,
        index,
        hash: entry.hash,
        label: level === totalLevels - 1 ? "Merkle Root" : entry.label,
        x,
        y,
        leftChildId,
        rightChildId,
      };
      nodes.push(node);
      nodeMap.set(id, node);
    });
  }

  return { nodes, nodeMap, totalLevels, width, height, leafCount };
}

export function MerkleTreeVisualizer({
  leaves = DEFAULT_LEAVES,
  title = "Interactive Merkle Proof Tree",
}: MerkleTreeVisualizerProps) {
  const [selectedLeafIdx, setSelectedLeafIdx] = useState<number | null>(null);
  const [hoveredNode, setHoveredNode] = useState<PositionedNode | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragOrigin, setDragOrigin] = useState({ x: 0, y: 0 });

  const layout = useMemo(() => buildTreeLayout(leaves), [leaves]);

  const { pathNodeIds, siblingNodeIds } = useMemo(() => {
    const path = new Set<string>();
    const siblings = new Set<string>();
    if (selectedLeafIdx === null || selectedLeafIdx < 0 || selectedLeafIdx >= layout.leafCount) {
      return { pathNodeIds: path, siblingNodeIds: siblings };
    }

    let idx = selectedLeafIdx;
    for (let level = 0; level < layout.totalLevels; level++) {
      path.add(`${level}-${idx}`);
      if (level < layout.totalLevels - 1) {
        const levelCount = layout.nodes.filter((n) => n.level === level).length;
        const siblingIdx = idx % 2 === 0 ? (idx + 1 < levelCount ? idx + 1 : idx) : idx - 1;
        siblings.add(`${level}-${siblingIdx}`);
        idx = Math.floor(idx / 2);
      }
    }
    return { pathNodeIds: path, siblingNodeIds: siblings };
  }, [selectedLeafIdx, layout]);

  const activeNode = hoveredNode ?? (selectedLeafIdx !== null ? layout.nodeMap.get(`0-${selectedLeafIdx}`) ?? null : null);

  return (
    <section
      aria-labelledby="merkle-visualizer-title"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="merkle-visualizer-title"
            className="text-base font-bold text-slate-900 dark:text-slate-100"
          >
            {title}
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Click any leaf unit ({layout.leafCount} leaves, max {MAX_LEAVES}) to highlight its
            emerald verification path to the Merkle root.
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Zoom out Merkle tree"
            onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.2).toFixed(2))))}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            -
          </button>
          <span className="min-w-[3rem] text-center font-mono text-xs text-slate-700 dark:text-slate-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in Merkle tree"
            onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.2).toFixed(2))))}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            +
          </button>
          <button
            type="button"
            aria-label="Reset Merkle tree zoom and pan"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Reset
          </button>
        </div>
      </div>

      <div
        className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950"
        onWheel={(e) => {
          e.preventDefault();
          const delta = e.deltaY < 0 ? 0.1 : -0.1;
          setZoom((z) => Math.max(0.5, Math.min(2.5, Number((z + delta).toFixed(2)))));
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-merkle-node]")) return;
          setDragging(true);
          setDragOrigin({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          setPan({ x: e.clientX - dragOrigin.x, y: e.clientY - dragOrigin.y });
        }}
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
      >
        <svg
          role="img"
          aria-label="Merkle tree diagram"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="h-80 w-full select-none touch-none cursor-grab active:cursor-grabbing"
        >
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {layout.nodes.map((node) => {
              const branches: Array<{ childId: string }> = [];
              if (node.leftChildId) branches.push({ childId: node.leftChildId });
              if (node.rightChildId && node.rightChildId !== node.leftChildId) {
                branches.push({ childId: node.rightChildId });
              }
              return branches.map(({ childId }) => {
                const child = layout.nodeMap.get(childId);
                if (!child) return null;
                const onPath = pathNodeIds.has(node.id) && pathNodeIds.has(child.id);
                return (
                  <line
                    key={`${node.id}->${child.id}`}
                    x1={node.x}
                    y1={node.y}
                    x2={child.x}
                    y2={child.y}
                    stroke={onPath ? "#10b981" : "#94a3b8"}
                    strokeWidth={onPath ? 3 : 1.5}
                    strokeOpacity={onPath ? 1 : 0.6}
                  />
                );
              });
            })}

            {layout.nodes.map((node) => {
              const isLeaf = node.level === 0;
              const isOnPath = pathNodeIds.has(node.id);
              const isSibling = siblingNodeIds.has(node.id);
              const fill = isOnPath
                ? "#10b981"
                : isSibling
                  ? "#3b82f6"
                  : node.level === layout.totalLevels - 1
                    ? "#0f172a"
                    : "#ffffff";
              const stroke = isOnPath ? "#047857" : isSibling ? "#1d4ed8" : "#475569";
              const textColor =
                isOnPath || isSibling || node.level === layout.totalLevels - 1
                  ? "#ffffff"
                  : "#0f172a";

              return (
                <g
                  key={node.id}
                  data-merkle-node="true"
                  data-node-id={node.id}
                  data-highlighted={isOnPath ? "true" : "false"}
                  role={isLeaf ? "button" : undefined}
                  tabIndex={isLeaf ? 0 : undefined}
                  aria-label={
                    isLeaf
                      ? `Select leaf ${node.label}, SHA-256 ${node.hash.slice(0, 12)}`
                      : `${node.label}, SHA-256 ${node.hash.slice(0, 12)}`
                  }
                  className={isLeaf ? "cursor-pointer" : "cursor-default"}
                  onClick={() => {
                    if (isLeaf) {
                      setSelectedLeafIdx((prev) => (prev === node.index ? null : node.index));
                    }
                    setHoveredNode(node);
                  }}
                  onKeyDown={(e) => {
                    if (isLeaf && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      setSelectedLeafIdx((prev) => (prev === node.index ? null : node.index));
                      setHoveredNode(node);
                    }
                  }}
                  onMouseEnter={() => setHoveredNode(node)}
                  onMouseLeave={() => setHoveredNode(null)}
                >
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={isLeaf ? 16 : 14}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={2}
                  />
                  <text
                    x={node.x}
                    y={node.y + 3}
                    textAnchor="middle"
                    fontSize="8"
                    fontFamily="monospace"
                    fontWeight="bold"
                    fill={textColor}
                  >
                    {node.hash.slice(0, 4)}
                  </text>
                  {isLeaf && (
                    <text
                      x={node.x}
                      y={node.y + 28}
                      textAnchor="middle"
                      fontSize="8"
                      fill="currentColor"
                      className="text-slate-700 dark:text-slate-300"
                    >
                      {node.label.length > 10 ? `${node.label.slice(0, 9)}…` : node.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div
        role="status"
        aria-live="polite"
        data-testid="merkle-tooltip"
        className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-950"
      >
        {activeNode ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {activeNode.label}
            </span>
            <span className="break-all font-mono text-slate-700 dark:text-slate-300">
              SHA-256: {activeNode.hash}
            </span>
          </div>
        ) : (
          <span className="text-slate-600 dark:text-slate-400">
            Hover or tap any node to inspect its SHA-256 hash. Click a leaf to trace its proof path.
          </span>
        )}
      </div>
    </section>
  );
}
