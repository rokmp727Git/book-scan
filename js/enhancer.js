/**
 * Image Enhancement & Filter Pipeline
 * Applies document binarization, contrast stretching, grayscale,
 * color sharpening, and rotation to captured book pages.
 */

export class ImageEnhancer {
  /**
   * Loads image element from dataURL
   */
  static loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error('이미지 로딩 실패: ' + e));
      img.src = src;
    });
  }

  /**
   * Process an image with specified filter and rotation
   * @param {string} dataUrl - source image base64
   * @param {string} filter - 'original' | 'doc_clean' | 'contrast_boost' | 'grayscale' | 'enhanced_color'
   * @param {number} rotation - 0 | 90 | 180 | 270
   * @returns {Promise<string>} processed image base64 DataURL
   */
  static async processImage(dataUrl, filter = 'doc_clean', rotation = 0) {
    const img = await this.loadImage(dataUrl);

    // Calculate canvas size based on rotation
    const isRotatedQuarter = (rotation % 180 !== 0);
    const width = isRotatedQuarter ? img.naturalHeight : img.naturalWidth;
    const height = isRotatedQuarter ? img.naturalWidth : img.naturalHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Handle rotation transform
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();

    if (filter === 'original') {
      return canvas.toDataURL('image/jpeg', 0.92);
    }

    const imgData = ctx.getImageData(0, 0, width, height);
    const pixels = imgData.data;
    const len = pixels.length;

    switch (filter) {
      case 'doc_clean':
        this._filterDocClean(pixels);
        break;

      case 'contrast_boost':
        this._filterContrastBoost(pixels);
        break;

      case 'grayscale':
        this._filterGrayscale(pixels);
        break;

      case 'enhanced_color':
        this._filterEnhancedColor(pixels);
        break;

      default:
        break;
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  /**
   * Document Clean: High-contrast binarization and background whitening
   * Removes paper texture, shadows and yellow casts, making ink crisp black.
   */
  static _filterDocClean(pixels) {
    const len = pixels.length;
    // Calculate average brightness
    let sumLum = 0;
    for (let i = 0; i < len; i += 4) {
      sumLum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    }
    const avgLum = sumLum / (len / 4);
    // Adaptive threshold around the average luminance
    const threshold = Math.max(128, Math.min(185, avgLum * 0.9));

    for (let i = 0; i < len; i += 4) {
      const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      
      // Smooth sigmoid curve for clean paper whitening
      if (lum > threshold) {
        // Paper background to pure/near white
        pixels[i] = 255;
        pixels[i + 1] = 255;
        pixels[i + 2] = 255;
      } else {
        // Ink text to solid dark black
        const darkVal = Math.max(0, (lum / threshold) * 70);
        pixels[i] = darkVal;
        pixels[i + 1] = darkVal;
        pixels[i + 2] = darkVal;
      }
    }
  }

  /**
   * Contrast Boost: Histogram stretching to enhance readability while preserving tone
   */
  static _filterContrastBoost(pixels) {
    const len = pixels.length;
    const factor = (259 * (60 + 255)) / (255 * (259 - 60)); // contrast factor +60

    for (let i = 0; i < len; i += 4) {
      // Contrast stretch each channel
      pixels[i] = Math.min(255, Math.max(0, factor * (pixels[i] - 128) + 128));
      pixels[i + 1] = Math.min(255, Math.max(0, factor * (pixels[i + 1] - 128) + 128));
      pixels[i + 2] = Math.min(255, Math.max(0, factor * (pixels[i + 2] - 128) + 128));
    }
  }

  /**
   * Pure crisp Grayscale
   */
  static _filterGrayscale(pixels) {
    const len = pixels.length;
    for (let i = 0; i < len; i += 4) {
      const gray = (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]) | 0;
      pixels[i] = gray;
      pixels[i + 1] = gray;
      pixels[i + 2] = gray;
    }
  }

  /**
   * Enhanced Color: Boost saturation + mild sharpen
   */
  static _filterEnhancedColor(pixels) {
    const len = pixels.length;
    for (let i = 0; i < len; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;

      // Increase saturation by 35%
      const satFactor = 1.35;
      pixels[i] = Math.min(255, Math.max(0, gray + (r - gray) * satFactor));
      pixels[i + 1] = Math.min(255, Math.max(0, gray + (g - gray) * satFactor));
      pixels[i + 2] = Math.min(255, Math.max(0, gray + (b - gray) * satFactor));
    }
  }
}
