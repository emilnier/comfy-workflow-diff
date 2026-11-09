/*
 * ComfyUI Workflow Diff — core.js
 * Parsing, ComfyUI image metadata extraction, normalisation and diff engine.
 * Runs in the browser (window.ComfyDiffCore) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ComfyDiffCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.3.0';
  const MAX_SAFE = Number.MAX_SAFE_INTEGER;

  /* ------------------------------------------------------------------ *
   * JSON parser that keeps large integers (ComfyUI seeds) exact.
   * ------------------------------------------------------------------ */

  function parseJSONLossless(input) {
    if (typeof input !== 'string') return input;
    let text = input;
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    let i = 0;
    const n = text.length;

    function fail(msg) {
      throw new SyntaxError(msg + ' (at character ' + i + ')');
    }
    function skipWs() {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
        else break;
      }
    }
    function parseString() {
      if (text[i] !== '"') fail('Expected string');
      i++;
      let out = '';
      let start = i;
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 0x22) {
          out += text.slice(start, i);
          i++;
          return out;
        }
        if (c === 0x5c) {
          out += text.slice(start, i);
          i++;
          const esc = text[i++];
          switch (esc) {
            case '"': out += '"'; break;
            case '\\': out += '\\'; break;
            case '/': out += '/'; break;
            case 'b': out += '\b'; break;
            case 'f': out += '\f'; break;
            case 'n': out += '\n'; break;
            case 'r': out += '\r'; break;
            case 't': out += '\t'; break;
            case 'u': {
              const hex = text.slice(i, i + 4);
              if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid unicode escape');
              out += String.fromCharCode(parseInt(hex, 16));
              i += 4;
              break;
            }
            default: fail('Invalid escape sequence');
          }
          start = i;
          continue;
        }
        if (c < 0x20) fail('Control character in string');
        i++;
      }
      fail('Unterminated string');
    }
    function parseNumber() {
      const start = i;
      if (text[i] === '-') i++;
      if (i >= n) fail('Invalid number');
      if (text[i] === '0') {
        i++;
      } else if (text[i] >= '1' && text[i] <= '9') {
        i++;
        while (i < n && text[i] >= '0' && text[i] <= '9') i++;
      } else {
        fail('Invalid number');
      }
      if (text[i] === '.') {
        i++;
        if (!(text[i] >= '0' && text[i] <= '9')) fail('Invalid number');
        while (i < n && text[i] >= '0' && text[i] <= '9') i++;
      }
      if (text[i] === 'e' || text[i] === 'E') {
        i++;
        if (text[i] === '+' || text[i] === '-') i++;
        if (!(text[i] >= '0' && text[i] <= '9')) fail('Invalid number');
        while (i < n && text[i] >= '0' && text[i] <= '9') i++;
      }
      const token = text.slice(start, i);
      if (/^-?\d+$/.test(token)) {
        const asNumber = Number(token);
        if (Number.isSafeInteger(asNumber)) return asNumber;
        try { return BigInt(token); } catch (_) { return asNumber; }
      }
      return Number(token);
    }
    function parseValue() {
      skipWs();
      const c = text[i];
      if (c === '"') return parseString();
      if (c === '{') {
        i++;
        const obj = Object.create(null);
        skipWs();
        if (text[i] === '}') { i++; return obj; }
        while (true) {
          skipWs();
          const key = parseString();
          skipWs();
          if (text[i] !== ':') fail('Expected ":"');
          i++;
          obj[key] = parseValue();
          skipWs();
          if (text[i] === ',') { i++; continue; }
          if (text[i] === '}') { i++; return obj; }
          fail('Expected "," or "}"');
        }
      }
      if (c === '[') {
        i++;
        const arr = [];
        skipWs();
        if (text[i] === ']') { i++; return arr; }
        while (true) {
          arr.push(parseValue());
          skipWs();
          if (text[i] === ',') { i++; continue; }
          if (text[i] === ']') { i++; return arr; }
          fail('Expected "," or "]"');
        }
      }
      if (text.startsWith('true', i)) { i += 4; return true; }
      if (text.startsWith('false', i)) { i += 5; return false; }
      if (text.startsWith('null', i)) { i += 4; return null; }
      if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
      fail('Unexpected token');
    }

    const value = parseValue();
    skipWs();
    if (i !== n) fail('Unexpected trailing content');
    return value;
  }

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function isEmptyObject(v) {
    return isPlainObject(v) && Object.keys(v).length === 0;
  }

  function uniqueWarnings(list) {
    const out = [];
    const seen = new Set();
    for (const item of list || []) {
      const s = String(item || '').trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  function canonical(v) {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'bigint') return 'bigint:' + v.toString();
    if (t === 'number') {
      if (Number.isNaN(v)) return 'number:NaN';
      if (v === Infinity) return 'number:Infinity';
      if (v === -Infinity) return 'number:-Infinity';
      return 'number:' + String(v);
    }
    if (t === 'string') return 'string:' + JSON.stringify(v);
    if (t === 'boolean') return 'boolean:' + v;
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (t === 'object') {
      const keys = Object.keys(v).sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
    }
    return t + ':' + String(v);
  }

  function valuesEqual(a, b) {
    return canonical(a) === canonical(b);
  }

  function toJSONSafe(v) {
    if (typeof v === 'bigint') return v.toString();
    if (Array.isArray(v)) return v.map(toJSONSafe);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = toJSONSafe(v[k]);
      return out;
    }
    return v;
  }

  function stringifyForDisplay(v, pretty) {
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'string') return v;
    if (v === undefined) return '—';
    try {
      return JSON.stringify(toJSONSafe(v), null, pretty ? 2 : 0);
    } catch (_) {
      return String(v);
    }
  }

  function truncate(str, max) {
    if (str == null) return '';
    str = String(str);
    if (str.length <= max) return str;
    return str.slice(0, Math.max(0, max - 1)) + '…';
  }

  function oneLine(v, max) {
    let s = stringifyForDisplay(v, false);
    s = s.replace(/\r\n/g, '\n').replace(/\n/g, ' ⏎ ').replace(/\s+/g, ' ').trim();
    return truncate(s, max || 120);
  }

  /* ------------------------------------------------------------------ *
   * Human labels
   * ------------------------------------------------------------------ */

  const PARAM_LABELS = {
    seed: '种子',
    noise_seed: '噪声种子',
    seed_value: '种子',
    steps: '步数',
    cfg: 'CFG 强度',
    sampler_name: '采样器',
    sampler: '采样器',
    scheduler: '调度器',
    scheduler_name: '调度器',
    denoise: '降噪强度',
    control_after_generate: '生成后控制',
    add_noise: '添加噪声',
    start_at_step: '起始步',
    end_at_step: '结束步',
    return_with_leftover_noise: '返回剩余噪声',
    text: '文本',
    positive: '正向提示词',
    negative: '负向提示词',
    width: '宽度',
    height: '高度',
    batch_size: '批次大小',
    ckpt_name: '模型文件',
    unet_name: 'UNET 模型',
    vae_name: 'VAE 模型',
    clip_name: 'CLIP 模型',
    lora_name: 'LoRA 文件',
    strength_model: '模型强度',
    strength_clip: '文本强度',
    strength: '强度',
    filename_prefix: '文件名前缀',
    filename: '文件名',
    path: '保存路径',
    extension: '图片格式',
    modelname: '模型名',
    clip_skip: 'CLIP Skip',
    vae: 'VAE',
    time_format: '时间格式',
    save_workflow_as_json: '另存工作流 JSON',
    embed_workflow: '内嵌工作流',
    additional_hashes: '附加哈希',
    download_civitai_data: '下载 Civitai 数据',
    easy_remix: 'Easy Remix',
    show_preview: '显示预览',
    custom: '自定义文本',
    label: '标签',
    lossless_webp: '无损 WebP',
    quality_jpeg_or_webp: 'JPEG/WebP 质量',
    optimize_png: '优化 PNG',
    counter: '计数器',
    image: '图像',
    images: '图像',
    upscale_by: '放大倍数',
    upscale_model_name: '放大模型',
    mode_type: '分块模式',
    tile_width: '分块宽度',
    tile_height: '分块高度',
    mask_blur: '遮罩模糊',
    tile_padding: '分块边距',
    seam_fix_mode: '接缝修复模式',
    seam_fix_denoise: '接缝降噪',
    seam_fix_width: '接缝宽度',
    seam_fix_mask_blur: '接缝遮罩模糊',
    seam_fix_padding: '接缝边距',
    force_uniform_tiles: '强制统一分块',
    tiled_decode: '分块解码',
    tiled_encode: '分块编码',
    bbox_threshold: '检测阈值',
    bbox_dilation: '检测框膨胀',
    bbox_crop_factor: '检测框裁剪倍数',
    guide_size: '引导尺寸',
    guide_size_for: '引导尺寸参照',
    max_size: '最大尺寸',
    feather: '羽化',
    noise_mask: '噪声遮罩',
    force_inpaint: '强制重绘',
    inpaint_model: '重绘模型',
    wildcard: '通配符',
    wildcard_text: '通配符文本',
    populated_text: '填充后提示词',
    mode: '填充模式',
    expression: '表达式',
    id: '节点 ID',
    widget_name: '控件名',
    return_all: '返回全部',
    node_title: '节点标题',
    allowed_float_decimals: '浮点小数位',
    low_threshold: '低阈值',
    high_threshold: '高阈值',
    method: '方法',
    multithread: '多线程',
    resize_type: '缩放方式',
    'resize_type.scale': '缩放倍率',
    image_encoding: '图像编码',
    quality: '质量',
    version: '版本',
    scheduler_func_opt: '调度函数',
    refiner_ratio: '细化比例',
    cycle: '循环次数',
    drop_size: '丢弃尺寸',
    sam_detection_hint: 'SAM 检测提示',
    sam_dilation: 'SAM 膨胀',
    sam_threshold: 'SAM 阈值',
    sam_bbox_expansion: 'SAM 框扩展',
    sam_mask_hint_threshold: 'SAM 遮罩提示阈值',
    sam_mask_hint_use_negative: 'SAM 使用负提示',
    noise_mask_feather: '噪声遮罩羽化',
    resize_mode: '缩放模式',
    crop: '裁剪',
    interpolation: '插值',
    crop_position: '裁剪位置',
    sharpening: '锐化',
    'Select to add LoRA': '添加 LoRA',
    'Select to add Wildcard': '添加通配符',
    'rgthree_comparer': '对比器状态'
  };

  const TYPE_LABELS = {
    KSampler: '采样器',
    KSamplerAdvanced: '高级采样器',
    SamplerCustom: '自定义采样器',
    CLIPTextEncode: '文本编码',
    CheckpointLoaderSimple: '模型加载',
    CheckpointLoader: '模型加载',
    UNETLoader: 'UNET 加载',
    VAELoader: 'VAE 加载',
    CLIPLoader: 'CLIP 加载',
    LoraLoader: 'LoRA 加载',
    LoraLoaderModelOnly: 'LoRA 加载（仅模型）',
    EmptyLatentImage: '空 Latent',
    VAEDecode: 'VAE 解码',
    VAEEncode: 'VAE 编码',
    SaveImage: '保存图片',
    PreviewImage: '预览图片',
    LoadImage: '加载图片',
    ImageScale: '图像缩放',
    ImageScaleBy: '按比例缩放',
    ImageResizeKJv2: '图像缩放 KJ',
    UpscaleModelLoader: '放大模型加载',
    UltimateSDUpscale: 'Ultimate SD 放大',
    FaceDetailerPipe: '面部细节修复',
    DetailerForEach: '逐块细节修复',
    ImpactWildcardProcessor: '通配符提示词',
    ImpactSwitch: '输入切换',
    Note: '备注',
    Reroute: '转接点',
    Reroute$1: '转接点',
    PrimitiveInt: '整数',
    PrimitiveFloat: '浮点数',
    PrimitiveBoolean: '布尔值',
    PrimitiveString: '字符串',
    'easy int': '整数',
    'easy float': '浮点数',
    'easy showAnything': '任意值显示',
    'Image Comparer (rgthree)': '图像对比器',
    'Fast Groups Bypasser (rgthree)': '快速组旁路',
    'Image Saver': '图片保存器',
    'Input Parameters (Image Saver)': '生成参数输入',
    'Lora Loader (LoraManager)': 'LoRA 管理',
    'TriggerWord Toggle (LoraManager)': '触发词开关',
    ComfyMathExpression: '数学表达式',
    MathExpression$1: '数学表达式',
    StringConcatenate: '字符串拼接',
    RegexReplace: '正则替换',
    ControlNetApplyAdvanced: 'ControlNet 应用',
    ControlNetLoader: 'ControlNet 加载',
    Canny: 'Canny 边缘',
    GetImageSize: '获取图像尺寸',
    ImageToMask: '图像转遮罩',
    MaskToSEGS: '遮罩转 SEGS',
    ColorMatchV2: '颜色匹配',
    RTXVideoSuperResolution: 'RTX 超分',
    ImageQuantize: '图像量化',
    ImageSharpen: '图像锐化',
    'SAMLoader': 'SAM 加载',
    'UltralyticsDetectorProvider': '检测器',
    'ImpactWildcardProcessor': '通配符处理'
  };

  function humanizeKey(key) {
    if (!key) return '参数';
    return String(key)
      .replace(/\./g, ' / ')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function paramLabel(key, localized) {
    if (PARAM_LABELS[key]) return PARAM_LABELS[key];
    if (localized && /[\u3400-\u9fff]/.test(localized)) return localized;
    return humanizeKey(key);
  }

  function typeLabel(type) {
    if (!type) return '未知节点';
    if (TYPE_LABELS[type]) return TYPE_LABELS[type];
    // Some custom nodes suffix their class name with $1 in LiteGraph dumps.
    if (TYPE_LABELS[type.replace(/\$\d+$/, '')]) {
      return TYPE_LABELS[type.replace(/\$\d+$/, '')];
    }
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(type)) return '子图';
    return type;
  }

  const MODE_LABELS = {
    0: '正常',
    1: '事件触发',
    2: '静音',
    3: '触发',
    4: 'Bypass'
  };

  function modeLabel(mode) {
    return MODE_LABELS[Number(mode) || 0] || ('模式 ' + mode);
  }

  function isBypassed(mode) {
    return Number(mode) === 4;
  }

  function isMuted(mode) {
    return Number(mode) === 2;
  }

  /* ------------------------------------------------------------------ *
   * Workflow normalisation
   * ------------------------------------------------------------------ */

  function asId(v) {
    return String(v);
  }

  function nodeCenter(node) {
    const x = Number(node.pos?.[0] ?? node.x ?? 0);
    const y = Number(node.pos?.[1] ?? node.y ?? 0);
    const w = Number(node.size?.[0] ?? node.w ?? 220);
    const h = Number(node.size?.[1] ?? node.h ?? 100);
    return [x + (Number.isFinite(w) ? w : 220) / 2, y + (Number.isFinite(h) ? h : 100) / 2];
  }

  function findGroupForNode(node, groups) {
    if (!groups || !groups.length) return null;
    const [cx, cy] = nodeCenter(node);
    // ComfyUI groups are visual regions. A collapsed node can be much taller than
    // the box the user perceives, so prefer the group containing the node's
    // top-left corner (its title bar) and fall back to the centre.
    const candidates = [
      [Number(node.pos?.[0] ?? node.x ?? 0) + 4, Number(node.pos?.[1] ?? node.y ?? 0) + 8],
      [cx, cy]
    ];
    for (const [px, py] of candidates) {
      let best = null;
      let bestArea = Infinity;
      for (const g of groups) {
        const b = g.bounding || [g.x, g.y, g.w, g.h];
        if (!b || b.length < 4) continue;
        const x = Number(b[0]), y = Number(b[1]), w = Number(b[2]), h = Number(b[3]);
        if (![x, y, w, h].every(Number.isFinite)) continue;
        if (px >= x && px <= x + w && py >= y && py <= y + h) {
          const area = Math.abs(w * h);
          if (area < bestArea) {
            bestArea = area;
            best = g;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  function normaliseGroups(workflow) {
    const raw = Array.isArray(workflow?.groups) ? workflow.groups : [];
    return raw.map((g, index) => {
      const b = Array.isArray(g.bounding) ? g.bounding : [g.x, g.y, g.w, g.h];
      return {
        id: String(g.id ?? index),
        title: String(g.title || '未命名组'),
        x: Number(b?.[0] ?? 0),
        y: Number(b?.[1] ?? 0),
        w: Number(b?.[2] ?? 0),
        h: Number(b?.[3] ?? 0),
        color: g.color || '#3f789e',
        raw: g
      };
    }).filter(g => [g.x, g.y, g.w, g.h].every(Number.isFinite));
  }

  const CONTROL_VALUES = new Set(['fixed', 'randomize', 'increment', 'decrement']);

  const WIDGET_NAMES = {
    KSampler: ['seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
    KSamplerAdvanced: ['add_noise', 'noise_seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'start_at_step', 'end_at_step', 'return_with_leftover_noise'],
    RandomNoise: ['noise_seed', 'control_after_generate'],
    CheckpointLoaderSimple: ['ckpt_name'],
    CheckpointLoader: ['config_name', 'ckpt_name'],
    UNETLoader: ['unet_name', 'weight_dtype'],
    VAELoader: ['vae_name'],
    CLIPLoader: ['clip_name', 'type'],
    LoraLoader: ['lora_name', 'strength_model', 'strength_clip'],
    LoraLoaderModelOnly: ['lora_name', 'strength_model'],
    CLIPTextEncode: ['text'],
    EmptyLatentImage: ['width', 'height', 'batch_size'],
    SaveImage: ['filename_prefix'],
    LoadImage: ['image', 'upload'],
    ImageScale: ['upscale_method', 'width', 'height', 'crop'],
    ImageScaleBy: ['upscale_method', 'scale_by'],
    UpscaleModelLoader: ['model_name'],
    UltimateSDUpscale: ['upscale_by', 'seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise', 'mode_type', 'tile_width', 'tile_height', 'mask_blur', 'tile_padding', 'seam_fix_mode', 'seam_fix_denoise', 'seam_fix_width', 'seam_fix_mask_blur', 'seam_fix_padding', 'force_uniform_tiles', 'tiled_decode', 'batch_size'],
    ImageResizeKJv2: ['width', 'height', 'upscale_method', 'keep_proportion', 'pad_color', 'crop_position', 'divisible_by', 'device'],
    FaceDetailerPipe: ['guide_size', 'guide_size_for', 'max_size', 'seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise', 'feather', 'noise_mask', 'force_inpaint', 'bbox_threshold', 'bbox_dilation', 'bbox_crop_factor', 'sam_detection_hint', 'sam_dilation', 'sam_threshold', 'sam_bbox_expansion', 'sam_mask_hint_threshold', 'sam_mask_hint_use_negative', 'drop_size', 'refiner_ratio', 'cycle', 'inpaint_model', 'noise_mask_feather', 'tiled_encode', 'tiled_decode'],
    Canny: ['low_threshold', 'high_threshold'],
    GetImageSize: [],
    ImageToMask: ['channel'],
    ColorMatchV2: ['method', 'strength', 'multithread']
  };

  function shouldIgnoreParamKey(key) {
    if (!key) return true;
    if (String(key).startsWith('__')) return true;
    if (/autocomplete|meta_text|lastAccepted|textSnapshot/i.test(String(key))) return true;
    return false;
  }

  function isComparerNode(type) {
    return /Image Comparer|rgthree_comparer/i.test(String(type));
  }

  function findInput(node, name) {
    if (!Array.isArray(node?.inputs)) return null;
    return node.inputs.find(inp => inp && (inp.name === name || inp.localized_name === name)) || null;
  }

  function widgetNameList(node) {
    const values = node?.widgets_values;
    if (!Array.isArray(values)) return [];
    if (WIDGET_NAMES[node.type]) return WIDGET_NAMES[node.type].slice(0, values.length);

    const names = [];
    const labels = [];
    for (const inp of node.inputs || []) {
      if (inp && inp.widget && inp.widget.name) {
        names.push(inp.widget.name);
        labels.push(inp.localized_name || inp.label || inp.widget.name);
      }
    }
    if (names.length === values.length) return names;
    if (!names.length) return [];

    // Classic KSampler-style arrays contain control_after_generate, which is not
    // present in node.inputs. Detect it and splice the synthetic widget name in.
    const out = [];
    let vi = 0;
    for (let ni = 0; ni < names.length && vi < values.length; ni++) {
      out.push(names[ni]);
      vi++;
      if ((names[ni] === 'seed' || names[ni] === 'noise_seed') &&
          vi < values.length && CONTROL_VALUES.has(String(values[vi]))) {
        out.push('control_after_generate');
        vi++;
      }
    }
    while (out.length < values.length) out.push('param_' + (out.length + 1));
    return out;
  }

  function extractParamsFromNamed(node, named) {
    const params = [];
    const inputLabels = {};
    for (const inp of node.inputs || []) {
      if (inp && inp.widget?.name) inputLabels[inp.widget.name] = inp.localized_name || inp.label;
    }
    let order = 0;
    for (const key of Object.keys(named)) {
      if (shouldIgnoreParamKey(key)) continue;
      const value = named[key];
      if (typeof value === 'function') continue;
      params.push({
        key,
        label: paramLabel(key, inputLabels[key]),
        localized: inputLabels[key] || '',
        value,
        order: order++
      });
    }
    return params;
  }

  function extractParamsFromArray(node, values) {
    const names = widgetNameList(node);
    const params = [];
    const inputLabels = {};
    for (const inp of node.inputs || []) {
      if (inp && inp.widget?.name) inputLabels[inp.widget.name] = inp.localized_name || inp.label;
    }
    for (let idx = 0; idx < values.length; idx++) {
      const key = names[idx] || ('param_' + (idx + 1));
      if (shouldIgnoreParamKey(key)) continue;
      params.push({
        key,
        label: paramLabel(key, inputLabels[key]),
        localized: inputLabels[key] || '',
        value: values[idx],
        order: idx
      });
    }
    return params;
  }

  function extractWorkflowParams(node) {
    if (isComparerNode(node.type)) return [];
    const named = node.widgets_values_named;
    if (isPlainObject(named) && !isEmptyObject(named)) {
      return extractParamsFromNamed(node, named);
    }
    const values = node.widgets_values;
    if (Array.isArray(values)) return extractParamsFromArray(node, values);
    if (isPlainObject(values) && !isEmptyObject(values)) {
      return extractParamsFromNamed(node, values);
    }
    return [];
  }

  function normaliseWorkflow(workflow, prompt, meta) {
    if (!workflow || !Array.isArray(workflow.nodes)) {
      throw new Error('不是有效的 ComfyUI UI 工作流：缺少 nodes 数组');
    }
    const groups = normaliseGroups(workflow);
    const subgraphs = {};
    for (const sg of workflow.definitions?.subgraphs || []) {
      if (sg && sg.id) subgraphs[String(sg.id)] = sg;
    }
    const nodes = [];
    for (const raw of workflow.nodes) {
      if (!raw || raw.id === undefined || raw.id === null) continue;
      const id = asId(raw.id);
      const type = String(raw.type || 'Unknown');
      const customTitle = typeof raw.title === 'string' ? raw.title.trim() : '';
      const sg = subgraphs[type];
      const displayType = sg ? ('子图 · ' + (sg.name || type)) : type;
      const label = customTitle || displayType;
      const subtitle = customTitle ? displayType : (typeLabel(type) !== displayType ? typeLabel(type) : '');
      const group = findGroupForNode(raw, groups);
      const x = Number(raw.pos?.[0] ?? 0);
      const y = Number(raw.pos?.[1] ?? 0);
      const w = Number(raw.size?.[0] ?? 220);
      const h = Number(raw.size?.[1] ?? 100);
      const params = extractWorkflowParams(raw);
      const inputs = (raw.inputs || []).map(inp => ({
        name: inp?.name || '',
        label: inp?.localized_name || inp?.label || inp?.name || '',
        link: inp?.link == null ? null : asId(inp.link),
        type: inp?.type || '',
        widget: inp?.widget?.name || null
      }));
      const outputs = (raw.outputs || []).map(out => ({
        name: out?.name || '',
        label: out?.localized_name || out?.label || out?.name || '',
        type: out?.type || '',
        links: Array.isArray(out?.links) ? out.links.map(asId) : []
      }));
      nodes.push({
        id,
        type,
        customTitle,
        label,
        subtitle,
        displayType,
        mode: Number(raw.mode ?? 0),
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        w: Number.isFinite(w) ? w : 220,
        h: Number.isFinite(h) ? h : 100,
        params,
        inputs,
        outputs,
        group: group ? { id: group.id, title: group.title, color: group.color } : { id: '', title: '未分组', color: '#57606a' },
        color: raw.color || '',
        bgcolor: raw.bgcolor || '',
        raw
      });
    }

    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const linkById = new Map();
    const links = [];
    for (const l of workflow.links || []) {
      if (!Array.isArray(l) || l.length < 5) continue;
      const link = {
        id: asId(l[0]),
        source: asId(l[1]),
        sourceSlot: Number(l[2] ?? 0),
        target: asId(l[3]),
        targetSlot: Number(l[4] ?? 0),
        type: l[5] || ''
      };
      linkById.set(link.id, link);
      links.push(link);
    }

    return {
      filename: meta?.filename || '未命名工作流',
      fileType: meta?.fileType || 'json',
      container: meta?.container || 'json',
      kind: 'workflow',
      hasLayout: true,
      label: 'UI 工作流',
      workflow,
      prompt: prompt || null,
      a1111: meta?.a1111 || null,
      nodes,
      nodeById,
      groups,
      links,
      linkById,
      width: meta?.width ?? null,
      height: meta?.height ?? null,
      metadataKeys: meta?.metadataKeys || [],
      warnings: uniqueWarnings(meta?.warnings),
      rawSource: meta?.rawSource || null,
      subgraphDefs: subgraphs,
      frontendVersion: workflow.extra?.frontendVersion || '',
      workflowVersion: workflow.version ?? null
    };
  }

  function apiNodeInputs(raw) {
    const inputs = [];
    const links = [];
    for (const key of Object.keys(raw.inputs || {})) {
      const value = raw.inputs[key];
      inputs.push({
        name: key,
        label: key,
        value,
        link: null,
        type: typeof value === 'number' ? 'number' : (typeof value === 'string' ? 'string' : (Array.isArray(value) ? 'array' : typeof value)),
        widget: key
      });
    }
    return { inputs, links };
  }

  function normaliseApiPrompt(prompt, meta) {
    if (!isPlainObject(prompt)) throw new Error('不是有效的 ComfyUI API Prompt');
    const rawEntries = Object.entries(prompt).filter(([, v]) => isPlainObject(v) && v.class_type);
    if (!rawEntries.length) throw new Error('不是有效的 ComfyUI API Prompt：没有 class_type 节点');

    const nodes = [];
    for (const [id, raw] of rawEntries) {
      const type = String(raw.class_type || 'Unknown');
      const customTitle = String(raw._meta?.title || '').trim();
      const label = customTitle || typeLabel(type) || type;
      const subtitle = customTitle ? typeLabel(type) : '';
      const inputs = [];
      const params = [];
      for (const key of Object.keys(raw.inputs || {})) {
        const val = raw.inputs[key];
        const isLink = Array.isArray(val) && val.length >= 2 &&
          (typeof val[0] === 'string' || typeof val[0] === 'number') &&
          Number.isInteger(val[1]) &&
          Object.prototype.hasOwnProperty.call(prompt, asId(val[0]));
        if (isLink) {
          inputs.push({ name: key, label: key, link: null, sourceId: asId(val[0]), sourceSlot: Number(val[1]), type: 'LINK', widget: null });
        } else {
          inputs.push({ name: key, label: key, link: null, type: typeof val, widget: key });
          if (!shouldIgnoreParamKey(key)) {
            params.push({ key, label: paramLabel(key), localized: '', value: val, order: params.length });
          }
        }
      }
      nodes.push({
        id: asId(id),
        type,
        customTitle,
        label,
        subtitle,
        displayType: type,
        mode: Number(raw.mode ?? 0),
        x: 0,
        y: 0,
        w: 230,
        h: 100,
        params,
        inputs,
        outputs: [],
        group: { id: '', title: 'API Prompt（自动布局）', color: '#3f789e' },
        color: '',
        bgcolor: '',
        raw
      });
    }

    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const links = [];
    for (const node of nodes) {
      for (const inp of node.inputs) {
        if (!inp.sourceId) continue;
        const link = {
          id: 'api:' + node.id + ':' + inp.name,
          source: inp.sourceId,
          sourceSlot: inp.sourceSlot,
          target: node.id,
          targetSlot: 0,
          type: 'LINK'
        };
        inp.link = link.id;
        links.push(link);
      }
    }
    const linkById = new Map(links.map(l => [l.id, l]));
    const groups = [{ id: 'api', title: 'API Prompt（自动布局）', x: 0, y: 0, w: 0, h: 0, color: '#3f789e' }];
    autoLayout(nodes, links);
    const bounds = calcBounds(nodes);
    groups[0].x = -40;
    groups[0].y = -70;
    groups[0].w = bounds.maxX - bounds.minX + 80;
    groups[0].h = bounds.maxY - bounds.minY + 100;

    return {
      filename: meta?.filename || '未命名 API Prompt',
      fileType: meta?.fileType || 'json',
      container: meta?.container || 'json',
      kind: 'api',
      hasLayout: false,
      label: 'API Prompt（自动布局）',
      workflow: null,
      prompt,
      a1111: meta?.a1111 || null,
      nodes,
      nodeById,
      groups,
      links,
      linkById,
      width: meta?.width ?? null,
      height: meta?.height ?? null,
      metadataKeys: meta?.metadataKeys || [],
      warnings: uniqueWarnings(meta?.warnings || []),
      rawSource: meta?.rawSource || null
    };
  }

  function calcBounds(nodes) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + Math.max(40, n.w));
      maxY = Math.max(maxY, n.y + Math.max(30, n.h));
    }
    if (!nodes.length) return { minX: 0, minY: 0, maxX: 1000, maxY: 600 };
    return { minX, minY, maxX, maxY };
  }

  function autoLayout(nodes, links) {
    const byId = new Map(nodes.map(n => [n.id, n]));
    const outgoing = new Map();
    const incoming = new Map();
    for (const n of nodes) { outgoing.set(n.id, []); incoming.set(n.id, []); }
    for (const l of links) {
      if (!byId.has(l.source) || !byId.has(l.target) || l.source === l.target) continue;
      outgoing.get(l.source).push(l.target);
      incoming.get(l.target).push(l.source);
    }
    const level = new Map(nodes.map(n => [n.id, 0]));
    const indeg = new Map(nodes.map(n => [n.id, incoming.get(n.id).length]));
    const queue = nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id);
    const visited = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      for (const target of outgoing.get(id)) {
        level.set(target, Math.max(level.get(target), level.get(id) + 1));
        indeg.set(target, indeg.get(target) - 1);
        if (indeg.get(target) === 0) queue.push(target);
      }
    }
    // Cycles: keep remaining nodes at their current level.
    nodes.forEach((n, idx) => {
      if (!visited.has(n.id)) level.set(n.id, Math.min(8, Math.floor(idx / 6)));
    });
    const byLevel = new Map();
    for (const n of nodes) {
      const l = level.get(n.id) || 0;
      if (!byLevel.has(l)) byLevel.set(l, []);
      byLevel.get(l).push(n);
    }
    const gapX = 90;
    const gapY = 42;
    const widths = new Map();
    for (const [l, arr] of byLevel) {
      arr.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      let y = 0;
      for (const n of arr) {
        n.x = l * 320;
        n.y = y;
        y += n.h + gapY;
      }
      widths.set(l, Math.max(...arr.map(n => n.w)));
    }
    // Extra spacing if a level is particularly narrow.
    void widths; void gapX;
  }

  /* ------------------------------------------------------------------ *
   * A1111 parameter summary / synthetic graph
   * ------------------------------------------------------------------ */

  function parseA1111(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const clean = text.replace(/\r\n?/g, '\n').trim();
    let settingsStart = -1;
    const stepRegex = /(?:^|\n)Steps:\s*-?\d/gi;
    let m;
    while ((m = stepRegex.exec(clean))) {
      settingsStart = m.index + (m[0].startsWith('\n') ? 1 : 0);
    }
    let negStart = -1;
    const negRegex = /(?:^|\n)Negative prompt:/gi;
    while ((m = negRegex.exec(clean))) {
      negStart = m.index + (m[0].startsWith('\n') ? 1 : 0);
    }
    if (settingsStart === -1 && negStart !== -1) {
      const after = clean.indexOf('\n', negStart);
      if (after !== -1) settingsStart = after + 1;
    }
    let positive = '';
    let negative = '';
    let settings = '';
    if (settingsStart >= 0) {
      let before = clean.slice(0, settingsStart).trim();
      if (negStart >= 0 && negStart < settingsStart) {
        positive = clean.slice(0, negStart).trim();
        negative = clean.slice(negStart + 'Negative prompt:'.length, settingsStart).trim();
      } else {
        positive = before;
      }
      settings = clean.slice(settingsStart).trim();
    } else if (negStart >= 0) {
      positive = clean.slice(0, negStart).trim();
      negative = clean.slice(negStart + 'Negative prompt:'.length).trim();
    } else {
      positive = clean;
    }

    function grab(re) {
      const mm = settings.match(re);
      return mm ? mm[1].trim() : '';
    }
    const steps = grab(/Steps:\s*(-?\d+)/i);
    const sampler = grab(/Sampler:\s*([^,\n]+)/i);
    const cfg = grab(/CFG scale:\s*(-?\d+(?:\.\d+)?)/i);
    const seed = grab(/Seed:\s*(-?\d+)/i);
    const size = grab(/Size:\s*(\d+)\s*x\s*(\d+)/i);
    const sizeM = settings.match(/Size:\s*(\d+)\s*x\s*(\d+)/i);
    const model = grab(/Model:\s*([^,\n]*)/i);
    const denoise = grab(/Denoising strength:\s*(-?\d+(?:\.\d+)?)/i);
    const clipSkip = grab(/Clip skip:\s*(-?\d+)/i);
    const vae = grab(/VAE:\s*([^,\n]+)/i);
    const scheduler = grab(/Schedule type:\s*([^,\n]+)/i);
    const version = grab(/Version:\s*([^,\n]+)/i);

    function num(s) {
      if (s === '') return undefined;
      const n = Number(s);
      if (Number.isSafeInteger(n)) return n;
      if (/^-?\d+$/.test(s)) return BigInt(s);
      return n;
    }

    return {
      positive,
      negative,
      steps: steps === '' ? undefined : num(steps),
      sampler: sampler || undefined,
      cfg: cfg === '' ? undefined : Number(cfg),
      seed: seed === '' ? undefined : num(seed),
      width: sizeM ? Number(sizeM[1]) : undefined,
      height: sizeM ? Number(sizeM[2]) : undefined,
      model: model || undefined,
      denoise: denoise === '' ? undefined : Number(denoise),
      clipSkip: clipSkip === '' ? undefined : num(clipSkip),
      vae: vae || undefined,
      scheduler: scheduler || undefined,
      version: version || undefined,
      settings,
      raw: text
    };
  }

  function param(key, value, label, order) {
    if (value === undefined) return null;
    return { key, label: label || paramLabel(key), localized: '', value, order };
  }

  function synthSummaryParsed(fields, meta) {
    const nodes = [];
    const links = [];
    const mk = (id, type, label, subtitle, x, y, w, h, params) => {
      const node = {
        id,
        type,
        customTitle: label,
        label,
        subtitle,
        displayType: type,
        mode: 0,
        x, y, w, h,
        params: params.filter(Boolean),
        inputs: [],
        outputs: [],
        group: { id: 'summary', title: meta.groupTitle || '参数摘要', color: '#8b6f47' },
        color: '',
        bgcolor: '',
        raw: null
      };
      nodes.push(node);
      return node;
    };
    const modelParams = [
      param('ckpt_name', fields.model),
      param('vae', fields.vae)
    ].filter(Boolean);
    mk('summary:model', 'CheckpointLoaderSimple', '模型', 'Checkpoint', 0, 0, 280, 92, modelParams);
    const posParams = [param('text', fields.positive)].filter(Boolean);
    mk('summary:positive', 'CLIPTextEncode', '正向提示词', 'Positive', 0, 142, 380, 118, posParams);
    const negParams = [param('text', fields.negative)].filter(Boolean);
    mk('summary:negative', 'CLIPTextEncode', '负向提示词', 'Negative', 0, 308, 380, 118, negParams);
    const samplerParams = [
      param('seed', fields.seed),
      param('steps', fields.steps),
      param('cfg', fields.cfg),
      param('sampler_name', fields.sampler),
      param('scheduler', fields.scheduler),
      param('denoise', fields.denoise),
      param('clip_skip', fields.clipSkip)
    ].filter(Boolean);
    mk('summary:sampler', 'KSampler', '采样参数', 'Sampler', 450, 0, 300, 238, samplerParams);
    const sizeParams = [
      param('width', fields.width),
      param('height', fields.height)
    ].filter(Boolean);
    mk('summary:size', 'EmptyLatentImage', '图像尺寸', 'Latent', 450, 282, 280, 100, sizeParams);

    const byId = new Map(nodes.map(n => [n.id, n]));
    const addLink = (source, target) => {
      const l = { id: 'summary:' + links.length, source, sourceSlot: 0, target, targetSlot: links.length, type: 'SUMMARY' };
      links.push(l);
      const t = byId.get(target);
      if (t) t.inputs.push({ name: 'link_' + links.length, label: '', link: l.id, type: 'LINK', widget: null });
    };
    addLink('summary:model', 'summary:sampler');
    addLink('summary:positive', 'summary:sampler');
    addLink('summary:negative', 'summary:sampler');
    addLink('summary:size', 'summary:sampler');

    const groups = [{
      id: 'summary',
      title: meta.groupTitle || '参数摘要',
      x: -40, y: -62,
      w: 830, h: 530,
      color: '#8b6f47'
    }];
    return {
      filename: meta.filename || '摘要',
      fileType: meta.fileType || 'json',
      container: meta.container || 'json',
      kind: meta.kind || 'a1111',
      hasLayout: true,
      label: meta.label || 'A1111 参数摘要',
      workflow: null,
      prompt: null,
      a1111: fields,
      summary: fields,
      nodes,
      nodeById: byId,
      groups,
      links,
      linkById: new Map(links.map(l => [l.id, l])),
      width: meta.width ?? fields.width ?? null,
      height: meta.height ?? fields.height ?? null,
      metadataKeys: meta.metadataKeys || [],
      warnings: uniqueWarnings(meta.warnings),
      rawSource: meta.rawSource || null
    };
  }

  function a1111ToParsed(a1111, meta) {
    return synthSummaryParsed(a1111, Object.assign({}, meta, {
      kind: 'a1111',
      label: 'A1111 参数摘要',
      groupTitle: 'A1111 参数摘要',
      warnings: uniqueWarnings(meta?.warnings || [])
    }));
  }

  function getParam(node, key) {
    if (!node) return undefined;
    const aliases = key === 'sampler_name' ? ['sampler_name', 'sampler'] :
      key === 'sampler' ? ['sampler', 'sampler_name'] : [key];
    for (const alias of aliases) {
      const p = node.params.find(x => x.key === alias);
      if (p) return p.value;
    }
    return undefined;
  }

  function firstPrimitive(node) {
    if (!node) return undefined;
    for (const p of node.params) {
      if (p.key === 'control_after_generate') continue;
      return p.value;
    }
    return undefined;
  }

  function resolveLinkedParam(parsed, node, key, depth) {
    depth = depth || 0;
    if (!node || depth > 8) return undefined;
    const input = node.inputs.find(i => i.widget === key || i.name === key);
    if (input && input.link) {
      const link = parsed.linkById?.get(String(input.link));
      if (link) {
        const src = parsed.nodeById.get(String(link.source));
        if (src) {
          if (/Reroute/i.test(src.type)) {
            const inner = src.inputs.find(i => i.link);
            if (inner) return resolveLinkedParam(parsed, src, inner.widget || inner.name, depth + 1);
          }
          const direct = getParam(src, key);
          if (direct !== undefined) return direct;
          const prim = firstPrimitive(src);
          if (prim !== undefined) return prim;
        }
      }
    }
    return getParam(node, key);
  }

  function extractSummaryFromParsed(parsed) {
    const active = parsed.nodes.filter(n => n.mode === 0);
    const candidates = active.filter(n => /Sampler/i.test(n.type) || /KSampler|FaceDetailer|UltimateSDUpscale/.test(n.type));
    let best = null;
    let bestScore = -Infinity;
    for (const n of candidates) {
      let score = 0;
      if (n.type === 'KSampler') score += 8;
      else if (/KSampler/i.test(n.type)) score += 6;
      else score += 1;
      if (n.inputs.some(i => i.name === 'positive')) score += 3;
      if (n.inputs.some(i => i.name === 'negative')) score += 2;
      if (getParam(n, 'steps') !== undefined) score += 2;
      if (getParam(n, 'seed') !== undefined || getParam(n, 'noise_seed') !== undefined) score += 1;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    const sampler = best;
    let model;
    let vae;
    for (const n of active) {
      if (model === undefined && n.type === 'CheckpointLoaderSimple') model = getParam(n, 'ckpt_name');
      if (model === undefined && /CheckpointLoader|UNETLoader/.test(n.type)) model = getParam(n, 'ckpt_name') ?? getParam(n, 'unet_name');
      if (vae === undefined && n.type === 'VAELoader') vae = getParam(n, 'vae_name');
    }
    let width, height;
    for (const n of active) {
      if (width === undefined && n.type === 'EmptyLatentImage') {
        width = getParam(n, 'width');
        height = getParam(n, 'height');
        break;
      }
    }
    let positive, negative;
    for (const n of active) {
      if (n.type === 'CLIPTextEncode') {
        if (positive === undefined && /positive|正向|正面/i.test(n.label + ' ' + n.customTitle)) positive = getParam(n, 'text');
        if (negative === undefined && /negative|负向|负面/i.test(n.label + ' ' + n.customTitle)) negative = getParam(n, 'text');
      }
    }
    const seed = sampler ? (resolveLinkedParam(parsed, sampler, 'seed') ?? resolveLinkedParam(parsed, sampler, 'noise_seed')) : undefined;
    return {
      model,
      vae,
      positive,
      negative,
      seed,
      steps: sampler ? resolveLinkedParam(parsed, sampler, 'steps') : undefined,
      cfg: sampler ? resolveLinkedParam(parsed, sampler, 'cfg') : undefined,
      sampler: sampler ? (resolveLinkedParam(parsed, sampler, 'sampler_name') ?? resolveLinkedParam(parsed, sampler, 'sampler')) : undefined,
      scheduler: sampler ? resolveLinkedParam(parsed, sampler, 'scheduler') : undefined,
      denoise: sampler ? resolveLinkedParam(parsed, sampler, 'denoise') : undefined,
      clipSkip: sampler ? resolveLinkedParam(parsed, sampler, 'clip_skip') : undefined,
      width,
      height,
      _samplerNode: sampler ? sampler.id : null,
      _source: 'workflow'
    };
  }

  function summarizeParsed(parsed, reason) {
    if (parsed.kind === 'a1111') return parsed;
    const fields = extractSummaryFromParsed(parsed);
    fields._source = parsed.kind;
    const p = synthSummaryParsed(fields, {
      filename: parsed.filename,
      fileType: parsed.fileType,
      container: parsed.container,
      kind: 'summary',
      label: '摘要比较',
      groupTitle: '生成参数摘要（跨来源比较）',
      width: parsed.width,
      height: parsed.height,
      metadataKeys: parsed.metadataKeys,
      warnings: uniqueWarnings((parsed.warnings || []).concat([reason || '一侧只有摘要参数，已切换为生成参数摘要比较。'])),
      rawSource: parsed.rawSource
    });
    p.summary = fields;
    p.summarizedFrom = parsed;
    return p;
  }

  /* ------------------------------------------------------------------ *
   * Image metadata
   * ------------------------------------------------------------------ */

  function bytesEqual(bytes, offset, str) {
    if (offset + str.length > bytes.length) return false;
    for (let i = 0; i < str.length; i++) {
      if (bytes[offset + i] !== str.charCodeAt(i)) return false;
    }
    return true;
  }

  function decodeUtf8(bytes) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (_) {
      try { return new TextDecoder('windows-1252').decode(bytes); }
      catch (__) { return new TextDecoder('latin1').decode(bytes); }
    }
  }

  function decodeUtf16(bytes, littleEndian) {
    const decoder = new TextDecoder(littleEndian ? 'utf-16le' : 'utf-16be');
    return decoder.decode(bytes);
  }

  function stripNulls(s) {
    return String(s).replace(/\0+$/g, '').replace(/\0/g, '');
  }

  async function inflateZlib(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前浏览器不支持 DecompressionStream，无法解压 PNG 文本块');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function parsePng(bytes) {
    let off = 8;
    let width = null, height = null;
    const texts = [];
    while (off + 8 <= bytes.length) {
      const length = ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
      const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
      const dataStart = off + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > bytes.length) break;
      const data = bytes.subarray(dataStart, dataEnd);
      if (type === 'IHDR' && data.length >= 8) {
        width = ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
        height = ((data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]) >>> 0;
      } else if (type === 'tEXt') {
        let sep = data.indexOf(0);
        if (sep > 0) {
          const key = decodeUtf8(data.subarray(0, sep));
          const text = decodeUtf8(data.subarray(sep + 1));
          texts.push({ key, text, source: 'PNG tEXt' });
        }
      } else if (type === 'zTXt') {
        let sep = data.indexOf(0);
        if (sep > 0) {
          const key = decodeUtf8(data.subarray(0, sep));
          const method = data[sep + 1];
          if (method === 0) {
            try {
              const raw = await inflateZlib(data.subarray(sep + 2));
              texts.push({ key, text: decodeUtf8(raw), source: 'PNG zTXt' });
            } catch (e) {
              texts.push({ key, text: '', source: 'PNG zTXt（解压失败）', error: String(e.message || e) });
            }
          }
        }
      } else if (type === 'iTXt') {
        let sep = data.indexOf(0);
        if (sep > 0) {
          const key = decodeUtf8(data.subarray(0, sep));
          let p = sep + 1;
          const compressed = data[p] === 1;
          const method = data[p + 1];
          p += 2;
          while (p < data.length && data[p] !== 0) p++;
          p++;
          while (p < data.length && data[p] !== 0) p++;
          p++;
          let raw = data.subarray(p);
          if (compressed && method === 0) {
            try { raw = await inflateZlib(raw); }
            catch (e) { /* keep raw */ }
          }
          texts.push({ key, text: decodeUtf8(raw), source: 'PNG iTXt' });
        }
      }
      off = dataEnd + 4;
    }
    return { format: 'PNG', width, height, texts };
  }

  function readU16(bytes, off, le) {
    if (off + 2 > bytes.length) return null;
    return le ? (bytes[off] | (bytes[off + 1] << 8)) : ((bytes[off] << 8) | bytes[off + 1]);
  }

  function readU32(bytes, off, le) {
    if (off + 4 > bytes.length) return null;
    if (le) {
      return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
    }
    return ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
  }

  function readTiffEntryValue(bytes, entryOff, type, count, valueField, le) {
    const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
    const unit = typeSizes[type] || 1;
    const size = unit * count;
    const start = size <= 4 ? entryOff + 8 : valueField;
    if (start < 0 || start + size > bytes.length) return null;
    if (type === 2) {
      return stripNulls(decodeUtf8(bytes.subarray(start, start + size)));
    }
    if (type === 7 || type === 1 || type === 6) {
      return bytes.slice(start, start + size);
    }
    if (type === 3) {
      const arr = [];
      for (let i = 0; i < count; i++) arr.push(readU16(bytes, start + i * 2, le));
      return count === 1 ? arr[0] : arr;
    }
    if (type === 4 || type === 9) {
      const arr = [];
      for (let i = 0; i < count; i++) arr.push(readU32(bytes, start + i * 4, le));
      return count === 1 ? arr[0] : arr;
    }
    if (type === 5 || type === 10) {
      const arr = [];
      for (let i = 0; i < count; i++) {
        const num = type === 5 ? readU32(bytes, start + i * 8, le) : (readU32(bytes, start + i * 8, le) | 0);
        const den = readU32(bytes, start + i * 8 + 4, le);
        arr.push(den ? num / den : 0);
      }
      return count === 1 ? arr[0] : arr;
    }
    return bytes.slice(start, start + size);
  }

  function parseTiff(bytes) {
    if (!bytes || bytes.length < 8) return { fields: {}, le: false };
    const le = bytes[0] === 0x49 && bytes[1] === 0x49;
    const be = bytes[0] === 0x4d && bytes[1] === 0x4d;
    if (!le && !be) return { fields: {}, le: false };
    const magic = readU16(bytes, 2, le);
    if (magic !== 42) return { fields: {}, le };
    const fields = {};
    const seen = new Set();
    function readIfd(ifdOffset, group) {
      if (!ifdOffset || seen.has(ifdOffset) || ifdOffset + 2 > bytes.length) return;
      seen.add(ifdOffset);
      const count = readU16(bytes, ifdOffset, le);
      if (count == null) return;
      const base = ifdOffset + 2;
      for (let idx = 0; idx < count; idx++) {
        const entry = base + idx * 12;
        if (entry + 12 > bytes.length) break;
        const tag = readU16(bytes, entry, le);
        const type = readU16(bytes, entry + 2, le);
        const n = readU32(bytes, entry + 4, le);
        const rawValue = readU32(bytes, entry + 8, le);
        const val = readTiffEntryValue(bytes, entry, type, n, rawValue, le);
        if (val !== null && val !== undefined) {
          fields[group + ':' + tag] = val;
          if (!(tag in fields)) fields[tag] = val;
        }
        if (tag === 0x8769) {
          const sub = readTiffEntryValue(bytes, entry, type, n, rawValue, le);
          if (typeof sub === 'number') readIfd(sub, 'exif');
        }
      }
    }
    const ifd0 = readU32(bytes, 4, le);
    readIfd(ifd0, '0th');
    return { fields, le };
  }

  function decodeUserComment(raw) {
    if (typeof raw === 'string') return raw;
    if (!raw || !raw.length) return '';
    const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const prefix = decodeUtf8(data.subarray(0, 8));
    if (prefix.startsWith('ASCII')) return stripNulls(decodeUtf8(data.subarray(8)));
    if (prefix.startsWith('UNICODE')) {
      let body = data.subarray(8);
      if (body[0] === 0xff && body[1] === 0xfe) return stripNulls(decodeUtf16(body.subarray(2), true));
      if (body[0] === 0xfe && body[1] === 0xff) return stripNulls(decodeUtf16(body.subarray(2), false));
      return stripNulls(decodeUtf16(body, false));
    }
    if (prefix.startsWith('JIS')) {
      try { return stripNulls(new TextDecoder('shift_jis').decode(data.subarray(8))); }
      catch (_) { return stripNulls(decodeUtf8(data.subarray(8))); }
    }
    return stripNulls(decodeUtf8(data));
  }

  function extractTagString(fields, tag) {
    const v = fields[tag] ?? fields['0th:' + tag] ?? fields['exif:' + tag];
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (v instanceof Uint8Array) return decodeUtf8(v);
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  }

  function parseExifTexts(fields) {
    const texts = [];
    const make = extractTagString(fields, 0x010f);
    const model = extractTagString(fields, 0x0110);
    const desc = extractTagString(fields, 0x010e);
    const user = fields[0x9286] ?? fields['exif:0x9286'] ?? fields['exif:37526'];
    if (make) texts.push({ key: 'EXIF Make', text: make, source: 'EXIF IFD0' });
    if (model) texts.push({ key: 'EXIF Model', text: model, source: 'EXIF IFD0' });
    if (desc) texts.push({ key: 'EXIF ImageDescription', text: desc, source: 'EXIF IFD0' });
    if (user) texts.push({ key: 'EXIF UserComment', text: decodeUserComment(user), source: 'EXIF ExifIFD' });
    return texts;
  }

  function parseJpeg(bytes) {
    let off = 2;
    let width = null, height = null;
    const texts = [];
    while (off < bytes.length) {
      if (bytes[off] !== 0xff) { off++; continue; }
      while (off < bytes.length && bytes[off] === 0xff) off++;
      if (off >= bytes.length) break;
      const marker = bytes[off++];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (marker === 0xd9) break;
      if (off + 2 > bytes.length) break;
      const segLen = (bytes[off] << 8) | bytes[off + 1];
      if (segLen < 2 || off + segLen > bytes.length) break;
      const payload = bytes.subarray(off + 2, off + segLen);
      off += segLen;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        if (payload.length >= 5) {
          height = (payload[1] << 8) | payload[2];
          width = (payload[3] << 8) | payload[4];
        }
      } else if (marker === 0xe1) {
        if (bytesEqual(payload, 0, 'Exif\0\0')) {
          const tiff = payload.subarray(6);
          const parsed = parseTiff(tiff);
          texts.push(...parseExifTexts(parsed.fields));
        } else if (bytesEqual(payload, 0, 'http://ns.adobe.com/xap/1.0/\0')) {
          const start = 'http://ns.adobe.com/xap/1.0/\0'.length;
          texts.push({ key: 'XMP', text: decodeUtf8(payload.subarray(start)), source: 'JPEG APP1 XMP' });
        }
      } else if (marker === 0xed) {
        texts.push({ key: 'Photoshop IRB', text: decodeUtf8(payload), source: 'JPEG APP13' });
      }
    }
    return { format: 'JPEG', width, height, texts };
  }

  function parseWebp(bytes) {
    let width = null, height = null;
    const texts = [];
    let off = 12;
    while (off + 8 <= bytes.length) {
      const fourcc = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
      const size = bytes[off + 4] | (bytes[off + 5] << 8) | (bytes[off + 6] << 16) | (bytes[off + 7] << 24);
      const start = off + 8;
      const end = start + Math.max(0, size);
      if (end > bytes.length) break;
      const data = bytes.subarray(start, end);
      if (fourcc === 'VP8X' && data.length >= 10) {
        width = 1 + (data[4] | (data[5] << 8) | (data[6] << 16));
        height = 1 + (data[7] | (data[8] << 8) | (data[9] << 16));
      } else if (fourcc === 'EXIF') {
        const tiff = bytesEqual(data, 0, 'Exif\0\0') ? data.subarray(6) : data;
        const parsed = parseTiff(tiff);
        texts.push(...parseExifTexts(parsed.fields));
      } else if (fourcc === 'XMP ') {
        texts.push({ key: 'XMP', text: decodeUtf8(data), source: 'WebP XMP' });
      }
      off = end + (size & 1);
    }
    return { format: 'WebP', width, height, texts };
  }

  function extractBalancedJsonAt(text, start) {
    let i = start;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== '{' && text[i] !== '[') return null;
    const open = text[i];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return text.slice(i, j + 1);
      }
    }
    return null;
  }

  function coerceJson(value) {
    if (value == null) return null;
    if (typeof value === 'object') return value;
    if (typeof value !== 'string') return null;
    let s = value.trim().replace(/^\uFEFF/, '');
    s = s.replace(/^(?:workflow|prompt)\s*:\s*/i, '');
    s = s.replace(/\0+$/g, '');
    if (!s) return null;
    const first = s[0];
    if (first !== '{' && first !== '[') return null;
    try {
      let parsed = parseJSONLossless(s);
      if (typeof parsed === 'string') parsed = coerceJson(parsed);
      return parsed;
    } catch (_) {
      // Try balanced extraction (EXIF may contain a trailing newline or length junk).
      const bal = extractBalancedJsonAt(s, 0);
      if (bal && bal.length > 2) {
        try { return parseJSONLossless(bal); } catch (__) { return null; }
      }
      return null;
    }
  }

  function classifyJsonObject(obj) {
    if (!isPlainObject(obj)) return null;
    if (Array.isArray(obj.nodes)) return { workflow: obj, prompt: null };
    if (obj.workflow && (isPlainObject(obj.workflow) || typeof obj.workflow === 'string')) {
      const wf = coerceJson(obj.workflow);
      const pr = obj.prompt ? coerceJson(obj.prompt) : null;
      if (wf && Array.isArray(wf.nodes)) return { workflow: wf, prompt: pr };
    }
    if (obj.prompt && (isPlainObject(obj.prompt) || typeof obj.prompt === 'string')) {
      const pr = coerceJson(obj.prompt);
      if (pr) return { workflow: null, prompt: pr };
    }
    const values = Object.values(obj);
    if (values.length && values.every(v => isPlainObject(v) && typeof v.class_type === 'string')) {
      return { workflow: null, prompt: obj };
    }
    return null;
  }

  async function parseImageMetadata(bytes) {
    let info;
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytesEqual(bytes, 1, 'PNG')) {
      info = await parsePng(bytes);
    } else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      info = parseJpeg(bytes);
    } else if (bytes.length >= 12 && bytesEqual(bytes, 0, 'RIFF') && bytesEqual(bytes, 8, 'WEBP')) {
      info = parseWebp(bytes);
    } else {
      throw new Error('不支持的图片格式（目前支持 PNG / JPEG / WebP）');
    }

    const meta = {
      format: info.format,
      width: info.width,
      height: info.height,
      texts: info.texts,
      metadataKeys: [],
      workflow: null,
      prompt: null,
      a1111: null,
      warnings: []
    };

    for (const item of info.texts) {
      const key = item.key || '';
      let text = item.text || '';
      if (!text) continue;
      const lower = key.toLowerCase();
      const candidate = coerceJson(text);

      if (candidate && isPlainObject(candidate) && !meta.workflow && Array.isArray(candidate.nodes)) {
        meta.workflow = candidate;
        continue;
      }
      if (candidate && isPlainObject(candidate) && !meta.prompt) {
        const values = Object.values(candidate);
        if (values.length && values.every(v => isPlainObject(v) && typeof v.class_type === 'string')) {
          meta.prompt = candidate;
          continue;
        }
        if (candidate.workflow || candidate.prompt) {
          const cls = classifyJsonObject(candidate);
          if (cls) {
            if (cls.workflow && !meta.workflow) meta.workflow = cls.workflow;
            if (cls.prompt && !meta.prompt) meta.prompt = cls.prompt;
            continue;
          }
        }
      }
      if (lower.includes('workflow') && candidate && Array.isArray(candidate.nodes)) {
        meta.workflow = candidate;
        continue;
      }
      if (lower.includes('prompt') && candidate) {
        const values = Object.values(candidate);
        if (values.length && values.every(v => isPlainObject(v) && typeof v.class_type === 'string')) {
          meta.prompt = candidate;
          continue;
        }
      }
      if (lower.includes('parameter') || /(^|\n)Steps:\s*\d/i.test(text)) {
        const a = parseA1111(text);
        if (a) meta.a1111 = a;
      }

      if (!meta.workflow) {
        const wfMatch = /workflow\s*:\s*\{/i.exec(text);
        if (wfMatch) {
          const bal = extractBalancedJsonAt(text, wfMatch.index + wfMatch[0].length - 1);
          if (bal) {
            const wf = coerceJson(bal);
            if (wf && Array.isArray(wf.nodes)) meta.workflow = wf;
          }
        }
      }
      if (!meta.prompt) {
        const prMatch = /prompt\s*:\s*\{/i.exec(text);
        if (prMatch) {
          const bal = extractBalancedJsonAt(text, prMatch.index + prMatch[0].length - 1);
          if (bal) {
            const pr = coerceJson(bal);
            if (pr && isPlainObject(pr) && Object.values(pr).some(v => isPlainObject(v) && v.class_type)) {
              meta.prompt = pr;
            }
          }
        }
      }
    }

    // De-duplicate keys while preserving order.
    const seenKeys = new Set();
    for (const t of info.texts) {
      const k = t.key || '';
      if (k && !seenKeys.has(k)) { seenKeys.add(k); meta.metadataKeys.push(k); }
    }
    if (!meta.workflow && meta.prompt) {
      meta.warnings.push('图片只包含 API Prompt，没有 UI 节点坐标；已自动布局。');
    }
    if (!meta.workflow && !meta.prompt && meta.a1111) {
      meta.warnings.push('图片只包含 A1111 参数摘要，没有 ComfyUI 节点工作流；已生成摘要图。');
    }
    return meta;
  }

  /* ------------------------------------------------------------------ *
   * Entry points
   * ------------------------------------------------------------------ */

  function detectionError(message) {
    const e = new Error(message);
    e.code = 'UNSUPPORTED';
    return e;
  }

  function parseJsonDocument(text, filename) {
    const root = parseJSONLossless(text);
    const cls = classifyJsonObject(root);
    if (!cls) throw detectionError('无法识别这个 JSON：既不是 ComfyUI UI 工作流，也不是 API Prompt。');
    return buildParsed({
      workflow: cls.workflow,
      prompt: cls.prompt,
      a1111: null,
      filename,
      fileType: 'json',
      container: 'json',
      metadataKeys: [],
      rawSource: 'JSON'
    });
  }

  function buildParsed(meta) {
    if (meta.workflow && Array.isArray(meta.workflow.nodes) && meta.workflow.nodes.length) {
      return normaliseWorkflow(meta.workflow, meta.prompt, meta);
    }
    if (meta.prompt) {
      return normaliseApiPrompt(meta.prompt, meta);
    }
    if (meta.a1111) {
      return a1111ToParsed(meta.a1111, meta);
    }
    throw detectionError('没有找到 ComfyUI 工作流或可识别的参数元数据。');
  }

  function decodeFileText(bytes) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    } catch (_) {
      return new TextDecoder('windows-1252').decode(bytes).replace(/^\uFEFF/, '');
    }
  }

  async function parseFileBuffer(buffer, filename) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (!bytes.length) throw new Error('文件是空的');
    const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytesEqual(bytes, 1, 'PNG');
    const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isWebp = bytes.length >= 12 && bytesEqual(bytes, 0, 'RIFF') && bytesEqual(bytes, 8, 'WEBP');

    if (isPng || isJpeg || isWebp) {
      const meta = await parseImageMetadata(bytes);
      if (!meta.workflow && !meta.prompt && !meta.a1111) {
        throw detectionError('这张图片没有可识别的 ComfyUI 元数据。请使用 ComfyUI 原始输出图片（PNG 通常包含完整 workflow；JPEG/WebP 可能只有 A1111 参数）。');
      }
      meta.filename = filename;
      meta.fileType = meta.format.toLowerCase();
      meta.container = 'image';
      meta.rawSource = meta.format;
      return buildParsed(meta);
    }

    // JSON / text fallback.
    const head = decodeFileText(bytes.subarray(0, Math.min(bytes.length, 4096))).replace(/^\uFEFF/, '').trim();
    if (head.startsWith('{') || head.startsWith('[') || /\.json$/i.test(filename || '')) {
      return parseJsonDocument(decodeFileText(bytes), filename);
    }
    throw detectionError('不认识这个文件。请拖入 ComfyUI 的 .json 工作流，或带元数据的 PNG/JPEG/WebP 图片。');
  }

  async function parseFile(file) {
    const buf = await file.arrayBuffer();
    return parseFileBuffer(new Uint8Array(buf), file.name || '未命名');
  }

  /* ------------------------------------------------------------------ *
   * Comparison
   * ------------------------------------------------------------------ */

  function normalisedTitle(node) {
    return (node.customTitle || node.type || '').trim().toLowerCase();
  }

  function pairNodes(a, b) {
    const aById = a.nodeById;
    const bById = b.nodeById;
    const pairs = [];
    const usedA = new Set();
    const usedB = new Set();
    let overlap = 0;
    for (const [id, an] of aById) {
      const bn = bById.get(id);
      if (!bn) continue;
      overlap++;
      if (an.type === bn.type) {
        pairs.push({ a: an, b: bn, by: 'id' });
        usedA.add(id);
        usedB.add(id);
      }
    }
    const idRatio = overlap / Math.max(1, Math.min(a.nodes.length, b.nodes.length));
    if (idRatio < 0.55) {
      const buckets = new Map();
      for (const bn of b.nodes) {
        if (usedB.has(bn.id)) continue;
        const key = bn.type + '|' + normalisedTitle(bn);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(bn);
      }
      for (const an of a.nodes) {
        if (usedA.has(an.id)) continue;
        const key = an.type + '|' + normalisedTitle(an);
        const bucket = buckets.get(key);
        if (bucket && bucket.length === 1) {
          const bn = bucket[0];
          pairs.push({ a: an, b: bn, by: 'signature' });
          usedA.add(an.id);
          usedB.add(bn.id);
          bucket.pop();
        }
      }
    }
    const onlyA = a.nodes.filter(n => !usedA.has(n.id));
    const onlyB = b.nodes.filter(n => !usedB.has(n.id));
    return { pairs, onlyA, onlyB, idRatio };
  }

  function buildInputSourceMap(parsed) {
    const map = new Map();
    for (const node of parsed.nodes) {
      const inputs = new Map();
      for (const inp of node.inputs) {
        if (inp.link && parsed.linkById.has(String(inp.link))) {
          const link = parsed.linkById.get(String(inp.link));
          const src = parsed.nodeById.get(String(link.source));
          inputs.set(inp.name, {
            sourceId: String(link.source),
            sourceSlot: link.sourceSlot,
            inputLabel: inp.label || inp.name,
            sourceLabel: src ? src.label : ('#' + link.source),
            sourceDisplay: src ? (src.label + ' #' + src.id) : ('#' + link.source)
          });
        } else if (inp.sourceId) {
          const src = parsed.nodeById.get(String(inp.sourceId));
          inputs.set(inp.name, {
            sourceId: String(inp.sourceId),
            sourceSlot: inp.sourceSlot || 0,
            inputLabel: inp.label || inp.name,
            sourceLabel: src ? src.label : ('#' + inp.sourceId),
            sourceDisplay: src ? (src.label + ' #' + src.id) : ('#' + inp.sourceId)
          });
        }
      }
      map.set(node.id, inputs);
    }
    return map;
  }

  function compareLinksForPair(pair, aSources, bSources) {
    const items = [];
    const aInputs = aSources.get(pair.a.id) || new Map();
    const bInputs = bSources.get(pair.b.id) || new Map();
    const names = new Set([...aInputs.keys(), ...bInputs.keys()]);
    for (const name of names) {
      const av = aInputs.get(name);
      const bv = bInputs.get(name);
      const aKey = av ? av.sourceId : '';
      const bKey = bv ? bv.sourceId : '';
      if (aKey === bKey && (!av || !bv || av.sourceSlot === bv.sourceSlot)) continue;
      items.push({
        kind: 'link',
        paramKey: 'link:' + name,
        label: '连接 · ' + ((bv && bv.inputLabel) || (av && av.inputLabel) || name),
        hasA: !!av,
        hasB: !!bv,
        valueA: av ? av.sourceDisplay + ' · 输出 ' + av.sourceSlot : '无连接',
        valueB: bv ? bv.sourceDisplay + ' · 输出 ' + bv.sourceSlot : '无连接',
        sourceA: av || null,
        sourceB: bv || null,
        order: 1000
      });
    }
    return items;
  }

  function subgraphFingerprint(def) {
    return canonical({
      nodes: def?.nodes || [],
      links: def?.links || [],
      groups: def?.groups || [],
      inputs: def?.inputs || [],
      outputs: def?.outputs || [],
      widgets: def?.widgets || []
    });
  }

  function collectSubgraphItems(left, right, pair) {
    if (!left.subgraphDefs || !right.subgraphDefs) return [];
    const defA = left.subgraphDefs[pair.a.type];
    const defB = right.subgraphDefs[pair.b.type];
    if (!defA || !defB) return [];
    if (subgraphFingerprint(defA) === subgraphFingerprint(defB)) return [];

    let subA, subB;
    try {
      const definitions = left.workflow?.definitions || right.workflow?.definitions;
      subA = normaliseWorkflow({
        nodes: defA.nodes || [],
        groups: defA.groups || [],
        links: defA.links || [],
        definitions
      }, null, { filename: 'subgraph-a' });
      subB = normaliseWorkflow({
        nodes: defB.nodes || [],
        groups: defB.groups || [],
        links: defB.links || [],
        definitions
      }, null, { filename: 'subgraph-b' });
    } catch (err) {
      return [{
        kind: 'param',
        paramKey: 'subgraph:' + pair.a.type,
        label: '子图「' + (defB.name || defA.name || '未命名') + '」内部定义',
        hasA: true,
        hasB: true,
        valueA: '定义 A',
        valueB: '定义 B',
        order: 2000
      }];
    }

    const internal = pairNodes(subA, subB);
    const name = defB.name || defA.name || pair.b.label || '子图';
    const items = [];
    let order = 2000;
    for (const p of internal.pairs) {
      const an = p.a;
      const bn = p.b;
      const path = '子图 ' + name + ' / ' + (bn.label || bn.type);
      if (Number(an.mode) !== Number(bn.mode)) {
        items.push({
          kind: 'status',
          paramKey: 'subgraph:' + pair.b.type + ':' + bn.id + ':mode',
          label: path + ' · 节点状态',
          hasA: true,
          hasB: true,
          valueA: modeLabel(an.mode),
          valueB: modeLabel(bn.mode),
          order: order++
        });
      }
      const aParams = new Map(an.params.map(x => [x.key, x]));
      const bParams = new Map(bn.params.map(x => [x.key, x]));
      const keys = [];
      for (const x of an.params) keys.push(x.key);
      for (const x of bn.params) if (!aParams.has(x.key)) keys.push(x.key);
      for (const key of keys) {
        const ap = aParams.get(key);
        const bp = bParams.get(key);
        const av = ap ? ap.value : undefined;
        const bv = bp ? bp.value : undefined;
        if (ap && bp && valuesEqual(av, bv)) continue;
        if (!ap && !bp) continue;
        items.push({
          kind: 'param',
          paramKey: 'subgraph:' + pair.b.type + ':' + bn.id + ':' + key,
          label: path + ' · ' + ((bp && bp.label) || (ap && ap.label) || paramLabel(key)),
          localized: (bp && bp.localized) || (ap && ap.localized) || '',
          hasA: !!ap,
          hasB: !!bp,
          valueA: av,
          valueB: bv,
          order: order++
        });
      }
    }
    for (const an of internal.onlyA) {
      items.push({
        kind: 'node',
        paramKey: 'subgraph:' + pair.b.type + ':' + an.id + ':node',
        label: '子图 ' + name + ' / ' + (an.label || an.type),
        hasA: true,
        hasB: false,
        valueA: '仅 A 存在',
        valueB: '不存在',
        order: order++
      });
    }
    for (const bn of internal.onlyB) {
      items.push({
        kind: 'node',
        paramKey: 'subgraph:' + pair.b.type + ':' + bn.id + ':node',
        label: '子图 ' + name + ' / ' + (bn.label || bn.type),
        hasA: false,
        hasB: true,
        valueA: '不存在',
        valueB: '仅 B 存在',
        order: order++
      });
    }
    return items;
  }

  function groupSortKey(node, groupOrder) {
    const title = node.group?.title || '未分组';
    const idx = groupOrder.has(title) ? groupOrder.get(title) : 9999;
    return [idx, title, Number(node.y) || 0, Number(node.x) || 0, String(node.id)];
  }

  function deriveAction(aNode, bNode, items) {
    if (!aNode) {
      return {
        key: 'add',
        label: '仅 B 新增',
        short: '新增',
        copyCount: 0,
        modeFrom: null,
        modeTo: bNode ? Number(bNode.mode) : null
      };
    }
    if (!bNode) {
      return {
        key: 'remove',
        label: '仅 A 存在，B 已删除',
        short: '删除',
        copyCount: 0,
        modeFrom: Number(aNode.mode),
        modeTo: null
      };
    }
    const statusItem = items.find(it => it.kind === 'status' && it.paramKey === 'mode');
    const copyCount = items.filter(it => it.kind === 'param' || it.kind === 'link').length;
    const modeFrom = Number(aNode.mode);
    const modeTo = Number(bNode.mode);
    let key = 'copy';
    let label = copyCount ? '复制 B 参数' : '有差异';
    if (!statusItem && items.some(it => it.kind === 'status')) {
      key = 'mode';
      label = '修改子图内部节点状态';
      if (copyCount) label += '，并复制 ' + copyCount + ' 项';
    }
    if (statusItem) {
      if (modeTo === 4) {
        key = 'bypass';
        label = '改为 Bypass';
      } else if ((modeFrom === 4 || modeFrom === 2) && modeTo === 0) {
        key = 'enable';
        label = '启用节点';
      } else {
        key = 'mode';
        label = '修改节点状态';
      }
      if (copyCount) label += '，并复制 ' + copyCount + ' 项';
    }
    return {
      key,
      label,
      short: key === 'copy' ? ('复制 ' + copyCount) :
        key === 'bypass' ? 'BYPASS' :
          key === 'enable' ? '启用' :
            key === 'mode' ? '状态' : '差异',
      copyCount,
      modeFrom,
      modeTo
    };
  }

  function buildActionChecklist(diff) {
    const lines = [];
    lines.push('# A → B 工作流修改清单');
    lines.push('');
    lines.push('- A 当前：' + sourceLine(diff.a));
    lines.push('- B 目标：' + sourceLine(diff.b));
    lines.push('- 变更节点：' + diff.stats.changedNodes + ' 个');
    lines.push('');
    let currentGroup = null;
    for (const nr of diff.nodeResults) {
      if (nr.groupTitle !== currentGroup) {
        currentGroup = nr.groupTitle;
        lines.push('## ' + currentGroup);
        lines.push('');
      }
      const n = nr.displayNode;
      lines.push('### ' + n.label + ' #' + n.id);
      lines.push('');
      lines.push('**操作：' + nr.actionLabel + '**');
      lines.push('');
      if (nr.status === 'added') lines.push('- 此节点只存在于 B，需要在 A 中新增。');
      if (nr.status === 'removed') lines.push('- 此节点只存在于 A，B 中已删除。');
      for (const item of nr.items) {
        if (item.kind === 'node') continue;
        if (item.kind === 'status') {
          lines.push('- 节点状态：A `' + item.valueA + '` → B `' + item.valueB + '`');
        } else if (item.kind === 'param' || item.kind === 'link') {
          if (item.hasB === false || item.valueB === undefined) {
            lines.push('- **' + item.label + '**：B 中不存在此参数');
          } else {
            lines.push('- 复制 B 的 **' + item.label + '**：`' + oneLine(item.valueB, 500).replace(/`/g, '\\`') + '`');
          }
        }
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  function unifySummaryGroup(parsed) {
    const title = '生成参数摘要（跨来源比较）';
    const nodes = parsed.nodes.map(n => Object.assign({}, n, {
      group: Object.assign({}, n.group, { title })
    }));
    return Object.assign({}, parsed, {
      nodes,
      nodeById: new Map(nodes.map(n => [n.id, n])),
      groups: (parsed.groups || []).map(g => Object.assign({}, g, { title }))
    });
  }

  function compareParsed(a, b, options) {
    options = Object.assign({ compareLinks: false }, options || {});
    if (!a || !b) throw new Error('需要两份工作流才能比较');
    let left = a;
    let right = b;
    let mode = 'full';
    const warnings = [];
    if ((a.kind === 'a1111') !== (b.kind === 'a1111')) {
      left = unifySummaryGroup(summarizeParsed(a));
      right = unifySummaryGroup(summarizeParsed(b));
      mode = 'summary';
      warnings.push('一侧是 A1111 摘要参数、另一侧是完整工作流，无法逐节点对应；已自动切换为生成参数摘要比较。');
    }
    const pairInfo = pairNodes(left, right);
    const aSources = buildInputSourceMap(left);
    const bSources = buildInputSourceMap(right);

    const groupOrder = new Map();
    const groupCandidates = [];
    for (const g of right.groups || []) groupCandidates.push(g);
    for (const g of left.groups || []) {
      if (!groupCandidates.some(x => x.title === g.title)) groupCandidates.push(g);
    }
    groupCandidates.sort((u, v) => (u.y - v.y) || (u.x - v.x) || u.title.localeCompare(v.title, 'zh-CN'));
    groupCandidates.forEach((g, i) => {
      if (!groupOrder.has(g.title)) groupOrder.set(g.title, i);
    });

    const nodeResults = [];
    const stats = {
      param: 0,
      status: 0,
      node: 0,
      link: 0,
      total: 0,
      changedNodes: 0,
      onlyA: pairInfo.onlyA.length,
      onlyB: pairInfo.onlyB.length
    };

    for (const pair of pairInfo.pairs) {
      const items = [];
      if (Number(pair.a.mode) !== Number(pair.b.mode)) {
        items.push({
          kind: 'status',
          paramKey: 'mode',
          label: '节点状态',
          hasA: true,
          hasB: true,
          valueA: modeLabel(pair.a.mode),
          valueB: modeLabel(pair.b.mode),
          order: -10
        });
      }
      const aParams = new Map(pair.a.params.map(p => [p.key, p]));
      const bParams = new Map(pair.b.params.map(p => [p.key, p]));
      const keys = [];
      for (const p of pair.a.params) keys.push(p.key);
      for (const p of pair.b.params) if (!aParams.has(p.key)) keys.push(p.key);
      for (const key of keys) {
        const ap = aParams.get(key);
        const bp = bParams.get(key);
        const av = ap ? ap.value : undefined;
        const bv = bp ? bp.value : undefined;
        if (ap && bp && valuesEqual(av, bv)) continue;
        if (!ap && !bp) continue;
        items.push({
          kind: 'param',
          paramKey: key,
          label: (bp && bp.label) || (ap && ap.label) || paramLabel(key),
          localized: (bp && bp.localized) || (ap && ap.localized) || '',
          hasA: !!ap,
          hasB: !!bp,
          valueA: av,
          valueB: bv,
          order: (bp && bp.order) ?? (ap && ap.order) ?? 0
        });
      }
      if (options.compareLinks) {
        items.push(...compareLinksForPair(pair, aSources, bSources));
      }
      items.push(...collectSubgraphItems(left, right, pair));
      if (!items.length) continue;
      items.sort((x, y) => (x.order - y.order) || (x.kind.localeCompare(y.kind)) || x.label.localeCompare(y.label, 'zh-CN'));
      for (const item of items) {
        if (stats[item.kind] != null) stats[item.kind]++;
        stats.total++;
      }
      const display = pair.b;
      const action = deriveAction(pair.a, pair.b, items);
      nodeResults.push({
        key: 'pair:' + pair.b.id,
        status: 'changed',
        pairBy: pair.by,
        groupTitle: display.group?.title || pair.a.group?.title || '未分组',
        displayNode: display,
        aNode: pair.a,
        bNode: pair.b,
        items,
        action: action.key,
        actionLabel: action.label,
        actionShort: action.short,
        copyCount: action.copyCount,
        modeFrom: action.modeFrom,
        modeTo: action.modeTo,
        sort: groupSortKey(display, groupOrder)
      });
    }

    for (const an of pairInfo.onlyA) {
      const item = {
        kind: 'node',
        paramKey: 'node',
        label: '节点存在性',
        hasA: true,
        hasB: false,
        valueA: '仅 A 存在',
        valueB: '不存在',
        order: -100
      };
      stats.node++;
      stats.total++;
      const action = deriveAction(an, null, [item]);
      nodeResults.push({
        key: 'onlyA:' + an.id,
        status: 'removed',
        groupTitle: an.group?.title || '未分组',
        displayNode: an,
        aNode: an,
        bNode: null,
        items: [item],
        action: action.key,
        actionLabel: action.label,
        actionShort: action.short,
        copyCount: 0,
        modeFrom: action.modeFrom,
        modeTo: null,
        sort: groupSortKey(an, groupOrder)
      });
    }
    for (const bn of pairInfo.onlyB) {
      const item = {
        kind: 'node',
        paramKey: 'node',
        label: '节点存在性',
        hasA: false,
        hasB: true,
        valueA: '不存在',
        valueB: '仅 B 存在',
        order: -100
      };
      stats.node++;
      stats.total++;
      const action = deriveAction(null, bn, [item]);
      nodeResults.push({
        key: 'onlyB:' + bn.id,
        status: 'added',
        groupTitle: bn.group?.title || '未分组',
        displayNode: bn,
        aNode: null,
        bNode: bn,
        items: [item],
        action: action.key,
        actionLabel: action.label,
        actionShort: action.short,
        copyCount: 0,
        modeFrom: null,
        modeTo: action.modeTo,
        sort: groupSortKey(bn, groupOrder)
      });
    }

    nodeResults.sort((x, y) => {
      for (let i = 0; i < x.sort.length; i++) {
        const xs = x.sort[i], ys = y.sort[i];
        if (xs < ys) return -1;
        if (xs > ys) return 1;
      }
      return 0;
    });
    stats.changedNodes = nodeResults.length;
    stats.actionCounts = { copy: 0, bypass: 0, enable: 0, mode: 0, add: 0, remove: 0 };
    stats.copyNodes = 0;
    stats.copyParams = 0;
    for (const nr of nodeResults) {
      if (stats.actionCounts[nr.action] != null) stats.actionCounts[nr.action]++;
      if (nr.copyCount > 0) stats.copyNodes++;
      stats.copyParams += nr.copyCount;
    }

    // Graph data: right side nodes plus left-only nodes as ghosts.
    const graphNodes = [];
    const diffByNodeId = new Map();
    for (const nr of nodeResults) {
      if (nr.bNode) diffByNodeId.set(nr.bNode.id, nr);
    }
    for (const n of right.nodes) {
      const nr = diffByNodeId.get(n.id);
      graphNodes.push(Object.assign({}, n, {
        graphStatus: nr ? nr.status : 'unchanged',
        changeCount: nr ? nr.items.length : 0,
        diff: nr || null,
        sourceSide: 'B'
      }));
    }
    for (const an of pairInfo.onlyA) {
      const nr = nodeResults.find(x => x.aNode === an);
      graphNodes.push(Object.assign({}, an, {
        graphStatus: 'removed',
        changeCount: nr ? nr.items.length : 1,
        diff: nr || null,
        sourceSide: 'A'
      }));
    }
    const graphGroups = [];
    for (const g of right.groups || []) graphGroups.push(Object.assign({}, g, { side: 'B' }));
    for (const g of left.groups || []) {
      if (!graphGroups.some(x => x.title === g.title)) {
        graphGroups.push(Object.assign({}, g, { side: 'A', removed: true }));
      }
    }
    graphGroups.sort((u, v) => (u.y - v.y) || (u.x - v.x));
    const bounds = calcBounds(graphNodes);
    for (const g of graphGroups) {
      if (!(g.w > 2 && g.h > 2)) continue;
      bounds.minX = Math.min(bounds.minX, g.x);
      bounds.minY = Math.min(bounds.minY, g.y);
      bounds.maxX = Math.max(bounds.maxX, g.x + g.w);
      bounds.maxY = Math.max(bounds.maxY, g.y + g.h);
    }
    const graph = {
      nodes: graphNodes,
      groups: graphGroups,
      links: right.links || [],
      bounds,
      hasLayout: true
    };

    return {
      version: VERSION,
      comparedAt: new Date().toISOString(),
      mode,
      a,
      b,
      left,
      right,
      warnings: uniqueWarnings(warnings),
      nodeResults,
      stats,
      graph,
      options,
      identical: stats.total === 0,
      pairInfo: { idRatio: pairInfo.idRatio, pairs: pairInfo.pairs.length }
    };
  }

  /* ------------------------------------------------------------------ *
   * Reports
   * ------------------------------------------------------------------ */

  function code(v, max) {
    let s = stringifyForDisplay(v, false);
    s = oneLine(s, max || 300);
    return '`' + s.replace(/`/g, '\\`') + '`';
  }

  function sourceLine(parsed) {
    const parts = [
      parsed.filename,
      parsed.label,
      parsed.nodes.length + ' 节点'
    ];
    if (parsed.width && parsed.height) parts.push(parsed.width + '×' + parsed.height);
    if (parsed.metadataKeys?.length) parts.push('元数据: ' + parsed.metadataKeys.join(', '));
    return parts.join(' · ');
  }

  function buildMarkdownReport(diff) {
    const lines = [];
    lines.push('# ComfyUI 工作流差异报告');
    lines.push('');
    lines.push('- 生成时间：' + new Date(diff.comparedAt).toLocaleString('zh-CN'));
    lines.push('- A 当前：' + sourceLine(diff.a));
    lines.push('- B 目标：' + sourceLine(diff.b));
    if (diff.mode === 'summary') lines.push('- 比较模式：摘要比较（一侧只有 A1111 参数）');
    lines.push('');
    if (diff.warnings.length) {
      lines.push('> ' + diff.warnings.join('  \n> '));
      lines.push('');
    }
    lines.push('## A → B 操作摘要');
    lines.push('');
    lines.push('| 操作 | 数量 |');
    lines.push('| --- | ---: |');
    lines.push('| 复制 B 参数的节点 | ' + diff.stats.copyNodes + ' |');
    lines.push('| 需改为 Bypass | ' + (diff.stats.actionCounts?.bypass || 0) + ' |');
    lines.push('| 需启用节点 | ' + (diff.stats.actionCounts?.enable || 0) + ' |');
    lines.push('| 其他状态修改 | ' + (diff.stats.actionCounts?.mode || 0) + ' |');
    lines.push('| 仅 B 新增 | ' + (diff.stats.actionCounts?.add || 0) + ' |');
    lines.push('| 仅 A 删除 | ' + (diff.stats.actionCounts?.remove || 0) + ' |');
    lines.push('| 总变更节点 | ' + diff.stats.changedNodes + ' |');
    lines.push('');
    if (diff.identical) {
      lines.push('两个工作流在比较范围内没有差异。');
      return lines.join('\n');
    }

    let currentGroup = null;
    for (const nr of diff.nodeResults) {
      if (nr.groupTitle !== currentGroup) {
        currentGroup = nr.groupTitle;
        lines.push('## ' + currentGroup);
        lines.push('');
      }
      const n = nr.displayNode;
      lines.push('### ' + n.label + (n.subtitle ? '（' + n.subtitle + '）' : '') + ' · #' + n.id);
      lines.push('');
      if (nr.status === 'removed') lines.push('> 此节点仅存在于 A。');
      if (nr.status === 'added') lines.push('> 此节点仅存在于 B。');
      if (nr.actionLabel) lines.push('> **操作：' + nr.actionLabel + '**');
      lines.push('');
      for (const item of nr.items) {
        if (item.kind === 'status') {
          lines.push('- **' + item.label + '**：' + code(item.valueA) + ' → ' + code(item.valueB));
        } else if (item.kind === 'node') {
          lines.push('- **' + item.label + '**：' + code(item.valueA) + ' → ' + code(item.valueB));
        } else if (item.kind === 'link') {
          lines.push('- **' + item.label + '**：' + code(item.valueA) + ' → ' + code(item.valueB));
        } else {
          const keyText = item.localized && item.localized !== item.label
            ? ' · ' + item.localized
            : ' · `' + item.paramKey + '`';
          lines.push('- **' + item.label + '**' + keyText + '：' + code(item.valueA) + ' → ' + code(item.valueB));
        }
      }
      lines.push('');
    }
    lines.push('---');
    lines.push('由 ComfyUI 工作流对比器生成。');
    return lines.join('\n');
  }

  return {
    VERSION,
    parseJSONLossless,
    parseA1111,
    parseFileBuffer,
    parseFile,
    parseImageMetadata,
    buildParsed,
    compareParsed,
    summarizeParsed,
    extractSummaryFromParsed,
    buildMarkdownReport,
    buildActionChecklist,
    canonical,
    valuesEqual,
    stringifyForDisplay,
    oneLine,
    truncate,
    paramLabel,
    typeLabel,
    modeLabel,
    isBypassed,
    isMuted,
    toJSONSafe
  };
});
