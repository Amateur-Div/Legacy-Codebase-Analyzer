"use client";

import React, { useEffect, useRef, useState } from "react";
import { Handle, Position } from "reactflow";
import { NODE_H, NODE_W } from "../../utils/graphLayout";
import { baseNodeStyle } from "../../utils/graphStyles";

export default function CustomNode({ data }: any) {
  const nodeRef = useRef<HTMLDivElement | null>(null);

  const [tooltipEl, setTooltipEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let el = document.getElementById("flow-tooltip") as HTMLDivElement | null;

    if (!el) {
      el = document.createElement("div");

      el.id = "flow-tooltip";

      el.style.position = "fixed";
      el.style.zIndex = "99999";
      el.style.pointerEvents = "none";
      el.style.background = "rgba(0,0,0,0.85)";
      el.style.color = "#fff";
      el.style.padding = "6px 8px";
      el.style.borderRadius = "6px";
      el.style.fontSize = "11px";
      el.style.maxWidth = "480px";
      el.style.whiteSpace = "pre-wrap";
      el.style.display = "none";

      document.body.appendChild(el);
    }

    setTooltipEl(el);

    return () => {};
  }, []);

  const filterOpacity = data?.fadedByFilter ? 0.15 : 1;
  const highlightOpacity = data?.fadedByHighlight ? 0.08 : 1;
  const deadOpacity = data?.fadedByDead ? 0.05 : 1;
  const functionFocusOpacity = data?.fadedByFunctionFocus ? 0.05 : 1;

  const finalOpacity = Math.min(
    filterOpacity,
    highlightOpacity,
    deadOpacity,
    functionFocusOpacity,
  );

  const isDead = data?.fadedByDead;

  const showTooltip = () => {
    if (!nodeRef.current || !tooltipEl) return;

    const rect = nodeRef.current.getBoundingClientRect();
    tooltipEl.textContent =
      (data?.raw?.code ?? "No code") +
      (data?.fadedByDead ? "\n⚠ Dead / unreachable code" : "");

    tooltipEl.style.left = `${rect.left + rect.width / 2}px`;
    tooltipEl.style.top = `${rect.bottom + 6}px`;
    tooltipEl.style.transform = "translateX(-50%)";
    tooltipEl.style.display = "block";
  };

  const hideTooltip = () => {
    if (!tooltipEl) return;

    setTimeout(() => {
      tooltipEl.style.display = "none";
    }, 600);
  };

  return (
    <div
      ref={nodeRef}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      style={{
        ...baseNodeStyle,
        background: data?.color || "#fff",
        width: NODE_W - 24,
        height: NODE_H - 24,
        opacity: finalOpacity,
        border: isDead ? "1px dashed #9CA3AF" : "1px solid #ccc",
        transform: data?.focused ? "scale(1.08)" : "scale(1)",
        boxShadow: data?.focused
          ? "0 0 0 3px rgba(59,130,246,0.6)"
          : "0 3px 6px rgba(0,0,0,0.08)",
        cursor: data?.fadedByFilter ? "not-allowed" : "default",
        pointerEvents: data?.fadedByFilter ? "none" : "auto",
      }}
      onMouseOver={(e) =>
        (e.currentTarget.style.boxShadow = "0 0 10px rgba(59,130,246,0.4)")
      }
      onMouseOut={(e) =>
        (e.currentTarget.style.boxShadow = "0 3px 6px rgba(0,0,0,0.08)")
      }
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          opacity: 0,
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          flex: 1,
          paddingRight: 6,
        }}
      >
        {data.label}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          opacity: 0,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
