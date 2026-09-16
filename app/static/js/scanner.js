/**
 * scanner.js - 跨平台 ISBN 相機條碼掃描模組
 * 引擎優先順序：
 *   1. 原生 BarcodeDetector（Chrome / Android 硬體加速）
 *   2. Quagga2（iOS Safari / iOS PWA 主力，EAN-13 智慧定位引擎）
 *   3. ZXing-JS（最終備援）
 */

class ISBNScanner {
  constructor(videoElementId, onDetectedCallback) {
    this.videoElement = document.getElementById(videoElementId);
    this.onDetected = onDetectedCallback;
    this.stream = null;
    this.isScanning = false;
    this.detector = null;
    this.zxingReader = null;
    this.engineType = "none"; // 'native' | 'quagga2' | 'zxing' | 'none'
    this.quagga2Started = false; // 追蹤 Quagga.start() 是否已成功呼叫，防止 stop 時誤觸
    this.frameCount = 0;
    this.lastDetectedCode = null;  // 雙重校驗：暫存上一幀結果
    this.lastDetectedCount = 0;    // 雙重校驗：連續相同結果計數
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

    // 2. Quagga2 主力引擎（iOS Safari / iOS PWA / 所有 Web 端）
    if (typeof Quagga !== "undefined") {
      this.engineType = "quagga2";
      console.log("📷 條碼掃描引擎：已啟用 Quagga2 (EAN-13 智慧定位)");
      this.updateStatus("Quagga2 (EAN-13 智慧定位)", 0, "相機待命");
      return;
    }

    // 3. 最終備援：ZXing-JS
    if (typeof ZXing !== "undefined" && ZXing.BrowserMultiFormatReader) {
      try {
        const hints = new Map();
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
          ZXing.BarcodeFormat.EAN_13,
          ZXing.BarcodeFormat.EAN_8
        ]);
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);

        this.zxingReader = new ZXing.BrowserMultiFormatReader(hints);
        this.engineType = "zxing";
        console.log("📷 條碼掃描引擎：已啟用跨平台 ZXing-JS 解碼器 (EAN-13 專用 + TRY_HARDER)");
        this.updateStatus("ZXing (EAN-13 備援)", 0, "相機待命");
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

    // ── Quagga2 路徑 ──────────────────────────────────────────────────────────
    // 讓 Quagga.init 全權管理相機，此處不呼叫 getUserMedia
    // beginQuagga2ScanLoop() 回傳 Promise，await 讓 init 失敗時能正確往外拋
    if (this.engineType === "quagga2") {
      this.isScanning = true;
      this.frameCount = 0;
      this.lastDetectedCode = null;
      this.lastDetectedCount = 0;
      await this.beginQuagga2ScanLoop();
      return true;
    }

    // ── 原生 / ZXing 路徑：由此處管理相機 stream ───────────────────────────
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

      // iOS WebKit 視訊尺寸就緒防呆保護（避免寬高為 0 造成解碼靜默失效）
      if (this.videoElement.readyState < 2 || this.videoElement.videoWidth === 0) {
        await new Promise((resolve) => {
          this.videoElement.onloadedmetadata = () => resolve();
          setTimeout(resolve, 1000);
        });
      }

      this.isScanning = true;
      this.frameCount = 0;
      this.lastDetectedCode = null;
      this.lastDetectedCount = 0;

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

  // Quagga2 解碼迴圈（相機由 Quagga.init 全權管理）
  // 回傳 Promise：init 成功 → resolve；init 失敗或逾時 → 自動安全降級至 ZXing
  beginQuagga2ScanLoop() {
    const self = this;
    return new Promise((resolve, reject) => {
      let isSettled = false;

      // 4 秒安全逾時保護：防止任何硬體異常或授權卡死導致介面無反應
      const timeoutTimer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          console.warn("Quagga2 初始化逾時 (4s)，安全降級至 ZXing");
          self.quagga2Started = false;
          self.engineType = "zxing";
          self._initAndStartZxing().then(resolve).catch(reject);
        }
      }, 4000);

      try {
        // Quagga2 的 LiveStream 模式必須以容器 (div) 為 target
        const container = self.videoElement ? self.videoElement.parentElement : document.querySelector(".scanner-container");

        Quagga.init({
          inputStream: {
            name: "Live",
            type: "LiveStream",
            target: container,
            constraints: {
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            // ROI：中央掃描視窗，避開書封其他文字干擾
            area: {
              top: "20%",
              right: "10%",
              left: "10%",
              bottom: "20%"
            }
          },
          locator: {
            halfSample: true,    // 減半採樣加速運算
            patchSize: "medium"  // 適應實體書封底條碼大小
          },
          // 關鍵修復：獨立 bundle 版無 Worker factory，必須設為 0 使用主執行緒，避免死鎖
          numOfWorkers: 0,
          frequency: 10,         // 每秒抽樣 10 幀，平衡手機發熱與反應速度
          decoder: {
            readers: ["ean_reader"] // 卸除 QR/Code39/PDF417，專注 EAN-13 書籍條碼
          },
          locate: true
        }, function(err) {
          if (isSettled) return;
          clearTimeout(timeoutTimer);
          isSettled = true;

          if (err) {
            console.warn("Quagga2 初始化失敗，降級至 ZXing:", err);
            self.quagga2Started = false;
            self.engineType = "zxing";
            self._initAndStartZxing().then(resolve).catch(reject);
            return;
          }

          // 初始化成功
          try {
            Quagga.start();
            self.quagga2Started = true;
            self.updateStatus("Quagga2 (EAN-13 智慧定位)", 0, "請對準條碼");
            resolve(true);
          } catch (startErr) {
            console.warn("Quagga.start 啟動失敗，降級至 ZXing:", startErr);
            self.quagga2Started = false;
            self.engineType = "zxing";
            self._initAndStartZxing().then(resolve).catch(reject);
          }
        });

        // 偵測回呼
        Quagga.onDetected(function(result) {
          if (!self.isScanning) return;

          self.frameCount++;
          if (self.frameCount % 5 === 0) {
            self.updateStatus("Quagga2 (EAN-13 智慧定位)", self.frameCount, "請對準條碼");
          }

          const code = result && result.codeResult && result.codeResult.code;
          const clean = code ? code.replace(/[-\s]/g, "") : "";
          if (clean.length !== 13 && clean.length !== 10) return;

          // 雙重校驗：連續 2 幀相同才觸發，防止劇烈晃動時的極端雜訊誤判
          if (clean === self.lastDetectedCode) {
            self.lastDetectedCount++;
            if (self.lastDetectedCount >= 2) {
              self.handleDetected(clean);
            }
          } else {
            self.lastDetectedCode = clean;
            self.lastDetectedCount = 1;
          }
        });
      } catch (syncErr) {
        if (!isSettled) {
          clearTimeout(timeoutTimer);
          isSettled = true;
          console.warn("Quagga.init 同步例外，降級至 ZXing:", syncErr);
          self.quagga2Started = false;
          self.engineType = "zxing";
          self._initAndStartZxing().then(resolve).catch(reject);
        }
      }
    });
  }

  // Quagga2 降級：初始化 ZXing 並接管相機啟動
  async _initAndStartZxing() {
    if (typeof ZXing !== "undefined" && ZXing.BrowserMultiFormatReader) {
      try {
        const hints = new Map();
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
          ZXing.BarcodeFormat.EAN_13,
          ZXing.BarcodeFormat.EAN_8
        ]);
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        this.zxingReader = new ZXing.BrowserMultiFormatReader(hints);

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
        this.beginZxingScanLoop();
      } catch (e) {
        console.error("ZXing 降級啟動失敗:", e);
        this.showStatusError("掃描引擎啟動失敗，請手動輸入 ISBN");
        this.isScanning = false;
        throw e;
      }
    } else {
      this.showStatusError("無可用解碼引擎，請手動輸入");
      this.isScanning = false;
      throw new Error("無可用解碼引擎");
    }
  }

  // ZXing-JS 解碼迴圈（最終備援）
  beginZxingScanLoop() {
    try {
      this.updateStatus("ZXing (EAN-13 備援)", 0, "請對準條碼");

      // 調校掃描頻率為極速模式（每 150ms 取樣一幀）
      this.zxingReader.timeBetweenScansMillis = 150;
      this.zxingReader._timeBetweenDecodingAttempts = 150;

      // 直接呼叫 decodeContinuously，繞過 WebKit 對 playing 事件的等待死鎖
      this.zxingReader.decodeContinuously(this.videoElement, (result, err) => {
        if (!this.isScanning) return;

        this.frameCount++;
        this.updateStatus("ZXing (EAN-13 備援)", this.frameCount, "請對準條碼");

        if (result) {
          const text = result.getText();
          const clean = text.replace(/[-\s]/g, "");
          if (clean.length === 13 || clean.length === 10) {
            this.handleDetected(clean);
          }
        } else if (err && !(err instanceof ZXing.NotFoundException)) {
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
    this.lastDetectedCode = null;
    this.lastDetectedCount = 0;

    // 釋放 Quagga2 資源
    // 必須確認 Quagga.start() 已被成功呼叫，才可呼叫 Quagga.stop()
    // 若 init 尚未完成就呼叫 stop 會導致 Quagga 內部拋出錯誤
    if (this.engineType === "quagga2" && this.quagga2Started) {
      try {
        Quagga.offDetected(); // 移除偵測回呼，避免殘留監聽器
        Quagga.stop();        // 釋放相機資源
      } catch (e) {}
      this.quagga2Started = false;

      // 清除 Quagga 可能注入的 drawingBuffer canvas
      try {
        const canvases = document.querySelectorAll(".scanner-container canvas.drawingBuffer");
        canvases.forEach((c) => c.remove());
      } catch (e) {}
    }

    // 釋放 ZXing 資源
    if (this.zxingReader) {
      try {
        this.zxingReader.stopContinuousDecode();
        this.zxingReader.reset();
      } catch (e) {}
    }

    // 停止相機媒體串流（原生 / ZXing 路徑才有自管的 stream）
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
