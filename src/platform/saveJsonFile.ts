import { Capacitor, registerPlugin } from '@capacitor/core';

interface ReaderFilesPlugin {
  saveJson(options: { filename: string; contents: string }): Promise<{ cancelled: boolean }>;
}

const ReaderFiles = registerPlugin<ReaderFilesPlugin>('ReaderFiles');

export async function saveJsonFile(filename: string, contents: string): Promise<void> {
  if (Capacitor.getPlatform() === 'android') {
    await ReaderFiles.saveJson({ filename, contents });
    return;
  }

  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
