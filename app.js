/* ============================================================
   ConvertFlow — app.js (v3 — Production-Hardened Engine)
   100% In-Browser File Converter with Memory Protection,
   Format Validation, ZIP Bundling, and Cancellation Support.
   Libraries: PDF.js · pdf-lib · Mammoth · docx · JSZip
   ============================================================ */

(() => {
  'use strict';

  // ── Setup PDF.js worker ─────────────────────────────────────
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // ── Resource & Memory Lifecycle Manager ─────────────────────
  const ResourceManager = {
    activeUrls: new Set(),
    activeAbortController: null,

    createUrl(blob) {
      const url = URL.createObjectURL(blob);
      this.activeUrls.add(url);
      return url;
    },

    revokeUrl(url) {
      if (url && this.activeUrls.has(url)) {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
        this.activeUrls.delete(url);
      }
    },

    revokeAllUrls() {
      for (const url of this.activeUrls) {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      }
      this.activeUrls.clear();
    },

    createAbortController() {
      this.abortCurrent();
      this.activeAbortController = new AbortController();
      return this.activeAbortController;
    },

    abortCurrent() {
      if (this.activeAbortController) {
        try {
          this.activeAbortController.abort();
        } catch (_) {}
        this.activeAbortController = null;
      }
    },

    cleanupCanvas(canvas) {
      if (!canvas) return;
      try {
        canvas.width = 0;
        canvas.height = 0;
      } catch (_) {}
    }
  };

  // Automatically clean up object URLs when user navigates away
  window.addEventListener('beforeunload', () => {
    ResourceManager.revokeAllUrls();
    ResourceManager.abortCurrent();
  });

  // ── File Utilities & Sanitization ───────────────────────────
  const FileUtils = {
    formatBytes(bytes) {
      if (!bytes || bytes <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      const val = bytes / Math.pow(1024, i);
      return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i] || 'MB'}`;
    },

    getExt(name) {
      if (!name || typeof name !== 'string') return '';
      const lastDot = name.lastIndexOf('.');
      if (lastDot <= 0) return '';
      return name.substring(lastDot + 1).toLowerCase().trim();
    },

    sanitizeBaseName(name) {
      if (!name || typeof name !== 'string') return 'converted_file';
      // Normalize slashes and path delimiters
      let clean = name.replace(/[/\\]/g, '_').trim();
      // Remove trailing extension
      const lastDot = clean.lastIndexOf('.');
      if (lastDot > 0) {
        clean = clean.substring(0, lastDot);
      } else if (lastDot === 0) {
        clean = clean.substring(1) || 'file';
      }
      // Remove ASCII control codes and unsafe characters
      clean = clean.replace(/[\x00-\x1f\x7f:*?"<>|]/g, '').trim();
      return clean.length > 0 ? clean.substring(0, 120) : 'converted_file';
    },

    async readHeaderBytes(file, byteCount = 32) {
      const slice = file.slice(0, Math.min(file.size, byteCount));
      const buf = await slice.arrayBuffer();
      return new Uint8Array(buf);
    }
  };

  // ── Format Registry & Capability Metadata ───────────────────
  const FORMAT_REGISTRY = {
    pdf: {
      label: 'PDF Document',
      icon: '📄',
      targets: [
        { id: 'jpg',  icon: '🖼️', label: 'JPG',  desc: 'Compressed images', tag: 'High Quality', mime: 'image/jpeg' },
        { id: 'png',  icon: '🖼️', label: 'PNG',  desc: 'Lossless raster',   tag: 'Lossless',     mime: 'image/png' },
        { id: 'webp', icon: '🌐', label: 'WEBP', desc: 'Modern web image',  tag: 'Optimized',    mime: 'image/webp' },
        { id: 'docx', icon: '📝', label: 'Word', desc: '.docx document',    tag: 'Editable',     mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      ]
    },
    word: {
      label: 'Word (.docx)',
      icon: '📝',
      targets: [
        { id: 'pdf',  icon: '📄', label: 'PDF',  desc: 'Portable format',   tag: 'Vector Text',  mime: 'application/pdf' },
        { id: 'jpg',  icon: '🖼️', label: 'JPG',  desc: 'Image format',      tag: 'Compressed',   mime: 'image/jpeg' },
        { id: 'png',  icon: '🖼️', label: 'PNG',  desc: 'Lossless image',    tag: 'Lossless',     mime: 'image/png' },
        { id: 'webp', icon: '🌐', label: 'WEBP', desc: 'Modern web image',  tag: 'Optimized',    mime: 'image/webp' },
      ]
    },
    image: {
      label: 'Image(s)',
      icon: '🖼️',
      targets: [
        { id: 'pdf',  icon: '📄', label: 'PDF',  desc: 'Album / Single PDF',tag: 'Multi-Page',  mime: 'application/pdf' },
        { id: 'jpg',  icon: '🖼️', label: 'JPG',  desc: 'Standard JPEG',     tag: 'Universal',   mime: 'image/jpeg' },
        { id: 'png',  icon: '🖼️', label: 'PNG',  desc: 'Lossless PNG',      tag: 'Transparency',mime: 'image/png' },
        { id: 'webp', icon: '🌐', label: 'WEBP', desc: 'Modern WEBP',       tag: 'Best Size',   mime: 'image/webp' },
      ]
    }
  };

  const EXT_ICONS = {
    pdf: '📄', docx: '📝', doc: '📝',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️',
    webp: '🌐', bmp: '🖼️', gif: '🎞️',
    tiff: '🖼️', tif: '🖼️'
  };

  // ── File Validator (Magic Bytes & Format Guard) ─────────────
  const FileValidator = {
    async validateFile(file) {
      if (!file) {
        return { valid: false, error: 'No file was provided.' };
      }

      if (file.size === 0) {
        return {
          valid: false,
          error: `File "${file.name}" is completely empty (0 bytes). Cannot convert empty files.`
        };
      }

      const ext = FileUtils.getExt(file.name);
      const bytes = await FileUtils.readHeaderBytes(file, 32);

      // Check legacy .doc (OLE2 Compound Document header: D0 CF 11 E0)
      if (bytes.length >= 8 &&
          bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) {
        return {
          valid: false,
          error: `"${file.name}" is a legacy binary Word 97-2003 (.doc) file. Browser conversion supports modern .docx format. Please re-save or export your document as .docx first.`
        };
      }

      // Check TIFF (49 49 2A 00 or 4D 4D 00 2A)
      if ((bytes.length >= 4 && bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2A && bytes[3] === 0x00) ||
          (bytes.length >= 4 && bytes[0] === 0x4D && bytes[1] === 0x4D && bytes[0] === 0x00 && bytes[3] === 0x2A) ||
          ['tiff', 'tif'].includes(ext)) {
        return {
          valid: false,
          error: `TIFF image format is not natively decodable in client-side web browsers. Please convert TIFF files to PNG or JPG before uploading.`
        };
      }

      // PDF: %PDF- (0x25, 0x50, 0x44, 0x46)
      if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
        return { valid: true, type: 'pdf', ext: 'pdf' };
      }

      // DOCX / ZIP: PK\x03\x04
      if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) {
        if (ext === 'docx') {
          return { valid: true, type: 'word', ext: 'docx' };
        }
        return {
          valid: false,
          error: `File has ZIP packaging but extension is .${ext || 'unknown'}. For Word documents, ensure the file ends with .docx.`
        };
      }

      // PNG: 89 50 4E 47 0D 0A 1A 0A
      if (bytes.length >= 8 &&
          bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
          bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) {
        return { valid: true, type: 'image', ext: 'png' };
      }

      // JPEG: FF D8 FF
      if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return { valid: true, type: 'image', ext: 'jpg' };
      }

      // WEBP: RIFF....WEBP
      if (bytes.length >= 12 &&
          bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
          bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return { valid: true, type: 'image', ext: 'webp' };
      }

      // GIF: GIF87a or GIF89a
      if (bytes.length >= 6 &&
          bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
          bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
        return { valid: true, type: 'image', ext: 'gif' };
      }

      // BMP: 42 4D
      if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4D) {
        return { valid: true, type: 'image', ext: 'bmp' };
      }

      // Fallback by extension if mime type or custom image format
      if (['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'].includes(ext)) {
        return { valid: true, type: 'image', ext };
      }
      if (ext === 'docx') {
        return { valid: true, type: 'word', ext: 'docx' };
      }
      if (ext === 'pdf') {
        return { valid: true, type: 'pdf', ext: 'pdf' };
      }

      return {
        valid: false,
        error: `Unsupported file format (.${ext || 'unknown'}). Supported formats: PDF, DOCX, JPG, PNG, WEBP, BMP, GIF.`
      };
    }
  };

  // ── DOM References ──────────────────────────────────────────
  const DOM = {
    dropZone:          document.getElementById('dropZone'),
    fileInput:         document.getElementById('fileInput'),
    browseBtn:         document.getElementById('browseBtn'),
    fileInfoBar:       document.getElementById('fileInfoBar'),
    fileList:          document.getElementById('fileList'),
    typeChips:         document.getElementById('typeChips'),
    formatGrid:        document.getElementById('formatGrid'),
    formatPlaceholder: document.getElementById('formatPlaceholder'),
    convertBtn:        document.getElementById('convertBtn'),
    convertBtnText:    document.getElementById('convertBtnText'),
    progressArea:      document.getElementById('progressArea'),
    progressBar:       document.getElementById('progressBar'),
    progressLabel:     document.getElementById('progressLabel'),
    progressPct:       document.getElementById('progressPct'),
    cancelBtn:         document.getElementById('cancelBtn'),
    resultArea:        document.getElementById('resultArea'),
    resultSub:         document.getElementById('resultSub'),
    resultDownloads:   document.getElementById('resultDownloads'),
    batchDownloadWrap: document.getElementById('batchDownloadWrap'),
    downloadAllBtn:    document.getElementById('downloadAllBtn'),
    convertAgainBtn:   document.getElementById('convertAgainBtn'),
    errorBanner:       document.getElementById('errorBanner'),
    errorTitle:        document.getElementById('errorTitle'),
    errorMessage:      document.getElementById('errorMessage'),
    errorDetails:      document.getElementById('errorDetails'),
    errorDismissBtn:   document.getElementById('errorDismissBtn'),
  };

  // ── Application State ───────────────────────────────────────
  const state = {
    currentFiles: [],        // Array<File>
    detectedType: null,      // 'pdf' | 'word' | 'image'
    selectedFormat: null,    // Target format string (e.g. 'jpg', 'png', 'pdf', 'docx', 'webp')
    isConverting: false,
    generatedDownloads: []   // Array<{ blob, filename, label, size }>
  };

  // ── UI Helpers ──────────────────────────────────────────────
  function showError(title, message, details = '') {
    DOM.errorTitle.textContent = title || 'Error';
    DOM.errorMessage.textContent = message || 'An unexpected problem occurred.';
    if (details) {
      DOM.errorDetails.textContent = details;
      DOM.errorDetails.classList.remove('hidden');
    } else {
      DOM.errorDetails.textContent = '';
      DOM.errorDetails.classList.add('hidden');
    }
    DOM.errorBanner.classList.remove('hidden');
    DOM.errorBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function hideError() {
    DOM.errorBanner.classList.add('hidden');
    DOM.errorTitle.textContent = '';
    DOM.errorMessage.textContent = '';
    DOM.errorDetails.textContent = '';
  }

  function setProgress(pct, label) {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    if (DOM.progressBar) {
      DOM.progressBar.value = clamped;
    }
    if (DOM.progressPct) {
      DOM.progressPct.textContent = `${clamped}%`;
    }
    if (DOM.progressLabel && label) {
      DOM.progressLabel.textContent = label;
    }
  }

  function showProgressArea(label = 'Preparing conversion…') {
    hideError();
    DOM.progressArea.classList.remove('hidden');
    DOM.resultArea.classList.add('hidden');
    setProgress(0, label);
  }

  function hideProgressArea() {
    DOM.progressArea.classList.add('hidden');
  }

  function updateConvertBtn() {
    const ready = state.currentFiles.length > 0 && !!state.detectedType && !!state.selectedFormat;
    DOM.convertBtn.disabled = !ready || state.isConverting;

    if (state.isConverting) {
      DOM.convertBtnText.textContent = 'Converting…';
      return;
    }

    if (state.selectedFormat) {
      const target = state.selectedFormat.toUpperCase();
      if (state.detectedType === 'image' && state.selectedFormat === 'pdf') {
        DOM.convertBtnText.textContent = state.currentFiles.length > 1
          ? `Combine ${state.currentFiles.length} Images → PDF`
          : 'Convert Image → PDF';
      } else if (state.currentFiles.length > 1) {
        DOM.convertBtnText.textContent = `Convert ${state.currentFiles.length} Files → ${target}`;
      } else {
        DOM.convertBtnText.textContent = `Convert to ${target}`;
      }
    } else {
      DOM.convertBtnText.textContent = 'Select a format above';
    }
  }

  function renderFileList() {
    DOM.fileList.innerHTML = '';

    if (state.currentFiles.length > 1) {
      const badge = document.createElement('div');
      badge.className = 'file-count-badge';
      badge.textContent = `${state.currentFiles.length} files selected`;
      DOM.fileList.appendChild(badge);
    }

    state.currentFiles.forEach((file, idx) => {
      const ext = FileUtils.getExt(file.name);
      const icon = EXT_ICONS[ext] || '📁';
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `
        <span class="file-item-icon" aria-hidden="true">${icon}</span>
        <span class="file-item-name" title="${file.name}">${file.name}</span>
        <span class="file-item-size">${FileUtils.formatBytes(file.size)}</span>
        <button class="file-remove-btn" type="button" data-idx="${idx}" aria-label="Remove ${file.name}">✕</button>
      `;
      DOM.fileList.appendChild(item);
    });

    DOM.fileList.querySelectorAll('.file-remove-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt(e.currentTarget.dataset.idx, 10);
        state.currentFiles.splice(idx, 1);
        if (state.currentFiles.length === 0) {
          resetAll();
        } else {
          renderFileList();
          updateConvertBtn();
        }
      });
    });

    DOM.fileInfoBar.classList.remove('hidden');
  }

  function buildTypeChips() {
    DOM.typeChips.innerHTML = '';
    Object.entries(FORMAT_REGISTRY).forEach(([key, val]) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'type-chip' + (state.detectedType === key ? ' selected' : '');
      chip.dataset.type = key;
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', state.detectedType === key ? 'true' : 'false');
      chip.innerHTML = `${val.icon} ${val.label}`;
      chip.addEventListener('click', () => selectType(key));
      DOM.typeChips.appendChild(chip);
    });
  }

  function selectType(type) {
    state.detectedType = type;
    state.selectedFormat = null;

    DOM.typeChips.querySelectorAll('.type-chip').forEach(c => {
      const isSelected = c.dataset.type === type;
      c.classList.toggle('selected', isSelected);
      c.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });

    buildFormatGrid(type);
    updateConvertBtn();
  }

  function buildFormatGrid(type) {
    const entry = FORMAT_REGISTRY[type];
    const targets = entry ? entry.targets : [];
    DOM.formatGrid.innerHTML = '';

    if (!targets.length) {
      DOM.formatPlaceholder.textContent = 'No available conversions for this category.';
      DOM.formatPlaceholder.classList.remove('hidden');
      DOM.formatGrid.classList.add('hidden');
      return;
    }

    targets.forEach(target => {
      const card = document.createElement('div');
      card.className = 'format-card';
      card.tabIndex = 0;
      card.dataset.format = target.id;
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', 'false');
      card.innerHTML = `
        <div class="format-card-icon" aria-hidden="true">${target.icon}</div>
        <div class="format-card-label">${target.label}</div>
        <div class="format-card-desc">${target.desc}</div>
        ${target.tag ? `<span class="format-card-tag">${target.tag}</span>` : ''}
      `;

      card.addEventListener('click', () => selectFormat(target.id));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectFormat(target.id);
        }
      });
      DOM.formatGrid.appendChild(card);
    });

    DOM.formatGrid.classList.remove('hidden');
    DOM.formatPlaceholder.classList.add('hidden');
  }

  function clearFormatGrid() {
    DOM.formatGrid.innerHTML = '';
    DOM.formatGrid.classList.add('hidden');
    DOM.formatPlaceholder.textContent = 'Upload a file above to view available conversion formats';
    DOM.formatPlaceholder.classList.remove('hidden');
  }

  function selectFormat(formatId) {
    state.selectedFormat = formatId;
    DOM.formatGrid.querySelectorAll('.format-card').forEach(c => {
      const isSelected = c.dataset.format === formatId;
      c.classList.toggle('selected', isSelected);
      c.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });
    updateConvertBtn();
  }

  function resetAll() {
    ResourceManager.revokeAllUrls();
    ResourceManager.abortCurrent();
    state.currentFiles = [];
    state.detectedType = null;
    state.selectedFormat = null;
    state.isConverting = false;
    state.generatedDownloads = [];

    DOM.fileInput.value = '';
    DOM.fileInfoBar.classList.add('hidden');
    DOM.fileList.innerHTML = '';
    DOM.typeChips.innerHTML = '';
    clearFormatGrid();
    DOM.convertBtn.classList.add('hidden');
    hideProgressArea();
    DOM.resultArea.classList.add('hidden');
    DOM.batchDownloadWrap.classList.add('hidden');
    DOM.resultDownloads.innerHTML = '';
    hideError();
  }

  // ── File Loading and Intake Validation ──────────────────────
  async function loadFiles(fileList) {
    if (!fileList || !fileList.length) return;
    hideError();

    const incoming = Array.from(fileList);
    const validFiles = [];
    let detectedCategory = null;

    for (const file of incoming) {
      const validation = await FileValidator.validateFile(file);
      if (!validation.valid) {
        showError('Invalid File Format', validation.error);
        return;
      }

      if (!detectedCategory) {
        detectedCategory = validation.type;
      } else if (detectedCategory !== validation.type) {
        showError(
          'Mixed File Types',
          'Please select files belonging to the same category (e.g. all images, or a single document).'
        );
        return;
      }

      validFiles.push(file);
    }

    // For single-file documents (PDF or Word), take the first file
    if ((detectedCategory === 'pdf' || detectedCategory === 'word') && validFiles.length > 1) {
      state.currentFiles = [validFiles[0]];
      showError(
        'Single Document Selected',
        `Processing "${validFiles[0].name}". Multi-file batching is currently optimized for image collections.`
      );
    } else {
      state.currentFiles = validFiles;
    }

    state.detectedType = detectedCategory;
    state.selectedFormat = null;

    renderFileList();
    buildTypeChips();
    selectType(detectedCategory);

    DOM.convertBtn.classList.remove('hidden');
    updateConvertBtn();
    hideProgressArea();
    DOM.resultArea.classList.add('hidden');
  }

  // ── Result & Download Handlers ──────────────────────────────
  function showResult(subtitle, downloads) {
    hideProgressArea();
    state.generatedDownloads = downloads || [];
    DOM.resultSub.textContent = subtitle;
    DOM.resultDownloads.innerHTML = '';

    if (downloads.length > 1) {
      DOM.batchDownloadWrap.classList.remove('hidden');
    } else {
      DOM.batchDownloadWrap.classList.add('hidden');
    }

    downloads.forEach(d => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'download-btn';
      btn.innerHTML = `
        <div class="download-btn-info">
          <span aria-hidden="true">⬇️</span>
          <span>${d.filename}</span>
        </div>
        <span class="download-btn-meta">${d.size ? FileUtils.formatBytes(d.size) : d.label}</span>
      `;
      btn.addEventListener('click', () => triggerDownload(d.blob, d.filename));
      DOM.resultDownloads.appendChild(btn);
    });

    DOM.resultArea.classList.remove('hidden');
    DOM.resultArea.focus();
    DOM.resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function triggerDownload(blob, filename) {
    const url = ResourceManager.createUrl(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      // Revoke after a comfortable 15s window for slow browsers
      setTimeout(() => ResourceManager.revokeUrl(url), 15000);
    }, 100);
  }

  // ── Batch ZIP download with JSZip ──────────────────────────
  if (DOM.downloadAllBtn) {
    DOM.downloadAllBtn.addEventListener('click', async () => {
      if (!state.generatedDownloads.length || typeof JSZip === 'undefined') return;

      try {
        DOM.downloadAllBtn.disabled = true;
        const originalText = DOM.downloadAllBtn.innerHTML;
        DOM.downloadAllBtn.innerHTML = '<span>📦</span> Generating ZIP…';

        const zip = new JSZip();
        for (const item of state.generatedDownloads) {
          zip.file(item.filename, item.blob);
        }

        const zipBlob = await zip.generateAsync({
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 }
        });

        const baseName = FileUtils.sanitizeBaseName(state.currentFiles[0]?.name || 'converted_archive');
        triggerDownload(zipBlob, `${baseName}_all.zip`);

        DOM.downloadAllBtn.innerHTML = originalText;
        DOM.downloadAllBtn.disabled = false;
      } catch (err) {
        console.error('ZIP packaging error:', err);
        showError('ZIP Packaging Failed', err.message);
        DOM.downloadAllBtn.disabled = false;
      }
    });
  }

  // ── Drag & Drop and File Picker Wiring ──────────────────────
  if (DOM.dropZone) {
    DOM.dropZone.addEventListener('click', (e) => {
      // Prevent double invocation if browseBtn was directly clicked
      if (DOM.browseBtn && e.target !== DOM.browseBtn) {
        if (DOM.fileInput) DOM.fileInput.click();
      }
    });

    DOM.dropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (DOM.fileInput) DOM.fileInput.click();
      }
    });

    DOM.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      DOM.dropZone.classList.add('dragover');
    });

    DOM.dropZone.addEventListener('dragleave', () => {
      DOM.dropZone.classList.remove('dragover');
    });

    DOM.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      DOM.dropZone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        loadFiles(e.dataTransfer.files);
      }
    });
  }

  if (DOM.browseBtn) {
    DOM.browseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (DOM.fileInput) DOM.fileInput.click();
    });
  }

  if (DOM.fileInput) {
    DOM.fileInput.addEventListener('change', () => {
      if (DOM.fileInput.files && DOM.fileInput.files.length) {
        loadFiles(DOM.fileInput.files);
      }
      DOM.fileInput.value = '';
    });
  }

  if (DOM.convertAgainBtn) {
    DOM.convertAgainBtn.addEventListener('click', resetAll);
  }

  if (DOM.errorDismissBtn) {
    DOM.errorDismissBtn.addEventListener('click', hideError);
  }

  // ── Cancellation Handler ────────────────────────────────────
  if (DOM.cancelBtn) {
    DOM.cancelBtn.addEventListener('click', () => {
      if (state.isConverting) {
        ResourceManager.abortCurrent();
        state.isConverting = false;
        hideProgressArea();
        updateConvertBtn();
        showError('Conversion Cancelled', 'The conversion was cancelled by the user. Temporary resources were released.');
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // ── CONVERSION ENGINES ───────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════

  /* ── 1. PDF → Images (JPG / PNG / WEBP) ──────────────────── */
  async function convertPdfToImages(file, targetFormat, signal) {
    showProgressArea('Loading PDF document…');
    const arrayBuffer = await file.arrayBuffer();
    
    if (signal.aborted) throw new DOMException('Aborted by user', 'AbortError');

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      useSystemFonts: true
    });

    const pdfDoc = await loadingTask.promise;
    const totalPages = pdfDoc.numPages;
    const downloads = [];
    const mimeType = targetFormat === 'jpg' ? 'image/jpeg' : (targetFormat === 'webp' ? 'image/webp' : 'image/png');
    const baseName = FileUtils.sanitizeBaseName(file.name);

    try {
      for (let i = 1; i <= totalPages; i++) {
        if (signal.aborted) {
          throw new DOMException('Aborted by user', 'AbortError');
        }

        const pct = Math.round((i / totalPages) * 92);
        setProgress(pct, `Rendering page ${i} of ${totalPages}…`);

        const page = await pdfDoc.getPage(i);
        // Base viewport at 1.5x scale for crispness without memory bloat
        let viewport = page.getViewport({ scale: 1.5 });

        // Cap maximum dimension to 2048px to prevent extreme canvas buffer allocation
        const maxDim = Math.max(viewport.width, viewport.height);
        if (maxDim > 2048) {
          const capScale = 2048 / maxDim;
          viewport = page.getViewport({ scale: 1.5 * capScale });
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d', { alpha: targetFormat !== 'jpg' });

        // For JPEG, fill white background so transparent PDF areas do not become black
        if (targetFormat === 'jpg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        await page.render({
          canvasContext: ctx,
          viewport: viewport
        }).promise;

        const quality = targetFormat === 'png' ? undefined : 0.92;
        const blob = await new Promise(res => canvas.toBlob(res, mimeType, quality));

        ResourceManager.cleanupCanvas(canvas);

        if (!blob || blob.size === 0) {
          throw new Error(`Failed to encode rendered image for page ${i}`);
        }

        downloads.push({
          blob,
          filename: `${baseName}_page_${i}.${targetFormat}`,
          label: `Page ${i}`,
          size: blob.size
        });

        // Yield to browser main thread
        await new Promise(r => setTimeout(r, 0));
      }

      setProgress(100, 'Finalizing images…');
      showResult(`Converted ${totalPages} page(s) to ${targetFormat.toUpperCase()}`, downloads);
    } finally {
      try {
        await pdfDoc.destroy();
      } catch (_) {}
    }
  }

  /* ── 2. PDF → Word (.docx) ───────────────────────────────── */
  async function convertPdfToWord(file, signal) {
    showProgressArea('Reading PDF text content…');
    const arrayBuffer = await file.arrayBuffer();
    
    if (signal.aborted) throw new DOMException('Aborted by user', 'AbortError');

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer)
    });

    const pdfDoc = await loadingTask.promise;
    const totalPages = pdfDoc.numPages;
    const baseName = FileUtils.sanitizeBaseName(file.name);
    const pageParagraphs = [];
    let totalTextChars = 0;

    try {
      for (let i = 1; i <= totalPages; i++) {
        if (signal.aborted) {
          throw new DOMException('Aborted by user', 'AbortError');
        }

        setProgress(Math.round((i / totalPages) * 75), `Extracting text from page ${i} of ${totalPages}…`);
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();

        const pageLines = [];
        let currentLine = '';
        let lastY = null;

        for (const item of textContent.items) {
          if (!item.str) continue;
          totalTextChars += item.str.length;

          // Check line break based on Y coordinate transformation
          const currentY = item.transform ? item.transform[5] : null;
          if (lastY !== null && currentY !== null && Math.abs(currentY - lastY) > 8) {
            if (currentLine.trim()) {
              pageLines.push(currentLine.trim());
            }
            currentLine = item.str;
          } else {
            currentLine += (currentLine ? ' ' : '') + item.str;
          }
          lastY = currentY;
        }

        if (currentLine.trim()) {
          pageLines.push(currentLine.trim());
        }

        pageParagraphs.push({ pageNum: i, lines: pageLines });
      }

      if (totalTextChars < 10) {
        // PDF contains almost no selectable text (likely a scanned image)
        showError(
          'Notice: Scanned or Graphic PDF',
          'This PDF contains little or no selectable text. The document appears to consist of scanned images or vector graphics. The resulting Word document may contain only page markers.'
        );
      }

      setProgress(85, 'Constructing Word document structure…');
      const { Document, Paragraph, TextRun, Packer, HeadingLevel, AlignmentType } = docx;

      const docSections = [];
      const titleParagraph = new Paragraph({
        text: baseName,
        heading: HeadingLevel.TITLE,
        spacing: { after: 300 }
      });
      docSections.push(titleParagraph);

      pageParagraphs.forEach(page => {
        docSections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `— Page ${page.pageNum} of ${totalPages} —`,
                bold: true,
                color: '8b5cf6',
                size: 20
              })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 160 }
          })
        );

        if (page.lines.length === 0) {
          docSections.push(
            new Paragraph({
              children: [new TextRun({ text: '[No text detected on this page]', italics: true, color: '666666' })],
              spacing: { after: 120 }
            })
          );
        } else {
          page.lines.forEach(line => {
            docSections.push(
              new Paragraph({
                children: [new TextRun({ text: line, size: 22 })],
                spacing: { after: 100 }
              })
            );
          });
        }
      });

      const doc = new Document({
        sections: [{
          properties: {},
          children: docSections
        }]
      });

      setProgress(95, 'Packaging .docx archive…');
      const docBlob = await Packer.toBlob(doc);

      setProgress(100, 'Word document ready!');
      showResult('PDF successfully converted to editable Word document', [{
        blob: docBlob,
        filename: `${baseName}.docx`,
        label: 'Download Word Document',
        size: docBlob.size
      }]);
    } finally {
      try {
        await pdfDoc.destroy();
      } catch (_) {}
    }
  }

  /* ── 3. Word (.docx) → PDF (Vector PDF Rendering) ────────── */
  async function convertWordToPdf(file, signal) {
    showProgressArea('Reading Word document (.docx)…');
    const arrayBuffer = await file.arrayBuffer();

    if (signal.aborted) throw new DOMException('Aborted by user', 'AbortError');

    setProgress(25, 'Parsing document elements…');
    const mammothResult = await mammoth.convertToHtml({ arrayBuffer });
    const html = mammothResult.value;

    if (!html || html.trim().length === 0) {
      throw new Error('The Word document appears to be empty or contains unsupported content.');
    }

    setProgress(50, 'Building vector PDF pages…');
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const pdfDoc = await PDFDocument.create();

    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic  = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    // Standard A4: 595.28 x 841.89 points
    const PAGE_W = 595.28;
    const PAGE_H = 841.89;
    const MARGIN = 50;
    const CONTENT_W = PAGE_W - (MARGIN * 2);

    let currentPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
    let cursorY = PAGE_H - MARGIN;

    function checkPageBreak(requiredHeight) {
      if (cursorY - requiredHeight < MARGIN) {
        currentPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
        cursorY = PAGE_H - MARGIN;
      }
    }

    // Parse Mammoth HTML into structured DOM elements
    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const childNodes = parsedDoc.body.firstChild.childNodes;

    function wrapAndDrawText(text, size, font, color, lineSpacing = 1.3) {
      const words = text.split(/\s+/);
      let line = '';
      const lineHeight = size * lineSpacing;

      for (let n = 0; n < words.length; n++) {
        const testLine = line + (line ? ' ' : '') + words[n];
        let testWidth = 0;
        try {
          testWidth = font.widthOfTextAtSize(testLine, size);
        } catch (_) {
          testWidth = 0;
        }

        if (testWidth > CONTENT_W && line !== '') {
          checkPageBreak(lineHeight);
          currentPage.drawText(line, {
            x: MARGIN,
            y: cursorY - size,
            size: size,
            font: font,
            color: color
          });
          cursorY -= lineHeight;
          line = words[n];
        } else {
          line = testLine;
        }
      }

      if (line) {
        checkPageBreak(lineHeight);
        currentPage.drawText(line, {
          x: MARGIN,
          y: cursorY - size,
          size: size,
          font: font,
          color: color
        });
        cursorY -= lineHeight;
      }
    }

    for (let i = 0; i < childNodes.length; i++) {
      if (signal.aborted) throw new DOMException('Aborted by user', 'AbortError');

      const node = childNodes[i];
      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      const tag = node.tagName.toUpperCase();
      const text = (node.textContent || '').trim();

      if (tag === 'H1') {
        cursorY -= 12;
        wrapAndDrawText(text, 18, fontBold, rgb(0.1, 0.1, 0.2));
        cursorY -= 8;
      } else if (tag === 'H2') {
        cursorY -= 10;
        wrapAndDrawText(text, 15, fontBold, rgb(0.15, 0.15, 0.25));
        cursorY -= 6;
      } else if (tag === 'H3') {
        cursorY -= 8;
        wrapAndDrawText(text, 13, fontBold, rgb(0.2, 0.2, 0.3));
        cursorY -= 4;
      } else if (tag === 'P') {
        if (text) {
          wrapAndDrawText(text, 10.5, fontRegular, rgb(0.15, 0.15, 0.15));
          cursorY -= 6;
        }
      } else if (tag === 'UL' || tag === 'OL') {
        const items = node.querySelectorAll('li');
        items.forEach((li, liIdx) => {
          const bullet = tag === 'UL' ? '• ' : `${liIdx + 1}. `;
          const liText = bullet + (li.textContent || '').trim();
          wrapAndDrawText(liText, 10, fontRegular, rgb(0.15, 0.15, 0.15));
        });
        cursorY -= 6;
      } else if (tag === 'TABLE') {
        // Render simple table cells
        const rows = node.querySelectorAll('tr');
        rows.forEach(tr => {
          const cells = tr.querySelectorAll('td, th');
          if (!cells.length) return;
          const colW = CONTENT_W / cells.length;
          checkPageBreak(20);

          cells.forEach((td, colIdx) => {
            const cellText = (td.textContent || '').trim();
            const isHeader = td.tagName.toUpperCase() === 'TH';
            const cellFont = isHeader ? fontBold : fontRegular;
            try {
              currentPage.drawText(cellText.substring(0, 35), {
                x: MARGIN + (colIdx * colW) + 4,
                y: cursorY - 12,
                size: 9,
                font: cellFont,
                color: rgb(0.15, 0.15, 0.15)
              });
            } catch (_) {}
          });
          cursorY -= 18;
        });
        cursorY -= 8;
      } else if (tag === 'IMG') {
        // Handle embedded images extracted by Mammoth
        const src = node.getAttribute('src');
        if (src && src.startsWith('data:image/')) {
          try {
            const commaIdx = src.indexOf(',');
            const mime = src.substring(5, commaIdx).split(';')[0];
            const base64Data = src.substring(commaIdx + 1);
            const binaryStr = atob(base64Data);
            const imgBytes = new Uint8Array(binaryStr.length);
            for (let b = 0; b < binaryStr.length; b++) {
              imgBytes[b] = binaryStr.charCodeAt(b);
            }

            let embeddedImg = null;
            if (mime.includes('jpeg') || mime.includes('jpg')) {
              embeddedImg = await pdfDoc.embedJpg(imgBytes);
            } else if (mime.includes('png')) {
              embeddedImg = await pdfDoc.embedPng(imgBytes);
            }

            if (embeddedImg) {
              const imgDim = embeddedImg.scaleToFit(CONTENT_W, 260);
              checkPageBreak(imgDim.height + 10);
              currentPage.drawImage(embeddedImg, {
                x: MARGIN,
                y: cursorY - imgDim.height,
                width: imgDim.width,
                height: imgDim.height
              });
              cursorY -= (imgDim.height + 12);
            }
          } catch (imgErr) {
            console.warn('Could not embed image from DOCX:', imgErr);
          }
        }
      }
    }

    // Add page numbering footer to each page
    const totalPages = pdfDoc.getPageCount();
    for (let p = 0; p < totalPages; p++) {
      const page = pdfDoc.getPage(p);
      const footerText = `Page ${p + 1} of ${totalPages}`;
      const footerWidth = fontRegular.widthOfTextAtSize(footerText, 9);
      page.drawText(footerText, {
        x: (PAGE_W - footerWidth) / 2,
        y: 24,
        size: 9,
        font: fontRegular,
        color: rgb(0.5, 0.5, 0.5)
      });
    }

    setProgress(90, 'Assembling PDF binary…');
    const pdfBytes = await pdfDoc.save();
    const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
    const baseName = FileUtils.sanitizeBaseName(file.name);

    setProgress(100, 'Word to PDF complete!');
    showResult('Word document converted to vector PDF', [{
      blob: pdfBlob,
      filename: `${baseName}.pdf`,
      label: 'Download PDF',
      size: pdfBlob.size
    }]);
  }

  /* ── 4. Word (.docx) → Image (JPG / PNG / WEBP) ──────────── */
  async function convertWordToImage(file, targetFormat, signal) {
    showProgressArea('Converting Word document to image…');
    const arrayBuffer = await file.arrayBuffer();

    if (signal.aborted) throw new DOMException('Aborted by user', 'AbortError');

    setProgress(30, 'Rendering document layout…');
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const html = result.value;

    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    // Estimate canvas height based on text content
    const estimatedHeight = Math.max(800, Math.min(6000, 400 + Math.floor(html.length * 0.45)));
    canvas.height = estimatedHeight;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#111827';
    ctx.font = 'bold 28px Georgia, serif';
    const baseName = FileUtils.sanitizeBaseName(file.name);
    ctx.fillText(baseName, 60, 80);

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const nodes = doc.body.firstChild.childNodes;

    let y = 140;
    const maxW = 1080;

    for (let i = 0; i < nodes.length; i++) {
      if (signal.aborted) {
        ResourceManager.cleanupCanvas(canvas);
        throw new DOMException('Aborted by user', 'AbortError');
      }

      const node = nodes[i];
      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      const tag = node.tagName.toUpperCase();
      const text = (node.textContent || '').trim();
      if (!text) continue;

      if (tag === 'H1') {
        ctx.font = 'bold 24px Georgia, serif';
        ctx.fillStyle = '#111827';
        y += 16;
      } else if (tag === 'H2') {
        ctx.font = 'bold 20px Georgia, serif';
        ctx.fillStyle = '#1f2937';
        y += 12;
      } else {
        ctx.font = '16px Georgia, serif';
        ctx.fillStyle = '#374151';
        y += 6;
      }

      // Word wrapping on canvas
      const words = text.split(' ');
      let line = '';
      for (const w of words) {
        const testLine = line + (line ? ' ' : '') + w;
        if (ctx.measureText(testLine).width > maxW && line) {
          ctx.fillText(line, 60, y);
          y += 24;
          line = w;
        } else {
          line = testLine;
        }
      }
      if (line) {
        ctx.fillText(line, 60, y);
        y += 28;
      }

      if (y > canvas.height - 100) break;
    }

    setProgress(85, 'Encoding image…');
    const mimeType = targetFormat === 'jpg' ? 'image/jpeg' : (targetFormat === 'webp' ? 'image/webp' : 'image/png');
    const quality = targetFormat === 'png' ? undefined : 0.92;
    const blob = await new Promise(res => canvas.toBlob(res, mimeType, quality));

    ResourceManager.cleanupCanvas(canvas);

    setProgress(100, 'Image ready!');
    showResult(`Word document converted to ${targetFormat.toUpperCase()}`, [{
      blob,
      filename: `${baseName}.${targetFormat}`,
      label: `Download ${targetFormat.toUpperCase()}`,
      size: blob.size
    }]);
  }

  /* ── 5. Multiple Images → Unified PDF ────────────────────── */
  async function convertMultipleImagesToPdf(files, signal) {
    showProgressArea(`Combining ${files.length} image(s) into PDF…`);
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.create();

    // Standard A4 dimensions
    const A4_W = 595.28;
    const A4_H = 841.89;

    for (let i = 0; i < files.length; i++) {
      if (signal.aborted) throw new DOMException('Aborted by user', 'AbortError');

      const file = files[i];
      setProgress(
        Math.round(((i + 1) / files.length) * 88),
        `Processing image ${i + 1} of ${files.length}: ${file.name}…`
      );

      const arrayBuffer = await file.arrayBuffer();
      const ext = FileUtils.getExt(file.name);
      let pdfImage = null;

      if (ext === 'jpg' || ext === 'jpeg') {
        pdfImage = await pdfDoc.embedJpg(arrayBuffer);
      } else if (ext === 'png') {
        try {
          pdfImage = await pdfDoc.embedPng(arrayBuffer);
        } catch (_) {
          // If native PNG embedding fails due to exotic color profiles, transcode via canvas
          pdfImage = await transcodeToPdfImage(pdfDoc, arrayBuffer, file.type || 'image/png');
        }
      } else {
        // Transcode WEBP / BMP / GIF into PNG buffer for PDF-Lib embedding
        pdfImage = await transcodeToPdfImage(pdfDoc, arrayBuffer, file.type || 'image/png');
      }

      const { width: imgW, height: imgH } = pdfImage;
      const margin = 36;
      const maxDrawW = A4_W - (margin * 2);
      const maxDrawH = A4_H - (margin * 2);

      const scale = Math.min(maxDrawW / imgW, maxDrawH / imgH, 1);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      const offsetX = (A4_W - drawW) / 2;
      const offsetY = (A4_H - drawH) / 2;

      const page = pdfDoc.addPage([A4_W, A4_H]);
      page.drawImage(pdfImage, {
        x: offsetX,
        y: offsetY,
        width: drawW,
        height: drawH
      });
    }

    setProgress(94, 'Writing combined PDF…');
    const pdfBytes = await pdfDoc.save();
    const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
    const baseName = FileUtils.sanitizeBaseName(files[0].name);

    setProgress(100, 'Done!');
    showResult(`Combined ${files.length} image(s) into 1 PDF`, [{
      blob: pdfBlob,
      filename: `${baseName}_album.pdf`,
      label: `Download PDF (${files.length} pages)`,
      size: pdfBlob.size
    }]);
  }

  // Helper to transcode non-native formats (WEBP, BMP, GIF) to PDFLib image
  async function transcodeToPdfImage(pdfDoc, arrayBuffer, mimeType) {
    const blob = new Blob([arrayBuffer], { type: mimeType });
    const imgBitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = imgBitmap.width;
    canvas.height = imgBitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgBitmap, 0, 0);

    const pngBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    imgBitmap.close();
    ResourceManager.cleanupCanvas(canvas);

    const pngBuffer = await pngBlob.arrayBuffer();
    return await pdfDoc.embedPng(pngBuffer);
  }

  /* ── 6. Image Cross-Conversion (JPG ↔ PNG ↔ WEBP) ────────── */
  async function convertImagesFormat(files, targetFormat, signal) {
    showProgressArea('Converting images…');
    const mimeType = targetFormat === 'jpg' ? 'image/jpeg' : (targetFormat === 'webp' ? 'image/webp' : 'image/png');
    const quality  = targetFormat === 'png' ? undefined : 0.92;
    const downloads = [];

    for (let i = 0; i < files.length; i++) {
      if (signal.aborted) throw new DOMException('Aborted by user', 'AbortError');

      const file = files[i];
      setProgress(
        Math.round(((i + 1) / files.length) * 90),
        `Converting ${file.name} (${i + 1} of ${files.length})…`
      );

      const arrayBuffer = await file.arrayBuffer();
      const inputBlob = new Blob([arrayBuffer], { type: file.type || 'image/png' });
      const imgBitmap = await createImageBitmap(inputBlob);

      const canvas = document.createElement('canvas');
      canvas.width = imgBitmap.width;
      canvas.height = imgBitmap.height;
      const ctx = canvas.getContext('2d', { alpha: targetFormat !== 'jpg' });

      // For JPEG, fill white background to eliminate transparent black artifacts
      if (targetFormat === 'jpg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.drawImage(imgBitmap, 0, 0);
      imgBitmap.close();

      const resultBlob = await new Promise(res => canvas.toBlob(res, mimeType, quality));
      ResourceManager.cleanupCanvas(canvas);

      if (!resultBlob || resultBlob.size === 0) {
        throw new Error(`Failed to encode image "${file.name}" to ${targetFormat.toUpperCase()}`);
      }

      const baseName = FileUtils.sanitizeBaseName(file.name);
      downloads.push({
        blob: resultBlob,
        filename: `${baseName}.${targetFormat}`,
        label: `${baseName}.${targetFormat}`,
        size: resultBlob.size
      });

      await new Promise(r => setTimeout(r, 0));
    }

    setProgress(100, 'Images converted!');
    showResult(
      `Successfully converted ${files.length} image(s) to ${targetFormat.toUpperCase()}`,
      downloads
    );
  }

  // ── Convert Button Trigger ──────────────────────────────────
  if (DOM.convertBtn) {
    DOM.convertBtn.addEventListener('click', async () => {
      if (!state.currentFiles.length || !state.detectedType || !state.selectedFormat) return;
      if (state.isConverting) return;

      state.isConverting = true;
      updateConvertBtn();

      const abortController = ResourceManager.createAbortController();
      const signal = abortController.signal;

      try {
        if (state.detectedType === 'pdf') {
          const file = state.currentFiles[0];
          if (['jpg', 'png', 'webp'].includes(state.selectedFormat)) {
            await convertPdfToImages(file, state.selectedFormat, signal);
          } else if (state.selectedFormat === 'docx') {
            await convertPdfToWord(file, signal);
          }
        } else if (state.detectedType === 'word') {
          const file = state.currentFiles[0];
          if (state.selectedFormat === 'pdf') {
            await convertWordToPdf(file, signal);
          } else if (['jpg', 'png', 'webp'].includes(state.selectedFormat)) {
            await convertWordToImage(file, state.selectedFormat, signal);
          }
        } else if (state.detectedType === 'image') {
          if (state.selectedFormat === 'pdf') {
            await convertMultipleImagesToPdf(state.currentFiles, signal);
          } else if (['jpg', 'png', 'webp'].includes(state.selectedFormat)) {
            await convertImagesFormat(state.currentFiles, state.selectedFormat, signal);
          }
        }
      } catch (err) {
        if (err.name === 'AbortError' || signal.aborted) {
          console.info('Conversion aborted by user.');
        } else {
          console.error('Conversion exception:', err);
          hideProgressArea();
          showError(
            'Conversion Failed',
            err.message || 'An unexpected error occurred during processing.',
            err.stack || ''
          );
        }
      } finally {
        state.isConverting = false;
        updateConvertBtn();
      }
    });
  }

  // Expose pure validation and sanitization helpers for automated Node test suites
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FileUtils, FileValidator, FORMAT_REGISTRY, ResourceManager };
  } else if (typeof window !== 'undefined') {
    window.__ConvertFlow = { FileUtils, FileValidator, FORMAT_REGISTRY, ResourceManager };
  }
})();
