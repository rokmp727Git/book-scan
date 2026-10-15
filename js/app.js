import { CameraController } from './camera.js';
import { MotionDetector, DetectorState } from './motionDetector.js';
import { ImageEnhancer } from './enhancer.js';
import { PageStore } from './pageStore.js';
import { OcrService } from './ocrService.js';
import { PdfExporter } from './pdfExporter.js';
import { EpubExporter } from './epubExporter.js';
import { GoogleDriveService } from './googleDriveService.js';

class App {
  constructor() {
    this._initDom();
    this.dom.globalStateBadge.classList.add('state-standby');
    this.dom.globalStateText.textContent = '대기 중 (Standby)';

    // Module instances (must exist BEFORE _loadSettings, which uses googleDrive)
    this.camera = new CameraController(this.dom.videoElement, this.dom.virtualBookCanvas);
    this.pageStore = new PageStore();
    this.ocrService = new OcrService();
    this.googleDrive = new GoogleDriveService();

    this._loadSettings();

    if (this.settings.gdriveClientId) {
      this.googleDrive.setClientId(this.settings.gdriveClientId);
    }

    this.motionDetector = new MotionDetector({
      motionThreshold: Number(this.dom.rngMotionThreshold.value),
      stabilityDuration: Number(this.dom.rngStabilityDuration.value),
      cooldownWindow: Number(this.dom.rngCooldownWindow.value),
      roiOnly: this.dom.chkRoiOnly.checked,
      onStateChange: (state) => this._handleDetectorStateChange(state),
      onMetricsUpdate: (metrics) => this._handleMetricsUpdate(metrics),
      onKeyframeTrigger: () => this._handleKeyframeTrigger()
    });

    this.activeModalPageId = null;
    this.draggedCardIndex = null;
    this.isBatchProcessing = false;

    // Mobile default view state
    document.body.classList.add('mobile-view-scanner');

    this._bindEvents();
    this._setupStoreSubscription();
    this._refreshIcons();
    this._autoStartCamera();
  }

  _initDom() {
    this.dom = {
      // Header
      globalStateBadge: document.getElementById('globalStateBadge'),
      globalStateText: document.getElementById('globalStateText'),
      btnSettings: document.getElementById('btnSettings'),
      btnVirtualBook: document.getElementById('btnVirtualBook'),
      btnExportPdfTop: document.getElementById('btnExportPdfTop'),

      // Mobile Navigation
      tabMobileScanner: document.getElementById('tabMobileScanner'),
      tabMobileGallery: document.getElementById('tabMobileGallery'),
      mobileViewTabs: document.getElementById('mobileViewTabs'),

      // Viewfinder & Sources
      tabSourceCamera: document.getElementById('tabSourceCamera'),
      tabSourceVideo: document.getElementById('tabSourceVideo'),
      btnFlipCamera: document.getElementById('btnFlipCamera'),
      btnToggleTorch: document.getElementById('btnToggleTorch'),
      btnToggleGuide: document.getElementById('btnToggleGuide'),
      btnToggleSound: document.getElementById('btnToggleSound'),
      viewportContainer: document.getElementById('viewportContainer'),
      videoElement: document.getElementById('videoElement'),
      virtualBookCanvas: document.getElementById('virtualBookCanvas'),
      btnMobileShutter: document.getElementById('btnMobileShutter'),
      guidelineOverlay: document.getElementById('guidelineOverlay'),
      guideBox: document.getElementById('guideBox'),
      scanLightBar: document.getElementById('scanLightBar'),
      captureFlash: document.getElementById('captureFlash'),
      videoDropzone: document.getElementById('videoDropzone'),
      videoFileInput: document.getElementById('videoFileInput'),
      mobileCameraCaptureInput: document.getElementById('mobileCameraCaptureInput'),
      mobileCameraDirectInput: document.getElementById('mobileCameraDirectInput'),
      streamPlaceholder: document.getElementById('streamPlaceholder'),
      btnStartCamera: document.getElementById('btnStartCamera'),
      btnPlaceholderDemo: document.getElementById('btnPlaceholderDemo'),

      // Video Playback HUD
      videoPlaybackHud: document.getElementById('videoPlaybackHud'),
      btnVideoPlayPause: document.getElementById('btnVideoPlayPause'),
      iconPlayPause: document.getElementById('iconPlayPause'),
      lblVideoTime: document.getElementById('lblVideoTime'),
      videoSeeker: document.getElementById('videoSeeker'),
      videoSpeedSelect: document.getElementById('videoSpeedSelect'),

      // Diagnostics & CV controls
      valMotionPercent: document.getElementById('valMotionPercent'),
      barMotionFill: document.getElementById('barMotionFill'),
      lineMotionThreshold: document.getElementById('lineMotionThreshold'),
      valStabilityPercent: document.getElementById('valStabilityPercent'),
      barStabilityFill: document.getElementById('barStabilityFill'),
      chkAutoDetect: document.getElementById('chkAutoDetect'),
      lblAutoStatus: document.getElementById('lblAutoStatus'),
      btnManualSnap: document.getElementById('btnManualSnap'),

      // Sensitivity Sliders
      rngMotionThreshold: document.getElementById('rngMotionThreshold'),
      lblThresholdVal: document.getElementById('lblThresholdVal'),
      rngStabilityDuration: document.getElementById('rngStabilityDuration'),
      lblStabilityVal: document.getElementById('lblStabilityVal'),
      rngCooldownWindow: document.getElementById('rngCooldownWindow'),
      lblCooldownVal: document.getElementById('lblCooldownVal'),
      chkRoiOnly: document.getElementById('chkRoiOnly'),
      chkCropToGuide: document.getElementById('chkCropToGuide'),

      // Gallery & Pipeline
      lblPageTotal: document.getElementById('lblPageTotal'),
      selectGlobalFilter: document.getElementById('selectGlobalFilter'),
      btnBatchOcr: document.getElementById('btnBatchOcr'),
      btnClearAll: document.getElementById('btnClearAll'),
      batchProgressCard: document.getElementById('batchProgressCard'),
      lblProgressTitle: document.getElementById('lblProgressTitle'),
      lblProgressStats: document.getElementById('lblProgressStats'),
      batchProgressBarFill: document.getElementById('batchProgressBarFill'),
      pagesGridContainer: document.getElementById('pagesGridContainer'),
      emptyGalleryState: document.getElementById('emptyGalleryState'),
      pagesCardsGrid: document.getElementById('pagesCardsGrid'),

      // Bottom Dock
      lblDockCount: document.getElementById('lblDockCount'),
      lblDockOcrStats: document.getElementById('lblDockOcrStats'),
      btnExportTxt: document.getElementById('btnExportTxt'),
      btnExportPdf: document.getElementById('btnExportPdf'),
      btnExportEpub: document.getElementById('btnExportEpub'),
      btnExportGDrive: document.getElementById('btnExportGDrive'),

      // Page Detail Modal
      pageModal: document.getElementById('pageModal'),
      modalPageTitle: document.getElementById('modalPageTitle'),
      modalOcrBadge: document.getElementById('modalOcrBadge'),
      btnModalClose: document.getElementById('btnModalClose'),
      modalPageImg: document.getElementById('modalPageImg'),
      btnModalRotate: document.getElementById('btnModalRotate'),
      selectModalFilter: document.getElementById('selectModalFilter'),
      btnModalReOcr: document.getElementById('btnModalReOcr'),
      btnModalCopyText: document.getElementById('btnModalCopyText'),
      txtModalOcrText: document.getElementById('txtModalOcrText'),
      btnModalDeletePage: document.getElementById('btnModalDeletePage'),
      btnModalSave: document.getElementById('btnModalSave'),

      // Settings Modal
      settingsModal: document.getElementById('settingsModal'),
      btnSettingsClose: document.getElementById('btnSettingsClose'),
      cfgGDriveGasUrl: document.getElementById('cfgGDriveGasUrl'),
      cfgGDriveClientId: document.getElementById('cfgGDriveClientId'),
      btnGDriveConnect: document.getElementById('btnGDriveConnect'),
      badgeGDriveStatus: document.getElementById('badgeGDriveStatus'),
      cfgEpubTitle: document.getElementById('cfgEpubTitle'),
      cfgEpubAuthor: document.getElementById('cfgEpubAuthor'),
      cfgEpubLang: document.getElementById('cfgEpubLang'),
      cfgOcrEngine: document.getElementById('cfgOcrEngine'),
      cfgTesseractGroup: document.getElementById('cfgTesseractGroup'),
      cfgTesseractLang: document.getElementById('cfgTesseractLang'),
      cfgGeminiGroup: document.getElementById('cfgGeminiGroup'),
      cfgGeminiKey: document.getElementById('cfgGeminiKey'),
      cfgGeminiModel: document.getElementById('cfgGeminiModel'),
      cfgPdfFormat: document.getElementById('cfgPdfFormat'),
      cfgEmbedSearchableText: document.getElementById('cfgEmbedSearchableText'),
      cfgAppendTranscriptPage: document.getElementById('cfgAppendTranscriptPage'),
      cfgPdfQuality: document.getElementById('cfgPdfQuality'),
      btnSettingsSave: document.getElementById('btnSettingsSave'),

      // Toast Container
      toastContainer: document.getElementById('toastContainer'),
    };
  }

  _refreshIcons() {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  _showToast(message, type = 'success', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconName = 'check-circle';
    if (type === 'warning') iconName = 'alert-triangle';
    if (type === 'error') iconName = 'alert-octagon';

    toast.innerHTML = `
      <i data-lucide="${iconName}"></i>
      <span>${message}</span>
    `;

    this.dom.toastContainer.appendChild(toast);
    this._refreshIcons();

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px) scale(0.95)';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  _loadSettings() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('ai_book_scanner_settings') || 'null'); } catch (e) { saved = null; }
    this.settings = saved || {
      ocrEngine: 'tesseract',
      tesseractLang: 'kor+eng',
      geminiKey: '',
      geminiModel: 'gemini-2.5-flash',
      pdfFormat: 'a4',
      embedSearchableText: true,
      appendTranscriptPage: false,
      pdfQuality: 0.92,
      gdriveClientId: '',
      epubTitle: '스캔 전자책',
      epubAuthor: 'AI Book Scanner',
      epubLang: 'ko',
    };

    // Apply to settings inputs
    this.dom.cfgOcrEngine.value = this.settings.ocrEngine;
    this.dom.cfgTesseractLang.value = this.settings.tesseractLang;
    this.dom.cfgGeminiKey.value = this.settings.geminiKey || '';
    this.dom.cfgGeminiModel.value = this.settings.geminiModel;
    this.dom.cfgPdfFormat.value = this.settings.pdfFormat;
    this.dom.cfgEmbedSearchableText.checked = this.settings.embedSearchableText;
    this.dom.cfgAppendTranscriptPage.checked = this.settings.appendTranscriptPage;
    this.dom.cfgPdfQuality.value = String(this.settings.pdfQuality);

    if (this.dom.cfgGDriveGasUrl) {
      this.dom.cfgGDriveGasUrl.value = this.settings.gdriveGasUrl || this.googleDrive.getGasUrl() || '';
    }
    if (this.dom.cfgGDriveClientId) {
      this.dom.cfgGDriveClientId.value = this.settings.gdriveClientId || '';
    }
    if (this.dom.cfgEpubTitle) {
      this.dom.cfgEpubTitle.value = this.settings.epubTitle || '스캔 전자책';
    }
    if (this.dom.cfgEpubAuthor) {
      this.dom.cfgEpubAuthor.value = this.settings.epubAuthor || 'AI Book Scanner';
    }
    if (this.dom.cfgEpubLang) {
      this.dom.cfgEpubLang.value = this.settings.epubLang || 'ko';
    }

    this._updateSettingsVisibility();
    this._updateGDriveBadge();
  }

  _updateGDriveBadge() {
    if (!this.dom.badgeGDriveStatus) return;
    const gasUrl = this.googleDrive.getGasUrl() || (this.settings && this.settings.gdriveGasUrl);
    const token = this.googleDrive.accessToken;
    const clientId = this.settings && this.settings.gdriveClientId;

    if (gasUrl) {
      this.dom.badgeGDriveStatus.textContent = '연결됨 (GAS 웹앱)';
      this.dom.badgeGDriveStatus.style.background = 'rgba(99, 102, 241, 0.2)';
      this.dom.badgeGDriveStatus.style.color = '#a5b4fc';
    } else if (token) {
      this.dom.badgeGDriveStatus.textContent = '연결됨 (OAuth)';
      this.dom.badgeGDriveStatus.style.background = 'rgba(16, 185, 129, 0.2)';
      this.dom.badgeGDriveStatus.style.color = '#34d399';
    } else if (clientId) {
      this.dom.badgeGDriveStatus.textContent = '인증 필요';
      this.dom.badgeGDriveStatus.style.background = 'rgba(245, 158, 11, 0.2)';
      this.dom.badgeGDriveStatus.style.color = '#fbbf24';
    } else {
      this.dom.badgeGDriveStatus.textContent = '미연결';
      this.dom.badgeGDriveStatus.style.background = 'rgba(148, 163, 184, 0.15)';
      this.dom.badgeGDriveStatus.style.color = 'var(--color-text-muted)';
    }
  }

  _saveSettings() {
    this.settings = {
      ocrEngine: this.dom.cfgOcrEngine.value,
      tesseractLang: this.dom.cfgTesseractLang.value,
      geminiKey: this.dom.cfgGeminiKey.value.trim(),
      geminiModel: this.dom.cfgGeminiModel.value,
      pdfFormat: this.dom.cfgPdfFormat.value,
      embedSearchableText: this.dom.cfgEmbedSearchableText.checked,
      appendTranscriptPage: this.dom.cfgAppendTranscriptPage.checked,
      pdfQuality: parseFloat(this.dom.cfgPdfQuality.value),
      gdriveGasUrl: this.dom.cfgGDriveGasUrl ? this.dom.cfgGDriveGasUrl.value.trim() : '',
      gdriveClientId: this.dom.cfgGDriveClientId ? this.dom.cfgGDriveClientId.value.trim() : '',
      epubTitle: this.dom.cfgEpubTitle ? this.dom.cfgEpubTitle.value.trim() : '스캔 전자책',
      epubAuthor: this.dom.cfgEpubAuthor ? this.dom.cfgEpubAuthor.value.trim() : 'AI Book Scanner',
      epubLang: this.dom.cfgEpubLang ? this.dom.cfgEpubLang.value : 'ko',
    };

    if (this.settings.gdriveGasUrl) {
      this.googleDrive.setGasUrl(this.settings.gdriveGasUrl);
    }
    if (this.settings.gdriveClientId) {
      this.googleDrive.setClientId(this.settings.gdriveClientId);
    }

    localStorage.setItem('ai_book_scanner_settings', JSON.stringify(this.settings));
    this._updateGDriveBadge();
    this.dom.settingsModal.classList.add('hidden');
    this._showToast('환경설정이 저장되었습니다.');
  }

  _updateSettingsVisibility() {
    const isGemini = this.dom.cfgOcrEngine.value === 'gemini';
    if (isGemini) {
      this.dom.cfgGeminiGroup.classList.remove('hidden');
      this.dom.cfgTesseractGroup.classList.add('hidden');
    } else {
      this.dom.cfgGeminiGroup.classList.add('hidden');
      this.dom.cfgTesseractGroup.classList.remove('hidden');
    }
  }

  async _autoStartCamera() {
    try {
      await this.camera.startCamera();
      this.dom.streamPlaceholder.classList.add('hidden');
      if (this.dom.chkAutoDetect.checked) {
        this.motionDetector.start(() => this.camera.getActiveSourceElement());
      }
    } catch (err) {
      console.warn('Initial camera auto-start declined or unavailable:', err);
      this.dom.streamPlaceholder.classList.remove('hidden');

      // If running inside Google Apps Script iframe where camera is blocked by Google policy:
      const isGas = (typeof google !== 'undefined' && google.script) || window.location.hostname.includes('google');
      if (isGas) {
        this._showToast('💡 Google iframe 보안상 카메라가 차단되어, 가상 책 시뮬레이터로 자동 전환합니다.', 'info', 4000);
        setTimeout(() => {
          this._startVirtualBookDemo();
        }, 500);
      }
    }
  }

  _startVirtualBookDemo() {
    this.camera.startVirtualBookSimulator((pageNum) => {
      // Page flipped callback
    });
    this.dom.streamPlaceholder.classList.add('hidden');
    this.dom.videoDropzone.classList.add('hidden');
    this.dom.videoPlaybackHud.classList.add('hidden');
    this.dom.tabSourceCamera.classList.remove('active');
    this.dom.tabSourceVideo.classList.remove('active');
    this._showToast('데모 시뮬레이터가 시작되었습니다. 가상 책이 자동으로 넘어가며 스캔됩니다.');
    if (this.dom.chkAutoDetect.checked) {
      this.motionDetector.start(() => this.camera.getActiveSourceElement());
    }
  }

  _bindEvents() {
    // Export Buttons
    this.dom.btnExportPdfTop.addEventListener('click', () => this._handleExportPdf());
    this.dom.btnExportPdf.addEventListener('click', () => this._handleExportPdf());
    if (this.dom.btnExportEpub) {
      this.dom.btnExportEpub.addEventListener('click', () => this._handleExportEpub());
    }
    if (this.dom.btnExportGDrive) {
      this.dom.btnExportGDrive.addEventListener('click', () => this._handleExportGoogleDrive());
    }
    this.dom.btnExportTxt.addEventListener('click', () => this._handleExportTxt());

    // Mobile View Navigation
    if (this.dom.tabMobileScanner && this.dom.tabMobileGallery) {
      this.dom.tabMobileScanner.addEventListener('click', () => {
        this.dom.tabMobileScanner.classList.add('active');
        this.dom.tabMobileGallery.classList.remove('active');
        document.body.classList.add('mobile-view-scanner');
        document.body.classList.remove('mobile-view-gallery');
      });

      this.dom.tabMobileGallery.addEventListener('click', () => {
        this.dom.tabMobileGallery.classList.add('active');
        this.dom.tabMobileScanner.classList.remove('active');
        document.body.classList.add('mobile-view-gallery');
        document.body.classList.remove('mobile-view-scanner');
      });
    }

    // Torch / Flashlight Toggle
    if (this.dom.btnToggleTorch) {
      this.dom.btnToggleTorch.addEventListener('click', async () => {
        const active = await this.camera.toggleTorch();
        this._showToast(active ? '플래시라이트 켜짐' : '플래시라이트 꺼짐 (미지원 장치)');
      });
    }

    // Mobile Floating Shutter FAB
    if (this.dom.btnMobileShutter) {
      this.dom.btnMobileShutter.addEventListener('click', () => {
        this._handleKeyframeTrigger(true);
      });
    }

    // Google Drive Connect in Settings
    if (this.dom.btnGDriveConnect) {
      this.dom.btnGDriveConnect.addEventListener('click', () => this._handleGDriveConnect());
    }

    // Settings Modal
    this.dom.btnSettings.addEventListener('click', () => {
      this.dom.settingsModal.classList.remove('hidden');
    });
    this.dom.btnSettingsClose.addEventListener('click', () => {
      this.dom.settingsModal.classList.add('hidden');
    });
    this.dom.cfgOcrEngine.addEventListener('change', () => this._updateSettingsVisibility());
    this.dom.btnSettingsSave.addEventListener('click', () => this._saveSettings());

    // Virtual Book Simulator Buttons
    const triggerDemo = () => this._startVirtualBookDemo();
    this.dom.btnVirtualBook.addEventListener('click', triggerDemo);
    if (this.dom.btnPlaceholderDemo) {
      this.dom.btnPlaceholderDemo.addEventListener('click', triggerDemo);
    }

    // Start Camera Button on placeholder
    this.dom.btnStartCamera.addEventListener('click', async () => {
      try {
        await this.camera.startCamera();
        this.dom.streamPlaceholder.classList.add('hidden');
        if (this.dom.chkAutoDetect.checked) {
          this.motionDetector.start(() => this.camera.getActiveSourceElement());
        }
      } catch (e) {
        this._showToast('카메라를 열 수 없습니다: ' + e.message, 'error');
      }
    });

    // Camera / Video Mode Tabs
    this.dom.tabSourceCamera.addEventListener('click', async () => {
      this.dom.tabSourceCamera.classList.add('active');
      this.dom.tabSourceVideo.classList.remove('active');
      this.dom.videoDropzone.classList.add('hidden');
      this.dom.videoPlaybackHud.classList.add('hidden');

      try {
        await this.camera.startCamera();
        this.dom.streamPlaceholder.classList.add('hidden');
        if (this.dom.chkAutoDetect.checked) {
          this.motionDetector.start(() => this.camera.getActiveSourceElement());
        }
      } catch (e) {
        this.dom.streamPlaceholder.classList.remove('hidden');
      }
    });

    this.dom.tabSourceVideo.addEventListener('click', () => {
      this.dom.tabSourceVideo.classList.add('active');
      this.dom.tabSourceCamera.classList.remove('active');
      this.camera.stopAll();
      this.dom.streamPlaceholder.classList.add('hidden');
      this.dom.videoDropzone.classList.remove('hidden');
      this.dom.videoPlaybackHud.classList.add('hidden');
    });

    // Flip Camera
    this.dom.btnFlipCamera.addEventListener('click', async () => {
      try {
        await this.camera.toggleCameraFacing();
        this._showToast('카메라 방향이 전환되었습니다.');
      } catch (e) {
        this._showToast('카메라 전환 실패: ' + e.message, 'warning');
      }
    });

    // Toggle Guideline Overlay
    this.dom.btnToggleGuide.addEventListener('click', () => {
      const isHidden = this.dom.guidelineOverlay.classList.toggle('hidden');
      this._showToast(isHidden ? '가이드라인 숨김' : '가이드라인 표시');
    });

    // Toggle Capture Sound
    this.dom.btnToggleSound.addEventListener('click', () => {
      this.camera.soundEnabled = !this.camera.soundEnabled;
      const btn = this.dom.btnToggleSound;
      btn.innerHTML = `<i data-lucide="${this.camera.soundEnabled ? 'volume-2' : 'volume-x'}"></i>`;
      this._refreshIcons();
      this._showToast(this.camera.soundEnabled ? '캡처 사운드 켜짐' : '캡처 사운드 음소거');
    });

    // Video File Selection & Drag Drop (including Native Mobile Camera capture)
    const handleFile = (e) => {
      if (e.target.files && e.target.files[0]) {
        this._handleVideoLoaded(e.target.files[0]);
      }
    };
    if (this.dom.videoFileInput) this.dom.videoFileInput.addEventListener('change', handleFile);
    if (this.dom.mobileCameraCaptureInput) this.dom.mobileCameraCaptureInput.addEventListener('change', handleFile);
    if (this.dom.mobileCameraDirectInput) this.dom.mobileCameraDirectInput.addEventListener('change', handleFile);

    const dropzone = this.dom.videoDropzone;
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('drag-over');
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        this._handleVideoLoaded(e.dataTransfer.files[0]);
      }
    });

    // Video Playback Scrubbing
    this.dom.btnVideoPlayPause.addEventListener('click', () => {
      const video = this.dom.videoElement;
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
    });

    this.dom.videoElement.addEventListener('play', () => {
      this.dom.iconPlayPause.setAttribute('data-lucide', 'pause');
      this._refreshIcons();
      if (this.dom.chkAutoDetect.checked) {
        this.motionDetector.start(() => this.camera.getActiveSourceElement());
      }
    });

    this.dom.videoElement.addEventListener('pause', () => {
      this.dom.iconPlayPause.setAttribute('data-lucide', 'play');
      this._refreshIcons();
    });

    this.dom.videoElement.addEventListener('timeupdate', () => {
      const video = this.dom.videoElement;
      if (!video.duration) return;

      const cur = this._formatTime(video.currentTime);
      const dur = this._formatTime(video.duration);
      this.dom.lblVideoTime.textContent = `${cur} / ${dur}`;

      this.dom.videoSeeker.value = (video.currentTime / video.duration) * 100;
    });

    this.dom.videoSeeker.addEventListener('input', (e) => {
      const video = this.dom.videoElement;
      if (video.duration) {
        video.currentTime = (e.target.value / 100) * video.duration;
      }
    });

    this.dom.videoSpeedSelect.addEventListener('change', (e) => {
      this.dom.videoElement.playbackRate = parseFloat(e.target.value);
    });

    // CV Auto-Detect Switch
    this.dom.chkAutoDetect.addEventListener('change', (e) => {
      if (e.target.checked) {
        this.motionDetector.start(() => this.camera.getActiveSourceElement());
        this.dom.lblAutoStatus.textContent = '넘김 감지 대기';
      } else {
        this.motionDetector.stop();
        this.dom.lblAutoStatus.textContent = '자동 감지 정지됨';
      }
    });

    // Manual Snap
    this.dom.btnManualSnap.addEventListener('click', () => {
      this._handleKeyframeTrigger(true);
    });

    // Keyboard Spacebar for Manual Snap
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        e.preventDefault();
        this._handleKeyframeTrigger(true);
      }
    });

    // Sensitivity Slider Controls
    this.dom.rngMotionThreshold.addEventListener('input', (e) => {
      const val = e.target.value;
      this.dom.lblThresholdVal.textContent = `${val}%`;
      this.dom.lineMotionThreshold.style.left = `${val}%`;
      this.motionDetector.setParameters({ motionThreshold: val });
    });

    this.dom.rngStabilityDuration.addEventListener('input', (e) => {
      const val = e.target.value;
      this.dom.lblStabilityVal.textContent = `${val}ms`;
      this.motionDetector.setParameters({ stabilityDuration: val });
    });

    this.dom.rngCooldownWindow.addEventListener('input', (e) => {
      const val = e.target.value;
      this.dom.lblCooldownVal.textContent = `${(val / 1000).toFixed(1)}초`;
      this.motionDetector.setParameters({ cooldownWindow: val });
    });

    this.dom.chkRoiOnly.addEventListener('change', (e) => {
      this.motionDetector.setParameters({ roiOnly: e.target.checked });
    });

    // Batch Actions in Gallery
    this.dom.selectGlobalFilter.addEventListener('change', async (e) => {
      const filter = e.target.value;
      if (filter === 'none') return;
      await this._applyGlobalFilter(filter);
      e.target.value = 'none';
    });

    this.dom.btnBatchOcr.addEventListener('click', () => this._handleBatchOcr());
    this.dom.btnClearAll.addEventListener('click', () => {
      if (confirm('스캔된 모든 페이지를 삭제하시겠습니까?')) {
        this.pageStore.clearAll();
        this._showToast('모든 페이지가 초기화되었습니다.');
      }
    });

    // Modal Events
    this.dom.btnModalClose.addEventListener('click', () => {
      this.dom.pageModal.classList.add('hidden');
    });

    this.dom.btnModalRotate.addEventListener('click', async () => {
      if (!this.activeModalPageId) return;
      const page = this.pageStore.getPage(this.activeModalPageId);
      if (!page) return;

      const nextRot = (page.rotation + 90) % 360;
      const enhanced = await ImageEnhancer.processImage(page.originalDataUrl, page.filter, nextRot);
      this.pageStore.updatePage(page.id, { rotation: nextRot, enhancedDataUrl: enhanced });
      this.dom.modalPageImg.src = enhanced;
    });

    this.dom.selectModalFilter.addEventListener('change', async (e) => {
      if (!this.activeModalPageId) return;
      const page = this.pageStore.getPage(this.activeModalPageId);
      if (!page) return;

      const filter = e.target.value;
      const enhanced = await ImageEnhancer.processImage(page.originalDataUrl, filter, page.rotation);
      this.pageStore.updatePage(page.id, { filter, enhancedDataUrl: enhanced });
      this.dom.modalPageImg.src = enhanced;
    });

    this.dom.btnModalReOcr.addEventListener('click', async () => {
      if (!this.activeModalPageId) return;
      const page = this.pageStore.getPage(this.activeModalPageId);
      if (!page) return;

      this.dom.btnModalReOcr.disabled = true;
      this.dom.modalOcrBadge.textContent = '인식 중...';
      try {
        const res = await this.ocrService.recognizePage(page, this.settings);
        this.dom.txtModalOcrText.value = res.text;
        this.pageStore.updatePage(page.id, {
          ocrText: res.text,
          ocrConfidence: res.confidence,
          ocrStatus: 'done'
        });
        this.dom.modalOcrBadge.textContent = `OCR 완료 (${res.confidence}%)`;
        this._showToast('OCR 인식이 완료되었습니다.');
      } catch (err) {
        this._showToast('OCR 실패: ' + err.message, 'error');
        this.dom.modalOcrBadge.textContent = '실패';
      } finally {
        this.dom.btnModalReOcr.disabled = false;
      }
    });

    this.dom.btnModalCopyText.addEventListener('click', () => {
      navigator.clipboard.writeText(this.dom.txtModalOcrText.value);
      this._showToast('텍스트가 클립보드에 복사되었습니다.');
    });

    this.dom.btnModalDeletePage.addEventListener('click', () => {
      if (!this.activeModalPageId) return;
      this.pageStore.removePage(this.activeModalPageId);
      this.dom.pageModal.classList.add('hidden');
      this._showToast('페이지가 삭제되었습니다.');
    });

    this.dom.btnModalSave.addEventListener('click', () => {
      if (!this.activeModalPageId) return;
      this.pageStore.updatePage(this.activeModalPageId, {
        ocrText: this.dom.txtModalOcrText.value
      });
      this.dom.pageModal.classList.add('hidden');
      this._showToast('변경사항이 저장되었습니다.');
    });
  }

  _formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  async _handleVideoLoaded(file) {
    try {
      await this.camera.loadVideoFile(file);
      this.dom.videoDropzone.classList.add('hidden');
      this.dom.streamPlaceholder.classList.add('hidden');
      this.dom.videoPlaybackHud.classList.remove('hidden');
      this._showToast(`동영상 '${file.name}' 로드 완료.`);

      if (this.dom.chkAutoDetect.checked) {
        this.motionDetector.start(() => this.camera.getActiveSourceElement());
      }
    } catch (e) {
      this._showToast(e.message, 'error');
    }
  }

  _handleDetectorStateChange(state) {
    const badge = this.dom.globalStateBadge;
    const txt = this.dom.globalStateText;
    const box = this.dom.guideBox;

    badge.className = 'detection-badge';
    box.className = 'guide-box';

    switch (state) {
      case DetectorState.STANDBY:
        badge.classList.add('state-standby');
        txt.textContent = '대기 중 (Standby)';
        break;

      case DetectorState.DETECTING_MOTION:
        badge.classList.add('state-motion');
        box.classList.add('state-motion');
        txt.textContent = '페이지 넘김 감지 (Flipping)';
        break;

      case DetectorState.DETECTING_STABILITY:
        badge.classList.add('state-stabilizing');
        box.classList.add('state-stabilizing');
        txt.textContent = '페이지 정지 확인 중 (Holding)';
        break;

      case DetectorState.CAPTURE_KEYFRAME:
        badge.classList.add('state-captured');
        txt.textContent = '키프레임 캡처! (Capture)';
        break;

      case DetectorState.COOLDOWN:
        badge.classList.add('state-cooldown');
        txt.textContent = '중복 방지 쿨다운 (Cooldown)';
        break;
    }
  }

  _handleMetricsUpdate({ motionPercent, stabilityPercent, state }) {
    this.dom.valMotionPercent.textContent = `${motionPercent}%`;
    this.dom.barMotionFill.style.width = `${Math.min(100, motionPercent)}%`;

    this.dom.valStabilityPercent.textContent = `${stabilityPercent}%`;
    this.dom.barStabilityFill.style.width = `${stabilityPercent}%`;
  }

  /**
   * Handle Keyframe snapshot capture (either via automated CV or manual snap)
   */
  async _handleKeyframeTrigger(isManual = false) {
    // 1. Visual flash effect
    const flash = this.dom.captureFlash;
    flash.classList.add('flash-active');
    setTimeout(() => flash.classList.remove('flash-active'), 200);

    // 2. Scan light bar sweep
    this.dom.scanLightBar.classList.add('active');
    setTimeout(() => this.dom.scanLightBar.classList.remove('active'), 1200);

    // 3. Guide box percentages for cropping
    const cropToGuide = this.dom.chkCropToGuide.checked;
    const guideBoxPercent = {
      leftPct: 0.09,
      topPct: 0.08,
      widthPct: 0.82,
      heightPct: 0.84,
    };

    // 4. Capture full-resolution frame
    const rawDataUrl = this.camera.captureFrame({
      cropToGuide,
      guideBoxPercent
    });

    if (!rawDataUrl) {
      console.warn('Frame capture returned empty');
      return;
    }

    // 5. Default enhancement filter (Doc Clean for pristine text)
    const filter = 'original';
    const enhancedDataUrl = await ImageEnhancer.processImage(rawDataUrl, filter, 0);

    // 6. Push to Page Store
    const page = this.pageStore.addPage(rawDataUrl, enhancedDataUrl, { filter, rotation: 0 });

    const snapMode = isManual ? '수동' : '자동 CV';
    this._showToast(`페이지 ${page.pageNumber} 캡처 완료 (${snapMode})`);

    // Auto-scroll gallery to bottom
    setTimeout(() => {
      this.dom.pagesGridContainer.scrollTop = this.dom.pagesGridContainer.scrollHeight;
    }, 100);
  }

  /**
   * Subscribe to PageStore changes to update Gallery UI
   */
  _setupStoreSubscription() {
    this.pageStore.subscribe((pages) => {
      this._renderGallery(pages);
      this._updateActionButtons(pages);
    });
  }

  _renderGallery(pages) {
    const total = pages.length;
    this.dom.lblPageTotal.textContent = total;
    this.dom.lblDockCount.textContent = total;
    document.querySelectorAll('.page-count-badge').forEach(b => b.textContent = total);

    const doneCount = pages.filter(p => p.ocrStatus === 'done').length;
    this.dom.lblDockOcrStats.textContent = `OCR 완료: ${doneCount}페이지 / 미완료: ${total - doneCount}페이지`;

    if (total === 0) {
      this.dom.emptyGalleryState.classList.remove('hidden');
      this.dom.pagesCardsGrid.innerHTML = '';
      return;
    }

    this.dom.emptyGalleryState.classList.add('hidden');
    this.dom.pagesCardsGrid.innerHTML = '';

    pages.forEach((page, index) => {
      const card = this._createPageCard(page, index);
      this.dom.pagesCardsGrid.appendChild(card);
    });

    this._refreshIcons();
  }

  _createPageCard(page, index) {
    const card = document.createElement('div');
    card.className = 'page-card';
    card.draggable = true;
    card.dataset.id = page.id;
    card.dataset.index = index;

    // OCR status badge text
    let statusClass = 'status-idle';
    let statusText = 'OCR 미실행';
    if (page.ocrStatus === 'processing') {
      statusClass = 'status-processing';
      statusText = '<i data-lucide="loader-2" class="spin"></i> 인식 중';
    } else if (page.ocrStatus === 'done') {
      statusClass = 'status-done';
      statusText = `<i data-lucide="check"></i> 완료 (${page.ocrConfidence}%)`;
    } else if (page.ocrStatus === 'failed') {
      statusClass = 'status-failed';
      statusText = '<i data-lucide="x"></i> 실패';
    }

    card.innerHTML = `
      <div class="page-card-header">
        <div class="drag-handle" title="드래그하여 페이지 순서 변경">
          <i data-lucide="grip-vertical"></i>
          <span class="page-index-num">P.${page.pageNumber}</span>
        </div>
        <button class="card-action-btn btn-delete" data-action="delete" title="페이지 삭제">
          <i data-lucide="trash-2"></i>
        </button>
      </div>

      <div class="page-card-thumb-wrap" data-action="view" title="클릭하여 상세 보기 및 텍스트 교정">
        <img class="page-card-img" src="${page.enhancedDataUrl || page.originalDataUrl}" alt="Page ${page.pageNumber}">
        <div class="ocr-status-overlay ${statusClass}">
          ${statusText}
        </div>
      </div>

      <div class="page-card-footer">
        <button class="card-action-btn" data-action="rotate" title="90° 시계방향 회전">
          <i data-lucide="rotate-cw"></i>
        </button>
        <button class="card-action-btn" data-action="ocr" title="이 페이지만 OCR 인식">
          <i data-lucide="scan-text"></i>
        </button>
        <button class="card-action-btn" data-action="view" title="텍스트 내용 확인">
          <i data-lucide="eye"></i>
        </button>
      </div>
    `;

    // Event Delegations
    card.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.pageStore.removePage(page.id);
    });

    card.querySelector('[data-action="rotate"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      const nextRot = (page.rotation + 90) % 360;
      const enhanced = await ImageEnhancer.processImage(page.originalDataUrl, page.filter, nextRot);
      this.pageStore.updatePage(page.id, { rotation: nextRot, enhancedDataUrl: enhanced });
    });

    card.querySelector('[data-action="ocr"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      this._runSinglePageOcr(page);
    });

    const viewElements = card.querySelectorAll('[data-action="view"]');
    viewElements.forEach(el => {
      el.addEventListener('click', () => this._openPageDetailModal(page.id));
    });

    // Drag and Drop Events for Reordering
    card.addEventListener('dragstart', (e) => {
      this.draggedCardIndex = index;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.page-card').forEach(c => c.classList.remove('drag-over'));
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('drag-over');
      e.dataTransfer.dropEffect = 'move';
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const targetIndex = index;
      if (this.draggedCardIndex !== null && this.draggedCardIndex !== targetIndex) {
        this.pageStore.reorderPages(this.draggedCardIndex, targetIndex);
      }
    });

    return card;
  }

  _updateActionButtons(pages) {
    const hasPages = pages.length > 0;
    this.dom.btnExportPdfTop.disabled = !hasPages || this.isBatchProcessing;
    this.dom.btnExportPdf.disabled = !hasPages || this.isBatchProcessing;
    if (this.dom.btnExportEpub) {
      this.dom.btnExportEpub.disabled = !hasPages || this.isBatchProcessing;
    }
    if (this.dom.btnExportGDrive) {
      this.dom.btnExportGDrive.disabled = !hasPages || this.isBatchProcessing;
    }
    this.dom.btnExportTxt.disabled = !hasPages || this.isBatchProcessing;
    this.dom.btnBatchOcr.disabled = !hasPages || this.isBatchProcessing;
    this.dom.btnClearAll.disabled = !hasPages || this.isBatchProcessing;
  }

  _openPageDetailModal(pageId) {
    const page = this.pageStore.getPage(pageId);
    if (!page) return;

    this.activeModalPageId = pageId;
    this.dom.modalPageTitle.textContent = `페이지 ${page.pageNumber} 상세 뷰어 & 텍스트 교정`;
    this.dom.modalPageImg.src = page.enhancedDataUrl || page.originalDataUrl;
    this.dom.selectModalFilter.value = page.filter || 'original';
    this.dom.txtModalOcrText.value = page.ocrText || '';

    const badge = this.dom.modalOcrBadge;
    if (page.ocrStatus === 'done') {
      badge.textContent = `OCR 완료 (신뢰도: ${page.ocrConfidence}%)`;
      badge.style.color = '#34d399';
    } else {
      badge.textContent = 'OCR 미실행';
      badge.style.color = '#94a3b8';
    }

    this.dom.pageModal.classList.remove('hidden');
    this._refreshIcons();
  }

  async _runSinglePageOcr(page) {
    this.pageStore.updatePage(page.id, { ocrStatus: 'processing' });
    try {
      const res = await this.ocrService.recognizePage(page, this.settings);
      this.pageStore.updatePage(page.id, {
        ocrText: res.text,
        ocrConfidence: res.confidence,
        ocrStatus: 'done'
      });
      this._showToast(`페이지 ${page.pageNumber} OCR 완료!`);
    } catch (err) {
      this.pageStore.updatePage(page.id, { ocrStatus: 'failed' });
      this._showToast(`페이지 ${page.pageNumber} OCR 실패: ${err.message}`, 'error');
    }
  }

  async _handleBatchOcr() {
    const pages = this.pageStore.getPages();
    if (pages.length === 0) return;

    this.isBatchProcessing = true;
    this._updateActionButtons(pages);

    const progressCard = this.dom.batchProgressCard;
    const progressFill = this.dom.batchProgressBarFill;
    const stats = this.dom.lblProgressStats;
    const title = this.dom.lblProgressTitle;

    progressCard.classList.remove('hidden');
    title.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Tesseract.js / Gemini OCR 일괄 처리 중...';
    this._refreshIcons();

    pages.forEach(p => this.pageStore.updatePage(p.id, { ocrStatus: 'processing' }));

    await this.ocrService.batchProcess(pages, this.settings, (current, total, page, res) => {
      const pct = Math.round((current / total) * 100);
      progressFill.style.width = `${pct}%`;
      stats.textContent = `${current} / ${total} (${pct}%)`;

      if (res && res.text !== undefined) {
        this.pageStore.updatePage(page.id, {
          ocrText: res.text,
          ocrConfidence: res.confidence,
          ocrStatus: 'done'
        });
      } else {
        this.pageStore.updatePage(page.id, { ocrStatus: 'failed' });
      }
    });

    this.isBatchProcessing = false;
    this._updateActionButtons(this.pageStore.getPages());
    this._showToast('모든 페이지의 OCR 인식이 완료되었습니다!');

    setTimeout(() => {
      progressCard.classList.add('hidden');
    }, 2000);
  }

  async _applyGlobalFilter(filter) {
    const pages = this.pageStore.getPages();
    if (pages.length === 0) return;

    this._showToast(`모든 페이지에 '${filter}' 필터를 적용 중...`);
    for (const page of pages) {
      const enhanced = await ImageEnhancer.processImage(page.originalDataUrl, filter, page.rotation);
      this.pageStore.updatePage(page.id, { filter, enhancedDataUrl: enhanced });
    }
    this._showToast('필터 적용이 완료되었습니다.');
  }

  async _handleExportPdf() {
    const pages = this.pageStore.getPages();
    if (pages.length === 0) return;

    try {
      this._showToast('검색 가능한 A4 PDF 문서를 생성 중입니다...');
      const filename = await PdfExporter.downloadPdf(pages, {
        format: this.settings.pdfFormat,
        embedSearchableText: this.settings.embedSearchableText,
        appendTranscript: this.settings.appendTranscriptPage,
        quality: this.settings.pdfQuality
      });
      this._showToast(`PDF 다운로드 완료: ${filename}`);
    } catch (err) {
      this._showToast('PDF 생성 실패: ' + err.message, 'error');
    }
  }

  async _handleExportEpub() {
    const pages = this.pageStore.getPages();
    if (pages.length === 0) return;

    try {
      this._showToast('표준 EPUB 전자책 파일을 생성 중입니다...');
      const filename = await EpubExporter.exportEpub(pages, {
        title: this.settings.epubTitle || '스캔 전자책',
        author: this.settings.epubAuthor || 'AI Book Scanner',
        language: this.settings.epubLang || 'ko'
      });
      this._showToast(`EPUB 이북 다운로드 완료: ${filename}`);
    } catch (err) {
      this._showToast('EPUB 생성 실패: ' + err.message, 'error');
    }
  }

  async _handleGDriveConnect() {
    const clientId = this.dom.cfgGDriveClientId ? this.dom.cfgGDriveClientId.value.trim() : '';
    if (!clientId) {
      this._showToast('Google OAuth Client ID를 먼저 입력하세요.', 'warning');
      return;
    }
    this.googleDrive.setClientId(clientId);
    try {
      this._showToast('Google 로그인 인증을 시작합니다...');
      const token = await this.googleDrive.requestAccessToken();
      if (token) {
        if (this.dom.badgeGDriveStatus) {
          this.dom.badgeGDriveStatus.textContent = '연결됨';
          this.dom.badgeGDriveStatus.style.background = 'rgba(16, 185, 129, 0.2)';
          this.dom.badgeGDriveStatus.style.color = '#34d399';
        }
        this._showToast('Google Drive 계정 연결 성공!');
      }
    } catch (err) {
      this._showToast('Google Drive 연결 실패: ' + err.message, 'error');
    }
  }

  async _handleExportGoogleDrive() {
    const pages = this.pageStore.getPages();
    if (pages.length === 0) return;

    const hasGas = Boolean(this.googleDrive.getGasUrl() || (this.settings && this.settings.gdriveGasUrl));
    const hasOAuth = Boolean(this.settings && this.settings.gdriveClientId);

    if (!hasGas && !hasOAuth) {
      this.dom.settingsModal.classList.remove('hidden');
      this._showToast('Google Drive [BOOK] 폴더에 업로드하려면 설정에서 Google Apps Script 웹 앱 URL 또는 Client ID를 입력해야 합니다.', 'warning', 6000);
      return;
    }

    try {
      this._showToast('이북 파일(PDF & EPUB)을 컴파일하고 Google Drive [BOOK] 폴더로 업로드를 시작합니다...', 'success', 4000);

      // 1. Generate PDF blob
      const { blob: pdfBlob, filename: pdfFilename } = await PdfExporter.generatePdfBlob(pages, {
        format: this.settings.pdfFormat,
        embedSearchableText: this.settings.embedSearchableText,
        appendTranscript: this.settings.appendTranscriptPage,
        quality: this.settings.pdfQuality
      });

      // 2. Generate EPUB blob
      const { blob: epubBlob, filename: epubFilename } = await EpubExporter.generateEpubBlob(pages, {
        title: this.settings.epubTitle || '스캔 전자책',
        author: this.settings.epubAuthor || 'AI Book Scanner',
        language: this.settings.epubLang || 'ko'
      });

      // 3. Upload both to Google Drive BOOK folder
      const results = await this.googleDrive.uploadEbookPackage({
        pdfBlob,
        pdfFilename,
        epubBlob,
        epubFilename
      }, (msg) => this._showToast(msg));

      const link = results[0]?.webViewLink || 'https://drive.google.com';
      this._showToast(`Google Drive [BOOK] 폴더에 ${results.length}개 이북 파일 업로드 완료!`, 'success', 6000);

      // Open Google Drive file link
      if (results[0]?.webViewLink) {
        window.open(results[0].webViewLink, '_blank');
      }
    } catch (err) {
      console.error('Google Drive export error:', err);
      this._showToast('Google Drive 업로드 실패: ' + err.message, 'error', 6000);
    }
  }

  _handleExportTxt() {
    const pages = this.pageStore.getPages();
    if (pages.length === 0) return;

    try {
      PdfExporter.exportPlainText(pages);
      this._showToast('텍스트 전사 파일 (.txt) 다운로드 완료');
    } catch (e) {
      this._showToast('텍스트 추출 실패: ' + e.message, 'error');
    }
  }
}

// Instantiate on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.__app = new App();
});
