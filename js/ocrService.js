/**
 * OCR Engine Service
 * Dual-engine integration supporting client-side Tesseract.js v5 (kor + eng)
 * and pluggable Google Gemini Vision API for high-precision text extraction.
 */

export class OcrService {
  constructor() {
    this.worker = null;
    this.currentLanguage = 'kor+eng';
    this.isWorkerReady = false;
    this.activeJob = null;
  }

  /**
   * Initialize or retrieve Tesseract.js worker
   */
  async getTesseractWorker(languages = 'kor+eng') {
    if (!window.Tesseract) {
      throw new Error('Tesseract.js 라이브러리가 로드되지 않았습니다.');
    }

    if (this.worker && this.currentLanguage === languages && this.isWorkerReady) {
      return this.worker;
    }

    // Terminate existing worker if switching languages
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch (e) {
        console.warn('Worker terminate error:', e);
      }
      this.worker = null;
      this.isWorkerReady = false;
    }

    this.currentLanguage = languages;

    // Create fresh Tesseract worker (v5 API)
    this.worker = await window.Tesseract.createWorker(languages, 1, {
      logger: (m) => {
        // Optional logger callback
      }
    });

    this.isWorkerReady = true;
    return this.worker;
  }

  /**
   * Run OCR using client-side Tesseract.js
   */
  async runTesseract(imageDataUrl, languages = 'kor+eng', onProgress = null) {
    const worker = await this.getTesseractWorker(languages);
    const result = await worker.recognize(imageDataUrl);

    const text = result?.data?.text?.trim() || '';
    const confidence = result?.data?.confidence || 0;

    return {
      text,
      confidence: Math.round(confidence)
    };
  }

  /**
   * Run OCR using Google Gemini Vision API
   */
  async runGemini(imageDataUrl, apiKey, model = 'gemini-2.5-flash') {
    if (!apiKey) {
      throw new Error('Gemini API 키가 입력되지 않았습니다. [설정]에서 API 키를 입력하세요.');
    }

    // Clean base64 data URL
    const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: "Extract and transcribe all printed or handwritten text visible in this scanned book page accurately in Korean and English. Preserve natural reading paragraph flow and original formatting. Output ONLY the extracted text, do not add introductory remarks or explanations."
            },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
      }
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      let msg = `Gemini API 호출 오류 (${response.status})`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error && parsed.error.message) {
          msg += `: ${parsed.error.message}`;
        }
      } catch (e) {}
      throw new Error(msg);
    }

    const data = await response.json();
    const candidate = data.candidates && data.candidates[0];
    const textPart = candidate?.content?.parts?.[0]?.text || '';

    return {
      text: textPart.trim(),
      confidence: 95
    };
  }

  /**
   * Recognize a single page based on user settings
   */
  async recognizePage(page, config = {}, onProgress = null) {
    const engine = config.engine || 'tesseract';
    const imageSrc = page.enhancedDataUrl || page.originalDataUrl;

    if (engine === 'gemini') {
      return await this.runGemini(imageSrc, config.geminiKey, config.geminiModel);
    } else {
      return await this.runTesseract(imageSrc, config.tesseractLang || 'kor+eng', onProgress);
    }
  }

  /**
   * Batch process multiple pages sequentially
   * @param {Array} pages
   * @param {Object} config
   * @param {Function} onProgressStep - (current, total, page, result) => void
   */
  async batchProcess(pages, config = {}, onProgressStep = null) {
    const results = [];
    const total = pages.length;

    for (let i = 0; i < total; i++) {
      const page = pages[i];
      try {
        const res = await this.recognizePage(page, config);
        results.push({ pageId: page.id, success: true, ...res });
        if (onProgressStep) {
          onProgressStep(i + 1, total, page, res);
        }
      } catch (err) {
        console.error(`OCR failed for page ${page.pageNumber}:`, err);
        results.push({ pageId: page.id, success: false, error: err.message });
        if (onProgressStep) {
          onProgressStep(i + 1, total, page, { error: err.message, text: '', confidence: 0 });
        }
      }
    }

    return results;
  }

  /**
   * Cleanup resources
   */
  async terminate() {
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch (e) {}
      this.worker = null;
      this.isWorkerReady = false;
    }
  }
}
