/* ============================================================
   ConvertFlow — app.js  (v2 — multi-file support)
   All conversions happen 100% in the browser.
   Libraries: PDF.js · pdf-lib · mammoth · docx · JSZip
   ============================================================ */

// ── Setup PDF.js worker ─────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── DOM refs ────────────────────────────────────────────────
const dropZone          = document.getElementById('dropZone');
const fileInput         = document.getElementById('fileInput');
const fileInfoBar       = document.getElementById('fileInfoBar');
const fileList          = document.getElementById('fileList');
const typeChips         = document.getElementById('typeChips');
const formatGrid        = document.getElementById('formatGrid');
const formatPlaceholder = document.getElementById('formatPlaceholder');
const convertBtn        = document.getElementById('convertBtn');
const convertBtnText    = document.getElementById('convertBtnText');
const progressArea      = document.getElementById('progressArea');
const progressBar       = document.getElementById('progressBar');
const progressLabel     = document.getElementById('progressLabel');
const resultArea        = document.getElementById('resultArea');
const resultSub         = document.getElementById('resultSub');
const resultDownloads   = document.getElementById('resultDownloads');
const convertAgainBtn   = document.getElementById('convertAgainBtn');

// ── State ────────────────────────────────────────────────────
let currentFiles   = [];   // Array<File>  — supports multiple
let detectedType   = null; // 'pdf' | 'word' | 'image'
let selectedFormat = null; // 'jpg' | 'png' | 'pdf' | 'docx'

// ── Format definitions (per input type) ─────────────────────
const FORMAT_MAP = {
  pdf: [
    { id: 'jpg',  icon: '🖼️', label: 'JPG',  desc: 'Image format' },
    { id: 'png',  icon: '🖼️', label: 'PNG',  desc: 'Lossless image' },
    { id: 'docx', icon: '📝', label: 'Word', desc: '.docx file' },
  ],
  word: [
    { id: 'pdf',  icon: '📄', label: 'PDF',  desc: 'Portable format' },
    { id: 'jpg',  icon: '🖼️', label: 'JPG',  desc: 'Image format' },
    { id: 'png',  icon: '🖼️', label: 'PNG',  desc: 'Lossless image' },
  ],
  image: [
    { id: 'pdf',  icon: '📄', label: 'PDF',  desc: 'All images in one PDF' },
    { id: 'jpg',  icon: '🖼️', label: 'JPG',  desc: 'Convert to JPG' },
    { id: 'png',  icon: '🖼️', label: 'PNG',  desc: 'Convert to PNG' },
  ],
};

const TYPE_CHIP_MAP = {
  pdf:   { icon: '📄', label: 'PDF Document' },
  word:  { icon: '📝', label: 'Word (.docx)' },
  image: { icon: '🖼️', label: 'Image(s)' },
};

// ── Helpers ─────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

function getExt(name) {
  return name.split('.').pop().toLowerCase();
}

function guessType(file) {
  const ext = getExt(file.name);
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['jpg','jpeg','png','bmp','gif','tiff','webp'].includes(ext)) return 'image';
  return null;
}

function setProgress(pct, label) {
  progressBar.style.width = pct + '%';
  progressLabel.textContent = label;
}

function showProgress(label = 'Processing…') {
  progressArea.classList.remove('hidden');
  resultArea.classList.add('hidden');
  setProgress(0, label);
}

function showResult(sub, downloads) {
  progressArea.classList.add('hidden');
  resultArea.classList.remove('hidden');
  resultSub.textContent = sub;
  resultDownloads.innerHTML = '';
  downloads.forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'download-btn';
    btn.innerHTML = `⬇️ ${d.label}`;
    btn.onclick = () => triggerDownload(d.blob, d.filename);
    resultDownloads.appendChild(btn);
  });
  // Scroll to result on mobile
  resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// ── File icon helper ─────────────────────────────────────────
const EXT_ICONS = {
  pdf:'📄', doc:'📝', docx:'📝',
  jpg:'🖼️', jpeg:'🖼️', png:'🖼️', bmp:'🖼️', gif:'🎞️', tiff:'🖼️', webp:'🖼️'
};

// ── Load files ───────────────────────────────────────────────
function loadFiles(files) {
  if (!files || !files.length) return;
  currentFiles   = Array.from(files);
  selectedFormat = null;

  // Determine type from first file
  detectedType = guessType(currentFiles[0]);

  // For mixed multi-select, ensure all are same type
  if (currentFiles.length > 1) {
    const types = currentFiles.map(f => guessType(f));
    if (types.every(t => t === 'image')) {
      detectedType = 'image';
    } else {
      // Mixed: use first file only
      currentFiles = [currentFiles[0]];
      alert('Please select files of the same type. Using first file only.');
    }
  }

  // Render file list
  renderFileList();

  // Build type chips
  buildTypeChips();

  // Build format grid
  if (detectedType) {
    selectType(detectedType);
  } else {
    clearFormatGrid();
  }

  convertBtn.classList.remove('hidden');
  updateConvertBtn();
  progressArea.classList.add('hidden');
  resultArea.classList.add('hidden');
}

function renderFileList() {
  fileList.innerHTML = '';

  if (currentFiles.length > 1) {
    const badge = document.createElement('div');
    badge.className = 'file-count-badge';
    badge.textContent = `${currentFiles.length} files selected`;
    fileList.appendChild(badge);
  }

  currentFiles.forEach((file, idx) => {
    const ext  = getExt(file.name);
    const icon = EXT_ICONS[ext] || '📁';
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <span class="file-item-icon">${icon}</span>
      <span class="file-item-name">${file.name}</span>
      <span class="file-item-size">${formatBytes(file.size)}</span>
      <button class="file-remove-btn" data-idx="${idx}" title="Remove">✕</button>
    `;
    fileList.appendChild(item);
  });

  fileList.querySelectorAll('.file-remove-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = parseInt(e.currentTarget.dataset.idx);
      currentFiles.splice(idx, 1);
      if (currentFiles.length === 0) {
        resetAll();
      } else {
        renderFileList();
        updateConvertBtn();
      }
    });
  });

  fileInfoBar.classList.remove('hidden');
}

function buildTypeChips() {
  typeChips.innerHTML = '';
  Object.entries(TYPE_CHIP_MAP).forEach(([key, val]) => {
    const chip = document.createElement('div');
    chip.className = 'type-chip' + (detectedType === key ? ' selected' : '');
    chip.dataset.type = key;
    chip.innerHTML = `${val.icon} ${val.label}`;
    chip.addEventListener('click', () => selectType(key));
    typeChips.appendChild(chip);
  });
}

function selectType(type) {
  detectedType   = type;
  selectedFormat = null;

  document.querySelectorAll('.type-chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.type === type);
  });

  buildFormatGrid(type);
  updateConvertBtn();
}

function buildFormatGrid(type) {
  const formats = FORMAT_MAP[type] || [];
  formatGrid.innerHTML = '';

  if (!formats.length) {
    formatPlaceholder.textContent = 'No available conversions for this file type.';
    formatPlaceholder.classList.remove('hidden');
    formatGrid.classList.add('hidden');
    return;
  }

  formats.forEach(f => {
    const card = document.createElement('div');
    card.className = 'format-card';
    card.dataset.format = f.id;
    card.innerHTML = `
      <div class="format-card-icon">${f.icon}</div>
      <div class="format-card-label">${f.label}</div>
      <div class="format-card-desc">${f.desc}</div>
    `;
    card.addEventListener('click', () => selectFormat(f.id));
    formatGrid.appendChild(card);
  });

  formatGrid.classList.remove('hidden');
  formatPlaceholder.classList.add('hidden');
}

function clearFormatGrid() {
  formatGrid.innerHTML = '';
  formatGrid.classList.add('hidden');
  formatPlaceholder.textContent = 'Upload a file first to see available formats';
  formatPlaceholder.classList.remove('hidden');
}

function selectFormat(format) {
  selectedFormat = format;
  document.querySelectorAll('.format-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.format === format);
  });
  updateConvertBtn();
}

function updateConvertBtn() {
  const ready = currentFiles.length > 0 && detectedType && selectedFormat;
  convertBtn.disabled = !ready;

  if (selectedFormat) {
    const fmts = {
      jpg:  'Convert to JPG',
      png:  'Convert to PNG',
      pdf:  currentFiles.length > 1 ? `Combine ${currentFiles.length} Images → PDF` : 'Convert to PDF',
      docx: 'Convert to Word',
    };
    convertBtnText.textContent = fmts[selectedFormat] || 'Convert Now';
  } else {
    convertBtnText.textContent = 'Select a format above';
  }
}

function resetAll() {
  currentFiles   = [];
  detectedType   = null;
  selectedFormat = null;
  fileInput.value = '';
  fileInfoBar.classList.add('hidden');
  fileList.innerHTML = '';
  typeChips.innerHTML = '';
  clearFormatGrid();
  convertBtn.classList.add('hidden');
  progressArea.classList.add('hidden');
  resultArea.classList.add('hidden');
}

// ── Drop zone events ─────────────────────────────────────────
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) loadFiles(fileInput.files);
});

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
});

convertAgainBtn.addEventListener('click', resetAll);

// ── CONVERT BUTTON ───────────────────────────────────────────
convertBtn.addEventListener('click', async () => {
  if (!currentFiles.length || !detectedType || !selectedFormat) return;

  convertBtn.disabled = true;
  showProgress('Starting conversion…');

  try {
    if (detectedType === 'pdf') {
      const file = currentFiles[0];
      if (selectedFormat === 'jpg' || selectedFormat === 'png') {
        await convertPdfToImages(file, selectedFormat);
      } else if (selectedFormat === 'docx') {
        await convertPdfToWord(file);
      }
    } else if (detectedType === 'word') {
      const file = currentFiles[0];
      if (selectedFormat === 'pdf') {
        await convertWordToPdf(file);
      } else if (selectedFormat === 'jpg' || selectedFormat === 'png') {
        await convertWordToImage(file, selectedFormat);
      }
    } else if (detectedType === 'image') {
      if (selectedFormat === 'pdf') {
        // Pass ALL images into a single PDF
        await convertMultipleImagesToPdf(currentFiles);
      } else if (selectedFormat === 'jpg' || selectedFormat === 'png') {
        // Convert each image independently
        await convertImagesFormat(currentFiles, selectedFormat);
      }
    }
  } catch (err) {
    console.error(err);
    progressArea.classList.add('hidden');
    alert('Conversion failed: ' + err.message);
  }

  convertBtn.disabled = false;
});

// ═══════════════════════════════════════════════════════════════
// ── CONVERSION FUNCTIONS ─────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

/* ── PDF → Images (JPG / PNG) ────────────────────────────── */
async function convertPdfToImages(file, format) {
  showProgress('Loading PDF…');
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc      = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages  = pdfDoc.numPages;
  const downloads   = [];
  const mimeType    = format === 'jpg' ? 'image/jpeg' : 'image/png';

  for (let i = 1; i <= totalPages; i++) {
    setProgress(Math.round((i / totalPages) * 90), `Rendering page ${i} of ${totalPages}…`);
    const page     = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });

    const canvas  = document.createElement('canvas');
    canvas.width  = viewport.width;
    canvas.height = viewport.height;
    const ctx     = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;

    const quality = format === 'jpg' ? 0.98 : undefined;
    const blob    = await new Promise(res => canvas.toBlob(res, mimeType, quality));
    const base    = file.name.replace(/\.[^.]+$/, '');
    downloads.push({ blob, filename: `${base}_page${i}.${format}`, label: `Page ${i}` });
  }

  setProgress(100, 'Done!');
  showResult(`Converted ${totalPages} page(s) to ${format.toUpperCase()}`, downloads);
}

/* ── PDF → Word (.docx) ─────────────────────────────────── */
async function convertPdfToWord(file) {
  showProgress('Extracting text from PDF…');
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc      = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages  = pdfDoc.numPages;

  let allText = '';
  for (let i = 1; i <= totalPages; i++) {
    setProgress(Math.round((i / totalPages) * 70), `Reading page ${i} of ${totalPages}…`);
    const page        = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    allText += textContent.items.map(item => item.str).join(' ') + '\n\n--- Page ' + i + ' ---\n\n';
  }

  setProgress(80, 'Building Word document…');
  const { Document, Paragraph, TextRun, Packer, HeadingLevel } = docx;
  const baseName = file.name.replace(/\.[^.]+$/, '');

  const paragraphs = allText.split('\n').map(line => {
    if (line.startsWith('---')) {
      return new Paragraph({ children: [new TextRun({ text: line, bold: true, color: '7c3aed' })], spacing: { before: 200, after: 200 } });
    }
    return new Paragraph({ children: [new TextRun({ text: line, size: 24 })], spacing: { after: 80 } });
  });

  const doc = new Document({
    sections: [{ properties: {}, children: [
      new Paragraph({ text: baseName, heading: HeadingLevel.HEADING_1, spacing: { after: 300 } }),
      ...paragraphs,
    ]}],
  });

  setProgress(95, 'Packaging…');
  const blob = await Packer.toBlob(doc);
  setProgress(100, 'Done!');
  showResult('PDF converted to Word document', [{
    blob, filename: baseName + '.docx', label: 'Download Word Document',
  }]);
}

/* ── Word → PDF ─────────────────────────────────────────── */
async function convertWordToPdf(file) {
  showProgress('Reading Word document…');
  const arrayBuffer = await file.arrayBuffer();

  setProgress(30, 'Converting to HTML…');
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const html   = result.value;

  setProgress(60, 'Building PDF…');
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:794px;height:1123px;border:none;background:#fff;';
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
  iframeDoc.open();
  iframeDoc.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>body{font-family:Georgia,serif;margin:48px;color:#1a1a1a;font-size:13px;line-height:1.7;}
    h1,h2,h3{color:#1a1a1a;} p{margin:0 0 10px;} table{border-collapse:collapse;width:100%;}
    td,th{border:1px solid #ccc;padding:6px;} img{max-width:100%;}</style></head><body>${html}</body></html>`);
  iframeDoc.close();
  await new Promise(r => setTimeout(r, 600));

  setProgress(75, 'Rendering pages…');
  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const totalHeight = iframeDoc.body.scrollHeight;
  const pageH = 1056, pageW = 816;
  const numPages = Math.max(1, Math.ceil(totalHeight / pageH));

  for (let p = 0; p < numPages; p++) {
    setProgress(75 + Math.round((p / numPages) * 20), `Rendering page ${p + 1}…`);
    const canvas = document.createElement('canvas');
    canvas.width = pageW; canvas.height = pageH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, pageW, pageH);
    const scrollY = p * pageH;
    iframe.contentWindow.scrollTo(0, scrollY);
    await new Promise(r => setTimeout(r, 80));

    const allNodes = iframeDoc.body.querySelectorAll('p,h1,h2,h3,h4,li,td,th,span,div');
    ctx.font = '13px Georgia, serif'; ctx.fillStyle = '#1a1a1a';
    allNodes.forEach(node => {
      const rect  = node.getBoundingClientRect();
      const nodeY = rect.top + scrollY - scrollY * p;
      if (nodeY < 0 || nodeY > pageH) return;
      const text = (node.innerText || '').trim(); if (!text) return;
      const tag = node.tagName;
      if (tag === 'H1') { ctx.font = 'bold 20px Georgia,serif'; ctx.fillStyle = '#1a1a1a'; }
      else if (tag === 'H2') { ctx.font = 'bold 16px Georgia,serif'; ctx.fillStyle = '#333'; }
      else if (tag === 'H3') { ctx.font = 'bold 14px Georgia,serif'; ctx.fillStyle = '#333'; }
      else { ctx.font = '13px Georgia,serif'; ctx.fillStyle = '#1a1a1a'; }
      wrapText(ctx, text, 40, nodeY + 16, pageW - 80, 18);
    });

    const imgData  = canvas.toDataURL('image/png');
    const pngBytes = Uint8Array.from(atob(imgData.split(',')[1]), c => c.charCodeAt(0));
    const pngImage = await pdfDoc.embedPng(pngBytes);
    const page     = pdfDoc.addPage([pageW, pageH]);
    page.drawImage(pngImage, { x: 0, y: 0, width: pageW, height: pageH });
  }

  iframe.remove();
  setProgress(98, 'Finalizing PDF…');
  const pdfBytes = await pdfDoc.save();
  const blob     = new Blob([pdfBytes], { type: 'application/pdf' });
  const baseName = file.name.replace(/\.[^.]+$/, '');
  setProgress(100, 'Done!');
  showResult('Word document converted to PDF', [{
    blob, filename: baseName + '.pdf', label: 'Download PDF',
  }]);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '', curY = y;
  for (const word of words) {
    const testLine = line + word + ' ';
    if (ctx.measureText(testLine).width > maxWidth && line !== '') {
      ctx.fillText(line.trim(), x, curY);
      line = word + ' '; curY += lineHeight;
    } else { line = testLine; }
  }
  ctx.fillText(line.trim(), x, curY);
}

/* ── Word → Image ───────────────────────────────────────── */
async function convertWordToImage(file, format) {
  showProgress('Reading Word document…');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const html   = result.value;

  setProgress(40, 'Rendering document…');
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:900px;height:1200px;border:none;background:#fff;';
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
  iframeDoc.open();
  iframeDoc.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>body{font-family:Georgia,serif;margin:56px;color:#1a1a1a;font-size:14px;line-height:1.75;}
    h1,h2,h3{color:#1a1a1a;} p{margin:0 0 12px;}</style></head><body>${html}</body></html>`);
  iframeDoc.close();
  await new Promise(r => setTimeout(r, 600));

  setProgress(70, 'Capturing image…');
  const canvas = document.createElement('canvas');
  canvas.width  = 900;
  canvas.height = Math.min(iframeDoc.body.scrollHeight + 80, 4000);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);

  const nodes = iframeDoc.body.querySelectorAll('p,h1,h2,h3,h4,li');
  let yOff = 56;
  nodes.forEach(node => {
    const text = (node.innerText || '').trim(); if (!text) return;
    const tag = node.tagName;
    if (tag === 'H1') { ctx.font = 'bold 22px Georgia,serif'; ctx.fillStyle = '#111'; }
    else if (tag === 'H2') { ctx.font = 'bold 18px Georgia,serif'; ctx.fillStyle = '#222'; }
    else { ctx.font = '14px Georgia,serif'; ctx.fillStyle = '#1a1a1a'; }
    wrapText(ctx, text, 56, yOff, 788, 20);
    yOff += 32;
  });

  iframe.remove();
  setProgress(90, 'Encoding…');
  const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const quality  = format === 'jpg' ? 0.98 : undefined;
  const blob     = await new Promise(res => canvas.toBlob(res, mimeType, quality));
  const baseName = file.name.replace(/\.[^.]+$/, '');
  setProgress(100, 'Done!');
  showResult(`Word converted to ${format.toUpperCase()}`, [{
    blob, filename: baseName + '.' + format, label: `Download ${format.toUpperCase()}`,
  }]);
}

/* ── Multiple Images → Single PDF ───────────────────────── */
async function convertMultipleImagesToPdf(files) {
  showProgress(`Combining ${files.length} image(s) into PDF…`);
  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const A4W = 595, A4H = 842;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    setProgress(Math.round(((i + 1) / files.length) * 88), `Embedding image ${i + 1} of ${files.length}…`);

    const arrayBuffer = await file.arrayBuffer();
    const ext         = getExt(file.name);
    let pdfImage;

    if (ext === 'jpg' || ext === 'jpeg') {
      pdfImage = await pdfDoc.embedJpg(arrayBuffer);
    } else {
      // Convert any other format to PNG via canvas
      const blob       = new Blob([arrayBuffer], { type: file.type || 'image/png' });
      const imgBitmap  = await createImageBitmap(blob);
      const canvas     = document.createElement('canvas');
      canvas.width     = imgBitmap.width;
      canvas.height    = imgBitmap.height;
      canvas.getContext('2d').drawImage(imgBitmap, 0, 0);
      const pngBlob    = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const pngBuf     = await pngBlob.arrayBuffer();
      pdfImage = await pdfDoc.embedPng(pngBuf);
    }

    const { width: imgW, height: imgH } = pdfImage;
    const scale   = Math.min(A4W / imgW, A4H / imgH, 1);
    const drawW   = imgW * scale;
    const drawH   = imgH * scale;
    const offsetX = (A4W - drawW) / 2;
    const offsetY = (A4H - drawH) / 2;

    const page = pdfDoc.addPage([A4W, A4H]);
    page.drawImage(pdfImage, { x: offsetX, y: offsetY, width: drawW, height: drawH });
  }

  setProgress(95, 'Saving PDF…');
  const pdfBytes = await pdfDoc.save();
  const blob     = new Blob([pdfBytes], { type: 'application/pdf' });
  const baseName = files[0].name.replace(/\.[^.]+$/, '');
  setProgress(100, 'Done!');
  showResult(`${files.length} image(s) combined into one PDF`, [{
    blob,
    filename: baseName + '_combined.pdf',
    label: `Download PDF (${files.length} pages)`,
  }]);
}

/* ── Image Format Conversion (JPG ↔ PNG etc.) ───────────── */
async function convertImagesFormat(files, format) {
  showProgress('Converting images…');
  const mimeType  = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const quality   = format === 'jpg' ? 0.98 : undefined;
  const downloads = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    setProgress(Math.round(((i + 1) / files.length) * 90), `Converting ${file.name}…`);

    const arrayBuffer = await file.arrayBuffer();
    const blob0       = new Blob([arrayBuffer], { type: file.type || 'image/png' });
    const imgBitmap   = await createImageBitmap(blob0);
    const canvas      = document.createElement('canvas');
    canvas.width      = imgBitmap.width;
    canvas.height     = imgBitmap.height;
    const ctx         = canvas.getContext('2d');

    if (format === 'jpg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(imgBitmap, 0, 0);

    const resultBlob = await new Promise(res => canvas.toBlob(res, mimeType, quality));
    const baseName   = file.name.replace(/\.[^.]+$/, '');
    downloads.push({ blob: resultBlob, filename: baseName + '.' + format, label: file.name });
  }

  setProgress(100, 'Done!');
  showResult(
    `${files.length} image(s) converted to ${format.toUpperCase()}`,
    downloads
  );
}
