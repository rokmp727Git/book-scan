/**
 * Camera & Video Stream Manager
 * Handles webcam devices, mobile environment/user toggling, video file ingestion,
 * full-res frame capturing, and virtual book simulation.
 */

export class CameraController {
  constructor(videoElement, canvasVirtualBook) {
    this.video = videoElement;
    this.virtualCanvas = canvasVirtualBook;
    this.virtualCtx = this.virtualCanvas ? this.virtualCanvas.getContext('2d') : null;

    this.mediaStream = null;
    this.currentFacingMode = 'environment'; // 'environment' (back) or 'user' (front)
    this.currentSource = 'camera'; // 'camera', 'video', 'virtual'
    this.availableDevices = [];
    this.soundEnabled = true;

    this.virtualBookInterval = null;
    this.virtualBookPage = 1;
    this.virtualBookTotal = 10;
    this.virtualFlipping = false;
    this.virtualFlipProgress = 0;

    // Web Audio synthesizer for shutter beep/chime
    this.audioCtx = null;

    this._initAudio();
  }

  _initAudio() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    } catch (e) {
      console.warn('Web Audio not supported:', e);
    }
  }

  playShutterSound() {
    if (!this.soundEnabled || !this.audioCtx) return;
    try {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      // Dual chirp frequency for pleasant shutter chime
      const now = this.audioCtx.currentTime;
      osc.frequency.setValueAtTime(880, now); // A5
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.08); // A6

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.16);
    } catch (e) {
      console.warn('Audio play failed:', e);
    }
  }

  /**
   * Start live webcam stream
   */
  async startCamera(facingMode = this.currentFacingMode) {
    this.stopAll();
    this.currentSource = 'camera';
    this.currentFacingMode = facingMode;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('이 브라우저에서는 카메라를 사용할 수 없습니다. HTTPS 주소의 Safari에서 열어주세요.');
    }

    // iOS Safari: playsinline + muted are required for inline autoplay
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('webkit-playsinline', '');
    this.video.muted = true;
    this.video.playsInline = true;

    // NOTE: no `min` constraints — iOS throws OverconstrainedError with them
    const attempts = [
      { audio: false, video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
      { audio: false, video: { facingMode: facingMode } },
      { audio: false, video: true },
    ];

    let lastErr = null;
    for (const constraints of attempts) {
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        this.video.srcObject = this.mediaStream;
        try {
          await this.video.play();
        } catch (playErr) {
          console.warn('video.play() blocked, will retry on user tap:', playErr);
          const resume = () => { this.video.play().catch(() => {}); };
          document.addEventListener('touchend', resume, { once: true });
          document.addEventListener('click', resume, { once: true });
        }
        this._updateDevices();
        return true;
      } catch (err) {
        lastErr = err;
        console.warn('getUserMedia failed with constraints', constraints, err);
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) break;
      }
    }
    throw lastErr || new Error('카메라를 시작할 수 없습니다.');
  }

  /**
   * Toggle between front and back camera
   */
  async toggleCameraFacing() {
    const nextFacing = this.currentFacingMode === 'environment' ? 'user' : 'environment';
    return await this.startCamera(nextFacing);
  }

  /**
   * Toggle flashlight/torch on mobile devices if supported
   */
  async toggleTorch() {
    if (!this.mediaStream) return false;
    const track = this.mediaStream.getVideoTracks()[0];
    if (!track) return false;
    try {
      const capabilities = track.getCapabilities ? track.getCapabilities() : {};
      if (!capabilities.torch) return false;
      this.torchEnabled = !this.torchEnabled;
      await track.applyConstraints({
        advanced: [{ torch: this.torchEnabled }]
      });
      return this.torchEnabled;
    } catch (e) {
      console.warn('Torch toggle failed:', e);
      return false;
    }
  }

  isTorchSupported() {
    if (!this.mediaStream) return false;
    const track = this.mediaStream.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return false;
    const capabilities = track.getCapabilities();
    return Boolean(capabilities && capabilities.torch);
  }

  async _updateDevices() {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        this.availableDevices = devices.filter(d => d.kind === 'videoinput');
      }
    } catch (e) {
      console.warn('Enumerate devices failed:', e);
    }
  }

  /**
   * Load video file (MP4, WEBM, MOV)
   */
  async loadVideoFile(file) {
    this.stopAll();
    this.currentSource = 'video';

    return new Promise((resolve, reject) => {
      const video = this.video;
      let settled = false;
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onReady);
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('error', onError);
      };
      const onReady = () => {
        if (settled) return;
        settled = true;
        cleanup();
        video.play().catch(err => {
          console.warn('Autoplay prevented, awaiting user tap:', err);
        });
        resolve(true);
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('동영상 파일을 재생할 수 없습니다. 지원되는 포맷인지 확인하세요.'));
      };

      // Clear any stale handlers from previous loads
      video.onloadedmetadata = null;
      video.onerror = null;

      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.muted = true;
      video.playsInline = true;

      video.addEventListener('loadedmetadata', onReady);
      video.addEventListener('loadeddata', onReady);
      video.addEventListener('error', onError);

      if (this._objectUrl) URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = URL.createObjectURL(file);
      video.srcObject = null;
      video.src = this._objectUrl;
      video.load();

      // iOS sometimes doesn't fire metadata events until play() is called
      video.play().catch(() => {});
    });
  }

  /**
   * Start Virtual Book Flip Simulator (built-in interactive demo)
   */
  startVirtualBookSimulator(onPageChange) {
    this.stopAll();
    this.currentSource = 'virtual';

    if (this.virtualCanvas) {
      this.virtualCanvas.width = 1280;
      this.virtualCanvas.height = 960;
      this.virtualCanvas.classList.remove('hidden');
      this.video.classList.add('hidden');
    }

    this.virtualBookPage = 1;
    this.virtualFlipProgress = 0;
    this.virtualFlipping = false;

    const sampleChapters = [
      {
        title: "제1장: 인공지능과 비전 컴퓨팅",
        enTitle: "Chapter 1: AI & Vision Computing",
        content: "컴퓨터 비전(Computer Vision)은 기계가 시각적 세계를 인식하고 해석할 수 있도록 하는 인공지능의 핵심 분과입니다.\n\n디지털 이미지나 비디오에서 의미 있는 정보를 자동으로 추출하는 알고리즘은 실시간 프레임 차분(Frame Difference)과 광학 문자 인식(OCR)을 결합하여 현대 지식 디지털화의 혁신을 주도하고 있습니다.",
        quote: "“The goal of computer vision is to understand and interpret visual data.”"
      },
      {
        title: "제2장: 실시간 프레임 차분 알고리즘",
        enTitle: "Chapter 2: Frame Luminance Difference",
        content: "연속된 비디오 스트림에서 페이지 넘김 모션을 감지하는 것은 프레임 간의 픽셀 휘도(Luminance) 변화량을 측정함으로써 실시간으로 달성됩니다.\n\n경량 캔버스(160x120)를 활용하여 초당 10회 이상 샘플링하며, 모션 임계치를 초과할 때 넘김 상태로 진입하고, 변화가 급격히 줄어들어 안정화될 때 최적의 키프레임을 캡처합니다.",
        quote: "“Luminance Y = 0.299R + 0.587G + 0.114B represents true human perception.”"
      },
      {
        title: "제3장: 광학 문자 인식(OCR)과 언어 모델",
        enTitle: "Chapter 3: OCR & Multi-lingual Models",
        content: "Tesseract.js 엔진은 브라우저 샌드박스 내부의 WebAssembly 워커를 통해 한글 및 영문 텍스트를 오프라인에서도 완전하게 추출합니다.\n\n추출된 텍스트는 좌표 및 신뢰도 점수와 함께 구조화되어 다중 페이지 PDF 생성 파이프라인의 검색 가능 레이어로 삽입됩니다.",
        quote: "“Searchable PDFs preserve both the original visual clarity and text accessibility.”"
      },
      {
        title: "제4장: 문서 화질 개선 및 이진화 필터",
        enTitle: "Chapter 4: Image Enhancement & Clean Filters",
        content: "조명 불균일 및 종이 굴곡으로 인한 그림자를 제거하기 위해 히스토그램 평활화와 고대비 적응형 이진화 처리가 적용됩니다.\n\n이를 통해 스마트폰 카메라로 촬영된 북 스캔 이미지도 전문 복합기 스캐너 수준의 선명한 흑백 문서 품질을 획득할 수 있습니다.",
        quote: "“High contrast thresholding separates ink from paper background seamlessly.”"
      },
      {
        title: "제5장: 스마트 디지털 아카이빙의 미래",
        enTitle: "Chapter 5: Future of Digital Archiving",
        content: "책을 손으로 자연스럽게 넘기는 것만으로 책 한 권 전체가 수 분 내에 고해상도 PDF 전자책으로 변환됩니다.\n\n인공지능과 브라우저 네이티브 하드웨어 가속의 만남은 문서 보존과 접근성의 새로운 표준을 열어가고 있습니다.",
        quote: "“Empowering knowledge preservation with instant, automated AI digitization.”"
      }
    ];

    let ticks = 0;
    const renderVirtualBook = () => {
      if (this.currentSource !== 'virtual') return;

      const ctx = this.virtualCtx;
      const w = this.virtualCanvas.width;
      const h = this.virtualCanvas.height;

      // Dark desk background
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);

      // Book dimensions
      const bookW = w * 0.82;
      const bookH = h * 0.86;
      const bookX = (w - bookW) / 2;
      const bookY = (h - bookH) / 2;

      // Book outer shadow
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 35;
      ctx.shadowOffsetY = 15;
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(bookX - 10, bookY - 10, bookW + 20, bookH + 20);
      ctx.restore();

      // Book open pages (cream white paper)
      const pageW = bookW / 2;
      
      // Left Page (Fixed previous or cover)
      ctx.fillStyle = '#faf8f5';
      ctx.fillRect(bookX, bookY, pageW, bookH);

      // Right Page (Current reading page)
      ctx.fillStyle = '#fbf9f6';
      ctx.fillRect(bookX + pageW, bookY, pageW, bookH);

      // Book Spine Shadow
      const spineGrad = ctx.createLinearGradient(bookX + pageW - 25, 0, bookX + pageW + 25, 0);
      spineGrad.addColorStop(0, 'rgba(0,0,0,0.01)');
      spineGrad.addColorStop(0.5, 'rgba(0,0,0,0.25)');
      spineGrad.addColorStop(1, 'rgba(0,0,0,0.01)');
      ctx.fillStyle = spineGrad;
      ctx.fillRect(bookX + pageW - 25, bookY, 50, bookH);

      // Current Chapter Info
      const curData = sampleChapters[(this.virtualBookPage - 1) % sampleChapters.length];

      // Draw content on Left Page (Left Header / TOC or Previous page)
      ctx.fillStyle = '#475569';
      ctx.font = '16px "Inter", sans-serif';
      ctx.fillText(`AI Book Scanner | Page ${(this.virtualBookPage * 2) - 1}`, bookX + 40, bookY + 50);

      ctx.fillStyle = '#334155';
      ctx.font = 'bold 22px "Outfit", sans-serif';
      ctx.fillText(curData.title, bookX + 40, bookY + 110);

      ctx.font = 'italic 16px "Inter", sans-serif';
      ctx.fillStyle = '#64748b';
      ctx.fillText(curData.enTitle, bookX + 40, bookY + 140);

      // Left paragraph
      ctx.fillStyle = '#1e293b';
      ctx.font = '17px "Inter", sans-serif';
      const lines = curData.content.split('\n');
      let ly = bookY + 190;
      lines.forEach(l => {
        if (!l) { ly += 16; return; }
        // Simple word wrap
        ctx.fillText(l.substring(0, 32), bookX + 40, ly);
        if (l.length > 32) {
          ctx.fillText(l.substring(32), bookX + 40, ly + 28);
          ly += 28;
        }
        ly += 32;
      });

      // Right Page Content
      ctx.fillStyle = '#475569';
      ctx.font = '16px "Inter", sans-serif';
      ctx.fillText(`Page ${this.virtualBookPage * 2}`, bookX + pageW + 40, bookY + 50);

      ctx.fillStyle = '#4f46e5';
      ctx.font = 'italic 19px "Inter", sans-serif';
      ctx.fillText(curData.quote, bookX + pageW + 40, bookY + 140);

      // Draw diagram box on right page
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.strokeRect(bookX + pageW + 40, bookY + 200, pageW - 80, 240);

      ctx.fillStyle = '#6366f1';
      ctx.fillRect(bookX + pageW + 60, bookY + 230, 80, 60);
      ctx.fillStyle = '#10b981';
      ctx.fillRect(bookX + pageW + 160, bookY + 230, 80, 60);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(bookX + pageW + 260, bookY + 230, 80, 60);

      ctx.fillStyle = '#334155';
      ctx.font = '14px "Inter", sans-serif';
      ctx.fillText('[CV Motion Detector] -> [Stability Hold] -> [Keyframe OCR]', bookX + pageW + 50, bookY + 340);
      ctx.fillText(`Auto-Scanning Simulation Page: ${this.virtualBookPage} / 5`, bookX + pageW + 50, bookY + 380);

      // Page flip animation effect when turning
      if (this.virtualFlipping) {
        ctx.save();
        const flipW = pageW * (1 - this.virtualFlipProgress);
        ctx.fillStyle = 'rgba(230, 225, 215, 0.95)';
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 20;
        ctx.fillRect(bookX + pageW, bookY, flipW, bookH);

        // Hand / finger simulation silhouette flipping page
        ctx.fillStyle = 'rgba(180, 140, 100, 0.7)';
        ctx.beginPath();
        const handX = bookX + pageW + flipW - 20;
        const handY = bookY + bookH - 120 + Math.sin(this.virtualFlipProgress * Math.PI) * 50;
        ctx.arc(handX, handY, 45, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ticks++;
      // Auto-trigger page flips every ~4.5 seconds to simulate user turning pages
      if (ticks % 180 === 0 && !this.virtualFlipping) {
        this.virtualFlipping = true;
        this.virtualFlipProgress = 0;
      }

      if (this.virtualFlipping) {
        this.virtualFlipProgress += 0.04;
        if (this.virtualFlipProgress >= 1) {
          this.virtualFlipping = false;
          this.virtualBookPage++;
          if (onPageChange) onPageChange(this.virtualBookPage);
        }
      }

      this.virtualBookInterval = requestAnimationFrame(renderVirtualBook);
    };

    this.virtualBookInterval = requestAnimationFrame(renderVirtualBook);
  }

  /**
   * Stop all streams, video playing and simulations
   */
  stopAll() {
    if (this.virtualBookInterval) {
      cancelAnimationFrame(this.virtualBookInterval);
      this.virtualBookInterval = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        track.stop();
      });
      this.mediaStream = null;
    }

    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video.removeAttribute('src');
      this.video.load();
      this.video.classList.remove('hidden');
    }

    if (this.virtualCanvas) {
      this.virtualCanvas.classList.add('hidden');
    }
  }

  /**
   * Capture a full-resolution snapshot from current video frame or canvas
   * @param {Object} options - { cropToGuide: boolean, guideBoxRect: { x, y, width, height } }
   * @returns {string} base64 DataURL (image/jpeg)
   */
  captureFrame(options = {}) {
    const isVirtual = this.currentSource === 'virtual';
    const sourceEl = isVirtual ? this.virtualCanvas : this.video;

    if (!sourceEl) return null;

    const srcWidth = isVirtual ? sourceEl.width : sourceEl.videoWidth;
    const srcHeight = isVirtual ? sourceEl.height : sourceEl.videoHeight;

    if (!srcWidth || !srcHeight) {
      console.warn('Source width/height invalid for capture');
      return null;
    }

    // High resolution canvas
    const offCanvas = document.createElement('canvas');
    const ctx = offCanvas.getContext('2d', { willReadFrequently: true });

    if (options.cropToGuide && options.guideBoxPercent) {
      // Crop based on guideline box percentages
      const { leftPct, topPct, widthPct, heightPct } = options.guideBoxPercent;
      const cropX = Math.floor(srcWidth * leftPct);
      const cropY = Math.floor(srcHeight * topPct);
      const cropW = Math.floor(srcWidth * widthPct);
      const cropH = Math.floor(srcHeight * heightPct);

      offCanvas.width = cropW;
      offCanvas.height = cropH;

      ctx.drawImage(sourceEl, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    } else {
      offCanvas.width = srcWidth;
      offCanvas.height = srcHeight;
      ctx.drawImage(sourceEl, 0, 0, srcWidth, srcHeight);
    }

    this.playShutterSound();
    return offCanvas.toDataURL('image/jpeg', 0.95);
  }

  getActiveSourceElement() {
    return this.currentSource === 'virtual' ? this.virtualCanvas : this.video;
  }
}
