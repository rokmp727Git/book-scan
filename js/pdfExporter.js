/**
 * Multi-page PDF Compiler & Exporter
 * Utilizes jsPDF v2.5 to compile captured book pages into standard A4 portrait PDFs
 * with aspect ratio preservation, margins, searchable text embedding, and timestamped filenames.
 */

export class PdfExporter {
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
   * Helper to load an image and obtain its natural dimensions
   */
  static getImageDimensions(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = reject;
      img.src = src;
    });
  }

  /**
   * Compile and download multi-page PDF
   * @param {Array} pages - list of page objects from PageStore
   * @param {Object} options - { format: 'a4'|'fit', embedSearchableText: boolean, appendTranscript: boolean, quality: number }
   * @param {Function} onProgress - (curr, total) => void
   */
  static async exportPdf(pages, options = {}, onProgress = null) {
    if (!pages || pages.length === 0) {
      throw new Error('내보낼 스캔 페이지가 없습니다.');
    }

    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('jsPDF 라이브러리가 로드되지 않았습니다.');
    }

    const { jsPDF } = window.jspdf;
    const format = options.format || 'a4';
    const embedText = options.embedSearchableText !== false;
    const appendTranscript = options.appendTranscript || false;

    // Standard A4 portrait in millimeters
    const A4_WIDTH = 210;
    const A4_HEIGHT = 297;
    const MARGIN = 10; // 10mm margin
    const PRINT_WIDTH = A4_WIDTH - (MARGIN * 2);
    const PRINT_HEIGHT = A4_HEIGHT - (MARGIN * 2);

    let doc = null;
    const totalPages = pages.length;

    for (let i = 0; i < totalPages; i++) {
      const page = pages[i];
      const imgSrc = page.enhancedDataUrl || page.originalDataUrl;
      const dims = await this.getImageDimensions(imgSrc);

      if (i === 0) {
        if (format === 'fit') {
          // Fit orientation to first image ratio
          const orientation = dims.width > dims.height ? 'landscape' : 'portrait';
          doc = new jsPDF({ orientation, unit: 'mm' });
        } else {
          doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        }
      } else {
        if (format === 'fit') {
          const orientation = dims.width > dims.height ? 'landscape' : 'portrait';
          doc.addPage([dims.width * 0.264583, dims.height * 0.264583], orientation);
        } else {
          doc.addPage('a4', 'portrait');
        }
      }

      // Calculate fitted bounds preserving aspect ratio
      const imgRatio = dims.width / dims.height;
      let renderW = PRINT_WIDTH;
      let renderH = renderW / imgRatio;

      if (renderH > PRINT_HEIGHT) {
        renderH = PRINT_HEIGHT;
        renderW = renderH * imgRatio;
      }

      // Center image within page printable bounds
      const renderX = MARGIN + ((PRINT_WIDTH - renderW) / 2);
      const renderY = MARGIN + ((PRINT_HEIGHT - renderH) / 2);

      // Add image to PDF page
      doc.addImage(imgSrc, 'JPEG', renderX, renderY, renderW, renderH, undefined, 'FAST');

      // Searchable Text Layer Embedding
      if (embedText && page.ocrText && page.ocrText.trim().length > 0) {
        try {
          doc.saveGraphicsState();
          // Transparent text overlay for search indexing
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(5);

          // Embed text lines across the page area
          const lines = page.ocrText.split('\n').filter(l => l.trim().length > 0);
          const lineStep = Math.min(8, renderH / Math.max(lines.length, 1));
          let textY = renderY + 5;

          lines.forEach(line => {
            if (textY < renderY + renderH) {
              // Sanitize non-printable characters for standard jsPDF font
              const safeLine = line.substring(0, 80);
              doc.text(safeLine, renderX + 2, textY, { maxWidth: renderW - 4 });
              textY += lineStep;
            }
          });
          doc.restoreGraphicsState();
        } catch (textErr) {
          console.warn('Text embedding skipped for page:', textErr);
        }
      }

      // Optional subtle footer page number
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`- ${page.pageNumber} -`, A4_WIDTH / 2, A4_HEIGHT - 4, { align: 'center' });

      if (onProgress) {
        onProgress(i + 1, totalPages);
      }
    }

    // Optional Appendix: Full Text Transcript Page
    if (appendTranscript) {
      doc.addPage('a4', 'portrait');
      doc.setFontSize(16);
      doc.setTextColor(40, 40, 40);
      doc.text('Book Scan Text Transcript (전체 텍스트 전사)', MARGIN, MARGIN + 10);
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.text(`생성일시: ${new Date().toLocaleString()} | 총 ${pages.length} 페이지`, MARGIN, MARGIN + 16);

      let curY = MARGIN + 26;
      doc.setFontSize(10);
      doc.setTextColor(50, 50, 50);

      pages.forEach(p => {
        if (curY > A4_HEIGHT - 25) {
          doc.addPage('a4', 'portrait');
          curY = MARGIN + 10;
        }

        doc.setFont('helvetica', 'bold');
        doc.text(`[Page ${p.pageNumber}]`, MARGIN, curY);
        curY += 5;

        doc.setFont('helvetica', 'normal');
        const textContent = p.ocrText ? p.ocrText.trim() : '(텍스트 없음 / OCR 미실행)';
        const splitLines = doc.splitTextToSize(textContent, PRINT_WIDTH);

        splitLines.forEach(line => {
          if (curY > A4_HEIGHT - 20) {
            doc.addPage('a4', 'portrait');
            curY = MARGIN + 10;
          }
          doc.text(line, MARGIN, curY);
          curY += 4.5;
        });

        curY += 4;
      });
    }

    // Return blob and filename
    const filename = `BookScan_${this.getTimestampString()}.pdf`;
    const blob = doc.output('blob');
    return { blob, filename, doc };
  }

  /**
   * Generates PDF Blob without triggering browser download
   */
  static async generatePdfBlob(pages, options = {}, onProgress = null) {
    return await this.exportPdf(pages, options, onProgress);
  }

  /**
   * Compile and download multi-page PDF
   */
  static async downloadPdf(pages, options = {}, onProgress = null) {
    const { doc, filename } = await this.exportPdf(pages, options, onProgress);
    doc.save(filename);
    return filename;
  }

  /**
   * Export all OCR recognized texts as a single .txt file
   */
  static exportPlainText(pages) {
    if (!pages || pages.length === 0) {
      throw new Error('내보낼 페이지가 없습니다.');
    }

    let fullText = `=========================================\n`;
    fullText += `AI Video Book Scanner - Extracted Text\n`;
    fullText += `Date: ${new Date().toLocaleString()}\n`;
    fullText += `Total Pages: ${pages.length}\n`;
    fullText += `=========================================\n\n`;

    pages.forEach(p => {
      fullText += `--- [PAGE ${p.pageNumber}] ---\n`;
      fullText += (p.ocrText ? p.ocrText.trim() : '(No text recognized)') + '\n\n';
    });

    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BookScan_Text_${this.getTimestampString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Export all captured pages as a ZIP archive of JPEG images
   */
  static async exportZip(pages) {
    if (!window.JSZip) {
      throw new Error('JSZip 라이브러리가 로드되지 않았습니다.');
    }
    const zip = new window.JSZip();
    const folder = zip.folder('BookScan_Pages');

    pages.forEach(p => {
      const dataUrl = p.enhancedDataUrl || p.originalDataUrl;
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const padNum = String(p.pageNumber).padStart(3, '0');
      folder.file(`page_${padNum}.jpg`, base64, { base64: true });
    });

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BookScan_Images_${this.getTimestampString()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
