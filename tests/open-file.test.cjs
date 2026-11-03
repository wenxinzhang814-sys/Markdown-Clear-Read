const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Exercise the real HTA script through its UI handlers. ActiveX and FileReader
// are replaced only at the host boundary, so no Windows associations are changed.
const hta = fs.readFileSync(path.join(__dirname, '..', 'reader.hta'), 'utf8');
const script = [...hta.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).join('\n');

function createApp({ files = {}, initialPath = '' } = {}) {
  const alerts = [], activeXReads = [], readerReads = [], pending = [];
  const entries = new Map(Object.entries(files));
  const elements = {};

  function element(id = '') {
    const classes = new Set();
    return {
      id, textContent: '', innerHTML: '', value: '', files: [], children: [],
      clicks: 0,
      classList: {
        add(name) { classes.add(name); },
        contains(name) { return classes.has(name); },
        toggle(name) { classes.has(name) ? classes.delete(name) : classes.add(name); },
      },
      click() { this.clicks++; },
      appendChild(child) { this.children.push(child); },
      querySelectorAll() {
        return [...this.innerHTML.matchAll(/<(h[123])\b[^>]*>([\s\S]*?)<\/\1>/gi)]
          .map(match => ({ tagName: match[1].toUpperCase(),
            textContent: match[2].replace(/<[^>]*>/g, '') }));
      },
      querySelector() { return { firstChild: {}, innerText: this.innerHTML }; },
      get innerText() { return this.innerHTML.replace(/<[^>]*>/g, ''); },
    };
  }

  const document = {
    body: element('body'), title: '清阅 Markdown',
    getElementById(id) { return elements[id] || (elements[id] = element(id)); },
    createElement() { return element(); },
    createRange() { return { selectNodeContents() {} }; },
  };
  document.getElementById('paper').innerHTML = '<div class="empty">未打开文档</div>';
  document.getElementById('filename').textContent = '未打开文档';

  function ActiveXObject(type) {
    assert.equal(type, 'ADODB.Stream', 'unexpected native host call');
    this.Open = () => {};
    this.Close = () => {};
    this.LoadFromFile = filePath => {
      activeXReads.push(filePath);
      if (!entries.has(filePath)) throw new Error('File not found: ' + filePath);
      this.bytes = Buffer.from(entries.get(filePath));
    };
    this.Read = () => [...this.bytes];
    this.ReadText = () => {
      const charset = { unicode: 'utf-16le', unicodeFFFE: 'utf-16be' }[this.Charset]
        || this.Charset;
      return new TextDecoder(charset).decode(this.bytes);
    };
  }

  function FileReader() {
    this.readAsText = (file, encoding = 'utf-8') => {
      readerReads.push({ name: file.name, encoding });
      pending.push(() => {
        if (file.error) {
          this.error = new Error('Read denied');
          if (this.onerror) this.onerror({ target: this });
          return;
        }
        this.result = new TextDecoder(encoding).decode(file.bytes);
        if (this.onload) this.onload({ target: this });
      });
    };
  }

  const context = {
    document, location: { search: initialPath ? '?' + encodeURIComponent(initialPath) : '' },
    localStorage: {}, alert: message => alerts.push(String(message)), prompt: () => null,
    ActiveXObject, FileReader,
    VBArray: function VBArray(bytes) { this.toArray = () => bytes; },
    console, setTimeout, clearTimeout,
  };
  context.window = context;
  context.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
  vm.runInNewContext(script, context, { filename: 'reader.hta' });

  return {
    elements, document, alerts, activeXReads, readerReads,
    choose(file, nativePath = '', { defer = false } = {}) {
      const input = document.getElementById('fileInput');
      input.files = file ? [file] : [];
      input.value = nativePath;
      input.onchange({ target: input });
      if (!defer) this.flush();
    },
    drop(file, nativeUri = '', { defer = false } = {}) {
      let prevented = false;
      document.ondrop({ preventDefault() { prevented = true; },
        dataTransfer: { files: file ? [file] : [], getData() { return nativeUri; } } });
      assert.ok(prevented, 'dropping a file must not navigate away from the reader');
      if (!defer) this.flush();
    },
    flushOne(index = 0) {
      assert.ok(index >= 0 && index < pending.length, 'requested pending read must exist');
      pending.splice(index, 1)[0]();
    },
    flush() {
      let limit = 20;
      while (pending.length && --limit) pending.shift()();
      assert.ok(limit, 'unexpected endless FileReader retries');
    },
    current() {
      return { html: elements.paper.innerHTML, name: elements.filename.textContent };
    },
  };
}

function file(name, text, extra = {}) {
  return { name, bytes: Buffer.from(text, 'utf8'), ...extra };
}

test('the open button and Ctrl+O invoke a file picker', () => {
  const app = createApp();
  app.elements.openBtn.onclick();
  let prevented = false;
  app.document.onkeydown({ ctrlKey: true, keyCode: 79,
    preventDefault() { prevented = true; } });
  assert.equal(app.elements.fileInput.clicks, 2);
  assert.ok(prevented);
});

test('native selection opens a Chinese path with spaces and #%&+ intact', () => {
  const selectedPath = 'C:\\分享 目录\\中文#%&+.md';
  const app = createApp({ files: { [selectedPath]: Buffer.from('# 原生选择\n正文') } });
  app.choose(file('中文#%&+.md', 'ignored'), selectedPath);
  assert.match(app.current().html, /<h1>原生选择<\/h1>/);
  assert.equal(app.current().name, '中文#%&+.md');
  assert.ok(app.activeXReads.every(value => value === selectedPath));
  assert.equal(app.readerReads.length, 0);
});

test('launch query decodes a complete path without treating #%&+ as URL syntax', () => {
  const initialPath = 'C:\\中文 空格\\文件#%&+.markdown';
  const app = createApp({ initialPath,
    files: { [initialPath]: Buffer.from('# 从启动参数打开') } });
  assert.match(app.current().html, /从启动参数打开/);
  assert.equal(app.current().name, '文件#%&+.markdown');
});

test('fakepath selection reads the selected File rather than attempting ActiveX fakepath', () => {
  const app = createApp();
  app.choose(file('上传 中文.md', '# 文件选择回退\n中文内容'), 'C:\\fakepath\\上传 中文.md');
  assert.match(app.current().html, /文件选择回退/);
  assert.match(app.current().html, /中文内容/);
  assert.equal(app.current().name, '上传 中文.md');
  assert.equal(app.activeXReads.length, 0);
  assert.equal(app.readerReads.length, 1);
});

test('dropping a File without a native path displays its contents', () => {
  const app = createApp();
  app.drop(file('拖放文件.md', '# 拖放成功\n新正文'));
  assert.match(app.current().html, /<h1>拖放成功<\/h1>/);
  assert.equal(app.current().name, '拖放文件.md');
  assert.equal(app.readerReads.length, 1);
});

test('legacy Chinese text retries FileReader with GB18030 after UTF-8 decode failure', () => {
  const app = createApp();
  app.drop({ name: '中文编码.md', bytes: Buffer.from([0x23, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0x0a]) });
  assert.match(app.current().html, /<h1>中文<\/h1>/);
  assert.equal(app.readerReads.length, 2);
  assert.equal(app.readerReads[1].encoding.toLowerCase(), 'gb18030');
});

test('canceling a file picker preserves the current document and filename', () => {
  const app = createApp();
  app.drop(file('保持.md', '# 保持原文'));
  const before = app.current(), alertCount = app.alerts.length;
  app.choose(null);
  assert.deepEqual(app.current(), before);
  assert.equal(app.alerts.length, alertCount, 'cancel is not a read error');
});

test('opening two successive files updates both content and displayed filename', () => {
  const app = createApp();
  app.drop(file('第一份.md', '# 第一份正文'));
  app.drop(file('第二份.markdown', '# 第二份正文'));
  assert.equal(app.current().name, '第二份.markdown');
  assert.match(app.current().html, /第二份正文/);
  assert.doesNotMatch(app.current().html, /第一份正文/);
});

test('a native read failure preserves the already displayed document', () => {
  const app = createApp();
  app.drop(file('保留.md', '# 应保留的正文'));
  const before = app.current();
  app.choose(null, 'C:\\missing\\不存在.md');
  assert.deepEqual(app.current(), before);
  assert.ok(app.alerts.length || /失败|无法/.test(app.elements.status.textContent),
    'read failures must be visible');
});

test('a FileReader failure preserves the already displayed document', () => {
  const app = createApp();
  app.drop(file('保留.md', '# 应保留的正文'));
  const before = app.current();
  app.drop(file('无权限.md', '', { error: true }));
  assert.deepEqual(app.current(), before);
  assert.ok(app.alerts.length || /失败|无法/.test(app.elements.status.textContent),
    'read failures must be visible');
});

test('a late FileReader result cannot replace a newer native file selection', () => {
  const newestPath = 'C:\\分享\\最新文件.md';
  const app = createApp({ files: { [newestPath]: Buffer.from('# 最新正文') } });
  app.drop(file('旧异步文件.md', '# 迟到的旧正文'), '', { defer: true });
  app.choose(file('最新文件.md', 'ignored'), newestPath, { defer: true });
  const newest = app.current();
  assert.equal(newest.name, '最新文件.md');
  app.flushOne();
  assert.deepEqual(app.current(), newest);
  assert.equal(app.alerts.length, 0);
});

test('a late FileReader error does not report an error for an obsolete file', () => {
  const newestPath = 'C:\\分享\\读取成功.md';
  const app = createApp({ files: { [newestPath]: Buffer.from('# 成功的当前正文') } });
  app.drop(file('旧读取错误.md', '', { error: true }), '', { defer: true });
  app.choose(null, newestPath, { defer: true });
  const newest = app.current(), newestStatus = app.elements.status.textContent;
  app.flushOne();
  assert.deepEqual(app.current(), newest);
  assert.equal(app.elements.status.textContent, newestStatus);
  assert.equal(app.alerts.length, 0);
});

test('out-of-order FileReader completions keep the most recently requested file', () => {
  const app = createApp();
  app.drop(file('第一请求.md', '# 第一请求的正文'), '', { defer: true });
  app.drop(file('第二请求.md', '# 第二请求的正文'), '', { defer: true });
  app.flushOne(1);
  const newest = app.current();
  assert.equal(newest.name, '第二请求.md');
  assert.match(newest.html, /第二请求的正文/);
  app.flushOne(0);
  assert.deepEqual(app.current(), newest);
});

test('a pending legacy-encoding retry cannot replace a newer file', () => {
  const app = createApp();
  app.drop({ name: '旧中文编码.md', bytes: Buffer.from([0x23, 0x20, 0xd6, 0xd0, 0xce, 0xc4]) },
    '', { defer: true });
  app.flushOne(); // UTF-8 completion schedules the GB18030 retry.
  assert.equal(app.readerReads.length, 2);
  app.drop(file('后打开.md', '# 后打开的正文'), '', { defer: true });
  app.flushOne(1);
  const newest = app.current();
  assert.equal(newest.name, '后打开.md');
  app.flushOne(0);
  assert.deepEqual(app.current(), newest);
});

test('HTA allows a second launch to receive another file', () => {
  assert.match(hta, /\bSINGLEINSTANCE="no"/i);
});
