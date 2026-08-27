/**
 * scanner.js - 原生 BarcodeDetector 相機條碼掃描模組
 */

class ISBNScanner {
  constructor(videoElementId, onDetectedCallback) {
    this.videoElement = document.getElementById(videoElementId);
    this.onDetected = onDetectedCallback;
    this.stream = null;
    this.isScanning = false;
    this.detector = null;
    this.scanInterval = null;
    this.initDetector();
  }

  async initDetector() {
    if ("BarcodeDetector" in window) {
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (formats.includes("ean_13") || formats.includes("isbn")) {
          this.detector = new BarcodeDetector({
            formats: ["ean_13", "ean_8", "code_128"]
          });
        }
      } catch (e) {
        console.warn("BarcodeDetector 初始化警示:", e);
      }
    }
  }

  async start() {
    if (this.isScanning) return;

    try {
      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoElement.srcObject = this.stream;
      await this.videoElement.play();
      this.isScanning = true;

      this.beginScanLoop();
      return true;
    } catch (err) {
      console.error("相機存取失敗:", err);
      throw new Error(
        err.name === "NotAllowedError"
          ? "請允許相機權限以使用條碼掃描功能"
          : "無法啟動相機，請確認設備有可用鏡頭"
      );
    }
  }

  beginScanLoop() {
    if (!this.detector) {
      console.info("目前瀏覽器無原生 BarcodeDetector，建議手動輸入 ISBN 碼。");
      return;
    }

    const checkFrame = async () => {
      if (!this.isScanning) return;

      try {
        if (this.videoElement.readyState === this.videoElement.HAVE_ENOUGH_DATA) {
          const barcodes = await this.detector.detect(this.videoElement);
          if (barcodes.length > 0) {
            const rawValue = barcodes[0].rawValue;
            // 驗證是否為可能的 10/13 碼 ISBN
            const clean = rawValue.replace(/[-\s]/g, "");
            if (clean.length === 13 || clean.length === 10) {
              this.stop();
              this.onDetected(clean);
              return;
            }
          }
        }
      } catch (e) {
        // 忽略單張偵測失敗
      }

      if (this.isScanning) {
        requestAnimationFrame(checkFrame);
      }
    };

    requestAnimationFrame(checkFrame);
  }

  stop() {
    this.isScanning = false;
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
  }
}

window.ISBNScanner = ISBNScanner;
