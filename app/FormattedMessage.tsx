"use client";

import React, { ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*.*?\*\*|`.*?`|\*.*?\*)/g;
  const segments = text.split(regex);

  segments.forEach((seg, i) => {
    if (!seg) return;
    if (seg.startsWith("**") && seg.endsWith("**") && seg.length >= 4) {
      parts.push(
        <strong key={i} className="bubble-strong">
          {seg.slice(2, -2)}
        </strong>,
      );
    } else if (seg.startsWith("`") && seg.endsWith("`") && seg.length >= 2) {
      parts.push(
        <code key={i} className="bubble-code">
          {seg.slice(1, -1)}
        </code>,
      );
    } else if (
      seg.startsWith("*") &&
      seg.endsWith("*") &&
      seg.length >= 2 &&
      !seg.startsWith("**")
    ) {
      parts.push(<em key={i}>{seg.slice(1, -1)}</em>);
    } else {
      parts.push(seg);
    }
  });

  return parts;
}

export default function FormattedMessage({ text }: { text: string }) {
  if (!text) return null;

  const normalized = text.replace(/\r\n/g, "\n");
  const rawLines = normalized.split("\n");

  const elements: ReactNode[] = [];
  let currentList: { indent: number; text: string }[] = [];

  function flushList() {
    if (currentList.length > 0) {
      elements.push(
        <ul className="bubble-list" key={`list-${elements.length}`}>
          {currentList.map((item, idx) => (
            <li
              key={idx}
              className={`bubble-list-item ${item.indent > 0 ? "nested" : ""}`}
              style={
                item.indent > 0
                  ? { paddingLeft: `${item.indent * 14}px` }
                  : undefined
              }
            >
              <span className="bubble-bullet">●</span>
              <span className="bubble-item-content">
                {renderInline(item.text)}
              </span>
            </li>
          ))}
        </ul>,
      );
      currentList = [];
    }
  }

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushList();
      elements.push(
        <hr key={`hr-${elements.length}`} className="bubble-divider" />,
      );
      continue;
    }

    const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      flushList();
      elements.push(
        <div className="bubble-heading" key={`h-${elements.length}`}>
          {renderInline(headerMatch[2])}
        </div>,
      );
      continue;
    }

    const listMatch = rawLine.match(/^(\s*)(?:[\*\-\•]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const indent = Math.floor(listMatch[1].length / 2);
      currentList.push({ indent, text: listMatch[2] });
      continue;
    }

    flushList();

    elements.push(
      <p className="bubble-paragraph" key={`p-${elements.length}`}>
        {renderInline(trimmed)}
      </p>,
    );
  }

  flushList();

  return <div className="bubble-formatted">{elements}</div>;
}
