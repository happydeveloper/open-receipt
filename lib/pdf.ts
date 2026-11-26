// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * PDF 서류를 쪽마다 그림으로 바꾼다 (브라우저에서만 쓴다).
 *
 * 온라인몰의 거래명세서와 주문내역은 대부분 PDF로 받는다. 앱의 나머지 부분(가림, 에이전트 읽기, 자료 붙이기,
 * 결산보고서)은 모두 사진을 다루므로, PDF를 고르면 여기서 쪽마다 사진으로 바꿔 같은 길을 타게 한다.
 * PDF 파일 자체는 저장하거나 서버로 보내지 않는다. 바꾸는 일은 기기 안에서 끝난다.
 */
export const PDF_MAX_PAGES = 10;
export const isPdf = (f: { type: string; name: string }) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

export interface PdfPages {
  /** 쪽마다 한 장의 JPEG (data URI) */
  pages: string[];
  /** PDF의 전체 쪽수. pages보다 크면 앞쪽 일부만 바꾼 것이다 */
  total: number;
}

/** PDF를 열어 앞에서부터 maxPages쪽까지 그림으로 바꾼다. 긴 변이 1600px쯤 되게 그린다. */
export async function pdfToImages(file: Blob, maxPages = PDF_MAX_PAGES): Promise<PdfPages> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  let doc;
  try {
    // 글꼴이 PDF 안에 들어 있지 않으면 글자 자료가 따로 필요하다 (한글, 한자 등). public/pdfjs/에 pdfjs-dist의 것을 그대로 두었다.
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/" }).promise;
  } catch (e: any) {
    throw new Error(e?.name === "PasswordException" ? "암호가 걸린 PDF는 열 수 없습니다. 암호를 푼 파일이나 화면을 캡처한 그림을 올려 주세요." : "PDF를 열지 못했습니다. 파일이 깨졌거나 PDF가 아닐 수 있습니다.");
  }
  const pages: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, 1600 / Math.max(base.width, base.height)) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: g, viewport }).promise;
    pages.push(canvas.toDataURL("image/jpeg", 0.9));
  }
  const total = doc.numPages;
  await doc.loadingTask.destroy();
  return { pages, total };
}
