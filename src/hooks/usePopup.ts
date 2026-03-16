import { useCallback, useEffect, useRef, useState } from 'react';

const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

interface PopupStyle {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  transform?: string;
  marginTop?: string;
  marginBottom?: string;
  marginLeft?: string;
  marginRight?: string;
}

interface UsePopupOptions {
  /** Estimated popup width in px */
  popupWidth?: number;
  /** Estimated popup height in px */
  popupHeight?: number;
  /** 'mouse' = near cursor (desktop card rows), 'below' = below/above element (thumbs, touch) */
  placement?: 'mouse' | 'below';
}

export function usePopup(options: UsePopupOptions = {}) {
  const { popupWidth = 160, popupHeight = 230, placement = 'below' } = options;
  const [show, setShow] = useState(false);
  const [popupStyle, setPopupStyle] = useState<PopupStyle>({});
  const ref = useRef<HTMLElement>(null);

  const calcPosition = useCallback((mouseX?: number, mouseY?: number) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const style: PopupStyle = {};

    if (placement === 'mouse' && mouseX !== undefined && mouseY !== undefined) {
      const offset = 16;

      // Horizontal: prefer right of cursor, flip left if it clips
      let left = mouseX + offset;
      if (left + popupWidth > window.innerWidth - 8) {
        left = mouseX - popupWidth - offset;
      }
      if (left < 8) left = 8;

      // Vertical: prefer below cursor, flip above if it clips
      let top = mouseY + offset;
      if (top + popupHeight > window.innerHeight - 8) {
        top = mouseY - popupHeight - offset;
      }
      if (top < 8) top = 8;

      // Convert from viewport coords to element-relative (element is position:relative)
      style.left = `${left - rect.left}px`;
      style.top = `${top - rect.top}px`;
    } else {
      // Below/above: for token thumbs and mobile card rows
      if (rect.bottom + popupHeight + 6 > window.innerHeight) {
        style.top = 'auto';
        style.bottom = '100%';
        style.marginBottom = '6px';
      } else {
        style.top = '100%';
        style.marginTop = '6px';
      }
      // Center horizontally, clamped to viewport
      const center = rect.left + rect.width / 2;
      let leftOffset = center - popupWidth / 2;
      if (leftOffset < 8) leftOffset = 8;
      if (leftOffset + popupWidth > window.innerWidth - 8) leftOffset = window.innerWidth - popupWidth - 8;
      style.left = `${leftOffset - rect.left}px`;
      style.transform = 'none';
    }

    setPopupStyle(style);
  }, [popupWidth, popupHeight, placement]);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    if (isTouch) return;
    calcPosition(e.clientX, e.clientY);
    setShow(true);
  }, [calcPosition]);

  const handleMouseLeave = useCallback(() => {
    if (isTouch) return;
    setShow(false);
  }, []);

  const handleTap = useCallback((e: React.MouseEvent) => {
    if (!isTouch) return;
    e.stopPropagation();
    calcPosition();
    setShow(prev => !prev);
  }, [calcPosition]);

  // Close on outside tap (touch devices)
  useEffect(() => {
    if (!show || !isTouch) return;
    const close = (e: TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShow(false);
      }
    };
    document.addEventListener('touchstart', close);
    return () => document.removeEventListener('touchstart', close);
  }, [show]);

  return {
    ref,
    show,
    popupStyle,
    isTouch,
    handlers: {
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
      onClick: handleTap,
    },
  };
}

export { isTouch };
