import React, { useRef, useState, useEffect, useMemo } from "react";

export default function VirtualList({
  items = [],
  height = 500,
  itemHeight = 180,
  overscan = 3,
  renderItem,
  keyExtractor,
  className = "",
}) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  const total = items.length;
  const visibleCount = Math.max(1, Math.ceil(height / itemHeight));
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(total, startIndex + visibleCount + overscan * 2);
  const topPadding = startIndex * itemHeight;
  const bottomPadding = Math.max(0, (total - endIndex) * itemHeight);

  const visibleItems = useMemo(() => items.slice(startIndex, endIndex), [items, startIndex, endIndex]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ height, overflowY: "auto", willChange: "transform" }}
      className={className}
      aria-label="Lista virtualizada"
    >
      <div style={{ height: topPadding }} />
      <div>
        {visibleItems.map((item, i) => {
          const index = startIndex + i;
          const key = keyExtractor ? keyExtractor(item, index) : index;
          return (
            <div key={key} style={{ minHeight: itemHeight }}>
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
      <div style={{ height: bottomPadding }} />
    </div>
  );
}

