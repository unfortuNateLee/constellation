/**
 * Shared vCard helpers.
 * Keeps parser and writer behavior aligned for escaped values, parameters, and folding.
 */
class VCardUtils {
  static unfold(text) {
    return String(text || '')
      .replace(/\r\n[ \t]/g, '')
      .replace(/\n[ \t]/g, '');
  }

  static splitEscaped(value, delimiter = ';') {
    const parts = [];
    let current = '';
    let escaped = false;
    for (const ch of String(value || '')) {
      if (escaped) {
        current += `\\${ch}`;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === delimiter) {
        parts.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    if (escaped) current += '\\';
    parts.push(current);
    return parts;
  }

  static parseContentLine(line) {
    const source = String(line || '');
    const colonIdx = this._firstUnquotedColon(source);
    if (colonIdx === -1) return null;

    const lhs = source.slice(0, colonIdx);
    const value = source.slice(colonIdx + 1);
    const lhsParts = this._splitParams(lhs);
    const propFull = lhsParts.shift() || '';
    const itemMatch = propFull.match(/^(item\d+)\.(.+)$/i);
    const group = itemMatch ? itemMatch[1].toLowerCase() : null;
    const name = (itemMatch ? itemMatch[2] : propFull).toUpperCase();

    return {
      group,
      name,
      params: this.parseParams(lhsParts),
      value,
    };
  }

  static parseParams(parts) {
    const params = [];
    for (const part of parts || []) {
      if (!part) continue;
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) {
        params.push({ name: 'TYPE', values: [this._unquoteParam(part)] });
        continue;
      }
      const name = part.slice(0, eqIdx).toUpperCase();
      const rawValue = part.slice(eqIdx + 1);
      const values = this._splitParamValues(rawValue).map((value) => this._unquoteParam(value));
      params.push({ name, values });
    }
    return params;
  }

  static typesFromParams(params) {
    const types = [];
    for (const param of params || []) {
      if (param.name !== 'TYPE') continue;
      for (const value of param.values || []) {
        const type = String(value || '').trim();
        if (type) types.push(type.toUpperCase());
      }
    }
    return types.filter((type, index, arr) => arr.indexOf(type) === index);
  }

  static encodeValue(value) {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  static decodeValue(value) {
    // Single left-to-right pass: each backslash consumes exactly the next
    // character. Sequential .replace() passes are wrong here — unescaping `\\`
    // last makes `\\n` (escaped backslash + literal "n") decode as a newline.
    const s = String(value || '');
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && i + 1 < s.length) {
        const next = s[i + 1];
        i += 1;
        out += next === 'n' || next === 'N' ? '\n' : next;
      } else {
        out += ch;
      }
    }
    return out;
  }

  static buildTypeParams(types = []) {
    return (types || [])
      .map((type) => String(type || '').trim())
      .filter(Boolean)
      .filter((type, index, arr) => {
        const upper = type.toUpperCase();
        return (
          arr.findIndex(
            (other) =>
              String(other || '')
                .trim()
                .toUpperCase() === upper,
          ) === index
        );
      })
      .map((type) => `;TYPE=${String(type).toUpperCase()}`)
      .join('');
  }

  static foldLine(line, limit = 75) {
    const source = String(line || '');
    const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    if (!encoder) return this._foldLineByCodePoint(source, limit);
    if (encoder.encode(source).length <= limit) return source;

    const chunks = [];
    let current = '';
    let currentBytes = 0;
    let chunkLimit = limit;

    for (const ch of source) {
      const byteLength = encoder.encode(ch).length;
      if (current && currentBytes + byteLength > chunkLimit) {
        chunks.push(chunks.length === 0 ? current : ` ${current}`);
        current = ch;
        currentBytes = byteLength;
        chunkLimit = limit - 1;
      } else {
        current += ch;
        currentBytes += byteLength;
      }
    }
    if (current || chunks.length === 0) {
      chunks.push(chunks.length === 0 ? current : ` ${current}`);
    }

    return chunks.join('\r\n');
  }

  static foldLines(lines) {
    return (lines || []).map((line) => this.foldLine(line)).join('\r\n');
  }

  static _firstUnquotedColon(source) {
    let inQuotes = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch === '"') inQuotes = !inQuotes;
      if (ch === ':' && !inQuotes) return i;
    }
    return -1;
  }

  static _splitParams(lhs) {
    const parts = [];
    let current = '';
    let inQuotes = false;
    for (const ch of String(lhs || '')) {
      if (ch === '"') inQuotes = !inQuotes;
      if (ch === ';' && !inQuotes) {
        parts.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    parts.push(current);
    return parts;
  }

  static _splitParamValues(value) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (const ch of String(value || '')) {
      if (ch === '"') inQuotes = !inQuotes;
      if (ch === ',' && !inQuotes) {
        values.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    values.push(current);
    return values;
  }

  static _unquoteParam(value) {
    const trimmed = String(value || '').trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  static _foldLineByCodePoint(source, limit) {
    const chars = Array.from(source);
    if (chars.length <= limit) return source;
    const chunks = [];
    let chunkLimit = limit;
    for (let i = 0; i < chars.length; ) {
      const chunk = chars.slice(i, i + chunkLimit).join('');
      chunks.push(chunks.length === 0 ? chunk : ` ${chunk}`);
      i += chunkLimit;
      chunkLimit = limit - 1;
    }
    return chunks.join('\r\n');
  }
}
