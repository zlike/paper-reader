import { useCallback, useEffect, useState } from 'react';

export function useTextSelection(containerRef) {
  const [selectedText, setSelectedText] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      const container = containerRef.current;
      if (text && selection.anchorNode && container && container.contains(selection.anchorNode)) {
        setSelectedText(text);
        setVisible(true);
      }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [containerRef]);

  const dismissSelection = useCallback(() => {
    setVisible(false);
  }, []);

  return { selectedText, visible, dismissSelection };
}
