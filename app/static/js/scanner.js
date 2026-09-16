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
    this.frameCount = 0;
    this.statusBadge = document.getElementById("scanner-status-badge");
    this.initEngine();
  }

  updateStatus(engineLabel, count, hint) {
    if (!this.statusBadge) {
      this.statusBadge = document.getElementById("scanner-status-badge");
    }
    if (this.statusBadge) {
      let text = `🟢 引擎: ${engineLabel}`;
      if (typeof count === "number") {
        text += ` | 偵測中: ${count} 幀`;
      }
      if (hint) {
        text += ` | ${hint}`;
      }
      this.statusBadge.textContent = text;
    }
  }

  showStatusError(msg) {
    if (!this.statusBadge) {
      this.statusBadge = document.getElementById("scanner-status-badge");
    }
    if (this.statusBadge) {
      this.statusBadge.textContent = `⚠️ 解碼提示: ${msg}`;
    }
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
          this.updateStatus("原生硬體加速", 0, "相機待命");
          return;
        }
      } catch (e) {
        console.warn("BarcodeDetector 初始化略過，切換為備援引擎:", e);
      }
    }

    // 2. 備援引擎：ZXing-JS (專門攻克 iOS Safari 與 iOS PWA，套用 EAN-13 專用與 TRY_HARDER 深度採樣)
    if (typeof ZXing !== "undefined" && ZXing.BrowserMultiFormatReader) {
      try {
        const hints = new Map();
        // 卸下無關格式負擔，專注書籍條碼
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
          ZXing.BarcodeFormat.EAN_13,
          ZXing.BarcodeFormat.EAN_8
        ]);
        // 開啟深度多角度採樣模式 (增加採樣線密度，容忍微偏角)
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);

        this.zxingReader = new ZXing.BrowserMultiFormatReader(hints);
        this.engineType = "zxing";
        console.log("📷 條碼掃描引擎：已啟用跨平台 ZXing-JS 解碼器 (EAN-13 專用 + TRY_HARDER)");
        this.updateStatus("ZXing (EAN-13 專用)", 0, "相機待命");
        return;
      } catch (zErr) {
        console.warn("ZXing-JS 初始化失敗:", zErr);
      }
    }

    this.engineType = "none";
    console.warn("📷 目前環境無可用相機解碼引擎，請使用手動輸入 ISBN。");
    this.showStatusError("無可用解碼引擎，請手動輸入");
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

      // iOS WebKit 視訊尺寸就緒防呆保護 (避免寬高為 0 造成解碼執行緒靜默失效)
      if (this.videoElement.readyState < 2 || this.videoElement.videoWidth === 0) {
        await new Promise((resolve) => {
          this.videoElement.onloadedmetadata = () => resolve();
          // 設置 1 秒超時防護，避免事件遺失卡死
          setTimeout(resolve, 1000);
        });
      }

      this.isScanning = true;
      this.frameCount = 0;

      if (this.engineType === "native" && this.detector) {
        this.beginNativeScanLoop();
      } else if (this.engineType === "zxing" && this.zxingReader) {
        this.beginZxingScanLoop();
      } else {
        console.info("無條碼解碼引擎，鏡頭已開啟但無法自動解碼，建議點選下方手動輸入。");
        this.showStatusError("無解碼器，請使用下方手動輸入");
      }

      return true;
    } catch (err) {
      console.error("相機啟動失敗:", err);
      this.showStatusError(err.message || "相機啟動失敗");
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
          this.frameCount++;
          if (this.frameCount % 5 === 0) {
            this.updateStatus("原生硬體加速", this.frameCount, "請對準條碼");
          }
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
      this.updateStatus("ZXing (EAN-13 專用)", 0, "請對準條碼");

      // 調校掃描頻率為極速模式 (每 150ms 取樣一幀)
      this.zxingReader.timeBetweenScansMillis = 150;
      this.zxingReader._timeBetweenDecodingAttempts = 150;

      // 直接呼叫 decodeContinuously，徹底繞過 WebKit 對 playing 事件的等待死鎖
      this.zxingReader.decodeContinuously(this.videoElement, (result, err) => {
        if (!this.isScanning) return;

        this.frameCount++;
        this.updateStatus("ZXing (EAN-13 專用)", this.frameCount, "請對準條碼");

        if (result) {
          const text = result.getText();
          const clean = text.replace(/[-\s]/g, "");
          if (clean.length === 13 || clean.length === 10) {
            this.handleDetected(clean);
          }
        } else if (err && !(err instanceof ZXing.NotFoundException)) {
          // 非一般的未尋獲例外
          console.warn("ZXing 解碼警告:", err);
        }
      });
    } catch (zLoopErr) {
      console.warn("ZXing 掃描迴圈異常:", zLoopErr);
      this.showStatusError(zLoopErr.message || "掃描迴圈異常");
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
    this.frameCount = 0;

    // 釋放 ZXing 資源
    if (this.zxingReader) {
      try {
        this.zxingReader.stopContinuousDecode();
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

    if (this.statusBadge) {
      this.statusBadge.textContent = "相機已關閉";
    }
  }
}

window.ISBNScanner = ISBNScanner;
window.BarcodeScanner = ISBNScanner;
