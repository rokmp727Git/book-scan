/**
 * Computer Vision Motion & Stability Detector
 * Uses an offscreen 160x120 Canvas to compute pixel luminosity differences
 * and runs a finite state machine for automated page-turn keyframe capture.
 */

export const DetectorState = {
  STANDBY: 'STANDBY',
  DETECTING_MOTION: 'DETECTING_MOTION',
  DETECTING_STABILITY: 'DETECTING_STABILITY',
  CAPTURE_KEYFRAME: 'CAPTURE_KEYFRAME',
  COOLDOWN: 'COOLDOWN'
};

export class MotionDetector {
  constructor(options = {}) {
    this.width = 160;
    this.height = 120;

    this.offCanvas = document.createElement('canvas');
    this.offCanvas.width = this.width;
    this.offCanvas.height = this.height;
    this.ctx = this.offCanvas.getContext('2d', { willReadFrequently: true });

    // Configurable parameters
    this.motionThreshold = options.motionThreshold || 12.0; // Percentage (e.g. 12%)
    this.stabilityDuration = options.stabilityDuration || 650; // Milliseconds to hold
    this.cooldownWindow = options.cooldownWindow || 1800; // Milliseconds cooldown
    this.roiOnly = options.roiOnly !== undefined ? options.roiOnly : true;
    this.intervalMs = 120; // Sample every 120ms

    // Internal state
    this.state = DetectorState.STANDBY;
    this.isActive = false;
    this.previousLuminance = null;
    this.stabilityStartTime = 0;
    this.cooldownStartTime = 0;
    this.lastSampleTime = 0;
    this.timerId = null;

    // Callbacks
    this.onStateChange = options.onStateChange || (() => {});
    this.onMetricsUpdate = options.onMetricsUpdate || (() => {});
    this.onKeyframeTrigger = options.onKeyframeTrigger || (() => {});

    this.hasSeenMotionBeforeStability = false;
  }

  start(sourceElementGetter) {
    if (this.isActive) return;
    this.isActive = true;
    this.getSourceElement = sourceElementGetter;
    this.state = DetectorState.DETECTING_MOTION;
    this.previousLuminance = null;
    this.stabilityStartTime = 0;
    this.hasSeenMotionBeforeStability = false;

    this._notifyState();
    this._loop();
  }

  stop() {
    this.isActive = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.state = DetectorState.STANDBY;
    this.previousLuminance = null;
    this._notifyState();
    this.onMetricsUpdate({
      motionPercent: 0,
      stabilityPercent: 0,
      state: this.state
    });
  }

  setParameters({ motionThreshold, stabilityDuration, cooldownWindow, roiOnly }) {
    if (motionThreshold !== undefined) this.motionThreshold = Number(motionThreshold);
    if (stabilityDuration !== undefined) this.stabilityDuration = Number(stabilityDuration);
    if (cooldownWindow !== undefined) this.cooldownWindow = Number(cooldownWindow);
    if (roiOnly !== undefined) this.roiOnly = Boolean(roiOnly);
  }

  _loop() {
    if (!this.isActive) return;

    const now = performance.now();
    this._processFrame(now);

    this.timerId = setTimeout(() => {
      this._loop();
    }, this.intervalMs);
  }

  _processFrame(now) {
    const source = this.getSourceElement ? this.getSourceElement() : null;
    if (!source) return;

    // Check if source has valid dimensions
    const isVideo = source.tagName === 'VIDEO';
    if (isVideo && (source.readyState < 2 || source.paused || source.ended)) {
      return;
    }

    // Render source to 160x120 canvas
    this.ctx.drawImage(source, 0, 0, this.width, this.height);

    // ROI Bounds (Center 70% width, 80% height if ROI enabled)
    let startX = 0, startY = 0, endX = this.width, endY = this.height;
    if (this.roiOnly) {
      startX = Math.floor(this.width * 0.15);
      endX = Math.floor(this.width * 0.85);
      startY = Math.floor(this.height * 0.10);
      endY = Math.floor(this.height * 0.90);
    }

    const roiWidth = endX - startX;
    const roiHeight = endY - startY;
    const imgData = this.ctx.getImageData(startX, startY, roiWidth, roiHeight);
    const pixels = imgData.data;
    const pixelCount = roiWidth * roiHeight;

    const currentLuminance = new Uint8Array(pixelCount);
    let totalLuminance = 0;

    for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      // Standard human perceptual luminance formula
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
      currentLuminance[p] = lum;
      totalLuminance += lum;
    }

    if (!this.previousLuminance) {
      this.previousLuminance = currentLuminance;
      this.lastSampleTime = now;
      return;
    }

    // Calculate average pixel difference
    let diffSum = 0;
    // Step by 2 for speed and noise reduction
    for (let i = 0; i < pixelCount; i += 2) {
      diffSum += Math.abs(currentLuminance[i] - this.previousLuminance[i]);
    }
    const sampledCount = pixelCount / 2;
    const avgDiff = diffSum / sampledCount;
    // Normalize to percentage 0 ~ 100%
    const motionPercent = Math.min(100, (avgDiff / 255) * 100 * 2.8);

    this.previousLuminance = currentLuminance;
    this.lastSampleTime = now;

    // Run State Machine
    this._updateStateMachine(motionPercent, now);
  }

  _updateStateMachine(motionPercent, now) {
    let stabilityPercent = 0;

    switch (this.state) {
      case DetectorState.COOLDOWN: {
        const elapsedCooldown = now - this.cooldownStartTime;
        if (elapsedCooldown >= this.cooldownWindow) {
          // Cooldown finished, transition back to detecting motion
          this.state = DetectorState.DETECTING_MOTION;
          this.stabilityStartTime = 0;
          this.hasSeenMotionBeforeStability = false;
          this._notifyState();
        }
        break;
      }

      case DetectorState.DETECTING_MOTION: {
        if (motionPercent >= this.motionThreshold) {
          // Page is flipping!
          this.hasSeenMotionBeforeStability = true;
          this.stabilityStartTime = 0;
        } else {
          // Motion is below threshold. If we saw motion, or if starting out
          if (this.hasSeenMotionBeforeStability) {
            this.state = DetectorState.DETECTING_STABILITY;
            this.stabilityStartTime = now;
            this._notifyState();
          }
        }
        break;
      }

      case DetectorState.DETECTING_STABILITY: {
        if (motionPercent >= this.motionThreshold) {
          // Motion spiked back up while trying to stabilize! (e.g. hand still moving)
          this.state = DetectorState.DETECTING_MOTION;
          this.stabilityStartTime = 0;
          this._notifyState();
        } else {
          // Motion remains low, accumulating stability
          const elapsed = now - this.stabilityStartTime;
          stabilityPercent = Math.min(100, Math.floor((elapsed / this.stabilityDuration) * 100));

          if (elapsed >= this.stabilityDuration) {
            // Stable page confirmed! Trigger keyframe snapshot
            this.state = DetectorState.CAPTURE_KEYFRAME;
            this._notifyState();

            this.onKeyframeTrigger();

            // Transition to cooldown
            this.state = DetectorState.COOLDOWN;
            this.cooldownStartTime = performance.now();
            this.stabilityStartTime = 0;
            this.hasSeenMotionBeforeStability = false;
            this._notifyState();
          }
        }
        break;
      }

      default:
        break;
    }

    this.onMetricsUpdate({
      motionPercent: Math.round(motionPercent * 10) / 10,
      stabilityPercent,
      state: this.state
    });
  }

  _notifyState() {
    this.onStateChange(this.state);
  }
}
