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
  /** Prefer placing popup to the side (for card rows) vs below (for inline thumbs) */
  placement?: 'side' | 'below';
}

export function usePopup(options: UsePopupOptions = {}) {
  const { popupWidth = 160, popupHeight = 230, placement = 'below' } = options;
  const [show, setShow] = useState(false);
  const [popupStyle, setPopupStyle] = useState<PopupStyle>({});
  const ref = useRef<HTMLElement>(null);

  const calcPosition = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const style: PopupStyle = {};

    if (placement === 'side') {
      // Desktop card row: popup appears to the side
      if (rect.right + popupWidth + 10 > window.innerWidth) {
        style.left = 'auto';
        style.right = '100%';
        style.marginRight = '10px';
      } else {
        style.left = '100%';
        style.marginLeft = '10px';
      }
      let top = rect.top;
      if (top + popupHeight > window.innerHeight) top = window.innerHeight - popupHeight - 8;
      if (top < 8) top = 8;
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

  const handleMouseEnter = useCallback(() => {
    if (isTouch) return;
    calcPosition();
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
    setShow,
  };
}

export { isTouch };
