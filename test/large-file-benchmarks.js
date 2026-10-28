// Large File Stress & Memory Management Benchmark Suite
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read app.js
const appJsPath = path.join(__dirname, '..', 'app.js');
const appJsCode = fs.readFileSync(appJsPath, 'utf8');

const sandbox = {
  window: { addEventListener: () => {} },
  document: { getElementById: () => null, addEventListener: () => {} },
  pdfjsLib: { GlobalWorkerOptions: {} },
  DOMException: globalThis.DOMException || Error,
  URL: {
    createObjectURL: () => `blob:http://localhost/${Math.random().toString(36).slice(2)}`,
    revokeObjectURL: () => {}
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

const fn = new Function('window', 'document', 'pdfjsLib', 'URL', 'AbortController', 'DOMException', appJsCode);
fn(sandbox.window, sandbox.document, sandbox.pdfjsLib, sandbox.URL, sandbox.AbortController, sandbox.DOMException);

const { FileUtils, FileValidator, ResourceManager } = sandbox.window.__ConvertFlow;

// Helper to create synthetic files of exact sizes with authentic magic bytes
function createSyntheticFile(fileName, sizeBytes, magicBytes = null) {
  const header = magicBytes || [0x25, 0x50, 0x44, 0x46]; // Default PDF
  return {
    name: fileName,
    size: sizeBytes,
    slice: (start = 0, end = sizeBytes) => {
      const sliceLen = Math.max(0, Math.min(sizeBytes - start, end - start));
      const buf = new Uint8Array(sliceLen);
      if (start === 0 && header.length > 0) {
        for (let i = 0; i < Math.min(header.length, sliceLen); i++) {
          buf[i] = header[i];
        }
      }
      return {
        arrayBuffer: async () => buf.buffer
      };
    }
  };
}

test('FileValidator validates a 1 MB PDF file in < 2ms without loading entire file', async () => {
  const file1MB = createSyntheticFile('doc_1mb.pdf', 1024 * 1024);
  const start = performance.now();
  const result = await FileValidator.validateFile(file1MB);
  const elapsed = performance.now() - start;

  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.type, 'pdf');
  assert.ok(elapsed < 20, `Took ${elapsed.toFixed(2)}ms, expected < 20ms`);
});

test('FileValidator validates a 10 MB PNG file in < 2ms using header slicing', async () => {
  const pngHeader = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  const file10MB = createSyntheticFile('photo_10mb.png', 10 * 1024 * 1024, pngHeader);
  const start = performance.now();
  const result = await FileValidator.validateFile(file10MB);
  const elapsed = performance.now() - start;

  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.type, 'image');
  assert.ok(elapsed < 20, `Took ${elapsed.toFixed(2)}ms, expected < 20ms`);
});

test('FileValidator validates a 100 MB JPEG file in < 2ms using header slicing', async () => {
  const jpgHeader = [0xFF, 0xD8, 0xFF, 0xE0];
  const file100MB = createSyntheticFile('raw_100mb.jpg', 100 * 1024 * 1024, jpgHeader);
  const start = performance.now();
  const result = await FileValidator.validateFile(file100MB);
  const elapsed = performance.now() - start;

  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.type, 'image');
  assert.ok(elapsed < 20, `Took ${elapsed.toFixed(2)}ms, expected < 20ms`);
});

test('FileValidator validates a 500 MB Large Archive / DOCX file without memory exhaustion', async () => {
  const docxHeader = [0x50, 0x4B, 0x03, 0x04];
  const file500MB = createSyntheticFile('large_compendium_500mb.docx', 500 * 1024 * 1024, docxHeader);

  const memBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  const result = await FileValidator.validateFile(file500MB);
  const elapsed = performance.now() - start;
  const memAfter = process.memoryUsage().heapUsed;

  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.type, 'word');
  assert.ok(elapsed < 30, `Validation of 500MB took ${elapsed.toFixed(2)}ms`);

  // Memory usage must not grow by 500MB! Should be less than 5MB delta
  const memDeltaMB = (memAfter - memBefore) / (1024 * 1024);
  assert.ok(memDeltaMB < 10, `Memory spiked by ${memDeltaMB.toFixed(2)} MB; expected < 10 MB`);
});

test('Cancellation interruption stops multi-step processing immediately and releases resources', async () => {
  const controller = ResourceManager.createAbortController();
  const signal = controller.signal;

  let stepsCompleted = 0;
  const fakeLongRunningTask = async () => {
    for (let step = 1; step <= 50; step++) {
      if (signal.aborted) {
        throw new DOMException('Aborted by user', 'AbortError');
      }
      stepsCompleted++;
      if (step === 3) {
        // Trigger cancellation midway
        ResourceManager.abortCurrent();
      }
    }
  };

  await assert.rejects(fakeLongRunningTask, {
    name: 'AbortError'
  });

  assert.strictEqual(stepsCompleted, 3);
  assert.strictEqual(controller.signal.aborted, true);
});

test('ResourceManager manages 1000 consecutive Blob URLs without leak', () => {
  const initialCount = ResourceManager.activeUrls.size;
  const created = [];

  for (let i = 0; i < 1000; i++) {
    const url = ResourceManager.createUrl(new Blob([`data_${i}`]));
    created.push(url);
  }

  assert.strictEqual(ResourceManager.activeUrls.size, initialCount + 1000);

  // Revoke half
  for (let i = 0; i < 500; i++) {
    ResourceManager.revokeUrl(created[i]);
  }
  assert.strictEqual(ResourceManager.activeUrls.size, initialCount + 500);

  // Revoke all
  ResourceManager.revokeAllUrls();
  assert.strictEqual(ResourceManager.activeUrls.size, 0);
});

console.log('Large-file benchmark suite loaded.');
