import { getStageRef } from './stageRef';

function dataURLtoBlob(dataURL: string): Blob {
  const [header, data] = dataURL.split(',');
  const mime = header!.match(/:(.*?);/)![1];
  const binary = atob(data!);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportPNG(planName = 'floor-plan'): void {
  const stage = getStageRef();
  if (!stage) return;
  const dataURL = stage.toDataURL({ pixelRatio: 2 });
  download(`${planName}.png`, dataURLtoBlob(dataURL));
}

export async function exportPDF(planName = 'floor-plan'): Promise<void> {
  const stage = getStageRef();
  if (!stage) return;

  const { jsPDF } = await import('jspdf');
  const dataURL = stage.toDataURL({ pixelRatio: 2 });

  const stageW = stage.width();
  const stageH = stage.height();

  const landscape = stageW >= stageH;
  const doc = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'px',
    format: [stageW, stageH],
    hotfixes: ['px_scaling'],
  });

  doc.addImage(dataURL, 'PNG', 0, 0, stageW, stageH);
  doc.save(`${planName}.pdf`);
}
