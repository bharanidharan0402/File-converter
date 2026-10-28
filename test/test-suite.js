// Comprehensive Automated Test Suite for ConvertFlow
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read app.js content and extract window.__ConvertFlow
const appJsPath = path.join(__dirname, '..', 'app.js');
const appJsCode = fs.readFileSync(appJsPath, 'utf8');

// Create a minimal browser-like mock environment for testing
const mockWindow = {
  addEventListener: () => {},
  removeEventListener: () => {}
};
const mockDocument = {
  getElementById: () => null,
  addEventListener: () => {}
};

// Execute app.js in sandbox
const sandbox = {
  window: mockWindow,
  document: mockDocument,
  pdfjsLib: { GlobalWorkerOptions: {} },
  DOMException: globalThis.DOMException || Error,
  URL: {
    createObjectURL: (blob) => `blob:http://localhost/${Math.random().toString(36).slice(2)}`,
    revokeObjectURL: (url) => {}
  },
  AbortController: globalThis.AbortController,
  Set: globalThis.Set,
  Uint8Array: globalThis.Uint8Array,
  ArrayBuffer: globalThis.ArrayBuffer,
  Blob: globalThis.Blob,
  Math: globalThis.Math,
  Node: { ELEMENT_NODE: 1 },
  console: console
};

// Evaluate app.js
const fn = new Function('window', 'document', 'pdfjsLib', 'URL', 'AbortController', 'DOMException', appJsCode);
fn(sandbox.window, sandbox.document, sandbox.pdfjsLib, sandbox.URL, sandbox.AbortController, sandbox.DOMException);

const { FileUtils, FileValidator, FORMAT_REGISTRY, ResourceManager } = sandbox.window.__ConvertFlow;

// ── Test 1: FileUtils.formatBytes ─────────────────────────────
test('FileUtils.formatBytes formats correctly across all ranges', () => {
  assert.strictEqual(FileUtils.formatBytes(0), '0 B');
  assert.strictEqual(FileUtils.formatBytes(-5), '0 B');
  assert.strictEqual(FileUtils.formatBytes(500), '500 B');
  assert.strictEqual(FileUtils.formatBytes(1024), '1.00 KB');
  assert.strictEqual(FileUtils.formatBytes(1536), '1.50 KB');
  assert.strictEqual(FileUtils.formatBytes(1048576), '1.00 MB');
  assert.strictEqual(FileUtils.formatBytes(52428800), '50.00 MB');
  assert.strictEqual(FileUtils.formatBytes(1073741824), '1.00 GB');
});

// ── Test 2: FileUtils.getExt ─────────────────────────────────
test('FileUtils.getExt handles complex filenames and extensions', () => {
  assert.strictEqual(FileUtils.getExt('document.pdf'), 'pdf');
  assert.strictEqual(FileUtils.getExt('IMAGE.PNG'), 'png');
  assert.strictEqual(FileUtils.getExt('my.cool.photo.JPEG'), 'jpeg');
  assert.strictEqual(FileUtils.getExt('no_extension'), '');
  assert.strictEqual(FileUtils.getExt('.hidden'), '');
  assert.strictEqual(FileUtils.getExt('.hidden.docx'), 'docx');
  assert.strictEqual(FileUtils.getExt(''), '');
  assert.strictEqual(FileUtils.getExt(null), '');
});

// ── Test 3: FileUtils.sanitizeBaseName ────────────────────────
test('FileUtils.sanitizeBaseName prevents path traversal and preserves names', () => {
  assert.strictEqual(FileUtils.sanitizeBaseName('annual-report.pdf'), 'annual-report');
  assert.strictEqual(FileUtils.sanitizeBaseName('data.v2.final.docx'), 'data.v2.final');
  assert.strictEqual(FileUtils.sanitizeBaseName('../../etc/passwd.jpg'), '.._.._etc_passwd');
  assert.strictEqual(FileUtils.sanitizeBaseName('C:\\Users\\file.png'), 'C_Users_file');
  assert.strictEqual(FileUtils.sanitizeBaseName('hello<world>:test"file.pdf'), 'helloworldtestfile');
  assert.strictEqual(FileUtils.sanitizeBaseName('.hidden.pdf'), '.hidden');
  assert.strictEqual(FileUtils.sanitizeBaseName(''), 'converted_file');
});

// ── Test 4: Format Registry Integrity ─────────────────────────
test('FORMAT_REGISTRY contains complete, valid format mappings', () => {
  const categories = ['pdf', 'word', 'image'];
  categories.forEach(cat => {
    assert.ok(FORMAT_REGISTRY[cat], `Missing category: ${cat}`);
    assert.ok(FORMAT_REGISTRY[cat].targets.length > 0, `Category ${cat} has no targets`);
    
    FORMAT_REGISTRY[cat].targets.forEach(t => {
      assert.ok(t.id, 'Target missing id');
      assert.ok(t.label, 'Target missing label');
      assert.ok(t.desc, 'Target missing desc');
      assert.ok(t.mime, 'Target missing mime');
    });
  });

  // Verify WebP is supported across images, pdf, and word
  const imgTargets = FORMAT_REGISTRY.image.targets.map(t => t.id);
  assert.ok(imgTargets.includes('webp'), 'WEBP target missing in image');
  assert.ok(imgTargets.includes('pdf'), 'PDF target missing in image');
  assert.ok(imgTargets.includes('jpg'), 'JPG target missing in image');
  assert.ok(imgTargets.includes('png'), 'PNG target missing in image');

  const pdfTargets = FORMAT_REGISTRY.pdf.targets.map(t => t.id);
  assert.ok(pdfTargets.includes('webp'), 'WEBP target missing in pdf');
  assert.ok(pdfTargets.includes('docx'), 'DOCX target missing in pdf');
});

// ── Test 5: FileValidator Magic Byte Inspections ──────────────
test('FileValidator validates PDF headers accurately', async () => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37]);
  const mockFile = {
    name: 'contract.pdf',
    size: 1024,
    slice: () => ({ arrayBuffer: async () => pdfBytes.buffer })
  };
  const result = await FileValidator.validateFile(mockFile);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.type, 'pdf');
});

test('FileValidator validates PNG headers accurately', async () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const mockFile = {
    name: 'logo.png',
    size: 2048,
    slice: () => ({ arrayBuffer: async () => pngBytes.buffer })
  };
  const result = await FileValidator.validateFile(mockFile);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.type, 'image');
});

test('FileValidator validates JPEG headers accurately', async () => {
  const jpgBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]);
  const mockFile = {
    name: 'photo.jpg',
    size: 4096,
    slice: () => ({ arrayBuffer: async () => jpgBytes.buffer })
  };
  const result = await FileValidator.validateFile(mockFile);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.type, 'image');
});

test('FileValidator validates WEBP headers accurately', async () => {
  // RIFF (4) + size (4) + WEBP (4)
  const webpBytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46,
    0x20, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50
  ]);
  const mockFile = {
    name: 'banner.webp',
    size: 8192,
    slice: () => ({ arrayBuffer: async () => webpBytes.buffer })
  };
  const result = await FileValidator.validateFile(mockFile);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.type, 'image');
});

test('FileValidator validates DOCX headers accurately', async () => {
  const docxBytes = new Uint8Array([0x50, 0x4B, 0x03, 0x04]);
  const mockFile = {
    name: 'document.docx',
    size: 16384,
    slice: () => ({ arrayBuffer: async () => docxBytes.buffer })
  };
  const result = await FileValidator.validateFile(mockFile);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.type, 'word');
});

test('FileValidator rejects empty 0-byte files with clear error', async () => {
  const mockFile = {
    name: 'empty.pdf',
    size: 0,
    slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) })
  };
  const result = await FileValidator.validateFile(mockFile);
  assert.strictEqual(result.valid, false);
  assert.match(result.error, /completely empty/i);
});

test('FileValidator gracefully catches and rejects legacy binary .doc files', async () => {
  // OLE2 header: D0 CF 11 E0 A1 B1 1A E1
  const docBytes = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
  const mockFile = {
    name: 'resume.doc',
    size: 8192,
    slice: () => ({ arrayBuffer: async () => docBytes.buffer })
  };
  const result = await FileValidator.validateFile(mockFile);
  assert.strictEqual(result.valid, false);
  assert.match(result.error, /legacy binary Word.*\.doc/i);
});

test('FileValidator rejects TIFF format with actionable explanation', async () => {
  const tiffBytes = new Uint8Array([0x49, 0x49, 0x2A, 0x00]);
  const mockFile = {
    name: 'scan.tiff',
    size: 8192,
    slice: () => ({ arrayBuffer: async () => tiffBytes.buffer })
  };
  const result = await FileValidator.validateFile(mockFile);
  assert.strictEqual(result.valid, false);
  assert.match(result.error, /TIFF image format is not natively decodable/i);
});

// ── Test 6: ResourceManager Lifecycle & Memory Protection ───────
test('ResourceManager tracks and revokes object URLs without leaks', () => {
  const blob1 = new Blob(['sample data 1'], { type: 'text/plain' });
  const blob2 = new Blob(['sample data 2'], { type: 'text/plain' });

  const url1 = ResourceManager.createUrl(blob1);
  const url2 = ResourceManager.createUrl(blob2);

  assert.strictEqual(ResourceManager.activeUrls.size, 2);
  assert.ok(ResourceManager.activeUrls.has(url1));
  assert.ok(ResourceManager.activeUrls.has(url2));

  ResourceManager.revokeUrl(url1);
  assert.strictEqual(ResourceManager.activeUrls.size, 1);
  assert.strictEqual(ResourceManager.activeUrls.has(url1), false);

  ResourceManager.revokeAllUrls();
  assert.strictEqual(ResourceManager.activeUrls.size, 0);
});

test('ResourceManager handles AbortController cancellation safely', () => {
  const controller = ResourceManager.createAbortController();
  assert.strictEqual(controller.signal.aborted, false);

  ResourceManager.abortCurrent();
  assert.strictEqual(controller.signal.aborted, true);
  assert.strictEqual(ResourceManager.activeAbortController, null);
});

console.log('Automated test suite loaded.');
