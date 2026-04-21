// JSZip으로 샘플 불변 파츠 + 동적 section0.xml을 패키징하여 .hwpx Blob 생성
import { ASSETS, PREV_IMAGE_URL } from './hwpx-assets.js';
import { buildSection0Xml } from './section-builder.js';

// JSZip UMD가 window.JSZip 또는 전역으로 로드되어 있다고 가정 (index/admin html에서 CDN).
function getJSZip() {
  if (typeof window !== 'undefined' && window.JSZip) return window.JSZip;
  throw new Error('JSZip 라이브러리가 로드되지 않았습니다.');
}

let _prvImageCache = null;
async function loadPrvImage() {
  if (_prvImageCache) return _prvImageCache;
  const res = await fetch(PREV_IMAGE_URL);
  if (!res.ok) throw new Error('PrvImage.png 로드 실패');
  _prvImageCache = await res.arrayBuffer();
  return _prvImageCache;
}

export async function buildHwpxBlob(round, submissions) {
  const JSZip = getJSZip();
  const zip = new JSZip();

  // 1) mimetype 맨 먼저, STORE
  const mimetypeEntry = ASSETS.find(a => a.path === 'mimetype');
  zip.file(mimetypeEntry.path, mimetypeEntry.content, { compression: 'STORE' });

  // 2) 나머지 불변 파츠 (mimetype 제외)
  for (const a of ASSETS) {
    if (a.path === 'mimetype') continue;
    zip.file(a.path, a.content, { compression: 'DEFLATE' });
  }

  // 3) Preview/PrvImage.png (바이너리)
  const prvImage = await loadPrvImage();
  zip.file('Preview/PrvImage.png', prvImage, { compression: 'STORE' });

  // 4) 동적 section0.xml
  const sectionXml = buildSection0Xml(round, submissions);
  zip.file('Contents/section0.xml', sectionXml, { compression: 'DEFLATE' });

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/hwp+zip',
    compression: 'DEFLATE',
  });
  return blob;
}

export function suggestFileName(round) {
  const form = round.form === 'monthly' ? '월례' : '주례';
  const base = round.baseDate || '';
  return `간부회의자료_${form}_${base}.hwpx`;
}
