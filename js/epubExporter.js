/**
 * EPUB 3.0 Electronic Publication Exporter
 * Compiles captured book pages and OCR transcripts into standard, compliant EPUB files
 * compatible with Apple Books, Google Play Books, Kindle, Calibre, and mobile e-readers.
 */

export class EpubExporter {
  /**
   * Generates timestamp string in format: YYYYMMDD_HHmm
   */
  static getTimestampString() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const y = now.getFullYear();
    const m = pad(now.getMonth() + 1);
    const d = pad(now.getDate());
    const hh = pad(now.getHours());
    const mm = pad(now.getMinutes());
    return `${y}${m}${d}_${hh}${mm}`;
  }

  /**
   * Compiles pages into an EPUB file Blob
   * @param {Array} pages - list of page objects from PageStore
   * @param {Object} metadata - { title, author, language, publisher }
   * @param {Function} onProgress - (curr, total) => void
   * @returns {Promise<{ blob: Blob, filename: string }>}
   */
  static async generateEpubBlob(pages, metadata = {}, onProgress = null) {
    if (!pages || pages.length === 0) {
      throw new Error('내보낼 스캔 페이지가 없습니다.');
    }

    if (!window.JSZip) {
      throw new Error('JSZip 라이브러리가 로드되지 않았습니다.');
    }

    const zip = new window.JSZip();

    const title = metadata.title || `AI Book Scan ${this.getTimestampString()}`;
    const author = metadata.author || 'AI Video Book Scanner';
    const language = metadata.language || 'ko';
    const bookId = 'urn:uuid:' + (crypto.randomUUID ? crypto.randomUUID() : ('book-' + Date.now()));
    const dateStr = new Date().toISOString().split('T')[0];

    // 1. mimetype (must be plain text, uncompressed, first file)
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

    // 2. META-INF/container.xml
    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
    zip.file('META-INF/container.xml', containerXml);

    // 3. OEBPS/stylesheet.css
    const stylesheetCss = `
body {
  margin: 0;
  padding: 1.5rem;
  font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  color: #1e293b;
  background-color: #ffffff;
  line-height: 1.75;
}
.page-container {
  max-width: 820px;
  margin: 0 auto;
  page-break-after: always;
}
.page-header {
  font-size: 0.85rem;
  color: #64748b;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 0.5rem;
  margin-bottom: 1.25rem;
  display: flex;
  justify-content: space-between;
}
.page-image-wrapper {
  text-align: center;
  margin: 1.5rem 0;
}
.page-image {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
.page-text-content {
  margin-top: 1.5rem;
  font-size: 1.05rem;
  word-break: keep-all;
}
.page-text-content p {
  margin-bottom: 1rem;
  text-indent: 1em;
}
.page-footer {
  text-align: center;
  font-size: 0.8rem;
  color: #94a3b8;
  margin-top: 2rem;
  border-top: 1px solid #f1f5f9;
  padding-top: 0.5rem;
}
`;
    zip.file('OEBPS/stylesheet.css', stylesheetCss);

    // 4. Collect images & pages
    const manifestItems = [];
    const spineItemrefs = [];
    const navPoints = [];
    const totalPages = pages.length;

    for (let i = 0; i < totalPages; i++) {
      const page = pages[i];
      const padNum = String(page.pageNumber).padStart(3, '0');
      const imgFilename = `images/page_${padNum}.jpg`;
      const xhtmlFilename = `pages/page_${padNum}.xhtml`;
      const imgId = `img_${padNum}`;
      const pageId = `page_${padNum}`;

      // Extract raw base64 data
      const dataUrl = page.enhancedDataUrl || page.originalDataUrl;
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      zip.file(`OEBPS/${imgFilename}`, base64Data, { base64: true });

      // Build XHTML page content
      const textParagraphs = (page.ocrText || '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => `<p>${this._escapeXml(line)}</p>`)
        .join('\n');

      const pageTitle = `페이지 ${page.pageNumber}`;
      const pageXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}" lang="${language}">
<head>
  <meta charset="UTF-8" />
  <title>${pageTitle}</title>
  <link rel="stylesheet" type="text/css" href="../stylesheet.css" />
</head>
<body>
  <div class="page-container">
    <div class="page-header">
      <span>${this._escapeXml(title)}</span>
      <span>P. ${page.pageNumber}</span>
    </div>

    <div class="page-image-wrapper">
      <img src="../${imgFilename}" alt="스캔 페이지 ${page.pageNumber}" class="page-image" />
    </div>

    <div class="page-text-content">
      ${textParagraphs || '<p><em>(텍스트 없음)</em></p>'}
    </div>

    <div class="page-footer">
      - ${page.pageNumber} / ${totalPages} -
    </div>
  </div>
</body>
</html>`;

      zip.file(`OEBPS/${xhtmlFilename}`, pageXhtml);

      manifestItems.push(`<item id="${imgId}" href="${imgFilename}" media-type="image/jpeg" />`);
      manifestItems.push(`<item id="${pageId}" href="${xhtmlFilename}" media-type="application/xhtml+xml" />`);
      spineItemrefs.push(`<itemref idref="${pageId}" />`);

      navPoints.push(`
    <navPoint id="nav_${padNum}" playOrder="${i + 1}">
      <navLabel><text>페이지 ${page.pageNumber}</text></navLabel>
      <content src="${xhtmlFilename}" />
    </navPoint>`);

      if (onProgress) {
        onProgress(i + 1, totalPages);
      }
    }

    // 5. OEBPS/toc.ncx (EPUB2/3 compatibility)
    const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${bookId}" />
    <meta name="dtb:depth" content="1" />
    <meta name="dtb:totalPageCount" content="${totalPages}" />
    <meta name="dtb:maxPageNumber" content="${totalPages}" />
  </head>
  <docTitle><text>${this._escapeXml(title)}</text></docTitle>
  <docAuthor><text>${this._escapeXml(author)}</text></docAuthor>
  <navMap>
    ${navPoints.join('\n')}
  </navMap>
</ncx>`;
    zip.file('OEBPS/toc.ncx', tocNcx);

    // 6. OEBPS/nav.xhtml (EPUB 3 Navigation Document)
    const navListItems = pages.map(p => {
      const padNum = String(p.pageNumber).padStart(3, '0');
      return `<li><a href="pages/page_${padNum}.xhtml">페이지 ${p.pageNumber}</a></li>`;
    }).join('\n      ');

    const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}" lang="${language}">
<head>
  <meta charset="UTF-8" />
  <title>목차 (Table of Contents)</title>
  <link rel="stylesheet" type="text/css" href="stylesheet.css" />
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>목차</h1>
    <ol>
      ${navListItems}
    </ol>
  </nav>
</body>
</html>`;
    zip.file('OEBPS/nav.xhtml', navXhtml);

    // 7. OEBPS/content.opf (Package Document)
    const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookID">${bookId}</dc:identifier>
    <dc:title>${this._escapeXml(title)}</dc:title>
    <dc:creator>${this._escapeXml(author)}</dc:creator>
    <dc:language>${language}</dc:language>
    <dc:date>${dateStr}</dc:date>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.[0-9]+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="css" href="stylesheet.css" media-type="text/css" />
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spineItemrefs.join('\n    ')}
  </spine>
</package>`;
    zip.file('OEBPS/content.opf', contentOpf);

    // Generate output zip as blob with correct epub mime type
    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/epub+zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    const filename = `BookScan_${this.getTimestampString()}.epub`;
    return { blob, filename };
  }

  /**
   * Exports and downloads EPUB file directly to user device
   */
  static async exportEpub(pages, metadata = {}, onProgress = null) {
    const { blob, filename } = await this.generateEpubBlob(pages, metadata, onProgress);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return filename;
  }

  static _escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }
}
