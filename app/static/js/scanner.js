/**
 * scanner.js - 跨平台 ISBN 相機條碼掃描模組 (支援原生 BarcodeDetector 與 ZXing-JS 雙引擎)
 */

class ISBNScanner {
  constructor(videoElementId, onDetectedCallback) {
    this.videoElement = document.getElementById(videoElementId);
    this.onDetected = onDetectedCallback;
    this.stream = null;
    this.isScanning = false;
    this.detector = null;
    this.zxingReader = null;
    this.engineType = "none"; // 'native' | 'zxing' | 'none'
    this.initEngine();
  }

  async initEngine() {
    // 1. 優先探測原生 BarcodeDetector (Chrome, Android 等硬體加速)
    if ("BarcodeDetector" in window) {
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (formats.includes("ean_13") || formats.includes("isbn")) {
          this.detector = new BarcodeDetector({
            formats: ["ean_13", "ean_8", "code_128"]
          });
          this.engineType = "native";
          console.log("📷 條碼掃描引擎：已啟用原生硬體加速 BarcodeDetector");
          return;
        }
      } catch (e) {
        console.warn("BarcodeDetector 初始化略過，切換為備援引擎:", e);
      }
    }

    // 2. 備援引擎：ZXing-JS (專門攻克 iOS Safari 與 iOS PWA)
    if (typeof ZXing !== "undefined" && ZXing.BrowserMultiFormatReader) {
      try {
        this.zxingReader = new ZXing.BrowserMultiFormatReader();
        this.engineType = "zxing";
        console.log("📷 條碼掃描引擎：已啟用跨平台 ZXing-JS 解碼器 (iOS 完美相容)");
        return;
      } catch (zErr) {
        console.warn("ZXing-JS 初始化失敗:", zErr);
      }
    }

    this.engineType = "none";
    console.warn("📷 目前環境無可用相機解碼引擎，請使用手動輸入 ISBN。");
  }

  async start() {
    if (this.isScanning) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(
        "瀏覽器限制：非 HTTPS 或非安全連線下無法取用相機！\n請使用「✍️ 手動輸入 ISBN」，或為伺服器設定 HTTPS。"
      );
    }

    // 確保引擎初始化完成
    if (this.engineType === "none") {
      await this.initEngine();
    }

    try {
      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          advanced: [{ focusMode: "continuous" }]
        },
        audio: false
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoElement.srcObject = this.stream;
      await this.videoElement.play();
      this.isScanning = true;

      if (this.engineType === "native" && this.detector) {
        this.beginNativeScanLoop();
      } else if (this.engineType === "zxing" && this.zxingReader) {
        this.beginZxingScanLoop();
      } else {
        console.info("無條碼解碼引擎，鏡頭已開啟但無法自動解碼，建議點選下方手動輸入。");
      }

      return true;
    } catch (err) {
      console.error("相機啟動失敗:", err);
      throw new Error(
        err.name === "NotAllowedError"
          ? "請允許相機存取權限以使用條碼掃描"
          : (err.message || "無法啟動相機，請確認設備具有可用鏡頭")
      );
    }
  }

  // 原生 BarcodeDetector 解碼迴圈
  beginNativeScanLoop() {
    const checkFrame = async () => {
      if (!this.isScanning) return;

      try {
        if (this.videoElement.readyState === this.videoElement.HAVE_ENOUGH_DATA) {
          const barcodes = await this.detector.detect(this.videoElement);
          if (barcodes.length > 0) {
            const rawValue = barcodes[0].rawValue;
            const clean = rawValue.replace(/[-\s]/g, "");
            if (clean.length === 13 || clean.length === 10) {
              this.handleDetected(clean);
              return;
            }
          }
        }
      } catch (e) {
        // 單幀失敗忽略
      }

      if (this.isScanning) {
        requestAnimationFrame(checkFrame);
      }
    };

    requestAnimationFrame(checkFrame);
  }

  // ZXing-JS 解碼迴圈 (支援 iOS Safari & PWA)
  beginZxingScanLoop() {
    try {
      this.zxingReader.decodeFromVideoElement(this.videoElement, (result, err) => {
        if (!this.isScanning) return;
        if (result) {
          const text = result.getText();
          const clean = text.replace(/[-\s]/g, "");
          if (clean.length === 13 || clean.length === 10) {
            this.handleDetected(clean);
          }
        }
      });
    } catch (zLoopErr) {
      console.warn("ZXing 掃描迴圈異常:", zLoopErr);
    }
  }

  handleDetected(isbn) {
    // 嗶聲與震動回饋
    if ("vibrate" in navigator) {
      try {
        navigator.vibrate(100);
      } catch (e) {}
    }

    this.stop();
    if (this.onDetected) {
      this.onDetected(isbn);
    }
  }

  stop() {
    this.isScanning = false;

    // 釋放 ZXing 資源
    if (this.zxingReader) {
      try {
        this.zxingReader.reset();
      } catch (e) {}
    }

    // 停止相機媒體串流
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
window.BarcodeScanner = ISBNScanner;
